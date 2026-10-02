/**
 * A1 (masques visage) : architectures Android limitées à arm64-v8a et
 * armeabi-v7a (décision du fondateur, 30/09/2026).
 *
 * MediaPipe embarque une bibliothèque native d'environ 11 Mo par
 * architecture ; les images x86 / x86_64 (émulateurs, quasi aucun téléphone)
 * doubleraient ce poids dans un APK universel. La variable
 * ORG_GRADLE_PROJECT_reactNativeArchitectures reste prioritaire pour un
 * build local ciblé (ex. arm64-v8a seul).
 */
const { withGradleProperties } = require('expo/config-plugins');

const KEY = 'reactNativeArchitectures';

module.exports = function withAndroidAbis(config, { abis = ['armeabi-v7a', 'arm64-v8a'] } = {}) {
  return withGradleProperties(config, (cfg) => {
    const value = abis.join(',');
    const items = cfg.modResults.filter((item) => !(item.type === 'property' && item.key === KEY));
    items.push({ type: 'property', key: KEY, value });
    cfg.modResults = items;
    return cfg;
  });
};
