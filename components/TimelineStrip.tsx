/**
 * Éditeur V1 (Montage) — bande des clips.
 *
 * Une vignette par clip, large en proportion de sa durée (bornée), dans
 * l'ordre de la timeline :
 * - toucher : sélectionne le clip et y place la lecture ;
 * - appui long puis glisser : déplace le clip (repère d'insertion pendant le
 *   geste) ; actions d'accessibilité « vers la gauche / la droite » ;
 * - « + » en bout de bande : ajoute des vidéos ou des photos.
 *
 * Gestes : Pressable + PanResponder de React Native (pas de dépendance). Le
 * PanResponder de la bande ne prend la main qu'après l'appui long, et le
 * défilement est coupé pendant le déplacement.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Image,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/context/ThemeContext';
import { useI18n } from '@/context/I18nContext';
import { Fonts, MediaTextShadow, Radii } from '@/constants/theme';
import { deleteCachedFile } from '@/lib/upload';
import { videoFrameAt } from '@/lib/videoTrim';
import {
  clipDurationMs,
  clipStartsMs,
  dropIndexFor,
  type Timeline,
  type TimelineClip,
} from '@/lib/timeline';
import { useClockMs, type TimelineClock } from '@/lib/timelineClock';

const TILE_H = 64;
const GAP = 4;
const PX_PER_SEC = 22;
const MIN_TILE_W = 48;
const MAX_TILE_W = 160;

export function tileWidth(clip: TimelineClip): number {
  const w = (clipDurationMs(clip) / 1000) * PX_PER_SEC;
  return Math.round(Math.max(MIN_TILE_W, Math.min(MAX_TILE_W, w)));
}

/** Vignette d'un clip : image du fichier au début de l'extrait, ou la photo. */
function useClipThumb(clip: TimelineClip): string | null {
  const [uri, setUri] = useState<string | null>(clip.kind === 'image' ? clip.uri : null);
  useEffect(() => {
    if (clip.kind === 'image') {
      setUri(clip.uri);
      return;
    }
    let alive = true;
    let made: string | null = null;
    void videoFrameAt(clip.uri, clip.startMs, 160).then((f) => {
      if (!alive) {
        if (f) deleteCachedFile(f);
        return;
      }
      made = f;
      setUri(f);
    });
    return () => {
      alive = false;
      if (made) deleteCachedFile(made);
    };
  }, [clip.kind, clip.uri, clip.startMs]);
  return uri;
}

type TileProps = {
  clip: TimelineClip;
  index: number;
  count: number;
  width: number;
  selected: boolean;
  dragging: boolean;
  dragX: Animated.Value;
  onPress: () => void;
  onLongPress: () => void;
  onPressOut: () => void;
  onMove: (to: number) => void;
};

