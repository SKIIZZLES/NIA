const { withAppBuildGradle } = require('expo/config-plugins');

// Expo 57's bundled template still selects proguard-android.txt, which
// disables optimization. Persist the replacement through every prebuild.
function useOptimizedProguard(contents) {
  const defaults = /getDefaultProguardFile\(\s*(['"])proguard-android(?:-optimize)?\.txt\1\s*\)/g;
  const matches = contents.match(defaults) || [];
  if (matches.length !== 1) {
    throw new Error('NIA R8: expected one Expo default ProGuard file; review the Android template before building.');
  }
  return contents.replace(defaults, 'getDefaultProguardFile("proguard-android-optimize.txt")');
}

module.exports = function withAndroidR8(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') {
      throw new Error('NIA R8: review the plugin for a non-Groovy Android template.');
    }
    cfg.modResults.contents = useOptimizedProguard(cfg.modResults.contents);
    return cfg;
  });
};

module.exports.useOptimizedProguard = useOptimizedProguard;
