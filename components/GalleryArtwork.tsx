import React from 'react';
import { StyleSheet, View } from 'react-native';
import { type ThemeColors } from '@/constants/themes';

/** Original geometric artwork, decorative only; never painted over user media. */
export function GalleryArtwork({ palette, variant = 0 }: { palette: ThemeColors; variant?: number }) {
  const reverse = variant % 2 === 1;
  return (
    <View style={[styles.canvas, { backgroundColor: palette.noirSoft }]} pointerEvents="none"
      aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={[styles.arch, { backgroundColor: palette.terre, left: reverse ? '46%' : '8%',
        transform: [{ rotate: reverse ? '12deg' : '-9deg' }] }]} />
      <View style={[styles.sun, { backgroundColor: '#D9A441', left: reverse ? '10%' : '65%' }]} />
      <View style={[styles.frame, { borderColor: palette.textPrimary, left: reverse ? '25%' : '43%',
        transform: [{ rotate: reverse ? '-14deg' : '12deg' }], borderRadius: variant % 3 === 0 ? 100 : 0 }]} />
      <View style={[styles.ink, { backgroundColor: palette.vertDeep, left: reverse ? '3%' : '74%' }]} />
      {[0, 1, 2, 3].map((line) => (
        <View key={line} style={[styles.line, { top: 22 + line * 9, borderColor: palette.textPrimary }]} />
      ))}
      <View style={[styles.rule, { backgroundColor: palette.noirElevated }]} />
    </View>
  );
}
const styles = StyleSheet.create({
  canvas: { flex: 1, overflow: 'hidden', minHeight: 70 },
  arch: { position: 'absolute', width: '41%', height: '126%', top: '20%', borderTopLeftRadius: 100, borderTopRightRadius: 100 },
  sun: { position: 'absolute', width: '27%', aspectRatio: 1, borderRadius: 200, top: '-9%' },
  frame: { position: 'absolute', width: '32%', height: '92%', top: '30%', borderWidth: 1 },
  ink: { position: 'absolute', width: '18%', height: '56%', bottom: '-17%', transform: [{ rotate: '32deg' }] },
  line: { position: 'absolute', width: '17%', left: '3%', borderTopWidth: 1, opacity: 0.3 },
  rule: { position: 'absolute', height: 1, width: '92%', left: '4%', bottom: 15, opacity: 0.7 },
});
