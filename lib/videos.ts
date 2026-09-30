/**
 * Accès vidéos Supabase (list + upload + filtre catégorie) — no-op si client null.
 */
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';
import type { VideoItem } from '@/data/mockVideos';
import type { CategoryId } from '@/constants/categories';
import { isCategoryId } from '@/constants/categories';
import { MAX_UPLOAD_BYTES, PUBLISH_ERRORS, parseHashtags } from '@/constants/publish';
import {
  deleteCachedFile,
  localFileSize,
  uploadToStorage,
  type UploadProgress,
} from '@/lib/upload';
import type { ProfileRow, VideoRow } from '@/types/database';
import { isLikelyVideoUrl } from '@/lib/mediaThumb';
import { parseEditMeta, type EditMeta } from '@/lib/editMeta';
import { isRpcMissing } from '@/lib/textFilter';
import { matureError, matureErrorKey } from '@/lib/age';
import { t } from '@/lib/i18n';
import {
  PUBLISH_OPTION_COLUMNS,
  hasRestrictiveOptions,
  isMissingPublishOptionsColumn,
  publishOptionsPayload,
  type PublishOptions,
} from '@/lib/publishOptions';
import type { VideoVisibility } from '@/types/database';

/**
 * Disambiguate videos→profiles embed.
 * After `likes` exists, PostgREST also sees a many-to-many videos↔profiles
 * path and returns PGRST201 unless the FK is named explicitly.
 */
export const VIDEO_PROFILE_SELECT =
  '*, profiles!videos_user_id_fkey(username, avatar_url, display_name), sounds(id, title, user_id, storage_path, profiles!sounds_user_id_fkey(username))';

export const VIDEO_PROFILE_SELECT_LEGACY =
  '*, profiles!videos_user_id_fkey(username, avatar_url)';

export const VIDEO_PROFILE_SELECT_NO_SOUND =
  '*, profiles!videos_user_id_fkey(username, avatar_url, display_name)';

type SoundEmbed = {
  id: string;
  title: string;
  user_id: string;
  /** Fichier audio du son (bucket `videos`) : lu en synchro avec la vidéo. */
  storage_path?: string | null;
  profiles: { username: string | null } | null;
} | null;

/** URL publique du fichier audio d'un son embarqué, ou undefined. */
function soundPublicUrl(storagePath: string | null | undefined): string | undefined {
  if (!storagePath) return undefined;
  const sb = getSupabase();
  if (!sb) return undefined;
  return sb.storage.from('videos').getPublicUrl(storagePath).data.publicUrl || undefined;
}

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

const VISIBILITIES: readonly VideoVisibility[] = ['public', 'followers', 'private'];

/** Options de publication et réglages d'édition d'une ligne (016). */
export function publishOptionsFromRow(row: Partial<VideoRow>): Pick<
  VideoItem,
  | 'visibility'
  | 'allowComments'
  | 'allowReuse'
  | 'aiGenerated'
  | 'isMature'
  | 'altText'
  | 'locationText'
  | 'editMeta'
  | 'overlays'
> {
  const editMeta = parseEditMeta(row.edit_meta);
  const vis = row.visibility;
  return {
    visibility: vis && VISIBILITIES.includes(vis) ? vis : undefined,
    allowComments: typeof row.allow_comments === 'boolean' ? row.allow_comments : undefined,
    allowReuse: typeof row.allow_reuse === 'boolean' ? row.allow_reuse : undefined,
    aiGenerated: row.ai_generated === true ? true : undefined,
    isMature: row.is_mature === true ? true : undefined,
    altText: row.alt_text?.trim() || undefined,
    locationText: row.location_text?.trim() || undefined,
    editMeta,
    overlays: editMeta?.overlays ?? undefined,
  };
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
    soundUrl: soundPublicUrl(row.sounds?.storage_path),
    // 016 : colonnes lues via `*` ; absentes (undefined) si la migration
    // n'est pas appliquée, et l'app garde alors le comportement d'avant.
    ...publishOptionsFromRow(row),
    soundCreatorHandle: row.sounds?.profiles?.username
      ? `@${row.sounds.profiles.username}`
      : undefined,
    filterId: (row as { filter_id?: string | null }).filter_id || undefined,
    moderationState: moderationStateFromRow(row),
    moderationReason: moderationReasonFromRow(row),
  };
}

