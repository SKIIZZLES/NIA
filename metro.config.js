// Metro shims for Node builtins pulled by Supabase on React Native.
// Keep real @supabase/supabase-js on android/ios (needed for EAS preview/production).
// Stub @supabase/realtime-js only (ws → stream crash mitigation).
// shims/supabase-js-native.js is kept in repo but NOT wired here.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');
const { resolve: metroResolve } = require('metro-resolver');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

const emptyShim = path.resolve(__dirname, 'shims/empty.js');
const realtimeStub = path.resolve(__dirname, 'shims/supabase-realtime-stub.js');
const readableStream = require.resolve('readable-stream');
const projectRoot = __dirname;

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
  // Optional stub: realtime only (never replace entire @supabase/supabase-js).
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

  // Restore tsconfig paths alias: "@/*" → "./*"
  // Custom resolveRequest bypasses Expo's default alias handling, so rewrite here.
  let nameToResolve = moduleName;
  if (moduleName.startsWith('@/')) {
    nameToResolve = path.resolve(projectRoot, moduleName.slice(2));
  }

  return metroResolve(
    { ...context, resolveRequest: undefined },
    nameToResolve,
    platform
  );
};

module.exports = config;
