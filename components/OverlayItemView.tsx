/**
 * Un calque (texte ou sticker) placé dans le cadre du média — sprint S4.
 *
 * Même rendu dans l'éditeur, l'aperçu et les lecteurs : positions et tailles
 * sont relatives au cadre (lib/overlays), converties ici en pixels.
 *
 * Éditeur V2 : `OverlayContent` est aussi ce que capture l'incrustation
 * (components/OverlayBakeStage). Toutes ses mesures sont proportionnelles à
 * la largeur du cadre : l'image capturée, remise à l'échelle de la vidéo,
 * tombe exactement sur l'aperçu. La rotation n'est pas dans la capture :
 * Media3 l'applique autour du centre, comme ici.
 */
import React from 'react';
import { StyleSheet, Text, View, type ViewProps } from 'react-native';
import {
  TEXT_MAX_WIDTH_RATIO,
  overlayFontSize,
  overlayPadding,
  textOverlayLook,
  type FrameRect,
  type Overlay,
} from '@/lib/overlays';

type ContentProps = {
  overlay: Overlay;
  /** Largeur du cadre (dp) : toutes les mesures en découlent. */
  frameWidth: number;
};

/** Le calque seul, sans position ni rotation (aperçu et capture). */
export const OverlayContent = React.forwardRef<View, ContentProps>(function OverlayContent(
  { overlay: o, frameWidth },
  ref,
) {
  const fontSize = overlayFontSize(o, frameWidth);
  const pad = overlayPadding(o, fontSize);
  if (o.type === 'sticker') {
    return (
      <View ref={ref} collapsable={false} style={{ padding: pad }}>
        <Text style={{ fontSize, lineHeight: fontSize * 1.2, textAlign: 'center' }}>{o.emoji}</Text>
      </View>
    );
  }
  const look = textOverlayLook(o, fontSize);
  return (
    <View ref={ref} collapsable={false} style={{ padding: pad }}>
      <View
        style={{
          maxWidth: frameWidth * TEXT_MAX_WIDTH_RATIO,
          backgroundColor: look.background ?? undefined,
          paddingHorizontal: look.paddingH,
          paddingVertical: look.paddingV,
          borderRadius: look.borderRadius,
        }}
      >
        <Text
          style={{
            color: look.color,
            fontSize: look.fontSize,
            lineHeight: look.lineHeight,
            fontFamily: look.fontFamily,
            textAlign: look.textAlign,
            ...(look.shadow
              ? {
                  textShadowColor: look.shadow.color,
                  textShadowOffset: { width: look.shadow.dx, height: look.shadow.dy },
                  textShadowRadius: look.shadow.radius,
                }
              : null),
          }}
        >
          {o.text}
        </Text>
      </View>
    </View>
  );
});

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
  const cx = frame.left + o.x * frame.width;
  const cy = frame.top + o.y * frame.height;
  // Boîte d'accueil large, centrée sur le calque : elle ne contraint rien (le
  // retour à la ligne vient de OverlayContent, comme dans la capture).
  const boxW = frame.width * 3;
  const boxH = frame.height;

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
          styles.frame,
          { transform: [{ rotate: `${o.rotation}deg` }] },
          selected ? { borderStyle: 'dashed', borderColor: selectionColor } : null,
        ]}
      >
        <OverlayContent overlay={o} frameWidth={frame.width} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  anchor: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  // Bordure toujours présente (transparente hors sélection) : sélectionner un
  // calque ne déplace rien.
  frame: { borderWidth: 1.5, borderColor: 'transparent', borderRadius: 6 },
});
