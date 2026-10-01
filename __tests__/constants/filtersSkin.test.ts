/**
 * Filtres et peau (règle NIA : jamais d'éclaircissement de la peau).
 *
 * L'aperçu ET le fichier appliquent le même voile uniforme
 * (out = (1 − a)·c + a·voile, lib/overlayBake.ts) : une teinte ne s'éclaircit
 * que si le voile est plus clair qu'elle. Voile plus sombre que MST 10 ⇒
 * aucune des 10 teintes Monk ne s'éclaircit, quelle que soit l'intensité.
 *
 * Corrigés le 01/10/2026 (approuvés) : Glow Sable, Sable, Doux, Noir & Sable,
 * Éclat. Puis les 17 autres (approuvés le même jour) : AUCUN filtre ne peut
 * éclaircir une teinte Monk, à aucune intensité (tous vérifiés ci-dessous).
 */
import { FILTERS, getFilterById, getFilterOverlayStyle } from '@/constants/filters';
import { applyBakeMatrix, filterBakeMatrix } from '@/lib/overlayBake';

/** Échelle Monk (MST 1 → 10), Google / Ellis Monk. */
const MONK = ['#F6EDE4', '#F3E7DB', '#F7EAD0', '#EADABA', '#D7BD96', '#A07E56', '#825C43', '#604134', '#3A312A', '#292420'];

