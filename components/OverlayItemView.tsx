/**
 * Un calque (texte ou sticker) placé dans le cadre du média — sprint S4.
 *
 * Même rendu dans l'éditeur, l'aperçu et les lecteurs : positions et tailles
 * sont relatives au cadre (lib/overlays), converties ici en pixels.
 */
import React from 'react';
import { StyleSheet, Text, View, type ViewProps } from 'react-native';
import {
  OVERLAY_FONTS,
  textOverlayColors,
  type FrameRect,
  type Overlay,
} from '@/lib/overlays';

type Props = {
  overlay: Overlay;
  frame: FrameRect;
  /** Contour pointillé autour du calque sélectionné (éditeur). */
  selected?: boolean;
  selectionColor?: string;
  /** Gestes de l'éditeur, posés sur le calque lui-même. */
  handlers?: ViewProps;
  accessibilityLabel?: string;
};

export function OverlayItemView({
  overlay: o,
  frame,
  selected = false,
  selectionColor = '#F5E6D3',
  handlers,
  accessibilityLabel,
}: Props) {
  if (!(frame.width > 0) || !(frame.height > 0)) return null;
  const fontSize = Math.max(6, o.size * frame.width);
  const cx = frame.left + o.x * frame.width;
  const cy = frame.top + o.y * frame.height;
  // Boîte d'accueil centrée sur le calque : le texte y revient à la ligne à
  // 90 % de la largeur du cadre, comme dans tous les lecteurs.
  const boxW = o.type === 'text' ? frame.width * 0.9 : fontSize * 2.4;
  const boxH = o.type === 'text' ? frame.height : fontSize * 2.4;

  let content: React.ReactNode;
  if (o.type === 'text') {
    const c = textOverlayColors(o);
    content = (
      <View
        style={[
          styles.textBox,
          c.background
            ? {
                backgroundColor: c.background,
                paddingHorizontal: fontSize * 0.35,
                paddingVertical: fontSize * 0.12,
                borderRadius: fontSize * 0.3,
              }
            : null,
        ]}
      >
        <Text
          style={[
            styles.text,
            {
              color: c.text,
              fontSize,
              lineHeight: fontSize * 1.25,
              fontFamily: OVERLAY_FONTS[o.font],
            },
            c.background ? null : styles.shadow,
          ]}
        >
          {o.text}
        </Text>
      </View>
    );
  } else {
    content = <Text style={{ fontSize, lineHeight: fontSize * 1.2 }}>{o.emoji}</Text>;
  }

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.anchor,
        { left: cx - boxW / 2, top: cy - boxH / 2, width: boxW, height: boxH },
      ]}
    >
      <View
        {...handlers}
        accessible={!!accessibilityLabel}
        accessibilityLabel={accessibilityLabel}
        style={[
          { transform: [{ rotate: `${o.rotation}deg` }] },
          selected
            ? { borderWidth: 1.5, borderStyle: 'dashed', borderColor: selectionColor, borderRadius: 6, padding: 3 }
            : { padding: 4.5 },
        ]}
      >
        {content}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  anchor: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  textBox: { maxWidth: '100%' },
  text: { textAlign: 'center' },
  shadow: {
    textShadowColor: 'rgba(11,11,11,0.75)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
});
