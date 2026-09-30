/**
 * Éditeur V1 (Montage) — horloge de la timeline.
 *
 * Le lecteur de montage (components/TimelinePlayer) passe d'un clip à
 * l'autre : aucun lecteur vidéo ne donne à lui seul l'instant de la
 * timeline. Il le publie ici ; les calques, la tête de lecture de la bande et
 * le son s'y abonnent sans refaire le rendu de tout l'écran.
 */
import { useEffect, useState } from 'react';

export type TimelineClock = {
  /** Instant de la timeline, en ms (temps de sortie). */
  get: () => number;
  set: (ms: number) => void;
  subscribe: (fn: (ms: number) => void) => () => void;
};

export function createTimelineClock(initialMs = 0): TimelineClock {
  let now = initialMs;
  const subs = new Set<(ms: number) => void>();
  return {
    get: () => now,
    set: (ms: number) => {
      const v = Number.isFinite(ms) && ms > 0 ? ms : 0;
      if (v === now) return;
      now = v;
      for (const fn of [...subs]) fn(v);
    },
    subscribe: (fn) => {
      subs.add(fn);
      return () => {
        subs.delete(fn);
      };
    },
  };
}

/**
 * Instant de l'horloge, rafraîchi au plus toutes les `intervalMs` ms (le
 * dernier instant est toujours rendu). null sans horloge.
 */
export function useClockMs(clock: TimelineClock | null | undefined, intervalMs = 100): number | null {
  const [ms, setMs] = useState<number | null>(clock ? clock.get() : null);
  useEffect(() => {
    if (!clock) {
      setMs(null);
      return;
    }
    setMs(clock.get());
    let last = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = clock.subscribe((v) => {
      const now = Date.now();
      if (now - last >= intervalMs) {
        last = now;
        if (timer) clearTimeout(timer);
        timer = null;
        setMs(v);
        return;
      }
      if (!timer) {
        timer = setTimeout(() => {
          timer = null;
          last = Date.now();
          setMs(clock.get());
        }, intervalMs);
      }
    });
    return () => {
      unsub();
      if (timer) clearTimeout(timer);
    };
  }, [clock, intervalMs]);
  return ms;
}
