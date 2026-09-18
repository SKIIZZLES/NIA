/**
 * Snapchat Login Kit via OAuth 2.0 + PKCE (expo-auth-session).
 * Supabase n'a pas de provider Snapchat → Edge Function `snapchat-auth`
 * crée / trouve l'utilisateur et renvoie une session.
 *
 * Voir SNAPCHAT_AUTH.md.
 */
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';

WebBrowser.maybeCompleteAuthSession();

const snapClientId = (process.env.EXPO_PUBLIC_SNAP_CLIENT_ID || '').trim();

const SNAP_AUTH = 'https://accounts.snapchat.com/accounts/oauth2/auth';
const SNAP_TOKEN = 'https://accounts.snapchat.com/accounts/oauth2/token';

/** Scopes Login Kit — display name + external id (+ Bitmoji optionnel). */
export const SNAP_SCOPES = [
  'https://auth.snapchat.com/oauth2/api/user.display_name',
  'https://auth.snapchat.com/oauth2/api/user.external_id',
  'https://auth.snapchat.com/oauth2/api/user.bitmoji.avatar',
];

export const SNAP_DISCOVERY: AuthSession.DiscoveryDocument = {
  authorizationEndpoint: SNAP_AUTH,
  tokenEndpoint: SNAP_TOKEN,
};

export function isSnapchatAuthConfigured(): boolean {
  return snapClientId.length > 0 && !snapClientId.includes('PLACEHOLDER');
}

/**
 * Redirect URI deep-link (scheme `nia` déjà dans app.json).
 * Doit être enregistrée telle quelle sur kit.snapchat.com.
 */
export function getSnapchatRedirectUri(): string {
  return AuthSession.makeRedirectUri({
    scheme: 'nia',
    path: 'snapchat-auth',
  });
}

export type SnapchatOAuthResult = {
  code: string;
  codeVerifier: string;
  redirectUri: string;
};

/**
 * Lance le navigateur OAuth Snapchat (PKCE).
 * Annulation → Error code CANCELLED.
 */
export async function promptSnapchatOAuth(): Promise<SnapchatOAuthResult> {
  if (!isSnapchatAuthConfigured()) {
    throw new Error(
      'Configure Snap Kit + deploy function — EXPO_PUBLIC_SNAP_CLIENT_ID manquant (voir SNAPCHAT_AUTH.md).',
    );
  }

  const redirectUri = getSnapchatRedirectUri();
  const request = new AuthSession.AuthRequest({
    clientId: snapClientId,
    redirectUri,
    scopes: SNAP_SCOPES,
    responseType: AuthSession.ResponseType.Code,
    usePKCE: true,
    extraParams: {},
  });

  await request.makeAuthUrlAsync(SNAP_DISCOVERY);

  const result = await request.promptAsync(SNAP_DISCOVERY, {
    showInRecents: true,
  });

  if (result.type === 'cancel' || result.type === 'dismiss') {
    const cancel = new Error('Connexion Snapchat annulée');
    (cancel as Error & { code?: string }).code = 'CANCELLED';
    throw cancel;
  }

  if (result.type !== 'success') {
    throw new Error(
      `Connexion Snapchat échouée (${result.type}). Vérifiez redirect URI et Client ID.`,
    );
  }

  const code = result.params.code;
  const codeVerifier = request.codeVerifier;
  if (!code || !codeVerifier) {
    throw new Error(
      'Snapchat n’a pas renvoyé de code OAuth. Vérifiez les Redirect URIs sur kit.snapchat.com.',
    );
  }

  return { code, codeVerifier, redirectUri };
}

export type SnapchatSessionTokens = {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  displayName?: string | null;
  avatarUrl?: string | null;
  externalId?: string | null;
};

/**
 * URL de l’Edge Function. Par défaut : {SUPABASE_URL}/functions/v1/snapchat-auth
 */
export function getSnapchatAuthFunctionUrl(): string {
  const override = (process.env.EXPO_PUBLIC_SNAPCHAT_AUTH_URL || '').trim();
  if (override && !override.includes('PLACEHOLDER')) return override;
  const base = (process.env.EXPO_PUBLIC_SUPABASE_URL || '').trim().replace(/\/$/, '');
  if (!base) {
    throw new Error(
      'Configure Snap Kit + deploy function — EXPO_PUBLIC_SUPABASE_URL manquant.',
    );
  }
  return `${base}/functions/v1/snapchat-auth`;
}

/**
 * Échange code OAuth → session Supabase via Edge Function (service role côté serveur).
 */
export async function exchangeSnapchatCodeForSession(
  oauth: SnapchatOAuthResult,
): Promise<SnapchatSessionTokens> {
  const url = getSnapchatAuthFunctionUrl();
  const anon = (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '').trim();

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(anon ? { Authorization: `Bearer ${anon}`, apikey: anon } : {}),
      },
      body: JSON.stringify({
        code: oauth.code,
        code_verifier: oauth.codeVerifier,
        redirect_uri: oauth.redirectUri,
      }),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `Configure Snap Kit + deploy function — impossible d’atteindre ${url} (${msg}).`,
    );
  }

  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    displayName?: string | null;
    avatarUrl?: string | null;
    externalId?: string | null;
  };

  if (!res.ok) {
    const detail = body.error || body.message || `HTTP ${res.status}`;
    if (res.status === 404 || res.status === 503 || /not found|deploy/i.test(detail)) {
      throw new Error(
        `Configure Snap Kit + deploy function — ${detail}. Voir SNAPCHAT_AUTH.md.`,
      );
    }
    throw new Error(detail);
  }

  if (!body.access_token || !body.refresh_token) {
    throw new Error(
      'Configure Snap Kit + deploy function — la fonction n’a pas renvoyé de tokens de session.',
    );
  }

  return {
    access_token: body.access_token,
    refresh_token: body.refresh_token,
    expires_in: body.expires_in,
    displayName: body.displayName ?? null,
    avatarUrl: body.avatarUrl ?? null,
    externalId: body.externalId ?? null,
  };
}

/**
 * Applique les tokens renvoyés par l’Edge Function au client Supabase.
 */
export async function setSupabaseSessionFromSnapchat(
  tokens: SnapchatSessionTokens,
): Promise<void> {
  const sb = getSupabase();
  if (!sb || !isSupabaseConfigured) {
    throw new Error('Supabase non configuré.');
  }
  const { error } = await sb.auth.setSession({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
  });
  if (error) throw error;
}

/** Hint UI : plateforme / config. */
export function snapchatConfigHintKind():
  | 'ok'
  | 'missing_client'
  | 'missing_supabase'
  | 'web_ok' {
  if (!isSnapchatAuthConfigured()) return 'missing_client';
  if (!isSupabaseConfigured && Platform.OS !== 'web') {
    // Expo Go / mock — le bouton fera une session mock
    return 'ok';
  }
  if (!isSupabaseConfigured) return 'missing_supabase';
  return Platform.OS === 'web' ? 'web_ok' : 'ok';
}
