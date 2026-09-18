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

/** Extensions → MIME alignés bucket `videos` (001_nia_init). */
const EXT_TO_MIME: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  qt: 'video/quicktime',
  webm: 'video/webm',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

const MIME_TO_EXT: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

function stripMimeParams(mime: string): string {
  return mime.split(';')[0].trim().toLowerCase();
}

function isUsableMime(mime: string | null | undefined): mime is string {
  if (!mime) return false;
  const cleaned = stripMimeParams(mime);
  if (!cleaned || cleaned === 'application/octet-stream') return false;
  // RN Android fetch(file).blob() often reports text/plain — never trust it.
  if (cleaned === 'text/plain' || cleaned.startsWith('text/')) return false;
  return true;
}

function extFromName(name: string): string | null {
  const m = name.match(/\.([a-zA-Z0-9]+)(?:\?|#|$)/);
  return m ? m[1].toLowerCase() : null;
}

/**
 * Resolve a Storage-safe Content-Type.
 * Prefer picker mimeType, then fileName/URI extension, then mediaKind.
 * Never returns text/plain.
 */
export function resolveUploadContentType(input: {
  mimeType?: string | null;
  localUri: string;
  fileName?: string | null;
  mediaKind?: 'image' | 'video' | 'unknown' | null;
}): { contentType: string; ext: string } {
  let mime: string | null = null;

  if (isUsableMime(input.mimeType)) {
    mime = stripMimeParams(input.mimeType);
    if (mime === 'image/jpg') mime = 'image/jpeg';
  }

  if (!mime) {
    const fromFile = input.fileName ? extFromName(input.fileName) : null;
    const fromUri = extFromName(input.localUri);
    const ext = fromFile || fromUri;
    if (ext && EXT_TO_MIME[ext]) {
      mime = EXT_TO_MIME[ext];
    }
  }

  if (!mime) {
    if (input.mediaKind === 'image') mime = 'image/jpeg';
    else mime = 'video/mp4'; // short-video default when Android omits mime + ext
  }

  const ext =
    MIME_TO_EXT[mime] ||
    (mime.startsWith('image/')
      ? 'jpg'
      : mime.includes('quicktime')
        ? 'mov'
        : mime.includes('webm')
          ? 'webm'
          : 'mp4');

  return { contentType: mime, ext };
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
  /** expo-image-picker fileName — useful when URI is content:// without extension */
  fileName?: string | null;
  /** Picker asset.type / inferred kind — fallback when mime + extension missing */
  mediaKind?: 'image' | 'video' | 'unknown' | null;
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

  const { contentType, ext } = resolveUploadContentType({
    mimeType: input.mimeType,
    localUri: input.localUri,
    fileName: input.fileName,
    mediaKind: input.mediaKind,
  });

  const path = `${input.userId}/${Date.now()}.${ext}`;

  // Critical: do NOT upload a Blob from fetch(uri).blob() on RN Android.
  // Blob.type is often "text/plain", and @supabase/storage-js FormData path
  // uses Blob.type and ignores the contentType option → Storage rejects with
  // "mime type text/plain is not supported". ArrayBuffer sets Content-Type header.
  const response = await fetch(input.localUri);
  if (!response.ok) {
    throw new Error(`Impossible de lire le média local (${response.status})`);
  }
  const arrayBuffer = await response.arrayBuffer();

  const { error: upErr } = await sb.storage.from('videos').upload(path, arrayBuffer, {
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
