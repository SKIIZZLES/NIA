/**
 * Déclare Snapchat dans les `<queries>` du manifeste Android (spike
 * app-switch Snapchat).
 *
 * Depuis Android 11 (API 30), une app ne « voit » plus les autres apps
 * installées sans le déclarer : `Linking.canOpenURL('snapchat://')` répondrait
 * toujours non, et le bouton resterait sur la page web. On déclare :
 *   - le paquet `com.snapchat.android` (comme l'exige le SDK Login Kit) ;
 *   - l'intention VIEW sur le scheme `snapchat` (utilisée par canOpenURL).
 *
 * Aucune permission ajoutée. Idempotent (rejouer prebuild ne duplique rien).
 */
const { withAndroidManifest } = require('expo/config-plugins');

const SNAPCHAT_PACKAGE = 'com.snapchat.android';
const SNAPCHAT_SCHEME = 'snapchat';

function hasPackage(queries) {
  return (queries.package || []).some(
    (p) => p && p.$ && p.$['android:name'] === SNAPCHAT_PACKAGE,
  );
}

function hasSchemeIntent(queries) {
  return (queries.intent || []).some((intent) =>
    (intent.data || []).some((d) => d && d.$ && d.$['android:scheme'] === SNAPCHAT_SCHEME),
  );
}

function addSnapchatQueries(manifest) {
  manifest.queries = manifest.queries || [];
  if (manifest.queries.length === 0) manifest.queries.push({});
  const queries = manifest.queries[0];
  if (!hasPackage(queries)) {
    queries.package = queries.package || [];
    queries.package.push({ $: { 'android:name': SNAPCHAT_PACKAGE } });
  }
  if (!hasSchemeIntent(queries)) {
    queries.intent = queries.intent || [];
    queries.intent.push({
      action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
      data: [{ $: { 'android:scheme': SNAPCHAT_SCHEME } }],
    });
  }
  return manifest;
}

module.exports = function withSnapchatQueries(config) {
  return withAndroidManifest(config, (cfg) => {
    addSnapchatQueries(cfg.modResults.manifest);
    return cfg;
  });
};

module.exports.addSnapchatQueries = addSnapchatQueries;
