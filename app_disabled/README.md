# Emergency: routes parked outside Expo Router

Moved here so Metro does **not** evaluate import-time side effects that crash the APK after splash.

## Restore later

```bash
git mv 'app_disabled/(auth)' 'app/(auth)'
git mv 'app_disabled/(tabs)' 'app/(tabs)'
git mv app_disabled/welcome.tsx app/welcome.tsx
git mv app_disabled/edit-profile.tsx app/edit-profile.tsx
git mv app_disabled/user app/user
# then restore real app/_layout.tsx + app/index.tsx from git history
```

Do not put these back under `app/` until AuthProvider / supabase / expo-av startup is proven safe on Android APK.
