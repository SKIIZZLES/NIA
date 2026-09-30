/**
 * Calques texte et stickers (sprint S4).
 *
 * Le format ci-dessous est celui de la future colonne `videos.edit_meta`
 * (clé `overlays`, S5) : il est gardé tel quel dans le brouillon, puis
 * sera envoyé sans conversion. Tant que S5 n'est pas livré, rien n'est
 * enregistré en base : les vidéos publiées n'ont pas encore de calques.
 *
 * Repère : le cadre de la vidéo (ou de la photo), pas l'écran.
 * - x, y : centre du calque, 0..1 de la largeur / hauteur du cadre ;
 * - size : taille du texte (ou de l'emoji) en fraction de la largeur du cadre ;
 * - rotation : degrés, sens horaire ;
 * - startMs / endMs : fenêtre d'affichage sur la vidéo publiée (après
 *   découpe), endMs null = jusqu'à la fin. Ignorés pour une photo.
 *
 * `sanitizeOverlayDoc` sert aussi à relire des données non fiables (base,
 * brouillon) : tout champ hors bornes est corrigé ou le calque est écarté,
 * et le document respecte toujours les plafonds.
 */

export const OVERLAYS_VERSION = 1 as const;
/** Plafonds du document (garde-fous côté app, repris par la base en S5). */
export const MAX_OVERLAYS = 20;
export const MAX_OVERLAY_TEXT = 150;
export const MAX_OVERLAYS_BYTES = 8 * 1024;
export const MIN_OVERLAY_SIZE = 0.03;
export const MAX_OVERLAY_SIZE = 0.4;
export const DEFAULT_TEXT_SIZE = 0.075;
export const DEFAULT_STICKER_SIZE = 0.16;
export const MIN_OVERLAY_SPAN_MS = 500;
/** Cadre vertical par défaut quand le format du média est inconnu. */
export const DEFAULT_FRAME_ASPECT = 9 / 16;

/** Palette NIA fixe (indépendante du thème : elle est « imprimée » sur la vidéo). */
export const OVERLAY_COLORS = {
  sable: '#F5E6D3',
  blanc: '#FFFFFF',
  noir: '#0B0B0B',
  or: '#D17F2A',
  orDoux: '#E09A4F',
  terre: '#6B3E26',
  baobab: '#1B4D3E',
  rouge: '#A33227',
  // Éditeur V2 : quelques teintes vives en plus, façon Instagram.
  jaune: '#F2C94C',
  rose: '#E58FB0',
  bleu: '#3F7CC8',
  vert: '#5FB36B',
} as const;
export type OverlayColorId = keyof typeof OVERLAY_COLORS;
export const OVERLAY_COLOR_IDS = Object.keys(OVERLAY_COLORS) as OverlayColorId[];

/** Couleurs claires : texte foncé quand elles servent de fond. */
const LIGHT_COLORS: ReadonlySet<OverlayColorId> = new Set(['sable', 'blanc', 'orDoux', 'jaune', 'rose']);

/**
 * Styles de texte. Éditeur V2 : sept styles façon Instagram, polices libres
 * (SIL Open Font License 1.1, Google Fonts) embarquées par expo-font
 * (constants/overlayFonts.ts, licences dans docs/fonts-licenses.md).
 * Les mêmes polices servent à l'aperçu et à l'image incrustée dans la vidéo.
 * `leger`, `moyen` et `mono` (S4) restent lisibles mais ne sont plus proposés.
 */
export const OVERLAY_FONTS = {
  classique: 'PlusJakartaSans_700Bold',
  machine: 'CourierPrime_700Bold',
  neon: 'TiltNeon_400Regular',
  manuscrit: 'Caveat_700Bold',
  condense: 'Oswald_700Bold',
  serif: 'PlayfairDisplay_700Bold',
  arrondi: 'Fredoka_600SemiBold',
  leger: 'PlusJakartaSans_300Light',
  moyen: 'PlusJakartaSans_500Medium',
  mono: 'monospace',
} as const;
export type OverlayFontId = keyof typeof OVERLAY_FONTS;
export const OVERLAY_FONT_IDS = Object.keys(OVERLAY_FONTS) as OverlayFontId[];
/** Styles proposés dans l'outil Texte, dans l'ordre d'affichage. */
export const OVERLAY_FONT_CHOICES: readonly OverlayFontId[] = [
  'classique',
  'machine',
  'neon',
  'manuscrit',
  'condense',
  'serif',
  'arrondi',
];

/** Interligne propre à chaque police (hampes hautes de Caveat, Oswald, Playfair). */
const FONT_LINE_HEIGHT: Partial<Record<OverlayFontId, number>> = {
  manuscrit: 1.3,
  condense: 1.35,
  serif: 1.32,
  neon: 1.3,
};

