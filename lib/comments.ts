/**
 * Comments — list / add ; mock fallback si Supabase non configuré.
 */
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';
import type { CommentRow, ProfileRow } from '@/types/database';

export type CommentWithAuthor = CommentRow & {
  profiles: Pick<ProfileRow, 'username' | 'avatar_url' | 'display_name'> | null;
};

const MOCK_COMMENTS: CommentWithAuthor[] = [];

export async function listComments(videoId: string): Promise<CommentWithAuthor[]> {
  const sb = getSupabase();
  if (!sb || !isSupabaseConfigured) return MOCK_COMMENTS;

  const { data, error } = await sb
    .from('comments')
    .select('*, profiles(username, avatar_url, display_name)')
    .eq('video_id', videoId)
    .order('created_at', { ascending: true })
    .limit(100);

  if (error) throw error;
  return (data || []) as unknown as CommentWithAuthor[];
}

export async function addComment(
  userId: string,
  videoId: string,
  body: string,
): Promise<CommentWithAuthor | null> {
  const trimmed = body.trim();
  if (!trimmed) throw new Error('Commentaire vide');

  const sb = getSupabase();
  if (!sb || !isSupabaseConfigured || userId.startsWith('mock_')) {
    return {
      id: `mock_c_${Date.now()}`,
      video_id: videoId,
      user_id: userId,
      body: trimmed,
      created_at: new Date().toISOString(),
      profiles: null,
    };
  }

  const { data, error } = await sb
    .from('comments')
    .insert({
      user_id: userId,
      video_id: videoId,
      body: trimmed,
    })
    .select('*, profiles(username, avatar_url, display_name)')
    .single();

  if (error) throw error;
  return data as unknown as CommentWithAuthor;
}

export { isSupabaseConfigured };
