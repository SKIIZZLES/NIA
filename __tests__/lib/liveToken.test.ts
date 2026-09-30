/**
 * Client du jeton LiveKit (lib/liveToken.ts) : correspondance des erreurs
 * HTTP de l'Edge Function live-token et validation de la réponse.
 */
const mockInvoke = jest.fn();
const mockGetSession = jest.fn();

jest.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    auth: { getSession: mockGetSession },
    functions: { invoke: mockInvoke },
  }),
}));

import {
  LiveTokenError,
  fetchLiveToken,
  liveTokenErrorKey,
  mapLiveTokenFailure,
  parseLiveTokenResponse,
} from '@/lib/liveToken';
import fr from '@/locales/fr';

const LIVE_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const OK = { token: 'h.p.s', url: 'wss://nia.livekit.cloud', room: `nia-live-${LIVE_ID}`, role: 'viewer' };

function httpError(status: number, body: unknown) {
  return {
    name: 'FunctionsHttpError',
    context: { status, json: async () => body },
  };
}

beforeEach(() => {
  mockInvoke.mockReset();
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ data: { session: { access_token: 'a.b.c' } } });
});

describe('mapLiveTokenFailure', () => {
  it.each([
    [undefined, null, 'network'],
    [0, null, 'network'],
    [401, 'unauthorized', 'auth'],
    [403, 'not_owner', 'forbidden'],
    [404, 'not_found', 'not_found'],
    [404, null, 'not_configured'],
    [409, 'live_not_active', 'not_active'],
    [503, 'not_configured', 'not_configured'],
    [500, 'db_error', 'server'],
    [400, 'bad_request', 'server'],
  ] as const)('%p / %p → %s', (status, code, expected) => {
    expect(mapLiveTokenFailure(status, code)).toBe(expected);
  });
});

describe('parseLiveTokenResponse', () => {
  it('accepte une réponse complète', () => {
    expect(parseLiveTokenResponse(OK)).toEqual(OK);
  });
  it.each([
    null,
    {},
    { ...OK, token: 'pas-un-jwt' },
    { ...OK, url: 'https://nia.livekit.cloud' },
    { ...OK, room: '' },
    { ...OK, role: 'admin' },
  ])('refuse %p', (data) => {
    expect(() => parseLiveTokenResponse(data)).toThrow(LiveTokenError);
  });
});

describe('fetchLiveToken', () => {
  it('appelle live-token avec live_id et role, renvoie { token, url }', async () => {
    mockInvoke.mockResolvedValue({ data: OK, error: null });
    await expect(fetchLiveToken(LIVE_ID, 'viewer')).resolves.toEqual(OK);
    expect(mockInvoke).toHaveBeenCalledWith('live-token', { body: { live_id: LIVE_ID, role: 'viewer' } });
  });

  it('sans session → auth, sans appel réseau', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    await expect(fetchLiveToken(LIVE_ID, 'publisher')).rejects.toMatchObject({ code: 'auth' });
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('403 not_owner → forbidden', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: httpError(403, { error: 'not_owner' }) });
    await expect(fetchLiveToken(LIVE_ID, 'publisher')).rejects.toMatchObject({ code: 'forbidden', status: 403 });
  });

  it('404 sans code (fonction non déployée) → not_configured', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: httpError(404, { code: 'NOT_FOUND', message: 'Requested function was not found' }),
    });
    await expect(fetchLiveToken(LIVE_ID, 'viewer')).rejects.toMatchObject({ code: 'not_configured' });
  });

  it('erreur réseau → network', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: { name: 'FunctionsFetchError' } });
    await expect(fetchLiveToken(LIVE_ID, 'viewer')).rejects.toMatchObject({ code: 'network' });
    mockInvoke.mockRejectedValue(new Error('boom'));
    await expect(fetchLiveToken(LIVE_ID, 'viewer')).rejects.toMatchObject({ code: 'network' });
  });

  it('corps d’erreur illisible → server', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: { name: 'FunctionsHttpError', context: { status: 500, json: async () => { throw new Error('x'); } } },
    });
    await expect(fetchLiveToken(LIVE_ID, 'viewer')).rejects.toMatchObject({ code: 'server' });
  });
});

describe('liveTokenErrorKey', () => {
  it('chaque code pointe vers une clé qui existe en français', () => {
    const rtc = (fr as unknown as { live: { rtc: Record<string, string> } }).live.rtc;
    for (const code of ['auth', 'forbidden', 'not_found', 'not_active', 'not_configured', 'network', 'server', 'bad_response'] as const) {
      const key = liveTokenErrorKey(code);
      expect(key.startsWith('live.rtc.')).toBe(true);
      expect(typeof rtc[key.slice('live.rtc.'.length)]).toBe('string');
    }
  });
});
