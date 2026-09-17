/**
 * Follows — toggle ; mock no-op si Supabase non configuré.
 */
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';

export async function isFollowing(
  followerId: string,
  followingId: string,
): Promise<boolean> {
  const sb = getSupabase();
  if (!sb || !isSupabaseConfigured || followerId.startsWith('mock_')) return false;

  const { data, error } = await sb
    .from('follows')
    .select('follower_id')
    .eq('follower_id', followerId)
    .eq('following_id', followingId)
    .maybeSingle();

  if (error) throw error;
  return !!data;
}

/**
 * Toggle follow. Retourne true si abonné après l'opération.
 */
export async function toggleFollow(
  followerId: string,
  followingId: string,
  currentlyFollowing: boolean,
): Promise<boolean> {
  if (followerId === followingId) {
    throw new Error('Impossible de se suivre soi-même');
  }

  const sb = getSupabase();
  if (!sb || !isSupabaseConfigured || followerId.startsWith('mock_')) {
    return !currentlyFollowing;
  }

  if (currentlyFollowing) {
    const { error } = await sb
      .from('follows')
      .delete()
      .eq('follower_id', followerId)
      .eq('following_id', followingId);
    if (error) throw error;
    return false;
  }

  const { error } = await sb.from('follows').insert({
    follower_id: followerId,
    following_id: followingId,
  });
  if (error) {
    if (error.code === '23505') return true;
    throw error;
  }
  return true;
}

export async function fetchFollowingIds(followerId: string): Promise<string[]> {
  const sb = getSupabase();
  if (!sb || !isSupabaseConfigured || followerId.startsWith('mock_')) return [];

  const { data, error } = await sb
    .from('follows')
    .select('following_id')
    .eq('follower_id', followerId);

  if (error) throw error;
  return (data || []).map((row) => row.following_id);
}

export { isSupabaseConfigured };
