/**
 * Saves / bookmarks — toggle + fetch ; mock / AsyncStorage fallback.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';

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

export { isSupabaseConfigured };
