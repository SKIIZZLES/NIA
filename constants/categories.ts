/**
 * Univers Découvrir — IDs alignés sur `videos.category` (migration 002+).
 */
import type { ComponentProps } from 'react';
import { Ionicons } from '@expo/vector-icons';

export type CategoryId =
  | 'afrique'
  | 'maghreb'
  | 'diaspora'
  | 'culture'
  | 'musique'
  | 'mode'
  | 'tech'
  | 'food'
  | 'sport'
  | 'actus';

export type DiscoverCategory = {
  id: CategoryId;
  /** i18n key under discover.categories.* */
  labelKey: string;
  blurb: string;
  icon: ComponentProps<typeof Ionicons>['name'];
};

export const DISCOVER_CATEGORIES: DiscoverCategory[] = [
  {
    id: 'afrique',
    labelKey: 'discover.categories.afrique',
    blurb: 'Créations nées sur le continent',
    icon: 'globe-outline',
  },
  {
    id: 'maghreb',
    labelKey: 'discover.categories.maghreb',
    blurb: 'Voix du Maroc, Algérie, Tunisie & voisinage',
    icon: 'sunny-outline',
  },
  {
    id: 'diaspora',
    labelKey: 'discover.categories.diaspora',
    blurb: 'Voix et récits hors frontières',
    icon: 'airplane-outline',
  },
  {
    id: 'culture',
    labelKey: 'discover.categories.culture',
    blurb: 'Arts, langues, patrimoine vivant',
    icon: 'library-outline',
  },
  {
    id: 'musique',
    labelKey: 'discover.categories.musique',
    blurb: 'Afrobeats, jazz, tradition & scène',
    icon: 'musical-notes-outline',
  },
  {
    id: 'mode',
    labelKey: 'discover.categories.mode',
    blurb: 'Style, design & maison créative',
    icon: 'shirt-outline',
  },
  {
    id: 'tech',
    labelKey: 'discover.categories.tech',
    blurb: 'Builders, startups, futur afro-tech',
    icon: 'hardware-chip-outline',
  },
  {
    id: 'food',
    labelKey: 'discover.categories.food',
    blurb: 'Saveurs, chefs & tables urbaines',
    icon: 'restaurant-outline',
  },
  {
    id: 'sport',
    labelKey: 'discover.categories.sport',
    blurb: 'Talents, clubs & moments forts',
    icon: 'football-outline',
  },
  {
    id: 'actus',
    labelKey: 'discover.categories.actus',
    blurb: 'Infos, débats & moments d’actualité',
    icon: 'newspaper-outline',
  },
];

export const CATEGORY_IDS: CategoryId[] = DISCOVER_CATEGORIES.map((c) => c.id);

export function isCategoryId(value: string | null | undefined): value is CategoryId {
  return !!value && (CATEGORY_IDS as string[]).includes(value);
}
