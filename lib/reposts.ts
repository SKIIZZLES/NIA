/**
 * Reposts / republications — table `reposts` + ligne `videos` (repost_of) pour le feed.
 */
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';
import {
  VIDEO_PROFILE_SELECT,
  mapRowToVideoItem,
} from '@/lib/videos';
import type { VideoItem } from '@/data/mockVideos';
import type { ProfileRow, VideoRow } from '@/types/database';

type VideoWithProfile = VideoRow & {
  profiles: Pick<ProfileRow, 'username' | 'avatar_url' | 'display_name'> | null;
};

export type RepostResult =
  | { ok: true; item: VideoItem; mock?: boolean; already?: boolean }
  | { ok: false; message: string };

function isPersistableId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    id,
  );
}

/** Resolve root original if the card is already a repost. */
function resolveOriginalId(item: VideoItem): string {
  return item.repostOf || item.id;
}

/**
 * Republish a video into the feed.
 * - Inserts into `reposts` (unique per user × original).
 * - Creates a lightweight `videos` row pointing at the same storage + `repost_of`.
 * Mock / non-UUID: local feed item only.
 */
export async function createRepost(
  userId: string,
  item: VideoItem,
  opts?: { username?: string; avatarUrl?: string },
): Promise<RepostResult> {
  if (!userId) {
    return { ok: false, message: 'login_required' };
  }

  const originalId = resolveOriginalId(item);
  const username = opts?.username || 'moi';
  const avatarUrl =
    opts?.avatarUrl ||
    `https://i.pravatar.cc/150?u=${encodeURIComponent(username)}`;

  // Mock / local ids
  if (
    !isSupabaseConfigured ||
    userId.startsWith('mock_') ||
    !isPersistableId(originalId)
  ) {
    const local: VideoItem = {
      ...item,
      id: `repost_${Date.now()}`,
      handle: `@${username}`,
      avatarUrl,
      userId,
      likes: 0,
      comments: 0,
      shares: (item.shares || 0) + 1,
      repostOf: originalId,
      originalHandle: item.originalHandle || item.handle,
      caption: item.caption,
    };
    return { ok: true, item: local, mock: true };
  }

  const sb = getSupabase();
  if (!sb) return { ok: false, message: 'Supabase non configuré' };

  // 1) Canonical repost row
  const { error: repostErr } = await sb.from('reposts').insert({
    user_id: userId,
    video_id: originalId,
  });

  if (repostErr) {
    if (repostErr.code === '23505') {
      return {
        ok: false,
        message: 'already',
      };
    }
    // Table missing → soft message
    if (
      repostErr.code === '42P01' ||
      repostErr.message?.includes('does not exist')
    ) {
      return {
        ok: false,
        message:
          'Migration 003_reposts.sql non appliquée. Voyez SUPABASE.md.',
      };
    }
    return { ok: false, message: repostErr.message || 'repost_fail' };
  }

  // 2) Load original row for storage / meta
  const { data: orig, error: origErr } = await sb
    .from('videos')
    .select(VIDEO_PROFILE_SELECT)
    .eq('id', originalId)
    .maybeSingle();

  if (origErr || !orig) {
    return {
      ok: false,
      message: origErr?.message || 'Vidéo originale introuvable',
    };
  }

  const original = orig as unknown as VideoWithProfile;
  const originalHandle = original.profiles?.username
    ? `@${original.profiles.username}`
    : item.originalHandle || item.handle;

  const insertPayload: Record<string, unknown> = {
    user_id: userId,
    storage_path: original.storage_path,
    thumbnail_url: original.thumbnail_url,
    media_type: (original as { media_type?: string }).media_type || 'video',
    cover_path: (original as { cover_path?: string | null }).cover_path ?? null,
    caption: original.caption,
    region: original.region,
    tag: original.tag,
    category: original.category,
    hashtags: original.hashtags,
    status: 'published',
    repost_of: originalId,
  };

  const { data: inserted, error: insErr } = await sb
    .from('videos')
    .insert(insertPayload as never)
    .select(VIDEO_PROFILE_SELECT)
    .single();

  if (insErr) {
    // Rollback canonical row so user can retry
    await sb
      .from('reposts')
      .delete()
      .eq('user_id', userId)
      .eq('video_id', originalId);
    return { ok: false, message: insErr.message || 'repost_fail' };
  }

  const row = inserted as unknown as VideoWithProfile;
  const { data: urlData } = sb.storage
    .from('videos')
    .getPublicUrl(row.storage_path);
  const mapped = mapRowToVideoItem(row, urlData.publicUrl);
  mapped.repostOf = originalId;
  mapped.originalHandle = originalHandle;
  mapped.shares = (original.share_count ?? item.shares ?? 0) + 1;

  if (!row.profiles) {
    mapped.handle = `@${username}`;
    mapped.avatarUrl = avatarUrl;
  }

  return { ok: true, item: mapped };
}

export async function fetchRepostedVideoIds(userId: string): Promise<string[]> {
  const sb = getSupabase();
  if (!sb || !userId || userId.startsWith('mock_')) return [];
  const { data, error } = await sb
    .from('reposts')
    .select('video_id')
    .eq('user_id', userId);
  if (error) return [];
  return (data || []).map((r) => r.video_id);
}