const rgb = (hex: string): [number, number, number] => {
  const v = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255) as [number, number, number];
};
const luma = ([r, g, b]: readonly number[]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Variation de luminance (/255) de chaque teinte Monk, filtre cuit. */
function monkLift(id: string, intensity?: number): number[] {
  const f = getFilterById(id);
  const wash = getFilterOverlayStyle(f ?? null, intensity);
  if (!wash) return MONK.map(() => 0);
  const w = rgb(wash.backgroundColor);
  const m = intensity == null ? filterBakeMatrix(f) : null;
  return MONK.map((hex) => {
    const c = rgb(hex);
    const out = m ? applyBakeMatrix(m, c) : (c.map((x, i) => (1 - wash.opacity) * x + wash.opacity * w[i]) as number[]);
    return (luma(out) - luma(c)) * 255;
  });
}

const FIXED = ['beaute-glow', 'nia-sable', 'beaute-soft', 'fun-bw', 'beaute-eclat'] as const;

describe.each(FIXED.map((id) => [id] as const))('%s : jamais d’éclaircissement', (id) => {
  const f = getFilterById(id);
  const m = filterBakeMatrix(f);

  it('existe (identifiant stocké sur les vidéos) et a un voile', () => {
    expect(f).toBeTruthy();
    expect(m).not.toBeNull();
  });

  it('MST 1 → 10 : la luminance ne monte jamais (≤ 0/255)', () => {
    for (const d of monkLift(id)) expect(d).toBeLessThanOrEqual(1e-6);
  });

  it('quelle que soit l’intensité (curseur 0 → 1)', () => {
    for (const k of [0, 0.25, 0.5, 0.75, 1]) for (const d of monkLift(id, k)) expect(d).toBeLessThanOrEqual(1e-6);
  });

  it('voile plus sombre que MST 10 ; noir à peine teinté (≤ 5/255) ; blanc jamais plus clair', () => {
    const wash = getFilterOverlayStyle(f ?? null)!;
    expect(luma(rgb(wash.backgroundColor))).toBeLessThan(luma(rgb(MONK[9])));
    expect(luma(applyBakeMatrix(m as number[], [0, 0, 0]))).toBeLessThanOrEqual(5 / 255);
    for (const ch of applyBakeMatrix(m as number[], [1, 1, 1])) expect(ch).toBeLessThanOrEqual(1);
  });

  it('matrice documentée : aucun gain > 1 ni décalage positif', () => {
    const cm = f?.matrix;
    if (!cm) return;
    for (const row of [0, 1, 2]) {
      for (const col of [0, 1, 2, 3]) expect(cm[row * 5 + col]).toBeLessThanOrEqual(1);
      expect(cm[row * 5 + 4]).toBeLessThanOrEqual(0);
    }
  });
});

describe('caractère gardé (gris moyen filtré)', () => {
  const grey = (id: string) => applyBakeMatrix(filterBakeMatrix(getFilterById(id)) as number[], [0.5, 0.5, 0.5]);
  const warmth = (id: string) => grey(id)[0] - grey(id)[2];

  it('Glow Sable, Sable, Doux : chauds', () => {
    for (const id of ['beaute-glow', 'nia-sable', 'beaute-soft']) expect(warmth(id)).toBeGreaterThan(0.015);
  });
  it('Éclat : chaleur ocre franche, la plus forte des cinq', () => {
    expect(warmth('beaute-eclat')).toBeGreaterThan(0.04);
    for (const id of FIXED) expect(warmth('beaute-eclat')).toBeGreaterThanOrEqual(warmth(id));
  });
  it('Noir & Sable : sépia discret (presque neutre)', () => {
    expect(warmth('fun-bw')).toBeGreaterThan(0);
    expect(warmth('fun-bw')).toBeLessThan(0.02);
  });
  it('Sable et Doux : contraste adouci (voile ≥ 12 %)', () => {
    for (const id of ['nia-sable', 'beaute-soft']) {
      expect(getFilterOverlayStyle(getFilterById(id) ?? null)!.opacity).toBeGreaterThanOrEqual(0.12);
    }
  });
});

describe.each(FILTERS.map((f) => [f.name, f.id] as const))('tous les filtres — %s', (_name, id) => {
  it('aucune teinte Monk ne s’éclaircit, à toute intensité (0 → 1 et réglage par défaut)', () => {
    for (const d of monkLift(id)) expect(d).toBeLessThanOrEqual(1e-6);
    for (const k of [0, 0.25, 0.5, 0.75, 1]) for (const d of monkLift(id, k)) expect(d).toBeLessThanOrEqual(1e-6);
  });

  it('voile éventuel plus sombre que MST 10', () => {
    const wash = getFilterOverlayStyle(getFilterById(id) ?? null);
    if (wash) expect(luma(rgb(wash.backgroundColor))).toBeLessThan(luma(rgb(MONK[9])));
  });
});

describe('teintes distinctes gardées', () => {
  const tint = (id: string) => {
    const [r, g, b] = applyBakeMatrix(filterBakeMatrix(getFilterById(id)) as number[], [0.5, 0.5, 0.5]);
    return { warm: r - b, green: g - (r + b) / 2 };
  };
  it('chauds (ocre, sable, rouges) restent chauds ; bleus et violets restent froids ; Baobab reste vert', () => {
    for (const id of ['fun-pop', 'lumiere-golden', 'nia-ocre', 'nia-original', 'afrique-sahel', 'portrait-peau', 'culture-kente', 'fun-sunset', 'afrique-terre', 'culture-batik', 'lumiere-contre']) {
      expect(tint(id).warm).toBeGreaterThan(0.015);
    }
    for (const id of ['culture-indigo', 'diaspora-metro', 'diaspora-bridge', 'diaspora-neon']) expect(tint(id).warm).toBeLessThan(-0.005);
    expect(tint('afrique-baobab').green).toBeGreaterThan(0.005);
  });
  it('famille ocre : même teinte, forces dans le même ordre qu’avant (Pop > Heure dorée > Ocre > NIA Original)', () => {
    const op = (id: string) => getFilterOverlayStyle(getFilterById(id) ?? null)!.opacity;
    expect(op('fun-pop')).toBeGreaterThan(op('lumiere-golden'));
    expect(op('lumiere-golden')).toBeGreaterThan(op('nia-ocre'));
    expect(op('nia-ocre')).toBeGreaterThan(op('nia-original'));
  });
});
