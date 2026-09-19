/**
 * Séries NIA — CRUD + épisodes ordonnés via series_items (pas de videos.series_id).
 */
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';
import {
  VIDEO_PROFILE_SELECT,
  VIDEO_PROFILE_SELECT_NO_SOUND,
  mapRowToVideoItem,
} from '@/lib/videos';
import type { ProfileRow, SeriesRow } from '@/types/database';
import type { VideoItem } from '@/data/mockVideos';

export type SeriesWithProfile = SeriesRow & {
  profiles: Pick<ProfileRow, 'username' | 'avatar_url' | 'display_name'> | null;
  series_items?: { count: number }[] | null;
};

export type SeriesListItem = {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  coverPath: string | null;
  coverUrl: string | null;
  createdAt: string;
  ownerHandle: string;
  ownerAvatarUrl?: string;
  episodeCount: number;
};

export type SeriesEpisode = {
  position: number;
  video: VideoItem;
};

export type SeriesDetail = SeriesListItem & {
  episodes: SeriesEpisode[];
};

export const SERIES_PROFILE_SELECT =
  '*, profiles!series_user_id_fkey(username, avatar_url, display_name), series_items(count)';

function publicUrlForPath(storagePath: string | null | undefined): string | null {
  if (!storagePath) return null;
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = sb.storage.from('videos').getPublicUrl(storagePath);
  return data.publicUrl || null;
}

function mapSeriesRow(row: SeriesWithProfile): SeriesListItem {
  const username = row.profiles?.username || 'createur';
  const countRaw = row.series_items?.[0]?.count;
  const episodeCount =
    typeof countRaw === 'number' && Number.isFinite(countRaw) ? countRaw : 0;

  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    description: row.description,
    coverPath: row.cover_path,
    coverUrl: publicUrlForPath(row.cover_path),
    createdAt: row.created_at,
    ownerHandle: `@${username}`,
    ownerAvatarUrl: row.profiles?.avatar_url || undefined,
    episodeCount,
  };
}

function isMissingSeriesError(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  return (
    !!error.message?.includes('series') ||
    error.code === 'PGRST205' ||
    error.code === '42P01' ||
    error.code === 'PGRST200'
  );
}

export async function listSeriesByUser(userId: string): Promise<SeriesListItem[]> {
  const sb = getSupabase();
  if (!sb || !userId) return [];

  const { data, error } = await sb
    .from('series')
    .select(SERIES_PROFILE_SELECT)
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    if (isMissingSeriesError(error)) return [];
    throw error;
  }

  return ((data || []) as unknown as SeriesWithProfile[]).map(mapSeriesRow);
}

export async function fetchSeriesById(id: string): Promise<SeriesDetail | null> {
  const sb = getSupabase();
  if (!sb || !id) return null;

  const { data, error } = await sb
    .from('series')
    .select(SERIES_PROFILE_SELECT)
    .eq('id', id)
    .maybeSingle();

  if (error) {
    if (isMissingSeriesError(error)) return null;
    throw error;
  }
  if (!data) return null;

  const base = mapSeriesRow(data as unknown as SeriesWithProfile);
  const episodes = await fetchSeriesEpisodes(id);
  return { ...base, episodeCount: episodes.length, episodes };
}

type VideoSelectRow = Parameters<typeof mapRowToVideoItem>[0] & {
  id: string;
  storage_path: string;
};

async function fetchSeriesEpisodes(seriesId: string): Promise<SeriesEpisode[]> {
  const sb = getSupabase();
  if (!sb) return [];

  const { data: itemRows, error: itemErr } = await sb
    .from('series_items')
    .select('video_id, position')
    .eq('series_id', seriesId)
    .order('position', { ascending: true });

  if (itemErr) {
    if (isMissingSeriesError(itemErr)) return [];
    throw itemErr;
  }

  const items = (itemRows || []) as { video_id: string; position: number }[];
  if (items.length === 0) return [];

  const videoIds = items.map((i) => i.video_id);
  let videoData: unknown = null;
  let videoError: { message?: string; code?: string } | null = null;

  {
    const first = await sb
      .from('videos')
      .select(VIDEO_PROFILE_SELECT)
      .in('id', videoIds)
      .neq('status', 'deleted');
    videoData = first.data;
    videoError = first.error;
  }

  if (
    videoError &&
    (videoError.message?.includes('sounds') ||
      videoError.message?.includes('sound_id') ||
      videoError.code === 'PGRST200' ||
      videoError.code === 'PGRST204' ||
      videoError.code === '42703')
  ) {
    const fb = await sb
      .from('videos')
      .select(VIDEO_PROFILE_SELECT_NO_SOUND)
      .in('id', videoIds)
      .neq('status', 'deleted');
    videoData = fb.data;
    videoError = fb.error;
  }

  if (videoError) throw videoError;

  const byId = new Map<string, VideoItem>();
  for (const row of (videoData || []) as VideoSelectRow[]) {
    const { data: urlData } = sb.storage.from('videos').getPublicUrl(row.storage_path);
    byId.set(row.id, mapRowToVideoItem(row, urlData.publicUrl));
  }

  const episodes: SeriesEpisode[] = [];
  for (const item of items) {
    const video = byId.get(item.video_id);
    if (video) {
      episodes.push({ position: item.position, video });
    }
  }
  return episodes;
}

export type CreateSeriesInput = {
  userId: string;
  title: string;
  description?: string | null;
  coverLocalUri?: string | null;
  coverMimeType?: string | null;
  coverFileName?: string | null;
};

