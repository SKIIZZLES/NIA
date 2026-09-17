/**
 * Profils publics + édition — no-op / mock si Supabase off.
 */
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';
import type { ProfileRow, VideoRow } from '@/types/database';
import type { VideoItem } from '@/data/mockVideos';
import { mapRowToVideoItem } from '@/lib/videos';
import { DEMO_VIDEOS } from '@/data/mockVideos';

export type PublicProfile = {
  id: string;
  username: string;
  displayName: string;
  bio: string;
  avatarUrl: string;
  followerCount: number;
  followingCount: number;
};

type VideoWithProfile = VideoRow & {
  profiles: Pick<ProfileRow, 'username' | 'avatar_url' | 'display_name'> | null;
};

function rowToPublic(profile: ProfileRow, followers: number, following: number): PublicProfile {
  const username = profile.username || 'createur';
  return {
    id: profile.id,
    username,
    displayName: profile.display_name || username,
    bio: profile.bio || '',
    avatarUrl:
      profile.avatar_url ||
      `https://i.pravatar.cc/200?u=${encodeURIComponent(username)}`,
    followerCount: followers,
    followingCount: following,
  };
}

/** Mock profiles dérivés des démos (username sans @). */
function mockProfileFromHandle(handleOrUsername: string): PublicProfile | null {
  const bare = handleOrUsername.replace(/^@/, '').toLowerCase();
  const demo = DEMO_VIDEOS.find(
    (v) => v.handle.replace(/^@/, '').toLowerCase() === bare,
  );
  if (!demo) return null;
  return {
    id: demo.userId || `mock_${bare}`,
    username: bare,
    displayName: bare.replace(/\./g, ' '),
    bio: 'Créateur·rice sur NIA · cultures & talents 🌍',
    avatarUrl: demo.avatarUrl,
    followerCount: Math.max(100, Math.floor(demo.likes / 10)),
    followingCount: 42,
  };
}

export async function fetchProfileByUsername(
  username: string,
): Promise<PublicProfile | null> {
  const bare = username.replace(/^@/, '').toLowerCase();
  const sb = getSupabase();
  if (!sb || !isSupabaseConfigured) {
    return mockProfileFromHandle(bare);
  }

  const { data, error } = await sb
    .from('profiles')
    .select('*')
    .ilike('username', bare)
    .maybeSingle();

  if (error) throw error;
  if (!data) return mockProfileFromHandle(bare);

  const [followers, following] = await Promise.all([
    countFollowers(data.id),
    countFollowing(data.id),
  ]);
  return rowToPublic(data, followers, following);
}

export async function fetchProfileById(userId: string): Promise<PublicProfile | null> {
  const sb = getSupabase();
  if (!sb || !isSupabaseConfigured || userId.startsWith('mock_')) {
    const demo = DEMO_VIDEOS.find((v) => v.userId === userId);
    if (!demo) return mockProfileFromHandle(userId.replace(/^mock_user_/, ''));
    return mockProfileFromHandle(demo.handle);
  }

  const { data, error } = await sb
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const [followers, following] = await Promise.all([
    countFollowers(data.id),
    countFollowing(data.id),
  ]);
  return rowToPublic(data, followers, following);
}

export async function countFollowers(userId: string): Promise<number> {
  const sb = getSupabase();
  if (!sb || !isSupabaseConfigured || userId.startsWith('mock_')) return 0;

  const { count, error } = await sb
    .from('follows')
    .select('*', { count: 'exact', head: true })
    .eq('following_id', userId);

  if (error) throw error;
  return count ?? 0;
}

export async function countFollowing(userId: string): Promise<number> {
  const sb = getSupabase();
  if (!sb || !isSupabaseConfigured || userId.startsWith('mock_')) return 0;

  const { count, error } = await sb
    .from('follows')
    .select('*', { count: 'exact', head: true })
    .eq('follower_id', userId);

  if (error) throw error;
  return count ?? 0;
}

export async function fetchVideosByUserId(userId: string): Promise<VideoItem[]> {
  const sb = getSupabase();
  if (!sb || !isSupabaseConfigured || userId.startsWith('mock_')) {
    return DEMO_VIDEOS.filter((v) => v.userId === userId);
  }

  const { data, error } = await sb
    .from('videos')
    .select('*, profiles(username, avatar_url, display_name)')
    .eq('user_id', userId)
    .eq('status', 'published')
    .order('created_at', { ascending: false })
    .limit(60);

  if (error) {
    const fallback = await sb
      .from('videos')
      .select('*, profiles(username, avatar_url, display_name)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(60);
    if (fallback.error) throw fallback.error;
    const rows = (fallback.data || []) as unknown as VideoWithProfile[];
    return rows.map((row) => {
      const { data: urlData } = sb.storage.from('videos').getPublicUrl(row.storage_path);
      return mapRowToVideoItem(row, urlData.publicUrl);
    });
  }

  const rows = (data || []) as unknown as VideoWithProfile[];
  return rows.map((row) => {
    const { data: urlData } = sb.storage.from('videos').getPublicUrl(row.storage_path);
    return mapRowToVideoItem(row, urlData.publicUrl);
  });
}

export async function updateProfile(
  userId: string,
  patch: { display_name?: string; bio?: string },
): Promise<ProfileRow | null> {
  const sb = getSupabase();
  if (!sb || !isSupabaseConfigured || userId.startsWith('mock_')) {
    return null;
  }

  const { data, error } = await sb
    .from('profiles')
    .update({
      ...(patch.display_name !== undefined ? { display_name: patch.display_name } : {}),
      ...(patch.bio !== undefined ? { bio: patch.bio } : {}),
    })
    .eq('id', userId)
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

export { isSupabaseConfigured };
