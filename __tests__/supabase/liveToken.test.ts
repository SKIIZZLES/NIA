/**
 * Logique d'attribution des jetons LiveKit (supabase/functions/live-token/core.ts).
 *
 * `live` simule la ligne lue AVEC le JWT de l'appelant : `null` = inexistante
 * ou invisible sous la RLS.
 */
import {
  HOST_ROOM_SETTINGS,
  ROOM_PREFIX,
  TOKEN_TTL_SECONDS,
  bearerToken,
  buildGrant,
  decideGrant,
  isDenied,
  isLivekitConfigured,
  livekitHttpUrl,
  parseTokenRequest,
  pickPublicApiKey,
  roomNameForLive,
  type LiveRowLite,
} from '../../supabase/functions/live-token/core';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const LIVE_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

function row(over: Partial<LiveRowLite> = {}): LiveRowLite {
  return { id: LIVE_ID, user_id: OWNER, status: 'scheduled', visibility: 'public', ...over };
}

describe('parseTokenRequest', () => {
  it('accepte publisher, viewer et l’alias host', () => {
    expect(parseTokenRequest({ live_id: LIVE_ID, role: 'publisher' })).toEqual({ liveId: LIVE_ID, role: 'publisher' });
    expect(parseTokenRequest({ live_id: LIVE_ID, role: 'host' })).toEqual({ liveId: LIVE_ID, role: 'publisher' });
    expect(parseTokenRequest({ live_id: LIVE_ID, role: 'viewer' })).toEqual({ liveId: LIVE_ID, role: 'viewer' });
  });

  it('normalise l’id en minuscules', () => {
    const r = parseTokenRequest({ live_id: LIVE_ID.toUpperCase(), role: 'viewer' });
    expect(r).toEqual({ liveId: LIVE_ID, role: 'viewer' });
  });

  it.each([
    null,
    'x',
    [],
    {},
    { live_id: LIVE_ID },
    { live_id: LIVE_ID, role: 'admin' },
    { live_id: 'not-a-uuid', role: 'viewer' },
    { live_id: `${LIVE_ID}' or 1=1`, role: 'viewer' },
    { live_id: 42, role: 'viewer' },
  ])('refuse %p → 400', (body) => {
    const r = parseTokenRequest(body);
    expect(isDenied(r)).toBe(true);
    expect(r).toEqual({ ok: false, status: 400, error: 'bad_request' });
  });
});

describe('bearerToken', () => {
  it('extrait un JWT à trois segments', () => {
    expect(bearerToken('Bearer a.b.c')).toBe('a.b.c');
    expect(bearerToken('bearer  a.b.c ')).toBe('a.b.c');
  });
  it.each([null, undefined, '', 'a.b.c', 'Bearer ', 'Bearer abc', 'Basic a.b.c', 'Bearer sb_publishable_x'])(
    'refuse %p',
    (h) => {
      expect(bearerToken(h as string | null | undefined)).toBeNull();
    },
  );
});

describe('roomNameForLive', () => {
  it('dérive la room de l’id du live', () => {
    expect(roomNameForLive(LIVE_ID)).toBe(`${ROOM_PREFIX}${LIVE_ID}`);
    expect(roomNameForLive(LIVE_ID.toUpperCase())).toBe(`nia-live-${LIVE_ID}`);
  });
  it('refuse un id invalide', () => {
    expect(() => roomNameForLive('../x')).toThrow('invalid_live_id');
  });
});

