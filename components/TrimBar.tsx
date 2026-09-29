/**
 * Barre de découpe (sprint S3) : bande d'images de la vidéo et deux poignées.
 *
 * Gestes : PanResponder de React Native (aucune dépendance). Les valeurs en
 * cours de geste sont lues dans des refs pour que les poignées restent
 * fluides sans recréer les responders à chaque rendu.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  PanResponder,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { useColors } from '@/context/ThemeContext';
import { Radii } from '@/constants/theme';
import { deleteCachedFile } from '@/lib/upload';
import { MIN_TRIM_MS, clampTrimRange, frameTimes, videoFrameAt } from '@/lib/videoTrim';

const FRAME_COUNT = 8;
const HANDLE_W = 18;
const BAR_H = 56;

type Props = {
  uri: string;
  durationMs: number;
  startMs: number;
  endMs: number;
  /** Durée maximale d'un extrait (plafond de publication). */
  maxRangeMs?: number;
  onChange: (startMs: number, endMs: number) => void;
  /** Début / fin d'un geste : la lecture est suspendue pendant le glissé. */
  onDragStart?: () => void;
  onDragEnd?: (which: 'start' | 'end') => void;
  startLabel: string;
  endLabel: string;
  /**
   * S4 (fenêtre d'affichage d'un calque) : la barre couvre [originMs,
   * originMs + durationMs] du fichier, et l'écart minimal est réglable.
   */
  originMs?: number;
  minRangeMs?: number;
};

export function TrimBar({
  uri,
  durationMs,
  startMs,
  endMs,
  maxRangeMs,
  onChange,
  onDragStart,
  onDragEnd,
  startLabel,
  endLabel,
  originMs = 0,
  minRangeMs = MIN_TRIM_MS,
}: Props) {
  const colors = useColors();
  const [width, setWidth] = useState(0);
  const [frames, setFrames] = useState<(string | null)[]>([]);

  // Bande d'images : extraites une à une (léger pour le décodeur).
  useEffect(() => {
    if (!uri || !(durationMs > 0)) return;
    let alive = true;
    const made: string[] = [];
    setFrames([]);
    void (async () => {
      for (const time of frameTimes(durationMs, FRAME_COUNT)) {
        const f = await videoFrameAt(uri, originMs + time, 120);
        if (!alive) {
          if (f) deleteCachedFile(f);
          return;
        }
        if (f) made.push(f);
        setFrames((prev) => [...prev, f]);
      }
    })();
    return () => {
      alive = false;
      made.forEach((f) => deleteCachedFile(f));
    };
  }, [uri, durationMs, originMs]);

  const live = useRef({ startMs, endMs, width, durationMs, maxRangeMs, minRangeMs });
  live.current = { startMs, endMs, width, durationMs, maxRangeMs, minRangeMs };
  const cbs = useRef({ onChange, onDragStart, onDragEnd });
  cbs.current = { onChange, onDragStart, onDragEnd };

  const makeResponder = (which: 'start' | 'end') => {
    let origin = 0;
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        origin = which === 'start' ? live.current.startMs : live.current.endMs;
        cbs.current.onDragStart?.();
      },
      onPanResponderMove: (_, g) => {
        const {
          width: w,
          durationMs: d,
          startMs: s,
          endMs: e,
          maxRangeMs: max,
          minRangeMs: min,
        } = live.current;
        const track = Math.max(1, w - HANDLE_W * 2);
        const ms = origin + (g.dx / track) * d;
        if (which === 'start') {
          let ns = Math.min(ms, e - min);
          if (max && e - ns > max) ns = e - max;
          const r = clampTrimRange(ns, e, d, min);
          cbs.current.onChange(r.startMs, r.endMs);
        } else {
          let ne = Math.max(ms, s + min);
          if (max && ne - s > max) ne = s + max;
          const r = clampTrimRange(s, ne, d, min);
          cbs.current.onChange(r.startMs, r.endMs);
        }
      },
      onPanResponderRelease: () => cbs.current.onDragEnd?.(which),
      onPanResponderTerminate: () => cbs.current.onDragEnd?.(which),
    });
  };
  // Créés une seule fois : les valeurs courantes passent par `live`.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const startResponder = useMemo(() => makeResponder('start'), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const endResponder = useMemo(() => makeResponder('end'), []);

  const track = Math.max(0, width - HANDLE_W * 2);
  const left = durationMs > 0 ? (startMs / durationMs) * track : 0;
  const right = durationMs > 0 ? (endMs / durationMs) * track + HANDLE_W : track + HANDLE_W;

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  return (
    <View style={styles.wrap} onLayout={onLayout}>
      <View style={[styles.strip, { left: HANDLE_W, right: HANDLE_W, backgroundColor: colors.noirSoft }]}>
        {Array.from({ length: FRAME_COUNT }, (_, i) => {
          const f = frames[i];
          return f ? (
            <Image key={i} source={{ uri: f }} style={styles.frame} resizeMode="cover" />
          ) : (
            <View key={i} style={[styles.frame, { backgroundColor: colors.noirElevated }]} />
          );
        })}
      </View>

      {width > 0 ? (
        <>
          {/* Zones exclues, assombries. */}
          <View
            pointerEvents="none"
            style={[styles.dim, { left: HANDLE_W, width: left, backgroundColor: colors.overlay }]}
          />
          <View
            pointerEvents="none"
            style={[
              styles.dim,
              { left: right, right: HANDLE_W, backgroundColor: colors.overlay },
            ]}
          />
          {/* Cadre de la sélection. */}
          <View
            pointerEvents="none"
            style={[
              styles.frameBox,
              { left: left + HANDLE_W, width: Math.max(0, right - left - HANDLE_W), borderColor: colors.or },
            ]}
          />
          <View
            {...startResponder.panHandlers}
            style={[styles.handle, { left, backgroundColor: colors.or }]}
            accessibilityRole="adjustable"
            accessibilityLabel={startLabel}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 6 }}
          >
            <View style={[styles.grip, { backgroundColor: colors.noir }]} />
          </View>
          <View
            {...endResponder.panHandlers}
            style={[styles.handle, { left: right, backgroundColor: colors.or }]}
            accessibilityRole="adjustable"
            accessibilityLabel={endLabel}
            hitSlop={{ top: 12, bottom: 12, left: 6, right: 12 }}
          >
            <View style={[styles.grip, { backgroundColor: colors.noir }]} />
          </View>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { height: BAR_H, justifyContent: 'center' },
  strip: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    flexDirection: 'row',
    overflow: 'hidden',
    borderRadius: Radii.sm,
  },
  frame: { flex: 1, height: '100%' },
  dim: { position: 'absolute', top: 0, bottom: 0, opacity: 0.7 },
  frameBox: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    borderTopWidth: 3,
    borderBottomWidth: 3,
  },
  handle: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: HANDLE_W,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grip: { width: 3, height: 18, borderRadius: 2 },
});
