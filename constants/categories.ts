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
  icon: ComponentProps<typeof Ionicons>['name'];
};

export const DISCOVER_CATEGORIES: DiscoverCategory[] = [
  { id: 'afrique', labelKey: 'discover.categories.afrique', icon: 'globe-outline' },
  { id: 'maghreb', labelKey: 'discover.categories.maghreb', icon: 'sunny-outline' },
  { id: 'diaspora', labelKey: 'discover.categories.diaspora', icon: 'airplane-outline' },
  { id: 'culture', labelKey: 'discover.categories.culture', icon: 'library-outline' },
  { id: 'musique', labelKey: 'discover.categories.musique', icon: 'musical-notes-outline' },
  { id: 'mode', labelKey: 'discover.categories.mode', icon: 'shirt-outline' },
  { id: 'tech', labelKey: 'discover.categories.tech', icon: 'hardware-chip-outline' },
  { id: 'food', labelKey: 'discover.categories.food', icon: 'restaurant-outline' },
  { id: 'sport', labelKey: 'discover.categories.sport', icon: 'football-outline' },
  { id: 'actus', labelKey: 'discover.categories.actus', icon: 'newspaper-outline' },
];

export const CATEGORY_IDS: CategoryId[] = DISCOVER_CATEGORIES.map((c) => c.id);

export function isCategoryId(value: string | null | undefined): value is CategoryId {
  return !!value && (CATEGORY_IDS as string[]).includes(value);
}
