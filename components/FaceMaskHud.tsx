/**
 * Caméra, masque visage actif (A1) : bandeau « visage non détecté » et,
 * pendant le test de faisabilité, les mesures (toucher = changer de
 * synchro direct ↔ exacte, hors enregistrement, pour comparer sur le téléphone).
 */
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Fonts, Radii, Spacing } from '@/constants/theme';
import { useColors } from '@/context/ThemeContext';
import { useI18n } from '@/context/I18nContext';
import { SHOW_FACE_METRICS, faceOutlineLabel, formatFaceStats } from '@/lib/faceEffects';
import type { NiaCameraStats } from '@/modules/nia-camera';

type Props = {
  top: number;
  faceDetected: boolean;
  recording: boolean;
  stats: NiaCameraStats | null;
  onToggleSync: () => void;
  /** Test (jalon 2e) : contours des calques de flou. */
  debugOutline: boolean;
  onToggleOutline: () => void;
};

export function FaceMaskHud({
  top,
  faceDetected,
  recording,
  stats,
  onToggleSync,
  debugOutline,
  onToggleOutline,
}: Props) {
  const colors = useColors();
  const { t } = useI18n();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        wrap: { position: 'absolute', left: Spacing.md, right: 84, alignItems: 'flex-start', gap: 6 },
        banner: {
          backgroundColor: colors.mediaScrimStrong,
          borderRadius: Radii.md,
          paddingHorizontal: 10,
          paddingVertical: 6,
        },
        bannerText: { color: colors.onMedia, fontFamily: Fonts.medium, fontSize: 13 },
        metrics: {
          backgroundColor: colors.mediaScrimStrong,
          borderRadius: Radii.md,
          paddingHorizontal: 8,
          paddingVertical: 6,
        },
        metricsTitle: { color: colors.or, fontFamily: Fonts.bold, fontSize: 11 },
        metricsLine: { color: colors.onMedia, fontFamily: Fonts.regular, fontSize: 11 },
        outlineToggle: {
          backgroundColor: colors.mediaScrimStrong,
          borderRadius: Radii.md,
          paddingHorizontal: 10,
          paddingVertical: 8,
        },
      }),
    [colors],
  );

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { top }]}>
      {!faceDetected ? (
        <View style={styles.banner} accessibilityLiveRegion="polite">
          <Text style={styles.bannerText}>
            {recording ? t('camera.faceLost') : t('camera.faceShowToFilm')}
          </Text>
        </View>
      ) : null}
      {SHOW_FACE_METRICS && stats ? (
        <Pressable onPress={onToggleSync} style={styles.metrics} accessibilityRole="button">
          <Text style={styles.metricsTitle}>{t('camera.faceMetricsTitle')}</Text>
          {formatFaceStats(stats).map((line, i) => (
            <Text key={i} style={styles.metricsLine}>
              {line}
            </Text>
          ))}
        </Pressable>
      ) : null}
      {SHOW_FACE_METRICS && stats ? (
        <Pressable
          onPress={onToggleOutline}
          style={styles.outlineToggle}
          accessibilityRole="switch"
          accessibilityState={{ checked: debugOutline }}
        >
          <Text style={[styles.metricsLine, debugOutline && { color: colors.or }]}>
            {faceOutlineLabel(debugOutline)}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
