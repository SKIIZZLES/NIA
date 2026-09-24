/**
 * Étape 1 — le média.
 *
 * Premier écran du « + » : on choisit quoi publier tout de suite, au lieu de
 * traverser une grille de cartes. Live et Événement restent accessibles en
 * lien secondaire (ils ont aussi leur propre bouton depuis Découvrir).
 */
import React, { useEffect, useMemo, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/Button';
import { CreateStepHeader } from '@/components/CreateStepHeader';
import { FilteredMediaPreview } from '@/components/FilteredMediaPreview';
import { useCreateDraft, type CreateMode } from '@/context/CreateContext';
import { useI18n } from '@/context/I18nContext';
import { useColors } from '@/context/ThemeContext';
import { Fonts, Radii, Spacing } from '@/constants/theme';
import { fetchSoundById } from '@/lib/sounds';

const MODES: { id: CreateMode; icon: React.ComponentProps<typeof Ionicons>['name']; labelKey: string }[] = [
  { id: 'video', icon: 'videocam', labelKey: 'create.hubVideo' },
  { id: 'photo', icon: 'camera', labelKey: 'create.hubPhoto' },
];

export default function CreateMediaStep() {
  const router = useRouter();
  const colors = useColors();
  const { t } = useI18n();
  const params = useLocalSearchParams<{ soundId?: string; mode?: string }>();
  const {
    mode,
    setMode,
    media,
    filter,
    pickMedia,
    captureMedia,
    setSound,
    maxMb,
    maxMinutes,
  } = useCreateDraft();

  // Lien profond depuis la page d'un son : /create?soundId=…&mode=video
  // Chaque valeur de paramètre n'est appliquée qu'une fois : sinon un simple
  // re-rendu rabattrait le mode sur l'URL et effacerait le média choisi.
  const appliedMode = useRef<string | null>(null);
  useEffect(() => {
    const next = params.mode;
    if (next !== 'video' && next !== 'photo') return;
    if (appliedMode.current === next) return;
    appliedMode.current = next;
    setMode(next);
  }, [params.mode, setMode]);

  useEffect(() => {
    const soundId = typeof params.soundId === 'string' ? params.soundId : null;
    if (!soundId) return;
    void (async () => {
      try {
        const s = await fetchSoundById(soundId);
        if (s) setSound(s);
      } catch {
        // son introuvable : le parcours continue sans
      }
    })();
  }, [params.soundId, setSound]);

  const isPhoto = mode === 'photo';

  const styles = useMemo(
    () =>
      StyleSheet.create({
        safe: { flex: 1, backgroundColor: colors.noir },
        scroll: {
          paddingHorizontal: Spacing.lg,
          paddingBottom: Spacing.xxl,
        },
        modeRow: {
          flexDirection: 'row',
          gap: Spacing.sm,
          marginBottom: Spacing.md,
        },
        modeChip: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          paddingVertical: 9,
          paddingHorizontal: Spacing.md,
          borderRadius: Radii.pill,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.noirSoft,
        },
        modeChipOn: {
          borderColor: colors.or,
          backgroundColor: colors.or + '1A',
        },
        modeText: {
          color: colors.textSecondary,
          fontFamily: Fonts.medium,
          fontSize: 14,
        },
        modeTextOn: { color: colors.sable },
        preview: {
          height: 260,
          borderRadius: Radii.lg,
          backgroundColor: colors.noirSoft,
          borderWidth: 1,
          borderColor: colors.border,
          overflow: 'hidden',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: Spacing.md,
        },
        previewHint: {
          color: colors.textMuted,
          fontFamily: Fonts.regular,
          fontSize: 13,
          textAlign: 'center',
          paddingHorizontal: Spacing.lg,
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
        actionRow: { flexDirection: 'row', gap: Spacing.sm },
        action: { flex: 1 },
        hint: {
          color: colors.textMuted,
          fontFamily: Fonts.regular,
          fontSize: 12,
          lineHeight: 17,
          marginTop: Spacing.xs,
        },
        otherLabel: {
          color: colors.textSecondary,
          fontFamily: Fonts.medium,
          fontSize: 12,
          letterSpacing: 0.3,
          marginTop: Spacing.xl,
          marginBottom: Spacing.xs,
        },
        otherRow: { flexDirection: 'row', gap: Spacing.sm },
        otherChip: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          paddingVertical: 9,
          paddingHorizontal: Spacing.md,
          borderRadius: Radii.pill,
          borderWidth: 1,
          borderColor: colors.border,
        },
        otherText: {
          color: colors.textSecondary,
          fontFamily: Fonts.medium,
          fontSize: 13,
        },
      }),
    [colors],
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <CreateStepHeader step={1} title={t('create.stepMediaTitle')} />

        <View style={styles.modeRow}>
          {MODES.map((m) => {
            const on = mode === m.id;
            return (
              <Pressable
                key={m.id}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                onPress={() => setMode(m.id)}
                style={[styles.modeChip, on && styles.modeChipOn]}
              >
                <Ionicons
                  name={m.icon}
                  size={17}
                  color={on ? colors.or : colors.textMuted}
                />
                <Text style={[styles.modeText, on && styles.modeTextOn]}>
                  {t(m.labelKey)}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.preview}>
          {media?.uri ? (
            <>
              <FilteredMediaPreview
                uri={media.uri}
                mediaType={media.type}
                filter={filter}
                style={styles.thumb}
              />
              <View style={styles.badge}>
                <Text style={styles.badgeText}>
                  {media.type === 'video' ? t('create.video') : t('create.image')}
                  {media.durationMs != null
                    ? ` · ${Math.round(media.durationMs / 1000)} s`
                    : ''}
                  {media.fileSize != null
                    ? ` · ${(media.fileSize / (1024 * 1024)).toFixed(1)} Mo`
                    : ''}
                </Text>
              </View>
            </>
          ) : (
            <Text style={styles.previewHint}>{t('create.noMedia')}</Text>
          )}
        </View>

        <View style={styles.actionRow}>
          <View style={styles.action}>
            <Button
              title={isPhoto ? t('create.takePhoto') : t('create.film')}
              variant="gold"
              onPress={() => void captureMedia()}
            />
          </View>
          <View style={styles.action}>
            <Button
              title={isPhoto ? t('create.pickPhoto') : t('create.pickVideo')}
              variant="outline"
              onPress={() => void pickMedia()}
            />
          </View>
        </View>
        <Text style={styles.hint}>
          {isPhoto ? t('create.filmHintPhoto') : t('create.filmHintVideo')}
        </Text>
        <Text style={styles.hint}>
          {t('create.limits', { minutes: maxMinutes, mb: maxMb })}
        </Text>

        <Button
          title={t('create.continue')}
          variant="gold"
          disabled={!media?.uri}
          onPress={() => router.push('/create/preview')}
          style={{ marginTop: Spacing.lg }}
        />

        <Text style={styles.otherLabel}>{t('create.otherFormats')}</Text>
        <View style={styles.otherRow}>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/live/create')}
            style={styles.otherChip}
          >
            <Ionicons name="radio-outline" size={16} color={colors.or} />
            <Text style={styles.otherText}>{t('create.hubLive')}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/events/create')}
            style={styles.otherChip}
          >
            <Ionicons name="calendar-outline" size={16} color={colors.or} />
            <Text style={styles.otherText}>{t('create.hubEvent')}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
