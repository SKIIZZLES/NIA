/**
 * Logique pure de l'Edge Function livekit-webhook (sprint L2).
 *
 * Aucune API Deno, aucun import réseau : ce module est importé par index.ts
 * (Deno) ET par les tests Jest (__tests__/supabase/livekitWebhook.test.ts).
 * Seule dépendance : Web Crypto (`crypto.subtle`), disponible dans Deno et
 * dans Node ≥ 18, passée en paramètre pour les tests.
 *
 * 1. Signature : LiveKit envoie `Authorization: <JWT>` signé en HS256 avec le
 *    secret API ; `iss` = clé API ; le claim `sha256` = base64(SHA-256(corps
 *    brut)). Même contrôle que WebhookReceiver de livekit-server-sdk
 *    (jose.jwtVerify, issuer, exp obligatoire, tolérance 10 s).
 * 2. Correspondance : room `nia-live-<uuid>` → live ; les autres rooms sont
 *    ignorées. L'événement devient un appel à la RPC live_webhook_apply (019).
 *
 * Journalisation : codes courts uniquement (jamais de jeton, d'identité).
 */

export const ROOM_PREFIX = 'nia-live-';

/** Délai de grâce après la déconnexion de l'hôte avant la fin automatique. */
export const HOST_GRACE_SECONDS = 120;

/** Durée maximale d'un live (filet de sécurité du quota gratuit). */
export const MAX_LIVE_SECONDS = 4 * 60 * 60;

/** Tolérance d'horloge sur exp / nbf, comme livekit-server-sdk. */
export const CLOCK_TOLERANCE_SECONDS = 10;

/** Corps plus gros refusé (un événement LiveKit fait quelques Ko). */
export const MAX_BODY_BYTES = 64 * 1024;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type HandledEvent =
  | 'room_started'
  | 'room_finished'
  | 'participant_joined'
  | 'participant_left'
  | 'participant_connection_aborted'
  | 'track_published';

const HANDLED: readonly HandledEvent[] = [
  'room_started',
  'room_finished',
  'participant_joined',
  'participant_left',
  'participant_connection_aborted',
  'track_published',
];

// ---------------------------------------------------------------------------
// Base64 (sans Buffer, sans atob : identique dans Deno, Node et Jest)
// ---------------------------------------------------------------------------
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function base64Encode(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + '==';
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + '=';
  }
  return out;
}

