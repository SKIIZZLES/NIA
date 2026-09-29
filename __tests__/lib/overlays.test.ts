import {
  MAX_OVERLAYS,
  MAX_OVERLAYS_BYTES,
  MAX_OVERLAY_SIZE,
  MAX_OVERLAY_TEXT,
  canAddOverlay,
  clampOverlayTimes,
  coverFrameRect,
  emptyOverlayDoc,
  isOverlayVisible,
  normalizeRotation,
  overlayDocBytes,
  overlaysFromEditMeta,
  sanitizeOverlayDoc,
  textOverlayColors,
  type Overlay,
} from '@/lib/overlays';

const text = (over: Partial<Overlay> = {}): Overlay =>
  ({
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
  }) as Overlay;

describe('sanitizeOverlayDoc', () => {
  it('garde un document valide tel quel', () => {
    const doc = { v: 1, aspect: 0.5625, items: [text()] };
    expect(sanitizeOverlayDoc(doc)).toEqual(doc);
  });

  it('borne positions, taille, angle et texte, et écarte les calques invalides', () => {
    const doc = sanitizeOverlayDoc({
      aspect: 'x',
      items: [
        text({ x: 2, y: -1, size: 9, rotation: 270, text: 'a'.repeat(400) }),
        { type: 'text', text: '   ' },
        { type: 'sticker', emoji: '' },
        { type: 'video' },
        null,
        { id: 's', type: 'sticker', emoji: '🔥', startMs: 3000, endMs: 3100 },
      ],
    });
    expect(doc.aspect).toBeCloseTo(9 / 16, 3);
    expect(doc.items).toHaveLength(2);
    const [t, s] = doc.items;
    expect(t.x).toBe(1);
    expect(t.y).toBe(0);
    expect(t.size).toBe(MAX_OVERLAY_SIZE);
    expect(t.rotation).toBe(-90);
    expect(t.type === 'text' && Array.from(t.text).length).toBe(MAX_OVERLAY_TEXT);
    // Fenêtre trop courte : affichée jusqu'à la fin.
    expect(s.endMs).toBeNull();
    expect(s.startMs).toBe(3000);
  });

  it('respecte les plafonds de nombre et d’octets', () => {
    const many = Array.from({ length: 40 }, (_, i) => text({ id: `t${i}` }));
    expect(sanitizeOverlayDoc({ items: many }).items).toHaveLength(MAX_OVERLAYS);
    const heavy = Array.from({ length: MAX_OVERLAYS }, (_, i) =>
      text({ id: `h${i}`, text: '🔥'.repeat(MAX_OVERLAY_TEXT) }),
    );
    const doc = sanitizeOverlayDoc({ items: heavy });
    expect(overlayDocBytes(doc)).toBeLessThanOrEqual(MAX_OVERLAYS_BYTES);
    expect(doc.items.length).toBeLessThan(MAX_OVERLAYS);
    expect(canAddOverlay(doc, text({ id: 'z', text: '🔥'.repeat(MAX_OVERLAY_TEXT) }))).toBe(false);
  });

  it('rend les identifiants uniques', () => {
    const doc = sanitizeOverlayDoc({ items: [text(), text()] });
    expect(new Set(doc.items.map((o) => o.id)).size).toBe(2);
  });
});

describe('affichage', () => {
  it('fenêtre de visibilité', () => {
    const o = text({ startMs: 1000, endMs: 3000 });
    expect(isOverlayVisible(o, 500)).toBe(false);
    expect(isOverlayVisible(o, 1000)).toBe(true);
    expect(isOverlayVisible(o, 2999)).toBe(true);
    expect(isOverlayVisible(o, 3000)).toBe(false);
    expect(isOverlayVisible(o, null)).toBe(true);
    expect(isOverlayVisible(text({ startMs: 0, endMs: null }), 99999)).toBe(true);
  });

  it('cadre en cover : même repère quel que soit l’écran', () => {
    // Écran plus haut que la vidéo 9:16 : le cadre déborde à gauche et à droite.
    const r = coverFrameRect(360, 780, 9 / 16);
    expect(r.height).toBe(780);
    expect(r.width).toBeCloseTo(438.75);
    expect(r.left).toBeCloseTo(-39.375);
    // Conteneur plus large : débord en haut et en bas.
    const w = coverFrameRect(400, 600, 9 / 16);
    expect(w.width).toBe(400);
    expect(w.top).toBeLessThan(0);
    expect(coverFrameRect(0, 100).width).toBe(0);
  });

  it('recadre les fenêtres après une découpe', () => {
    const [a, b] = clampOverlayTimes(
      [text({ startMs: 9000, endMs: 12000 }), text({ id: 'b', startMs: 1000, endMs: 2000 })],
      5000,
    );
    expect(a.startMs).toBe(4500);
    expect(a.endMs).toBeNull();
    expect(b.startMs).toBe(1000);
    expect(b.endMs).toBe(2000);
  });

  it('couleurs : fond encadré avec texte contrasté', () => {
    expect(textOverlayColors({ color: 'sable', bg: 'box' })).toEqual({
      text: '#0B0B0B',
      background: '#F5E6D3',
    });
    expect(textOverlayColors({ color: 'baobab', bg: 'box' }).text).toBe('#F5E6D3');
    expect(textOverlayColors({ color: 'or', bg: 'none' })).toEqual({ text: '#D17F2A', background: null });
  });

  it('angle normalisé', () => {
    expect(normalizeRotation(190)).toBe(-170);
    expect(normalizeRotation(-190)).toBe(170);
    expect(normalizeRotation(720)).toBe(0);
  });
});

describe('overlaysFromEditMeta', () => {
  it('lit edit_meta.overlays ou renvoie undefined', () => {
    expect(overlaysFromEditMeta(undefined)).toBeUndefined();
    expect(overlaysFromEditMeta({})).toBeUndefined();
    expect(overlaysFromEditMeta({ overlays: emptyOverlayDoc() })).toBeUndefined();
    const doc = overlaysFromEditMeta({ overlays: { v: 1, aspect: 1, items: [text()] } });
    expect(doc?.items).toHaveLength(1);
    expect(doc?.aspect).toBe(1);
  });
});
