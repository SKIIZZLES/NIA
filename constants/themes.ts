/**
 * NIA — per-user Appearance theme tokens.
 * Brand rule: no pure white as primary text on dark themes.
 * Clair uses dark text on light backgrounds (and a darker ochre accent).
 *
 * Contrast (WCAG 2.x AA) is enforced by `__tests__/constants/themeContrast.test.ts`
 * (pairs in `lib/themeContrast.ts`): text ≥ 4.5:1 on noir / noirElevated /
 * noirSoft, disabled / control outlines ≥ 3:1, media tokens on pure white.
 * Change a value here → run `CONTRAST_TABLE=1 npx jest themeContrast`.
 */

export const THEME_STORAGE_KEY = '@nia/theme';

export type ThemeId =
  | 'original'
  | 'sable'
  | 'terre'
  | 'bronze'
  | 'nuit'
  | 'clair'
  | 'auto';

export const THEME_IDS: readonly ThemeId[] = [
  'original',
  'sable',
  'terre',
  'bronze',
  'nuit',
  'clair',
  'auto',
] as const;

export type ThemeColors = {
  /** App background */
  noir: string;
  noirElevated: string;
  noirSoft: string;
  terre: string;
  terreLight: string;
  /** Primary accent (ocre / bronze / etc.) — also aliased as `or` */
  or: string;
  orSoft: string;
  ocre: string;
  /**
   * Primary UI text / cream accent.
   * Dark themes: warm sable cream (never pure #FFF).
   * Clair: dark brown for contrast on light bg.
   */
  sable: string;
  sableMuted: string;
  vert: string;
  vertDeep: string;
  vertBaobab: string;
  rougeTerre: string;
  white: string;
  textPrimary: string;
  textSecondary: string;
  /** Tertiary text (hints, meta, placeholders) — still ≥ 4.5:1 (WCAG AA). */
  textMuted: string;
  /** Disabled labels / icons: dimmed but legible (≥ 3:1). */
  textDisabled: string;
  /** Decorative separators and card outlines (no contrast requirement). */
  border: string;
  /** Outline of interactive controls (outline buttons, inputs) — ≥ 3:1. */
  borderStrong: string;
  /** Destructive text / icons — ≥ 4.5:1 on every surface of the theme. */
  danger: string;
  overlay: string;
  /**
   * Text/icons over video / photo — always light cream, whatever the theme.
   * Pair with `mediaScrim` / `mediaScrimStrong` (never a theme surface).
   */
  onMedia: string;
  /** Secondary text over media (inactive tabs, meta). */
  onMediaMuted: string;
  /** Disabled controls over media (≥ 3:1 on `mediaScrimStrong`). */
  onMediaDisabled: string;
  /** Selected tool / accent over media (bright ochre). */
  onMediaAccent: string;
  /** Dark translucent backing for round buttons over media (icons, ≥ 3:1). */
  mediaScrim: string;
  /** Darker backing for bars / pills carrying text over media (≥ 4.5:1). */
  mediaScrimStrong: string;
  /** Text shadow colour for labels drawn straight on media. */
  mediaTextShadow: string;
  /** Icon/text on ocre accent buttons */
  onAccent: string;
  isDark: boolean;
};

/**
 * Tokens « sur média » : identiques dans tous les thèmes. Un contrôle posé sur
 * une vidéo ou une photo ne doit jamais dépendre de la surface claire d'un
 * thème (cf. `__tests__/constants/themeContrast.test.ts`, fond blanc pur).
 */
export const MEDIA_TOKENS = {
  onMedia: '#F5E6D3',
  onMediaMuted: 'rgba(245, 230, 211, 0.86)',
  onMediaDisabled: 'rgba(245, 230, 211, 0.6)',
  onMediaAccent: '#F0B26B',
  mediaScrim: 'rgba(0, 0, 0, 0.55)',
  mediaScrimStrong: 'rgba(0, 0, 0, 0.72)',
  mediaTextShadow: 'rgba(0, 0, 0, 0.75)',
} as const;

