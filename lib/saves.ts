/**
 * Saves / bookmarks — toggle + fetch ; mock / AsyncStorage fallback.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';
import type { VideoItem } from '@/data/mockVideos';
import { DEMO_VIDEOS } from '@/data/mockVideos';
import type { ProfileRow, VideoRow } from '@/types/database';
import { mapRowToVideoItem, VIDEO_PROFILE_SELECT } from '@/lib/videos';

const LOCAL_SAVES_KEY = '@nia/saved_video_ids';

async function readLocalSaves(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(LOCAL_SAVES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === 'string')
      : [];
  } catch {
    return [];
  }
}

async function writeLocalSaves(ids: string[]): Promise<void> {
  try {
    await AsyncStorage.setItem(LOCAL_SAVES_KEY, JSON.stringify(ids));
  } catch {
    // ignore storage errors
  }
}

export async function fetchSavedVideoIds(userId: string): Promise<string[]> {
  const sb = getSupabase();
  if (!sb || !userId || userId.startsWith('mock_') || !isSupabaseConfigured) {
    return readLocalSaves();
  }

  const { data, error } = await sb
    .from('saves')
    .select('video_id')
    .eq('user_id', userId);

  if (error) {
    // Table may not exist yet (004 not applied) — fall back to local
    return readLocalSaves();
  }
  return (data || []).map((row) => row.video_id as string);
}

/**
 * Toggle save. Returns true if saved after the operation.
 * Mock / missing table: persists in AsyncStorage.
 */
export async function toggleSave(
  userId: string,
  videoId: string,
  currentlySaved: boolean,
): Promise<boolean> {
  const sb = getSupabase();
  const useRemote =
    !!sb &&
    isSupabaseConfigured &&
    !!userId &&
    !userId.startsWith('mock_');

  if (!useRemote) {
    const local = await readLocalSaves();
    const next = currentlySaved
      ? local.filter((id) => id !== videoId)
      : local.includes(videoId)
        ? local
        : [...local, videoId];
    await writeLocalSaves(next);
    return !currentlySaved;
  }

  if (currentlySaved) {
    const { error } = await sb!
      .from('saves')
      .delete()
      .eq('user_id', userId)
      .eq('video_id', videoId);
    if (error) {
      // Fall back to local on schema miss
      const local = await readLocalSaves();
      await writeLocalSaves(local.filter((id) => id !== videoId));
      return false;
    }
    return false;
  }

  const { error } = await sb!.from('saves').insert({
    user_id: userId,
    video_id: videoId,
  });
  if (error) {
    if (error.code === '23505') return true;
    const local = await readLocalSaves();
    if (!local.includes(videoId)) {
      await writeLocalSaves([...local, videoId]);
    }
    return true;
  }
  return true;
}


type VideoWithProfile = VideoRow & {
  profiles: Pick<ProfileRow, 'username' | 'avatar_url' | 'display_name'> | null;
};

/**
 * Full VideoItems for the current user's saves (table `saves`).
 * Falls back to DEMO_VIDEOS / feed ids when offline or mock.
 */
export async function fetchSavedVideos(userId: string): Promise<VideoItem[]> {
  const ids = await fetchSavedVideoIds(userId);
  if (!ids.length) return [];

  const sb = getSupabase();
  if (!sb || !isSupabaseConfigured || userId.startsWith('mock_')) {
    const byId = new Map(DEMO_VIDEOS.map((v) => [v.id, v]));
    return ids.map((id) => byId.get(id)).filter((v): v is VideoItem => !!v);
  }

  const { data, error } = await sb
    .from('videos')
    .select(VIDEO_PROFILE_SELECT)
    .in('id', ids)
    .eq('status', 'published');

  if (error) {
    // Soft fallback: try without status filter (pre-002)
    const fallback = await sb
      .from('videos')
      .select(VIDEO_PROFILE_SELECT)
      .in('id', ids);
    if (fallback.error || !fallback.data) return [];
    const rows = fallback.data as unknown as VideoWithProfile[];
    const items = rows.map((row) => {
      const { data: urlData } = sb.storage.from('videos').getPublicUrl(row.storage_path);
      return mapRowToVideoItem(row, urlData.publicUrl);
    });
    const order = new Map(ids.map((id, i) => [id, i]));
    return items
      .filter((v) => !v.status || v.status === 'published')
      .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  }

  const rows = (data || []) as unknown as VideoWithProfile[];
  const items = rows.map((row) => {
    const { data: urlData } = sb.storage.from('videos').getPublicUrl(row.storage_path);
    return mapRowToVideoItem(row, urlData.publicUrl);
  });
  const order = new Map(ids.map((id, i) => [id, i]));
  return items.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

export { isSupabaseConfigured };
