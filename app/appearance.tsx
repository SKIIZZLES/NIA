import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Fonts } from '@/constants/theme';
import { THEME_IDS, resolveThemeColors, type ThemeId } from '@/constants/themes';
import { useTheme, useColors } from '@/context/ThemeContext';
import { useI18n } from '@/context/I18nContext';
import { GalleryArtwork } from '@/components/GalleryArtwork';
import { NiaWordmark } from '@/components/NiaWordmark';

const THEME_LABEL_KEYS: Record<ThemeId, string> = {
  gallery: 'appearance.gallery', original: 'appearance.original', sable: 'appearance.sable',
  terre: 'appearance.terre', bronze: 'appearance.bronze', nuit: 'appearance.nuit',
  clair: 'appearance.clair', auto: 'appearance.auto',
};
export default function AppearanceScreen() {
  const router = useRouter();
  const { t } = useI18n();
  const { themeId, setTheme } = useTheme();
  const colors = useColors();
  const { width, fontScale } = useWindowDimensions();
  const singleColumn = width < 350 || fontScale > 1.25;
  const styles = useMemo(() => StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.noir },
    top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8 },
    back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    intro: { paddingTop: 14, paddingBottom: 24 },
    eyebrow: { color: colors.or, fontFamily: Fonts.medium, letterSpacing: 3, fontSize: 11, marginBottom: 10 },
    title: { color: colors.textPrimary, fontFamily: Fonts.bold, fontSize: 36, letterSpacing: -1.5, marginBottom: 12 },
    subtitle: { color: colors.textSecondary, fontFamily: Fonts.regular, fontSize: 14, lineHeight: 22, maxWidth: 420 },
    list: { paddingHorizontal: 20, paddingBottom: 48 },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
    card: { width: singleColumn ? '100%' : '47.5%', borderWidth: 2, borderColor: colors.border, borderRadius: 8, overflow: 'hidden' },
    selected: { borderColor: colors.or },
    featured: { width: '100%', marginBottom: 8 },
    art: { height: 108, overflow: 'hidden' },
    featuredArt: { height: 180 },
    info: { padding: 14, gap: 12 },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    swatches: { flexDirection: 'row', gap: 5, alignItems: 'center' },
    swatch: { width: 16, height: 16, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth },
    hint: { fontFamily: Fonts.regular, fontSize: 12, lineHeight: 18 },
  }), [colors, singleColumn]);
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.top}>
        <Pressable onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/profile')}
          style={styles.back} accessibilityRole="button" accessibilityLabel={t('common.back')}>
          <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
        </Pressable>
        <NiaWordmark size={25} />
      </View>
      <ScrollView contentContainerStyle={styles.list}>
        <View style={styles.intro}>
          {/* Repère graphique (numéro d'affiche), décoratif : masqué aux lecteurs d'écran. */}
          <Text
            style={styles.eyebrow}
            aria-hidden
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            NIA / 01
          </Text>
          <Text style={styles.title}>{t('appearance.title')}</Text>
          <Text style={styles.subtitle}>{t('appearance.subtitle')}</Text>
        </View>
        <View style={styles.grid}>
          {THEME_IDS.map((id, index) => {
            const active = id === themeId;
            const palette = resolveThemeColors(id, 'dark');
            const featured = id === 'gallery';
            return (
              <Pressable key={id} onPress={() => void setTheme(id)}
                style={({ pressed }) => [styles.card, featured && styles.featured, active && styles.selected,
                  { backgroundColor: palette.noirElevated }, pressed && { opacity: 0.85 }]}
                accessibilityRole="radio" accessibilityLabel={t(THEME_LABEL_KEYS[id])}
                accessibilityHint={id === 'auto' ? t('appearance.autoHint') : undefined}
                accessibilityState={{ checked: active }} aria-checked={active}>
                <View style={[styles.art, featured && styles.featuredArt, id === 'auto' && { flexDirection: 'row' }]}>
                  <GalleryArtwork palette={palette} variant={index} />
                  {id === 'auto' ? <GalleryArtwork palette={resolveThemeColors('auto', 'light')} variant={1} /> : null}
                </View>
                <View style={styles.info}>
                  <View style={styles.titleRow}>
                    <Text style={{ flex: 1, color: palette.textPrimary, fontFamily: Fonts.bold, fontSize: featured ? 23 : 16 }}>
                      {t(THEME_LABEL_KEYS[id])}
                    </Text>
                    <Ionicons name={active ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={palette.or} />
                  </View>
                  {id === 'auto' ? <Text style={[styles.hint, { color: palette.textSecondary }]}>{t('appearance.autoHint')}</Text> : null}
                  <View style={styles.swatches} aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                    {[palette.noir, palette.terre, '#D9A441', palette.textPrimary].map((color, swatch) => (
                      <View key={swatch} style={[styles.swatch, { backgroundColor: color, borderColor: palette.border }]} />
                    ))}
                  </View>
                </View>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