const SHARED = {
  ...MEDIA_TOKENS,
  white: '#FFFFFF',
  vert: '#1B4D3E',
  vertDeep: '#143D31',
  vertBaobab: '#1B4D3E',
  /** Brand red for fills (record stop, live dot). Text uses `danger`. */
  rougeTerre: '#A33227',
  onAccent: '#0B0B0B',
} as const;

/** NIA Original — Noir #0B0B0B · Ocre #D17F2A · Sable #F5E6D3 */
export const ORIGINAL_COLORS: ThemeColors = {
  ...SHARED,
  noir: '#0B0B0B',
  noirElevated: '#141414',
  noirSoft: '#1C1C1C',
  terre: '#6B3E26',
  terreLight: '#8B5A2B',
  or: '#D17F2A',
  orSoft: '#E09A4F',
  ocre: '#D17F2A',
  sable: '#F5E6D3',
  sableMuted: '#E8D9C4',
  textPrimary: '#F5E6D3',
  textSecondary: 'rgba(245, 230, 211, 0.72)',
  textMuted: 'rgba(245, 230, 211, 0.6)',
  border: 'rgba(245, 230, 211, 0.18)',
  overlay: 'rgba(11, 11, 11, 0.55)',
  textDisabled: 'rgba(245, 230, 211, 0.44)',
  borderStrong: 'rgba(245, 230, 211, 0.42)',
  danger: '#E5705F',
  isDark: true,
};

/** Sable — warmer sand emphasis */
export const SABLE_COLORS: ThemeColors = {
  ...SHARED,
  noir: '#12100E',
  noirElevated: '#1C1915',
  noirSoft: '#26221C',
  terre: '#8B5A2B',
  terreLight: '#A67C52',
  or: '#C9893A',
  orSoft: '#E0A85C',
  ocre: '#C9893A',
  sable: '#F7EBDD',
  sableMuted: '#EAD9C4',
  textPrimary: '#F7EBDD',
  textSecondary: 'rgba(247, 235, 221, 0.75)',
  textMuted: 'rgba(247, 235, 221, 0.6)',
  border: 'rgba(247, 235, 221, 0.22)',
  overlay: 'rgba(18, 16, 14, 0.55)',
  textDisabled: 'rgba(247, 235, 221, 0.44)',
  borderStrong: 'rgba(247, 235, 221, 0.42)',
  danger: '#E5705F',
  isDark: true,
};

/** Terre — deep brown */
export const TERRE_COLORS: ThemeColors = {
  ...SHARED,
  noir: '#1A100C',
  noirElevated: '#241610',
  noirSoft: '#2E1E16',
  terre: '#5C3317',
  terreLight: '#7A4A28',
  or: '#CC7F3C',
  orSoft: '#D4894A',
  ocre: '#CC7F3C',
  sable: '#E8D5C0',
  sableMuted: '#D4C0A8',
  textPrimary: '#E8D5C0',
  textSecondary: 'rgba(232, 213, 192, 0.72)',
  textMuted: 'rgba(232, 213, 192, 0.64)',
  border: 'rgba(232, 213, 192, 0.18)',
  overlay: 'rgba(26, 16, 12, 0.6)',
  textDisabled: 'rgba(232, 213, 192, 0.48)',
  borderStrong: 'rgba(232, 213, 192, 0.45)',
  danger: '#EA7B6A',
  isDark: true,
};

/** Bronze — metallic bronze accents */
export const BRONZE_COLORS: ThemeColors = {
  ...SHARED,
  noir: '#0E0C0A',
  noirElevated: '#181512',
  noirSoft: '#221E19',
  terre: '#6B4E2E',
  terreLight: '#8A6A3E',
  or: '#CD7F32',
  orSoft: '#E0A04A',
  ocre: '#CD7F32',
  sable: '#F0E4D4',
  sableMuted: '#DCCDB8',
  textPrimary: '#F0E4D4',
  textSecondary: 'rgba(240, 228, 212, 0.72)',
  textMuted: 'rgba(240, 228, 212, 0.6)',
  border: 'rgba(205, 127, 50, 0.28)',
  overlay: 'rgba(14, 12, 10, 0.55)',
  textDisabled: 'rgba(240, 228, 212, 0.44)',
  borderStrong: 'rgba(205, 127, 50, 0.7)',
  danger: '#E5705F',
  isDark: true,
};

