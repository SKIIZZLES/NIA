/**
 * @jest-environment node
 *
 * Logique pure de l'Edge Function livekit-webhook
 * (supabase/functions/livekit-webhook/core.ts) : signature des webhooks
 * LiveKit et correspondance événement → RPC live_webhook_apply (019).
 */
import {
  CLOCK_TOLERANCE_SECONDS,
  HOST_GRACE_SECONDS,
  MAX_LIVE_SECONDS,
  ROOM_PREFIX,
  base64Encode,
  base64UrlDecode,
  bodySha256Base64,
  countViewers,
  liveIdFromRoom,
  mapWebhookEvent,
  parseWebhookEvent,
  shouldCloseRoom,
  tokenFromHeader,
  verifyWebhook,
  type SubtleLike,
} from '../../supabase/functions/livekit-webhook/core';

// Pas de @types/node dans le dépôt : module crypto de Node typé à la main.
type NodeCrypto = {
  createHash(alg: 'sha256'): { update(d: string): { digest(): Uint8Array } };
  createHmac(alg: 'sha256', key: string): { update(d: string): { digest(): Uint8Array } };
  webcrypto: { subtle: unknown };
};
const nodeCrypto = jest.requireActual('crypto') as NodeCrypto;
const subtle = nodeCrypto.webcrypto.subtle as SubtleLike;
const enc = (s: string) => new TextEncoder().encode(s);

// Valeurs de test (fictives), jamais les vraies clés.
const KEY = 'APItestkey123';
const SECRET = 'test-secret-0123456789abcdef0123456789abcdef';
const HOST = '11111111-1111-4111-8111-111111111111';
const VIEWER = '22222222-2222-4222-8222-222222222222';
const LIVE_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const ROOM = `nia-live-${LIVE_ID}`;
const NOW = 1_790_000_000;

const b64url = (data: Uint8Array | string) =>
  base64Encode(typeof data === 'string' ? enc(data) : data)
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

function sign(
  claims: Record<string, unknown>,
  opts: { secret?: string; alg?: string } = {},
): string {
  const h = b64url(JSON.stringify({ alg: opts.alg ?? 'HS256', typ: 'JWT' }));
  const p = b64url(JSON.stringify(claims));
  const s = b64url(nodeCrypto.createHmac('sha256', opts.secret ?? SECRET).update(`${h}.${p}`).digest());
  return `${h}.${p}.${s}`;
}

const sha = (body: string) => base64Encode(nodeCrypto.createHash('sha256').update(body).digest());

function event(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    event: 'participant_joined',
    id: 'EV_1',
    createdAt: String(NOW),
    room: { sid: 'RM_1', name: ROOM },
    participant: { sid: 'PA_1', identity: HOST },
    ...over,
  });
}

function signed(body: string, over: Record<string, unknown> = {}, opts?: { secret?: string; alg?: string }) {
  return sign({ iss: KEY, exp: NOW + 600, nbf: NOW - 5, sha256: sha(body), ...over }, opts);
}

const verify = (body: string, authorization: string | null, nowSeconds = NOW) =>
  verifyWebhook({ body, authorization, apiKey: KEY, apiSecret: SECRET, subtle, nowSeconds });

describe('base64', () => {
  it('encode les vecteurs RFC 4648 (0, 1, 2 octets de reste) et l’UTF-8', () => {
    const cases: [string, string][] = [
      ['', ''],
      ['f', 'Zg=='],
      ['fo', 'Zm8='],
      ['foo', 'Zm9v'],
      ['foob', 'Zm9vYg=='],
      ['fooba', 'Zm9vYmE='],
      ['foobar', 'Zm9vYmFy'],
      ['é', 'w6k='],
    ];
    for (const [plain, b64] of cases) expect(base64Encode(enc(plain))).toBe(b64);
    expect(base64Encode(new Uint8Array([251, 255]))).toBe('+/8=');
  });
  it('décode le base64url des JWT et refuse les caractères invalides', () => {
    const bytes = new Uint8Array([251, 255, 0, 1, 2, 62, 63]);
    expect(Array.from(base64UrlDecode(b64url(bytes)) ?? [])).toEqual(Array.from(bytes));
    expect(base64UrlDecode('a+b/')).toBeNull();
    expect(base64UrlDecode('abcde')).toBeNull();
  });
  it('bodySha256Base64 = SHA-256 base64 du corps brut', async () => {
    const body = event();
    expect(await bodySha256Base64(body, subtle)).toBe(sha(body));
  });
});

