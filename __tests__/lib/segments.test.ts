import {
  addSegment,
  fileUriToPath,
  FULL_EPSILON_MS,
  isFull,
  MIN_SEGMENT_MS,
  nextSegmentLimits,
  progressParts,
  remainingMs,
  removeLastSegment,
  resolveSegmentDurationMs,
  segmentsKey,
  soundOffsetForSegment,
  stopDelayMs,
  totalDurationMs,
  totalSizeBytes,
  type Segment,
} from '@/lib/segments';

const seg = (id: string, durationMs: number, size: number | null = null): Segment => ({
  id,
  uri: `file:///cache/${id}.mp4`,
  durationMs,
  size,
});

const MB = 1024 * 1024;

describe('durées', () => {
  it('additionne les segments et ignore les valeurs invalides', () => {
    expect(totalDurationMs([])).toBe(0);
    expect(totalDurationMs([seg('a', 1200), seg('b', 3400)])).toBe(4600);
    expect(totalDurationMs([seg('a', 1000), seg('b', NaN), seg('c', -50)])).toBe(1000);
  });

  it('calcule le reste sous la durée max, jamais négatif', () => {
    expect(remainingMs([seg('a', 4000)], 15000)).toBe(11000);
    expect(remainingMs([seg('a', 16000)], 15000)).toBe(0);
    expect(remainingMs([], 0)).toBe(0);
  });

  it('additionne les tailles connues', () => {
    expect(totalSizeBytes([seg('a', 1, 10), seg('b', 1, null), seg('c', 1, 5)])).toBe(15);
  });

  it('préfère la durée du fichier à la mesure horloge', () => {
    expect(resolveSegmentDurationMs(2300, 2050, 10000)).toBe(2050);
    expect(resolveSegmentDurationMs(2300, null, 10000)).toBe(2300);
    expect(resolveSegmentDurationMs(2300, 0, 10000)).toBe(2300);
    expect(resolveSegmentDurationMs(0, null, 10000)).toBe(0);
  });
});

describe('ajout et annulation', () => {
  it('empile les segments dans l’ordre', () => {
    let list: Segment[] = [];
    list = addSegment(list, seg('a', 2000), 15000);
    list = addSegment(list, seg('b', 3000), 15000);
    expect(list.map((s) => s.id)).toEqual(['a', 'b']);
    expect(totalDurationMs(list)).toBe(5000);
  });

  it('ignore un segment vide ou sans fichier', () => {
    const base = [seg('a', 2000)];
    expect(addSegment(base, seg('b', 0), 15000)).toHaveLength(1);
    expect(addSegment(base, { ...seg('c', 1000), uri: '' }, 15000)).toHaveLength(1);
  });

  it('ne modifie pas la liste d’origine', () => {
    const base = [seg('a', 2000)];
    const next = addSegment(base, seg('b', 1000), 15000);
    expect(base).toHaveLength(1);
    expect(next).not.toBe(base);
  });

  it('retire le dernier segment et le renvoie pour suppression du fichier', () => {
    const { segments, removed } = removeLastSegment([seg('a', 1000), seg('b', 2000)]);
    expect(segments.map((s) => s.id)).toEqual(['a']);
    expect(removed?.id).toBe('b');
  });

  it('annuler sans segment ne fait rien', () => {
    expect(removeLastSegment([])).toEqual({ segments: [], removed: null });
  });

  it('annuler libère le temps correspondant', () => {
    const list = [seg('a', 5000), seg('b', 10000)];
    expect(isFull(list, 15000)).toBe(true);
    const { segments } = removeLastSegment(list);
    expect(isFull(segments, 15000)).toBe(false);
    expect(remainingMs(segments, 15000)).toBe(10000);
  });
});

describe('coupure à la durée max', () => {
  it('borne le dernier segment au reste disponible', () => {
    const list = addSegment([seg('a', 12000)], seg('b', 4500), 15000);
    expect(list[1].durationMs).toBe(3000);
    expect(totalDurationMs(list)).toBe(15000);
    expect(isFull(list, 15000)).toBe(true);
  });

  it('refuse un segment quand c’est déjà plein', () => {
    const full = [seg('a', 15000)];
    expect(addSegment(full, seg('b', 1000), 15000)).toHaveLength(1);
  });

  it('considère plein à FULL_EPSILON_MS près', () => {
    expect(isFull([seg('a', 15000 - FULL_EPSILON_MS)], 15000)).toBe(true);
    expect(isFull([seg('a', 15000 - FULL_EPSILON_MS - 1)], 15000)).toBe(false);
    expect(isFull([], 15000)).toBe(false);
  });

  it('borne la durée retenue même si la caméra a dépassé l’arrêt', () => {
    expect(resolveSegmentDurationMs(3400, 3350, 3000)).toBe(3000);
  });

  it('donne à la caméra des limites cohérentes avec le reste', () => {
    const l = nextSegmentLimits([seg('a', 12500, 20 * MB)], 15000, 50 * MB);
    expect(l.autoStopMs).toBe(2500);
    // expo-camera Android : secondes entières, arrondi au-dessus.
    expect(l.maxDurationSec).toBe(3);
    expect(l.maxFileSize).toBe(30 * MB);
  });

  it('ne passe jamais 0 (« sans limite ») à la caméra', () => {
    const l = nextSegmentLimits([seg('a', 15000, 60 * MB)], 15000, 50 * MB);
    expect(l.maxDurationSec).toBeGreaterThanOrEqual(1);
    expect(l.maxFileSize).toBeGreaterThan(0);
    expect(l.autoStopMs).toBe(0);
  });

  it('premier segment : toute la durée et tout le budget', () => {
    const l = nextSegmentLimits([], 60000, 50 * MB);
    expect(l).toEqual({ maxDurationSec: 60, maxFileSize: 50 * MB, autoStopMs: 60000 });
  });
});

