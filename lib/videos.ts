/**
 * Accès vidéos Supabase (list + upload + filtre catégorie) — no-op si client null.
 */
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';
import type { VideoItem } from '@/data/mockVideos';
import type { CategoryId } from '@/constants/categories';
import { isCategoryId } from '@/constants/categories';
import { parseHashtags } from '@/constants/publish';
import type { ProfileRow, VideoRow } from '@/types/database';
import { isLikelyVideoUrl } from '@/lib/mediaThumb';

/**
 * Disambiguate videos→profiles embed.
 * After `likes` exists, PostgREST also sees a many-to-many videos↔profiles
 * path and returns PGRST201 unless the FK is named explicitly.
 */
export const VIDEO_PROFILE_SELECT =
  '*, profiles!videos_user_id_fkey(username, avatar_url, display_name), sounds(id, title, user_id, profiles!sounds_user_id_fkey(username))';

export const VIDEO_PROFILE_SELECT_LEGACY =
  '*, profiles!videos_user_id_fkey(username, avatar_url)';

export const VIDEO_PROFILE_SELECT_NO_SOUND =
  '*, profiles!videos_user_id_fkey(username, avatar_url, display_name)';

type SoundEmbed = {
  id: string;
  title: string;
  user_id: string;
  profiles: { username: string | null } | null;
} | null;

