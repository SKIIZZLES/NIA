/**
 * Snapchat « app-switch » (spike) — logique pure, testée par Jest
 * (__tests__/lib/snapchatAppSwitch.test.ts).
 *
 * But : sur Android, quand l'app Snapchat est installée, « Continuer avec
 * Snapchat » ouvre directement l'app Snapchat au lieu d'une page web.
 *
 * Deux variantes à comparer sur téléphone (réglage caché, voir
 * `components/SnapchatSignInButton.tsx`, appui long) :
 *   - 'https'    : `Linking.openURL` sur l'URL OAuth https d'accounts.snapchat.com.
 *                  L'app Snapchat Android est vérifiée pour ce domaine
 *                  (assetlinks.json) : si elle revendique ce chemin, Android
 *                  l'ouvre directement ; sinon c'est le navigateur par défaut.
 *   - 'snapchat' : `snapchat://oauth2?…`, le lien que construit le SDK Login
 *                  Kit Android 3.0.0 (lu dans l'AAR, non documenté par Snap).
 *   - 'web'      : flux historique (Custom Tab via expo-auth-session).
 *
 * Dans les trois cas : PKCE S256 + `state`, retour sur `nia://snapchat-auth`,
 * échange du code par l'Edge Function `snapchat-auth` (mode public).
 */

export const SNAP_AUTHORIZE_URL = 'https://accounts.snapchat.com/accounts/oauth2/auth';
export const SNAPCHAT_APP_AUTHORIZE_URL = 'snapchat://oauth2';
export const SNAPCHAT_ANDROID_PACKAGE = 'com.snapchat.android';
export const NIA_ANDROID_PACKAGE = 'app.nia.mobile';
/** Version annoncée par le SDK Login Kit Android dont on reprend le lien. */
export const SNAP_KIT_VERSION = '3.0.0';

export type SnapAppSwitchVariant = 'https' | 'snapchat' | 'web';

/**
 * Variante par défaut du spike. Changer cette constante (ou l'appui long sur
 * le bouton, en test) pour essayer l'autre lien.
 */
export const SNAP_APP_SWITCH_DEFAULT: SnapAppSwitchVariant = 'https';

export const SNAP_APP_SWITCH_VARIANTS: readonly SnapAppSwitchVariant[] = ['https', 'snapchat', 'web'];

/** Durée de vie d'une demande en cours : le code Snap expire après 10 min. */
export const SNAP_PENDING_TTL_MS = 10 * 60 * 1000;
/** Délai d'attente du lien de retour quand l'utilisateur revient sur NIA. */
export const SNAP_RETURN_GRACE_MS = 2500;
/** Si l'app n'est pas passée en arrière-plan après ce délai, rien ne s'est ouvert. */
export const SNAP_OPEN_CHECK_MS = 4000;
/** Temps maximal passé hors de NIA avant d'abandonner la demande. */
export const SNAP_APP_SWITCH_TIMEOUT_MS = 5 * 60 * 1000;

export function isSnapAppSwitchVariant(v: unknown): v is SnapAppSwitchVariant {
  return typeof v === 'string' && (SNAP_APP_SWITCH_VARIANTS as readonly string[]).includes(v);
}

/** Variante suivante (réglage caché de test). */
export function nextSnapVariant(v: SnapAppSwitchVariant): SnapAppSwitchVariant {
  const i = SNAP_APP_SWITCH_VARIANTS.indexOf(v);
  return SNAP_APP_SWITCH_VARIANTS[(i + 1) % SNAP_APP_SWITCH_VARIANTS.length];
}

export type SnapAuthParams = {
  clientId: string;
  redirectUri: string;
  scopes: readonly string[];
  state: string;
  codeChallenge: string;
};

type Pair = [string, string];

function query(pairs: Pair[]): string {
  return pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
}

function assertParams(p: SnapAuthParams): void {
  if (!p.clientId || !p.redirectUri || !p.state || !p.codeChallenge) {
    throw new Error('Paramètres OAuth Snapchat incomplets.');
  }
}

function basePairs(p: SnapAuthParams): Pair[] {
  return [
    ['response_type', 'code'],
    ['client_id', p.clientId],
    ['redirect_uri', p.redirectUri],
    ['scope', p.scopes.join(' ')],
    ['state', p.state],
    ['code_challenge_method', 'S256'],
    ['code_challenge', p.codeChallenge],
  ];
}

/** URL OAuth https (variante 'https'). */
export function buildSnapHttpsAuthUrl(p: SnapAuthParams): string {
  assertParams(p);
  return `${SNAP_AUTHORIZE_URL}?${query(basePairs(p))}`;
}

/**
 * Lien `snapchat://oauth2?…` (variante 'snapchat'), mêmes paramètres et même
 * ordre que `AuthorizationRequest.toUri` du SDK Login Kit Android 3.0.0.
 */
export function buildSnapchatAppAuthUrl(
  p: SnapAuthParams,
  packageName: string = NIA_ANDROID_PACKAGE,
): string {
  assertParams(p);
  if (!packageName) throw new Error('package_name requis.');
  const pairs: Pair[] = [
    ...basePairs(p),
    ['sdk_is_from_react_native_plugin', 'false'],
    ['is_for_firebase_authentication', 'false'],
    ['package_name', packageName],
    ['kit_version', SNAP_KIT_VERSION],
    ['link', p.clientId],
  ];
  return `${SNAPCHAT_APP_AUTHORIZE_URL}?${query(pairs)}`;
}

export function buildSnapAuthUrl(variant: Exclude<SnapAppSwitchVariant, 'web'>, p: SnapAuthParams): string {
  return variant === 'snapchat' ? buildSnapchatAppAuthUrl(p) : buildSnapHttpsAuthUrl(p);
}

