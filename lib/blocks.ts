/**
 * Blocage utilisateurs — table `blocks` ; mock local si offline.
 */
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';

export type BlockResult =
  | { ok: true; mock: boolean; blocked: boolean }
  | { ok: false; message: string };

function isUuid(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    id,
  );
}

export async function fetchBlockedIds(blockerId: string): Promise<string[]> {
  const sb = getSupabase();
  if (!sb || !isSupabaseConfigured || !blockerId || blockerId.startsWith('mock_')) {
    return [];
  }
  try {
    const { data, error } = await sb
      .from('blocks')
      .select('blocked_id')
      .eq('blocker_id', blockerId);
    if (error) return [];
    return (data || []).map((row) => row.blocked_id);
  } catch {
    return [];
  }
}

/** Bloque un utilisateur. Succès mock si pas de Supabase / auth réelle. */
export async function blockUser(
  blockerId: string,
  blockedId: string,
): Promise<BlockResult> {
  if (!blockerId || !blockedId) {
    return { ok: false, message: 'Utilisateur invalide.' };
  }
  if (blockerId === blockedId) {
    return { ok: false, message: 'Impossible de vous bloquer vous-même.' };
  }

  const sb = getSupabase();
  const canPersist =
    !!sb &&
    isSupabaseConfigured &&
    !blockerId.startsWith('mock_') &&
    isUuid(blockedId);

  if (!canPersist) {
    return { ok: true, mock: true, blocked: true };
  }

  try {
    const { error } = await sb!.from('blocks').insert({
      blocker_id: blockerId,
      blocked_id: blockedId,
    });
    if (error) {
      if (error.code === '23505') {
        return { ok: true, mock: false, blocked: true };
      }
      return {
        ok: false,
        message: 'Impossible de bloquer cet utilisateur pour le moment.',
      };
    }
    return { ok: true, mock: false, blocked: true };
  } catch {
    return {
      ok: false,
      message: 'Service indisponible. Le blocage n’a pas pu être enregistré.',
    };
  }
}

export async function unblockUser(
  blockerId: string,
  blockedId: string,
): Promise<BlockResult> {
  const sb = getSupabase();
  const canPersist =
    !!sb &&
    isSupabaseConfigured &&
    !blockerId.startsWith('mock_') &&
    isUuid(blockedId);

  if (!canPersist) {
    return { ok: true, mock: true, blocked: false };
  }

  try {
    const { error } = await sb!
      .from('blocks')
      .delete()
      .eq('blocker_id', blockerId)
      .eq('blocked_id', blockedId);
    if (error) {
      return { ok: false, message: 'Impossible de débloquer cet utilisateur.' };
    }
    return { ok: true, mock: false, blocked: false };
  } catch {
    return {
      ok: false,
      message: 'Service indisponible. Réessayez plus tard.',
    };
  }
}

export { isSupabaseConfigured };
