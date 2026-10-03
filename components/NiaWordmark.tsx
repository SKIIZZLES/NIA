import React from 'react';
import { Image, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Fonts } from '@/constants/theme';
import { useI18n } from '@/context/I18nContext';
import { useColors } from '@/context/ThemeContext';

type Props = {
  size?: number;
  style?: ViewStyle;
  showTagline?: boolean;
  /** Prefer the transparent brand wordmark. Set false for the text fallback. */
  useImage?: boolean;
  onMedia?: boolean;
};

/** Transparent wordmark, themed ink and gold dot; app icon remains unchanged. */
export function NiaWordmark({
  size = 64,
  style,
  showTagline,
  useImage = true,
  onMedia = false,
}: Props) {
  const { t } = useI18n();
  const colors = useColors();
  const tagline = t('brand.tagline');
  // Couleur du thème actif (sinon crème illisible sur le fond clair d'Apparence « Clair »).
  const taglineColor = colors.textSecondary;

  if (useImage) {
    return (
      <View style={[styles.wrap, style]}>
        <View style={{ width: size * 2.35, height: size }}>
        <Image
          source={require('@/assets/brand/nia-wordmark-transparent.png')}
          style={{
            width: size * 2.35,
            height: size,
            tintColor: onMedia ? colors.onMedia : colors.textPrimary,
          }}
          resizeMode="contain"
          accessibilityLabel="NIA"
        />
        <View pointerEvents="none" aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
          style={{ position: 'absolute', top: size * 0.005, left: size * 1.02, width: size * 0.25,
            height: size * 0.25, borderRadius: size, backgroundColor: '#D99B3D' }} />
        </View>
        {showTagline ? <Text style={[styles.tagline, { color: taglineColor }]}>{tagline}</Text> : null}
      </View>
    );
  }

  const iSize = size * 0.85;
  return (
    <View style={[styles.wrap, style]}>
      <View style={styles.row}>
        <Text style={[styles.letter, { color: colors.sable, fontSize: size, lineHeight: size * 1.1 }]}>N</Text>
        <View style={styles.iWrap}>
          <Text style={[styles.letter, { color: colors.sable, fontSize: iSize, lineHeight: size * 1.1 }]}>i</Text>
          <View
            style={[
              styles.dot,
              {
                width: size * 0.14,
                height: size * 0.14,
                borderRadius: size * 0.07,
                top: size * 0.08,
                backgroundColor: colors.or,
              },
            ]}
          />
        </View>
        <Text style={[styles.letter, { color: colors.sable, fontSize: size, lineHeight: size * 1.1 }]}>A</Text>
      </View>
      {showTagline ? <Text style={[styles.tagline, { color: taglineColor }]}>{tagline}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  letter: {
    fontFamily: Fonts.bold,
    letterSpacing: -1,
  },
  iWrap: { position: 'relative' },
  dot: {
    position: 'absolute',
    alignSelf: 'center',
    left: '50%',
    marginLeft: -4,
  },
  tagline: {
    marginTop: 12,
    fontFamily: Fonts.medium,
    fontSize: 10,
    letterSpacing: 1.6,
    textAlign: 'center',
  },
});
