// Aggressive Metro shims so @supabase/realtime-js never pulls Node `ws` /
// `stream` / `zlib` into the Expo Go Android/iOS bundle.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');
const { resolve: metroResolve } = require('metro-resolver');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

const emptyShim = path.resolve(__dirname, 'shims/empty.js');
const readableStream = require.resolve('readable-stream');

// Prefer classic resolution; package "exports" often pick Node entrypoints.
config.resolver.unstable_enablePackageExports = false;
config.resolver.unstable_conditionNames = ['react-native', 'browser', 'require'];

config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules || {}),
  ws: emptyShim,
  stream: readableStream,
};

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'ws' || moduleName.startsWith('ws/')) {
    return { type: 'sourceFile', filePath: emptyShim };
  }

  if (moduleName === 'stream' || moduleName === 'node:stream') {
    return { type: 'sourceFile', filePath: readableStream };
  }

  if (moduleName === 'zlib' || moduleName === 'node:zlib') {
    return { type: 'sourceFile', filePath: emptyShim };
  }

  // Default Metro resolver without re-entering this custom resolveRequest.
  return metroResolve(
    { ...context, resolveRequest: undefined },
    moduleName,
    platform
  );
};

module.exports = config;
