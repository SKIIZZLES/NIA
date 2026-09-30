/**
 * Éditeur V1 (Montage) — aperçu de la timeline à l'étape 2 (habillage) :
 * clips enchaînés, filtre, calques et son, toucher pour mettre en pause.
 * Pendant de FilteredMediaPreview pour un montage.
 */
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useIsFocused } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { OverlayLayer } from '@/components/OverlayLayer';
import { TimelinePlayer } from '@/components/TimelinePlayer';
import { useI18n } from '@/context/I18nContext';
import { useColors } from '@/context/ThemeContext';
import { getFilterOverlayStyle, type FilterDefinition } from '@/constants/filters';
import type { OverlayDoc } from '@/lib/overlays';
import type { Timeline } from '@/lib/timeline';
import { createTimelineClock, useClockMs, type TimelineClock } from '@/lib/timelineClock';

type Props = {
  clips: Timeline;
  filter: FilterDefinition | null;
  overlays: OverlayDoc | null;
  originalVolume: number;
  sound: { url: string; offsetMs: number; volume: number } | null;
  style?: StyleProp<ViewStyle>;
};

function ClockOverlays({ doc, clock }: { doc: OverlayDoc | null; clock: TimelineClock }) {
  const ms = useClockMs(clock, 80);
  return <OverlayLayer doc={doc} timeMs={ms ?? 0} />;
}

export function TimelinePreview({ clips, filter, overlays, originalVolume, sound, style }: Props) {
  const colors = useColors();
  const { t } = useI18n();
  const isFocused = useIsFocused();
  const [userPaused, setUserPaused] = useState(false);
  const clock = useMemo(() => createTimelineClock(), []);
  const tint = useMemo(() => getFilterOverlayStyle(filter), [filter]);
  const fixedCanvas = clips.length > 1 || clips.some((c) => c.kind === 'image');

  return (
    <View style={[styles.wrap, { backgroundColor: colors.noir }, style]}>
      <TimelinePlayer
        clips={clips}
        clock={clock}
        playing={isFocused && !userPaused}
        originalVolume={originalVolume}
        sound={sound}
        fixedCanvas={fixedCanvas}
      />
      {tint ? (
        <View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: tint.backgroundColor, opacity: tint.opacity }]}
        />
      ) : null}
      <ClockOverlays doc={overlays} clock={clock} />
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={() => setUserPaused((p) => !p)}
        accessibilityRole="button"
        accessibilityLabel={userPaused ? t('feed.play') : t('feed.pause')}
      >
        {userPaused ? (
          <View style={styles.playBadge} pointerEvents="none">
            <View style={[styles.playCircle, { backgroundColor: colors.mediaScrim }]}>
              <Ionicons name="play" size={30} color={colors.onMedia} style={{ marginLeft: 3 }} />
            </View>
          </View>
        ) : null}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: 'hidden', width: '100%', height: '100%' },
  playBadge: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  playCircle: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center' },
});