function resolveImageContentType(input: {
  mimeType?: string | null;
  localUri: string;
  fileName?: string | null;
}): { contentType: string; ext: string } {
  const raw = input.mimeType?.split(';')[0]?.trim().toLowerCase() || '';
  if (raw === 'image/png') return { contentType: 'image/png', ext: 'png' };
  if (raw === 'image/webp') return { contentType: 'image/webp', ext: 'webp' };
  if (raw === 'image/jpeg' || raw === 'image/jpg') {
    return { contentType: 'image/jpeg', ext: 'jpg' };
  }
  const name = `${input.fileName || ''} ${input.localUri || ''}`.toLowerCase();
  if (name.includes('.png')) return { contentType: 'image/png', ext: 'png' };
  if (name.includes('.webp')) return { contentType: 'image/webp', ext: 'webp' };
  return { contentType: 'image/jpeg', ext: 'jpg' };
}

export async function createSeries(input: CreateSeriesInput): Promise<SeriesListItem> {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase non configuré');

  const { data: sessionData } = await sb.auth.getSession();
  const sessionUserId = sessionData.session?.user?.id;
  if (!sessionUserId) {
    throw new Error('Session expirée. Reconnectez-vous pour créer une série.');
  }
  if (input.userId && input.userId !== sessionUserId) {
    throw new Error('Identifiant créateur incohérent avec la session.');
  }
  const creatorId = sessionUserId;

  const title = (input.title || '').trim();
  if (!title) throw new Error('Titre requis');

  let coverPath: string | null = null;
  if (input.coverLocalUri) {
    const { contentType, ext } = resolveImageContentType({
      mimeType: input.coverMimeType,
      localUri: input.coverLocalUri,
      fileName: input.coverFileName,
    });
    const path = `${creatorId}/series/${Date.now()}.${ext}`;
    const response = await fetch(input.coverLocalUri);
    if (!response.ok) {
      throw new Error(`Impossible de lire l'image (${response.status})`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const { error: upErr } = await sb.storage.from('videos').upload(path, arrayBuffer, {
      contentType,
      upsert: false,
    });
    if (upErr) throw upErr;
    coverPath = path;
  }

  const { data: inserted, error: insErr } = await sb
    .from('series')
    .insert({
      user_id: creatorId,
      title,
      description: (input.description || '').trim() || null,
      cover_path: coverPath,
    } as never)
    .select(SERIES_PROFILE_SELECT)
    .single();

  if (insErr) throw insErr;
  return mapSeriesRow(inserted as unknown as SeriesWithProfile);
}

/** Next episode position for a series (1-based). */
async function nextPosition(seriesId: string): Promise<number> {
  const sb = getSupabase();
  if (!sb) return 1;
  const { data } = await sb
    .from('series_items')
    .select('position')
    .eq('series_id', seriesId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle();
  const pos = (data as { position?: number } | null)?.position;
  return typeof pos === 'number' && Number.isFinite(pos) ? pos + 1 : 1;
}

export async function addVideoToSeries(
  seriesId: string,
  videoId: string,
): Promise<{ ok: true; position: number } | { ok: false; message: string }> {
  const sb = getSupabase();
  if (!sb || !isSupabaseConfigured) {
    return { ok: false, message: 'Supabase non configuré' };
  }
  if (!seriesId || !videoId) {
    return { ok: false, message: 'Paramètres manquants' };
  }

  const { data: sessionData } = await sb.auth.getSession();
  const uid = sessionData.session?.user?.id;
  if (!uid) return { ok: false, message: 'Session expirée' };

  const { data: seriesRow } = await sb
    .from('series')
    .select('user_id')
    .eq('id', seriesId)
    .maybeSingle();
  if (!seriesRow || (seriesRow as { user_id: string }).user_id !== uid) {
    return { ok: false, message: 'Vous ne pouvez modifier que vos propres séries.' };
  }

  const { data: videoRow } = await sb
    .from('videos')
    .select('user_id, status')
    .eq('id', videoId)
    .maybeSingle();
  const v = videoRow as { user_id?: string; status?: string } | null;
  if (!v || v.user_id !== uid) {
    return { ok: false, message: 'Vous ne pouvez ajouter que vos propres vidéos.' };
  }
  if (v.status === 'deleted') {
    return { ok: false, message: 'Vidéo introuvable.' };
  }

  const { data: existing } = await sb
    .from('series_items')
    .select('position')
    .eq('series_id', seriesId)
    .eq('video_id', videoId)
    .maybeSingle();
  if (existing) {
    return {
      ok: true,
      position: (existing as { position: number }).position,
    };
  }

  const position = await nextPosition(seriesId);
  const { error } = await sb.from('series_items').insert({
    series_id: seriesId,
    video_id: videoId,
    position,
  } as never);

  if (error) {
    if (error.code === '23505') {
      return { ok: false, message: 'Cette vidéo est déjà dans la série.' };
    }
    return { ok: false, message: error.message || 'Ajout impossible' };
  }
  return { ok: true, position };
}

export async function removeVideoFromSeries(
  seriesId: string,
  videoId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const sb = getSupabase();
  if (!sb) return { ok: false, message: 'Supabase non configuré' };

  const { error } = await sb
    .from('series_items')
    .delete()
    .eq('series_id', seriesId)
    .eq('video_id', videoId);

  if (error) {
    return { ok: false, message: error.message || 'Retrait impossible' };
  }
  return { ok: true };
}

export async function deleteSeries(
  seriesId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const sb = getSupabase();
  if (!sb) return { ok: false, message: 'Supabase non configuré' };

  const { error } = await sb.from('series').delete().eq('id', seriesId);
  if (error) {
    return { ok: false, message: error.message || 'Suppression impossible' };
  }
  return { ok: true };
}

export { isSupabaseConfigured };