type VideoWithProfile = VideoRow & {
  profiles: Pick<ProfileRow, 'username' | 'avatar_url' | 'display_name'> | null;
  sounds?: SoundEmbed;
  sound_id?: string | null;
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
  const mediaType: 'video' | 'image' =
    (row as { media_type?: string }).media_type === 'image' ? 'image' : 'video';

  // Never fall back to a video public URL for Image grids.
  let thumb = row.thumbnail_url || '';
  if (mediaType === 'image') {
    thumb = row.thumbnail_url || publicUrl;
  } else if (thumb && isLikelyVideoUrl(thumb)) {
    thumb = '';
  }
  if (thumb && isLikelyVideoUrl(thumb)) {
    thumb = '';
  }

  return {
    id: row.id,
    videoUrl: publicUrl,
    thumbnailUrl: thumb,
    mediaType,
    handle: `@${username}`,
    caption: row.caption || '',
    likes: row.like_count ?? 0,
    comments: 0,
    shares: row.share_count ?? 0,
    saves: (row as { save_count?: number }).save_count ?? 0,
    status: row.status || 'published',
    avatarUrl:
      row.profiles?.avatar_url ||
      `https://i.pravatar.cc/150?u=${encodeURIComponent(username)}`,
    tab: guessTab(row.region, row.tag, row.category),
    country: row.region || undefined,
    category: resolveCategory(row.category, row.tag, row.region),
    userId: row.user_id,
    repostOf: row.repost_of || undefined,
    soundId: row.sounds?.id || row.sound_id || undefined,
    soundTitle: row.sounds?.title || undefined,
    soundCreatorHandle: row.sounds?.profiles?.username
      ? `@${row.sounds.profiles.username}`
      : undefined,
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

  let data: unknown = null;
  let error: { message?: string; code?: string } | null = null;
  {
    const first = await query;
    data = first.data;
    error = first.error;
  }

  // Soft fallback if 008_sounds not applied (sounds embed / column missing)
  if (
    error &&
    (error.message?.includes('sounds') ||
      error.message?.includes('sound_id') ||
      error.code === 'PGRST200' ||
      error.code === 'PGRST204' ||
      error.code === '42703')
  ) {
    let retry = sb
      .from('videos')
      .select(VIDEO_PROFILE_SELECT_NO_SOUND)
      .eq('status', 'published')
      .order('created_at', { ascending: false })
      .limit(options?.limit ?? 20);
    if (options?.category) retry = retry.eq('category', options.category);
    const fb = await retry;
    data = fb.data;
    error = fb.error;
  }

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
  /** Optional cover/still for videos (ImagePicker image URI) */
  coverUri?: string | null;
  coverMimeType?: string | null;
  coverFileName?: string | null;
  username?: string;
  avatarUrl?: string;
  /** Statut DB — défaut published (pas de transcoder) */
  status?: 'published' | 'processing' | 'draft';
  /** Optional linked sound (008) */
  soundId?: string | null;
};

export async function uploadVideoToSupabase(
  input: UploadVideoInput,
): Promise<VideoItem> {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase non configuré');

  // RLS videos_insert_own requires user_id = auth.uid() — prefer live session.
  const { data: sessionData } = await sb.auth.getSession();
  const sessionUserId = sessionData.session?.user?.id;
  if (!sessionUserId) {
    throw new Error('Session expirée. Reconnectez-vous pour publier.');
  }
  if (input.userId && input.userId !== sessionUserId) {
    throw new Error('Identifiant créateur incohérent avec la session.');
  }
  const creatorId = sessionUserId;

  const { contentType, ext } = resolveUploadContentType({
    mimeType: input.mimeType,
    localUri: input.localUri,
    fileName: input.fileName,
    mediaKind: input.mediaKind,
  });

  const path = `${creatorId}/${Date.now()}.${ext}`;

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
  const publicUrl = urlData.publicUrl;

  const mediaType: 'video' | 'image' =
    input.mediaKind === 'image' || contentType.startsWith('image/')
      ? 'image'
      : 'video';

  // Cover / poster (optional for videos). Always an image file in the videos bucket.
  let coverPath: string | null = null;
  let thumbnailUrl: string | null = null;

  if (mediaType === 'image') {
    // Image posts: the media itself is the thumb — safe for <Image />.
    thumbnailUrl = publicUrl;
  } else if (input.coverUri) {
    const coverResolved = resolveUploadContentType({
      mimeType: input.coverMimeType,
      localUri: input.coverUri,
      fileName: input.coverFileName,
      mediaKind: 'image',
    });
    const coverExt = coverResolved.ext.match(/^(jpe?g|png|webp)$/i)
      ? coverResolved.ext
      : 'jpg';
    coverPath = `${creatorId}/covers/${Date.now()}.${coverExt}`;
    const coverRes = await fetch(input.coverUri);
    if (!coverRes.ok) {
      throw new Error(`Impossible de lire la cover (${coverRes.status})`);
    }
    const coverBuf = await coverRes.arrayBuffer();
    const { error: coverErr } = await sb.storage
      .from('videos')
      .upload(coverPath, coverBuf, {
        contentType: coverResolved.contentType.startsWith('image/')
          ? coverResolved.contentType
          : 'image/jpeg',
        upsert: false,
      });
    if (coverErr) throw coverErr;
    const { data: coverUrlData } = sb.storage.from('videos').getPublicUrl(coverPath);
    thumbnailUrl = coverUrlData.publicUrl;
  } else {
    // Video without cover: leave thumbnail_url null (grids show NIA placeholder).
    // NEVER set thumbnail_url to the .mp4 public URL.
    thumbnailUrl = null;
  }

  const insertPayload: Record<string, unknown> = {
    user_id: creatorId,
    storage_path: path,
    caption: input.caption || 'Nouvelle vidéo NIA ✨',
    region: input.region || null,
    tag: input.tag || null,
    category: input.category || input.tag || null,
    hashtags: input.hashtags?.length ? input.hashtags : null,
    thumbnail_url: thumbnailUrl,
    media_type: mediaType,
    cover_path: coverPath,
    status: input.status || 'published',
    sound_id: input.soundId || null,
  };

  let { data: inserted, error: insErr } = await sb
    .from('videos')
    .insert(insertPayload as never)
    .select(VIDEO_PROFILE_SELECT_NO_SOUND)
    .single();

  // Soft fallback if migration 007 not applied yet (unknown columns).
  if (
    insErr &&
    (insErr.message?.includes('media_type') ||
      insErr.message?.includes('cover_path') ||
      insErr.code === 'PGRST204' ||
      insErr.code === '42703')
  ) {
    const legacyPayload = { ...insertPayload };
    delete legacyPayload.media_type;
    delete legacyPayload.cover_path;
    delete legacyPayload.sound_id;
    // Still never store a video URL as thumbnail_url.
    if (mediaType === 'video' && legacyPayload.thumbnail_url && isLikelyVideoUrl(String(legacyPayload.thumbnail_url))) {
      legacyPayload.thumbnail_url = null;
    }
    const retry = await sb
      .from('videos')
      .insert(legacyPayload as never)
      .select(VIDEO_PROFILE_SELECT_NO_SOUND)
      .single();
    inserted = retry.data;
    insErr = retry.error;
  }

  if (insErr) {
    // Retry without sound_id if column missing
    if (
      input.soundId &&
      (insErr.message?.includes('sound_id') ||
        insErr.code === 'PGRST204' ||
        insErr.code === '42703')
    ) {
      const noSound = { ...insertPayload };
      delete noSound.sound_id;
      const retrySound = await sb
        .from('videos')
        .insert(noSound as never)
        .select(VIDEO_PROFILE_SELECT_NO_SOUND)
        .single();
      inserted = retrySound.data;
      insErr = retrySound.error;
    }
  }

  if (insErr) throw insErr;

  if (input.soundId && inserted) {
    try {
      const { incrementSoundUseCount } = await import('@/lib/sounds');
      await incrementSoundUseCount(input.soundId);
    } catch {
      // ignore use_count bump failures
    }
  }

  const row = inserted as unknown as VideoWithProfile;
  // Ensure client-side mediaType even if column missing in SELECT
  if (!(row as { media_type?: string }).media_type) {
    (row as { media_type?: string }).media_type = mediaType;
  }
  if (thumbnailUrl && !row.thumbnail_url) {
    row.thumbnail_url = thumbnailUrl;
  }
  const item = mapRowToVideoItem(row, publicUrl);
  item.mediaType = mediaType;
  if (input.soundId) {
    item.soundId = input.soundId;
  }
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


export type OwnerVideoActionResult =
  | { ok: true; mock?: boolean; status: 'archived' | 'deleted' | 'published' }
  | { ok: false; message: string };

/**
 * Owner-only soft status change (archive / soft-delete / restore publish).
 * Requires videos_update_own RLS + status check including archived|deleted (005).
 */
export async function setVideoStatus(
  userId: string,
  videoId: string,
  status: 'archived' | 'deleted' | 'published',
): Promise<OwnerVideoActionResult> {
  const sb = getSupabase();
  if (!sb || !isSupabaseConfigured || userId.startsWith('mock_')) {
    return { ok: true, mock: true, status };
  }
  if (!userId || !videoId) {
    return { ok: false, message: 'missing_ids' };
  }

  const { data, error } = await sb
    .from('videos')
    .update({ status })
    .eq('id', videoId)
    .eq('user_id', userId)
    .select('id, status')
    .maybeSingle();

  if (error) {
    return { ok: false, message: error.message || 'update_fail' };
  }
  if (!data) {
    return { ok: false, message: 'not_owner_or_missing' };
  }
  return { ok: true, status: data.status as 'archived' | 'deleted' | 'published' };
}

export async function archiveOwnVideo(
  userId: string,
  videoId: string,
): Promise<OwnerVideoActionResult> {
  return setVideoStatus(userId, videoId, 'archived');
}

export async function softDeleteOwnVideo(
  userId: string,
  videoId: string,
): Promise<OwnerVideoActionResult> {
  return setVideoStatus(userId, videoId, 'deleted');
}

/** Alias for profile Archives (désarchiver / supprimer). */
export const updateVideoStatus = setVideoStatus;
