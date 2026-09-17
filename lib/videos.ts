/**
 * Accès vidéos Supabase (list + upload + filtre catégorie) — no-op si client null.
 */
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';
import type { VideoItem } from '@/data/mockVideos';
import type { CategoryId } from '@/constants/categories';
import { isCategoryId } from '@/constants/categories';
import { parseHashtags } from '@/constants/publish';
import type { ProfileRow, VideoRow } from '@/types/database';

type VideoWithProfile = VideoRow & {
  profiles: Pick<ProfileRow, 'username' | 'avatar_url' | 'display_name'> | null;
};

function guessTab(
  region: string | null,
  tag: string | null,
  category: string | null,
): VideoItem['tab'] {
  const hay = `${region || ''} ${tag || ''} ${category || ''}`.toLowerCase();
  if (hay.includes('afrique') || hay.includes('africa')) return 'afrique';
  if (hay.includes('abo')) return 'abonnements';
  if (hay.includes('découv') || hay.includes('decouv')) return 'decouvrir';
  return 'pour-toi';
}

function resolveCategory(
  category: string | null,
  tag: string | null,
  region: string | null,
): CategoryId | undefined {
  if (isCategoryId(category)) return category;
  const hay = `${tag || ''} ${region || ''}`.toLowerCase();
  if (hay.includes('afrique') || hay.includes('africa')) return 'afrique';
  if (hay.includes('diaspora')) return 'diaspora';
  if (hay.includes('musique') || hay.includes('music') || hay.includes('beat'))
    return 'musique';
  if (hay.includes('culture') || hay.includes('danse')) return 'culture';
  if (hay.includes('mode') || hay.includes('style')) return 'mode';
  if (hay.includes('tech')) return 'tech';
  if (hay.includes('food') || hay.includes('gastro')) return 'food';
  if (hay.includes('sport')) return 'sport';
  return undefined;
}

export function mapRowToVideoItem(row: VideoWithProfile, publicUrl: string): VideoItem {
  const username = row.profiles?.username || 'createur';
  const thumb = row.thumbnail_url || publicUrl;
  return {
    id: row.id,
    videoUrl: publicUrl,
    thumbnailUrl: thumb,
    handle: `@${username}`,
    caption: row.caption || '',
    likes: row.like_count ?? 0,
    comments: 0,
    shares: 0,
    avatarUrl:
      row.profiles?.avatar_url ||
      `https://i.pravatar.cc/150?u=${encodeURIComponent(username)}`,
    tab: guessTab(row.region, row.tag, row.category),
    country: row.region || undefined,
    category: resolveCategory(row.category, row.tag, row.region),
    userId: row.user_id,
  };
}

export async function fetchVideosFromSupabase(options?: {
  category?: string | null;
  limit?: number;
}): Promise<VideoItem[]> {
  const sb = getSupabase();
  if (!sb) return [];

  let query = sb
    .from('videos')
    .select('*, profiles(username, avatar_url, display_name)')
    .eq('status', 'published')
    .order('created_at', { ascending: false })
    .limit(options?.limit ?? 50);

  if (options?.category) {
    query = query.eq('category', options.category);
  }

  const { data, error } = await query;

  if (error) {
    // status/category absents si 002 pas encore joué — retry soft sans filtre
    if (options?.category || error.message?.includes('status')) {
      const fallback = await sb
        .from('videos')
        .select('*, profiles(username, avatar_url)')
        .order('created_at', { ascending: false })
        .limit(options?.limit ?? 50);
      if (fallback.error) throw fallback.error;
      const rows = (fallback.data || []) as unknown as VideoWithProfile[];
      return rows
        .map((row) => {
          const { data: urlData } = sb.storage.from('videos').getPublicUrl(row.storage_path);
          return mapRowToVideoItem(row, urlData.publicUrl);
        })
        .filter((v) => !options?.category || v.category === options.category);
    }
    throw error;
  }

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
  category?: string;
  hashtags?: string[];
  mimeType?: string | null;
  username?: string;
  avatarUrl?: string;
  /** Statut DB — défaut published (pas de transcoder) */
  status?: 'published' | 'processing' | 'draft';
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

  const { data: urlData } = sb.storage.from('videos').getPublicUrl(path);

  const insertPayload: Record<string, unknown> = {
    user_id: input.userId,
    storage_path: path,
    caption: input.caption || 'Nouvelle vidéo NIA ✨',
    region: input.region || null,
    tag: input.tag || null,
    category: input.category || input.tag || null,
    hashtags: input.hashtags?.length ? input.hashtags : null,
    thumbnail_url: urlData.publicUrl,
    status: input.status || 'published',
  };

  const { data: inserted, error: insErr } = await sb
    .from('videos')
    .insert(insertPayload as never)
    .select('*, profiles(username, avatar_url, display_name)')
    .single();

  if (insErr) throw insErr;

  const row = inserted as unknown as VideoWithProfile;
  const item = mapRowToVideoItem(row, urlData.publicUrl);
  if (!row.profiles && input.username) {
    item.handle = `@${input.username}`;
    item.avatarUrl = input.avatarUrl || item.avatarUrl;
  }
  return item;
}

export { isSupabaseConfigured, parseHashtags };