/** 018 : `moderation_reason` (« auto:keywords » = retenue par le filtre de mots). */
export function moderationReasonFromRow(row: unknown): string | undefined {
  const v = (row as { moderation_reason?: unknown } | null)?.moderation_reason;
  return typeof v === 'string' && v ? v : undefined;
}

/** 017 : `moderation_state` lu via `*` ; undefined si la migration manque. */
export function moderationStateFromRow(row: unknown): VideoItem['moderationState'] {
  const v = (row as { moderation_state?: unknown } | null)?.moderation_state;
  return v === 'visible' || v === 'held' || v === 'removed' ? v : undefined;
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
  /** Optional NIA filter registry id (012) */
  filterId?: string | null;
  /**
   * Identifiant stable du brouillon. Le chemin Storage en dérive, donc deux
   * tentatives pour la même publication visent le même objet : un réessai n'en
   * crée pas un second, et aucun orphelin ne s'accumule.
   */
  uploadId: string;
  /**
   * true dès la deuxième tentative : écrase l'objet éventuellement partiel
   * laissé par la précédente, au lieu d'échouer sur « already exists ».
   */
  overwrite?: boolean;
  /** Progression réelle, en octets remontés par la couche réseau native. */
  onProgress?: (stage: 'media' | 'cover', progress: UploadProgress) => void;
  signal?: AbortSignal;
  /** Options de publication (016). Absentes = comportement d'avant 016. */
  publishOptions?: PublishOptions;
  /** Réglages d'édition (016), null si tout est par défaut. */
  editMeta?: EditMeta | null;
};

/**
 * Chemins Storage déjà téléversés pendant cette session.
 *
 * Sert au réessai : si l'insert échoue après un envoi réussi, la tentative
 * suivante saute le téléversement du fichier — ce qui, pour 50 Mo, est la
 * différence entre un réessai instantané et une minute de réseau. Volontairement
 * en mémoire : après un redémarrage de l'app on re-téléverse, ce qui reste
 * correct puisque `overwrite` rend l'opération idempotente.
 */
const uploadedPaths = new Set<string>();

