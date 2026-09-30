/**
 * Éditeur P0 — écran d'export au premier plan (NiaComposer).
 *
 * Modale plein écran : progression, rappel « garde NIA ouverte », annulation.
 * Le retour Android est absorbé par la modale (onRequestClose) : l'export ne
 * s'arrête que par « Annuler » ou si l'app passe en arrière-plan.
 */
import React, { useMemo } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useI18n } from '@/context/I18nContext';
import { useColors } from '@/context/ThemeContext';
import { Fonts, Radii, Spacing } from '@/constants/theme';

type Props = {
  visible: boolean;
  /** 0 → 1. */
  progress: number;
  title: string;
  onCancel: () => void;
};

export function ComposerProgress({ visible, progress, title, onCancel }: Props) {
  const colors = useColors();
  const { t } = useI18n();
  const pct = Math.round(Math.max(0, Math.min(1, progress)) * 100);
  const styles = useMemo(
    () =>
      StyleSheet.create({
        backdrop: {
          flex: 1,
          backgroundColor: 'rgba(11,11,11,0.92)',
          alignItems: 'center',
          justifyContent: 'center',
          padding: Spacing.xl,
        },
        card: {
          width: '100%',
          maxWidth: 380,
          borderRadius: Radii.lg,
          backgroundColor: colors.noirElevated,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.border,
          padding: Spacing.lg,
          gap: Spacing.md,
        },
        title: { color: colors.sable, fontFamily: Fonts.bold, fontSize: 17 },
        track: {
          height: 8,
          borderRadius: 4,
          backgroundColor: colors.noirSoft,
          overflow: 'hidden',
        },
        fill: { height: '100%', backgroundColor: colors.or },
        row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
        pct: { color: colors.textSecondary, fontFamily: Fonts.medium, fontSize: 13 },
        hint: { color: colors.textSecondary, fontFamily: Fonts.regular, fontSize: 13, lineHeight: 18 },
        cancel: {
          alignSelf: 'center',
          paddingHorizontal: Spacing.lg,
          paddingVertical: Spacing.sm,
          borderRadius: Radii.pill,
          borderWidth: 1,
          borderColor: colors.border,
        },
        cancelText: { color: colors.sable, fontFamily: Fonts.medium, fontSize: 14 },
      }),
    [colors],
  );

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={() => undefined}>
      <View style={styles.backdrop}>
        <View style={styles.card} accessibilityLiveRegion="polite">
          <Text style={styles.title}>{title}</Text>
          <View
            style={styles.track}
            accessibilityRole="progressbar"
            accessibilityValue={{ min: 0, max: 100, now: pct }}
          >
            <View style={[styles.fill, { width: `${pct}%` }]} />
          </View>
          <View style={styles.row}>
            <ActivityIndicator color={colors.or} size="small" />
            <Text style={styles.pct}>{t('composer.progress', { percent: String(pct) })}</Text>
          </View>
          <Text style={styles.hint}>{t('composer.keepOpen')}</Text>
          <Pressable
            onPress={onCancel}
            style={styles.cancel}
            accessibilityRole="button"
            accessibilityLabel={t('composer.cancel')}
          >
            <Text style={styles.cancelText}>{t('composer.cancel')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
