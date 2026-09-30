/**
 * Snapchat app-switch (spike) — partie « téléphone » : stockage de la
 * demande en cours, ouverture du lien, attente du retour.
 *
 * Le retour `nia://snapchat-auth?code=…&state=…` est traité par l'écran
 * `app/snapchat-auth.tsx` (et non ici) : il fonctionne même si Android a tué
 * NIA pendant que l'utilisateur était dans Snapchat. La demande (state +
 * code_verifier) est donc gardée dans SecureStore, pas seulement en mémoire.
 *
 * Logique pure et tests : `lib/snapchatAppSwitch.ts`.
 */
import * as AuthSession from 'expo-auth-session';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, Linking, Platform, type AppStateStatus } from 'react-native';
import {
  SNAP_APP_SWITCH_DEFAULT,
  SNAP_APP_SWITCH_TIMEOUT_MS,
  SNAP_ERR,
  SNAP_OPEN_CHECK_MS,
  SNAP_RETURN_GRACE_MS,
  buildSnapHttpsAuthUrl,
  buildSnapchatAppAuthUrl,
  isPlainSnapHttpsAuthUrl,
  isSnapAppSwitchVariant,
  isSnapReturnUrl,
  parsePending,
  serializePending,
  snapError,
  type PendingSnapAuth,
  type SnapAppSwitchVariant,
} from '@/lib/snapchatAppSwitch';

const PENDING_KEY = 'nia.snap.pending.v1';
const VARIANT_KEY = 'nia.snap.variant.v1';

const SNAP_DISCOVERY: AuthSession.DiscoveryDocument = {
  authorizationEndpoint: 'https://accounts.snapchat.com/accounts/oauth2/auth',
  tokenEndpoint: 'https://accounts.snapchat.com/accounts/oauth2/token',
};

/* ------------------------------------------------------------------ */
/* Variante (réglage caché de test)                                    */
/* ------------------------------------------------------------------ */

export async function getSnapVariant(): Promise<SnapAppSwitchVariant> {
  try {
    const raw = await AsyncStorage.getItem(VARIANT_KEY);
    return isSnapAppSwitchVariant(raw) ? raw : SNAP_APP_SWITCH_DEFAULT;
  } catch {
    return SNAP_APP_SWITCH_DEFAULT;
  }
}

export async function setSnapVariant(v: SnapAppSwitchVariant): Promise<void> {
  try {
    await AsyncStorage.setItem(VARIANT_KEY, v);
  } catch {
    // réglage de test : perte sans gravité
  }
}

/* ------------------------------------------------------------------ */
/* Demande en cours                                                    */
/* ------------------------------------------------------------------ */

export async function savePendingSnapAuth(p: PendingSnapAuth): Promise<void> {
  await SecureStore.setItemAsync(PENDING_KEY, serializePending(p));
}

export async function loadPendingSnapAuth(): Promise<PendingSnapAuth | null> {
  try {
    return parsePending(await SecureStore.getItemAsync(PENDING_KEY));
  } catch {
    return null;
  }
}

export async function clearPendingSnapAuth(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(PENDING_KEY);
  } catch {
    // ignore
  }
}

/* ------------------------------------------------------------------ */
/* Détection de Snapchat                                               */
/* ------------------------------------------------------------------ */

/**
 * Snapchat installé ? Android uniquement. Nécessite la déclaration
 * `<queries>` de `plugins/withSnapchatQueries.js` (Android 11+).
 */