/** Nuit — deeper black / cool */
export const NUIT_COLORS: ThemeColors = {
  ...SHARED,
  noir: '#050508',
  noirElevated: '#0C0C12',
  noirSoft: '#14141C',
  terre: '#3D3A4A',
  terreLight: '#5A5670',
  or: '#C4783A',
  orSoft: '#D9945C',
  ocre: '#C4783A',
  sable: '#E8E4F0',
  sableMuted: '#C8C4D4',
  textPrimary: '#E8E4F0',
  textSecondary: 'rgba(232, 228, 240, 0.72)',
  textMuted: 'rgba(232, 228, 240, 0.6)',
  border: 'rgba(232, 228, 240, 0.14)',
  overlay: 'rgba(5, 5, 8, 0.6)',
  textDisabled: 'rgba(232, 228, 240, 0.44)',
  borderStrong: 'rgba(232, 228, 240, 0.4)',
  danger: '#E5705F',
  isDark: true,
};

/** Clair — light mode (dark text on light bg) */
export const CLAIR_COLORS: ThemeColors = {
  ...SHARED,
  noir: '#FAF6F0',
  noirElevated: '#FFFFFF',
  noirSoft: '#EFE6DA',
  terre: '#6B3E26',
  terreLight: '#8B5A2B',
  or: '#9A5214',
  orSoft: '#B8692A',
  ocre: '#9A5214',
  sable: '#1A120C',
  sableMuted: '#3D2E22',
  textPrimary: '#1A120C',
  textSecondary: 'rgba(26, 18, 12, 0.78)',
  textMuted: 'rgba(26, 18, 12, 0.66)',
  border: 'rgba(26, 18, 12, 0.16)',
  overlay: 'rgba(250, 246, 240, 0.7)',
  textDisabled: 'rgba(26, 18, 12, 0.5)',
  borderStrong: 'rgba(26, 18, 12, 0.5)',
  danger: '#A33227',
  onAccent: '#FAF6F0',
  isDark: false,
};

/** Resolved palette ids (excludes `auto`) */
export type ResolvedThemeId = Exclude<ThemeId, 'auto'>;

export const THEME_PALETTES: Record<ResolvedThemeId, ThemeColors> = {
  original: ORIGINAL_COLORS,
  sable: SABLE_COLORS,
  terre: TERRE_COLORS,
  bronze: BRONZE_COLORS,
  nuit: NUIT_COLORS,
  clair: CLAIR_COLORS,
};

export function isThemeId(value: string | null | undefined): value is ThemeId {
  return typeof value === 'string' && (THEME_IDS as readonly string[]).includes(value);
}

export function resolveThemeColors(
  themeId: ThemeId,
  systemScheme: 'light' | 'dark' | null | undefined,
): ThemeColors {
  if (themeId === 'auto') {
    return systemScheme === 'light' ? CLAIR_COLORS : ORIGINAL_COLORS;
  }
  return THEME_PALETTES[themeId];
}

/** Preview swatch for the appearance picker (accent + bg). */
export function themePreview(themeId: ThemeId): { bg: string; accent: string } {
  if (themeId === 'auto') {
    return { bg: ORIGINAL_COLORS.noir, accent: CLAIR_COLORS.noir };
  }
  const c = THEME_PALETTES[themeId];
  return { bg: c.noir, accent: c.or };
}

/**
 * Palette des écrans et panneaux posés sur un média plein écran (caméra,
 * éditeur) : un thème sombre garde ses couleurs, Clair (et Auto en clair)
 * bascule sur NIA Original. Le texte sable reste lisible sur la vidéo et
 * sur les voiles sombres, quel que soit le thème choisi dans Apparence.
 */
export function mediaPalette(colors: ThemeColors): ThemeColors {
  return colors.isDark ? colors : ORIGINAL_COLORS;
}