/** none : sans fond ; box : pastille pleine ; soft : pastille semi-transparente (V2). */
export type OverlayBackground = 'none' | 'box' | 'soft';
export const OVERLAY_BACKGROUNDS: readonly OverlayBackground[] = ['none', 'box', 'soft'];

/** Alignement des lignes du texte (V2). Absent = centré. */
export type OverlayAlign = 'center' | 'left' | 'right';
export const OVERLAY_ALIGNS: readonly OverlayAlign[] = ['center', 'left', 'right'];

type OverlayBase = {
  id: string;
  x: number;
  y: number;
  size: number;
  rotation: number;
  startMs: number;
  endMs: number | null;
};

export type TextOverlay = OverlayBase & {
  type: 'text';
  text: string;
  font: OverlayFontId;
  color: OverlayColorId;
  bg: OverlayBackground;
  /** V2 ; absent = centré (les anciens APK centrent toujours). */
  align?: OverlayAlign;
};

export type StickerOverlay = OverlayBase & {
  type: 'sticker';
  emoji: string;
};

export type Overlay = TextOverlay | StickerOverlay;

/** Contenu de `edit_meta.overlays`. */
export type OverlayDoc = {
  v: typeof OVERLAYS_VERSION;
  /** Largeur / hauteur du cadre (orientation corrigée). */
  aspect: number;
  items: Overlay[];
};

export function emptyOverlayDoc(aspect: number = DEFAULT_FRAME_ASPECT): OverlayDoc {
  return { v: OVERLAYS_VERSION, aspect: sanitizeAspect(aspect), items: [] };
}

