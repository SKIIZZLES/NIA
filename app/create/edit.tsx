/**
 * Édition — sprint S3, entre la capture (ou la galerie) et l'aperçu.
 *
 * Plein écran façon TikTok : le média occupe l'écran, une barre d'outils en
 * bas ouvre un panneau à la fois :
 * - Modifier : découpe réelle du fichier (react-native-media-toolkit) et
 *   vitesse 0,5x / 1x / 1,5x / 2x (lecture seulement, locale jusqu'à S5) ;
 * - Son : choix / import du son, début, volume du son original (S2) ;
 * - Texte : bientôt (S4) ;
 * - Effets : filtres NIA existants.
 *
 * La découpe n'est appliquée qu'au moment de « Suivant », depuis le fichier
 * source (sourceMedia) : revenir ici permet de la changer ou de l'annuler.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Redirect, useIsFocused, useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Ionicons } from '@expo/vector-icons';
import { CameraSoundSheet } from '@/components/CameraSoundSheet';
import { FilterCarousel } from '@/components/FilterCarousel';
import { SoundTrimControl } from '@/components/SoundTrimControl';
import { SyncedSound } from '@/components/SyncedSound';
import { TrimBar } from '@/components/TrimBar';
import { PLAYBACK_SPEEDS, useCreateDraft } from '@/context/CreateContext';
import { useI18n } from '@/context/I18nContext';
import { useColors } from '@/context/ThemeContext';
import { Fonts, Radii, Spacing } from '@/constants/theme';
import { getFilterOverlayStyle } from '@/constants/filters';
import { MAX_VIDEO_DURATION_SEC } from '@/constants/publish';
import { formatSoundTime } from '@/lib/soundSync';
import {
  clampTrimRange,
  isFullRange,
  isTrimAvailable,
  trimVideoFile,
} from '@/lib/videoTrim';

type Tool = 'edit' | 'sound' | 'effects' | null;

export default function CreateEditStep() {
  const router = useRouter();
  const colors = useColors();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const {
    media,
    sourceMedia,
    trimRange,
    applyTrimmedVideo,
    clearTrim,
    playbackSpeed,
    setPlaybackSpeed,
    filter,
    setFilter,
    sound,
    setSound,
    soundOffsetMs,
    setSoundOffsetMs,
    soundVolume,
    originalVolume,
    setOriginalVolume,
  } = useCreateDraft();

  // L'édition travaille toujours sur le fichier source, jamais sur la découpe.
  const source = sourceMedia ?? media;
  const isVideo = source?.type === 'video';

  const [tool, setTool] = useState<Tool>(null);
  const [soundSheetOpen, setSoundSheetOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [durationMs, setDurationMs] = useState<number>(source?.durationMs ?? 0);
  const [range, setRange] = useState<{ startMs: number; endMs: number } | null>(
    trimRange,
  );

  const player = useVideoPlayer(isVideo ? source?.uri ?? null : null, (p) => {
    p.loop = true;
    p.timeUpdateEventInterval = 0.1;
    p.preservesPitch = true;
  });

  // Durée réelle lue sur le fichier (la mesure de la caméra est approximative).
  useEffect(() => {
    if (!isVideo) return;
    const read = () => {
      const d = player.duration;
      if (d > 0 && Number.isFinite(d)) setDurationMs(Math.round(d * 1000));
    };
    read();
    const sub = player.addListener('statusChange', ({ status }) => {
      if (status === 'readyToPlay') read();
    });
    return () => sub.remove();
  }, [isVideo, player]);

  // Sélection par défaut : toute la vidéo, bornée au plafond de publication.
  const maxRangeMs = MAX_VIDEO_DURATION_SEC * 1000;
  useEffect(() => {
    if (!(durationMs > 0)) return;
    setRange((prev) => {
      const base = prev ?? { startMs: 0, endMs: Math.min(durationMs, maxRangeMs) };
      return clampTrimRange(base.startMs, base.endMs, durationMs);
    });
  }, [durationMs, maxRangeMs]);

  const sel = range ?? { startMs: 0, endMs: durationMs };
  const selRef = useRef(sel);
  selRef.current = sel;

  // Lecture : focus, pas de glissé ni de découpe en cours.
  const shouldPlay = isVideo && isFocused && !dragging && !busy;
  useEffect(() => {
    if (!isVideo) return;
    try {
      if (shouldPlay) player.play();
      else player.pause();
    } catch {
      // lecteur libéré
    }
  }, [isVideo, shouldPlay, player]);

  useEffect(() => {
    if (!isVideo) return;
    try {
      player.playbackRate = playbackSpeed;
      const vol = sound ? originalVolume : 1;
      player.volume = Math.max(0, Math.min(1, vol));
      player.muted = vol <= 0;
    } catch {
      // lecteur libéré
    }
  }, [isVideo, player, playbackSpeed, sound, originalVolume]);

  // Boucle sur l'extrait sélectionné.
  useEffect(() => {
    if (!isVideo) return;
    const sub = player.addListener('timeUpdate', ({ currentTime }) => {
      const { startMs, endMs } = selRef.current;
      if (!(endMs > 0)) return;
      const ms = currentTime * 1000;
      if (ms >= endMs - 40 || ms < startMs - 150) {
        player.currentTime = startMs / 1000;
      }
    });
    return () => sub.remove();
  }, [isVideo, player]);

  const onDragEnd = useCallback(
    (which: 'start' | 'end') => {
      setDragging(false);
      const { startMs, endMs } = selRef.current;
      try {
        // Montrer ce qui vient d'être réglé : le début, ou la dernière seconde.
        player.currentTime =
          which === 'start' ? startMs / 1000 : Math.max(startMs, endMs - 1500) / 1000;
      } catch {
        // lecteur libéré
      }
    },
    [player],
  );

  const overlay = useMemo(() => getFilterOverlayStyle(filter), [filter]);

  const next = useCallback(async () => {
    if (busy) return;
    if (!isVideo || !source || !(durationMs > 0)) {
      router.push('/create/preview');
      return;
    }
    const { startMs, endMs } = selRef.current;
    const full = isFullRange(startMs, endMs, durationMs);
    const same =
      trimRange != null &&
      Math.abs(trimRange.startMs - startMs) < 50 &&
      Math.abs(trimRange.endMs - endMs) < 50;

    if (full) {
      if (trimRange) clearTrim();
      router.push('/create/preview');
      return;
    }
    if (same) {
      router.push('/create/preview');
      return;
    }
    if (!isTrimAvailable()) {
      Alert.alert(t('common.error'), t('create.editTrimUnavailable'));
      return;
    }
    setBusy(true);
    try {
      const out = await trimVideoFile(source.uri, startMs, endMs);
      applyTrimmedVideo(out, { startMs, endMs });
      router.push('/create/preview');
    } catch {
      Alert.alert(t('common.error'), t('create.editTrimFailed'));
    } finally {
      setBusy(false);
    }
  }, [busy, isVideo, source, durationMs, trimRange, clearTrim, applyTrimmedVideo, router, t]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        root: { flex: 1, backgroundColor: colors.noir },
        media: { ...StyleSheet.absoluteFill },
        topBar: {
          position: 'absolute',
          left: Spacing.md,
          right: Spacing.md,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        },
        iconBtn: {
          width: 44,
          height: 44,
          borderRadius: 22,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.noir + '99',
        },
        nextBtn: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          paddingHorizontal: 18,
          height: 40,
          borderRadius: Radii.pill,
          backgroundColor: colors.or,
        },
        nextText: { color: colors.noir, fontFamily: Fonts.bold, fontSize: 15 },
        bottom: { position: 'absolute', left: 0, right: 0, bottom: 0 },
        panel: {
          marginHorizontal: Spacing.sm,
          marginBottom: Spacing.sm,
          padding: Spacing.md,
          borderRadius: Radii.lg,
          backgroundColor: colors.noirElevated + 'F2',
          gap: Spacing.sm,
        },
        panelTitle: { color: colors.sable, fontFamily: Fonts.bold, fontSize: 15 },
        meta: { color: colors.textSecondary, fontFamily: Fonts.medium, fontSize: 12 },
        note: { color: colors.textMuted, fontFamily: Fonts.regular, fontSize: 11, lineHeight: 15 },
        chipRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
        chip: {
          borderWidth: 1,
          borderRadius: Radii.pill,
          paddingHorizontal: 14,
          paddingVertical: 6,
        },
        chipText: { fontFamily: Fonts.medium, fontSize: 13 },
        linkText: { color: colors.or, fontFamily: Fonts.medium, fontSize: 13 },
        toolbar: {
          flexDirection: 'row',
          justifyContent: 'space-around',
          paddingTop: Spacing.sm,
          backgroundColor: colors.noir + 'E6',
        },
        tool: { alignItems: 'center', minWidth: 64, paddingVertical: 4 },
        toolLabel: { fontFamily: Fonts.medium, fontSize: 11, marginTop: 4 },
        soon: {
          position: 'absolute',
          top: -6,
          right: 0,
          backgroundColor: colors.noirElevated,
          borderRadius: Radii.pill,
          paddingHorizontal: 6,
          paddingVertical: 1,
        },
        soonText: { color: colors.textMuted, fontFamily: Fonts.medium, fontSize: 9 },
        busyWrap: {
          ...StyleSheet.absoluteFill,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.overlay,
          gap: Spacing.sm,
        },
        busyText: { color: colors.sable, fontFamily: Fonts.medium, fontSize: 14 },
      }),
    [colors],
  );

  if (!source?.uri) {
    return <Redirect href="/create/camera" />;
  }

  const selDuration = Math.max(0, sel.endMs - sel.startMs);

  const tools: {
    id: Exclude<Tool, null> | 'text';
    icon: React.ComponentProps<typeof Ionicons>['name'];
    label: string;
    disabled?: boolean;
    soon?: boolean;
  }[] = [
    { id: 'edit', icon: 'cut-outline', label: t('create.editToolEdit'), disabled: !isVideo },
    { id: 'sound', icon: 'musical-notes-outline', label: t('create.editToolSound') },
    { id: 'text', icon: 'text-outline', label: t('create.editToolText'), disabled: true, soon: true },
    { id: 'effects', icon: 'color-filter-outline', label: t('create.editToolEffects') },
  ];

  return (
    <View style={styles.root}>
      {isVideo ? (
        <VideoView player={player} style={styles.media} contentFit="cover" nativeControls={false} />
      ) : (
        <Image source={{ uri: source.uri }} style={styles.media} resizeMode="cover" />
      )}
      {overlay ? (
        <View
          pointerEvents="none"
          style={[styles.media, { backgroundColor: overlay.backgroundColor, opacity: overlay.opacity }]}
        />
      ) : null}

      {sound?.publicUrl ? (
        <SyncedSound
          url={sound.publicUrl}
          video={isVideo ? player : null}
          active={isFocused && !busy && !dragging}
          offsetMs={soundOffsetMs}
          volume={soundVolume}
          rate={isVideo ? playbackSpeed : 1}
          originSec={isVideo ? sel.startMs / 1000 : 0}
        />
      ) : null}

      <View style={[styles.topBar, { top: insets.top + Spacing.sm }]}>
        <Pressable
          onPress={() => router.back()}
          style={styles.iconBtn}
          accessibilityRole="button"
          accessibilityLabel={t('create.editBack')}
        >
          <Ionicons name="chevron-back" size={24} color={colors.onMedia} />
        </Pressable>
        <Pressable
          onPress={() => void next()}
          disabled={busy}
          style={[styles.nextBtn, busy && { opacity: 0.6 }]}
          accessibilityRole="button"
        >
          <Text style={styles.nextText}>{t('create.editNext')}</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.noir} />
        </Pressable>
      </View>

      <View style={styles.bottom}>
        {tool === 'edit' && isVideo ? (
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>{t('create.editTrimTitle')}</Text>
            {durationMs > 0 ? (
              <TrimBar
                uri={source.uri}
                durationMs={durationMs}
                startMs={sel.startMs}
                endMs={sel.endMs}
                maxRangeMs={maxRangeMs}
                onChange={(s, e) => setRange({ startMs: s, endMs: e })}
                onDragStart={() => setDragging(true)}
                onDragEnd={onDragEnd}
                startLabel={t('create.editTrimStartHandle')}
                endLabel={t('create.editTrimEndHandle')}
              />
            ) : (
              <ActivityIndicator color={colors.or} />
            )}
            <View style={[styles.chipRow, { justifyContent: 'space-between' }]}>
              <Text style={styles.meta}>
                {t('create.editTrimRange', {
                  start: formatSoundTime(sel.startMs),
                  end: formatSoundTime(sel.endMs),
                  duration: String(Math.round(selDuration / 100) / 10),
                })}
              </Text>
              {!isFullRange(sel.startMs, sel.endMs, durationMs) ? (
                <Pressable
                  onPress={() =>
                    setRange(clampTrimRange(0, Math.min(durationMs, maxRangeMs), durationMs))
                  }
                  hitSlop={8}
                  accessibilityRole="button"
                >
                  <Text style={styles.linkText}>{t('create.editTrimReset')}</Text>
                </Pressable>
              ) : null}
            </View>

            <Text style={styles.panelTitle}>{t('create.editSpeed')}</Text>
            <View style={styles.chipRow}>
              {PLAYBACK_SPEEDS.map((sp) => {
                const on = playbackSpeed === sp;
                return (
                  <Pressable
                    key={sp}
                    onPress={() => setPlaybackSpeed(sp)}
                    style={[
                      styles.chip,
                      {
                        borderColor: on ? colors.or : colors.border,
                        backgroundColor: on ? colors.or : 'transparent',
                      },
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                  >
                    <Text style={[styles.chipText, { color: on ? colors.noir : colors.sable }]}>
                      {`${sp}x`}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.note}>{t('create.editSpeedNote')}</Text>
          </View>
        ) : null}

        {tool === 'sound' ? (
          <View style={styles.panel}>
            {sound ? (
              <SoundTrimControl
                sound={sound}
                offsetMs={soundOffsetMs}
                onChangeOffset={setSoundOffsetMs}
                previewable={false}
                originalVolume={isVideo ? originalVolume : undefined}
                onChangeOriginalVolume={isVideo ? setOriginalVolume : undefined}
                showLocalNote
              />
            ) : null}
            <Pressable
              onPress={() => setSoundSheetOpen(true)}
              style={[styles.chip, { borderColor: colors.or, alignSelf: 'flex-start' }]}
              accessibilityRole="button"
            >
              <Text style={[styles.chipText, { color: colors.or }]}>
                {sound ? t('create.editChangeSound') : t('create.editAddSound')}
              </Text>
            </Pressable>
          </View>
        ) : null}

        {tool === 'effects' ? (
          <View style={styles.panel}>
            <FilterCarousel compact selectedId={filter?.id ?? null} onSelect={setFilter} />
          </View>
        ) : null}

        <View style={[styles.toolbar, { paddingBottom: Math.max(insets.bottom, Spacing.md) }]}>
          {tools.map((tl) => {
            const on = tool === tl.id;
            const color = tl.disabled ? colors.textMuted : on ? colors.or : colors.onMedia;
            return (
              <Pressable
                key={tl.id}
                style={[styles.tool, tl.disabled && { opacity: 0.5 }]}
                disabled={tl.disabled && !tl.soon}
                onPress={() => {
                  if (tl.soon) {
                    Alert.alert(tl.label, t('create.editTextSoon'));
                    return;
                  }
                  if (tl.disabled) return;
                  setTool((cur) => (cur === tl.id ? null : (tl.id as Tool)));
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: on, disabled: !!tl.disabled }}
              >
                <View>
                  <Ionicons name={tl.icon} size={24} color={color} />
                  {tl.soon ? (
                    <View style={styles.soon}>
                      <Text style={styles.soonText}>{t('create.editSoon')}</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={[styles.toolLabel, { color }]}>{tl.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {busy ? (
        <View style={styles.busyWrap}>
          <ActivityIndicator color={colors.or} size="large" />
          <Text style={styles.busyText}>{t('create.editTrimming')}</Text>
        </View>
      ) : null}

      <CameraSoundSheet
        visible={soundSheetOpen}
        selected={sound}
        onSelect={setSound}
        offsetMs={soundOffsetMs}
        onChangeOffset={setSoundOffsetMs}
        onClose={() => setSoundSheetOpen(false)}
      />
    </View>
  );
}
