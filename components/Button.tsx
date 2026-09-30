import React, { useMemo } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  ViewStyle,
} from 'react-native';
import { Fonts, Radii } from '@/constants/theme';
import { useColors } from '@/context/ThemeContext';

type Variant = 'filled' | 'outline' | 'gold' | 'ghost';

type Props = {
  title: string;
  onPress: () => void;
  /** Appui long (optionnel) — ex. réglage caché de test du bouton Snapchat. */
  onLongPress?: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
};

/**
 * Bouton de marque, aux couleurs du thème d'Apparence.
 *
 * Avant : couleurs statiques de NIA Original — sur Clair, le contour et le
 * libellé sable d'un bouton « outline » disparaissaient sur le fond clair
 * (1.1:1). Désactivé : plus d'opacité globale (qui fondait le libellé dans
 * le fond), mais `textDisabled` / `borderStrong`, lisibles à ≥ 3:1.
 */
export function Button({
  title,
  onPress,
  onLongPress,
  variant = 'filled',
  disabled,
  loading,
  style,
}: Props) {
  const colors = useColors();
  const isFilled = variant === 'filled';
  const isGold = variant === 'gold';
  const isOutline = variant === 'outline';
  const off = !!disabled && !loading;

  const styles = useMemo(
    () =>
      StyleSheet.create({
        base: {
          height: 52,
          borderRadius: Radii.pill,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 24,
        },
        filled: { backgroundColor: colors.sable },
        gold: { backgroundColor: colors.or },
        outline: {
          backgroundColor: 'transparent',
          borderWidth: 1.5,
          borderColor: colors.sable,
        },
        ghost: { backgroundColor: 'transparent' },
        disabledFill: {
          backgroundColor: colors.noirSoft,
          borderWidth: 1.5,
          borderColor: colors.borderStrong,
        },
        disabledOutline: { borderColor: colors.borderStrong },
        loading: { opacity: 0.85 },
        pressed: { opacity: 0.85 },
        label: {
          fontFamily: Fonts.bold,
          fontSize: 16,
        },
        labelDark: { color: colors.noir },
        labelLight: { color: colors.sable },
        labelDisabled: { color: colors.textDisabled },
      }),
    [colors],
  );

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!(disabled || loading), busy: !!loading }}
      disabled={disabled || loading}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={onLongPress ? 1500 : undefined}
      style={({ pressed }) => [
        styles.base,
        isFilled && styles.filled,
        isGold && styles.gold,
        isOutline && styles.outline,
        variant === 'ghost' && styles.ghost,
        off && (isFilled || isGold) && styles.disabledFill,
        off && isOutline && styles.disabledOutline,
        loading && styles.loading,
        pressed && styles.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={isFilled || isGold ? colors.noir : colors.sable} />
      ) : (
        <Text
          style={[
            styles.label,
            (isFilled || isGold) && styles.labelDark,
            (isOutline || variant === 'ghost') && styles.labelLight,
            off && styles.labelDisabled,
          ]}
        >
          {title}
        </Text>
      )}
    </Pressable>
  );
}
