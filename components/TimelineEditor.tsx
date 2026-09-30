/**
 * Éditeur V1 (Montage) — l'étape d'édition quand la création est une
 * timeline de clips (Android, export NiaComposer présent).
 *
 * Même écran plein cadre que l'édition à média unique (app/create/edit.tsx),
 * mêmes outils, avec :
 * - Montage : bande des clips (toucher, appui long pour déplacer, « + »),
 *   puis pour le clip choisi : poignées de découpe (ou durée d'une photo),
 *   vitesse 0,3x → 2x, Couper à la tête de lecture, Dupliquer, Supprimer ;
 * - Son : mixage — volume du son original, volume et début de la musique ;
 * - Texte / Stickers : calques en temps de la timeline ;
 * - Effets : filtres NIA.
 *
 * Rien n'est ré-encodé ici : l'aperçu enchaîne les clips (TimelinePlayer) et
 * le fichier publié sort de NiaComposer à la publication.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused, useNavigation, useRouter } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { Ionicons } from '@expo/vector-icons';
import { CameraSoundSheet } from '@/components/CameraSoundSheet';
import { FilterCarousel } from '@/components/FilterCarousel';
import { OverlayEditor } from '@/components/OverlayEditor';
import { SoundTrimControl } from '@/components/SoundTrimControl';
import { StickerPicker } from '@/components/StickerPicker';
import { TextOverlayComposer, type TextStyleValue } from '@/components/TextOverlayComposer';
import { TimelinePlayer, type TimelinePlayerHandle } from '@/components/TimelinePlayer';
import { TimelineStrip } from '@/components/TimelineStrip';
import { TrimBar } from '@/components/TrimBar';
import { useCreateDraft } from '@/context/CreateContext';
import { useI18n } from '@/context/I18nContext';
import { useColors } from '@/context/ThemeContext';
import { Fonts, MediaTextShadow, Radii, Spacing } from '@/constants/theme';
import { getFilterOverlayStyle } from '@/constants/filters';
import { useBlockBackWhile } from '@/hooks/useBlockBackWhile';
import { MAX_COMPOSED_DURATION_MS } from '@/lib/composition';
import { isDraftStorageAvailable } from '@/lib/drafts';
import {
  DEFAULT_STICKER_SIZE,
  DEFAULT_TEXT_SIZE,
  MAX_OVERLAYS,
  MIN_OVERLAY_SPAN_MS,
  makeOverlayId,
  type Overlay,
} from '@/lib/overlays';
import { formatSoundTime } from '@/lib/soundSync';
import {
  CLIP_SPEEDS,
  MAX_TIMELINE_CLIPS,
  MIN_CLIP_MS,
  STILL_DURATIONS_MS,
  clipDurationMs,
  clipStartAt,
  duplicateClip,
  frameSourceAt,
  moveClip,
  removeClip,
  setClipSpeed,
  setStillDuration,
  splitAt,
  timelineDurationMs,
  timelineExceedsMax,
  timelineKey,
  trimClip,
  type TimelineClip,
} from '@/lib/timeline';
import { createTimelineClock, useClockMs, type TimelineClock } from '@/lib/timelineClock';
import { deleteCachedFile } from '@/lib/upload';
import { videoAspect } from '@/lib/videoTrim';

type Tool = 'edit' | 'sound' | 'layers' | 'effects' | null;

/** Volumes proposés au mixage. */
const MIX_LEVELS = [0, 0.25, 0.5, 0.75, 1] as const;

type ClockEditorProps = Omit<React.ComponentProps<typeof OverlayEditor>, 'timeMs'> & {
  clock: TimelineClock;
};

/** Calques suivant l'horloge de la timeline, sans refaire le rendu de l'écran. */
function ClockOverlayEditor({ clock, ...rest }: ClockEditorProps) {
  const timeMs = useClockMs(clock, 50);
  return <OverlayEditor {...rest} timeMs={timeMs} />;
}

