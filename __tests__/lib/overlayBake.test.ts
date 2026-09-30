/**
 * Éditeur V2 — habillage incrusté : plan des calques (horaire de sortie),
 * cadre de capture, contrat NiaComposer et matrice du filtre (= voile de
 * l'aperçu).
 */
import { getFilterById, getFilterOverlayStyle } from '@/constants/filters';
import { buildPublishComposition, usesFixedCanvas } from '@/lib/composition';
import {
  applyBakeMatrix,
  bakeFrameWidthPx,
  composerFilter,
  composerOverlays,
  filterBakeMatrix,
  overlayBakePlan,
} from '@/lib/overlayBake';
import type { Overlay, OverlayDoc } from '@/lib/overlays';

const text = (id: string, over: Partial<Overlay> = {}): Overlay =>
  ({
    id,
    type: 'text',
    text: 'Salut',
    font: 'neon',
    color: 'or',
    bg: 'none',
    x: 0.25,
    y: 0.75,
    size: 0.08,
    rotation: 30,
    startMs: 0,
    endMs: null,
    ...over,
  }) as Overlay;
const doc = (items: Overlay[], aspect = 9 / 16): OverlayDoc => ({ v: 1, aspect, items });

describe('cadre de capture', () => {
  it('suit la sortie NiaComposer (petit côté 720, boîte 720 × 1280)', () => {
    expect(bakeFrameWidthPx(9 / 16, false)).toBe(720);
    expect(bakeFrameWidthPx(16 / 9, false)).toBe(1280);
    expect(bakeFrameWidthPx(4 / 3, false)).toBe(960);
    expect(bakeFrameWidthPx(1, false)).toBe(720);
    // Plus étroit que 9:16 : la hauteur plafonne à 1280.
    expect(bakeFrameWidthPx(0.5, false)).toBe(640);
    expect(bakeFrameWidthPx(16 / 9, true)).toBe(720);
    expect(bakeFrameWidthPx(Number.NaN, false)).toBe(720);
  });
});

describe('overlayBakePlan', () => {
  it('rien à incruster → null', () => {
    expect(overlayBakePlan(null, { speed: 1, durationMs: 5000, fixedCanvas: false })).toBeNull();
    expect(overlayBakePlan(doc([]), { speed: 1, durationMs: 5000, fixedCanvas: false })).toBeNull();
  });

  it('recale l’horaire sur la vitesse du clip unique', () => {
    const plan = overlayBakePlan(doc([text('a', { startMs: 4000, endMs: 8000 })]), {
      speed: 2,
      durationMs: 10_000,
      fixedCanvas: false,
    });
    expect(plan?.items[0]).toMatchObject({ startMs: 2000, endMs: 4000 });
    expect(plan?.frameWidthPx).toBe(720);
  });

  it('montage : horaire de timeline inchangé, cadre fixe', () => {
    const plan = overlayBakePlan(doc([text('a', { startMs: 1500, endMs: 3000 })], 16 / 9), {
      speed: 1,
      durationMs: 9000,
      fixedCanvas: true,
    });
    expect(plan?.items[0]).toMatchObject({ startMs: 1500, endMs: 3000 });
    expect(plan?.frameWidthPx).toBe(720);
  });

  it('écarte un calque qui commence après la fin, prolonge une fin au-delà', () => {
    const plan = overlayBakePlan(
      doc([
        text('late', { startMs: 9000, endMs: null }),
        text('long', { startMs: 1000, endMs: 12_000 }),
        text('ok', { startMs: 0, endMs: 2000 }),
      ]),
      { speed: 1, durationMs: 8000, fixedCanvas: false },
    );
    expect(plan?.items.map((i) => i.overlay.id)).toEqual(['long', 'ok']);
    expect(plan?.items[0].endMs).toBeNull();
    expect(plan?.items[1].endMs).toBe(2000);
  });

  it('durée inconnue : tout est gardé', () => {
    const plan = overlayBakePlan(doc([text('a', { startMs: 60_000 })]), {
      speed: 1,
      durationMs: null,
      fixedCanvas: false,
    });
    expect(plan?.items).toHaveLength(1);
  });
});

