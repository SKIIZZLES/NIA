# NIA — Performance notes

Quick wins landed in this pass, plus gaps for investor-scale (CDN, ABR, edge).

## Done (safe quick wins)

| Area | Change |
|------|--------|
| Feed list | FlatList: `windowSize={3}`, `initialNumToRender={1}`, `maxToRenderPerBatch={2}`, `removeClippedSubviews`, `getItemLayout`, stable `keyExtractor` |
| VideoCard | `React.memo`; pause when `isActive=false` **without** seeking to 0 (less rebuffer on brief off-screen) |
| Duration UI | `timeUpdate` listener only while active (`timeUpdateEventInterval=0.25`) |
| Fetch size | Default feed page **20** videos (was 50); Discover category limit unchanged (30) |
| Images | RN `Image` remote URI caching (disk/memory); no unbounded prefetch of all thumbs |
| Re-renders | FeedPager `renderItem` / `openComments` memoized; viewability via refs |

## Still missing (investor-scale)

1. **CDN + signed URLs** — serve Storage through Cloudflare/Fastly (or Supabase CDN + cache headers); avoid origin hot-linking for every scroll.
2. **Adaptive bitrate / HLS or DASH** — transcode uploads (Mux, Cloudflare Stream, or Supabase + ffmpeg worker) into ladder; `expo-video` against progressive MP4 only today (10 min caps hurt mobile).
3. **Thumbnails pipeline** — generate poster frames server-side; feed should paint thumbs first, then hydrate players for ±1 neighbors only.
4. **Virtualized player pool** — keep 1–3 `VideoPlayer` instances and swap sources instead of one player per list cell (biggest memory win).
5. **Cursor pagination + infinite scroll** — `created_at` / `id` cursor, `onEndReached`, no full-table pull; prefetch next page off-thread.
6. **Edge / regional** — Supabase region close to Maghreb/West Africa users; optional edge functions for feed ranking.
7. **expo-image / blurhash** — replace `Image` with `expo-image` + placeholder for smoother grid/discover (needs dependency + rebuild).
8. **FlashList** — `@shopify/flash-list` once recycling quirks with full-screen video are validated.
9. **Analytics & ranking** — impressions, watch-time, cold-start personalization (not just chronological).
10. **Realtime engagement** — REST-only today; scale likes/comments with batched writes + optimistic UI (already partial).

## Rebuild notes

- JS-only changes (this pass): **EAS Update** sufficient if configured; otherwise new preview build recommended for QA.
- Native deps (`expo-image`, FlashList) would require a **new EAS build**.
- Schema: run `003_reposts.sql` in Supabase SQL Editor (see `SUPABASE.md`) — no app rebuild required for SQL alone.
