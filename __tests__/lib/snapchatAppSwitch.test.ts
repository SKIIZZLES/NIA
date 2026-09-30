/**
 * Spike app-switch Snapchat : construction des liens et validation du retour
 * (lib/snapchatAppSwitch.ts).
 */
import {
  NIA_ANDROID_PACKAGE,
  SNAP_APP_ONLY_PARAMS,
  SNAP_APP_SWITCH_DEFAULT,
  SNAP_KIT_VERSION,
  SNAP_PENDING_TTL_MS,
  buildSnapAuthUrl,
  buildSnapHttpsAuthUrl,
  buildSnapchatAppAuthUrl,
  isPlainSnapHttpsAuthUrl,
  isSnapAppSwitchVariant,
  isSnapReturnUrl,
  nextSnapVariant,
  parsePending,
  parseSnapReturnUrl,
  safeEqual,
  serializePending,
  snapReturnFailureKey,
  snapReturnFromRouteParams,
  validateSnapReturn,
  type PendingSnapAuth,
  type SnapAuthParams,
} from '@/lib/snapchatAppSwitch';
import fr from '@/locales/fr';

const CLIENT = '11111111-2222-4333-8444-555555555555';
const SCOPES = [
  'https://auth.snapchat.com/oauth2/api/user.display_name',
  'https://auth.snapchat.com/oauth2/api/user.external_id',
];
const PARAMS: SnapAuthParams = {
  clientId: CLIENT,
  redirectUri: 'nia://snapchat-auth',
  scopes: SCOPES,
  state: 'st4te_ABC-123',
  codeChallenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
};

function query(url: string): URLSearchParams {
  return new URLSearchParams(url.slice(url.indexOf('?') + 1));
}

describe('buildSnapHttpsAuthUrl', () => {
  it('vise accounts.snapchat.com avec PKCE S256 et state', () => {
    const url = buildSnapHttpsAuthUrl(PARAMS);
    expect(url.startsWith('https://accounts.snapchat.com/accounts/oauth2/auth?')).toBe(true);
    const q = query(url);
    expect(q.get('response_type')).toBe('code');
    expect(q.get('client_id')).toBe(CLIENT);
    expect(q.get('redirect_uri')).toBe('nia://snapchat-auth');
    expect(q.get('scope')).toBe(SCOPES.join(' '));
    expect(q.get('state')).toBe(PARAMS.state);
    expect(q.get('code_challenge_method')).toBe('S256');
    expect(q.get('code_challenge')).toBe(PARAMS.codeChallenge);
    expect(q.has('package_name')).toBe(false);
  });

  it('garde la forme exacte du flux web de main (ordre + espaces en « + »)', () => {
    const url = buildSnapHttpsAuthUrl(PARAMS);
    expect(url).toBe(
      'https://accounts.snapchat.com/accounts/oauth2/auth' +
        `?code_challenge=${PARAMS.codeChallenge}` +
        '&code_challenge_method=S256' +
        '&redirect_uri=nia%3A%2F%2Fsnapchat-auth' +
        `&client_id=${CLIENT}` +
        '&response_type=code' +
        `&state=${PARAMS.state}` +
        '&scope=https%3A%2F%2Fauth.snapchat.com%2Foauth2%2Fapi%2Fuser.display_name' +
        '+https%3A%2F%2Fauth.snapchat.com%2Foauth2%2Fapi%2Fuser.external_id',
    );
    expect(url).not.toContain('%20');
  });

  it('octet pour octet l’URL d’expo-auth-session (Custom Tab de main)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AuthRequest } = require('expo-auth-session') as typeof import('expo-auth-session');
    const req = new AuthRequest({
      clientId: CLIENT,
      redirectUri: PARAMS.redirectUri,
      scopes: [...SCOPES],
      state: PARAMS.state,
      usePKCE: true,
    });
    // PKCE figé pour comparer (ensureCodeIsSetupAsync ne régénère pas).
    req.codeVerifier = 'v'.repeat(43);
    req.codeChallenge = PARAMS.codeChallenge;
    const reference = await req.makeAuthUrlAsync({
      authorizationEndpoint: 'https://accounts.snapchat.com/accounts/oauth2/auth',
    });
    expect(buildSnapHttpsAuthUrl(PARAMS)).toBe(reference);
    expect(isPlainSnapHttpsAuthUrl(reference)).toBe(true);
  });

  it('aucun paramètre du lien app dans l’URL https', () => {
    const q = query(buildSnapHttpsAuthUrl(PARAMS));
    for (const k of SNAP_APP_ONLY_PARAMS) expect(q.has(k)).toBe(false);
    expect(Array.from(q.keys()).sort()).toEqual(
      ['client_id', 'code_challenge', 'code_challenge_method', 'redirect_uri', 'response_type', 'scope', 'state'],
    );
  });

  it('isPlainSnapHttpsAuthUrl refuse le lien app, un autre hôte ou un PKCE absent', () => {
    expect(isPlainSnapHttpsAuthUrl(buildSnapHttpsAuthUrl(PARAMS))).toBe(true);
    expect(isPlainSnapHttpsAuthUrl(buildSnapchatAppAuthUrl(PARAMS))).toBe(false);
    const https = buildSnapHttpsAuthUrl(PARAMS);
    expect(isPlainSnapHttpsAuthUrl(`${https}&package_name=app.nia.mobile`)).toBe(false);
    expect(isPlainSnapHttpsAuthUrl(`${https}&kit_version=3.0.0`)).toBe(false);
    expect(isPlainSnapHttpsAuthUrl(`${https}&link=${CLIENT}`)).toBe(false);
    expect(isPlainSnapHttpsAuthUrl(https.replace('accounts.snapchat.com', 'evil.example'))).toBe(false);
    expect(isPlainSnapHttpsAuthUrl(https.replace('code_challenge_method=S256', 'code_challenge_method=plain'))).toBe(false);
    expect(isPlainSnapHttpsAuthUrl(null)).toBe(false);
    expect(isPlainSnapHttpsAuthUrl('')).toBe(false);
  });

  it('refuse des paramètres incomplets', () => {
    expect(() => buildSnapHttpsAuthUrl({ ...PARAMS, state: '' })).toThrow();
    expect(() => buildSnapHttpsAuthUrl({ ...PARAMS, codeChallenge: '' })).toThrow();
    expect(() => buildSnapHttpsAuthUrl({ ...PARAMS, clientId: '' })).toThrow();
  });
});

