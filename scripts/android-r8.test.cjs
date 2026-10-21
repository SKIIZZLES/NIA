const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { useOptimizedProguard } = require('../plugins/withAndroidR8');

test('the installed Expo template uses the optimized default without altering signing or build types', () => {
  const template = execFileSync('tar', ['-xOzf', require.resolve('expo/template.tgz'), 'package/android/app/build.gradle'], { encoding: 'utf8' });
  const optimized = useOptimizedProguard(template);
  assert.ok(optimized.includes('getDefaultProguardFile("proguard-android-optimize.txt")'));
  assert.equal(optimized.replace('proguard-android-optimize.txt', 'proguard-android.txt'), template);
  assert.equal(useOptimizedProguard(optimized), optimized);
});

test('template changes fail explicitly instead of silently skipping R8 optimization', () => {
  assert.throws(() => useOptimizedProguard('android {}'), /expected one/);
  assert.throws(() => useOptimizedProguard('getDefaultProguardFile("proguard-android.txt")\n'.repeat(2)), /expected one/);
  assert.equal(useOptimizedProguard("getDefaultProguardFile( 'proguard-android.txt' )"), 'getDefaultProguardFile("proguard-android-optimize.txt")');
});
