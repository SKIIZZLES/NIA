/**
 * Lightweight i18n for NIA (expo-localization + i18n-js).
 * Pattern: add keys to locales/*.ts (same structure as fr.ts), then t('section.key').
 *
 * Supported: fr, en, es, pt, sw, ha, ar-MA (Darija), ar-SD (Sudanese),
 * yo, zu, am, wo, ln, ar-EG (Egyptian), ig, ff, bm, ak, mnk (Mandinka), dyo (Diola).
 *
 * RTL: Arabic dialect / Amharic strings are shown, but layout stays LTR so the
 * vertical video UI is not mirrored. Full I18nManager RTL is intentionally not
 * enabled — see README. Amharic (Ge'ez) is an LTR script.
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
import yo from '@/locales/yo';
import zu from '@/locales/zu';
import am from '@/locales/am';
import wo from '@/locales/wo';
import ln from '@/locales/ln';
import arEG from '@/locales/ar-EG';
import ig from '@/locales/ig';
import ff from '@/locales/ff';
import bm from '@/locales/bm';
import ak from '@/locales/ak';
import mnk from '@/locales/mnk';
import dyo from '@/locales/dyo';

export const APP_LOCALES = [
  'fr',
  'en',
  'es',
  'pt',
  'sw',
  'ha',
  'ar-MA',
  'ar-SD',
  'yo',
  'zu',
  'am',
  'wo',
  'ln',
  'ar-EG',
  'ig',
  'ff',
  'bm',
  'ak',
  'mnk',
  'dyo',
] as const;
export type AppLocale = (typeof APP_LOCALES)[number];

export const LOCALE_STORAGE_KEY = '@nia/locale';

const LOCALE_SET = new Set<string>(APP_LOCALES);

/** Maghrebi countries → Darija (ar-MA). */
const MAGHREB_REGIONS = new Set(['MA', 'DZ', 'TN', 'LY', 'EH', 'MR']);

/** Map device language tags → AppLocale; else French. */
export function resolveDeviceLocale(): AppLocale {
  const locales = Localization.getLocales();
  for (const loc of locales) {
    const code = loc.languageCode?.toLowerCase() ?? '';
    const tag = (loc.languageTag ?? '').toLowerCase().replace(/_/g, '-');
    const region = (loc.regionCode ?? '').toUpperCase();

    if (tag === 'ar-ma' || tag.startsWith('ar-ma-')) return 'ar-MA';
    if (tag === 'ar-sd' || tag.startsWith('ar-sd-')) return 'ar-SD';
    if (tag === 'ar-eg' || tag.startsWith('ar-eg-')) return 'ar-EG';

    if (code === 'ar') {
      if (region === 'SD') return 'ar-SD';
      if (region === 'EG') return 'ar-EG';
      if (MAGHREB_REGIONS.has(region)) return 'ar-MA';
      // Prefer dialectal Arabic over MSA → Maghrebi Darija default
      return 'ar-MA';
    }

    if (code === 'fr' || tag.startsWith('fr-')) return 'fr';
    if (code === 'en' || tag.startsWith('en-')) return 'en';
    if (code === 'es' || tag.startsWith('es-')) return 'es';
    if (code === 'pt' || tag.startsWith('pt-')) return 'pt';
    if (code === 'sw' || tag.startsWith('sw-')) return 'sw';
    if (code === 'ha' || tag.startsWith('ha-')) return 'ha';
    if (code === 'yo' || tag.startsWith('yo-')) return 'yo';
    if (code === 'zu' || tag.startsWith('zu-')) return 'zu';
    if (code === 'am' || tag.startsWith('am-')) return 'am';
    if (code === 'wo' || tag.startsWith('wo-')) return 'wo';
    if (code === 'ln' || tag.startsWith('ln-')) return 'ln';
    if (code === 'ig' || tag.startsWith('ig-')) return 'ig';
    if (code === 'ff' || code === 'fuf' || code === 'ful' || tag.startsWith('ff-') || tag.startsWith('fuf-') || tag.startsWith('ful-'))
      return 'ff';
    if (code === 'bm' || tag.startsWith('bm-')) return 'bm';
    if (code === 'ak' || code === 'tw' || tag.startsWith('ak-') || tag.startsWith('tw-')) return 'ak';
    if (code === 'mnk' || tag.startsWith('mnk-') || tag === 'man' || tag.startsWith('man-'))
      return 'mnk';
    if (code === 'dyo' || tag.startsWith('dyo-')) return 'dyo';
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
  yo,
  zu,
  am,
  wo,
  ln,
  'ar-EG': arEG,
  ig,
  ff,
  bm,
  ak,
  mnk,
  dyo,
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