function ClockTime({ clock, totalMs, style }: { clock: TimelineClock; totalMs: number; style: object }) {
  const ms = useClockMs(clock, 250) ?? 0;
  return <Text style={style}>{`${formatSoundTime(ms)} / ${formatSoundTime(totalMs)}`}</Text>;
}

export function TimelineEditScreen() {
  const router = useRouter();
  const colors = useColors();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const navigation = useNavigation();
  const draftsAvailable = isDraftStorageAvailable();
  const {
    timeline: clipsOrNull,
    setTimelineClips,
    addTimelineMedia,
    filter,
    setFilter,
    sound,
    setSound,
    soundOffsetMs,
    setSoundOffsetMs,
    soundVolume,
    setSoundVolume,
    originalVolume,
    setOriginalVolume,
    overlays,
    setOverlayAspect,
    addOverlay,
    updateOverlay,
    removeOverlay,
    hasUnsavedChanges,
    saveDraft,
    discardChanges,
    isLeaveGuardReleased,
  } = useCreateDraft();
  const clips = useMemo(() => clipsOrNull ?? [], [clipsOrNull]);

  const clock = useMemo(() => createTimelineClock(), []);
  const playerRef = useRef<TimelinePlayerHandle>(null);
  const [tool, setTool] = useState<Tool>('edit');
  const [selectedClipId, setSelectedClipId] = useState<string | null>(clips[0]?.id ?? null);
  const [userPaused, setUserPaused] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [soundSheetOpen, setSoundSheetOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [composer, setComposer] = useState<{ id: string | null; initial: TextStyleValue | null } | null>(null);
  const [stickerOpen, setStickerOpen] = useState(false);
  const [overlayDragging, setOverlayDragging] = useState(false);
  useBlockBackWhile(savingDraft);

  const totalMs = timelineDurationMs(clips);
  const fixedCanvas = clips.length > 1 || clips.some((c) => c.kind === 'image');
  const selectedIndex = Math.max(0, clips.findIndex((c) => c.id === selectedClipId));
  const selectedClip: TimelineClip | undefined = clips[selectedIndex];
  const selectedOverlay = overlays.items.find((o) => o.id === selectedId) ?? null;

  // Repère des calques : cadre 9:16 de l'export, ou format du clip unique.
  const firstUri = clips[0]?.uri ?? null;
  useEffect(() => {
    if (fixedCanvas) {
      setOverlayAspect(9 / 16);
      return;
    }
    if (!firstUri) return;
    let alive = true;
    void videoAspect(firstUri).then(({ aspect, frameUri }) => {
      if (frameUri) deleteCachedFile(frameUri);
      if (alive && aspect) setOverlayAspect(aspect);
    });
    return () => {
      alive = false;
    };
  }, [fixedCanvas, firstUri, setOverlayAspect]);

  const playing =
    isFocused && !userPaused && !dragging && !savingDraft && !composer && !stickerOpen && !soundSheetOpen;

  const seekTo = useCallback((ms: number) => playerRef.current?.seek(ms), []);

  const next = useCallback(() => {
    if (timelineExceedsMax(clips)) {
      Alert.alert(
        t('composer.tooLongTitle'),
        t('composer.tooLongBody', { minutes: String(MAX_COMPOSED_DURATION_MS / 60_000) }),
      );
      return;
    }
    router.push('/create/preview');
  }, [clips, router, t]);

  // --- Clips -----------------------------------------------------------

  const selectClip = useCallback(
    (clip: TimelineClip, index: number) => {
      setSelectedClipId(clip.id);
      seekTo(clipStartAt(clips, index));
    },
    [clips, seekTo],
  );

  const onSplit = useCallback(() => {
    const { timeline: out, splitIndex } = splitAt(clips, clock.get());
    if (splitIndex == null) {
      if (clips.length >= MAX_TIMELINE_CLIPS) {
        Alert.alert(t('timeline.fullTitle'), t('timeline.fullBody', { count: String(MAX_TIMELINE_CLIPS) }));
      } else {
        Alert.alert(t('timeline.splitRefusedTitle'), t('timeline.splitRefusedBody'));
      }
      return;
    }
    setTimelineClips(out);
    setSelectedClipId(out[splitIndex + 1].id);
  }, [clips, clock, setTimelineClips, t]);

  const onDuplicate = useCallback(() => {
    if (!selectedClip) return;
    const out = duplicateClip(clips, selectedClip.id);
    if (out === clips) {
      Alert.alert(t('timeline.fullTitle'), t('timeline.fullBody', { count: String(MAX_TIMELINE_CLIPS) }));
      return;
    }
    setTimelineClips(out);
    setSelectedClipId(out[selectedIndex + 1].id);
  }, [clips, selectedClip, selectedIndex, setTimelineClips, t]);

  const onDelete = useCallback(() => {
    if (!selectedClip || clips.length <= 1) return;
    const out = removeClip(clips, selectedClip.id);
    setTimelineClips(out);
    const keep = out[Math.min(selectedIndex, out.length - 1)];
    setSelectedClipId(keep?.id ?? null);
  }, [clips, selectedClip, selectedIndex, setTimelineClips]);

  const onMoveClip = useCallback(
    (from: number, to: number) => {
      const out = moveClip(clips, from, to);
      if (out === clips) return;
      setTimelineClips(out);
      setSelectedClipId(out[to]?.id ?? null);
    },
    [clips, setTimelineClips],
  );

  // --- Brouillons (S6), comme l'édition à média unique ---------------------

  const doSaveDraft = useCallback(async (): Promise<boolean> => {
    if (savingDraft) return false;
    setSavingDraft(true);
    try {
      await saveDraft();
      return true;
    } catch {
      Alert.alert(t('common.error'), t('drafts.saveFailed'));
      return false;
    } finally {
      setSavingDraft(false);
    }
  }, [savingDraft, saveDraft, t]);

  const onSaveDraftPress = useCallback(async () => {
    if (await doSaveDraft()) Alert.alert(t('drafts.savedTitle'), t('drafts.savedBody'));
  }, [doSaveDraft, t]);

  usePreventRemove(draftsAvailable && hasUnsavedChanges, ({ data }) => {
    if (isLeaveGuardReleased()) {
      navigation.dispatch(data.action);
      return;
    }
    Alert.alert(
      t('drafts.leaveTitle'),
      t('drafts.leaveBody'),
      [
        { text: t('drafts.leaveCancel'), style: 'cancel' },
        {
          text: t('drafts.leaveDiscard'),
          style: 'destructive',
          onPress: () => {
            discardChanges();
            navigation.dispatch(data.action);
          },
        },
        {
          text: t('drafts.leaveSave'),
          onPress: () => {
            void (async () => {
              if (await doSaveDraft()) navigation.dispatch(data.action);
            })();
          },
        },
      ],
      { cancelable: true },
    );
  });

  // --- Calques (S4), en temps de la timeline -------------------------------

  const limitReached = useCallback(() => {
    Alert.alert(t('create.layersTitle'), t('create.layerLimit', { max: String(MAX_OVERLAYS) }));
  }, [t]);

  const onComposerDone = useCallback(
    (value: TextStyleValue) => {
      const target = composer?.id ?? null;
      setComposer(null);
      if (target) {
        if (!value.text) {
          removeOverlay(target);
          setSelectedId(null);
        } else {
          updateOverlay(target, value);
        }
        return;
      }
      if (!value.text) return;
      const o: Overlay = {
        id: makeOverlayId(),
        type: 'text',
        x: 0.5,
        y: 0.4,
        size: DEFAULT_TEXT_SIZE,
        rotation: 0,
        startMs: 0,
        endMs: null,
        ...value,
      };
      if (!addOverlay(o)) {
        limitReached();
        return;
      }
      setSelectedId(o.id);
      setTool('layers');
    },
    [composer, addOverlay, updateOverlay, removeOverlay, limitReached],
  );

  const onPickSticker = useCallback(
    (emoji: string) => {
      setStickerOpen(false);
      const o: Overlay = {
        id: makeOverlayId(),
        type: 'sticker',
        emoji,
        x: 0.5,
        y: 0.5,
        size: DEFAULT_STICKER_SIZE,
        rotation: 0,
        startMs: 0,
        endMs: null,
      };
      if (!addOverlay(o)) {
        limitReached();
        return;
      }
      setSelectedId(o.id);
      setTool('layers');
    },
    [addOverlay, limitReached],
  );

  const openTextEditor = useCallback(
    (id: string) => {
      const o = overlays.items.find((it) => it.id === id);
      if (!o || o.type !== 'text') return;
      setComposer({ id, initial: { text: o.text, font: o.font, color: o.color, bg: o.bg, align: o.align ?? 'center' } });
    },
    [overlays.items],
  );

  const deleteOverlay = useCallback(
    (id: string) => {
      removeOverlay(id);
      setSelectedId((cur) => (cur === id ? null : cur));
    },
    [removeOverlay],
  );

  const confirmDelete = useCallback(
    (id: string) => {
      Alert.alert(t('create.layerDeleteConfirm'), undefined, [
        { text: t('create.textCancel'), style: 'cancel' },
        { text: t('create.layerDelete'), style: 'destructive', onPress: () => deleteOverlay(id) },
      ]);
    },
    [t, deleteOverlay],
  );

  const overlayLabel = useCallback(
    (o: Overlay) => t('create.layerA11y', { label: o.type === 'text' ? o.text : o.emoji }),
    [t],
  );

  const tint = useMemo(() => getFilterOverlayStyle(filter), [filter]);
  const frameSource = useCallback((ms: number) => frameSourceAt(clips, ms), [clips]);
  const frameKey = useMemo(() => timelineKey(clips), [clips]);

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
          backgroundColor: colors.mediaScrim,
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
        topRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
        draftBtn: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          paddingHorizontal: 14,
          height: 40,
          borderRadius: Radii.pill,
          borderWidth: 1,
          borderColor: colors.onMediaDisabled,
          backgroundColor: colors.mediaScrimStrong,
        },
        draftText: { color: colors.onMedia, fontFamily: Fonts.medium, fontSize: 14 },
        bottom: { position: 'absolute', left: 0, right: 0, bottom: 0 },
        panel: {
          marginHorizontal: Spacing.sm,
          marginBottom: Spacing.sm,
          padding: Spacing.md,
          borderRadius: Radii.lg,
          backgroundColor: colors.noirElevated + 'F2',
          gap: Spacing.sm,
        },
        panelHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
        panelTitle: { color: colors.sable, fontFamily: Fonts.bold, fontSize: 15 },
        meta: { color: colors.textSecondary, fontFamily: Fonts.medium, fontSize: 12 },
        note: { color: colors.textMuted, fontFamily: Fonts.regular, fontSize: 11, lineHeight: 15 },
        chipRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
        chip: { borderWidth: 1, borderRadius: Radii.pill, paddingHorizontal: 14, paddingVertical: 6 },
        smallChip: { borderWidth: 1, borderRadius: Radii.pill, paddingHorizontal: 10, paddingVertical: 5 },
        chipText: { fontFamily: Fonts.medium, fontSize: 13 },
        action: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          borderWidth: 1,
          borderRadius: Radii.pill,
          paddingHorizontal: 12,
          paddingVertical: 6,
        },
        toolbar: {
          flexDirection: 'row',
          justifyContent: 'space-around',
          paddingTop: Spacing.sm,
          backgroundColor: colors.mediaScrimStrong,
        },
        tool: { alignItems: 'center', minWidth: 58, paddingVertical: 4 },
        toolLabel: { fontFamily: Fonts.medium, fontSize: 12, marginTop: 4, ...MediaTextShadow },
        playBadge: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
        playCircle: {
          width: 72,
          height: 72,
          borderRadius: 36,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.mediaScrim,
        },
        layerName: { flex: 1, color: colors.sable, fontFamily: Fonts.bold, fontSize: 15, marginRight: Spacing.sm },
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

  const chip = (on: boolean, label: string, onPress: () => void, key: string | number, small = false) => (
    <Pressable
      key={key}
      onPress={onPress}
      style={[
        small ? styles.smallChip : styles.chip,
        { borderColor: on ? colors.or : colors.border, backgroundColor: on ? colors.or : 'transparent' },
      ]}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
    >
      <Text style={[styles.chipText, { color: on ? colors.noir : colors.sable }]}>{label}</Text>
    </Pressable>
  );

  const action = (
    icon: React.ComponentProps<typeof Ionicons>['name'],
    label: string,
    onPress: () => void,
    opts: { disabled?: boolean; danger?: boolean } = {},
  ) => {
    const color = opts.disabled ? colors.textMuted : opts.danger ? colors.danger : colors.or;
    return (
      <Pressable
        onPress={onPress}
        disabled={opts.disabled}
        style={[styles.action, { borderColor: color }]}
        accessibilityRole="button"
        accessibilityState={{ disabled: !!opts.disabled }}
      >
        <Ionicons name={icon} size={16} color={color} />
        <Text style={[styles.chipText, { color }]}>{label}</Text>
      </Pressable>
    );
  };

  const percent = (v: number) => t('timeline.percent', { value: String(Math.round(v * 100)) });

  const tools: {
    id: 'edit' | 'sound' | 'text' | 'stickers' | 'effects';
    icon: React.ComponentProps<typeof Ionicons>['name'];
    label: string;
  }[] = [
    { id: 'edit', icon: 'film-outline', label: t('timeline.tool') },
    { id: 'sound', icon: 'musical-notes-outline', label: t('create.editToolSound') },
    { id: 'text', icon: 'text-outline', label: t('create.editToolText') },
    { id: 'stickers', icon: 'happy-outline', label: t('create.editToolStickers') },
    { id: 'effects', icon: 'color-filter-outline', label: t('create.editToolEffects') },
  ];
  const onTool = (id: (typeof tools)[number]['id']) => {
    if (id === 'text') {
      setComposer({ id: null, initial: null });
      return;
    }
    if (id === 'stickers') {
      setStickerOpen(true);
      return;
    }
    setTool((cur) => (cur === id ? null : id));
  };
  const layerEndMs = selectedOverlay ? selectedOverlay.endMs ?? totalMs : 0;
  const showChrome = !overlayDragging;

  if (clips.length === 0) return null;

  return (
    <View style={styles.root}>
      <TimelinePlayer
        ref={playerRef}
        clips={clips}
        clock={clock}
        playing={playing}
        originalVolume={originalVolume}
        sound={sound?.publicUrl ? { url: sound.publicUrl, offsetMs: soundOffsetMs, volume: soundVolume } : null}
        fixedCanvas={fixedCanvas}
      />
      {tint ? (
        <View
          pointerEvents="none"
          style={[styles.media, { backgroundColor: tint.backgroundColor, opacity: tint.opacity }]}
        />
      ) : null}

      {/* Toucher le média : désélectionner le calque, sinon lecture / pause. */}
      <Pressable
        style={styles.media}
        onPress={() => {
          if (selectedId || tool === 'layers') {
            setSelectedId(null);
            if (tool === 'layers') setTool(null);
            return;
          }
          setUserPaused((p) => !p);
        }}
        accessibilityRole="button"
        accessibilityLabel={userPaused ? t('feed.play') : t('feed.pause')}
        accessibilityHint={t('timeline.previewHint')}
      />
      {userPaused && !composer ? (
        <View pointerEvents="none" style={styles.playBadge}>
          <View style={styles.playCircle}>
            <Ionicons name="play" size={34} color={colors.onMedia} style={{ marginLeft: 4 }} />
          </View>
        </View>
      ) : null}
      <ClockOverlayEditor
        clock={clock}
        doc={overlays}
        selectedId={selectedId}
        onSelect={(id) => {
          setSelectedId(id);
          if (id) setTool('layers');
        }}
        onEditText={openTextEditor}
        onChange={updateOverlay}
        onDelete={deleteOverlay}
        onLongPress={confirmDelete}
        trashBottom={Math.max(insets.bottom, Spacing.md) + 72}
        trashLabel={t('create.layerTrash')}
        itemLabel={overlayLabel}
        onDraggingChange={setOverlayDragging}
      />

      {showChrome ? (
        <View style={[styles.topBar, { top: insets.top + Spacing.sm }]}>
          <Pressable
            onPress={() => router.back()}
            disabled={savingDraft}
            style={[styles.iconBtn, savingDraft && { opacity: 0.6 }]}
            accessibilityRole="button"
            accessibilityLabel={t('create.editBack')}
          >
            <Ionicons name="chevron-back" size={24} color={colors.onMedia} />
          </Pressable>
          <View style={styles.topRight}>
            {draftsAvailable ? (
              <Pressable
                onPress={() => void onSaveDraftPress()}
                disabled={savingDraft}
                style={[styles.draftBtn, savingDraft && { opacity: 0.6 }]}
                accessibilityRole="button"
                accessibilityLabel={t('drafts.saveA11y')}
              >
                <Ionicons name="bookmark-outline" size={16} color={colors.onMedia} />
                <Text style={styles.draftText}>{t('drafts.save')}</Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={next}
              disabled={savingDraft}
              style={[styles.nextBtn, savingDraft && { opacity: 0.6 }]}
              accessibilityRole="button"
            >
              <Text style={styles.nextText}>{t('create.editNext')}</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.noir} />
            </Pressable>
          </View>
        </View>
      ) : null}

      {showChrome ? (
        <View style={styles.bottom}>
          {tool === 'layers' ? (
            <View style={styles.panel}>
              {selectedOverlay ? (
                <>
                  <View style={styles.panelHead}>
                    <Text style={styles.layerName} numberOfLines={1}>
                      {selectedOverlay.type === 'text' ? selectedOverlay.text : selectedOverlay.emoji}
                    </Text>
                    <Pressable
                      onPress={() => {
                        setSelectedId(null);
                        setTool(null);
                      }}
                      hitSlop={10}
                      accessibilityRole="button"
                      accessibilityLabel={t('create.textDone')}
                    >
                      <Ionicons name="checkmark" size={22} color={colors.or} />
                    </Pressable>
                  </View>
                  {totalMs > 0 ? (
                    <>
                      <TrimBar
                        uri={clips[0].uri}
                        durationMs={totalMs}
                        minRangeMs={MIN_OVERLAY_SPAN_MS}
                        startMs={selectedOverlay.startMs}
                        endMs={layerEndMs}
                        frameSource={frameSource}
                        frameKey={frameKey}
                        onChange={(s, e) =>
                          updateOverlay(selectedOverlay.id, {
                            startMs: s,
                            endMs: e >= totalMs - 50 ? null : e,
                          })
                        }
                        onDragStart={() => setDragging(true)}
                        onDragEnd={(which) => {
                          setDragging(false);
                          seekTo(
                            which === 'start'
                              ? selectedOverlay.startMs
                              : Math.max(selectedOverlay.startMs, layerEndMs - 1000),
                          );
                        }}
                        startLabel={t('create.layerStartHandle')}
                        endLabel={t('create.layerEndHandle')}
                      />
                      <Text style={styles.meta}>
                        {selectedOverlay.startMs <= 0 && selectedOverlay.endMs == null
                          ? t('create.layerShowAlways')
                          : t('create.layerShowRange', {
                              start: formatSoundTime(selectedOverlay.startMs),
                              end: formatSoundTime(layerEndMs),
                            })}
                      </Text>
                    </>
                  ) : null}
                  <View style={styles.chipRow}>
                    {selectedOverlay.type === 'text' ? (
                      <Pressable
                        onPress={() => openTextEditor(selectedOverlay.id)}
                        style={[styles.chip, { borderColor: colors.or }]}
                        accessibilityRole="button"
                      >
                        <Text style={[styles.chipText, { color: colors.or }]}>{t('create.layerEditText')}</Text>
                      </Pressable>
                    ) : null}
                    <Pressable
                      onPress={() => deleteOverlay(selectedOverlay.id)}
                      style={[styles.chip, { borderColor: colors.danger }]}
                      accessibilityRole="button"
                    >
                      <Text style={[styles.chipText, { color: colors.danger }]}>{t('create.layerDelete')}</Text>
                    </Pressable>
                  </View>
                </>
              ) : (
                <Text style={styles.panelTitle}>{t('create.layersTitle')}</Text>
              )}
              <Text style={styles.note}>{t('create.layersHint')}</Text>
            </View>
          ) : null}

          {tool === 'edit' ? (
            <View style={styles.panel}>
              <View style={styles.panelHead}>
                <Text style={styles.panelTitle}>
                  {t('timeline.summary', { count: String(clips.length) })}
                </Text>
                <ClockTime clock={clock} totalMs={totalMs} style={styles.meta} />
              </View>
              <TimelineStrip
                clips={clips}
                clock={clock}
                selectedId={selectedClip?.id ?? null}
                onSelect={selectClip}
                onMove={onMoveClip}
                onAdd={() => void addTimelineMedia()}
                canAdd={clips.length < MAX_TIMELINE_CLIPS}
                onDragChange={setDragging}
              />
              {selectedClip ? (
                <>
                  <Text style={styles.meta}>
                    {t(selectedClip.kind === 'image' ? 'timeline.photoClip' : 'timeline.videoClip', {
                      index: String(selectedIndex + 1),
                      count: String(clips.length),
                      seconds: String(Math.round(clipDurationMs(selectedClip) / 100) / 10),
                    })}
                  </Text>
                  {selectedClip.kind === 'video' ? (
                    <TrimBar
                      key={selectedClip.id}
                      uri={selectedClip.uri}
                      durationMs={selectedClip.sourceDurationMs}
                      startMs={selectedClip.startMs}
                      endMs={selectedClip.endMs}
                      minRangeMs={Math.min(MIN_CLIP_MS, selectedClip.sourceDurationMs)}
                      onChange={(s, e) => setTimelineClips(trimClip(clips, selectedClip.id, s, e))}
                      onDragStart={() => setDragging(true)}
                      onDragEnd={(which) => {
                        setDragging(false);
                        const start = clipStartAt(clips, selectedIndex);
                        const d = clipDurationMs(selectedClip);
                        seekTo(which === 'start' ? start : start + Math.max(0, d - 1000));
                      }}
                      startLabel={t('create.editTrimStartHandle')}
                      endLabel={t('create.editTrimEndHandle')}
                    />
                  ) : (
                    <>
                      <Text style={styles.meta}>{t('timeline.stillDuration')}</Text>
                      <View style={styles.chipRow}>
                        {STILL_DURATIONS_MS.map((ms) =>
                          chip(
                            selectedClip.endMs - selectedClip.startMs === ms,
                            t('timeline.seconds', { value: String(ms / 1000) }),
                            () => setTimelineClips(setStillDuration(clips, selectedClip.id, ms)),
                            ms,
                            true,
                          ),
                        )}
                      </View>
                    </>
                  )}
                  {selectedClip.kind === 'video' ? (
                    <>
                      <Text style={styles.meta}>{t('timeline.speed')}</Text>
                      <View style={styles.chipRow}>
                        {CLIP_SPEEDS.map((sp) =>
                          chip(
                            selectedClip.speed === sp,
                            `${sp}x`,
                            () => setTimelineClips(setClipSpeed(clips, selectedClip.id, sp)),
                            sp,
                            true,
                          ),
                        )}
                      </View>
                    </>
                  ) : null}
                  <View style={styles.chipRow}>
                    {action('cut-outline', t('timeline.split'), onSplit)}
                    {action('copy-outline', t('timeline.duplicate'), onDuplicate, {
                      disabled: clips.length >= MAX_TIMELINE_CLIPS,
                    })}
                    {action('trash-outline', t('timeline.delete'), onDelete, {
                      disabled: clips.length <= 1,
                      danger: true,
                    })}
                  </View>
                </>
              ) : null}
              <Text style={styles.note}>{t('timeline.dragHint')}</Text>
            </View>
          ) : null}

          {tool === 'sound' ? (
            <View style={styles.panel}>
              <Text style={styles.panelTitle}>{t('timeline.mixTitle')}</Text>
              <Text style={styles.meta}>{t('timeline.originalVolume')}</Text>
              <View style={styles.chipRow}>
                {MIX_LEVELS.map((v) =>
                  chip(Math.abs(originalVolume - v) < 0.01, percent(v), () => setOriginalVolume(v), v, true),
                )}
              </View>
              {sound ? (
                <>
                  <Text style={styles.meta}>{t('timeline.musicVolume')}</Text>
                  <View style={styles.chipRow}>
                    {MIX_LEVELS.map((v) =>
                      chip(Math.abs(soundVolume - v) < 0.01, percent(v), () => setSoundVolume(v), v, true),
                    )}
                  </View>
                  <SoundTrimControl
                    sound={sound}
                    offsetMs={soundOffsetMs}
                    onChangeOffset={setSoundOffsetMs}
                    previewable={false}
                  />
                </>
              ) : (
                <Text style={styles.note}>{t('timeline.noMusic')}</Text>
              )}
              <View style={styles.chipRow}>
                <Pressable
                  onPress={() => setSoundSheetOpen(true)}
                  style={[styles.chip, { borderColor: colors.or }]}
                  accessibilityRole="button"
                >
                  <Text style={[styles.chipText, { color: colors.or }]}>
                    {sound ? t('create.editChangeSound') : t('create.editAddSound')}
                  </Text>
                </Pressable>
                {sound ? (
                  <Pressable
                    onPress={() => setSound(null)}
                    style={[styles.chip, { borderColor: colors.danger }]}
                    accessibilityRole="button"
                  >
                    <Text style={[styles.chipText, { color: colors.danger }]}>{t('timeline.removeMusic')}</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          ) : null}

          {tool === 'effects' ? (
            <View style={styles.panel}>
              <FilterCarousel compact selectedId={filter?.id ?? null} onSelect={setFilter} />
            </View>
          ) : null}

          <View style={[styles.toolbar, { paddingBottom: Math.max(insets.bottom, Spacing.md) }]}>
            {tools.map((tl) => {
              const on =
                tool === tl.id ||
                (tool === 'layers' && tl.id === 'text' && selectedOverlay?.type === 'text') ||
                (tool === 'layers' && tl.id === 'stickers' && selectedOverlay?.type === 'sticker');
              const color = on ? colors.onMediaAccent : colors.onMedia;
              return (
                <Pressable
                  key={tl.id}
                  style={styles.tool}
                  onPress={() => onTool(tl.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                >
                  <Ionicons name={tl.icon} size={24} color={color} />
                  <Text style={[styles.toolLabel, { color }]}>{tl.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}

      {savingDraft ? (
        <View style={styles.busyWrap}>
          <ActivityIndicator color={colors.or} size="large" />
          <Text style={styles.busyText}>{t('drafts.saving')}</Text>
        </View>
      ) : null}

      <TextOverlayComposer
        visible={composer != null}
        initial={composer?.initial ?? null}
        onDone={onComposerDone}
        onCancel={() => setComposer(null)}
      />
      <StickerPicker visible={stickerOpen} onPick={onPickSticker} onClose={() => setStickerOpen(false)} />
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
