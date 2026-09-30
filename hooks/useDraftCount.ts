/**
 * Nombre de brouillons locaux de l'utilisateur courant (sprint S6), relu à
 * chaque retour sur l'écran : un brouillon enregistré, rouvert, publié ou
 * supprimé ailleurs se reflète dès qu'on revient.
 */
import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import { countDrafts, isDraftStorageAvailable } from '@/lib/drafts';

export function useDraftCount(): number {
  const { user } = useAuth();
  const ownerId = user?.id ?? null;
  const [count, setCount] = useState(0);

  useFocusEffect(
    useCallback(() => {
      if (!isDraftStorageAvailable()) return;
      let alive = true;
      countDrafts(ownerId)
        .then((n) => {
          if (alive) setCount(n);
        })
        .catch(() => {
          if (alive) setCount(0);
        });
      return () => {
        alive = false;
      };
    }, [ownerId]),
  );

  return count;
}
