// Nuclear Metro fix: stub @supabase/realtime-js entirely so nested Node `ws`
// (and thus `stream` / `zlib`) never enter the Expo Go Android/iOS bundle.
// Auth, REST, and Storage still load from real @supabase packages.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');
const { resolve: metroResolve } = require('metro-resolver');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

const emptyShim = path.resolve(__dirname, 'shims/empty.js');
const realtimeStub = path.resolve(__dirname, 'shims/supabase-realtime-stub.js');
const readableStream = require.resolve('readable-stream');

// Prefer classic resolution; package "exports" often pick Node entrypoints.
config.resolver.unstable_enablePackageExports = false;
config.resolver.unstable_conditionNames = ['react-native', 'browser', 'require'];

config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules || {}),
  ws: emptyShim,
  stream: readableStream,
  '@supabase/realtime-js': realtimeStub,
};

const prevBlockList = config.resolver.blockList;
const nestedWsBlock = [
  /node_modules\/ws\/.*/,
  /node_modules\/@supabase\/realtime-js\/node_modules\/ws\/.*/,
  /node_modules\/@supabase\/realtime-js\/dist\/.*/,
  /node_modules\/@supabase\/realtime-js\/src\/.*/,
];
config.resolver.blockList = Array.isArray(prevBlockList)
  ? [...prevBlockList, ...nestedWsBlock]
  : prevBlockList
    ? [prevBlockList, ...nestedWsBlock]
    : nestedWsBlock;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Any request for realtime-js (root or subpath) → stub.
  if (
    moduleName === '@supabase/realtime-js' ||
    moduleName.startsWith('@supabase/realtime-js/')
  ) {
    return { type: 'sourceFile', filePath: realtimeStub };
  }

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