describe('buildSnapchatAppAuthUrl', () => {
  it('reprend le lien snapchat://oauth2 du SDK Login Kit 3.0.0', () => {
    const url = buildSnapchatAppAuthUrl(PARAMS);
    expect(url.startsWith('snapchat://oauth2?')).toBe(true);
    const q = query(url);
    expect(q.get('package_name')).toBe('app.nia.mobile');
    expect(q.get('kit_version')).toBe(SNAP_KIT_VERSION);
    expect(q.get('link')).toBe(CLIENT);
    expect(q.get('sdk_is_from_react_native_plugin')).toBe('false');
    expect(q.get('is_for_firebase_authentication')).toBe('false');
    expect(q.get('state')).toBe(PARAMS.state);
    expect(q.get('code_challenge')).toBe(PARAMS.codeChallenge);
    expect(q.get('code_challenge_method')).toBe('S256');
  });

  it('garde l’ordre des paramètres du SDK', () => {
    const keys = Array.from(query(buildSnapchatAppAuthUrl(PARAMS)).keys());
    expect(keys).toEqual([
      'response_type',
      'client_id',
      'redirect_uri',
      'scope',
      'state',
      'code_challenge_method',
      'code_challenge',
      'sdk_is_from_react_native_plugin',
      'is_for_firebase_authentication',
      'package_name',
      'kit_version',
      'link',
    ]);
  });

  it('package par défaut = app.nia.mobile, surchargeable', () => {
    expect(NIA_ANDROID_PACKAGE).toBe('app.nia.mobile');
    expect(query(buildSnapchatAppAuthUrl(PARAMS, 'x.y')).get('package_name')).toBe('x.y');
    expect(() => buildSnapchatAppAuthUrl(PARAMS, '')).toThrow();
  });

  it('buildSnapAuthUrl choisit selon la variante', () => {
    expect(buildSnapAuthUrl('snapchat', PARAMS).startsWith('snapchat://')).toBe(true);
    expect(buildSnapAuthUrl('https', PARAMS).startsWith('https://')).toBe(true);
  });
});

describe('variantes', () => {
  it('défaut https, cycle https → snapchat → web → https', () => {
    expect(SNAP_APP_SWITCH_DEFAULT).toBe('https');
    expect(nextSnapVariant('https')).toBe('snapchat');
    expect(nextSnapVariant('snapchat')).toBe('web');
    expect(nextSnapVariant('web')).toBe('https');
  });

  it('isSnapAppSwitchVariant filtre les valeurs stockées', () => {
    expect(isSnapAppSwitchVariant('snapchat')).toBe(true);
    expect(isSnapAppSwitchVariant('SNAPCHAT')).toBe(false);
    expect(isSnapAppSwitchVariant(null)).toBe(false);
  });
});

