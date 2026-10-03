import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Appearance, type ColorSchemeName } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ORIGINAL_COLORS,
  THEME_STORAGE_KEY,
  restoredThemeId,
  mediaPalette,
  resolveThemeColors,
  type ThemeColors,
  type ThemeId,
} from '@/constants/themes';

type ThemeContextValue = {
  /** User preference (may be `auto`) */
  themeId: ThemeId;
  /** Resolved palette for the current preference + system scheme */
  colors: ThemeColors;
  setTheme: (id: ThemeId) => Promise<void>;
  ready: boolean;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);
const GALLERY_INTRODUCED_KEY = '@nia/gallery-introduced';

function schemeFromAppearance(scheme: ColorSchemeName | null | undefined): 'light' | 'dark' | null {
  if (scheme === 'light' || scheme === 'dark') return scheme;
  return null;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeId, setThemeIdState] = useState<ThemeId>('gallery');
  const [systemScheme, setSystemScheme] = useState<'light' | 'dark' | null>(() =>
    schemeFromAppearance(Appearance.getColorScheme()),
  );
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [stored, introduced] = await Promise.all([
          AsyncStorage.getItem(THEME_STORAGE_KEY),
          AsyncStorage.getItem(GALLERY_INTRODUCED_KEY),
        ]);
        // Introduce the founder-approved identity once; other choices survive.
        // Original remains selectable afterwards, including across restarts.
        const next = restoredThemeId(stored, introduced === '1');
        if (!cancelled) {
          setThemeIdState(next);
          await AsyncStorage.multiSet([[THEME_STORAGE_KEY, next], [GALLERY_INTRODUCED_KEY, '1']]);
        }
      } catch {
        // keep default
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme }) => {
      setSystemScheme(schemeFromAppearance(colorScheme));
    });
    return () => sub.remove();
  }, []);

  const setTheme = useCallback(async (id: ThemeId) => {
    setThemeIdState(id);
    try {
      await AsyncStorage.setItem(THEME_STORAGE_KEY, id);
    } catch {
      // ignore persistence errors
    }
  }, []);

  const colors = useMemo(
    () => resolveThemeColors(themeId, systemScheme),
    [themeId, systemScheme],
  );

  const value = useMemo(
    () => ({
      themeId,
      colors,
      setTheme,
      ready,
    }),
    [themeId, colors, setTheme, ready],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return ctx;
}

/** Convenience: current ThemeColors (falls back to Original outside provider). */
export function useColors(): ThemeColors {
  const ctx = useContext(ThemeContext);
  return ctx?.colors ?? ORIGINAL_COLORS;
}

/**
 * Force une palette pour tout un sous-arbre (`useColors()` la renvoie).
 * Sert à `MediaChrome` et aux écrans encore dessinés avec les couleurs
 * statiques de NIA Original (`Colors`) : leurs composants thémés (`Button`)
 * restent assortis au fond sombre au lieu de suivre Clair.
 */
export function PaletteScope({
  palette,
  children,
}: {
  palette: ThemeColors | ((current: ThemeColors) => ThemeColors);
  children: ReactNode;
}) {
  const ctx = useContext(ThemeContext);
  const current = ctx?.colors ?? ORIGINAL_COLORS;
  const colors = typeof palette === 'function' ? palette(current) : palette;
  const value = useMemo<ThemeContextValue>(
    () =>
      ctx
        ? { ...ctx, colors }
        : { themeId: 'original', colors, setTheme: async () => {}, ready: true },
    [ctx, colors],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/**
 * Écrans posés sur un média plein écran (caméra, éditeur) : tout ce qui est
 * rendu dessous lit la palette média (`mediaPalette`) — un thème sombre garde
 * ses couleurs, Clair bascule sur NIA Original. Évite du texte sombre de
 * Clair sur un voile sombre, ou du sable pâle sur une barre claire.
 */
export function MediaChrome({ children }: { children: ReactNode }) {
  return <PaletteScope palette={mediaPalette}>{children}</PaletteScope>;
}
