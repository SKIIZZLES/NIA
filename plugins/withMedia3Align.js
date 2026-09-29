/**
 * Aligne toutes les dépendances androidx.media3 sur une seule version.
 *
 * expo-video / expo-audio (SDK 57) utilisent Media3 1.9.0 ; la découpe vidéo
 * (react-native-media-toolkit) déclare media3-transformer/effect 1.5.1. Mélanger
 * des versions de Media3 peut planter à l'exécution : on force donc la même
 * version partout (le module de découpe est compilé contre elle, une API
 * incompatible casserait la compilation au lieu de l'application).
 */
const { withProjectBuildGradle } = require('expo/config-plugins');

const MARK = '// nia-media3-align';

module.exports = function withMedia3Align(config, { version = '1.9.0' } = {}) {
  return withProjectBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') return cfg;
    if (cfg.modResults.contents.includes(MARK)) return cfg;
    cfg.modResults.contents += `
${MARK}
allprojects {
  configurations.all {
    resolutionStrategy.eachDependency { details ->
      if (details.requested.group == 'androidx.media3') {
        details.useVersion('${version}')
        details.because('NIA : une seule version de Media3 (expo-video, expo-audio, découpe)')
      }
    }
  }
}
`;
    return cfg;
  });
};
