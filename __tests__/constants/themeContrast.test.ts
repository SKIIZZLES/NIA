/**
 * Contraste des thèmes d'Apparence (WCAG 2.x AA).
 * `CONTRAST_TABLE=1 npx jest themeContrast` affiche le tableau complet.
 */
import { contrastRatio, parseColor } from '@/lib/contrast';
import { contrastTableMarkdown, themeContrastRows } from '@/lib/themeContrast';
import { THEME_PALETTES, mediaPalette, ORIGINAL_COLORS, CLAIR_COLORS } from '@/constants/themes';

describe('lib/contrast — témoins', () => {
  it('noir sur blanc = 21:1, blanc sur blanc = 1:1', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
  });

  it('valeur de référence WCAG : #777 sur blanc ≈ 4.48', () => {
    expect(contrastRatio('#777777', '#FFFFFF')).toBeCloseTo(4.48, 2);
  });

  it('compose les couleurs translucides sur leur fond', () => {
    // Noir à 50 % sur blanc ≈ #808080.
    expect(contrastRatio('rgba(0,0,0,0.5)', '#FFFFFF')).toBeCloseTo(
      contrastRatio('#808080', '#FFFFFF'),
      1,
    );
    expect(parseColor('#0B0B0B99').a).toBeCloseTo(0.6, 2);
    expect(() => parseColor('sable')).toThrow();
  });
});

describe('thèmes — contraste AA', () => {
  const rows = themeContrastRows();

  if (process.env.CONTRAST_TABLE) {
    console.log(contrastTableMarkdown(rows));
  }

  it('couvre les 7 thèmes (Auto clair et sombre)', () => {
    const themes = new Set(rows.map((r) => r.theme));
    expect(themes.size).toBe(8);
    expect(rows.length).toBeGreaterThan(150);
  });

  it('aucune paire sous son seuil', () => {
    const failing = rows
      .filter((r) => r.min > 0 && r.ratio < r.min)
      .map((r) => `${r.theme} · ${r.pair} = ${r.ratio.toFixed(2)} (< ${r.min})`);
    expect(failing).toEqual([]);
  });

  it('pas de blanc pur en texte principal sur les thèmes sombres', () => {
    for (const c of Object.values(THEME_PALETTES)) {
      if (!c.isDark) continue;
      expect(c.textPrimary.toUpperCase()).not.toBe('#FFFFFF');
      expect(c.onMedia.toUpperCase()).not.toBe('#FFFFFF');
    }
  });

  it('la palette média est toujours sombre', () => {
    for (const c of Object.values(THEME_PALETTES)) {
      expect(mediaPalette(c).isDark).toBe(true);
    }
    expect(mediaPalette(CLAIR_COLORS)).toBe(ORIGINAL_COLORS);
  });
});
