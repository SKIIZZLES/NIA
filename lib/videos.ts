/**
 * Accès vidéos Supabase (list + upload) — no-op si client null.
 */
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';
import type { VideoItem } from '@/data/mockVideos';
import type { ProfileRow, VideoRow } from '@/types/database';

type VideoWithProfile = VideoRow & {
  profiles: Pick<ProfileRow, 'username' | 'avatar_url'> | null;
};

function guessTab(region: string | null, tag: string | null): VideoItem['tab'] {
  const hay = `${region || ''} ${tag || ''}`.toLowerCase();
  if (hay.includes('afrique') || hay.includes('africa')) return 'afrique';
  if (hay.includes('abo')) return 'abonnements';
  if (hay.includes('découv') || hay.includes('decouv')) return 'decouvrir';
  return 'pour-toi';
}

export function mapRowToVideoItem(row: VideoWithProfile, publicUrl: string): VideoItem {
  const username = row.profiles?.username || 'createur';
  return {
    id: row.id,
    videoUrl: publicUrl,
    thumbnailUrl: publicUrl, // courte vidéo / image ; thumbnails dédiés plus tard
    handle: `@${username}`,
    caption: row.caption || '',
    likes: row.like_count ?? 0,
    comments: 0,
    shares: 0,
    avatarUrl:
      row.profiles?.avatar_url ||
      `https://i.pravatar.cc/150?u=${encodeURIComponent(username)}`,
    tab: guessTab(row.region, row.tag),
    country: row.region || undefined,
  };
}

export async function fetchVideosFromSupabase(): Promise<VideoItem[]> {
  const sb = getSupabase();
  if (!sb) return [];

  const { data, error } = await sb
    .from('videos')
    .select('*, profiles(username, avatar_url)')
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) throw error;

  const rows = (data || []) as unknown as VideoWithProfile[];
  return rows.map((row) => {
    const { data: urlData } = sb.storage.from('videos').getPublicUrl(row.storage_path);
    return mapRowToVideoItem(row, urlData.publicUrl);
  });
}

function extFromUri(uri: string, mime?: string | null): string {
  if (mime?.includes('png')) return 'png';
  if (mime?.includes('webp')) return 'webp';
  if (mime?.includes('jpeg') || mime?.includes('jpg')) return 'jpg';
  if (mime?.includes('quicktime')) return 'mov';
  if (mime?.includes('webm')) return 'webm';
  const m = uri.match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
  if (m) return m[1].toLowerCase();
  return 'mp4';
}

export type UploadVideoInput = {
  userId: string;
  localUri: string;
  caption: string;
  region?: string;
  tag?: string;
  mimeType?: string | null;
  username?: string;
  avatarUrl?: string;
};

export async function uploadVideoToSupabase(
  input: UploadVideoInput,
): Promise<VideoItem> {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase non configuré');

  const ext = extFromUri(input.localUri, input.mimeType);
  const path = `${input.userId}/${Date.now()}.${ext}`;
  const contentType =
    input.mimeType ||
    (ext === 'png'
      ? 'image/png'
      : ext === 'jpg' || ext === 'jpeg'
        ? 'image/jpeg'
        : ext === 'webp'
          ? 'image/webp'
          : 'video/mp4');

  const response = await fetch(input.localUri);
  const blob = await response.blob();

  const { error: upErr } = await sb.storage.from('videos').upload(path, blob, {
    contentType,
    upsert: false,
  });
  if (upErr) throw upErr;

  const { data: inserted, error: insErr } = await sb
    .from('videos')
    .insert({
      user_id: input.userId,
      storage_path: path,
      caption: input.caption || 'Nouvelle vidéo NIA ✨',
      region: input.region || null,
      tag: input.tag || null,
    })
    .select('*, profiles(username, avatar_url)')
    .single();

  if (insErr) throw insErr;

  const row = inserted as unknown as VideoWithProfile;
  const { data: urlData } = sb.storage.from('videos').getPublicUrl(path);
  const item = mapRowToVideoItem(row, urlData.publicUrl);
  // fallback profil si join pas encore visible
  if (!row.profiles && input.username) {
    item.handle = `@${input.username}`;
    item.avatarUrl = input.avatarUrl || item.avatarUrl;
  }
  return item;
}

export { isSupabaseConfigured };
