/**
 * Étape 2 — l'habillage : filtre, et cover pour une vidéo.
 *
 * L'aperçu occupe la hauteur utile : c'est le seul endroit où l'utilisateur
 * juge l'effet du filtre avant de publier.
 */
import React, { useMemo } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Redirect, useRouter } from 'expo-router';
import { Button } from '@/components/Button';
import { CreateStepHeader } from '@/components/CreateStepHeader';
import { FilterCarousel } from '@/components/FilterCarousel';
import { FilteredMediaPreview } from '@/components/FilteredMediaPreview';
import { useCreateDraft } from '@/context/CreateContext';
import { useI18n } from '@/context/I18nContext';
import { useColors } from '@/context/ThemeContext';
import { Fonts, Radii, Spacing } from '@/constants/theme';

export default function CreateStyleStep() {
  const router = useRouter();
  const colors = useColors();
  const { t } = useI18n();
  const { media, cover, filter, setFilter, pickCover, clearCover } =
    useCreateDraft();

  const styles = useMemo(
    () =>
      StyleSheet.create({
        safe: { flex: 1, backgroundColor: colors.noir },
        scroll: {
          paddingHorizontal: Spacing.lg,
          paddingBottom: Spacing.xxl,
        },
        preview: {
          height: 340,
          borderRadius: Radii.lg,
          backgroundColor: colors.noirSoft,
          borderWidth: 1,
          borderColor: colors.border,
          overflow: 'hidden',
          marginBottom: Spacing.md,
        },
        thumb: { width: '100%', height: '100%' },
        badge: {
          position: 'absolute',
          bottom: 8,
          left: 8,
          backgroundColor: colors.noir + 'CC',
          borderRadius: Radii.pill,
          paddingHorizontal: 10,
          paddingVertical: 4,
        },
        badgeText: {
          color: colors.sable,
          fontFamily: Fonts.medium,
          fontSize: 11,
        },
        label: {
          color: colors.sable,
          fontFamily: Fonts.medium,
          fontSize: 14,
          marginTop: Spacing.md,
        },
        hint: {
          color: colors.textMuted,
          fontFamily: Fonts.regular,
          fontSize: 12,
          lineHeight: 17,
          marginTop: 2,
        },
        coverPreview: {
          width: 96,
          height: 128,
          borderRadius: Radii.md,
          marginTop: Spacing.sm,
          backgroundColor: colors.noirSoft,
        },
        coverRow: {
          flexDirection: 'row',
          gap: Spacing.sm,
          marginTop: Spacing.sm,
        },
        coverBtn: { flex: 1 },
      }),
    [colors],
  );

  // Arrivée directe sur l'étape 2 sans média (lien profond, retour arrière
  // après un reset) : on renvoie à l'étape 1 plutôt que d'afficher du vide.
  if (!media?.uri) {
    return <Redirect href="/create" />;
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <CreateStepHeader step={2} title={t('create.stepStyleTitle')} />

        <View style={styles.preview}>
          <FilteredMediaPreview
            uri={media.uri}
            mediaType={media.type}
            filter={filter}
            style={styles.thumb}
          />
          <View style={styles.badge}>
            <Text style={styles.badgeText}>
              {media.type === 'video' ? t('create.video') : t('create.image')}
              {filter ? ` · ${filter.name}` : ''}
            </Text>
          </View>
        </View>

        <FilterCarousel
          selectedId={filter?.id ?? null}
          onSelect={setFilter}
        />

        {media.type === 'video' ? (
          <View>
            <Text style={styles.label}>{t('create.coverLabel')}</Text>
            <Text style={styles.hint}>{t('create.coverHint')}</Text>
            {cover?.uri ? (
              <Image source={{ uri: cover.uri }} style={styles.coverPreview} />
            ) : null}
            <View style={styles.coverRow}>
              <View style={styles.coverBtn}>
                <Button
                  title={
                    cover?.uri ? t('create.changeCover') : t('create.pickCover')
                  }
                  variant="outline"
                  onPress={() => void pickCover()}
                />
              </View>
              {cover?.uri ? (
                <View style={styles.coverBtn}>
                  <Button
                    title={t('create.clearCover')}
                    variant="outline"
                    onPress={clearCover}
                  />
                </View>
              ) : null}
            </View>
          </View>
        ) : null}

        <Button
          title={t('create.continue')}
          variant="gold"
          onPress={() => router.push('/create/publish')}
          style={{ marginTop: Spacing.xl }}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
