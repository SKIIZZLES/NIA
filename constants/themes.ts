/**
 * NIA — per-user Appearance theme tokens.
 * Brand rule: no pure white as primary text on dark themes.
 * Clair uses dark text on light backgrounds.
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
  textMuted: string;
  border: string;
  danger: string;
  overlay: string;
  /** Text/icons over video / media (always light cream for contrast) */
  onMedia: string;
  /** Icon/text on ocre accent buttons */
  onAccent: string;
  isDark: boolean;
};

const SHARED = {
  white: '#FFFFFF',
  vert: '#1B4D3E',
  vertDeep: '#143D31',
  vertBaobab: '#1B4D3E',
  rougeTerre: '#A33227',
  danger: '#A33227',
  onMedia: '#F5E6D3',
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
  textMuted: 'rgba(245, 230, 211, 0.45)',
  border: 'rgba(245, 230, 211, 0.18)',
  overlay: 'rgba(11, 11, 11, 0.55)',
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
  textMuted: 'rgba(247, 235, 221, 0.48)',
  border: 'rgba(247, 235, 221, 0.22)',
  overlay: 'rgba(18, 16, 14, 0.55)',
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
  or: '#B86B2A',
  orSoft: '#D4894A',
  ocre: '#B86B2A',
  sable: '#E8D5C0',
  sableMuted: '#D4C0A8',
  textPrimary: '#E8D5C0',
  textSecondary: 'rgba(232, 213, 192, 0.72)',
  textMuted: 'rgba(232, 213, 192, 0.45)',
  border: 'rgba(232, 213, 192, 0.18)',
  overlay: 'rgba(26, 16, 12, 0.6)',
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
  textMuted: 'rgba(240, 228, 212, 0.45)',
  border: 'rgba(205, 127, 50, 0.28)',
  overlay: 'rgba(14, 12, 10, 0.55)',
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
  textMuted: 'rgba(232, 228, 240, 0.42)',
  border: 'rgba(232, 228, 240, 0.14)',
  overlay: 'rgba(5, 5, 8, 0.6)',
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
  or: '#D17F2A',
  orSoft: '#E09A4F',
  ocre: '#D17F2A',
  sable: '#1A120C',
  sableMuted: '#3D2E22',
  textPrimary: '#1A120C',
  textSecondary: 'rgba(26, 18, 12, 0.72)',
  textMuted: 'rgba(26, 18, 12, 0.45)',
  border: 'rgba(26, 18, 12, 0.14)',
  overlay: 'rgba(250, 246, 240, 0.7)',
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
