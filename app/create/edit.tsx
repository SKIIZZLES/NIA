/**
 * Édition — sprint S3, entre la capture (ou la galerie) et l'aperçu.
 *
 * Plein écran façon TikTok : le média occupe l'écran, une barre d'outils en
 * bas ouvre un panneau à la fois :
 * - Modifier : découpe réelle du fichier (react-native-media-toolkit) et
 *   vitesse 0,5x / 1x / 1,5x / 2x (lecture seulement, locale jusqu'à S5) ;
 * - Son : choix / import du son, début, volume du son original (S2) ;
 * - Texte / Stickers (S4) : calques déplaçables, pincer pour la taille et
 *   l'angle, fenêtre d'affichage sur la frise, suppression par la corbeille
 *   ou un appui long. Locaux au brouillon jusqu'à S5 ;
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
import type { VideoPlayer } from 'expo-video';
import { CameraSoundSheet } from '@/components/CameraSoundSheet';
import { FilterCarousel } from '@/components/FilterCarousel';
import { OverlayEditor } from '@/components/OverlayEditor';
import { usePlayerTimeMs } from '@/components/OverlayLayer';
import { StickerPicker } from '@/components/StickerPicker';
import {
  TextOverlayComposer,
  type TextStyleValue,
} from '@/components/TextOverlayComposer';
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
import { deleteCachedFile } from '@/lib/upload';
import {
  DEFAULT_STICKER_SIZE,
  DEFAULT_TEXT_SIZE,
  MAX_OVERLAYS,
  MIN_OVERLAY_SPAN_MS,
  makeOverlayId,
  type Overlay,
  type OverlayDoc,
} from '@/lib/overlays';
import {
  clampTrimRange,
  isFullRange,
  isTrimAvailable,
  trimVideoFile,
  videoAspect,
} from '@/lib/videoTrim';

type Tool = 'edit' | 'sound' | 'layers' | 'effects' | null;

type LiveEditorProps = Omit<React.ComponentProps<typeof OverlayEditor>, 'timeMs'> & {
  player: VideoPlayer | null;
  originMs: number;
  doc: OverlayDoc;
};

/** Suit l'instant de lecture sans refaire le rendu de tout l'écran. */
function LiveOverlayEditor({ player, originMs, ...rest }: LiveEditorProps) {
  const timeMs = usePlayerTimeMs(player, originMs);
  return <OverlayEditor {...rest} timeMs={player ? timeMs : null} />;
}

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
    overlays,
    setOverlayAspect,
    addOverlay,
    updateOverlay,
    removeOverlay,
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [composer, setComposer] = useState<{
    id: string | null;
    initial: TextStyleValue | null;
  } | null>(null);
  const [stickerOpen, setStickerOpen] = useState(false);
  const [overlayDragging, setOverlayDragging] = useState(false);
  const selected = overlays.items.find((o) => o.id === selectedId) ?? null;

  // Repère des calques : format réel du média (orientation corrigée).
  const sourceUri = source?.uri ?? null;
  useEffect(() => {
    if (!sourceUri) return;
    let alive = true;
    if (isVideo) {
      void videoAspect(sourceUri).then(({ aspect, frameUri }) => {
        if (frameUri) deleteCachedFile(frameUri);
        if (alive && aspect) setOverlayAspect(aspect);
      });
    } else {
      Image.getSize(
        sourceUri,
        (w, h) => {
          if (alive && w > 0 && h > 0) setOverlayAspect(w / h);
        },
        () => {},
      );
    }
    return () => {
      alive = false;
    };
  }, [sourceUri, isVideo, setOverlayAspect]);

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
  const shouldPlay = isVideo && isFocused && !dragging && !busy && !composer;
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
      setComposer({ id, initial: { text: o.text, font: o.font, color: o.color, bg: o.bg } });
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
        tool: { alignItems: 'center', minWidth: 58, paddingVertical: 4 },
        toolLabel: { fontFamily: Fonts.medium, fontSize: 11, marginTop: 4 },
        panelHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
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

  if (!source?.uri) {
    return <Redirect href="/create/camera" />;
  }

  const selDuration = Math.max(0, sel.endMs - sel.startMs);

  const tools: {
    id: 'edit' | 'sound' | 'text' | 'stickers' | 'effects';
    icon: React.ComponentProps<typeof Ionicons>['name'];
    label: string;
    disabled?: boolean;
  }[] = [
    { id: 'edit', icon: 'cut-outline', label: t('create.editToolEdit'), disabled: !isVideo },
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
  const layerEndMs = selected ? selected.endMs ?? selDuration : 0;
  const showChrome = !overlayDragging;

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

      {/* Toucher le média : désélectionner le calque. */}
      <Pressable
        style={styles.media}
        onPress={() => {
          setSelectedId(null);
          if (tool === 'layers') setTool(null);
        }}
        accessible={false}
      />
      <LiveOverlayEditor
        doc={overlays}
        player={isVideo ? player : null}
        originMs={isVideo ? sel.startMs : 0}
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

      {sound?.publicUrl ? (
        <SyncedSound
          url={sound.publicUrl}
          video={isVideo ? player : null}
          active={isFocused && !busy && !dragging && !composer}
          offsetMs={soundOffsetMs}
          volume={soundVolume}
          rate={isVideo ? playbackSpeed : 1}
          originSec={isVideo ? sel.startMs / 1000 : 0}
        />
      ) : null}

      {showChrome ? (
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
      ) : null}

      {showChrome ? (
        <View style={styles.bottom}>
          {tool === 'layers' ? (
            <View style={styles.panel}>
              {selected ? (
                <>
                  <View style={styles.panelHead}>
                    <Text style={styles.layerName} numberOfLines={1}>
                      {selected.type === 'text' ? selected.text : selected.emoji}
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
                  {isVideo && selDuration > 0 ? (
                    <>
                      <TrimBar
                        uri={source.uri}
                        durationMs={selDuration}
                        originMs={sel.startMs}
                        minRangeMs={MIN_OVERLAY_SPAN_MS}
                        startMs={selected.startMs}
                        endMs={layerEndMs}
                        onChange={(s, e) =>
                          updateOverlay(selected.id, {
                            startMs: s,
                            endMs: e >= selDuration - 50 ? null : e,
                          })
                        }
                        onDragStart={() => setDragging(true)}
                        onDragEnd={(which) => {
                          setDragging(false);
                          const at =
                            which === 'start'
                              ? selected.startMs
                              : Math.max(selected.startMs, layerEndMs - 1000);
                          try {
                            player.currentTime = (sel.startMs + at) / 1000;
                          } catch {
                            // lecteur libéré
                          }
                        }}
                        startLabel={t('create.layerStartHandle')}
                        endLabel={t('create.layerEndHandle')}
                      />
                      <Text style={styles.meta}>
                        {selected.startMs <= 0 && selected.endMs == null
                          ? t('create.layerShowAlways')
                          : t('create.layerShowRange', {
                              start: formatSoundTime(selected.startMs),
                              end: formatSoundTime(layerEndMs),
                            })}
                      </Text>
                    </>
                  ) : null}
                  <View style={styles.chipRow}>
                    {selected.type === 'text' ? (
                      <Pressable
                        onPress={() => openTextEditor(selected.id)}
                        style={[styles.chip, { borderColor: colors.or }]}
                        accessibilityRole="button"
                      >
                        <Text style={[styles.chipText, { color: colors.or }]}>
                          {t('create.layerEditText')}
                        </Text>
                      </Pressable>
                    ) : null}
                    <Pressable
                      onPress={() => deleteOverlay(selected.id)}
                      style={[styles.chip, { borderColor: colors.danger }]}
                      accessibilityRole="button"
                    >
                      <Text style={[styles.chipText, { color: colors.danger }]}>
                        {t('create.layerDelete')}
                      </Text>
                    </Pressable>
                  </View>
                </>
              ) : (
                <Text style={styles.panelTitle}>{t('create.layersTitle')}</Text>
              )}
              <Text style={styles.note}>{t('create.layersHint')}</Text>
            </View>
          ) : null}

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
              const on = tool === tl.id || (tool === 'layers' && tl.id === 'text' && selected?.type === 'text') ||
                (tool === 'layers' && tl.id === 'stickers' && selected?.type === 'sticker');
              const color = tl.disabled ? colors.textMuted : on ? colors.or : colors.onMedia;
              return (
                <Pressable
                  key={tl.id}
                  style={[styles.tool, tl.disabled && { opacity: 0.5 }]}
                  disabled={tl.disabled}
                  onPress={() => onTool(tl.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on, disabled: !!tl.disabled }}
                >
                  <Ionicons name={tl.icon} size={24} color={color} />
                  <Text style={[styles.toolLabel, { color }]}>{tl.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}

      {busy ? (
        <View style={styles.busyWrap}>
          <ActivityIndicator color={colors.or} size="large" />
          <Text style={styles.busyText}>{t('create.editTrimming')}</Text>
        </View>
      ) : null}

      <TextOverlayComposer
        visible={composer != null}
        initial={composer?.initial ?? null}
        onDone={onComposerDone}
        onCancel={() => setComposer(null)}
      />
      <StickerPicker
        visible={stickerOpen}
        onPick={onPickSticker}
        onClose={() => setStickerOpen(false)}
      />

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
