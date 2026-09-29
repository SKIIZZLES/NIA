import { clampTrimRange, frameTimes, isFullRange, MIN_TRIM_MS } from '@/lib/videoTrim';

describe('clampTrimRange', () => {
  it('borne la sélection dans la durée', () => {
    expect(clampTrimRange(-500, 20000, 10000)).toEqual({ startMs: 0, endMs: 10000 });
  });
  it('impose une durée minimale', () => {
    const r = clampTrimRange(5000, 5200, 10000);
    expect(r.endMs - r.startMs).toBe(MIN_TRIM_MS);
  });
  it('recule le début si la fin touche la durée', () => {
    expect(clampTrimRange(9800, 10000, 10000)).toEqual({ startMs: 9000, endMs: 10000 });
  });
});

describe('isFullRange', () => {
  it('reconnaît la vidéo entière à 100 ms près', () => {
    expect(isFullRange(50, 9950, 10000)).toBe(true);
    expect(isFullRange(1000, 10000, 10000)).toBe(false);
  });
});

describe('frameTimes', () => {
  it('répartit les images au milieu de chaque segment', () => {
    expect(frameTimes(8000, 4)).toEqual([1000, 3000, 5000, 7000]);
    expect(frameTimes(0, 4)).toEqual([]);
  });
});
