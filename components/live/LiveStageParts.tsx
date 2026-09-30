/**
 * Éléments d'interface partagés par les écrans live (hôte, spectateur, web).
 * Aucun import WebRTC ici : utilisable sur toutes les plateformes.
 */
import React from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/Button';
import { useI18n } from '@/context/I18nContext';
import { useColors } from '@/context/ThemeContext';
import { Fonts, Radii, Spacing } from '@/constants/theme';

export function LiveCenterMessage({
  icon = 'radio-outline',
  title,
  body,
  busy,
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  title?: string;
  body?: string;
  busy?: boolean;
  primaryLabel?: string;
  onPrimary?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
}) {
  const colors = useColors();
  return (
    <View style={styles.center} accessibilityLiveRegion="polite">
      {busy ? (
        <ActivityIndicator color={colors.or} size="large" />
      ) : (
        <Ionicons name={icon} size={44} color={colors.or} />
      )}
      {title ? <Text style={[styles.title, { color: colors.onMedia }]}>{title}</Text> : null}
      {body ? <Text style={[styles.body, { color: colors.onMedia }]}>{body}</Text> : null}
      {primaryLabel && onPrimary ? (
        <Button title={primaryLabel} variant="gold" onPress={onPrimary} style={styles.btn} />
      ) : null}
      {secondaryLabel && onSecondary ? (
        <Button title={secondaryLabel} variant="outline" onPress={onSecondary} style={styles.btn} />
      ) : null}
    </View>
  );
}

export function LiveErrorState({
  messageKey,
  onRetry,
  onClose,
}: {
  messageKey: string;
  onRetry?: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <LiveCenterMessage
      icon="alert-circle-outline"
      title={t('live.rtc.errTitle')}
      body={t(messageKey)}
      primaryLabel={onRetry ? t('live.rtc.retry') : undefined}
      onPrimary={onRetry}
      secondaryLabel={t('live.rtc.leave')}
      onSecondary={onClose}
    />
  );
}

export function OnAirBadge({ label }: { label: string }) {
  return (
    <View style={styles.onAir} accessibilityRole="text">
      <View style={styles.onAirDot} />
      <Text style={styles.onAirText}>{label}</Text>
    </View>
  );
}

export function RoundIconButton({
  icon,
  label,
  onPress,
  active,
  disabled,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, selected: !!active }}
      hitSlop={6}
      style={({ pressed }) => [
        styles.round,
        { borderColor: colors.border },
        active && { backgroundColor: colors.or, borderColor: colors.or },
        (pressed || disabled) && { opacity: 0.6 },
      ]}
    >
      <Ionicons name={icon} size={24} color={active ? colors.onAccent : colors.onMedia} />
    </Pressable>
  );
}

/** Pastille « œil + nombre » (spectateurs en ce moment). */
export function ViewerPill({ count, label }: { count: number; label: string }) {
  const colors = useColors();
  return (
    <View style={styles.viewerPill} accessibilityLabel={label} accessibilityRole="text">
      <Ionicons name="eye-outline" size={14} color={colors.onMedia} />
      <Text style={[styles.viewerText, { color: colors.onMedia }]}>{count}</Text>
    </View>
  );
}

/** Feuille du bas (audience, réglages) sur fond sombre translucide. */
export function LiveBottomSheet({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose} accessibilityLabel={t('common.close')} />
      <View
        style={[
          styles.sheet,
          { backgroundColor: colors.noirElevated, borderColor: colors.border, paddingBottom: insets.bottom + Spacing.md },
        ]}
      >
        <View style={[styles.sheetHandle, { backgroundColor: colors.border }]} />
        <Text style={[styles.sheetTitle, { color: colors.sable }]}>{title}</Text>
        {children}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  viewerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Radii.pill,
    backgroundColor: 'rgba(11, 11, 11, 0.55)',
  },
  viewerText: { fontFamily: Fonts.bold, fontSize: 12 },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(11, 11, 11, 0.45)' },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    gap: Spacing.sm,
  },
  sheetHandle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: Spacing.sm },
  sheetTitle: { fontFamily: Fonts.bold, fontSize: 16, marginBottom: 4 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
    gap: 14,
  },
  title: { fontFamily: Fonts.bold, fontSize: 18, textAlign: 'center' },
  body: { fontFamily: Fonts.regular, fontSize: 14, lineHeight: 20, textAlign: 'center', opacity: 0.85 },
  btn: { alignSelf: 'stretch', marginTop: 4 },
  onAir: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Radii.pill,
    backgroundColor: 'rgba(163, 50, 39, 0.92)',
  },
  onAirDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#F5E6D3' },
  onAirText: { color: '#F5E6D3', fontFamily: Fonts.bold, fontSize: 12, letterSpacing: 1 },
  round: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(11, 11, 11, 0.55)',
  },
});
