/**
 * Éditeur V2 — styles de texte façon Instagram : polices, fonds, alignement,
 * rendu proportionnel (aperçu = capture incrustée), textes à contrôler.
 */
import {
  OVERLAY_ALIGNS,
  OVERLAY_BACKGROUNDS,
  OVERLAY_COLORS,
  OVERLAY_FONTS,
  OVERLAY_FONT_CHOICES,
  lightenHex,
  overlayFontSize,
  overlayPadding,
  overlayTexts,
  sanitizeOverlayDoc,
  textOverlayColors,
  textOverlayLook,
  type Overlay,
  type TextOverlay,
} from '@/lib/overlays';

const text = (over: Partial<TextOverlay> = {}): TextOverlay => ({
  id: 't1',
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
});

describe('catalogue', () => {
  it('sept styles proposés, tous avec une police', () => {
    expect(OVERLAY_FONT_CHOICES).toEqual([
      'classique',
      'machine',
      'neon',
      'manuscrit',
      'condense',
      'serif',
      'arrondi',
    ]);
    for (const f of OVERLAY_FONT_CHOICES) expect(OVERLAY_FONTS[f]).toBeTruthy();
  });

  it('les polices embarquées sont celles de constants/overlayFonts', () => {
    // Les familles système (monospace) mises à part, chaque style V2 a son .ttf.
    const v2 = OVERLAY_FONT_CHOICES.filter((f) => f !== 'classique').map((f) => OVERLAY_FONTS[f]);
    expect(v2).toEqual([
      'CourierPrime_700Bold',
      'TiltNeon_400Regular',
      'Caveat_700Bold',
      'Oswald_700Bold',
      'PlayfairDisplay_700Bold',
      'Fredoka_600SemiBold',
    ]);
  });

  it('trois fonds, trois alignements, nouvelles couleurs', () => {
    expect(OVERLAY_BACKGROUNDS).toEqual(['none', 'box', 'soft']);
    expect(OVERLAY_ALIGNS).toEqual(['center', 'left', 'right']);
    expect(OVERLAY_COLORS.jaune).toBe('#F2C94C');
  });
});

describe('relecture (brouillons, edit_meta)', () => {
  const one = (raw: Record<string, unknown>) =>
    sanitizeOverlayDoc({ v: 1, aspect: 0.5625, items: [{ ...text(), ...raw }] }).items[0] as TextOverlay;

  it('garde fond semi-transparent, alignement et nouvelles polices', () => {
    const o = one({ bg: 'soft', align: 'left', font: 'manuscrit', color: 'rose' });
    expect(o).toMatchObject({ bg: 'soft', align: 'left', font: 'manuscrit', color: 'rose' });
  });

  it('centré = pas de clé (document identique à S4)', () => {
    expect(one({ align: 'center' })).not.toHaveProperty('align');
    expect(one({})).toEqual(text());
  });

  it('valeurs inconnues ramenées aux défauts', () => {
    expect(one({ bg: 'glow', align: 'justify', font: 'comic' })).toMatchObject({
      bg: 'none',
      font: 'classique',
    });
    expect(one({ align: 'justify' })).not.toHaveProperty('align');
  });
});

describe('rendu', () => {
  it('fond semi-transparent : texte de la couleur, pastille contrastée', () => {
    expect(textOverlayColors({ color: 'sable', bg: 'soft' })).toEqual({
      text: '#F5E6D3',
      background: 'rgba(11,11,11,0.55)',
    });
    expect(textOverlayColors({ color: 'baobab', bg: 'soft' }).background).toBe('rgba(245,230,211,0.62)');
  });

  it('néon : cœur éclairci et halo de la couleur choisie', () => {
    const look = textOverlayLook(text({ font: 'neon', color: 'bleu' }), 40);
    expect(look.shadow).toEqual({ color: '#3F7CC8', radius: 14, dx: 0, dy: 0 });
    expect(look.color).toBe(lightenHex('#3F7CC8', 0.65));
    // Pastille pleine : pas de halo.
    expect(textOverlayLook(text({ font: 'neon', bg: 'box' }), 40).shadow).toBeNull();
  });

  it('toutes les mesures sont proportionnelles (aperçu et capture à deux échelles)', () => {
    for (const o of [
      text({ font: 'neon', bg: 'soft', align: 'right' }),
      text({ font: 'manuscrit', bg: 'box' }),
      text({ font: 'condense' }),
    ]) {
      const small = textOverlayLook(o, 20);
      const big = textOverlayLook(o, 50);
      const k = 50 / 20;
      expect(big.lineHeight).toBeCloseTo(small.lineHeight * k, 6);
      expect(big.paddingH).toBeCloseTo(small.paddingH * k, 6);
      expect(big.paddingV).toBeCloseTo(small.paddingV * k, 6);
      expect(big.borderRadius).toBeCloseTo(small.borderRadius * k, 6);
      if (small.shadow && big.shadow) {
        expect(big.shadow.radius).toBeCloseTo(small.shadow.radius * k, 6);
        expect(big.shadow.dy).toBeCloseTo(small.shadow.dy * k, 6);
      }
      expect(overlayPadding(o, 50)).toBeCloseTo(overlayPadding(o, 20) * k, 6);
      expect(big.textAlign).toBe(o.align ?? 'center');
    }
    expect(overlayFontSize(text({ size: 0.1 }), 720)).toBeCloseTo(72, 6);
  });

  it('éclaircit une couleur', () => {
    expect(lightenHex('#000000', 0.5)).toBe('#808080');
    expect(lightenHex('#D17F2A', 0)).toBe('#D17F2A');
    expect(lightenHex('pas une couleur', 0.5)).toBe('pas une couleur');
  });
});

describe('textes à contrôler avant l’incrustation', () => {
  it('uniquement les textes, un par ligne', () => {
    const items: Overlay[] = [
      text({ id: 'a', text: ' Bonjour ' }),
      { id: 's', type: 'sticker', emoji: '🔥', x: 0.5, y: 0.5, size: 0.1, rotation: 0, startMs: 0, endMs: null },
      text({ id: 'b', text: 'NIA' }),
    ];
    expect(overlayTexts({ v: 1, aspect: 0.5625, items })).toBe('Bonjour\nNIA');
    expect(overlayTexts(null)).toBe('');
  });
});
