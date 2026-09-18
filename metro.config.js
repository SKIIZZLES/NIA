// Metro: on android/ios, stub ALL @supabase/* so the real client never ships
// in the APK (guaranteed-open preview). Web keeps the real packages.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');
const { resolve: metroResolve } = require('metro-resolver');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

const emptyShim = path.resolve(__dirname, 'shims/empty.js');
const supabaseJsNative = path.resolve(__dirname, 'shims/supabase-js-native.js');
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

config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Native: replace entire supabase client + realtime with local shim.
  if (isNativePlatform(platform) && isSupabasePackage(moduleName)) {
    return { type: 'sourceFile', filePath: supabaseJsNative };
  }

  // Web / other: still stub realtime + node builtins that break RN tooling.
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

  // Use metro-resolver directly (clear resolveRequest) to avoid infinite recursion.
  return metroResolve(
    { ...context, resolveRequest: undefined },
    nameToResolve,
    platform
  );
};

module.exports = config;
