/**
 * Logique pure de l'Edge Function snapchat-auth : lecture de la requête et
 * préparation de l'échange du code OAuth auprès de Snap.
 *
 * Aucune API Deno, aucun import réseau : ce module est importé par index.ts
 * (Deno, Edge Function) ET par les tests Jest
 * (__tests__/supabase/snapchatAuth.test.ts).
 *
 * Deux façons d'échanger le code :
 *   - « public » (v7) : client OAuth public (le Client ID Staging `7ea8f803-…`
 *     est public, confirmé par le fondateur le 30/09/2026). PKCE seul,
 *     `client_id` dans le corps, AUCUN en-tête Basic ni secret. C'est le flux
 *     recommandé par Snap pour les apps mobiles. Le client_id envoyé doit
 *     figurer dans la liste autorisée (SNAP_CLIENT_ID + SNAP_PUBLIC_CLIENT_IDS).
 *   - « confidential » (historique, v1–v6) : en-tête Basic
 *     `SNAP_CLIENT_ID:SNAP_CLIENT_SECRET` + PKCE. Conservé pour les anciens
 *     APK qui n'envoient pas `client_type`. Si Snap refuse l'authentification
 *     du client (invalid_client / unauthorized_client), la fonction retente
 *     une fois en public : Snap vérifie le client AVANT le code, le code n'est
 *     donc pas consommé par le premier essai.
 *
 * Journalisation : codes courts uniquement. Jamais de code, de verifier, de
 * jeton ni de secret.
 */

export const SNAP_TOKEN_URL = 'https://accounts.snapchat.com/accounts/oauth2/token';

export type SnapClientType = 'public' | 'confidential';

export type SnapExchangeRequest = {
  code: string;
  codeVerifier: string;
  redirectUri: string;
  clientType: SnapClientType;
  /** Fourni par l'app en mode public ; null en mode historique. */
  clientId: string | null;
};

export type ParseResult =
  | { ok: true; value: SnapExchangeRequest }
  | { ok: false; status: number; error: string };

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** Lit le corps JSON envoyé par l'app. */
export function parseExchangeRequest(body: unknown): ParseResult {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const code = str(b.code);
  const codeVerifier = str(b.code_verifier);
  const redirectUri = str(b.redirect_uri);
  if (!code || !codeVerifier || !redirectUri) {
    return { ok: false, status: 400, error: 'code, code_verifier et redirect_uri sont requis' };
  }
  const rawType = str(b.client_type);
  if (rawType && rawType !== 'public' && rawType !== 'confidential') {
    return { ok: false, status: 400, error: 'client_type invalide' };
  }
  const clientType: SnapClientType = rawType === 'public' ? 'public' : 'confidential';
  const clientId = str(b.client_id) || null;
  if (clientType === 'public' && !clientId) {
    return { ok: false, status: 400, error: 'client_id requis en mode public' };
  }
  return { ok: true, value: { code, codeVerifier, redirectUri, clientType, clientId } };
}

/**
 * Client IDs publics acceptés : SNAP_CLIENT_ID (le client configuré, public
 * aujourd'hui) + SNAP_PUBLIC_CLIENT_IDS (liste optionnelle, séparée par des
 * virgules, pour ajouter l'ID Production le moment venu sans redéployer).
 */
export function allowedPublicClientIds(configuredId: string, extraCsv: string): string[] {
  const ids = [configuredId, ...extraCsv.split(',')]
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return Array.from(new Set(ids));
}

export type SnapConfig = {
  clientId: string;
  clientSecret: string;
  publicClientIds: string[];
};

export type TokenPlan =
  | {
      ok: true;
      mode: SnapClientType;
      url: string;
      headers: Record<string, string>;
      /** Corps x-www-form-urlencoded. */
      body: string;
    }
  | { ok: false; status: number; error: string };

function encodeBasic(user: string, pass: string): string {
  const raw = `${user}:${pass}`;
  // btoa existe dans Deno et dans Node ≥ 16 / jsdom.
  return btoa(raw);
}

/** Prépare l'appel au token endpoint Snap selon le mode demandé. */
export function planTokenRequest(
  req: SnapExchangeRequest,
  cfg: SnapConfig,
  mode: SnapClientType = req.clientType,
): TokenPlan {
  const clientId = mode === 'public' ? req.clientId || cfg.clientId : cfg.clientId;
  if (!clientId) {
    return { ok: false, status: 503, error: 'SNAP_CLIENT_ID manquant côté Edge Function.' };
  }
  if (mode === 'public' && !cfg.publicClientIds.includes(clientId)) {
    return { ok: false, status: 400, error: 'client_id non autorisé' };
  }
  if (mode === 'confidential' && !cfg.clientSecret) {
    return {
      ok: false,
      status: 503,
      error:
        'Configure Snap Kit + deploy function — SNAP_CLIENT_ID / SNAP_CLIENT_SECRET manquants côté Edge Function.',
    };
  }

  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code: req.code,
    redirect_uri: req.redirectUri,
    client_id: clientId,
    code_verifier: req.codeVerifier,
  });

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  if (mode === 'confidential') {
    headers.Authorization = `Basic ${encodeBasic(clientId, cfg.clientSecret)}`;
  }

  return { ok: true, mode, url: SNAP_TOKEN_URL, headers, body: form.toString() };
}

/**
 * Faut-il retenter en public après un refus en mode historique ?
 * Uniquement sur un refus d'authentification du client, jamais sur
 * invalid_grant (code expiré ou déjà utilisé).
 */
export function shouldRetryAsPublic(
  mode: SnapClientType,
  status: number,
  errorCode: string | undefined,
  configuredIdIsPublic: boolean,
): boolean {
  if (mode !== 'confidential' || !configuredIdIsPublic) return false;
  if (status !== 400 && status !== 401) return false;
  return errorCode === 'invalid_client' || errorCode === 'unauthorized_client';
}