describe('lecture du retour', () => {
  it('parseSnapReturnUrl lit code, state et erreurs (query et fragment)', () => {
    expect(parseSnapReturnUrl('nia://snapchat-auth?code=abc%2F1&state=s1')).toEqual({
      code: 'abc/1',
      state: 's1',
      error: undefined,
      errorDescription: undefined,
    });
    const err = parseSnapReturnUrl('nia://snapchat-auth?error=access_denied&error_description=User+denied&state=s1');
    expect(err.error).toBe('access_denied');
    expect(err.errorDescription).toBe('User denied');
    expect(parseSnapReturnUrl('nia://snapchat-auth#code=z&state=s2').code).toBe('z');
  });

  it('snapReturnFromRouteParams accepte string ou string[]', () => {
    expect(snapReturnFromRouteParams({ code: ['c1', 'c2'], state: 's', error: '' })).toEqual({
      code: 'c1',
      state: 's',
      error: undefined,
      errorDescription: undefined,
    });
  });

  it('isSnapReturnUrl reconnaît notre redirect, pas les autres liens', () => {
    expect(isSnapReturnUrl('nia://snapchat-auth?code=1', 'nia://snapchat-auth')).toBe(true);
    expect(isSnapReturnUrl('nia:///snapchat-auth?code=1', 'nia://snapchat-auth')).toBe(true);
    expect(isSnapReturnUrl('nia://snapchat-auth/', 'nia://snapchat-auth')).toBe(true);
    expect(isSnapReturnUrl('nia://video/1', 'nia://snapchat-auth')).toBe(false);
    expect(isSnapReturnUrl('evil://snapchat-auth?code=1', 'nia://snapchat-auth')).toBe(false);
  });
});

describe('validateSnapReturn', () => {
  const NOW = 1_800_000_000_000;
  const pending: PendingSnapAuth = {
    state: 'good-state-0123456789',
    codeVerifier: 'v'.repeat(64),
    redirectUri: 'nia://snapchat-auth',
    variant: 'snapchat',
    createdAt: NOW - 30_000,
  };

  it('accepte un retour valide et rend le verifier gardé', () => {
    expect(validateSnapReturn(pending, { code: 'CODE', state: pending.state }, NOW)).toEqual({
      ok: true,
      code: 'CODE',
      codeVerifier: pending.codeVerifier,
      redirectUri: 'nia://snapchat-auth',
    });
  });

  it('refuse sans demande en cours', () => {
    expect(validateSnapReturn(null, { code: 'C', state: 'x' }, NOW)).toEqual({ ok: false, reason: 'no_pending' });
  });

  it('refuse un state différent, absent ou de longueur différente', () => {
    expect(validateSnapReturn(pending, { code: 'C', state: 'good-state-012345678X' }, NOW)).toMatchObject({ reason: 'state_mismatch' });
    expect(validateSnapReturn(pending, { code: 'C' }, NOW)).toMatchObject({ reason: 'state_mismatch' });
    expect(validateSnapReturn(pending, { code: 'C', state: 'short' }, NOW)).toMatchObject({ reason: 'state_mismatch' });
  });

  it('vérifie le state AVANT l’erreur Snap (lien forgé ignoré)', () => {
    expect(validateSnapReturn(pending, { error: 'access_denied', state: 'forged' }, NOW)).toMatchObject({ reason: 'state_mismatch' });
  });

  it('refuse une demande expirée (> 10 min) ou datée du futur', () => {
    const old = { ...pending, createdAt: NOW - SNAP_PENDING_TTL_MS - 1 };
    expect(validateSnapReturn(old, { code: 'C', state: pending.state }, NOW)).toMatchObject({ reason: 'expired' });
    const future = { ...pending, createdAt: NOW + 120_000 };
    expect(validateSnapReturn(future, { code: 'C', state: pending.state }, NOW)).toMatchObject({ reason: 'expired' });
  });

  it('distingue le refus de l’utilisateur des autres erreurs Snap', () => {
    expect(validateSnapReturn(pending, { error: 'access_denied', state: pending.state }, NOW)).toMatchObject({ reason: 'denied' });
    expect(validateSnapReturn(pending, { error: 'server_error', state: pending.state }, NOW)).toMatchObject({ reason: 'snap_error' });
  });

  it('refuse un retour sans code', () => {
    expect(validateSnapReturn(pending, { state: pending.state }, NOW)).toMatchObject({ reason: 'missing_code' });
  });

  it('chaque échec a un message existant en français, au « vous »', () => {
    for (const reason of ['no_pending', 'expired', 'state_mismatch', 'denied', 'snap_error', 'missing_code'] as const) {
      const key = snapReturnFailureKey(reason);
      const [scope, leaf] = key.split('.');
      const text = (fr as unknown as Record<string, Record<string, string>>)[scope][leaf];
      expect(typeof text).toBe('string');
      expect(text).not.toMatch(/\btu\b|\bton\b|\bta\b|\btes\b/i);
    }
  });
});

describe('demande en cours (SecureStore)', () => {
  const p: PendingSnapAuth = {
    state: 's',
    codeVerifier: 'v',
    redirectUri: 'nia://snapchat-auth',
    variant: 'https',
    createdAt: 1,
  };

  it('aller-retour sérialisation', () => {
    expect(parsePending(serializePending(p))).toEqual(p);
  });

  it('ignore un contenu illisible ou incomplet', () => {
    expect(parsePending(null)).toBeNull();
    expect(parsePending('{')).toBeNull();
    expect(parsePending(JSON.stringify({ ...p, variant: 'autre' }))).toBeNull();
    expect(parsePending(JSON.stringify({ ...p, codeVerifier: '' }))).toBeNull();
  });
});

describe('safeEqual', () => {
  it('compare exactement', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});
