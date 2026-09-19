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
  themePreview,
  type ThemeId,
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
        backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
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
          borderRadius: Radii.md,
          backgroundColor: colors.noirElevated,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.border,
        },
        rowActive: {
          borderColor: colors.or,
          borderWidth: 1.5,
        },
        swatch: {
          width: 40,
          height: 40,
          borderRadius: 20,
          overflow: 'hidden',
          borderWidth: 1,
          borderColor: colors.border,
          flexDirection: 'row',
        },
        swatchHalf: { flex: 1 },
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
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color={colors.sable} />
        </Pressable>
        <Text style={styles.topTitle}>{t('appearance.title')}</Text>
        <View style={{ width: 36 }} />
      </View>

      <Text style={styles.subtitle}>{t('appearance.subtitle')}</Text>

      <ScrollView contentContainerStyle={styles.list}>
        {THEME_IDS.map((id) => {
          const active = themeId === id;
          const preview = themePreview(id);
          return (
            <Pressable
              key={id}
              onPress={() => void setTheme(id)}
              style={[styles.row, active && styles.rowActive]}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
            >
              <View style={styles.swatch}>
                <View style={[styles.swatchHalf, { backgroundColor: preview.bg }]} />
                <View style={[styles.swatchHalf, { backgroundColor: preview.accent }]} />
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
