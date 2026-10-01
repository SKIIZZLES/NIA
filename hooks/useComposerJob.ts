/**
 * Éditeur P0 — un export NiaComposer au premier plan.
 *
 * - progression 0 → 1 pour l'écran d'export ;
 * - annulation par l'utilisateur ;
 * - écran maintenu allumé pendant l'export (sinon la mise en veille ferait
 *   passer l'app en arrière-plan) ;
 * - l'app passe en arrière-plan : l'export est ARRÊTÉ (pas de service de
 *   fond, décision du fondateur ; Android peut tuer le processus à tout
 *   moment). Le résultat vaut alors `left`, pour un message clair au retour.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { cancelComposition, composerErrorCode } from '@/lib/composer';

const KEEP_AWAKE_TAG = 'nia-composer-export';

export type ComposerJobOutcome<T> =
  | { status: 'done'; value: T }
  | { status: 'cancelled' }
  | { status: 'left' }
  | { status: 'failed'; code: string | null; error: unknown };

export function useComposerJob() {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const runningRef = useRef(false);
  const leftRef = useRef(false);
  const cancelledRef = useRef(false);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background' && runningRef.current) {
        leftRef.current = true;
        void cancelComposition();
      }
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!running) return;
    void activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => undefined);
    return () => {
      void Promise.resolve(deactivateKeepAwake(KEEP_AWAKE_TAG)).catch(() => undefined);
    };
  }, [running]);

  // Écran quitté pendant un export : on ne le laisse pas tourner pour rien.
  useEffect(
    () => () => {
      if (runningRef.current) void cancelComposition();
    },
    [],
  );

  const run = useCallback(
    async <T,>(
      task: (onProgress: (p: number) => void, isStopped: () => boolean) => Promise<T>,
    ): Promise<ComposerJobOutcome<T>> => {
      if (runningRef.current) return { status: 'failed', code: 'ERR_BUSY', error: null };
      runningRef.current = true;
      leftRef.current = false;
      cancelledRef.current = false;
      setProgress(0);
      setRunning(true);
      try {
        // isStopped : annulé ou app quittée pendant une étape JS (V2 : capture
        // des calques avant l'export natif).
        const value = await task(
          (p) => setProgress(p),
          () => cancelledRef.current || leftRef.current,
        );
        if (leftRef.current) return { status: 'left' };
        return { status: 'done', value };
      } catch (error) {
        if (leftRef.current) return { status: 'left' };
        const code = composerErrorCode(error);
        if (cancelledRef.current || code === 'ERR_CANCELLED') return { status: 'cancelled' };
        return { status: 'failed', code, error };
      } finally {
        runningRef.current = false;
        setRunning(false);
      }
    },
    [],
  );

  const cancel = useCallback(() => {
    if (!runningRef.current) return;
    cancelledRef.current = true;
    void cancelComposition();
  }, []);

  return { running, progress, run, cancel };
}
