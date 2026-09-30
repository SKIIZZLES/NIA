/**
 * Edge Function snapchat-auth v7 : lecture de la requête et échange du code
 * (supabase/functions/snapchat-auth/core.ts).
 */
import {
  SNAP_TOKEN_URL,
  allowedPublicClientIds,
  parseExchangeRequest,
  planTokenRequest,
  shouldRetryAsPublic,
  type SnapConfig,
  type SnapExchangeRequest,
} from '../../supabase/functions/snapchat-auth/core';

const PUBLIC_ID = '7ea8f803-0000-4000-8000-000000000001';
const PROD_ID = 'cd5bab72-0000-4000-8000-000000000002';

const CFG: SnapConfig = {
  clientId: PUBLIC_ID,
  clientSecret: 'shh-not-a-real-secret',
  publicClientIds: allowedPublicClientIds(PUBLIC_ID, ''),
};

function req(over: Partial<SnapExchangeRequest> = {}): SnapExchangeRequest {
  return {
    code: 'CODE',
    codeVerifier: 'VERIFIER',
    redirectUri: 'nia://snapchat-auth',
    clientType: 'public',
    clientId: PUBLIC_ID,
    ...over,
  };
}

function form(body: string): URLSearchParams {
  return new URLSearchParams(body);
}

describe('parseExchangeRequest', () => {
  it('ancien corps (APK ≤ v6) → mode historique', () => {
    const r = parseExchangeRequest({ code: 'c', code_verifier: 'v', redirect_uri: 'nia://snapchat-auth' });
    expect(r).toEqual({
      ok: true,
      value: { code: 'c', codeVerifier: 'v', redirectUri: 'nia://snapchat-auth', clientType: 'confidential', clientId: null },
    });
  });

  it('nouveau corps → mode public avec client_id', () => {
    const r = parseExchangeRequest({
      code: 'c',
      code_verifier: 'v',
      redirect_uri: 'nia://snapchat-auth',
      client_type: 'public',
      client_id: PUBLIC_ID,
    });
    expect(r).toMatchObject({ ok: true, value: { clientType: 'public', clientId: PUBLIC_ID } });
  });

  it('refuse les champs manquants, un client_type inconnu, public sans client_id', () => {
    expect(parseExchangeRequest({ code: 'c', code_verifier: 'v' })).toMatchObject({ ok: false, status: 400 });
    expect(parseExchangeRequest(null)).toMatchObject({ ok: false, status: 400 });
    expect(
      parseExchangeRequest({ code: 'c', code_verifier: 'v', redirect_uri: 'r', client_type: 'x' }),
    ).toMatchObject({ ok: false, status: 400 });
    expect(
      parseExchangeRequest({ code: 'c', code_verifier: 'v', redirect_uri: 'r', client_type: 'public' }),
    ).toMatchObject({ ok: false, status: 400 });
  });
});

describe('allowedPublicClientIds', () => {
  it('SNAP_CLIENT_ID + liste optionnelle, sans doublon ni vide', () => {
    expect(allowedPublicClientIds(PUBLIC_ID, '')).toEqual([PUBLIC_ID]);
    expect(allowedPublicClientIds(PUBLIC_ID, ` ${PROD_ID} , ,${PUBLIC_ID}`)).toEqual([PUBLIC_ID, PROD_ID]);
  });
});

describe('planTokenRequest — public', () => {
  it('PKCE seul : client_id dans le corps, AUCUN en-tête Authorization, aucun secret', () => {
    const plan = planTokenRequest(req(), CFG);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.mode).toBe('public');
    expect(plan.url).toBe(SNAP_TOKEN_URL);
    expect(plan.headers.Authorization).toBeUndefined();
    expect(plan.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    const f = form(plan.body);
    expect(f.get('grant_type')).toBe('authorization_code');
    expect(f.get('client_id')).toBe(PUBLIC_ID);
    expect(f.get('code')).toBe('CODE');
    expect(f.get('code_verifier')).toBe('VERIFIER');
    expect(f.get('redirect_uri')).toBe('nia://snapchat-auth');
    expect(f.has('client_secret')).toBe(false);
    expect(plan.body).not.toContain(CFG.clientSecret);
  });

  it('refuse un client_id hors liste', () => {
    expect(planTokenRequest(req({ clientId: PROD_ID }), CFG)).toMatchObject({ ok: false, status: 400 });
  });

  it('accepte un ID ajouté par SNAP_PUBLIC_CLIENT_IDS', () => {
    const cfg = { ...CFG, publicClientIds: allowedPublicClientIds(PUBLIC_ID, PROD_ID) };
    const plan = planTokenRequest(req({ clientId: PROD_ID }), cfg);
    expect(plan.ok && form(plan.body).get('client_id')).toBe(PROD_ID);
  });

  it('ne demande pas de secret', () => {
    expect(planTokenRequest(req(), { ...CFG, clientSecret: '' }).ok).toBe(true);
  });
});

describe('planTokenRequest — historique', () => {
  it('garde l’en-tête Basic SNAP_CLIENT_ID:SNAP_CLIENT_SECRET', () => {
    const plan = planTokenRequest(req({ clientType: 'confidential', clientId: null }), CFG);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.mode).toBe('confidential');
    expect(plan.headers.Authorization).toBe(`Basic ${btoa(`${PUBLIC_ID}:${CFG.clientSecret}`)}`);
    expect(form(plan.body).get('client_id')).toBe(PUBLIC_ID);
    expect(form(plan.body).get('code_verifier')).toBe('VERIFIER');
  });

  it('503 si le secret manque', () => {
    expect(
      planTokenRequest(req({ clientType: 'confidential', clientId: null }), { ...CFG, clientSecret: '' }),
    ).toMatchObject({ ok: false, status: 503 });
  });

  it('retente en public avec SNAP_CLIENT_ID quand on force le mode', () => {
    const plan = planTokenRequest(req({ clientType: 'confidential', clientId: null }), CFG, 'public');
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.headers.Authorization).toBeUndefined();
    expect(form(plan.body).get('client_id')).toBe(PUBLIC_ID);
  });
});

describe('shouldRetryAsPublic', () => {
  it('uniquement sur refus du client en mode historique', () => {
    expect(shouldRetryAsPublic('confidential', 401, 'invalid_client', true)).toBe(true);
    expect(shouldRetryAsPublic('confidential', 400, 'unauthorized_client', true)).toBe(true);
  });

  it('jamais sur invalid_grant (code expiré ou déjà utilisé)', () => {
    expect(shouldRetryAsPublic('confidential', 400, 'invalid_grant', true)).toBe(false);
  });

  it('jamais en mode public, ni si SNAP_CLIENT_ID n’est pas public, ni sur 5xx', () => {
    expect(shouldRetryAsPublic('public', 401, 'invalid_client', true)).toBe(false);
    expect(shouldRetryAsPublic('confidential', 401, 'invalid_client', false)).toBe(false);
    expect(shouldRetryAsPublic('confidential', 500, 'invalid_client', true)).toBe(false);
  });
});
