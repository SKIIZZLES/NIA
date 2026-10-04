/**
 * Contraste des thèmes d'Apparence (WCAG 2.x AA).
 * `CONTRAST_TABLE=1 npx jest themeContrast` affiche le tableau complet.
 */
import { contrastRatio, parseColor } from '@/lib/contrast';
import { contrastTableMarkdown, themeContrastRows } from '@/lib/themeContrast';
import { FEED_TOP_FADE, MEDIA_OVERLAY, THEME_PALETTES, mediaPalette, ORIGINAL_COLORS, CLAIR_COLORS } from '@/constants/themes';

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

  it('couvre les 8 thèmes (Auto clair et sombre)', () => {
    const themes = new Set(rows.map((r) => r.theme));
    expect(themes.size).toBe(9);
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

declare function require(id: string): unknown;
declare const __filename: string;
const fs = require('fs') as { readFileSync(chemin: string, encodage: 'utf8'): string };

describe('fil — couleurs fixes sur la vidéo', () => {
  const rows = themeContrastRows();

  it('le fondu du haut reste ≥ 0.72 derrière le logo et les onglets', () => {
    for (const stop of FEED_TOP_FADE.band) {
      expect(parseColor(stop).a).toBeGreaterThanOrEqual(0.72);
    }
    expect(FEED_TOP_FADE.weakestUnderTabs).toBe(FEED_TOP_FADE.band[FEED_TOP_FADE.band.length - 1]);
    expect(FEED_TOP_FADE.tail[0]).toBe(FEED_TOP_FADE.weakestUnderTabs);
  });

  it('onglets, logo, soulignement, pays/lieu, badges et j\'aime sont mesurés sur vidéo blanche et sombre', () => {
    const pairs = rows.filter((r) => r.theme === 'Galerie vivante').map((r) => r.pair);
    for (const prefix of [
      'fil : onMedia (logo, onglet actif)',
      'fil : onMediaMuted (onglets)',
      'fil : onMediaAccent (soulignement)',
      'vidéo : pays et lieu',
      'vidéo : texte et icône des badges',
      "vidéo : j'aime / enregistré actifs",
    ]) {
      expect(pairs.filter((p) => p.startsWith(prefix))).toHaveLength(2);
    }
  });

  it('seuils : texte ≥ 4.5:1, soulignement et icônes ≥ 3:1', () => {
    const W = '#FFFFFF';
    const fade = [FEED_TOP_FADE.weakestUnderTabs];
    const tokens = THEME_PALETTES.gallery;
    expect(contrastRatio(tokens.onMedia, W, fade)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(tokens.onMediaMuted, W, fade)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(tokens.onMediaAccent, W, fade)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(MEDIA_OVERLAY.label, W, [MEDIA_OVERLAY.chipBackdrop])).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(MEDIA_OVERLAY.activeIcon, W)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(MEDIA_OVERLAY.activeIcon, '#0B0B0B')).toBeGreaterThanOrEqual(3);
  });

  it('VideoCard n\'utilise plus les couleurs atténuées / accent du thème sur la vidéo', () => {
    const racine = __filename.replace(/\\/g, '/').replace(/\/__tests__\/constants\/[^/]+$/, '');
    const src = fs.readFileSync(`${racine}/components/VideoCard.tsx`, 'utf8');
    expect(src).not.toMatch(/colors\.(sableMuted|or)\b/);
  });
});
