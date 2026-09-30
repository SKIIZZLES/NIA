/**
 * Éditeur V1 (Montage) — horloge de la timeline (lib/timelineClock).
 */
import { createTimelineClock } from '@/lib/timelineClock';

describe('createTimelineClock', () => {
  it('publie l’instant aux abonnés, sans doublon ni valeur négative', () => {
    const clock = createTimelineClock();
    const seen: number[] = [];
    const unsub = clock.subscribe((ms) => seen.push(ms));
    clock.set(120);
    clock.set(120);
    clock.set(-5);
    clock.set(Number.NaN);
    clock.set(900);
    expect(seen).toEqual([120, 0, 900]);
    expect(clock.get()).toBe(900);
    unsub();
    clock.set(1000);
    expect(seen).toEqual([120, 0, 900]);
  });

  it('un abonné qui se désabonne pendant la diffusion ne bloque pas les autres', () => {
    const clock = createTimelineClock(10);
    const b: number[] = [];
    const unsubA = clock.subscribe(() => unsubA());
    clock.subscribe((ms) => b.push(ms));
    clock.set(20);
    clock.set(30);
    expect(b).toEqual([20, 30]);
    expect(clock.get()).toBe(30);
  });
});
