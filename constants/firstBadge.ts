/**
 * Badge « First » (migration 023) : couleurs de la pastille.
 *
 * La pastille porte son propre fond : elle reste lisible quelle que soit la
 * surface (thème d'Apparence, écran encore dessiné avec `Colors` statiques,
 * vidéo plein écran). Deux tons, jamais de blanc pur :
 * - `dark` : bronze sur brun profond (thèmes sombres et sur média) ;
 * - `light` : ocre foncé sur sable (Clair, et Auto en clair).
 *
 * Contrastes vérifiés par `__tests__/constants/firstBadgeContrast.test.ts` :
 * libellé / fond ≥ 4.5:1, contour de la pastille / surface ≥ 3:1.
 */
import type { ThemeColors } from '@/constants/themes';

export type FirstBadgeTone = 'dark' | 'light';
/**
 * `theme` : suit le thème d'Apparence (écrans thémés).
 * `dark` : toujours le ton sombre, pour ce qui est posé sur une vidéo / photo
 * et pour les écrans encore dessinés en `Colors` statiques (NIA Original).
 */
export type FirstBadgeVariant = 'theme' | 'dark';

export type FirstBadgePalette = {
  background: string;
  border: string;
  text: string;
};

export const FIRST_BADGE_PALETTES: Record<FirstBadgeTone, FirstBadgePalette> = {
  dark: {
    background: '#2A1A0E',
    border: '#CD7F32',
    text: '#F0B26B',
  },
  light: {
    background: '#F3E3CC',
    border: '#9A5214',
    text: '#7A3F0C',
  },
};

/** Ton de la pastille : `dark` force le ton sombre ; sinon celui du thème. */
export function firstBadgeTone(colors: Pick<ThemeColors, 'isDark'>, variant: FirstBadgeVariant): FirstBadgeTone {
  if (variant === 'dark') return 'dark';
  return colors.isDark ? 'dark' : 'light';
}

export function firstBadgePalette(
  colors: Pick<ThemeColors, 'isDark'>,
  variant: FirstBadgeVariant = 'theme',
): FirstBadgePalette {
  return FIRST_BADGE_PALETTES[firstBadgeTone(colors, variant)];
}
