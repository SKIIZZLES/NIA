import React from 'react';
import { Image, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Colors, Fonts } from '@/constants/theme';
import { t } from '@/lib/i18n';

type Props = {
  size?: number;
  style?: ViewStyle;
  showTagline?: boolean;
  /** Prefer official PNG logo (default true). Set false for text-only wordmark. */
  useImage?: boolean;
};

/** Official NIA logo (image) with text fallback approximating the mark. */
export function NiaWordmark({
  size = 64,
  style,
  showTagline,
  useImage = true,
}: Props) {
  const tagline = t('brand.tagline');

  if (useImage) {
    return (
      <View style={[styles.wrap, style]}>
        <Image
          source={require('@/assets/brand/nia-logo-official.png')}
          style={{ width: size * 2.2, height: size * 2.2 }}
          resizeMode="contain"
          accessibilityLabel="NIA"
        />
        {showTagline ? <Text style={styles.tagline}>{tagline}</Text> : null}
      </View>
    );
  }

  const iSize = size * 0.85;
  return (
    <View style={[styles.wrap, style]}>
      <View style={styles.row}>
        <Text style={[styles.letter, { fontSize: size, lineHeight: size * 1.1 }]}>N</Text>
        <View style={styles.iWrap}>
          <Text style={[styles.letter, { fontSize: iSize, lineHeight: size * 1.1 }]}>i</Text>
          <View
            style={[
              styles.dot,
              {
                width: size * 0.14,
                height: size * 0.14,
                borderRadius: size * 0.07,
                top: size * 0.08,
              },
            ]}
          />
        </View>
        <Text style={[styles.letter, { fontSize: size, lineHeight: size * 1.1 }]}>A</Text>
      </View>
      {showTagline ? <Text style={styles.tagline}>{tagline}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  letter: {
    color: Colors.sable,
    fontFamily: Fonts.bold,
    letterSpacing: -1,
  },
  iWrap: { position: 'relative' },
  dot: {
    position: 'absolute',
    alignSelf: 'center',
    left: '50%',
    marginLeft: -4,
    backgroundColor: Colors.or,
  },
  tagline: {
    marginTop: 12,
    color: Colors.textSecondary,
    fontFamily: Fonts.medium,
    fontSize: 10,
    letterSpacing: 1.6,
    textAlign: 'center',
  },
});
