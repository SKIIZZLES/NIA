/**
 * Suppression de compte — exigence Google Play pour toute application
 * permettant la création d'un compte.
 *
 * Appelle la RPC `delete_own_account` (migration 013), qui supprime les
 * fichiers du bucket `videos` puis la ligne `auth.users`. La cascade efface
 * profil, vidéos et interactions.
 *
 * Mode mock (env Supabase absentes ou EXPO_PUBLIC_USE_MOCK=1) : rien à
 * supprimer côté serveur, on le dit au lieu de simuler un succès.
 */
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';

export type DeleteAccountResult =
  | { ok: true; mock: boolean }
  | { ok: false; message: string };

export async function deleteOwnAccount(
  userId: string | null | undefined,
): Promise<DeleteAccountResult> {
  const sb = getSupabase();
  const isRealAccount =
    !!sb && isSupabaseConfigured && !!userId && !userId.startsWith('mock_');

  if (!isRealAccount) {
    return { ok: true, mock: true };
  }

  try {
    const { error } = await sb!.rpc('delete_own_account');
    if (error) {
      return { ok: false, message: error.message };
    }
    return { ok: true, mock: false };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : 'Erreur inconnue',
    };
  }
}