export async function isSnapchatInstalled(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  try {
    return await Linking.canOpenURL('snapchat://');
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Attente du retour                                                   */
/* ------------------------------------------------------------------ */

type Waiter = {
  markReceived: () => void;
  settle: (outcome: 'signed_in' | 'failed') => void;
};

let waiter: Waiter | null = null;

/** Appelé par l'écran de retour dès son ouverture. */
export function notifySnapReturnReceived(): void {
  waiter?.markReceived();
}

/** Appelé par l'écran de retour quand il a fini (succès ou message affiché). */
export function settleSnapReturn(outcome: 'signed_in' | 'failed'): void {
  waiter?.settle(outcome);
}

export type StartAppSwitchInput = {
  clientId: string;
  redirectUri: string;
  scopes: readonly string[];
  variant: Exclude<SnapAppSwitchVariant, 'web'>;
};

/**
 * Ouvre Snapchat et attend l'issue.
 *
 * Résout 'signed_in' quand l'écran de retour a ouvert la session (il a déjà
 * navigué vers le fil). Rejette avec `code` :
 *   - SNAP_ERR.unavailable : rien ne s'est ouvert → l'appelant bascule sur le web ;
 *   - SNAP_ERR.returned    : l'utilisateur est revenu sur NIA sans terminer ;
 *   - SNAP_ERR.timeout     : pas de réponse dans les 5 min ;
 *   - SNAP_ERR.handled     : l'écran de retour a affiché une erreur.
 */
export async function startSnapchatAppSwitch(input: StartAppSwitchInput): Promise<'signed_in'> {
  const request = new AuthSession.AuthRequest({
    clientId: input.clientId,
    redirectUri: input.redirectUri,
    scopes: [...input.scopes],
    responseType: AuthSession.ResponseType.Code,
    usePKCE: true,
  });
  // Génère state, code_verifier et code_challenge (S256).
  await request.makeAuthUrlAsync(SNAP_DISCOVERY);
  const { state, codeVerifier, codeChallenge } = request;
  if (!state || !codeVerifier || !codeChallenge) {
    throw snapError(SNAP_ERR.unavailable, 'PKCE indisponible');
  }

  const authParams = {
    clientId: input.clientId,
    redirectUri: input.redirectUri,
    scopes: input.scopes,
    state,
    codeChallenge,
  };
  // 'https' : exactement l'URL du flux web (celle qu'expo-auth-session vient
  // de construire), sans aucun paramètre du lien app. 'snapchat' : lien app,
  // construit à part.
  const url =
    input.variant === 'snapchat'
      ? buildSnapchatAppAuthUrl(authParams)
      : isPlainSnapHttpsAuthUrl(request.url)
        ? request.url
        : buildSnapHttpsAuthUrl(authParams);

  await savePendingSnapAuth({
    state,
    codeVerifier,
    redirectUri: input.redirectUri,
    variant: input.variant,
    createdAt: Date.now(),
  });

  // Une seule demande à la fois : l'ancienne attente est abandonnée.
  waiter?.settle('failed');

  return new Promise<'signed_in'>((resolve, reject) => {
    let done = false;
    let wentAway = false;
    let received = false;
    let graceTimer: ReturnType<typeof setTimeout> | null = null;

    const clearGrace = () => {
      if (graceTimer) clearTimeout(graceTimer);
      graceTimer = null;
    };

    const cleanup = () => {
      clearGrace();
      clearTimeout(openCheck);
      clearTimeout(overall);
      appSub.remove();
      linkSub.remove();
      if (waiter === self) waiter = null;
    };

    const fail = (code: string, message: string, dropPending: boolean) => {
      if (done) return;
      done = true;
      cleanup();
      if (dropPending) void clearPendingSnapAuth();
      reject(snapError(code, message));
    };

    const self: Waiter = {
      markReceived: () => {
        received = true;
        clearGrace();
      },
      settle: (outcome) => {
        if (done) return;
        done = true;
        cleanup();
        if (outcome === 'signed_in') resolve('signed_in');
        else reject(snapError(SNAP_ERR.handled, 'Résultat affiché par l’écran de retour'));
      },
    };
    waiter = self;

    const linkSub = Linking.addEventListener('url', ({ url: incoming }) => {
      if (isSnapReturnUrl(incoming, input.redirectUri)) self.markReceived();
    });

    const appSub = AppState.addEventListener('change', (s: AppStateStatus) => {
      if (s === 'background' || s === 'inactive') {
        wentAway = true;
        clearGrace();
        return;
      }
      if (s === 'active' && wentAway && !received) {
        clearGrace();
        // Le lien de retour arrive juste après le retour au premier plan :
        // on lui laisse un court délai avant de conclure à un abandon.
        graceTimer = setTimeout(() => {
          if (!received) {
            fail(SNAP_ERR.returned, 'Connexion Snapchat non terminée', true);
          }
        }, SNAP_RETURN_GRACE_MS);
      }
    });

    const openCheck = setTimeout(() => {
      if (!wentAway && !received) {
        fail(SNAP_ERR.unavailable, 'Snapchat ne s’est pas ouvert', true);
      }
    }, SNAP_OPEN_CHECK_MS);

    const overall = setTimeout(() => {
      fail(SNAP_ERR.timeout, 'Snapchat n’a pas répondu à temps', true);
    }, SNAP_APP_SWITCH_TIMEOUT_MS);

    Linking.openURL(url).catch(() => {
      fail(SNAP_ERR.unavailable, 'Lien Snapchat refusé par le téléphone', true);
    });
  });
}
