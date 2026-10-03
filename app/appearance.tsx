import React, { useMemo } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Fonts, Radii, Spacing } from '@/constants/theme';
import {
  THEME_IDS,
  resolveThemeColors,
  type ThemeId,
  type ThemeColors,
} from '@/constants/themes';
import { useTheme, useColors } from '@/context/ThemeContext';
import { useI18n } from '@/context/I18nContext';

const THEME_LABEL_KEYS: Record<ThemeId, string> = {
  original: 'appearance.original',
  sable: 'appearance.sable',
  terre: 'appearance.terre',
  bronze: 'appearance.bronze',
  nuit: 'appearance.nuit',
  clair: 'appearance.clair',
  auto: 'appearance.auto',
};

/** Decorative miniature only: the containing radio announces the theme name. */
function ThemeMiniature({ palette, compact = false }: { palette: ThemeColors; compact?: boolean }) {
  return (
    <View style={[previewStyles.screen, compact && { width: 32, padding: 4 }, { backgroundColor: palette.noir, borderColor: palette.border }]}>
      <View style={previewStyles.heading}>
        <View style={[previewStyles.wordmark, { backgroundColor: palette.textPrimary }]} />
        <View style={[previewStyles.dot, { backgroundColor: palette.or }]} />
      </View>
      <View style={[previewStyles.card, { backgroundColor: palette.noirSoft }]}>
        <View style={[previewStyles.line, { backgroundColor: palette.textPrimary }]} />
        <View style={[previewStyles.shortLine, { backgroundColor: palette.textSecondary }]} />
      </View>
      <View style={[previewStyles.button, { backgroundColor: palette.or }]}>
        <Ionicons name="add" size={14} color={palette.onAccent} />
      </View>
    </View>
  );
}

const previewStyles = StyleSheet.create({
  screen: { width: 58, height: 78, borderRadius: 10, padding: 7, borderWidth: 1, gap: 6 },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  wordmark: { width: 19, height: 5, borderRadius: 2 },
  dot: { width: 5, height: 5, borderRadius: 3 },
  card: { flex: 1, borderRadius: 5, padding: 5, justifyContent: 'flex-end', gap: 4 },
  line: { width: '85%', height: 3, borderRadius: 2 },
  shortLine: { width: '60%', height: 3, borderRadius: 2 },
  button: { width: 22, height: 16, borderRadius: 5, alignSelf: 'center', alignItems: 'center', justifyContent: 'center' },
});

export default function AppearanceScreen() {
  const router = useRouter();
  const { t } = useI18n();
  const { themeId, setTheme } = useTheme();
  const colors = useColors();

  const styles = useMemo(
    () =>
      StyleSheet.create({
        safe: { flex: 1, backgroundColor: colors.noir },
        topBar: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: Spacing.md,
          paddingVertical: Spacing.sm,
        },
        backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
        topTitle: {
          color: colors.sable,
          fontFamily: Fonts.bold,
          fontSize: 17,
        },
        subtitle: {
          color: colors.textSecondary,
          fontFamily: Fonts.regular,
          fontSize: 13,
          lineHeight: 18,
          paddingHorizontal: Spacing.lg,
          marginBottom: Spacing.md,
        },
        list: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.xxl, gap: 10 },
        row: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 14,
          paddingVertical: 14,
          paddingHorizontal: 14,
          borderRadius: Radii.lg,
          backgroundColor: colors.noirElevated,
          borderWidth: 1.5,
          borderColor: colors.border,
        },
        rowActive: {
          borderColor: colors.or,
        },
        previews: { flexDirection: 'row', gap: 5 },
        meta: { flex: 1 },
        label: {
          color: colors.textPrimary,
          fontFamily: Fonts.medium,
          fontSize: 15,
        },
        hint: {
          marginTop: 2,
          color: colors.textMuted,
          fontFamily: Fonts.regular,
          fontSize: 12,
        },
      }),
    [colors],
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}
          accessibilityRole="button" accessibilityLabel={t('common.back')}>
          <Ionicons name="chevron-back" size={26} color={colors.sable} />
        </Pressable>
        <Text style={styles.topTitle}>{t('appearance.title')}</Text>
        <View style={{ width: 44 }} />
      </View>

      <Text style={styles.subtitle}>{t('appearance.subtitle')}</Text>

      <ScrollView contentContainerStyle={styles.list}>
        {THEME_IDS.map((id) => {
          const active = themeId === id;
          const palette = resolveThemeColors(id, 'dark');
          return (
            <Pressable
              key={id}
              onPress={() => void setTheme(id)}
              style={({ pressed }) => [styles.row, active && styles.rowActive, pressed && { opacity: 0.85 }]}
              accessibilityRole="radio"
              accessibilityLabel={t(THEME_LABEL_KEYS[id])}
              accessibilityHint={id === 'auto' ? t('appearance.autoHint') : undefined}
              accessibilityState={{ checked: active }}
              aria-checked={active}
            >
              <View style={styles.previews} aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                <ThemeMiniature palette={palette} compact={id === 'auto'} />
                {id === 'auto' ? <ThemeMiniature palette={resolveThemeColors('auto', 'light')} compact /> : null}
              </View>
              <View style={styles.meta}>
                <Text style={styles.label}>{t(THEME_LABEL_KEYS[id])}</Text>
                {id === 'auto' ? (
                  <Text style={styles.hint}>{t('appearance.autoHint')}</Text>
                ) : null}
              </View>
              {active ? (
                <Ionicons name="checkmark-circle" size={22} color={colors.or} />
              ) : (
                <Ionicons name="ellipse-outline" size={22} color={colors.textMuted} />
              )}
            </Pressable>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}