function ClipTile({
  clip,
  index,
  count,
  width,
  selected,
  dragging,
  dragX,
  onPress,
  onLongPress,
  onPressOut,
  onMove,
}: TileProps) {
  const colors = useColors();
  const { t } = useI18n();
  const thumb = useClipThumb(clip);
  const seconds = String(Math.round(clipDurationMs(clip) / 100) / 10);
  return (
    <Animated.View
      style={[
        { width, height: TILE_H },
        dragging && { transform: [{ translateX: dragX }, { scale: 1.06 }], zIndex: 2, elevation: 6 },
      ]}
    >
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        onPressOut={onPressOut}
        delayLongPress={280}
        style={[
          styles.tile,
          {
            borderColor: selected || dragging ? colors.onMediaAccent : colors.mediaScrimStrong,
            backgroundColor: colors.noirSoft,
          },
        ]}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={t('timeline.clipA11y', {
          index: String(index + 1),
          count: String(count),
          seconds,
        })}
        accessibilityHint={t('timeline.dragHint')}
        accessibilityActions={[
          ...(index > 0 ? [{ name: 'moveLeft', label: t('timeline.moveLeft') }] : []),
          ...(index < count - 1 ? [{ name: 'moveRight', label: t('timeline.moveRight') }] : []),
        ]}
        onAccessibilityAction={(e) => {
          if (e.nativeEvent.actionName === 'moveLeft') onMove(index - 1);
          if (e.nativeEvent.actionName === 'moveRight') onMove(index + 1);
        }}
      >
        {thumb ? <Image source={{ uri: thumb }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
        <View style={[styles.badge, { backgroundColor: colors.mediaScrimStrong }]}>
          {clip.kind === 'image' ? (
            <Ionicons name="image-outline" size={10} color={colors.onMedia} />
          ) : clip.speed !== 1 ? (
            <Text style={[styles.badgeText, { color: colors.onMediaAccent }]}>{`${clip.speed}x`}</Text>
          ) : null}
          <Text style={[styles.badgeText, { color: colors.onMedia }]}>{`${seconds} s`}</Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

type Props = {
  clips: Timeline;
  clock: TimelineClock;
  selectedId: string | null;
  onSelect: (clip: TimelineClip, index: number) => void;
  onMove: (from: number, to: number) => void;
  onAdd: () => void;
  canAdd: boolean;
  /** Pendant un déplacement (lecture suspendue par l'écran). */
  onDragChange?: (dragging: boolean) => void;
};

export function TimelineStrip({ clips, clock, selectedId, onSelect, onMove, onAdd, canAdd, onDragChange }: Props) {
  const colors = useColors();
  const { t } = useI18n();
  const widths = useMemo(() => clips.map(tileWidth), [clips]);
  const lefts = useMemo(() => {
    const out: number[] = [];
    let acc = 0;
    for (const w of widths) {
      out.push(acc);
      acc += w + GAP;
    }
    return out;
  }, [widths]);
  const starts = useMemo(() => clipStartsMs(clips), [clips]);
  const nowMs = useClockMs(clock, 80) ?? 0;

  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const dragX = useRef(new Animated.Value(0)).current;
  const live = useRef({ dragIndex, widths, onMove, onDragChange });
  live.current = { dragIndex, widths, onMove, onDragChange };
  /** La bande a pris le geste (le doigt a bougé après l'appui long). */
  const grantedRef = useRef(false);

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponderCapture: () => live.current.dragIndex != null,
        onMoveShouldSetPanResponderCapture: () => live.current.dragIndex != null,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          grantedRef.current = true;
        },
        onPanResponderMove: (_, g) => {
          const from = live.current.dragIndex;
          if (from == null) return;
          dragX.setValue(g.dx);
          setDropIndex(dropIndexFor(live.current.widths, from, g.dx, GAP));
        },
        onPanResponderRelease: (_, g) => {
          const from = live.current.dragIndex;
          if (from != null) {
            const to = dropIndexFor(live.current.widths, from, g.dx, GAP);
            if (to !== from) live.current.onMove(from, to);
          }
          endDrag();
        },
        onPanResponderTerminate: () => endDrag(),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  function endDrag() {
    grantedRef.current = false;
    dragX.setValue(0);
    setDragIndex(null);
    setDropIndex(null);
    live.current.onDragChange?.(false);
  }

  const startDrag = (i: number) => {
    grantedRef.current = false;
    live.current.dragIndex = i;
    dragX.setValue(0);
    setDragIndex(i);
    setDropIndex(i);
    onDragChange?.(true);
  };

  const cur = useMemo(() => {
    for (let i = clips.length - 1; i >= 0; i--) if (nowMs >= starts[i]) return i;
    return 0;
  }, [nowMs, starts, clips.length]);
  const curClip = clips[cur];
  const curDur = curClip ? clipDurationMs(curClip) : 0;
  const playheadX =
    curClip && curDur > 0
      ? lefts[cur] + Math.min(1, Math.max(0, (nowMs - starts[cur]) / curDur)) * widths[cur]
      : 0;

  // Repère d'insertion : avant la vignette cible (après, en fin de liste).
  let markerX: number | null = null;
  if (dragIndex != null && dropIndex != null && dropIndex !== dragIndex) {
    markerX = dropIndex > dragIndex ? lefts[dropIndex] + widths[dropIndex] + GAP / 2 : lefts[dropIndex] - GAP / 2;
  }

  return (
    <View {...responder.panHandlers}>
      <ScrollView
        horizontal
        scrollEnabled={dragIndex == null}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.track}>
          {clips.map((clip, i) => (
            <ClipTile
              key={clip.id}
              clip={clip}
              index={i}
              count={clips.length}
              width={widths[i]}
              selected={clip.id === selectedId}
              dragging={dragIndex === i}
              dragX={dragX}
              onPress={() => {
                if (dragIndex != null) return;
                onSelect(clip, i);
              }}
              onLongPress={() => startDrag(i)}
              onPressOut={() => {
                // Doigt levé sans avoir bougé après l'appui long : fin du
                // geste. (Quand la bande prend la main, elle est déjà servie.)
                setTimeout(() => {
                  if (live.current.dragIndex != null && !grantedRef.current) endDrag();
                }, 0);
              }}
              onMove={(to) => onMove(i, Math.max(0, Math.min(clips.length - 1, to)))}
            />
          ))}
          {dragIndex == null ? (
            <View
              pointerEvents="none"
              style={[styles.playhead, { left: playheadX - 1, backgroundColor: colors.onMedia }]}
            />
          ) : null}
          {markerX != null ? (
            <View
              pointerEvents="none"
              style={[styles.marker, { left: markerX - 2, backgroundColor: colors.onMediaAccent }]}
            />
          ) : null}
        </View>
        <Pressable
          onPress={onAdd}
          disabled={!canAdd}
          style={[
            styles.add,
            { borderColor: canAdd ? colors.onMediaAccent : colors.onMediaDisabled, backgroundColor: colors.mediaScrim },
          ]}
          accessibilityRole="button"
          accessibilityLabel={t('timeline.addA11y')}
          accessibilityState={{ disabled: !canAdd }}
        >
          <Ionicons name="add" size={26} color={canAdd ? colors.onMediaAccent : colors.onMediaDisabled} />
          <Text style={[styles.addText, { color: canAdd ? colors.onMedia : colors.onMediaDisabled }]}>
            {t('timeline.add')}
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: 'center', paddingVertical: 6, paddingHorizontal: 2, gap: GAP * 2 },
  track: { flexDirection: 'row', gap: GAP, height: TILE_H },
  tile: {
    flex: 1,
    borderRadius: Radii.sm,
    borderWidth: 2,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    alignSelf: 'flex-start',
    margin: 3,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 6,
  },
  badgeText: { fontFamily: Fonts.bold, fontSize: 10, ...MediaTextShadow },
  playhead: { position: 'absolute', top: -4, bottom: -4, width: 2, borderRadius: 1 },
  marker: { position: 'absolute', top: -6, bottom: -6, width: 4, borderRadius: 2 },
  add: {
    width: 64,
    height: TILE_H,
    borderRadius: Radii.sm,
    borderWidth: 1,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addText: { fontFamily: Fonts.medium, fontSize: 11 },
});
