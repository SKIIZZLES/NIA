/**
 * Catégories live — IDs alignés sur `live_streams.category` (migration 010).
 */
import type { ComponentProps } from 'react';
import { Ionicons } from '@expo/vector-icons';

export type LiveCategoryId =
  | 'culture'
  | 'musique'
  | 'sport'
  | 'food'
  | 'tech'
  | 'education'
  | 'business'
  | 'other';

export type LiveCategory = {
  id: LiveCategoryId;
  /** i18n key under live.cat* */
  labelKey: string;
  icon: ComponentProps<typeof Ionicons>['name'];
};

export const LIVE_CATEGORIES: LiveCategory[] = [
  { id: 'culture', labelKey: 'live.catCulture', icon: 'library-outline' },
  { id: 'musique', labelKey: 'live.catMusique', icon: 'musical-notes-outline' },
  { id: 'sport', labelKey: 'live.catSport', icon: 'football-outline' },
  { id: 'food', labelKey: 'live.catFood', icon: 'restaurant-outline' },
  { id: 'tech', labelKey: 'live.catTech', icon: 'hardware-chip-outline' },
  { id: 'education', labelKey: 'live.catEducation', icon: 'school-outline' },
  { id: 'business', labelKey: 'live.catBusiness', icon: 'briefcase-outline' },
  { id: 'other', labelKey: 'live.catOther', icon: 'ellipse-outline' },
];

export const LIVE_CATEGORY_IDS: LiveCategoryId[] = LIVE_CATEGORIES.map((c) => c.id);

export function isLiveCategoryId(
  value: string | null | undefined,
): value is LiveCategoryId {
  return !!value && (LIVE_CATEGORY_IDS as string[]).includes(value);
}

export type LiveVisibility = 'public' | 'followers' | 'private';

export const LIVE_VISIBILITIES: LiveVisibility[] = [
  'public',
  'followers',
  'private',
];

export function isLiveVisibility(
  value: string | null | undefined,
): value is LiveVisibility {
  return !!value && (LIVE_VISIBILITIES as string[]).includes(value);
}