/** Paramètres lus sur `nia://snapchat-auth?…`. */
export type SnapReturnParams = {
  code?: string;
  state?: string;
  error?: string;
  errorDescription?: string;
};

function firstString(v: unknown): string | undefined {
  if (Array.isArray(v)) return firstString(v[0]);
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** Normalise les paramètres de route expo-router (string | string[]). */
export function snapReturnFromRouteParams(params: Record<string, unknown>): SnapReturnParams {
  return {
    code: firstString(params.code),
    state: firstString(params.state),
    error: firstString(params.error),
    errorDescription: firstString(params.error_description),
  };
}

/** Lit une URL de retour complète (écouteur Linking). */
export function parseSnapReturnUrl(url: string): SnapReturnParams {
  const q = url.indexOf('?');
  const h = url.indexOf('#');
  const params: Record<string, string> = {};
  const read = (s: string) => {
    for (const part of s.split('&')) {
      if (!part) continue;
      const i = part.indexOf('=');
      const k = decodeURIComponent((i < 0 ? part : part.slice(0, i)).replace(/\+/g, ' '));
      const v = i < 0 ? '' : decodeURIComponent(part.slice(i + 1).replace(/\+/g, ' '));
      if (!(k in params)) params[k] = v;
    }
  };
  if (q >= 0) read(url.slice(q + 1, h > q ? h : undefined));
  if (h >= 0) read(url.slice(h + 1));
  return snapReturnFromRouteParams(params);
}

/** L'URL est-elle notre retour Snapchat (quel que soit le format du scheme) ? */
export function isSnapReturnUrl(url: string, redirectUri: string): boolean {
  const strip = (u: string) => u.split(/[?#]/)[0].replace(/\/+$/, '').replace(/^([a-z][a-z0-9+.-]*):\/\/\/?/i, '$1://');
  return strip(url).toLowerCase() === strip(redirectUri).toLowerCase();
}

/** Demande en cours, conservée (SecureStore) le temps de l'aller-retour. */
export type PendingSnapAuth = {
  state: string;
  codeVerifier: string;
  redirectUri: string;
  variant: SnapAppSwitchVariant;
  createdAt: number;
};

export function serializePending(p: PendingSnapAuth): string {
  return JSON.stringify(p);
}

export function parsePending(raw: string | null | undefined): PendingSnapAuth | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Partial<PendingSnapAuth>;
    if (
      typeof o.state === 'string' && o.state &&
      typeof o.codeVerifier === 'string' && o.codeVerifier &&
      typeof o.redirectUri === 'string' && o.redirectUri &&
      typeof o.createdAt === 'number' &&
      isSnapAppSwitchVariant(o.variant)
    ) {
      return o as PendingSnapAuth;
    }
  } catch {
    // illisible → ignorée
  }
  return null;
}

export type SnapReturnFailure =
  | 'no_pending'
  | 'expired'
  | 'state_mismatch'
  | 'denied'
  | 'snap_error'
  | 'missing_code';

export type SnapReturnCheck =
  | { ok: true; code: string; codeVerifier: string; redirectUri: string }
  | { ok: false; reason: SnapReturnFailure; detail?: string };

/** Comparaison à durée constante (longueur connue). */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Valide un retour Snapchat contre la demande en cours.
 * Ordre : demande absente → state → expiration → erreur Snap → code.
 * Le `state` est vérifié AVANT de regarder une éventuelle erreur, pour ne
 * jamais réagir à un lien forgé.
 */
export function validateSnapReturn(
  pending: PendingSnapAuth | null,
  ret: SnapReturnParams,
  now: number,
  ttlMs: number = SNAP_PENDING_TTL_MS,
): SnapReturnCheck {
  if (!pending) return { ok: false, reason: 'no_pending' };
  if (!ret.state || !safeEqual(ret.state, pending.state)) {
    return { ok: false, reason: 'state_mismatch' };
  }
  if (now - pending.createdAt > ttlMs || now < pending.createdAt - 60_000) {
    return { ok: false, reason: 'expired' };
  }
  if (ret.error) {
    return {
      ok: false,
      reason: ret.error === 'access_denied' ? 'denied' : 'snap_error',
      detail: ret.errorDescription || ret.error,
    };
  }
  if (!ret.code) return { ok: false, reason: 'missing_code' };
  return {
    ok: true,
    code: ret.code,
    codeVerifier: pending.codeVerifier,
    redirectUri: pending.redirectUri,
  };
}

/** Clé i18n du message affiché pour chaque échec (« vous »). */
export function snapReturnFailureKey(reason: SnapReturnFailure): string {
  switch (reason) {
    case 'denied':
      return 'snapchat.returnDenied';
    case 'state_mismatch':
      return 'snapchat.returnStateMismatch';
    case 'expired':
    case 'no_pending':
      return 'snapchat.returnExpired';
    case 'snap_error':
    case 'missing_code':
    default:
      return 'snapchat.returnError';
  }
}

/** Codes d'erreur levés par le flux app-switch (lus par le bouton). */
export const SNAP_ERR = {
  /** Snapchat ne s'est pas ouvert : on bascule sur le flux web. */
  unavailable: 'SNAP_APP_SWITCH_UNAVAILABLE',
  /** L'utilisateur est revenu sur NIA sans terminer. */
  returned: 'SNAP_RETURNED_WITHOUT_FINISHING',
  /** Aucune réponse dans le temps imparti. */
  timeout: 'SNAP_TIMEOUT',
  /** L'écran de retour a déjà affiché le résultat. */
  handled: 'SNAP_HANDLED_BY_RETURN_SCREEN',
} as const;

export function snapError(code: string, message: string): Error & { code: string } {
  const e = new Error(message) as Error & { code: string };
  e.code = code;
  return e;
}