describe('decideGrant — publisher', () => {
  it('créateur, live programmé → jeton caméra + micro, 10 min', () => {
    const d = decideGrant({ userId: OWNER, role: 'publisher', liveId: LIVE_ID, live: row() });
    expect(d).toEqual({
      ok: true,
      role: 'publisher',
      room: `nia-live-${LIVE_ID}`,
      identity: OWNER,
      ttlSeconds: 600,
      grant: {
        room: `nia-live-${LIVE_ID}`,
        roomJoin: true,
        canSubscribe: true,
        canPublish: true,
        canPublishData: true,
        canPublishSources: ['camera', 'microphone'],
        canUpdateOwnMetadata: false,
      },
    });
    expect(TOKEN_TTL_SECONDS).toBe(600);
  });

  it('créateur, live déjà « live » → accepté', () => {
    const d = decideGrant({ userId: OWNER, role: 'publisher', liveId: LIVE_ID, live: row({ status: 'live' }) });
    expect(d.ok).toBe(true);
  });

  it('un autre utilisateur, même si le live est visible (public) → 403 not_owner', () => {
    const d = decideGrant({ userId: OTHER, role: 'publisher', liveId: LIVE_ID, live: row() });
    expect(d).toEqual({ ok: false, status: 403, error: 'not_owner' });
  });

  it('comparaison des UUID insensible à la casse', () => {
    const d = decideGrant({
      userId: OWNER.toUpperCase(),
      role: 'publisher',
      liveId: LIVE_ID,
      live: row(),
    });
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.identity).toBe(OWNER);
  });

  it.each(['ended', 'cancelled', 'weird'])('live « %s » → 409 live_not_active', (status) => {
    const d = decideGrant({ userId: OWNER, role: 'publisher', liveId: LIVE_ID, live: row({ status }) });
    expect(d).toEqual({ ok: false, status: 409, error: 'live_not_active' });
  });

  it.each(['held', 'removed'])('L2 : live « %s » par la modération → 403 live_held', (moderation_state) => {
    const d = decideGrant({ userId: OWNER, role: 'publisher', liveId: LIVE_ID, live: row({ moderation_state }) });
    expect(d).toEqual({ ok: false, status: 403, error: 'live_held' });
  });

  it('L2 : moderation_state absent ou visible → accepté', () => {
    expect(decideGrant({ userId: OWNER, role: 'publisher', liveId: LIVE_ID, live: row({ moderation_state: 'visible' }) }).ok).toBe(true);
    expect(decideGrant({ userId: OWNER, role: 'publisher', liveId: LIVE_ID, live: row({ moderation_state: null }) }).ok).toBe(true);
  });

  it('L2 : réglages de la room (fermeture 2 min, 60 participants max)', () => {
    expect(HOST_ROOM_SETTINGS).toEqual({ emptyTimeout: 120, departureTimeout: 120, maxParticipants: 60 });
  });

  it('non-propriétaire sur un live terminé → 403 (le rôle est vérifié avant le statut)', () => {
    const d = decideGrant({ userId: OTHER, role: 'publisher', liveId: LIVE_ID, live: row({ status: 'ended' }) });
    expect(d).toEqual({ ok: false, status: 403, error: 'not_owner' });
  });
});

describe('decideGrant — viewer', () => {
  it('live « live » visible → abonnement seul', () => {
    const d = decideGrant({ userId: OTHER, role: 'viewer', liveId: LIVE_ID, live: row({ status: 'live' }) });
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.identity).toBe(OTHER);
    expect(d.grant).toEqual({
      room: `nia-live-${LIVE_ID}`,
      roomJoin: true,
      canSubscribe: true,
      canPublish: false,
      canPublishData: false,
      canPublishSources: [],
      canUpdateOwnMetadata: false,
    });
  });

  it('live « live » → accepté', () => {
    expect(decideGrant({ userId: OTHER, role: 'viewer', liveId: LIVE_ID, live: row({ status: 'live' }) }).ok).toBe(true);
  });

  it('ligne invisible sous la RLS (ou inexistante) → 404, sans distinguer', () => {
    expect(decideGrant({ userId: OTHER, role: 'viewer', liveId: LIVE_ID, live: null })).toEqual({
      ok: false,
      status: 404,
      error: 'not_found',
    });
    expect(decideGrant({ userId: OTHER, role: 'publisher', liveId: LIVE_ID, live: null })).toEqual({
      ok: false,
      status: 404,
      error: 'not_found',
    });
  });

  it('ligne d’un autre live renvoyée par erreur → 404', () => {
    const d = decideGrant({
      userId: OTHER,
      role: 'viewer',
      liveId: LIVE_ID,
      live: row({ id: '33333333-3333-4333-8333-333333333333' }),
    });
    expect(d).toEqual({ ok: false, status: 404, error: 'not_found' });
  });

  it.each(['ended', 'cancelled'])('live « %s » → 409', (status) => {
    const d = decideGrant({ userId: OTHER, role: 'viewer', liveId: LIVE_ID, live: row({ status }) });
    expect(d).toEqual({ ok: false, status: 409, error: 'live_not_active' });
  });

  it('L2 : live encore programmé (hôte pas encore connecté) → 409 live_not_started', () => {
    const d = decideGrant({ userId: OTHER, role: 'viewer', liveId: LIVE_ID, live: row({ status: 'scheduled' }) });
    expect(d).toEqual({ ok: false, status: 409, error: 'live_not_started' });
  });

  it('le créateur peut aussi demander un jeton spectateur', () => {
    const d = decideGrant({ userId: OWNER, role: 'viewer', liveId: LIVE_ID, live: row({ status: 'live' }) });
    expect(d.ok && d.grant.canPublish).toBe(false);
  });
});

