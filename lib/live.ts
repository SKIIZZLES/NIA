/**
 * Lives NIA V2.3 — métadonnées uniquement (schedule / list / end).
 * Pas d’URL de lecture, pas de WebRTC / Mux / LiveKit branché.
 */
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';
import type { LiveCategoryId, LiveVisibility } from '@/constants/liveCategories';
import {
  isLiveCategoryId,
  isLiveVisibility,
} from '@/constants/liveCategories';
import type { LiveStreamRow, ProfileRow } from '@/types/database';

export type LiveStreamStatus = 'scheduled' | 'live' | 'ended' | 'cancelled';

export type LiveListSection = 'live' | 'scheduled' | 'popular';

export type LiveStreamWithHost = LiveStreamRow & {
  profiles: Pick<ProfileRow, 'username' | 'avatar_url' | 'display_name'> | null;
};

export type LiveStreamItem = {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  category: LiveCategoryId;
  thumbnailPath: string | null;
  thumbnailUrl: string | null;
  visibility: LiveVisibility;
  status: LiveStreamStatus;
  scheduledAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
  viewerCount: number;
  provider: string | null;
  providerStreamId: string | null;
  createdAt: string;
  hostHandle: string;
  hostAvatarUrl?: string;
};

export const LIVE_PROFILE_SELECT =
  '*, profiles!live_streams_user_id_fkey(username, avatar_url, display_name)';

function publicUrlForPath(storagePath: string | null | undefined): string | null {
  if (!storagePath) return null;
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = sb.storage.from('videos').getPublicUrl(storagePath);
  return data.publicUrl || null;
}

function mapStatus(raw: string): LiveStreamStatus {
  if (
    raw === 'scheduled' ||
    raw === 'live' ||
    raw === 'ended' ||
    raw === 'cancelled'
  ) {
    return raw;
  }
  return 'scheduled';
}

function mapLiveRow(row: LiveStreamWithHost): LiveStreamItem {
  const username = row.profiles?.username || 'createur';
  const category: LiveCategoryId = isLiveCategoryId(row.category)
    ? row.category
    : 'other';
  const visibility: LiveVisibility = isLiveVisibility(row.visibility)
    ? row.visibility
    : 'public';
  const viewer =
    typeof row.viewer_count === 'number' && Number.isFinite(row.viewer_count)
      ? Math.max(0, row.viewer_count)
      : 0;

  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    description: row.description,
    category,
    thumbnailPath: row.thumbnail_path,
    thumbnailUrl: publicUrlForPath(row.thumbnail_path),
    visibility,
    status: mapStatus(row.status),
    scheduledAt: row.scheduled_at,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    viewerCount: viewer,
    provider: row.provider,
    providerStreamId: row.provider_stream_id,
    createdAt: row.created_at,
    hostHandle: `@${username}`,
    hostAvatarUrl: row.profiles?.avatar_url || undefined,
  };
}

function isMissingTableError(error: { message?: string; code?: string }): boolean {
  return (
    !!error.message?.includes('live_streams') ||
    error.code === 'PGRST205' ||
    error.code === '42P01'
  );
}

/** Streams currently marked live (metadata only — no play URL). */
export async function listLiveNow(options?: {
  limit?: number;
}): Promise<LiveStreamItem[]> {
  const sb = getSupabase();
  if (!sb) return [];

  const limit = options?.limit ?? 30;
  const { data, error } = await sb
    .from('live_streams')
    .select(LIVE_PROFILE_SELECT)
    .eq('status', 'live')
    .eq('visibility', 'public')
    .order('started_at', { ascending: false, nullsFirst: false })
    .limit(limit);

  if (error) {
    if (isMissingTableError(error)) return [];
    throw error;
  }
  return ((data || []) as unknown as LiveStreamWithHost[]).map(mapLiveRow);
}

/** Upcoming scheduled public streams. */
export async function listScheduled(options?: {
  limit?: number;
}): Promise<LiveStreamItem[]> {
  const sb = getSupabase();
  if (!sb) return [];

  const limit = options?.limit ?? 50;
  const nowIso = new Date().toISOString();
  const { data, error } = await sb
    .from('live_streams')
    .select(LIVE_PROFILE_SELECT)
    .eq('status', 'scheduled')
    .eq('visibility', 'public')
    .or(`scheduled_at.gte.${nowIso},scheduled_at.is.null`)
    .order('scheduled_at', { ascending: true, nullsFirst: false })
    .limit(limit);

  if (error) {
    if (isMissingTableError(error)) return [];
    throw error;
  }
  return ((data || []) as unknown as LiveStreamWithHost[]).map(mapLiveRow);
}

