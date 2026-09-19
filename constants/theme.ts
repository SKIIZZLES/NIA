/**
 * NIA — tokens de marque (moodboard)
 * Noir Terre · Ocre Africain · Sable · Vert Baobab · Rouge Terre
 *
 * Static `Colors` aliases NIA Original for backward compatibility.
 * Prefer `useColors()` / `useTheme()` from ThemeContext for themed chrome.
 */
export { ORIGINAL_COLORS as Colors } from '@/constants/themes';
export type { ThemeColors, ThemeId } from '@/constants/themes';

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const Radii = {
  sm: 8,
  md: 12,
  lg: 20,
  pill: 999,
  create: 14,
} as const;

export const Fonts = {
  light: 'PlusJakartaSans_300Light',
  regular: 'PlusJakartaSans_400Regular',
  medium: 'PlusJakartaSans_500Medium',
  bold: 'PlusJakartaSans_700Bold',
} as const;

export const Tagline = 'VIDÉOS · CULTURES · TALENTS · SANS FRONTIÈRES';

export const HeroLines = {
  primary: 'ICI, LES TALENTS AFRICAINS VONT PLUS LOIN',
  secondary: 'PLUS QUE DES VIDÉOS UNE AFRIQUE QUI SE RACONTE',
} as const;
