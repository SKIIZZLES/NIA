import React, { memo, useCallback, useMemo, useRef, useState } from 'react';
import {
  PanResponder,
  StyleSheet,
  Text,
  View,
  type View as RNView,
} from 'react-native';
import { Colors, Fonts } from '@/constants/theme';

type Props = {
  /** Elapsed seconds (ignored while scrubbing). */
  currentTime: number;
  /** Total duration in seconds. */
  duration: number;
  /** Seek to absolute time in seconds. */
  onSeek: (seconds: number) => void;
  /** Called when user starts / ends scrubbing. */
  onScrubbingChange?: (scrubbing: boolean) => void;
};

function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const s = Math.floor(seconds);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function VideoProgressBarInner({
  currentTime,
  duration,
  onSeek,
  onScrubbingChange,
}: Props) {
  const trackRef = useRef<RNView>(null);
  const trackWidthRef = useRef(0);
  const trackPageXRef = useRef(0);
  const durationRef = useRef(duration);
  durationRef.current = duration;
  const [scrubRatio, setScrubRatio] = useState<number | null>(null);

  const measureTrack = useCallback((cb?: () => void) => {
    trackRef.current?.measureInWindow((x, _y, w) => {
      trackPageXRef.current = x;
      if (w > 0) trackWidthRef.current = w;
      cb?.();
    });
  }, []);

  const seekFromPageX = useCallback(
    (pageX: number) => {
      const width = trackWidthRef.current;
      const dur = durationRef.current;
      if (width <= 0 || !(dur > 0) || !Number.isFinite(dur)) return;
      const ratio = clamp01((pageX - trackPageXRef.current) / width);
      setScrubRatio(ratio);
      onSeek(ratio * dur);
    },
    [onSeek],
  );

  const endScrub = useCallback(
    (pageX: number) => {
      seekFromPageX(pageX);
      setScrubRatio(null);
      onScrubbingChange?.(false);
    },
    [seekFromPageX, onScrubbingChange],
  );

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponderCapture: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (evt) => {
          onScrubbingChange?.(true);
          const pageX = evt.nativeEvent.pageX;
          measureTrack(() => seekFromPageX(pageX));
        },
        onPanResponderMove: (evt) => {
          seekFromPageX(evt.nativeEvent.pageX);
        },
        onPanResponderRelease: (evt) => {
          endScrub(evt.nativeEvent.pageX);
        },
        onPanResponderTerminate: (evt) => {
          endScrub(evt.nativeEvent.pageX);
        },
      }),
    [measureTrack, seekFromPageX, endScrub, onScrubbingChange],
  );

  const safeDuration = duration > 0 && Number.isFinite(duration) ? duration : 0;
  const displayTime =
    scrubRatio != null && safeDuration > 0
      ? scrubRatio * safeDuration
      : currentTime;
  const ratio =
    scrubRatio != null
      ? scrubRatio
      : safeDuration > 0
        ? clamp01(currentTime / safeDuration)
        : 0;

  return (
    <View style={styles.wrap} accessibilityRole="adjustable">
      <Text
        style={styles.time}
        accessibilityLabel={`${formatClock(displayTime)} / ${formatClock(safeDuration)}`}
      >
        {formatClock(displayTime)} / {formatClock(safeDuration)}
      </Text>
      <View
        ref={trackRef}
        style={styles.hit}
        onLayout={(e) => {
          trackWidthRef.current = e.nativeEvent.layout.width;
          measureTrack();
        }}
        {...panResponder.panHandlers}
      >
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${ratio * 100}%` as `${number}%` }]} />
          <View
            style={[
              styles.thumb,
              { left: `${ratio * 100}%` as `${number}%` },
              scrubRatio != null && styles.thumbActive,
            ]}
          />
        </View>
      </View>
    </View>
  );
}

export const VideoProgressBar = memo(VideoProgressBarInner);

const TRACK_H = 3;
const THUMB = 12;
const HIT_H = 28;

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 6,
    zIndex: 6,
  },
  time: {
    color: Colors.sable,
    fontFamily: Fonts.medium,
    fontSize: 11,
    letterSpacing: 0.2,
    fontVariant: ['tabular-nums'],
    marginBottom: 4,
    textShadowColor: 'rgba(0,0,0,0.55)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  hit: {
    height: HIT_H,
    justifyContent: 'center',
  },
  track: {
    height: TRACK_H,
    borderRadius: TRACK_H / 2,
    backgroundColor: 'rgba(245, 230, 211, 0.28)',
    overflow: 'visible',
  },
  fill: {
    height: TRACK_H,
    borderRadius: TRACK_H / 2,
    backgroundColor: Colors.ocre,
  },
  thumb: {
    position: 'absolute',
    top: (TRACK_H - THUMB) / 2,
    marginLeft: -THUMB / 2,
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: Colors.sable,
    borderWidth: 1.5,
    borderColor: Colors.ocre,
  },
  thumbActive: {
    transform: [{ scale: 1.15 }],
  },
});
