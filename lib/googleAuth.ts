/**
 * Google Sign-In natif → Supabase Auth (signInWithIdToken).
 * Requiert un build EAS (pas Expo Go). Voir GOOGLE_AUTH.md.
 *
 * La bibliothèque est chargée à la demande, jamais au chargement du module.
 * Raison : @react-native-google-signin/google-signin v16 résout son module
 * natif au niveau supérieur de son propre code —
 *
 *   // lib/module/spec/NativeGoogleSignin.js
 *   export const NativeModule = TurboModuleRegistry.getEnforcing('RNGoogleSignin');
 *
 * — et `getEnforcing` lève à l'évaluation du module, pas à l'appel. Comme
 * context/AuthContext.tsx importe ce fichier, et que app/_layout.tsx monte
 * AuthProvider, un import statique faisait lever l'app AVANT le premier rendu
 * dans Expo Go, où RNGoogleSignin est absent par construction. L'ErrorBoundary
 * d'app/_layout.tsx ne pouvait rien y faire : il ne couvre que le rendu de ses
 * enfants, pas le chargement des modules.
 *
 * Avec l'import dynamique, l'évaluation n'a lieu qu'au moment où l'utilisateur
 * appuie sur « Continuer avec Google ». Expo Go démarre, et cet unique bouton
 * renvoie un message explicite au lieu de tuer l'application.
 */
import { Platform } from 'react-native';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';

/** Import de type uniquement — effacé à la compilation, aucun effet à l'exécution. */
type GoogleSigninModule = typeof import('@react-native-google-signin/google-signin');

const webClientId = (process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || '').trim();
const iosClientId = (process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || '').trim();

let modulePromise: Promise<GoogleSigninModule> | null = null;
let configured = false;

export function isGoogleAuthConfigured(): boolean {
  return webClientId.length > 0 && !webClientId.includes('PLACEHOLDER');
}

/** true si l'erreur traduit un module natif introuvable plutôt qu'un vrai échec. */
function looksLikeMissingNativeModule(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return (
    msg.includes('RNGoogleSignin') ||
    msg.includes('native module') ||
    msg.includes('NativeModule') ||
    msg.includes('TurboModuleRegistry') ||
    msg.includes('null is not an object')
  );
}

/**
 * Charge la bibliothèque, une seule fois par session.
 *
 * L'échec n'est pas mémorisé : `modulePromise` est remis à null pour qu'un
 * appel ultérieur réessaie, au cas où l'erreur serait transitoire.
 */
async function loadGoogleSignin(): Promise<GoogleSigninModule> {
  if (!modulePromise) {
    modulePromise = import('@react-native-google-signin/google-signin').catch(
      (e: unknown) => {
        modulePromise = null;
        if (looksLikeMissingNativeModule(e)) {
          throw new Error(
            'Google Sign-In nécessite un build EAS (development/preview), pas Expo Go. Voir GOOGLE_AUTH.md.',
          );
        }
        throw e instanceof Error ? e : new Error(String(e));
      },
    );
  }
  return modulePromise;
}

/** Vérifie la configuration d'environnement — sans toucher au module natif. */
function assertGoogleConfigured(): void {
  if (!isGoogleAuthConfigured()) {
    throw new Error(
      'Google non configuré. Définissez EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID (voir GOOGLE_AUTH.md).',
    );
  }
}

function configureOnce(mod: GoogleSigninModule): void {
  if (configured) return;
  mod.GoogleSignin.configure({
    webClientId,
    ...(Platform.OS === 'ios' && iosClientId && !iosClientId.includes('PLACEHOLDER')
      ? { iosClientId }
      : {}),
    offlineAccess: false,
  });
  configured = true;
}

export type GoogleSignInResult = {
  idToken: string;
  email: string | null;
  name: string | null;
  photo: string | null;
};

/**
 * Lance le flux Google natif et retourne l'idToken pour Supabase.
 * Annulation utilisateur → Error avec code 'CANCELLED'.
 */
export async function getGoogleIdToken(): Promise<GoogleSignInResult> {
  if (Platform.OS === 'web') {
    throw new Error(
      'Google Sign-In natif n’est pas disponible sur le web. Utilisez un APK EAS.',
    );
  }

  // Ordre conservé : la précondition d'environnement est vérifiée avant de
  // charger quoi que ce soit — sans client ID, charger la bibliothèque ne sert
  // à rien et le message « Google non configuré » reste le plus utile.
  assertGoogleConfigured();

  const mod = await loadGoogleSignin();
  configureOnce(mod);

  try {
    await mod.GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  } catch {
    // iOS n'a pas Play Services — ignore
  }

  let response;
  try {
    response = await mod.GoogleSignin.signIn();
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string };
    const { statusCodes } = mod;
    if (err?.code === statusCodes.SIGN_IN_CANCELLED || err?.code === statusCodes.IN_PROGRESS) {
      const cancel = new Error('Connexion Google annulée');
      (cancel as Error & { code?: string }).code = 'CANCELLED';
      throw cancel;
    }
    if (err?.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
      throw new Error('Google Play Services indisponible ou obsolète.');
    }
    // Le cas « module natif absent » est traité par loadGoogleSignin : si on
    // arrive ici, la bibliothèque a bien été chargée et l'échec est réel.
    // Ne pas renvoyer l'utilisateur vers « il faut un build EAS », ce serait
    // faux sur un build EAS.
    throw e instanceof Error ? e : new Error(err?.message || String(e));
  }

  if (!mod.isSuccessResponse(response)) {
    const cancel = new Error('Connexion Google annulée');
    (cancel as Error & { code?: string }).code = 'CANCELLED';
    throw cancel;
  }

  const idToken = response.data.idToken;
  if (!idToken) {
    throw new Error(
      'Pas d’idToken Google. Vérifiez EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID (type Web) et le SHA-1 Android.',
    );
  }

  return {
    idToken,
    email: response.data.user.email ?? null,
    name: response.data.user.name ?? null,
    photo: response.data.user.photo ?? null,
  };
}

/**
 * Échange l'idToken Google contre une session Supabase.
 * Documenter « Skip nonce check » dans le Dashboard Google provider (MVP).
 */
export async function signInWithGoogleIdToken(idToken: string): Promise<void> {
  const sb = getSupabase();
  if (!sb || !isSupabaseConfigured) {
    throw new Error('Supabase non configuré.');
  }
  const { error } = await sb.auth.signInWithIdToken({
    provider: 'google',
    token: idToken,
  });
  if (error) throw error;
}
