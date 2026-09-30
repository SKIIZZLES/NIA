/**
 * Bloque le retour matériel Android pendant une opération qui ne doit pas
 * être interrompue par une sortie d'écran (découpe, envoi, ouverture d'un
 * brouillon) — sprint S7, finitions.
 *
 * Sans ce garde, le retour quittait l'écran pendant que l'opération
 * continuait, puis sa fin naviguait depuis un écran démonté.
 */
import { useEffect } from 'react';
import { BackHandler, Platform } from 'react-native';

export function useBlockBackWhile(blocked: boolean): void {
  useEffect(() => {
    if (Platform.OS !== 'android' || !blocked) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, [blocked]);
}
