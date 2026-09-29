/**
 * Composant sans rendu autour de useSyncedSound (sprint S2).
 *
 * À monter seulement quand un son existe : un lecteur audio natif n'est ainsi
 * créé que pour les éléments qui en ont besoin (pas un par carte du feed).
 */
import { useSyncedSound, type SyncedSoundOptions } from '@/hooks/useSyncedSound';

export function SyncedSound(props: SyncedSoundOptions & { url: string }) {
  useSyncedSound(props);
  return null;
}
