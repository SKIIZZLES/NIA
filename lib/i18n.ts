/**
 * Lightweight i18n for NIA (expo-localization + i18n-js).
 * Pattern: add keys to locales/fr.ts + locales/en.ts, then t('section.key').
 * Future African languages: add locales/xx.ts and extend AppLocale.
 */
import { I18n } from 'i18n-js';
import * as Localization from 'expo-localization';
import fr from '@/locales/fr';
import en from '@/locales/en';

export const APP_LOCALES = ['fr', 'en'] as const;
export type AppLocale = (typeof APP_LOCALES)[number];

export const LOCALE_STORAGE_KEY = '@nia/locale';

/** Device language if fr/en, else French (product primary). */
export function resolveDeviceLocale(): AppLocale {
  const code = Localization.getLocales()[0]?.languageCode?.toLowerCase();
  if (code === 'en') return 'en';
  if (code === 'fr') return 'fr';
  return 'fr';
}

export function isAppLocale(value: string | null | undefined): value is AppLocale {
  return value === 'fr' || value === 'en';
}

const i18n = new I18n({ fr, en });
i18n.enableFallback = true;
i18n.defaultLocale = 'fr';
i18n.locale = resolveDeviceLocale();

export function setI18nLocale(locale: AppLocale) {
  i18n.locale = locale;
}

export function getI18nLocale(): AppLocale {
  return isAppLocale(i18n.locale) ? i18n.locale : 'fr';
}

/** Translate. Scope: nested keys with dots, e.g. t('tabs.home'). */
export function t(
  scope: string,
  options?: Record<string, string | number>,
): string {
  return i18n.t(scope, options);
}

export { i18n };
