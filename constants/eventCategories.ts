/**
 * Catégories événements — IDs alignés sur `events.category` (migration 009).
 */
import type { ComponentProps } from 'react';
import { Ionicons } from '@expo/vector-icons';

export type EventCategoryId =
  | 'culture'
  | 'musique'
  | 'sport'
  | 'food'
  | 'tech'
  | 'education'
  | 'business'
  | 'other';

export type EventCategory = {
  id: EventCategoryId;
  /** i18n key under events.cat.* */
  labelKey: string;
  icon: ComponentProps<typeof Ionicons>['name'];
};

export const EVENT_CATEGORIES: EventCategory[] = [
  { id: 'culture', labelKey: 'events.catCulture', icon: 'library-outline' },
  { id: 'musique', labelKey: 'events.catMusique', icon: 'musical-notes-outline' },
  { id: 'sport', labelKey: 'events.catSport', icon: 'football-outline' },
  { id: 'food', labelKey: 'events.catFood', icon: 'restaurant-outline' },
  { id: 'tech', labelKey: 'events.catTech', icon: 'hardware-chip-outline' },
  { id: 'education', labelKey: 'events.catEducation', icon: 'school-outline' },
  { id: 'business', labelKey: 'events.catBusiness', icon: 'briefcase-outline' },
  { id: 'other', labelKey: 'events.catOther', icon: 'ellipse-outline' },
];

export const EVENT_CATEGORY_IDS: EventCategoryId[] = EVENT_CATEGORIES.map(
  (c) => c.id,
);

export function isEventCategoryId(
  value: string | null | undefined,
): value is EventCategoryId {
  return !!value && (EVENT_CATEGORY_IDS as string[]).includes(value);
}
