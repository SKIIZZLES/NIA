// EAS supplies the selected environment before running this hook.
// Fail before building a store binary that would silently use demo accounts.
function validateProductionEnv(env) {
  if (env.EAS_BUILD_PROFILE !== 'production') return [];
  const errors = [];
  const value = (name) => (env[name] || '').trim();
  const mock = value('EXPO_PUBLIC_USE_MOCK').toLowerCase();
  if (mock === '1' || mock === 'true') errors.push('EXPO_PUBLIC_USE_MOCK doit être désactivé.');

  try {
    const url = new URL(value('EXPO_PUBLIC_SUPABASE_URL'));
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) throw new Error();
  } catch {
    errors.push('EXPO_PUBLIC_SUPABASE_URL doit être une URL HTTPS valide.');
  }

  const key = value('EXPO_PUBLIC_SUPABASE_ANON_KEY');
  let publicKey = /^sb_publishable_\S+$/.test(key);
  if (!publicKey && key.split('.').length === 3) {
    try {
      const claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString('utf8'));
      publicKey = claims.role === 'anon';
    } catch { /* Missing or malformed public key. */ }
  }
  if (!publicKey) errors.push('EXPO_PUBLIC_SUPABASE_ANON_KEY doit être une clé publishable ou anon, jamais une clé serveur.');

  const google = value('EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID');
  if (!/^[a-zA-Z0-9-]+\.apps\.googleusercontent\.com$/.test(google) || /placeholder|replace/i.test(google)) {
    errors.push('EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID doit contenir le véritable client OAuth Web.');
  }
  return errors;
}

module.exports = { validateProductionEnv };

if (require.main === module) {
  const errors = validateProductionEnv(process.env);
  if (errors.length) {
    // Print variable names and instructions only, never their values.
    console.error('NIA : configuration de production incomplète.');
    for (const error of errors) console.error(error);
    console.error('Configurer les variables dans l’environnement EAS production, puis relancer le build.');
    process.exitCode = 1;
  }
}
