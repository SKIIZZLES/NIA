/**
 * Notifications — fetch ; [] si mock / vide / non configuré.
 */
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';
import type { NotificationRow, ProfileRow } from '@/types/database';

export type NotificationWithActor = NotificationRow & {
  profiles: Pick<ProfileRow, 'username' | 'avatar_url' | 'display_name'> | null;
};

export async function fetchNotifications(
  userId: string,
  limit = 40,
): Promise<NotificationWithActor[]> {
  const sb = getSupabase();
  if (!sb || !isSupabaseConfigured || !userId || userId.startsWith('mock_')) {
    return [];
  }

  const { data, error } = await sb
    .from('notifications')
    .select('*, profiles!notifications_actor_id_fkey(username, avatar_url, display_name)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    // table absente / RLS : ne pas planter l'UI
    console.warn('[nia] fetchNotifications', error.message);
    return [];
  }

  return (data || []) as unknown as NotificationWithActor[];
}

export async function markNotificationRead(notificationId: string): Promise<void> {
  const sb = getSupabase();
  if (!sb || !isSupabaseConfigured) return;

  const { error } = await sb
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', notificationId);

  if (error) throw error;
}

export { isSupabaseConfigured };
