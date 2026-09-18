/**
 * Lightweight i18n for NIA (expo-localization + i18n-js).
 * Pattern: add keys to locales/*.ts (same structure as fr.ts), then t('section.key').
 * Supported: fr, en, es, pt, sw, ha, ar-MA (Darija), ar-SD (Sudanese).
 *
 * RTL: Arabic dialect strings are shown, but layout stays LTR so the vertical
 * video UI is not mirrored. Full I18nManager RTL is intentionally not enabled —
 * see README.
 */
import { I18n } from 'i18n-js';
import * as Localization from 'expo-localization';
import fr from '@/locales/fr';
import en from '@/locales/en';
import es from '@/locales/es';
import pt from '@/locales/pt';
import sw from '@/locales/sw';
import ha from '@/locales/ha';
import arMA from '@/locales/ar-MA';
import arSD from '@/locales/ar-SD';

export const APP_LOCALES = [
  'fr',
  'en',
  'es',
  'pt',
  'sw',
  'ha',
  'ar-MA',
  'ar-SD',
] as const;
export type AppLocale = (typeof APP_LOCALES)[number];

export const LOCALE_STORAGE_KEY = '@nia/locale';

const LOCALE_SET = new Set<string>(APP_LOCALES);

/** Maghrebi countries → Darija (ar-MA). */
const MAGHREB_REGIONS = new Set(['MA', 'DZ', 'TN', 'LY', 'EH', 'MR']);

/** Map device language prefixes (fr, en, es, pt, sw, ha, ar) → AppLocale; else French. */
export function resolveDeviceLocale(): AppLocale {
  const locales = Localization.getLocales();
  for (const loc of locales) {
    const code = loc.languageCode?.toLowerCase() ?? '';
    const tag = (loc.languageTag ?? '').toLowerCase().replace(/_/g, '-');
    const region = (loc.regionCode ?? '').toUpperCase();

    if (tag === 'ar-ma' || tag.startsWith('ar-ma-')) return 'ar-MA';
    if (tag === 'ar-sd' || tag.startsWith('ar-sd-')) return 'ar-SD';

    if (code === 'ar') {
      if (region === 'SD') return 'ar-SD';
      if (MAGHREB_REGIONS.has(region)) return 'ar-MA';
      // Prefer dialectal Arabic over MSA fallback → Maghrebi Darija
      return 'ar-MA';
    }

    if (code === 'fr' || tag.startsWith('fr-')) return 'fr';
    if (code === 'en' || tag.startsWith('en-')) return 'en';
    if (code === 'es' || tag.startsWith('es-')) return 'es';
    if (code === 'pt' || tag.startsWith('pt-')) return 'pt';
    if (code === 'sw' || tag.startsWith('sw-')) return 'sw';
    if (code === 'ha' || tag.startsWith('ha-')) return 'ha';
  }
  return 'fr';
}

export function isAppLocale(value: string | null | undefined): value is AppLocale {
  return typeof value === 'string' && LOCALE_SET.has(value);
}

const i18n = new I18n({
  fr,
  en,
  es,
  pt,
  sw,
  ha,
  'ar-MA': arMA,
  'ar-SD': arSD,
});
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