/** Décode du base64url (JWT) ; null si invalide. */
export function base64UrlDecode(input: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(input) || input.length % 4 === 1) return null;
  const std = input.replace(/-/g, '+').replace(/_/g, '/');
  const out: number[] = [];
  let buf = 0;
  let bits = 0;
  for (const ch of std) {
    buf = (buf << 6) | B64.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buf >> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function parseJsonObject(bytes: Uint8Array | null): Record<string, unknown> | null {
  if (!bytes) return null;
  try {
    const v = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 1. Vérification de la signature
// ---------------------------------------------------------------------------
export type VerifyFailure =
  | 'missing_header'
  | 'malformed_token'
  | 'bad_algorithm'
  | 'bad_signature'
  | 'bad_issuer'
  | 'expired'
  | 'not_yet_valid'
  | 'missing_exp'
  | 'body_hash_mismatch';

export type VerifyResult = { ok: true } | { ok: false; reason: VerifyFailure };

/** Minimum de Web Crypto utilisé (compatible Deno, Node et navigateurs). */
export type SubtleLike = {
  importKey(
    format: 'raw',
    keyData: Uint8Array,
    algorithm: { name: 'HMAC'; hash: 'SHA-256' },
    extractable: boolean,
    keyUsages: ['verify'],
  ): Promise<unknown>;
  verify(algorithm: 'HMAC', key: unknown, signature: Uint8Array, data: Uint8Array): Promise<boolean>;
  digest(algorithm: 'SHA-256', data: Uint8Array): Promise<ArrayBuffer>;
};

/** `Authorization: <jwt>` (format LiveKit) ou `Authorization: Bearer <jwt>`. */
export function tokenFromHeader(header: string | null | undefined): string | null {
  if (!header) return null;
  const raw = header.trim().replace(/^Bearer\s+/i, '');
  return raw.split('.').length === 3 ? raw : null;
}

/** base64(SHA-256(corps)) : la valeur attendue dans le claim `sha256`. */
export async function bodySha256Base64(body: string, subtle: SubtleLike): Promise<string> {
  const hash = await subtle.digest('SHA-256', utf8(body));
  return base64Encode(new Uint8Array(hash));
}

/**
 * Vérifie un webhook LiveKit : JWT HS256 signé avec le secret API, émis par la
 * clé API, non expiré, et dont le claim `sha256` correspond au corps brut.
 */
export async function verifyWebhook(input: {
  body: string;
  authorization: string | null | undefined;
  apiKey: string;
  apiSecret: string;
  subtle: SubtleLike;
  nowSeconds?: number;
  clockToleranceSeconds?: number;
}): Promise<VerifyResult> {
  const token = tokenFromHeader(input.authorization);
  if (!input.authorization) return { ok: false, reason: 'missing_header' };
  if (!token) return { ok: false, reason: 'malformed_token' };
  const [h, p, s] = token.split('.');
  const header = parseJsonObject(base64UrlDecode(h));
  const claims = parseJsonObject(base64UrlDecode(p));
  const sig = base64UrlDecode(s);
  if (!header || !claims || !sig || sig.length === 0) return { ok: false, reason: 'malformed_token' };
  if (header.alg !== 'HS256') return { ok: false, reason: 'bad_algorithm' };

  const key = await input.subtle.importKey(
    'raw',
    utf8(input.apiSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  // Comparaison en temps constant faite par Web Crypto.
  const valid = await input.subtle.verify('HMAC', key, sig, utf8(`${h}.${p}`));
  if (!valid) return { ok: false, reason: 'bad_signature' };

  if (claims.iss !== input.apiKey) return { ok: false, reason: 'bad_issuer' };
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const tol = input.clockToleranceSeconds ?? CLOCK_TOLERANCE_SECONDS;
  if (typeof claims.exp !== 'number') return { ok: false, reason: 'missing_exp' };
  if (now > claims.exp + tol) return { ok: false, reason: 'expired' };
  if (typeof claims.nbf === 'number' && now < claims.nbf - tol) {
    return { ok: false, reason: 'not_yet_valid' };
  }

  const expected = await bodySha256Base64(input.body, input.subtle);
  if (typeof claims.sha256 !== 'string' || claims.sha256 !== expected) {
    return { ok: false, reason: 'body_hash_mismatch' };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// 2. Événement → action
// ---------------------------------------------------------------------------
export type WebhookEventLite = {
  event: string;
  id: string | null;
  /** createdAt en secondes UNIX (LiveKit l'envoie en chaîne : int64 JSON). */
  createdAt: number | null;
  roomName: string | null;
  participantIdentity: string | null;
};

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function int(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

/** Lit le JSON (protobuf JSON, camelCase) d'un WebhookEvent LiveKit. */
export function parseWebhookEvent(body: string): WebhookEventLite | null {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const event = str(o.event);
  if (!event) return null;
  const room = o.room && typeof o.room === 'object' ? (o.room as Record<string, unknown>) : null;
  const participant =
    o.participant && typeof o.participant === 'object' ? (o.participant as Record<string, unknown>) : null;
  return {
    event,
    id: str(o.id),
    createdAt: int(o.createdAt ?? o.created_at),
    roomName: str(room?.name),
    participantIdentity: str(participant?.identity),
  };
}

/** `nia-live-<uuid>` → uuid en minuscules ; null pour toute autre room. */
export function liveIdFromRoom(roomName: string | null | undefined): string | null {
  if (!roomName || !roomName.startsWith(ROOM_PREFIX)) return null;
  const id = roomName.slice(ROOM_PREFIX.length);
  return UUID_RE.test(id) ? id.toLowerCase() : null;
}

export type WebhookAction =
  | {
      kind: 'apply';
      liveId: string;
      room: string;
      event: HandledEvent;
      participant: string | null;
      eventAtIso: string | null;
      /** Recompter les spectateurs (événements de participants). */
      countViewers: boolean;
      /** Identité à exclure du recomptage (participant qui vient de partir). */
      leavingIdentity: string | null;
    }
  | { kind: 'ignore'; reason: 'unhandled_event' | 'unknown_room' };

export function mapWebhookEvent(ev: WebhookEventLite): WebhookAction {
  if (!(HANDLED as readonly string[]).includes(ev.event)) return { kind: 'ignore', reason: 'unhandled_event' };
  const liveId = liveIdFromRoom(ev.roomName);
  if (!liveId || !ev.roomName) return { kind: 'ignore', reason: 'unknown_room' };
  const event = ev.event as HandledEvent;
  const leaving = event === 'participant_left' || event === 'participant_connection_aborted';
  const participant = ev.participantIdentity ? ev.participantIdentity.toLowerCase() : null;
  return {
    kind: 'apply',
    liveId,
    room: ev.roomName,
    event,
    participant,
    eventAtIso: ev.createdAt ? new Date(ev.createdAt * 1000).toISOString() : null,
    countViewers: event === 'participant_joined' || leaving,
    leavingIdentity: leaving ? participant : null,
  };
}

/** Participant tel que renvoyé par RoomService.listParticipants (sous-ensemble). */
export type ParticipantLite = { identity?: string | null; kind?: number | string | null };

/**
 * Spectateurs = participants « standard » distincts, hors hôte et hors
 * participant qui vient de partir (la liste peut encore le contenir).
 * Les participants techniques (egress, ingress, SIP, agents) ne comptent pas.
 */
export function countViewers(
  participants: readonly ParticipantLite[],
  hostId: string,
  leavingIdentity?: string | null,
): number {
  const host = hostId.toLowerCase();
  const leaving = leavingIdentity ? leavingIdentity.toLowerCase() : null;
  const seen = new Set<string>();
  for (const p of participants) {
    const id = (p.identity ?? '').toLowerCase();
    if (!id || id === host || id === leaving) continue;
    const kind = p.kind ?? 0;
    if (kind !== 0 && kind !== 'STANDARD') continue;
    seen.add(id);
  }
  return seen.size;
}

/** Codes renvoyés par live_webhook_apply (019) après lesquels on ferme la room. */
export function shouldCloseRoom(outcome: string | null | undefined): boolean {
  return outcome === 'finished_host_left';
}
