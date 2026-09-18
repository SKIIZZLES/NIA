# NIA — Supabase backend

Project: `https://odlmbiaocdonlovjepxn.supabase.co`

## App client behaviour

| Condition | Mode |
|-----------|------|
| `EXPO_PUBLIC_SUPABASE_URL` + `EXPO_PUBLIC_SUPABASE_ANON_KEY` set, `EXPO_PUBLIC_USE_MOCK` unset | **Real** Auth + REST + Storage |
| Env missing / empty | **Mock** (AsyncStorage auth + `DEMO_VIDEOS`) |
| `EXPO_PUBLIC_USE_MOCK=1` (or `true`) | **Mock** forced |

Metro keeps shims for Node `ws` / `stream` / `zlib` and stubs `@supabase/realtime-js` only. The full `@supabase/supabase-js` client is **not** replaced on Android EAS. Realtime channels are no-ops; feed/likes/comments/follows use REST.

## Migrations (already applied on the project above)

1. `supabase/migrations/001_nia_init.sql` — `profiles`, `videos`, RLS, Storage bucket `videos`
2. `supabase/migrations/002_sprint1_engagement.sql` — likes, comments, follows, notifications, reports, blocks + video/profile columns

Re-run in SQL Editor only if a fresh project is created (001 then 002).

## Storage bucket `videos` (required for publish)

If **Storage → Buckets** has no public `videos` bucket (or upload fails with bucket/policy errors):

### Create in Dashboard

1. Supabase Dashboard → **Storage** → **New bucket**
2. Name: `videos`
3. **Public bucket**: ON
4. Optional: file size limit ≥ max upload you allow in-app (see `MAX_UPLOAD_BYTES` in `constants/publish.ts`)
5. Allowed MIME (suggested): `video/mp4`, `video/quicktime`, `video/webm`, `image/jpeg`, `image/png`, `image/webp`

### Policies (if SQL insert did not apply)

Run the storage section from `001_nia_init.sql`, or create equivalent policies on `storage.objects`:

- **SELECT** public read where `bucket_id = 'videos'`
- **INSERT** authenticated where `bucket_id = 'videos'` and first folder name = `auth.uid()::text`
- **UPDATE / DELETE** same ownership rule

Publish path used by the app: `{user_id}/{timestamp}.{ext}` via `lib/videos.ts`.

## Dashboard checklist (verify before blaming the app)

- [ ] **API**: Project URL + anon (publishable) key match EAS `EXPO_PUBLIC_*` / local `.env`
- [ ] **Auth → Providers**: Email (+ Google if used). For email MVP, disable “Confirm email”
- [ ] **Auth → Google**: Web client ID matches `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` (see `GOOGLE_AUTH.md`)
- [ ] **Table Editor**: `profiles`, `videos`, `likes`, `comments`, `follows`, `notifications`, `reports`, `blocks`
- [ ] **RLS**: enabled on those tables; policies from 001/002 present
- [ ] **Storage**: bucket `videos` exists, **Public**, policies as above
- [ ] Empty `videos` table ⇒ empty in-app feed (by design — not demo injection)

## EAS

Preview/production must define:

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`

Do **not** set `EXPO_PUBLIC_USE_MOCK=1` on EAS if you want the real backend.

JS changes to `lib/supabase.ts` / feed require a **new EAS build** (or EAS Update if configured). Env-only changes also require rebuild for embedded `EXPO_PUBLIC_*`.

## Crash risks & mitigations

| Risk | Mitigation |
|------|------------|
| Node `ws` / `stream` crash (historical Expo Go / RN) | Metro stubs `ws`, `zlib`, maps `stream` → `readable-stream`, stubs `@supabase/realtime-js` |
| Realtime features missing | Intentional — engagement uses REST; no live postgres_changes |
| Storage missing / RLS deny | Publish throws; feed shows error string, not silent demo swap |
| JWT too large for SecureStore | Falls back to AsyncStorage (&lt; 2000 chars use SecureStore) |
| Offline / network | `feedError` set; previous remote list kept; ErrorBoundary still wraps root |

Force mock anytime with `EXPO_PUBLIC_USE_MOCK=1` if a device still misbehaves.