describe('verifyWebhook — signature LiveKit', () => {
  it('accepte un webhook correctement signé', async () => {
    const body = event();
    expect(await verify(body, signed(body))).toEqual({ ok: true });
  });

  it('accepte un jeton produit par livekit-server-sdk 2.19.1 (AccessToken + sha256)', async () => {
    // Généré une fois avec le SDK officiel (clé / secret de test ci-dessus) ;
    // WebhookReceiver du SDK accepte le même couple corps / jeton.
    const body =
      '{"event":"participant_joined","id":"EV_fixture","createdAt":"1790000000","room":{"sid":"RM_x","name":"nia-live-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee","numParticipants":2},"participant":{"sid":"PA_x","identity":"11111111-1111-4111-8111-111111111111","state":"ACTIVE"}}';
    const token =
      'eyJhbGciOiJIUzI1NiJ9.eyJzaGEyNTYiOiJKWWlzQ0lobmd3Vmc5ZHd3cHlsL3lMVWE3SVp2RHpKb2dmRFBhUGxSKzNRPSIsImlzcyI6IkFQSXRlc3RrZXkxMjMiLCJleHAiOjE3OTA3NTg0NzEsIm5iZiI6MTc5MDc1Nzg3MX0.gV1QrTRtKK5jDyl1kYZkGVVvAv-X15LrE-1a83Vw3Vg';
    expect(await verify(body, token, 1_790_757_900)).toEqual({ ok: true });
    expect(await verify(body.replace('EV_fixture', 'EV_fixturX'), token, 1_790_757_900)).toEqual({
      ok: false,
      reason: 'body_hash_mismatch',
    });
  });

  it('accepte aussi « Bearer <jwt> »', async () => {
    const body = event();
    expect(await verify(body, `Bearer ${signed(body)}`)).toEqual({ ok: true });
  });

  it('refuse un en-tête absent ou mal formé', async () => {
    const body = event();
    expect(await verify(body, null)).toEqual({ ok: false, reason: 'missing_header' });
    expect(await verify(body, 'abc')).toEqual({ ok: false, reason: 'malformed_token' });
    expect(await verify(body, 'a.b.c')).toEqual({ ok: false, reason: 'malformed_token' });
  });

  it('refuse un jeton signé avec un autre secret', async () => {
    const body = event();
    expect(await verify(body, signed(body, {}, { secret: 'another-secret-0123456789abcdef0123' }))).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('refuse un jeton modifié après signature (claims réécrits)', async () => {
    const body = event();
    const [h, , s] = signed(body).split('.');
    const forged = b64url(JSON.stringify({ iss: KEY, exp: NOW + 99999, sha256: sha(body) }));
    expect(await verify(body, `${h}.${forged}.${s}`)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('refuse alg ≠ HS256 (dont « none »)', async () => {
    const body = event();
    expect(await verify(body, signed(body, {}, { alg: 'none' }))).toEqual({ ok: false, reason: 'bad_algorithm' });
    expect(await verify(body, signed(body, {}, { alg: 'HS512' }))).toEqual({ ok: false, reason: 'bad_algorithm' });
  });

  it('refuse un autre émetteur (clé API)', async () => {
    const body = event();
    expect(await verify(body, signed(body, { iss: 'APIother' }))).toEqual({ ok: false, reason: 'bad_issuer' });
  });

  it('exige exp, respecte exp / nbf avec 10 s de tolérance', async () => {
    const body = event();
    expect(CLOCK_TOLERANCE_SECONDS).toBe(10);
    expect(await verify(body, signed(body, { exp: undefined }))).toEqual({ ok: false, reason: 'missing_exp' });
    expect(await verify(body, signed(body, { exp: NOW - 11 }))).toEqual({ ok: false, reason: 'expired' });
    expect(await verify(body, signed(body, { exp: NOW - 9 }))).toEqual({ ok: true });
    expect(await verify(body, signed(body, { nbf: NOW + 11 }))).toEqual({ ok: false, reason: 'not_yet_valid' });
    expect(await verify(body, signed(body, { nbf: NOW + 9 }))).toEqual({ ok: true });
  });

  it('refuse un corps différent de celui signé (sha256)', async () => {
    const body = event();
    const other = event({ event: 'room_finished' });
    expect(await verify(other, signed(body))).toEqual({ ok: false, reason: 'body_hash_mismatch' });
    expect(await verify(body, signed(body, { sha256: undefined }))).toEqual({ ok: false, reason: 'body_hash_mismatch' });
  });

  it('tokenFromHeader', () => {
    expect(tokenFromHeader('x.y.z')).toBe('x.y.z');
    expect(tokenFromHeader('  Bearer x.y.z ')).toBe('x.y.z');
    expect(tokenFromHeader('Basic abc')).toBeNull();
    expect(tokenFromHeader(undefined)).toBeNull();
  });
});

describe('parseWebhookEvent', () => {
  it('lit event, id, createdAt (chaîne int64), room et participant', () => {
    expect(parseWebhookEvent(event())).toEqual({
      event: 'participant_joined',
      id: 'EV_1',
      createdAt: NOW,
      roomName: ROOM,
      participantIdentity: HOST,
    });
  });
  it('accepte createdAt numérique ou absent', () => {
    expect(parseWebhookEvent(event({ createdAt: NOW }))?.createdAt).toBe(NOW);
    expect(parseWebhookEvent(event({ createdAt: undefined }))?.createdAt).toBeNull();
    expect(parseWebhookEvent(event({ createdAt: 'x' }))?.createdAt).toBeNull();
  });
  it('refuse le JSON invalide ou sans event', () => {
    expect(parseWebhookEvent('{')).toBeNull();
    expect(parseWebhookEvent('[]')).toBeNull();
    expect(parseWebhookEvent('{"room":{}}')).toBeNull();
  });
});

describe('liveIdFromRoom', () => {
  it('nia-live-<uuid> → uuid en minuscules', () => {
    expect(ROOM_PREFIX).toBe('nia-live-');
    expect(liveIdFromRoom(ROOM)).toBe(LIVE_ID);
    expect(liveIdFromRoom(`nia-live-${LIVE_ID.toUpperCase()}`)).toBe(LIVE_ID);
  });
  it('autres rooms → null (ignorées)', () => {
    expect(liveIdFromRoom('demo-room')).toBeNull();
    expect(liveIdFromRoom('nia-live-123')).toBeNull();
    expect(liveIdFromRoom(`x-nia-live-${LIVE_ID}`)).toBeNull();
    expect(liveIdFromRoom(null)).toBeNull();
  });
});

describe('mapWebhookEvent', () => {
  const ev = (over: Record<string, unknown>) => parseWebhookEvent(event(over))!;

  it('participant_joined → apply + recomptage', () => {
    expect(mapWebhookEvent(ev({}))).toEqual({
      kind: 'apply',
      liveId: LIVE_ID,
      room: ROOM,
      event: 'participant_joined',
      participant: HOST,
      eventAtIso: new Date(NOW * 1000).toISOString(),
      countViewers: true,
      leavingIdentity: null,
    });
  });

  it('participant_left / connection_aborted : recomptage sans le partant', () => {
    for (const name of ['participant_left', 'participant_connection_aborted']) {
      const a = mapWebhookEvent(ev({ event: name, participant: { identity: VIEWER.toUpperCase() } }));
      expect(a).toMatchObject({ kind: 'apply', event: name, countViewers: true, leavingIdentity: VIEWER, participant: VIEWER });
    }
  });

  it('room_started / room_finished / track_published : pas de recomptage', () => {
    for (const name of ['room_started', 'room_finished', 'track_published']) {
      expect(mapWebhookEvent(ev({ event: name }))).toMatchObject({ kind: 'apply', event: name, countViewers: false });
    }
  });

  it('room_finished sans participant', () => {
    expect(mapWebhookEvent(ev({ event: 'room_finished', participant: undefined }))).toMatchObject({ participant: null });
  });

  it('événements non gérés → ignore', () => {
    for (const name of ['egress_started', 'ingress_ended', 'track_unpublished', 'whatever']) {
      expect(mapWebhookEvent(ev({ event: name }))).toEqual({ kind: 'ignore', reason: 'unhandled_event' });
    }
  });

  it('room inconnue → ignore', () => {
    expect(mapWebhookEvent(ev({ room: { name: 'other-app-room' } }))).toEqual({ kind: 'ignore', reason: 'unknown_room' });
    expect(mapWebhookEvent(ev({ room: undefined }))).toEqual({ kind: 'ignore', reason: 'unknown_room' });
  });
});

describe('countViewers', () => {
  it('exclut l’hôte, le partant, les doublons et les participants techniques', () => {
    expect(
      countViewers(
        [
          { identity: HOST, kind: 0 },
          { identity: VIEWER, kind: 0 },
          { identity: VIEWER.toUpperCase(), kind: 0 },
          { identity: '33333333-3333-4333-8333-333333333333' },
          { identity: 'EG_recorder', kind: 2 },
          { identity: 'agent', kind: 'AGENT' },
          { identity: '' },
        ],
        HOST.toUpperCase(),
      ),
    ).toBe(2);
    expect(countViewers([{ identity: HOST }, { identity: VIEWER }], HOST, VIEWER)).toBe(0);
    expect(countViewers([], HOST)).toBe(0);
  });
});

describe('réglages', () => {
  it('délai de grâce 2 min, durée max 4 h, fermeture après Terminer', () => {
    expect(HOST_GRACE_SECONDS).toBe(120);
    expect(MAX_LIVE_SECONDS).toBe(4 * 3600);
    expect(shouldCloseRoom('finished_host_left')).toBe(true);
    for (const c of ['ended', 'went_live', 'host_left', 'noop', null, undefined]) {
      expect(shouldCloseRoom(c)).toBe(false);
    }
  });
});