export async function uploadVideoToSupabase(
  input: UploadVideoInput,
): Promise<VideoItem> {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase non configuré');

  // RLS videos_insert_own requires user_id = auth.uid() — prefer live session.
  const { data: sessionData } = await sb.auth.getSession();
  const sessionUserId = sessionData.session?.user?.id;
  // Le jeton part en en-tête Authorization du POST Storage : les policies RLS
  // sur storage.objects exigent auth.uid(), exactement comme via storage-js.
  const accessToken = sessionData.session?.access_token;
  if (!sessionUserId || !accessToken) {
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

  // Chemin déterministe : même brouillon → même objet, donc réessai idempotent.
  const path = `${creatorId}/${input.uploadId}.${ext}`;

  // Refuser avant d'ouvrir un socket quand la taille réelle dépasse la limite.
  // ImagePicker ne renseigne pas toujours fileSize ; le disque, lui, ne ment pas.
  const realSize = localFileSize(input.localUri);
  if (realSize != null && realSize > MAX_UPLOAD_BYTES) {
    throw new Error(PUBLISH_ERRORS.tooLarge);
  }

  // GARDE-FOU ANDROID — conservé, et resserré.
  // fetch(uri).blob() renvoie souvent Blob.type === "text/plain" sur RN
  // Android ; la branche Blob de @supabase/storage-js en fait un FormData et
  // ignore l'option contentType, d'où le rejet « mime type text/plain is not
  // supported ». Le contournement d'origine passait un ArrayBuffer pour que
  // storage-js pose un en-tête Content-Type explicite — au prix de ~3,3 fois
  // la taille du fichier en mémoire JS.
  // lib/upload.ts pose désormais cet en-tête lui-même, à partir du contentType
  // résolu ci-dessus, et téléverse en streaming depuis le disque. Le type n'est
  // plus jamais déduit du fichier par la plateforme.
  if (!uploadedPaths.has(path)) {
    await uploadToStorage({
      bucket: 'videos',
      path,
      localUri: input.localUri,
      contentType,
      accessToken,
      upsert: input.overwrite ?? false,
      onProgress: input.onProgress
        ? (progress) => input.onProgress?.('media', progress)
        : undefined,
      signal: input.signal,
    });
    uploadedPaths.add(path);
  } else if (realSize != null) {
    // Réessai après un envoi déjà abouti : on ne re-téléverse pas, et on
    // rapporte la taille réelle du fichier plutôt que des octets inventés.
    input.onProgress?.('media', {
      bytesSent: realSize,
      totalBytes: realSize,
      ratio: 1,
    });
  }

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
    coverPath = `${creatorId}/covers/${input.uploadId}.${coverExt}`;
    const coverContentType = coverResolved.contentType.startsWith('image/')
      ? coverResolved.contentType
      : 'image/jpeg';
    if (!uploadedPaths.has(coverPath)) {
      await uploadToStorage({
        bucket: 'videos',
        path: coverPath,
        localUri: input.coverUri,
        contentType: coverContentType,
        accessToken,
        upsert: input.overwrite ?? false,
        onProgress: input.onProgress
          ? (progress) => input.onProgress?.('cover', progress)
          : undefined,
        signal: input.signal,
      });
      uploadedPaths.add(coverPath);
    }
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
    filter_id: input.filterId || null,
  };
  const hasS5 = !!input.publishOptions || !!input.editMeta;
  if (input.publishOptions) {
    Object.assign(insertPayload, publishOptionsPayload(input.publishOptions, input.editMeta ?? null));
  } else if (input.editMeta) {
    insertPayload.edit_meta = input.editMeta;
  }

  let { data: inserted, error: insErr } = await sb
    .from('videos')
    .insert(insertPayload as never)
    .select(VIDEO_PROFILE_SELECT_NO_SOUND)
    .single();

  // 020 : marquage 18+ refusé (compte mineur ou sans date) ou colonne absente
  // (020 pas appliquée) : jamais de republication sans le marquage.
  const matureKey = insErr && input.publishOptions?.isMature ? matureErrorKey(insErr) : null;
  if (matureKey) throw matureError(t(matureKey));

  // 016 pas encore appliquée : on retire ses colonnes et on réessaie — sauf
  // si l'utilisateur a restreint la diffusion (publier en public trahirait
  // son choix). Les fichiers déjà envoyés restent en place pour le réessai.
  if (insErr && hasS5 && isMissingPublishOptionsColumn(insErr)) {
    if (input.publishOptions && hasRestrictiveOptions(input.publishOptions)) {
      throw new Error(PUBLISH_ERRORS.optionsNeedServer);
    }
    for (const col of PUBLISH_OPTION_COLUMNS) delete insertPayload[col];
    const retry016 = await sb
      .from('videos')
      .insert(insertPayload as never)
      .select(VIDEO_PROFILE_SELECT_NO_SOUND)
      .single();
    inserted = retry016.data;
    insErr = retry016.error;
  }

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
    delete legacyPayload.filter_id;
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

  if (insErr) {
    // Retry without filter_id if migration 012 not applied
    if (
      input.filterId &&
      (insErr.message?.includes('filter_id') ||
        insErr.code === 'PGRST204' ||
        insErr.code === '42703')
    ) {
      const noFilter = { ...insertPayload };
      delete noFilter.filter_id;
      const retryFilter = await sb
        .from('videos')
        .insert(noFilter as never)
        .select(VIDEO_PROFILE_SELECT_NO_SOUND)
        .single();
      inserted = retryFilter.data;
      insErr = retryFilter.error;
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
  if (input.filterId) {
    item.filterId = input.filterId;
  }
  // Ligne relue sans les colonnes 016 (migration absente) : l'élément local
  // garde tout de même les réglages pour la session en cours.
  if (!item.editMeta && input.editMeta && !('edit_meta' in row)) {
    item.editMeta = input.editMeta;
    item.overlays = input.editMeta.overlays ?? undefined;
  }
  if (!row.profiles && input.username) {
    item.handle = `@${input.username}`;
    item.avatarUrl = input.avatarUrl || item.avatarUrl;
  }

  // Publication acquise : les copies temporaires du picker n'ont plus d'usage.
  // deleteCachedFile ne touche que ce qui vit sous Paths.cache — jamais un
  // fichier de la galerie de l'utilisateur. Le son importé n'est pas supprimé :
  // il est réutilisable et référencé par sounds.public_url.
  deleteCachedFile(input.localUri);
  if (input.coverUri) deleteCachedFile(input.coverUri);
  uploadedPaths.delete(path);
  if (coverPath) uploadedPaths.delete(coverPath);

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

let publishOptionsSupport: Promise<boolean> | null = null;

/**
 * La base a-t-elle les colonnes de 016 ? Sonde une fois par session (lecture
 * d'une colonne sur 0 ligne). En cas d'erreur réseau, réessaie la fois suivante.
 */
export function probePublishOptionsSupport(): Promise<boolean> {
  const sb = getSupabase();
  if (!sb || !isSupabaseConfigured) return Promise.resolve(false);
  if (publishOptionsSupport) return publishOptionsSupport;
  publishOptionsSupport = (async () => {
    const { error } = await sb.from('videos').select('visibility, edit_meta').limit(0);
    if (!error) return true;
    if (isMissingPublishOptionsColumn(error)) return false;
    publishOptionsSupport = null;
    return false;
  })();
  return publishOptionsSupport;
}

/** Hashtags récents les plus fréquents commençant par `prefix`. */
export async function suggestHashtags(prefix: string, limit = 6): Promise<string[]> {
  const sb = getSupabase();
  if (!sb || !isSupabaseConfigured) return [];
  const p = prefix.toLowerCase();
  const { data, error } = await sb
    .from('videos')
    .select('hashtags')
    .eq('status', 'published')
    .not('hashtags', 'is', null)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error || !data) return [];
  const counts = new Map<string, number>();
  for (const row of data as { hashtags: string[] | null }[]) {
    for (const tag of row.hashtags ?? []) {
      const t = String(tag).toLowerCase();
      if (t && t.startsWith(p)) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([t]) => t);
}

/** Profils dont le pseudo commence par `prefix`. */
export async function suggestProfiles(
  prefix: string,
  limit = 6,
): Promise<{ username: string; avatarUrl: string | null }[]> {
  const sb = getSupabase();
  if (!sb || !isSupabaseConfigured || !prefix) return [];
  // Échappe les jokers LIKE : le préfixe vient de la frappe.
  const safe = prefix.replace(/[\\%_]/g, (c) => `\\${c}`);
  const { data, error } = await sb
    .from('profiles')
    .select('username, avatar_url')
    .ilike('username', `${safe}%`)
    .order('username')
    .limit(limit);
  if (error || !data) return [];
  return (data as { username: string | null; avatar_url: string | null }[])
    .filter((p) => !!p.username)
    .map((p) => ({ username: p.username as string, avatarUrl: p.avatar_url }));
}


export type OwnerVideoActionResult =
  | { ok: true; mock?: boolean; status: 'archived' | 'deleted' | 'published' }
  | { ok: false; message: string };

/**
 * Owner-only soft status change (archive / soft-delete / restore publish).
 * Requires videos_update_own RLS + status check including archived|deleted (005).
 * Soft delete goes through RPC soft_delete_own_video (015) — see comment below.
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

  if (status === 'deleted') {
    // RLS SELECT masque status='deleted' même au propriétaire : un UPDATE
    // PostgREST (RETURNING) échouerait. RPC owner-only (migration 015).
    const { data: deleted, error: rpcError } = await sb.rpc('soft_delete_own_video', {
      p_video_id: videoId,
    });
    if (rpcError) {
      return { ok: false, message: rpcError.message || 'delete_fail' };
    }
    if (!deleted) {
      return { ok: false, message: 'not_owner_or_missing' };
    }
    return { ok: true, status: 'deleted' };
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

/** Alias for profile Archives (désarchiver / supprimer). */
export const updateVideoStatus = setVideoStatus;

/**
 * Suppression définitive d'une vidéo, fichiers compris.
 *
 * Ce que faisait l'ancien `softDeleteOwnVideo` : poser `status = 'deleted'`.
 * La ligne restait, l'objet du bucket `videos` restait, et la politique de
 * confidentialité promettait pourtant que les contenus sont effacés. Cette
 * fonction-là efface vraiment, et l'ancienne a été retirée : plus personne ne
 * l'appelait, et son nom laissait croire à une suppression.
 *
 * Un repost recopie `storage_path` et `cover_path` de l'original dans sa propre
 * ligne (`lib/reposts.ts`). Le même objet est donc désigné par plusieurs
 * lignes, appartenant à plusieurs comptes. D'où la règle, unique et
 * suffisante : **un objet n'est effacé que s'il est dans le dossier du compte
 * ET que plus aucune autre ligne ne le désigne.**
 *
 * Elle couvre les trois cas sans en traiter aucun à part :
 *
 * - repost de la vidéo de quelqu'un d'autre : les chemins sont dans le dossier
 *   de l'auteur, le préfixe les écarte, aucun fichier n'est touché ;
 * - vidéo repostée par d'autres : leurs lignes désignent l'objet, il reste, et
 *   leur carte continue de fonctionner ;
 * - repost de sa propre vidéo : l'objet part avec la dernière ligne qui le
 *   désigne, quelle qu'elle soit. Une garde « ne touche jamais aux fichiers
 *   d'un repost » aurait laissé l'objet orphelin pour toujours dans ce cas.
 */
export type DeleteOwnVideoResult =
  | {
      ok: true;
      mock?: boolean;
      /** Objets du bucket réellement effacés. */
      removedFiles: string[];
      /** Objets laissés en place : une autre ligne les désigne encore. */
      keptFiles: string[];
      /** La ligne est partie, l'objet non. L'UI doit le dire, pas le taire. */
      fileError?: string;
    }
  | { ok: false; message: string };

type DeletableVideoRow = {
  user_id: string;
  storage_path?: string | null;
  cover_path?: string | null;
};

/**
 * Chemins du bucket que ce compte a le droit d'effacer pour cette ligne.
 *
 * Filtré sur le préfixe `{userId}/` : une ligne corrompue, fabriquée, ou
 * simplement copiée depuis l'original par un repost ne peut pas faire viser le
 * dossier de quelqu'un d'autre. C'est aussi ce que refuse la politique
 * `videos_storage_delete_own`, mais une politique se modifie dans le tableau
 * de bord Supabase sans que personne ne relise ce fichier.
 */
export function ownedVideoFilePaths(userId: string, row: DeletableVideoRow): string[] {
  if (!userId) return [];
  const prefixe = `${userId}/`;
  const vus = new Set<string>();
  for (const brut of [row.storage_path, row.cover_path]) {
    const chemin = typeof brut === 'string' ? brut.trim() : '';
    if (!chemin || !chemin.startsWith(prefixe)) continue;
    vus.add(chemin);
  }
  return [...vus];
}

/**
 * Une autre ligne que `videoId` désigne-t-elle encore ce chemin ?
 * Ancien chemin seulement (022 non appliquée) : ce SELECT passe par la RLS et
 * ne voit pas les lignes cachées à l'appelant (défaut 2, PR #41).
 */
async function cheminEncoreReference(
  sb: NonNullable<ReturnType<typeof getSupabase>>,
  videoId: string,
  chemin: string,
): Promise<{ referenced: boolean; error?: string }> {
  for (const colonne of ['storage_path', 'cover_path'] as const) {
    const { data, error } = await sb
      .from('videos')
      .select('id')
      .eq(colonne, chemin)
      .neq('id', videoId)
      .limit(1);
    if (error) return { referenced: true, error: error.message || 'refs_fail' };
    if (data && data.length > 0) return { referenced: true };
  }
  return { referenced: false };
}

/**
 * 022 appliquée ? Mémorisé pour la session (null = inconnu), comme le
 * schéma des signalements (S2, `lib/reports.ts`).
 */
let rpcSuppression022: boolean | null = null;
/** Tests uniquement. */
export function __resetVideoDeleteRpcCache(): void {
  rpcSuppression022 = null;
}

type SupabaseClient = NonNullable<ReturnType<typeof getSupabase>>;

/** Réponse de `delete_own_video_for_good` (022), lue sans lui faire confiance. */
type Rpc022Reponse =
  | { ok: true; removable: string[]; kept: string[] }
  | { ok: false; reason: string };

function cheminsDuDossier(userId: string, valeur: unknown): string[] {
  if (!Array.isArray(valeur)) return [];
  const prefixe = `${userId}/`;
  return [
    ...new Set(
      valeur.filter((c): c is string => typeof c === 'string' && c.startsWith(prefixe)),
    ),
  ];
}

/** Exporté pour les tests. */
export function parseDeleteRpcResponse(userId: string, data: unknown): Rpc022Reponse | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;
  if (d.ok === true) {
    // Le serveur ne rend que des chemins du dossier de l'appelant ; le filtre
    // est refait ici pour la même raison que `ownedVideoFilePaths`.
    return {
      ok: true,
      removable: cheminsDuDossier(userId, d.removable),
      kept: cheminsDuDossier(userId, d.kept),
    };
  }
  if (d.ok === false) {
    return { ok: false, reason: typeof d.reason === 'string' && d.reason ? d.reason : 'delete_fail' };
  }
  return null;
}

/** La ligne est partie : effacer les fichiers qui ne servent plus à personne. */
async function effacerFichiers(
  sb: SupabaseClient,
  aEffacer: string[],
  aGarder: string[],
): Promise<DeleteOwnVideoResult> {
  if (aEffacer.length === 0) {
    return { ok: true, removedFiles: [], keptFiles: aGarder };
  }
  const { error: storageErr } = await sb.storage.from('videos').remove(aEffacer);
  if (storageErr) {
    // La ligne est partie : la vidéo a bien disparu de l'application. Mais le
    // fichier est resté. On le dit au lieu de prétendre le contraire.
    return {
      ok: true,
      removedFiles: [],
      keptFiles: aGarder,
      fileError: storageErr.message || 'storage_remove_fail',
    };
  }
  return { ok: true, removedFiles: aEffacer, keptFiles: aGarder };
}

/**
 * Chemin 022 : une seule RPC (`delete_own_video_for_good`, security definer)
 * vérifie le propriétaire, supprime la ligne et classe les fichiers. Le
 * comptage des références y est fait SANS filtre de visibilité : un repost
 * archivé, « followers », « private », masqué par la modération ou d'un compte
 * bloqué garde son fichier (défaut 2, PR #41). Décision du fondateur : les
 * reposts des autres comptes restent visibles.
 *
 * Renvoie `null` si la RPC n'existe pas encore (022 non appliquée) : l'appelant
 * reprend alors l'ancien chemin.
 */
async function supprimerViaRpc022(
  sb: SupabaseClient,
  userId: string,
  videoId: string,
): Promise<DeleteOwnVideoResult | null> {
  const { data, error } = await sb.rpc('delete_own_video_for_good', { p_video_id: videoId });
  if (error) {
    if (isRpcMissing(error)) {
      rpcSuppression022 = false;
      return null;
    }
    return { ok: false, message: error.message || 'delete_fail' };
  }
  rpcSuppression022 = true;
  const reponse = parseDeleteRpcResponse(userId, data);
  if (!reponse) return { ok: false, message: 'delete_fail' };
  if (!reponse.ok) return { ok: false, message: reponse.reason };
  return effacerFichiers(sb, reponse.removable, reponse.kept);
}

/**
 * Ancien chemin (avant 022), gardé pour une base où 022 n'est pas encore
 * appliquée. Limite connue : le comptage passe par la RLS et ne voit pas les
 * reposts invisibles à l'auteur — c'est précisément ce que 022 corrige.
 */
async function supprimerCheminClient(
  sb: SupabaseClient,
  userId: string,
  videoId: string,
): Promise<DeleteOwnVideoResult> {
  // L'objet que l'écran a en main n'est pas une source de vérité. Ce sont ces
  // chemins-là, lus côté serveur, et eux seuls, qui pourront être effacés.
  const { data: ligne, error: lectureErr } = await sb
    .from('videos')
    // `*` : moderation_state n'existe qu'après la migration 017.
    .select('*')
    .eq('id', videoId)
    .maybeSingle();

  if (lectureErr) {
    return { ok: false, message: lectureErr.message || 'read_fail' };
  }
  if (!ligne) {
    return { ok: false, message: 'not_found' };
  }
  const row = ligne as unknown as DeletableVideoRow;
  if (row.user_id !== userId) {
    return { ok: false, message: 'not_owner' };
  }
  // 017 : une vidéo masquée ou retirée par la modération reste conservée
  // (preuve, recours) ; le serveur refuse sa suppression définitive.
  const etat = (ligne as { moderation_state?: string | null }).moderation_state;
  if (etat && etat !== 'visible') {
    return { ok: false, message: 'moderation_hold' };
  }

  const aEffacer: string[] = [];
  const aGarder: string[] = [];
  for (const chemin of ownedVideoFilePaths(userId, row)) {
    const { referenced, error } = await cheminEncoreReference(sb, videoId, chemin);
    if (error) return { ok: false, message: error };
    (referenced ? aGarder : aEffacer).push(chemin);
  }

  // La ligne part AVANT les fichiers. Dans l'autre ordre, un échec de
  // suppression de ligne laisserait une carte dans le fil avec un fichier
  // manquant. Une ligne partie et un objet resté est une fuite invisible ;
  // l'inverse est un 404 sous les yeux des gens.
  const { data: supprimee, error: suppErr } = await sb
    .from('videos')
    .delete()
    .eq('id', videoId)
    .eq('user_id', userId)
    .select('id')
    .maybeSingle();

  if (suppErr) {
    return { ok: false, message: suppErr.message || 'delete_fail' };
  }
  if (!supprimee) {
    return { ok: false, message: 'not_owner_or_missing' };
  }

  return effacerFichiers(sb, aEffacer, aGarder);
}

export async function deleteOwnVideoForGood(
  userId: string,
  videoId: string,
): Promise<DeleteOwnVideoResult> {
  const sb = getSupabase();
  if (!sb || !isSupabaseConfigured || userId.startsWith('mock_')) {
    return { ok: true, mock: true, removedFiles: [], keptFiles: [] };
  }
  if (!userId || !videoId) {
    return { ok: false, message: 'missing_ids' };
  }

  if (rpcSuppression022 !== false) {
    const viaRpc = await supprimerViaRpc022(sb, userId, videoId);
    if (viaRpc) return viaRpc;
  }
  return supprimerCheminClient(sb, userId, videoId);
}

/**
 * Les trois issues d'une suppression définitive, pour l'écran (défaut 1,
 * PR #41) :
 * - `removed` : ligne et fichiers de l'auteur effacés (ou aucun fichier à lui,
 *   cas d'un repost de la vidéo de quelqu'un d'autre) ;
 * - `kept_for_repost` : la vidéo a disparu mais son fichier est gardé, parce
 *   qu'un repost s'en sert encore — ce repost reste visible ;
 * - `file_error` : la ligne est partie mais le fichier n'a pas pu être effacé ;
 * - `failed` : rien n'a été supprimé.
 * `mock` : mode démo, rien n'a été tenté.
 */
export type VideoDeleteOutcome = 'mock' | 'removed' | 'kept_for_repost' | 'file_error' | 'failed';

export function videoDeleteOutcome(result: DeleteOwnVideoResult): VideoDeleteOutcome {
  if (!result.ok) return 'failed';
  if (result.mock) return 'mock';
  if (result.fileError) return 'file_error';
  if (result.keptFiles.length > 0) return 'kept_for_repost';
  return 'removed';
}
