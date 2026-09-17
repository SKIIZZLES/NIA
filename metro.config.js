// Metro config for Expo + Supabase on React Native (Expo Go Android/iOS).
// Prefer RN/browser exports over Node so @supabase/realtime-js does not pull
// Node-only `ws` / `stream` / `zlib` into the bundle.
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

const emptyModules = new Set(['ws', 'zlib']);

config.resolver.unstable_enablePackageExports = true;
config.resolver.unstable_conditionNames = ['react-native', 'browser', 'require'];

const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (emptyModules.has(moduleName)) {
    return { type: 'empty' };
  }

  if (moduleName === 'stream') {
    return context.resolveRequest(context, 'readable-stream', platform);
  }

  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }

  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
