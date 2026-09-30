/**
 * Contraste WCAG 2.x — calcul pur, sans dépendance React Native.
 *
 * Sert au test `__tests__/constants/themeContrast.test.ts`, qui vérifie que
 * chaque paire texte / fond des thèmes d'Apparence atteint les seuils AA.
 * Les couleurs translucides (`rgba(...)`, `#RRGGBBAA`) sont d'abord composées
 * sur le fond opaque qui les porte, comme à l'écran.
 */

export type Rgba = { r: number; g: number; b: number; a: number };

/** `#RGB`, `#RRGGBB`, `#RRGGBBAA`, `rgb(...)`, `rgba(...)`. Jette sinon. */
export function parseColor(input: string): Rgba {
  const s = input.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(s);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
  }
  const fn = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(s);
  if (fn) {
    return {
      r: Number(fn[1]),
      g: Number(fn[2]),
      b: Number(fn[3]),
      a: fn[4] === undefined ? 1 : Number(fn[4]),
    };
  }
  throw new Error(`Couleur illisible : « ${input} »`);
}

/** Compose `fg` (éventuellement translucide) sur `bg` ; le résultat est opaque. */
export function composite(fg: Rgba, bg: Rgba): Rgba {
  const base = bg.a < 1 ? composite(bg, { r: 0, g: 0, b: 0, a: 1 }) : bg;
  const a = fg.a;
  return {
    r: fg.r * a + base.r * (1 - a),
    g: fg.g * a + base.g * (1 - a),
    b: fg.b * a + base.b * (1 - a),
    a: 1,
  };
}

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Luminance relative WCAG d'une couleur opaque. */
export function luminance(c: Rgba): number {
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

/**
 * Rapport de contraste WCAG entre `fg` et `bg`.
 * `layers` : fonds translucides empilés (du plus bas au plus haut) entre
 * `bg` et `fg`, par exemple un voile sombre posé sur une image.
 */
export function contrastRatio(fg: string, bg: string, layers: string[] = []): number {
  let under = parseColor(bg);
  if (under.a < 1) under = composite(under, { r: 0, g: 0, b: 0, a: 1 });
  for (const l of layers) under = composite(parseColor(l), under);
  const top = composite(parseColor(fg), under);
  const l1 = luminance(top);
  const l2 = luminance(under);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/** Seuils WCAG 2.x AA. */
export const AA_TEXT = 4.5;
export const AA_LARGE = 3;