/** Popular by viewer_count among scheduled + live (public). */
export async function listPopular(options?: {
  limit?: number;
}): Promise<LiveStreamItem[]> {
  const sb = getSupabase();
  if (!sb) return [];

  const limit = options?.limit ?? 30;
  const { data, error } = await sb
    .from('live_streams')
    .select(LIVE_PROFILE_SELECT)
    .in('status', ['live', 'scheduled'])
    .eq('visibility', 'public')
    .order('viewer_count', { ascending: false })
    .limit(limit);

  if (error) {
    if (isMissingTableError(error)) return [];
    throw error;
  }
  return ((data || []) as unknown as LiveStreamWithHost[]).map(mapLiveRow);
}

export async function listLiveStreams(section: LiveListSection): Promise<LiveStreamItem[]> {
  if (section === 'live') return listLiveNow();
  if (section === 'scheduled') return listScheduled();
  return listPopular();
}

export async function fetchLiveStreamById(
  id: string,
): Promise<LiveStreamItem | null> {
  const sb = getSupabase();
  if (!sb || !id) return null;

  const { data, error } = await sb
    .from('live_streams')
    .select(LIVE_PROFILE_SELECT)
    .eq('id', id)
    .maybeSingle();

  if (error) {
    if (isMissingTableError(error)) return null;
    throw error;
  }
  if (!data) return null;
  return mapLiveRow(data as unknown as LiveStreamWithHost);
}

export type CreateLiveStreamInput = {
  userId: string;
  title: string;
  description?: string | null;
  category: LiveCategoryId;
  visibility?: LiveVisibility;
  scheduledAt: string;
  thumbnailLocalUri?: string | null;
  thumbnailMimeType?: string | null;
  thumbnailFileName?: string | null;
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

/**
 * Create a scheduled live row (metadata only).
 * Does NOT create a play URL or provider session.
 */
export async function createScheduledStream(
  input: CreateLiveStreamInput,
): Promise<LiveStreamItem> {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase non configuré');

  const { data: sessionData } = await sb.auth.getSession();
  const sessionUserId = sessionData.session?.user?.id;
  if (!sessionUserId) {
    throw new Error('Session expirée. Reconnectez-vous pour programmer un live.');
  }
  if (input.userId && input.userId !== sessionUserId) {
    throw new Error('Identifiant créateur incohérent avec la session.');
  }
  const creatorId = sessionUserId;

  const title = (input.title || '').trim();
  if (!title) throw new Error('Titre requis');
  if (!isLiveCategoryId(input.category)) throw new Error('Catégorie invalide');
  const visibility: LiveVisibility = isLiveVisibility(input.visibility)
    ? input.visibility
    : 'public';
  if (!input.scheduledAt) throw new Error('Horaires requis');

  let thumbnailPath: string | null = null;
  if (input.thumbnailLocalUri) {
    const { contentType, ext } = resolveImageContentType({
      mimeType: input.thumbnailMimeType,
      localUri: input.thumbnailLocalUri,
      fileName: input.thumbnailFileName,
    });
    const path = `${creatorId}/live/${Date.now()}.${ext}`;
    const response = await fetch(input.thumbnailLocalUri);
    if (!response.ok) {
      throw new Error(`Impossible de lire l'image (${response.status})`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const { error: upErr } = await sb.storage.from('videos').upload(path, arrayBuffer, {
      contentType,
      upsert: false,
    });
    if (upErr) throw upErr;
    thumbnailPath = path;
  }

  const insertPayload = {
    user_id: creatorId,
    title,
    description: (input.description || '').trim() || null,
    category: input.category,
    thumbnail_path: thumbnailPath,
    visibility,
    status: 'scheduled' as const,
    scheduled_at: input.scheduledAt,
    started_at: null,
    ended_at: null,
    viewer_count: 0,
    provider: null,
    provider_stream_id: null,
  };

  const { data: inserted, error: insErr } = await sb
    .from('live_streams')
    .insert(insertPayload as never)
    .select(LIVE_PROFILE_SELECT)
    .single();

  if (insErr) throw insErr;
  return mapLiveRow(inserted as unknown as LiveStreamWithHost);
}

/**
 * End a stream (status → ended). Owner only via RLS.
 * Does not touch any provider — metadata update only.
 */
export async function endStream(
  userId: string,
  streamId: string,
): Promise<LiveStreamItem | null> {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase non configuré');

  const { data: sessionData } = await sb.auth.getSession();
  const sessionUserId = sessionData.session?.user?.id;
  if (!sessionUserId) {
    throw new Error('Session expirée.');
  }
  if (userId && userId !== sessionUserId) {
    throw new Error('Identifiant créateur incohérent avec la session.');
  }

  const { data, error } = await sb
    .from('live_streams')
    .update({
      status: 'ended',
      ended_at: new Date().toISOString(),
    } as never)
    .eq('id', streamId)
    .eq('user_id', sessionUserId)
    .select(LIVE_PROFILE_SELECT)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return mapLiveRow(data as unknown as LiveStreamWithHost);
}

export { isSupabaseConfigured };
