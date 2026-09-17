/**
 * Likes — toggle + fetch ; mock no-op si Supabase non configuré.
 */
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';

export async function fetchLikedVideoIds(userId: string): Promise<string[]> {
  const sb = getSupabase();
  if (!sb || !userId || userId.startsWith('mock_')) return [];

  const { data, error } = await sb
    .from('likes')
    .select('video_id')
    .eq('user_id', userId);

  if (error) throw error;
  return (data || []).map((row) => row.video_id);
}

/**
 * Toggle like. Retourne true si like actif après l'opération.
 * No-op mock : retourne l'inverse de `currentlyLiked`.
 */
export async function toggleLike(
  userId: string,
  videoId: string,
  currentlyLiked: boolean,
): Promise<boolean> {
  const sb = getSupabase();
  if (!sb || !isSupabaseConfigured || userId.startsWith('mock_')) {
    return !currentlyLiked;
  }

  if (currentlyLiked) {
    const { error } = await sb
      .from('likes')
      .delete()
      .eq('user_id', userId)
      .eq('video_id', videoId);
    if (error) throw error;
    return false;
  }

  const { error } = await sb.from('likes').insert({
    user_id: userId,
    video_id: videoId,
  });
  if (error) {
    // conflit PK = déjà liké
    if (error.code === '23505') return true;
    throw error;
  }
  return true;
}

export { isSupabaseConfigured };
