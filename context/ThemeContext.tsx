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
  isThemeId,
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

function schemeFromAppearance(scheme: ColorSchemeName | null | undefined): 'light' | 'dark' | null {
  if (scheme === 'light' || scheme === 'dark') return scheme;
  return null;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeId, setThemeIdState] = useState<ThemeId>('original');
  const [systemScheme, setSystemScheme] = useState<'light' | 'dark' | null>(() =>
    schemeFromAppearance(Appearance.getColorScheme()),
  );
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(THEME_STORAGE_KEY);
        if (!cancelled && isThemeId(stored)) {
          setThemeIdState(stored);
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
