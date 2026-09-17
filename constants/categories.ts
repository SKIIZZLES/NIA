/**
 * Univers Découvrir — IDs alignés sur `videos.category` (migration 002).
 */
import type { ComponentProps } from 'react';
import { Ionicons } from '@expo/vector-icons';

export type CategoryId =
  | 'afrique'
  | 'diaspora'
  | 'culture'
  | 'musique'
  | 'mode'
  | 'tech'
  | 'food'
  | 'sport';

export type DiscoverCategory = {
  id: CategoryId;
  label: string;
  blurb: string;
  icon: ComponentProps<typeof Ionicons>['name'];
};

export const DISCOVER_CATEGORIES: DiscoverCategory[] = [
  {
    id: 'afrique',
    label: 'Afrique',
    blurb: 'Créations nées sur le continent',
    icon: 'globe-outline',
  },
  {
    id: 'diaspora',
    label: 'Diaspora',
    blurb: 'Voix et récits hors frontières',
    icon: 'airplane-outline',
  },
  {
    id: 'culture',
    label: 'Culture',
    blurb: 'Arts, langues, patrimoine vivant',
    icon: 'library-outline',
  },
  {
    id: 'musique',
    label: 'Musique',
    blurb: 'Afrobeats, jazz, tradition & scène',
    icon: 'musical-notes-outline',
  },
  {
    id: 'mode',
    label: 'Mode',
    blurb: 'Style, design & maison créative',
    icon: 'shirt-outline',
  },
  {
    id: 'tech',
    label: 'Tech & Innovation',
    blurb: 'Builders, startups, futur afro-tech',
    icon: 'hardware-chip-outline',
  },
  {
    id: 'food',
    label: 'Gastronomie',
    blurb: 'Saveurs, chefs & tables urbaines',
    icon: 'restaurant-outline',
  },
  {
    id: 'sport',
    label: 'Sport',
    blurb: 'Talents, clubs & moments forts',
    icon: 'football-outline',
  },
];

export const CATEGORY_IDS: CategoryId[] = DISCOVER_CATEGORIES.map((c) => c.id);

export function isCategoryId(value: string | null | undefined): value is CategoryId {
  return !!value && (CATEGORY_IDS as string[]).includes(value);
}
