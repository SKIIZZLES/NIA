/**
 * Filtres et peau (règle NIA : jamais d'éclaircissement de la peau).
 * Glow Sable (01/10/2026) : teinte sable chaude, sans voile crème ni
 * éclaircissement global. Le filtre cuit dans le fichier est la matrice du
 * voile de l'aperçu (lib/overlayBake.ts) : on vérifie donc les deux.
 */
import { getFilterById, getFilterOverlayStyle } from '@/constants/filters';
import { applyBakeMatrix, filterBakeMatrix } from '@/lib/overlayBake';

/** Échelle Monk (MST 1 → 10), Google / Ellis Monk. */
const MONK = ['#F6EDE4', '#F3E7DB', '#F7EAD0', '#EADABA', '#D7BD96', '#A07E56', '#825C43', '#604134', '#3A312A', '#292420'];

const rgb = (hex: string): [number, number, number] => {
  const v = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255) as [number, number, number];
};
const luma = ([r, g, b]: readonly number[]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

describe('Glow Sable', () => {
  const glow = getFilterById('beaute-glow');
  const m = filterBakeMatrix(glow);

  it('existe, garde son nom et son identifiant (stocké sur les vidéos)', () => {
    expect(glow?.name).toBe('Glow Sable');
    expect(m).not.toBeNull();
  });

  it.each(MONK.map((h, i) => [i + 1, h] as const))('MST %i : la luminance ne monte jamais', (_n, hex) => {
    const c = rgb(hex);
    const out = applyBakeMatrix(m as number[], c);
    expect(luma(out)).toBeLessThanOrEqual(luma(c) + 1e-6);
  });

  it('pas de voile clair : couleur du voile plus sombre que MST 10', () => {
    const wash = getFilterOverlayStyle(glow ?? null);
    expect(wash).not.toBeNull();
    expect(luma(rgb(wash!.backgroundColor))).toBeLessThan(luma(rgb(MONK[9])));
  });

  it('noir à peine teinté (≤ 5/255 de luminance), blanc jamais plus clair', () => {
    expect(luma(applyBakeMatrix(m as number[], [0, 0, 0]))).toBeLessThanOrEqual(5 / 255);
    const w = applyBakeMatrix(m as number[], [1, 1, 1]);
    for (const ch of w) expect(ch).toBeLessThanOrEqual(1);
  });

  it('reste chaud : un gris moyen tire vers le sable (R > B)', () => {
    const [r, , b] = applyBakeMatrix(m as number[], [0.5, 0.5, 0.5]);
    expect(r - b).toBeGreaterThan(0.02);
  });

  it('matrice documentée : aucun gain > 1 ni décalage positif', () => {
    const cm = glow?.matrix ?? [];
    for (const row of [0, 1, 2]) {
      for (const col of [0, 1, 2, 3]) expect(cm[row * 5 + col]).toBeLessThanOrEqual(1);
      expect(cm[row * 5 + 4]).toBeLessThanOrEqual(0);
    }
  });
});
