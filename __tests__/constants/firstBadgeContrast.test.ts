/**
 * Badge First : lisible dans chaque thème d'Apparence (WCAG 2.x AA).
 * - libellé sur le fond de la pastille ≥ 4.5:1 ;
 * - pastille repérable sur la surface qui la porte (contour ≥ 3:1) ;
 * - ton sombre (`dark`) : aussi sur vidéo (pire cas : image blanche) et sur
 *   les écrans en NIA Original statique ;
 * - jamais de blanc pur.
 */
import { FIRST_BADGE_PALETTES, firstBadgePalette } from '@/constants/firstBadge';
import { ORIGINAL_COLORS, THEME_IDS, resolveThemeColors } from '@/constants/themes';
import { AA_LARGE, AA_TEXT, contrastRatio } from '@/lib/contrast';

const SURFACES = ['noir', 'noirElevated', 'noirSoft'] as const;

const RESOLVED = THEME_IDS.flatMap((id) =>
  id === 'auto'
    ? (['light', 'dark'] as const).map((s) => ({ label: `Auto (${s})`, c: resolveThemeColors('auto', s) }))
    : [{ label: id, c: resolveThemeColors(id, null) }],
);

describe('badge First — contraste', () => {
  it('libellé / fond de la pastille ≥ 4.5:1 (deux tons)', () => {
    for (const p of Object.values(FIRST_BADGE_PALETTES)) {
      expect(contrastRatio(p.text, p.background)).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it.each(RESOLVED.map((r) => [r.label, r.c] as const))('%s : contour ≥ 3:1 sur chaque surface', (_label, c) => {
    const p = firstBadgePalette(c, 'theme');
    for (const s of SURFACES) {
      expect(contrastRatio(p.border, c[s])).toBeGreaterThanOrEqual(AA_LARGE);
    }
  });

  it('ton sombre : repérable sur NIA Original statique et sur une vidéo blanche', () => {
    const p = FIRST_BADGE_PALETTES.dark;
    for (const s of SURFACES) {
      expect(contrastRatio(p.border, ORIGINAL_COLORS[s])).toBeGreaterThanOrEqual(AA_LARGE);
    }
    expect(contrastRatio(p.background, '#FFFFFF')).toBeGreaterThanOrEqual(AA_LARGE);
    expect(contrastRatio(p.border, '#FFFFFF')).toBeGreaterThanOrEqual(AA_LARGE);
  });

  it('ton clair : reste lisible s’il tombe sur un fond sombre (écran statique sous Clair)', () => {
    const p = FIRST_BADGE_PALETTES.light;
    for (const s of SURFACES) {
      expect(contrastRatio(p.background, ORIGINAL_COLORS[s])).toBeGreaterThanOrEqual(AA_LARGE);
    }
  });

  it('aucun blanc pur', () => {
    for (const p of Object.values(FIRST_BADGE_PALETTES)) {
      for (const v of Object.values(p)) expect(v.toUpperCase()).not.toMatch(/^#F{3}(F{3})?$/);
    }
  });
});