describe('decideGrant — entrées invalides', () => {
  it('uid invalide → 401', () => {
    expect(decideGrant({ userId: '', role: 'viewer', liveId: LIVE_ID, live: row() })).toEqual({
      ok: false,
      status: 401,
      error: 'unauthorized',
    });
  });
  it('liveId invalide → 400', () => {
    expect(decideGrant({ userId: OWNER, role: 'viewer', liveId: 'x', live: row() })).toEqual({
      ok: false,
      status: 400,
      error: 'bad_request',
    });
  });
});

describe('buildGrant', () => {
  it('ne donne jamais roomAdmin, roomCreate ni roomList', () => {
    for (const role of ['publisher', 'viewer'] as const) {
      const g = buildGrant(role, 'nia-live-x') as Record<string, unknown>;
      expect(g.roomAdmin).toBeUndefined();
      expect(g.roomCreate).toBeUndefined();
      expect(g.roomList).toBeUndefined();
      expect(g.roomRecord).toBeUndefined();
    }
  });
});

describe('configuration LiveKit', () => {
  it('livekitHttpUrl', () => {
    expect(livekitHttpUrl('wss://nia.livekit.cloud')).toBe('https://nia.livekit.cloud');
    expect(livekitHttpUrl(' ws://localhost:7880 ')).toBe('http://localhost:7880');
  });
  it('isLivekitConfigured', () => {
    const secret = 'x'.repeat(40);
    expect(isLivekitConfigured({ key: 'APIxxx', secret, url: 'wss://nia.livekit.cloud' })).toBe(true);
    expect(isLivekitConfigured({ key: '', secret, url: 'wss://nia.livekit.cloud' })).toBe(false);
    expect(isLivekitConfigured({ key: 'APIxxx', secret: 'short', url: 'wss://nia.livekit.cloud' })).toBe(false);
    expect(isLivekitConfigured({ key: 'APIxxx', secret, url: 'https://nia.livekit.cloud' })).toBe(false);
    expect(isLivekitConfigured({ key: 'APIxxx', secret, url: null })).toBe(false);
  });
});

describe('pickPublicApiKey', () => {
  it('préfère SUPABASE_PUBLISHABLE_KEYS.default', () => {
    expect(
      pickPublicApiKey({
        publishableKeysJson: '{"default":"sb_publishable_srv","other":"sb_publishable_o"}',
        requestApiKey: 'sb_publishable_client',
        anonKey: 'legacy',
      }),
    ).toBe('sb_publishable_srv');
    expect(pickPublicApiKey({ publishableKeysJson: '{"mobile":"sb_publishable_m"}' })).toBe('sb_publishable_m');
  });
  it('sinon l’en-tête apikey, sinon la clé legacy', () => {
    expect(pickPublicApiKey({ publishableKeysJson: 'pas du json', requestApiKey: 'sb_publishable_c', anonKey: 'legacy' })).toBe('sb_publishable_c');
    expect(pickPublicApiKey({ requestApiKey: 'a b', anonKey: 'legacy' })).toBe('legacy');
    expect(pickPublicApiKey({ requestApiKey: '', anonKey: '' })).toBeNull();
  });
});
