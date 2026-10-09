const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { validateProductionEnv } = require('./validate-production-env.cjs');

const valid = {
  EAS_BUILD_PROFILE: 'production',
  EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  EXPO_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_test',
  EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: '123-test.apps.googleusercontent.com',
};

test('production refuses missing configuration and forced mock sessions', () => {
  assert.equal(validateProductionEnv({ EAS_BUILD_PROFILE: 'production' }).length, 3);
  for (const mock of ['1', 'true', ' TRUE ']) {
    assert.ok(validateProductionEnv({ ...valid, EXPO_PUBLIC_USE_MOCK: mock }).length);
  }
});

test('production accepts public publishable and legacy anon keys', () => {
  assert.deepEqual(validateProductionEnv(valid), []);
  const anon = `header.${Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url')}.signature`;
  assert.deepEqual(validateProductionEnv({ ...valid, EXPO_PUBLIC_SUPABASE_ANON_KEY: anon }), []);
});

test('production rejects server credentials, invalid URLs and placeholder Google IDs', () => {
  const service = `header.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.signature`;
  for (const key of ['sb_secret_test', service, 'header.invalid.signature']) {
    assert.ok(validateProductionEnv({ ...valid, EXPO_PUBLIC_SUPABASE_ANON_KEY: key }).length);
  }
  for (const url of ['http://example.supabase.co', 'invalid', 'https://user:password@example.supabase.co']) {
    assert.ok(validateProductionEnv({ ...valid, EXPO_PUBLIC_SUPABASE_URL: url }).length);
  }
  assert.ok(validateProductionEnv({ ...valid, EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: 'PLACEHOLDER.apps.googleusercontent.com' }).length);
});

test('preview and local development retain their existing mock support', () => {
  for (const profile of [undefined, 'preview', 'development']) {
    assert.deepEqual(validateProductionEnv({ EAS_BUILD_PROFILE: profile, EXPO_PUBLIC_USE_MOCK: '1' }), []);
  }
});

test('the actual build hook fails without exposing credential values', () => {
  const sensitive = 'sb_secret_DO_NOT_PRINT';
  const result = spawnSync(process.execPath, [require.resolve('./validate-production-env.cjs')], {
    env: { ...process.env, ...valid, EXPO_PUBLIC_USE_MOCK: '0', EXPO_PUBLIC_SUPABASE_ANON_KEY: sensitive },
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes('EXPO_PUBLIC_SUPABASE_ANON_KEY'));
  assert.ok(!result.stderr.includes(sensitive));
});