let seq = 0;
export function makeOverlayId(): string {
  seq = (seq + 1) % 1296;
  return `o${Date.now().toString(36)}${seq.toString(36)}`;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const num = (v: unknown, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

function sanitizeAspect(v: unknown): number {
  const a = num(v, DEFAULT_FRAME_ASPECT);
  return a > 0.2 && a < 5 ? Math.round(a * 10000) / 10000 : DEFAULT_FRAME_ASPECT;
}

function round(v: number, digits = 4): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

/** Normalise l'angle dans ]-180, 180]. */
export function normalizeRotation(deg: number): number {
  let r = deg % 360;
  if (r > 180) r -= 360;
  if (r <= -180) r += 360;
  return round(r, 1);
}

/** Nombre de caractères visibles (graphèmes approximés par points de code). */
export function textLength(s: string): number {
  return Array.from(s).length;
}

export function truncateText(s: string, max = MAX_OVERLAY_TEXT): string {
  const chars = Array.from(s);
  return chars.length > max ? chars.slice(0, max).join('') : s;
}

function sanitizeOne(raw: unknown): Overlay | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'string' && r.id.length > 0 ? r.id.slice(0, 32) : makeOverlayId();
  const startMs = Math.max(0, Math.round(num(r.startMs, 0)));
  const endRaw = r.endMs == null ? null : Math.round(num(r.endMs, -1));
  const endMs = endRaw != null && endRaw >= startMs + MIN_OVERLAY_SPAN_MS ? endRaw : null;
  const base: OverlayBase = {
    id,
    x: round(clamp(num(r.x, 0.5), 0, 1)),
    y: round(clamp(num(r.y, 0.5), 0, 1)),
    size: round(clamp(num(r.size, DEFAULT_TEXT_SIZE), MIN_OVERLAY_SIZE, MAX_OVERLAY_SIZE)),
    rotation: normalizeRotation(num(r.rotation, 0)),
    startMs,
    endMs,
  };
  if (r.type === 'text') {
    const text = typeof r.text === 'string' ? truncateText(r.text.trim()) : '';
    if (!text) return null;
    const font = (OVERLAY_FONT_IDS as string[]).includes(r.font as string)
      ? (r.font as OverlayFontId)
      : 'classique';
    const color = (OVERLAY_COLOR_IDS as string[]).includes(r.color as string)
      ? (r.color as OverlayColorId)
      : 'sable';
    const bg: OverlayBackground = r.bg === 'box' || r.bg === 'soft' ? r.bg : 'none';
    const align: OverlayAlign = r.align === 'left' || r.align === 'right' ? r.align : 'center';
    return { ...base, type: 'text', text, font, color, bg, ...(align !== 'center' ? { align } : {}) };
  }
  if (r.type === 'sticker') {
    const emoji = typeof r.emoji === 'string' ? r.emoji.trim() : '';
    // Un emoji (avec teinte / ZWJ) tient en quelques points de code.
    if (!emoji || textLength(emoji) > 8) return null;
    return { ...base, type: 'sticker', emoji };
  }
  return null;
}

export function overlayDocBytes(doc: OverlayDoc): number {
  const json = JSON.stringify(doc);
  // Taille UTF-8 (emojis et accents comptent plusieurs octets).
  let bytes = 0;
  for (const ch of json) {
    const cp = ch.codePointAt(0) ?? 0;
    bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return bytes;
}

/**
 * Document valide et plafonné. Les calques en trop (nombre ou octets) sont
 * retirés en partant des derniers ajoutés.
 */
export function sanitizeOverlayDoc(raw: unknown): OverlayDoc {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const list = Array.isArray(r.items) ? r.items : [];
  const seen = new Set<string>();
  const items: Overlay[] = [];
  for (const it of list) {
    if (items.length >= MAX_OVERLAYS) break;
    const o = sanitizeOne(it);
    if (!o) continue;
    if (seen.has(o.id)) o.id = makeOverlayId();
    seen.add(o.id);
    items.push(o);
  }
  const doc: OverlayDoc = { v: OVERLAYS_VERSION, aspect: sanitizeAspect(r.aspect), items };
  while (doc.items.length > 0 && overlayDocBytes(doc) > MAX_OVERLAYS_BYTES) {
    doc.items.pop();
  }
  return doc;
}

/**
 * Lecture de `videos.edit_meta` (S5) : document de calques validé, ou
 * undefined s'il n'y en a pas. Aucune vidéo n'en a avant S5.
 */
export function overlaysFromEditMeta(editMeta: unknown): OverlayDoc | undefined {
  if (!editMeta || typeof editMeta !== 'object') return undefined;
  const raw = (editMeta as Record<string, unknown>).overlays;
  if (!raw) return undefined;
  const doc = sanitizeOverlayDoc(raw);
  return doc.items.length > 0 ? doc : undefined;
}

/** Vrai si le calque peut être ajouté sans dépasser les plafonds. */
export function canAddOverlay(doc: OverlayDoc, candidate: Overlay): boolean {
  if (doc.items.length >= MAX_OVERLAYS) return false;
  return overlayDocBytes({ ...doc, items: [...doc.items, candidate] }) <= MAX_OVERLAYS_BYTES;
}

/** Visible à cet instant de la vidéo publiée (ms). null = toujours (photo). */
export function isOverlayVisible(o: Overlay, timeMs: number | null): boolean {
  if (timeMs == null) return true;
  if (timeMs < o.startMs) return false;
  return o.endMs == null || timeMs < o.endMs;
}

/**
 * Recadre les fenêtres d'affichage sur une vidéo de `durationMs` (après une
 * nouvelle découpe). Une fenêtre qui sort de la vidéo est ramenée dedans.
 */
export function clampOverlayTimes(items: Overlay[], durationMs: number): Overlay[] {
  if (!(durationMs > 0)) return items;
  return items.map((o) => {
    const maxStart = Math.max(0, durationMs - MIN_OVERLAY_SPAN_MS);
    const startMs = Math.min(o.startMs, maxStart);
    let endMs = o.endMs;
    if (endMs != null) {
      endMs = Math.min(endMs, durationMs);
      if (endMs >= durationMs - 50 || endMs < startMs + MIN_OVERLAY_SPAN_MS) endMs = null;
    }
    return startMs === o.startMs && endMs === o.endMs ? o : { ...o, startMs, endMs };
  });
}

export type FrameRect = { left: number; top: number; width: number; height: number };

/**
 * Rectangle du cadre du média affiché en `cover` dans un conteneur : c'est
 * le repère des calques, identique dans l'éditeur et dans tous les lecteurs.
 */
export function coverFrameRect(
  containerW: number,
  containerH: number,
  aspect: number = DEFAULT_FRAME_ASPECT,
): FrameRect {
  if (!(containerW > 0) || !(containerH > 0)) return { left: 0, top: 0, width: 0, height: 0 };
  const a = aspect > 0 ? aspect : DEFAULT_FRAME_ASPECT;
  const containerAspect = containerW / containerH;
  if (containerAspect > a) {
    const height = containerW / a;
    return { left: 0, top: (containerH - height) / 2, width: containerW, height };
  }
  const width = containerH * a;
  return { left: (containerW - width) / 2, top: 0, width, height: containerH };
}

/** Couleurs d'un texte : couleur choisie, ou fond de cette couleur + texte contrasté. */
export function textOverlayColors(o: Pick<TextOverlay, 'color' | 'bg'>): {
  text: string;
  background: string | null;
} {
  const hex = OVERLAY_COLORS[o.color] ?? OVERLAY_COLORS.sable;
  if (o.bg === 'box') {
    return {
      text: LIGHT_COLORS.has(o.color) ? OVERLAY_COLORS.noir : OVERLAY_COLORS.sable,
      background: hex,
    };
  }
  if (o.bg === 'soft') {
    // Pastille semi-transparente : sombre sous un texte clair, sable sous un texte foncé.
    return {
      text: hex,
      background: LIGHT_COLORS.has(o.color) ? 'rgba(11,11,11,0.55)' : 'rgba(245,230,211,0.62)',
    };
  }
  return { text: hex, background: null };
}

/** Mélange une couleur #RRGGBB avec du blanc (0 = inchangée, 1 = blanc). */
export function lightenHex(hex: string, amount: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const t = clamp(amount, 0, 1);
  const ch = (shift: number) => {
    const c = (n >> shift) & 0xff;
    return Math.round(c + (255 - c) * t)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${ch(16)}${ch(8)}${ch(0)}`.toUpperCase();
}

export type TextOverlayLook = {
  color: string;
  background: string | null;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  textAlign: OverlayAlign;
  /** Ombre portée (lisibilité) ou halo (néon) ; null avec une pastille pleine. */
  shadow: { color: string; radius: number; dx: number; dy: number } | null;
  paddingH: number;
  paddingV: number;
  borderRadius: number;
};

/**
 * Rendu d'un texte pour une taille de police donnée. Toutes les mesures sont
 * proportionnelles à `fontSize` : l'aperçu et l'image incrustée (capture à
 * une autre échelle) ont donc exactement la même mise en page.
 */
export function textOverlayLook(
  o: Pick<TextOverlay, 'color' | 'bg' | 'font' | 'align'>,
  fontSize: number,
): TextOverlayLook {
  const c = textOverlayColors(o);
  const neon = o.font === 'neon';
  const hex = OVERLAY_COLORS[o.color] ?? OVERLAY_COLORS.sable;
  let color = c.text;
  let shadow: TextOverlayLook['shadow'] = null;
  if (neon && o.bg !== 'box') {
    // Néon : cœur clair, halo de la couleur choisie.
    color = lightenHex(hex, 0.65);
    shadow = { color: hex, radius: fontSize * 0.35, dx: 0, dy: 0 };
  } else if (!c.background) {
    shadow = { color: 'rgba(11,11,11,0.75)', radius: fontSize * 0.1, dx: 0, dy: fontSize * 0.03 };
  }
  return {
    color,
    background: c.background,
    fontFamily: OVERLAY_FONTS[o.font] ?? OVERLAY_FONTS.classique,
    fontSize,
    lineHeight: fontSize * (FONT_LINE_HEIGHT[o.font] ?? 1.25),
    textAlign: o.align ?? 'center',
    shadow,
    paddingH: c.background ? fontSize * 0.35 : 0,
    paddingV: c.background ? fontSize * 0.12 : 0,
    borderRadius: c.background ? fontSize * 0.3 : 0,
  };
}

/** Taille de police d'un calque dans un cadre de `frameWidth` (px ou dp). */
export function overlayFontSize(o: Pick<Overlay, 'size'>, frameWidth: number): number {
  return Math.max(6, o.size * frameWidth);
}

/**
 * Marge transparente autour d'un calque, proportionnelle au cadre : le halo
 * du néon et les ombres tiennent dans l'image capturée.
 */
export function overlayPadding(o: Pick<Overlay, 'type'> & { font?: OverlayFontId }, fontSize: number): number {
  if (o.type === 'text' && o.font === 'neon') return fontSize * 0.45;
  return fontSize * 0.16;
}

/** Largeur maximale d'un texte (retour à la ligne), en fraction du cadre. */
export const TEXT_MAX_WIDTH_RATIO = 0.86;

/** Textes posés sur la vidéo (filtre de mots avant l'incrustation), un par ligne. */
export function overlayTexts(doc: OverlayDoc | null | undefined): string {
  if (!doc) return '';
  return doc.items
    .filter((o): o is TextOverlay => o.type === 'text')
    .map((o) => o.text.trim())
    .filter(Boolean)
    .join('\n');
}

/** Stickers proposés (grille). */
export const STICKER_EMOJIS: readonly string[] = [
  '🔥', '❤️', '😂', '😍', '🥰', '😎', '🤩', '😭',
  '🙏🏾', '👏🏾', '🙌🏾', '💪🏾', '✊🏾', '👋🏾', '🤝🏾', '👌🏾',
  '💃🏾', '🕺🏾', '🎶', '🥁', '🎤', '🎧', '✨', '💯',
  '👑', '🌍', '🌅', '☀️', '🌴', '🦁', '🐘', '🦒',
  '🍲', '🥭', '🍍', '☕', '🎉', '🎁', '⚽', '🏆',
  '📍', '📸', '💡', '💬', '👀', '😮', '🤔', '💚',
];
