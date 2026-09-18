/**
 * NIA — tokens de marque (moodboard)
 * Noir Terre · Ocre Africain · Sable · Vert Baobab · Rouge Terre
 */
export const Colors = {
  /** Noir Terre #0B0B0B */
  noir: '#0B0B0B',
  noirElevated: '#141414',
  noirSoft: '#1C1C1C',
  terre: '#6B3E26',
  terreLight: '#8B5A2B',
  /** Ocre Africain #D17F2A — primary accent (was gold/or) */
  or: '#D17F2A',
  orSoft: '#E09A4F',
  ocre: '#D17F2A',
  /** Sable #F5E6D3 — primary UI text (cream-brown, not pure white) */
  sable: '#F5E6D3',
  sableMuted: '#E8D9C4',
  /** Vert Baobab #1B4D3E */
  vert: '#1B4D3E',
  vertDeep: '#143D31',
  vertBaobab: '#1B4D3E',
  /** Rouge Terre #A33227 */
  rougeTerre: '#A33227',
  white: '#FFFFFF',
  textPrimary: '#F5E6D3',
  textSecondary: 'rgba(245, 230, 211, 0.72)',
  textMuted: 'rgba(245, 230, 211, 0.45)',
  border: 'rgba(245, 230, 211, 0.18)',
  danger: '#A33227',
  overlay: 'rgba(11, 11, 11, 0.55)',
} as const;

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
