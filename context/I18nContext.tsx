import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  APP_LOCALES,
  LOCALE_STORAGE_KEY,
  getI18nLocale,
  isAppLocale,
  resolveDeviceLocale,
  setI18nLocale,
  t as translate,
  type AppLocale,
} from '@/lib/i18n';

type I18nContextValue = {
  locale: AppLocale;
  /** Ready after AsyncStorage hydrate (avoids flash of wrong language). */
  ready: boolean;
  setLocale: (locale: AppLocale) => Promise<void>;
  t: typeof translate;
  locales: readonly AppLocale[];
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<AppLocale>(getI18nLocale);
  const [ready, setReady] = useState(false);
  /** Bump to re-render consumers when locale changes (i18n-js is a singleton). */
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(LOCALE_STORAGE_KEY);
        const next = isAppLocale(stored) ? stored : resolveDeviceLocale();
        setI18nLocale(next);
        if (!cancelled) {
          setLocaleState(next);
          setTick((n) => n + 1);
        }
      } catch {
        const next = resolveDeviceLocale();
        setI18nLocale(next);
        if (!cancelled) setLocaleState(next);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setLocale = useCallback(async (next: AppLocale) => {
    setI18nLocale(next);
    setLocaleState(next);
    setTick((n) => n + 1);
    try {
      await AsyncStorage.setItem(LOCALE_STORAGE_KEY, next);
    } catch {
      // ignore persistence errors
    }
  }, []);

  const t = useCallback(
    (scope: string, options?: Record<string, string | number>) => {
      void tick;
      return translate(scope, options);
    },
    [tick],
  );

  const value = useMemo(
    () => ({
      locale,
      ready,
      setLocale,
      t,
      locales: APP_LOCALES,
    }),
    [locale, ready, setLocale, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error('useI18n must be used within I18nProvider');
  }
  return ctx;
}
