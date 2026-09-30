/**
 * Logique pure de l'Edge Function live-token (sprint L1).
 *
 * Aucune API Deno, aucun import réseau : ce module est importé par index.ts
 * (Deno, Edge Function) ET par les tests Jest (__tests__/supabase/liveToken.test.ts).
 *
 * Qui obtient quoi :
 *   - publisher : uniquement le créateur de la ligne live_streams
 *     (live.user_id === uid), live « scheduled » ou « live ».
 *   - viewer    : n'importe quel utilisateur connecté qui VOIT la ligne sous
 *     la RLS existante (la ligne est lue avec le JWT de l'appelant, jamais en
 *     service_role), live « scheduled » ou « live ». Abonnement seul : pas de
 *     publication de pistes ni de données.
 *
 * L1 : la migration 017 n'est pas appliquée, donc personne ne peut passer un
 * live en `status='live'` côté serveur de façon sûre. On accepte donc un
 * jeton spectateur dès que le live existe, est visible et n'est ni terminé ni
 * annulé. L2 (017) resserrera : spectateur seulement si `status='live'`, pas
 * exclu (live_bans), pas bloqué par l'hôte.
 *
 * Journalisation : codes courts uniquement. Jamais de jeton, de JWT, d'e-mail.
 */

/** Durée de vie des jetons LiveKit : 10 minutes (connexion initiale). */
export const TOKEN_TTL_SECONDS = 600;

/** Préfixe des rooms LiveKit ; le nom complet est dérivé de l'id du live. */
export const ROOM_PREFIX = 'nia-live-';

export type LiveTokenRole = 'publisher' | 'viewer';

export type LiveStatus = 'scheduled' | 'live' | 'ended' | 'cancelled';

/** Sous-ensemble de public.live_streams (010) lu par la fonction. */
export type LiveRowLite = {
  id: string;
  user_id: string;
  status: string;
  visibility?: string | null;
};

/** Sources publiables (chaînes du claim JWT LiveKit). */
export type PublishSource = 'camera' | 'microphone';

/** Grant vidéo LiveKit, en données pures (converti en VideoGrant dans index.ts). */
export type LiveGrant = {
  room: string;
  roomJoin: true;
  canSubscribe: true;
  canPublish: boolean;
  canPublishData: boolean;
  canPublishSources: PublishSource[];
  canUpdateOwnMetadata: false;
};

export type TokenRequest = { liveId: string; role: LiveTokenRole };

export type ErrorCode =
  | 'bad_request'
  | 'unauthorized'
  | 'not_found'
  | 'not_owner'
  | 'live_not_active'
  | 'not_configured'
  | 'db_error'
  | 'method_not_allowed';

export type Denied = { ok: false; status: number; error: ErrorCode };

export type Granted = {
  ok: true;
  role: LiveTokenRole;
  room: string;
  identity: string;
  ttlSeconds: number;
  grant: LiveGrant;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Statuts pour lesquels un jeton peut être délivré en L1. */
const ACTIVE_STATUSES: readonly string[] = ['scheduled', 'live'];

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/** Nom de room déterministe : `nia-live-<uuid en minuscules>`. */
export function roomNameForLive(liveId: string): string {
  if (!isUuid(liveId)) throw new Error('invalid_live_id');
  return `${ROOM_PREFIX}${liveId.toLowerCase()}`;
}

function deny(status: number, error: ErrorCode): Denied {
  return { ok: false, status, error };
}

/**
 * Valide le corps JSON `{ live_id, role }`.
 * `role` accepte aussi l'alias `host` (= publisher), pour le plan d'archi.
 */
export function parseTokenRequest(body: unknown): TokenRequest | Denied {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return deny(400, 'bad_request');
  }
  const raw = body as Record<string, unknown>;
  const liveId = raw.live_id;
  const roleRaw = raw.role;
  if (!isUuid(liveId)) return deny(400, 'bad_request');
  let role: LiveTokenRole;
  if (roleRaw === 'publisher' || roleRaw === 'host') role = 'publisher';
  else if (roleRaw === 'viewer') role = 'viewer';
  else return deny(400, 'bad_request');
  return { liveId: liveId.toLowerCase(), role };
}

export function isDenied(value: unknown): value is Denied {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as { ok?: unknown }).ok === false
  );
}

/** Extrait le JWT d'un en-tête `Authorization: Bearer <jwt>`. */
export function bearerToken(header: string | null | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(\S+)$/i.exec(header.trim());
  if (!m) return null;
  const token = m[1];
  // Un JWT a trois segments ; on refuse tout le reste avant d'appeler Auth.
  if (token.split('.').length !== 3) return null;
  return token;
}

export function buildGrant(role: LiveTokenRole, room: string): LiveGrant {
  if (role === 'publisher') {
    return {
      room,
      roomJoin: true,
      canSubscribe: true,
      canPublish: true,
      // Réservé aux événements de l'hôte (L3/L4 : chat, masquage).
      canPublishData: true,
      canPublishSources: ['camera', 'microphone'],
      canUpdateOwnMetadata: false,
    };
  }
  return {
    room,
    roomJoin: true,
    canSubscribe: true,
    canPublish: false,
    canPublishData: false,
    canPublishSources: [],
    canUpdateOwnMetadata: false,
  };
}

/**
 * Décision d'accès.
 *
 * `live` est la ligne lue AVEC LE JWT DE L'APPELANT : `null` signifie
 * « inexistante OU invisible sous la RLS ». On ne distingue pas les deux
 * (404 dans les deux cas), pour ne pas révéler l'existence d'un live privé.
 */
export function decideGrant(input: {
  userId: string;
  role: LiveTokenRole;
  liveId: string;
  live: LiveRowLite | null;
}): Granted | Denied {
  const { userId, role, liveId, live } = input;
  if (!isUuid(userId)) return deny(401, 'unauthorized');
  if (!isUuid(liveId)) return deny(400, 'bad_request');
  if (!live || typeof live.id !== 'string' || live.id.toLowerCase() !== liveId.toLowerCase()) {
    return deny(404, 'not_found');
  }

  const isOwner =
    typeof live.user_id === 'string' && live.user_id.toLowerCase() === userId.toLowerCase();

  if (role === 'publisher' && !isOwner) return deny(403, 'not_owner');
  if (!ACTIVE_STATUSES.includes(live.status)) return deny(409, 'live_not_active');

  const room = roomNameForLive(liveId);
  return {
    ok: true,
    role,
    room,
    identity: userId.toLowerCase(),
    ttlSeconds: TOKEN_TTL_SECONDS,
    grant: buildGrant(role, room),
  };
}

/** Convertit l'URL LiveKit (wss://…) en URL HTTP pour l'API serveur. */
export function livekitHttpUrl(wsUrl: string): string {
  return wsUrl.trim().replace(/^wss:\/\//i, 'https://').replace(/^ws:\/\//i, 'http://');
}

/** Vérifie la configuration LiveKit sans jamais renvoyer les valeurs. */
export function isLivekitConfigured(env: {
  key?: string | null;
  secret?: string | null;
  url?: string | null;
}): boolean {
  const key = (env.key ?? '').trim();
  const secret = (env.secret ?? '').trim();
  const url = (env.url ?? '').trim();
  return key.length > 0 && secret.length >= 32 && /^wss?:\/\/[^\s/]+/i.test(url);
}