describe('début du son pour chaque segment', () => {
  it('le premier segment part du début choisi', () => {
    expect(soundOffsetForSegment(8000, 0, 30000)).toBe(8000);
  });

  it('chaque segment reprend là où le précédent s’est arrêté', () => {
    const list = [seg('a', 2500), seg('b', 4000)];
    expect(soundOffsetForSegment(8000, totalDurationMs(list), 30000)).toBe(14500);
  });

  it('boucle sur la durée du son, comme la lecture synchronisée', () => {
    // 25 s + 7 s = 32 s sur un son de 30 s → 2 s.
    expect(soundOffsetForSegment(25000, 7000, 30000)).toBe(2000);
  });

  it('sans durée connue, pas de boucle', () => {
    expect(soundOffsetForSegment(1000, 5000, null)).toBe(6000);
    expect(soundOffsetForSegment(1000, 5000, 0)).toBe(6000);
  });

  it('ignore les valeurs invalides', () => {
    expect(soundOffsetForSegment(NaN, -10, 30000)).toBe(0);
  });

  it('après une annulation, le son repart de l’offset du segment supprimé', () => {
    const list = [seg('a', 3000), seg('b', 2000)];
    const { segments } = removeLastSegment(list);
    expect(soundOffsetForSegment(1000, totalDurationMs(segments), 60000)).toBe(4000);
  });
});

describe('arrêt différé d’un segment trop court', () => {
  it('attend ce qui manque pour atteindre MIN_SEGMENT_MS', () => {
    expect(stopDelayMs(100)).toBe(MIN_SEGMENT_MS - 100);
    expect(stopDelayMs(0)).toBe(MIN_SEGMENT_MS);
    expect(stopDelayMs(MIN_SEGMENT_MS)).toBe(0);
    expect(stopDelayMs(4000)).toBe(0);
  });
});

describe('barre de progression', () => {
  it('une part par segment et un séparateur à la fin de chacun', () => {
    const p = progressParts([seg('a', 3000), seg('b', 6000)], 15000, 1500);
    expect(p.segments).toEqual([0.2, 0.4]);
    expect(p.separators).toEqual([0.2, 0.6]);
    expect(p.current).toBeCloseTo(0.1);
  });

  it('ne dépasse jamais 100 %', () => {
    const p = progressParts([seg('a', 14000)], 15000, 5000);
    expect(p.segments[0] + p.current).toBeCloseTo(1);
  });

  it('durée max nulle : rien à dessiner', () => {
    expect(progressParts([seg('a', 1000)], 0)).toEqual({
      segments: [0],
      current: 0,
      separators: [],
    });
  });
});

describe('utilitaires', () => {
  it('la signature change avec la liste de segments', () => {
    expect(segmentsKey([seg('a', 1), seg('b', 1)])).toBe('a|b');
    expect(segmentsKey([seg('a', 1)])).not.toBe(segmentsKey([seg('a', 1), seg('b', 1)]));
  });

  it('convertit une URI file:// en chemin absolu', () => {
    expect(fileUriToPath('file:///data/user/0/app/cache/a.mp4')).toBe(
      '/data/user/0/app/cache/a.mp4',
    );
    expect(fileUriToPath('file:///data/my%20dir/a.mp4')).toBe('/data/my dir/a.mp4');
    expect(fileUriToPath('/already/a/path.mp4')).toBe('/already/a/path.mp4');
  });
});

describe('cohérence avec la synchro S2', () => {
  it('même position que soundTargetSec sur la vidéo assemblée', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { soundTargetSec } = require('@/lib/soundSync') as typeof import('@/lib/soundSync');
    const list = [seg('a', 4200), seg('b', 3100)];
    const elapsed = totalDurationMs(list);
    const fromSegments = soundOffsetForSegment(20000, elapsed, 25000) / 1000;
    expect(fromSegments).toBeCloseTo(soundTargetSec(elapsed / 1000, 20000, 25));
  });
});