describe('composerOverlays', () => {
  const plan = overlayBakePlan(doc([text('a', { startMs: 500, endMs: 2500 }), text('b')]), {
    speed: 1,
    durationMs: 5000,
    fixedCanvas: false,
  })!;

  it('associe chaque calque à sa capture, rotation horaire comme à l’écran', () => {
    const out = composerOverlays(
      plan,
      new Map([
        ['a', 'file:///cache/a.png'],
        ['b', 'file:///cache/b.png'],
      ]),
    );
    expect(out).toEqual([
      { uri: 'file:///cache/a.png', x: 0.25, y: 0.75, rotation: 30, startMs: 500, endMs: 2500 },
      { uri: 'file:///cache/b.png', x: 0.25, y: 0.75, rotation: 30, startMs: 0, endMs: null },
    ]);
  });

  it('refuse une capture manquante (jamais d’export sans un calque)', () => {
    expect(() => composerOverlays(plan, new Map([['a', 'file:///a.png']]))).toThrow();
  });
});

describe('filtre cuit = voile de l’aperçu', () => {
  it('pas de filtre → pas de matrice', () => {
    expect(filterBakeMatrix(null)).toBeNull();
    expect(composerFilter(null)).toBeNull();
  });

  it('reproduit (1 − a) · pixel + a · teinte pour chaque filtre du catalogue', () => {
    for (const id of ['nia-ocre', 'fun-bw', 'culture-indigo', 'nia-noir', 'lumiere-softbox']) {
      const f = getFilterById(id)!;
      const wash = getFilterOverlayStyle(f)!;
      const m = filterBakeMatrix(f)!;
      expect(m).toHaveLength(16);
      const hex = wash.backgroundColor.replace('#', '');
      const tint = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
      const a = wash.opacity;
      for (const px of [
        [0, 0, 0],
        [1, 1, 1],
        [0.2, 0.5, 0.9],
      ] as [number, number, number][]) {
        const got = applyBakeMatrix(m, px);
        px.forEach((c, i) => expect(got[i]).toBeCloseTo((1 - a) * c + a * tint[i], 3));
      }
      // Alpha intact (dernière ligne / colonne).
      expect([m[3], m[7], m[11], m[15]]).toEqual([0, 0, 0, 1]);
    }
  });

  it('garde l’identifiant du filtre pour le contrat natif', () => {
    expect(composerFilter(getFilterById('nia-ocre'))).toMatchObject({ id: 'nia-ocre' });
  });
});

describe('composition envoyée à NiaComposer', () => {
  const base = {
    sourceUri: 'file:///src.mp4',
    sourceDurationMs: 10_000,
    trim: null,
    speed: 1,
    soundUri: null,
    soundOffsetMs: 0,
    soundVolume: 1,
    originalVolume: 1,
    outputPath: '/cache/out.mp4',
  };

  it('transmet calques, cadre de capture et filtre', () => {
    const overlays = [{ uri: 'file:///a.png', x: 0.5, y: 0.5, rotation: 0, startMs: 0, endMs: null }];
    const filter = composerFilter(getFilterById('nia-ocre'));
    const { composition } = buildPublishComposition({ ...base, overlays, overlayFrameWidth: 720, filter });
    expect(composition.overlays).toEqual(overlays);
    expect(composition.overlayFrameWidth).toBe(720);
    expect(composition.filter?.matrix).toHaveLength(16);
  });

  it('sans habillage : même composition qu’en V1', () => {
    const { composition } = buildPublishComposition(base);
    expect(composition.overlays).toBeUndefined();
    expect(composition.overlayFrameWidth).toBeUndefined();
    expect(composition.filter).toBeUndefined();
  });

  it('calques sans largeur de cadre : ignorés (jamais d’échelle inventée)', () => {
    const overlays = [{ uri: 'file:///a.png', x: 0.5, y: 0.5, rotation: 0, startMs: 0, endMs: null }];
    const { composition } = buildPublishComposition({ ...base, overlays, overlayFrameWidth: null });
    expect(composition.overlays).toBeUndefined();
  });

  it('cadre fixe : plusieurs clips ou une photo', () => {
    expect(usesFixedCanvas(null)).toBe(false);
    expect(usesFixedCanvas([{}])).toBe(false);
    expect(usesFixedCanvas([{ image: true }])).toBe(true);
    expect(usesFixedCanvas([{}, {}])).toBe(true);
  });
});
