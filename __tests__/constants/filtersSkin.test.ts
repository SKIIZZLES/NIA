/**
 * Filtres et peau (règle NIA : jamais d'éclaircissement de la peau).
 *
 * L'aperçu ET le fichier appliquent le même voile uniforme
 * (out = (1 − a)·c + a·voile, lib/overlayBake.ts) : une teinte ne s'éclaircit
 * que si le voile est plus clair qu'elle. Voile plus sombre que MST 10 ⇒
 * aucune des 10 teintes Monk ne s'éclaircit, quelle que soit l'intensité.
 *
 * Corrigés le 01/10/2026 (approuvés) : Glow Sable, Sable, Doux, Noir & Sable,
 * Éclat. Les autres filtres qui éclaircissent encore sont listés ci-dessous,
 * À DÉCIDER : la liste ne peut que rétrécir.
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

/** Éclaircissent encore les peaux foncées : non approuvés au 01/10/2026, à décider. */
const PENDING_LIGHTENING = [
  'lumiere-golden', 'lumiere-softbox', 'lumiere-contre', 'portrait-peau', 'culture-indigo', 'culture-batik',
  'culture-kente', 'afrique-sahel', 'afrique-baobab', 'afrique-terre', 'diaspora-metro', 'diaspora-neon',
  'diaspora-bridge', 'fun-pop', 'fun-sunset', 'nia-original', 'nia-ocre',
];

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

describe('tous les filtres', () => {
  it('aucun filtre n’éclaircit une teinte Monk, sauf la liste « à décider »', () => {
    const lightening = FILTERS.filter((f) => Math.max(...monkLift(f.id)) > 1e-6).map((f) => f.id);
    expect(lightening.filter((id) => !PENDING_LIGHTENING.includes(id))).toEqual([]);
  });

  it('la liste « à décider » ne contient que des filtres existants qui éclaircissent encore (à retirer une fois corrigés)', () => {
    for (const id of PENDING_LIGHTENING) {
      expect(getFilterById(id)).toBeTruthy();
      expect(Math.max(...monkLift(id))).toBeGreaterThan(1e-6);
    }
  });
});
