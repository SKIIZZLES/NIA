import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Colors, Fonts } from '@/constants/theme';

type Props = {
  size?: number;
  style?: ViewStyle;
  showTagline?: boolean;
};

/** Wordmark texte approximant le logo NIA (i doré) */
export function NiaWordmark({ size = 64, style, showTagline }: Props) {
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
      {showTagline ? (
        <Text style={styles.tagline}>VIDÉOS · CULTURES · TALENTS · SANS FRONTIÈRES</Text>
      ) : null}
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
