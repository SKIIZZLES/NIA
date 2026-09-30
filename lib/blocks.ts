/**
 * Blocage utilisateurs — table `blocks` ; mock local si offline.
 *
 * Avec la migration 017, le blocage est aussi appliqué par le serveur
 * (RLS) : la personne bloquée ne voit plus vos vidéos, lives et
 * commentaires, et ne peut plus commenter, aimer ni vous suivre. Les
 * abonnements dans les deux sens sont supprimés au blocage.
 */
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';

export type BlockErrorKey =
  | 'safety.blockSelf'
  | 'safety.blockError'
  | 'safety.unblockError'
  | 'safety.serviceUnavailable';

export type BlockResult =
  | { ok: true; mock: boolean; blocked: boolean }
  /** Clé i18n : l'appelant traduit. */
  | { ok: false; errorKey: BlockErrorKey };

export type BlockedAccount = {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  blockedAt: string | null;
};

function isUuid(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

function canPersist(blockerId: string, blockedId?: string): boolean {
  const sb = getSupabase();
  return (
    !!sb &&
    isSupabaseConfigured &&
    !!blockerId &&
    !blockerId.startsWith('mock_') &&
    (blockedId === undefined || isUuid(blockedId))
  );
}

export async function fetchBlockedIds(blockerId: string): Promise<string[]> {
  if (!canPersist(blockerId)) return [];
  try {
    const { data, error } = await getSupabase()!
      .from('blocks')
      .select('blocked_id')
      .eq('blocker_id', blockerId);
    if (error) return [];
    return (data || []).map((row) => row.blocked_id);
  } catch {
    return [];
  }
}

type BlockRow = {
  blocked_id: string;
  created_at?: string | null;
  profiles?: { username: string | null; display_name: string | null; avatar_url: string | null } | null;
};

export function mapBlockedRows(rows: BlockRow[]): BlockedAccount[] {
  return rows.map((r) => ({
    id: r.blocked_id,
    username: r.profiles?.username ?? null,
    displayName: r.profiles?.display_name ?? null,
    avatarUrl: r.profiles?.avatar_url ?? null,
    blockedAt: r.created_at ?? null,
  }));
}

/**
 * Comptes bloqués, avec leur profil. `null` = chargement impossible (réseau) :
 * l'écran l'affiche au lieu d'une liste vide trompeuse.
 */
export async function fetchBlockedAccounts(blockerId: string): Promise<BlockedAccount[] | null> {
  if (!canPersist(blockerId)) return [];
  try {
    const { data, error } = await getSupabase()!
      .from('blocks')
      .select('blocked_id, created_at, profiles!blocks_blocked_id_fkey(username, display_name, avatar_url)')
      .eq('blocker_id', blockerId)
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) return null;
    return mapBlockedRows((data || []) as unknown as BlockRow[]);
  } catch {
    return null;
  }
}

/** Bloque un utilisateur. Succès mock si pas de Supabase / auth réelle. */
export async function blockUser(blockerId: string, blockedId: string): Promise<BlockResult> {
  if (!blockerId || !blockedId || blockerId === blockedId) {
    return { ok: false, errorKey: 'safety.blockSelf' };
  }
  if (!canPersist(blockerId, blockedId)) {
    return { ok: true, mock: true, blocked: true };
  }
  try {
    const { error } = await getSupabase()!.from('blocks').insert({
      blocker_id: blockerId,
      blocked_id: blockedId,
    });
    if (error) {
      if (error.code === '23505') return { ok: true, mock: false, blocked: true };
      return { ok: false, errorKey: 'safety.blockError' };
    }
    return { ok: true, mock: false, blocked: true };
  } catch {
    return { ok: false, errorKey: 'safety.serviceUnavailable' };
  }
}

export async function unblockUser(blockerId: string, blockedId: string): Promise<BlockResult> {
  if (!canPersist(blockerId, blockedId)) {
    return { ok: true, mock: true, blocked: false };
  }
  try {
    const { error } = await getSupabase()!
      .from('blocks')
      .delete()
      .eq('blocker_id', blockerId)
      .eq('blocked_id', blockedId);
    if (error) return { ok: false, errorKey: 'safety.unblockError' };
    return { ok: true, mock: false, blocked: false };
  } catch {
    return { ok: false, errorKey: 'safety.serviceUnavailable' };
  }
}

export { isSupabaseConfigured };
