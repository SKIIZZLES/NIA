/**
 * Jeton LiveKit via l'Edge Function `live-token` (sprint L1).
 *
 * Le secret LiveKit n'existe que côté serveur : l'app ne reçoit qu'un jeton
 * court (10 min) et l'URL wss:// du serveur. Rien de LiveKit dans EXPO_PUBLIC_*.
 */
import { getSupabase } from '@/lib/supabase';

export type LiveTokenRole = 'publisher' | 'viewer';

export type LiveTokenErrorCode =
  | 'auth'
  | 'forbidden'
  | 'not_found'
  | 'not_active'
  | 'not_configured'
  | 'network'
  | 'server'
  | 'bad_response';

export type LiveTokenResult = {
  token: string;
  url: string;
  room: string;
  role: LiveTokenRole;
};

export class LiveTokenError extends Error {
  readonly code: LiveTokenErrorCode;
  readonly status?: number;
  constructor(code: LiveTokenErrorCode, status?: number) {
    super(`live-token: ${code}${status ? ` (${status})` : ''}`);
    this.name = 'LiveTokenError';
    this.code = code;
    this.status = status;
  }
}

/** Traduit un statut HTTP (et le code d'erreur renvoyé) en code applicatif. */
export function mapLiveTokenFailure(
  status: number | undefined,
  errorCode?: string | null,
): LiveTokenErrorCode {
  if (status === undefined || status === 0) return 'network';
  if (status === 401) return 'auth';
  if (status === 403) return 'forbidden';
  if (status === 404) {
    // 404 sans code = fonction pas (encore) déployée.
    return errorCode === 'not_found' ? 'not_found' : 'not_configured';
  }
  if (status === 409) return 'not_active';
  if (status === 503) return 'not_configured';
  return 'server';
}

/** Valide la réponse 200 de la fonction. */
export function parseLiveTokenResponse(data: unknown): LiveTokenResult {
  if (!data || typeof data !== 'object') throw new LiveTokenError('bad_response');
  const d = data as Record<string, unknown>;
  const token = typeof d.token === 'string' ? d.token : '';
  const url = typeof d.url === 'string' ? d.url.trim() : '';
  const room = typeof d.room === 'string' ? d.room : '';
  const role = d.role === 'publisher' || d.role === 'viewer' ? d.role : null;
  if (token.split('.').length !== 3 || !/^wss?:\/\/\S+$/i.test(url) || !room || !role) {
    throw new LiveTokenError('bad_response');
  }
  return { token, url, room, role };
}

type InvokeError = {
  name?: string;
  context?: { status?: number; json?: () => Promise<unknown> };
};

async function readErrorCode(err: InvokeError): Promise<string | null> {
  try {
    const body = await err.context?.json?.();
    if (body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string') {
      return (body as { error: string }).error;
    }
  } catch {
    // corps absent ou non JSON
  }
  return null;
}

/** Demande un jeton pour `liveId` ; lève LiveTokenError en cas d'échec. */
export async function fetchLiveToken(
  liveId: string,
  role: LiveTokenRole,
): Promise<LiveTokenResult> {
  const sb = getSupabase();
  if (!sb) throw new LiveTokenError('not_configured');
  const { data: sessionData } = await sb.auth.getSession();
  if (!sessionData.session) throw new LiveTokenError('auth', 401);

  let res: { data: unknown; error: unknown };
  try {
    res = await sb.functions.invoke('live-token', {
      body: { live_id: liveId, role },
    });
  } catch {
    throw new LiveTokenError('network');
  }
  if (res.error) {
    const err = res.error as InvokeError;
    if (err.name === 'FunctionsFetchError') throw new LiveTokenError('network');
    const status = err.context?.status;
    const code = await readErrorCode(err);
    throw new LiveTokenError(mapLiveTokenFailure(status ?? 500, code), status);
  }
  return parseLiveTokenResponse(res.data);
}

/** Clé i18n du message d'erreur à afficher. */
export function liveTokenErrorKey(code: LiveTokenErrorCode): string {
  switch (code) {
    case 'auth':
      return 'live.rtc.errAuth';
    case 'forbidden':
      return 'live.rtc.errForbidden';
    case 'not_found':
      return 'live.rtc.errNotFound';
    case 'not_active':
      return 'live.rtc.errNotActive';
    case 'not_configured':
      return 'live.rtc.errNotConfigured';
    case 'network':
      return 'live.rtc.errNetwork';
    default:
      return 'live.rtc.errServer';
  }
}
