import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import { Colors, Fonts, Radii } from '@/constants/theme';

type Props = {
  following: boolean;
  onPress: () => void;
  loading?: boolean;
  compact?: boolean;
  disabled?: boolean;
};

/** Suivre / Abonné — Afro-Tech Premium */
export function FollowButton({
  following,
  onPress,
  loading,
  compact,
  disabled,
}: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={following ? 'Abonné' : 'Suivre'}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        compact && styles.compact,
        following ? styles.following : styles.follow,
        (disabled || loading) && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={following ? Colors.sable : Colors.noir} />
      ) : (
        <Text style={[styles.label, following ? styles.labelFollowing : styles.labelFollow]}>
          {following ? 'Abonné' : 'Suivre'}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minWidth: 88,
    height: 32,
    paddingHorizontal: 14,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compact: {
    minWidth: 72,
    height: 28,
    paddingHorizontal: 10,
  },
  follow: {
    backgroundColor: Colors.or,
  },
  following: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: Colors.sable,
  },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.85 },
  label: {
    fontFamily: Fonts.bold,
    fontSize: 12,
  },
  labelFollow: { color: Colors.noir },
  labelFollowing: { color: Colors.sable },
});
