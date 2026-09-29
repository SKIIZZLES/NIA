/**
 * Calques texte / stickers en lecture seule (sprint S4), posés sur un média
 * affiché en `cover`. Utilisé par l'aperçu et par VideoCard (fil, /video/[id],
 * séries et page son y mènent, posts photo compris).
 *
 * Le repère est le cadre du média (coverFrameRect), pas le conteneur : un
 * calque garde la même place sur la vidéo quelle que soit la taille d'écran.
 */
import React, { useEffect, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import type { VideoPlayer } from 'expo-video';
import { OverlayItemView } from '@/components/OverlayItemView';
import { coverFrameRect, isOverlayVisible, type OverlayDoc } from '@/lib/overlays';

type Props = {
  doc: OverlayDoc | null | undefined;
  /** Instant de la vidéo (ms). null = tout afficher (photo). */
  timeMs?: number | null;
  /** À défaut de timeMs : suit ce lecteur (instant − originMs). */
  player?: VideoPlayer | null;
  originMs?: number;
};

export function usePlayerTimeMs(player: VideoPlayer | null | undefined, originMs = 0): number | null {
  const [ms, setMs] = useState<number | null>(player ? 0 : null);
  useEffect(() => {
    if (!player) {
      setMs(null);
      return;
    }
    const sub = player.addListener('timeUpdate', ({ currentTime }) => {
      setMs(Math.max(0, currentTime * 1000 - originMs));
    });
    return () => sub.remove();
  }, [player, originMs]);
  return ms;
}

export function OverlayLayer({ doc, timeMs, player, originMs = 0 }: Props) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const hasItems = !!doc && doc.items.length > 0;
  const playerMs = usePlayerTimeMs(hasItems && timeMs === undefined ? player : null, originMs);
  if (!hasItems) return null;
  const now = timeMs !== undefined ? timeMs : player ? playerMs : null;
  const frame = coverFrameRect(size.w, size.h, doc.aspect);
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize((cur) => (cur.w === width && cur.h === height ? cur : { w: width, h: height }));
  };
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" onLayout={onLayout}>
      {doc.items
        .filter((o) => isOverlayVisible(o, now))
        .map((o) => (
          <OverlayItemView key={o.id} overlay={o} frame={frame} />
        ))}
    </View>
  );
}
