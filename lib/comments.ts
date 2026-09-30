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
    .select('*, profiles!comments_user_id_fkey(username, avatar_url, display_name)')
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
    .select('*, profiles!comments_user_id_fkey(username, avatar_url, display_name)')
    .single();

  if (error) throw error;
  return data as unknown as CommentWithAuthor;
}

export type DeleteCommentResult =
  | { ok: true; mock?: boolean }
  | { ok: false; message: string };

/**
 * Supprime son propre commentaire.
 *
 * La politique `comments_delete_own` (002) autorise exactement cela, et rien de
 * plus. Le filtre `user_id` ici est redondant avec elle — et c'est voulu : une
 * politique se modifie dans le tableau de bord Supabase sans que personne ne
 * relise ce fichier, et la requête resterait alors correcte.
 *
 * Les commentaires optimistes (`opt_…`) et ceux du mode démo (`mock_c_…`)
 * n'existent pas côté serveur : la fonction ne tente rien et l'écran les
 * retire de la liste, ce qui est le seul effet attendu.
 */
export async function deleteOwnComment(
  userId: string,
  commentId: string,
): Promise<DeleteCommentResult> {
  const sb = getSupabase();
  const local = commentId.startsWith('opt_') || commentId.startsWith('mock_c_');
  if (!sb || !isSupabaseConfigured || userId.startsWith('mock_') || local) {
    return { ok: true, mock: true };
  }
  if (!userId || !commentId) {
    return { ok: false, message: 'missing_ids' };
  }

  try {
    const { data, error } = await sb
      .from('comments')
      .delete()
      .eq('id', commentId)
      .eq('user_id', userId)
      .select('id')
      .maybeSingle();

    if (error) return { ok: false, message: error.message || 'delete_fail' };
    if (!data) return { ok: false, message: 'not_owner_or_missing' };
    return { ok: true, mock: false };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : 'delete_fail',
    };
  }
}

export { isSupabaseConfigured };
