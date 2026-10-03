import React from 'react';
import { Image, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Fonts } from '@/constants/theme';
import { useI18n } from '@/context/I18nContext';
import { useColors } from '@/context/ThemeContext';

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
  const { t } = useI18n();
  const colors = useColors();
  const tagline = t('brand.tagline');
  // Couleur du thème actif (sinon crème illisible sur le fond clair d'Apparence « Clair »).
  const taglineColor = colors.textSecondary;

  if (useImage) {
    return (
      <View style={[styles.wrap, style]}>
        <Image
          source={require('@/assets/brand/nia-logo-official.png')}
          style={{
            width: size * 2.2,
            height: size * 2.2,
            borderRadius: size * 0.45,
            backgroundColor: '#090A09',
            borderWidth: colors.isDark ? 0 : 1,
            borderColor: colors.border,
          }}
          resizeMode="contain"
          accessibilityLabel="NIA"
        />
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
