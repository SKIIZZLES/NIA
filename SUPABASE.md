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
3. `supabase/migrations/003_reposts.sql` — `reposts` table + RLS, `videos.repost_of`, `videos.share_count`, share_count trigger
4. `supabase/migrations/004_saves.sql` — `saves` bookmarks + RLS, `videos.save_count` + trigger
5. `supabase/migrations/005_archive_delete.sql` — status `deleted`, tighten SELECT RLS (published public; owner sees own non-deleted)
6. `supabase/migrations/006_videos_rls_insert.sql` — **REQUIRED for publish** — recreate videos INSERT/SELECT/UPDATE/DELETE RLS

Re-run in SQL Editor only if a fresh project is created (001 → 002 → 003 → 004 → 005 → 006).

### Apply 003 (reposts) on the live project

Dashboard → **SQL Editor** → paste / run `supabase/migrations/003_reposts.sql` once.

Until 003 is applied, the in-app **Republier** button will surface a migration error (table/column missing). After apply, republications insert into `reposts` and create a lightweight `videos` row (`repost_of` → original) for the feed « a republié » UI.

### Apply 004 (saves / bookmarks)

Dashboard → **SQL Editor** → run `supabase/migrations/004_saves.sql` once.

Creates `public.saves` (PK `user_id`, `video_id`) + RLS + `videos.save_count` trigger. Until applied, the bookmark button falls back to AsyncStorage local saves.

### Apply 005 (archive / soft-delete)

Dashboard → **SQL Editor** → run `supabase/migrations/005_archive_delete.sql` once.

Extends `videos.status` with `'deleted'` ( `'archived'` already from 002). Replaces `videos_select_public` so anon/public only see `published`; owners still SELECT their own non-deleted rows (archived included). Soft delete / archive are UPDATEs via `videos_update_own`.


### Apply 006 (videos RLS INSERT — publish fix)

Dashboard → **SQL Editor** → run `supabase/migrations/006_videos_rls_insert.sql` once.

**Symptom fixed:** `new row violates row-level security policy for table "videos"` on publish.

Recreates (does **not** disable RLS):

- `videos_select_public` — same as 005: `published` public; owner sees own non-`deleted`
- `videos_insert_own` — `TO authenticated` WITH CHECK `auth.uid() = user_id`
- `videos_update_own` / `videos_delete_own` — owner only (`auth.uid() = user_id`)

Creator column is **`user_id`** (not `creator_id`). Client insert uses `session.user.id` for `user_id` + Storage path `{user_id}/…`.

Until 006 is applied on the live project, authenticated publish / repost row inserts into `videos` may keep failing with RLS 42501.

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

**Android / RN note:** never upload `fetch(uri).blob()` as-is — Blob.type is often `text/plain` and storage-js FormData ignores the `contentType` option, so Storage rejects with “mime type text/plain is not supported”. The app uploads an `ArrayBuffer` with an explicit Content-Type inferred from picker mime / fileName / extension / media kind.

## Dashboard checklist (verify before blaming the app)

- [ ] **API**: Project URL + anon (publishable) key match EAS `EXPO_PUBLIC_*` / local `.env`
- [ ] **Auth → Providers**: Email (+ Google if used). For email MVP, disable “Confirm email”
- [ ] **Auth → Google**: Web client ID matches `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` (see `GOOGLE_AUTH.md`)
- [ ] **Table Editor**: `profiles`, `videos`, `likes`, `comments`, `follows`, `notifications`, `reports`, `blocks`, `reposts`, `saves`
- [ ] **RLS**: enabled on those tables; policies from 001/002 present
- [ ] **Storage**: bucket `videos` exists, **Public**, policies as above
- [ ] Empty `videos` table ⇒ empty in-app feed **without** « Connexion limitée » (by design — not demo injection)
- [ ] RLS: `profiles_select_public` anon OK; `videos` policies from **006** (INSERT own, SELECT published/owner, UPDATE/DELETE own)
- [ ] If feed still errors: copy the message under « Aucune vidéo » (now includes PostgREST `code` + `message`)

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
| Offline / network | `feedError` set with mapped message (réseau / RLS / schéma / API); previous remote list kept; ErrorBoundary still wraps root |
| Feed `PGRST201` (ambiguous embed) | Client uses `profiles!videos_user_id_fkey(...)` — required once `likes` exists (videos↔profiles many-to-many via likes) |

Force mock anytime with `EXPO_PUBLIC_USE_MOCK=1` if a device still misbehaves.
