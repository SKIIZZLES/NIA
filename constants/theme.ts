/**
 * NIA — tokens de marque (brand board)
 * Noir · Terre · Or africain · Sable · Vert
 */
export const Colors = {
  noir: '#0A0A0A',
  noirElevated: '#111111',
  noirSoft: '#1A1A1A',
  terre: '#6B3E26',
  terreLight: '#8B5A2B',
  or: '#C9A227',
  orSoft: '#D4B84A',
  sable: '#F5F0E6',
  sableMuted: '#E8DFD0',
  vert: '#1B4332',
  vertDeep: '#0D3B2E',
  white: '#FFFFFF',
  textPrimary: '#F5F0E6',
  textSecondary: 'rgba(245, 240, 230, 0.72)',
  textMuted: 'rgba(245, 240, 230, 0.45)',
  border: 'rgba(245, 240, 230, 0.18)',
  danger: '#C0392B',
  overlay: 'rgba(10, 10, 10, 0.55)',
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
