import {
  MAX_EDIT_META_BYTES,
  buildEditMeta,
  editMetaBytes,
  isDefaultEditMeta,
  parseEditMeta,
} from '@/lib/editMeta';
import type { Overlay } from '@/lib/overlays';

const text = (id: string, over: Partial<Overlay> = {}): Overlay =>
  ({
    id,
    type: 'text',
    text: 'Salut',
    font: 'classique',
    color: 'sable',
    bg: 'none',
    x: 0.5,
    y: 0.5,
    size: 0.08,
    rotation: 0,
    startMs: 0,
    endMs: null,
    ...over,
  }) as Overlay;

const base = {
  trim: null,
  sourceDurationMs: null,
  speed: 1,
  hasSound: false,
  soundOffsetMs: 0,
  soundVolume: 1,
  originalVolume: 1,
  overlays: null,
  isVideo: true,
};

describe('buildEditMeta', () => {
  it('renvoie null quand tout est par défaut', () => {
    expect(buildEditMeta(base)).toBeNull();
  });

  it('enregistre vitesse, son et volumes', () => {
    const meta = buildEditMeta({
      ...base,
      speed: 1.5,
      hasSound: true,
      soundOffsetMs: 12_345.6,
      soundVolume: 0.7,
      originalVolume: 0.2,
    });
    expect(meta).toEqual({
      v: 1,
      trim: null,
      speed: 1.5,
      sound: { offsetMs: 12_346, volume: 0.7 },
      originalVolume: 0.2,
      overlays: null,
    });
  });

  it('borne les valeurs et arrondit la vitesse au cran le plus proche', () => {
    const meta = buildEditMeta({
      ...base,
      speed: 7,
      hasSound: true,
      soundOffsetMs: -50,
      soundVolume: 3,
      originalVolume: -1,
    });
    expect(meta?.speed).toBe(2);
    expect(meta?.sound).toEqual({ offsetMs: 0, volume: 1 });
    expect(meta?.originalVolume).toBe(0);
  });

  it('ignore volume original sans son ajouté, et vitesse/découpe pour une photo', () => {
    expect(buildEditMeta({ ...base, originalVolume: 0.3 })).toBeNull();
    expect(
      buildEditMeta({ ...base, isVideo: false, speed: 2, trim: { startMs: 0, endMs: 1000 } }),
    ).toBeNull();
  });

  it('garde la découpe (information) et les calques', () => {
    const meta = buildEditMeta({
      ...base,
      trim: { startMs: 1000.4, endMs: 9000 },
      sourceDurationMs: 30_000,
      overlays: { v: 1, aspect: 0.5625, items: [text('a')] },
    });
    expect(meta?.trim).toEqual({ startMs: 1000, endMs: 9000, sourceDurationMs: 30_000 });
    expect(meta?.overlays?.items).toHaveLength(1);
  });

  it('retire des calques pour tenir sous le plafond', () => {
    const items = Array.from({ length: 20 }, (_, i) =>
      text(`id${i}`, { text: 'é'.repeat(150) }),
    );
    const meta = buildEditMeta({ ...base, overlays: { v: 1, aspect: 1, items } });
    expect(meta).not.toBeNull();
    expect(editMetaBytes(meta!)).toBeLessThanOrEqual(MAX_EDIT_META_BYTES);
  });
});

describe('parseEditMeta', () => {
  it('rejette ce qui n’est pas un objet', () => {
    expect(parseEditMeta(null)).toBeUndefined();
    expect(parseEditMeta('x')).toBeUndefined();
    expect(parseEditMeta([1])).toBeUndefined();
  });

  it('relit un edit_meta valide', () => {
    const meta = buildEditMeta({
      ...base,
      speed: 0.5,
      hasSound: true,
      soundOffsetMs: 4000,
      soundVolume: 0.5,
      originalVolume: 0,
      overlays: { v: 1, aspect: 1, items: [text('a')] },
    });
    expect(parseEditMeta(JSON.parse(JSON.stringify(meta)))).toEqual(meta);
  });

  it('borne les données non fiables', () => {
    const meta = parseEditMeta({
      speed: 100,
      sound: { offsetMs: 1e12, volume: -3 },
      originalVolume: 'fort',
      trim: { startMs: 5000, endMs: 1000 },
      overlays: { items: 'pas une liste' },
    });
    expect(meta).toEqual({
      v: 1,
      trim: null,
      speed: 2,
      sound: { offsetMs: 3_600_000, volume: 0 },
      originalVolume: 1,
      overlays: null,
    });
  });

  it('vitesse nulle ou négative → 1x', () => {
    expect(parseEditMeta({ speed: 0 })?.speed).toBe(1);
    expect(parseEditMeta({ speed: -2 })?.speed).toBe(1);
  });
});

describe('isDefaultEditMeta', () => {
  it('détecte un réglage neutre', () => {
    expect(isDefaultEditMeta(parseEditMeta({})!)).toBe(true);
    expect(isDefaultEditMeta(parseEditMeta({ speed: 2 })!)).toBe(false);
  });
});

describe('edit_meta cuit (éditeur P0, baked)', () => {
  const doc = (items: Overlay[]) => ({ v: 1 as const, aspect: 9 / 16, items });

  it('neutralise vitesse, son et volume pour les anciens APK', () => {
    const meta = buildEditMeta({
      ...base,
      speed: 2,
      hasSound: true,
      soundOffsetMs: 12_000,
      soundVolume: 0.6,
      originalVolume: 0.3,
      baked: true,
    });
    expect(meta).toMatchObject({
      speed: 1,
      sound: { offsetMs: 0, volume: 0 },
      originalVolume: 1,
      baked: true,
    });
  });

  it('garde un edit_meta même sans réglage (le drapeau suffit)', () => {
    const meta = buildEditMeta({ ...base, baked: true });
    expect(meta).not.toBeNull();
    expect(meta?.baked).toBe(true);
    expect(meta?.sound).toBeNull();
  });

  it('recale l’horaire des calques sur la vitesse cuite', () => {
    const meta = buildEditMeta({
      ...base,
      speed: 2,
      overlays: doc([text('a', { startMs: 4000, endMs: 8000 })]),
      baked: true,
    });
    expect(meta?.overlays?.items[0]).toMatchObject({ startMs: 2000, endMs: 4000 });
  });

  it('ignore baked pour une photo', () => {
    expect(buildEditMeta({ ...base, isVideo: false, baked: true })).toBeNull();
  });

  it('relit baked, et seulement la valeur true', () => {
    expect(parseEditMeta({ speed: 1, baked: true })?.baked).toBe(true);
    expect(parseEditMeta({ speed: 1, baked: 'yes' })?.baked).toBeUndefined();
    expect(parseEditMeta({ speed: 1 })?.baked).toBeUndefined();
  });

  it('un document cuit n’est jamais « par défaut »', () => {
    const meta = parseEditMeta({ speed: 1, baked: true });
    expect(meta && isDefaultEditMeta(meta)).toBe(false);
  });

  it('reste relisible par l’ancien lecteur (champs connus seulement)', () => {
    const meta = buildEditMeta({ ...base, speed: 1.5, hasSound: true, baked: true });
    const { baked: _ignored, ...legacy } = meta as NonNullable<typeof meta>;
    const reread = parseEditMeta(legacy);
    expect(reread).toMatchObject({ speed: 1, sound: { volume: 0 }, originalVolume: 1 });
  });
});
