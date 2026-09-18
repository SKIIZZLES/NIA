/**
 * Accès vidéos Supabase (list + upload + filtre catégorie) — no-op si client null.
 */
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';
import type { VideoItem } from '@/data/mockVideos';
import type { CategoryId } from '@/constants/categories';
import { isCategoryId } from '@/constants/categories';
import { parseHashtags } from '@/constants/publish';
import type { ProfileRow, VideoRow } from '@/types/database';

/**
 * Disambiguate videos→profiles embed.
 * After `likes` exists, PostgREST also sees a many-to-many videos↔profiles
 * path and returns PGRST201 unless the FK is named explicitly.
 */
export const VIDEO_PROFILE_SELECT =
  '*, profiles!videos_user_id_fkey(username, avatar_url, display_name)';

export const VIDEO_PROFILE_SELECT_LEGACY =
  '*, profiles!videos_user_id_fkey(username, avatar_url)';

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
  if (hay.includes('maghreb') || hay.includes('maroc') || hay.includes('morocco') || hay.includes('algér') || hay.includes('alger') || hay.includes('tunis'))
    return 'maghreb';
  if (hay.includes('actus') || hay.includes('actu') || hay.includes('news') || hay.includes('info'))
    return 'actus';
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
    shares: row.share_count ?? 0,
    avatarUrl:
      row.profiles?.avatar_url ||
      `https://i.pravatar.cc/150?u=${encodeURIComponent(username)}`,
    tab: guessTab(row.region, row.tag, row.category),
    country: row.region || undefined,
    category: resolveCategory(row.category, row.tag, row.region),
    userId: row.user_id,
    repostOf: row.repost_of || undefined,
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
    .select(VIDEO_PROFILE_SELECT)
    .eq('status', 'published')
    .order('created_at', { ascending: false })
    .limit(options?.limit ?? 20);

  if (options?.category) {
    query = query.eq('category', options.category);
  }

  const { data, error } = await query;

  if (error) {
    // status/category absents si 002 pas encore joué — retry soft sans filtre
    if (options?.category || error.message?.includes('status')) {
      const fallback = await sb
        .from('videos')
        .select(VIDEO_PROFILE_SELECT_LEGACY)
        .order('created_at', { ascending: false })
        .limit(options?.limit ?? 20);
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
  const items = rows.map((row) => {
    const { data: urlData } = sb.storage.from('videos').getPublicUrl(row.storage_path);
    return mapRowToVideoItem(row, urlData.publicUrl);
  });
  return enrichRepostOriginalHandles(sb, items, rows);
}

async function enrichRepostOriginalHandles(
  sb: NonNullable<ReturnType<typeof getSupabase>>,
  items: VideoItem[],
  rows: VideoWithProfile[],
): Promise<VideoItem[]> {
  const originalIds = [
    ...new Set(
      rows
        .map((r) => r.repost_of)
        .filter((id): id is string => typeof id === 'string' && !!id),
    ),
  ];
  if (!originalIds.length) return items;

  const { data: originals } = await sb
    .from('videos')
    .select('id, profiles!videos_user_id_fkey(username)')
    .in('id', originalIds);

  if (!originals?.length) return items;

  const handleById = new Map<string, string>();
  for (const o of originals as unknown as {
    id: string;
    profiles: { username: string | null } | null;
  }[]) {
    if (o.profiles?.username) {
      handleById.set(o.id, `@${o.profiles.username}`);
    }
  }

  return items.map((item) => {
    if (!item.repostOf) return item;
    const h = handleById.get(item.repostOf);
    return h ? { ...item, originalHandle: h } : item;
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
    .select(VIDEO_PROFILE_SELECT)
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

/**
 * Map Supabase / network failures to UI copy.
 * Empty successful responses must NOT use this — callers keep feedError null.
 */
export function formatFeedLoadError(err: unknown): string {
  const anyErr = err as { message?: unknown; code?: unknown; details?: unknown } | null;
  const msg =
    typeof anyErr?.message === 'string' && anyErr.message.trim()
      ? anyErr.message.trim()
      : err instanceof Error && err.message
        ? err.message
        : 'Erreur inconnue';
  const code = anyErr?.code != null ? String(anyErr.code) : '';
  const lower = msg.toLowerCase();

  if (
    lower.includes('network request failed') ||
    lower.includes('failed to fetch') ||
    lower.includes('network error') ||
    lower.includes('fetch failed') ||
    code === 'ENOTFOUND' ||
    code === 'ECONNREFUSED' ||
    code === 'ETIMEDOUT'
  ) {
    return `Réseau indisponible. ${msg}`;
  }

  if (
    code === '42501' ||
    lower.includes('row-level security') ||
    lower.includes('permission denied') ||
    lower.includes('rls')
  ) {
    return `Accès refusé (RLS). ${msg}`;
  }

  if (
    code === 'PGRST301' ||
    lower.includes('jwt') ||
    lower.includes('invalid api key') ||
    lower.includes('invalid authentication')
  ) {
    return `Clé / session API. ${msg}`;
  }

  if (code === 'PGRST201' || lower.includes('more than one relationship')) {
    return `Relation feed ambiguë. ${msg}`;
  }

  if (
    code === '42P01' ||
    code === 'PGRST205' ||
    lower.includes('does not exist') ||
    lower.includes('schema cache')
  ) {
    return `Schéma / migration manquante. ${msg}`;
  }

  const codePrefix = code ? `[${code}] ` : '';
  return `Impossible de charger le feed. ${codePrefix}${msg}`;
}

export { isSupabaseConfigured, parseHashtags };
