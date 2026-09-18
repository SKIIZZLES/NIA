// Nuclear Metro fix: on iOS/Android, resolve ALL @supabase/supabase-js and
// @supabase/realtime-js (incl. subpaths) to a stub so Node `ws` → `stream`
// never enters the Expo Go bundle. Web keeps the real packages.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');
const { resolve: metroResolve } = require('metro-resolver');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

const emptyShim = path.resolve(__dirname, 'shims/empty.js');
const supabaseNativeShim = path.resolve(__dirname, 'shims/supabase-js-native.js');
const readableStream = require.resolve('readable-stream');

function isNativePlatform(platform) {
  return platform === 'android' || platform === 'ios';
}

function isSupabasePackage(moduleName) {
  return (
    moduleName === '@supabase/supabase-js' ||
    moduleName.startsWith('@supabase/supabase-js/') ||
    moduleName === '@supabase/realtime-js' ||
    moduleName.startsWith('@supabase/realtime-js/')
  );
}

// Prefer classic resolution; package "exports" often pick Node entrypoints.
config.resolver.unstable_enablePackageExports = false;
config.resolver.unstable_conditionNames = ['react-native', 'browser', 'require'];

config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules || {}),
  ws: emptyShim,
  stream: readableStream,
  '@supabase/realtime-js': supabaseNativeShim,
  '@supabase/supabase-js': supabaseNativeShim,
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
  // Expo Go native: never load real supabase packages (pulls Node ws/stream).
  if (isNativePlatform(platform) && isSupabasePackage(moduleName)) {
    return { type: 'sourceFile', filePath: supabaseNativeShim };
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

  return metroResolve(
    { ...context, resolveRequest: undefined },
    moduleName,
    platform
  );
};

module.exports = config;
