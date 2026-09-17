import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  ViewStyle,
} from 'react-native';
import { Colors, Fonts, Radii } from '@/constants/theme';

type Variant = 'filled' | 'outline' | 'gold' | 'ghost';

type Props = {
  title: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
};

export function Button({
  title,
  onPress,
  variant = 'filled',
  disabled,
  loading,
  style,
}: Props) {
  const isFilled = variant === 'filled';
  const isGold = variant === 'gold';
  const isOutline = variant === 'outline';

  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        isFilled && styles.filled,
        isGold && styles.gold,
        isOutline && styles.outline,
        variant === 'ghost' && styles.ghost,
        (disabled || loading) && styles.disabled,
        pressed && styles.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={isFilled || isGold ? Colors.noir : Colors.sable} />
      ) : (
        <Text
          style={[
            styles.label,
            (isFilled || isGold) && styles.labelDark,
            (isOutline || variant === 'ghost') && styles.labelLight,
          ]}
        >
          {title}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    height: 52,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  filled: { backgroundColor: Colors.sable },
  gold: { backgroundColor: Colors.or },
  outline: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: Colors.sable,
  },
  ghost: { backgroundColor: 'transparent' },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.85 },
  label: {
    fontFamily: Fonts.bold,
    fontSize: 16,
  },
  labelDark: { color: Colors.noir },
  labelLight: { color: Colors.sable },
});
