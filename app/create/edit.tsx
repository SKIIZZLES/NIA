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
 *
 * Sprint S6 : « Brouillon » enregistre toute la création sur le téléphone
 * (lib/drafts). Quitter l'éditeur avec des modifications non enregistrées
 * (flèche, retour Android, geste iOS) demande « Enregistrer le brouillon ? ».
 * La sélection de découpe vit donc dans le CreateContext (trimSelection) pour
 * être enregistrée même avant « Suivant ».
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
import { Redirect, useIsFocused, useNavigation, useRouter } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
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
import { MediaChrome, useColors } from '@/context/ThemeContext';
import { Fonts, MediaTextShadow, Radii, Spacing } from '@/constants/theme';
import { getFilterOverlayStyle } from '@/constants/filters';
import { MAX_VIDEO_DURATION_SEC } from '@/constants/publish';
import { formatSoundTime } from '@/lib/soundSync';
import { isDraftStorageAvailable } from '@/lib/drafts';
import { useBlockBackWhile } from '@/hooks/useBlockBackWhile';
import { isComposerAvailable } from '@/lib/composer';
import { exceedsComposedMax, MAX_COMPOSED_DURATION_MS } from '@/lib/composition';
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

/**
 * L'éditeur est posé sur la vidéo : sa palette ne suit pas la surface claire
 * de Clair (voir `MediaChrome`). Texte sable sur voiles sombres partout.
 */
export default function CreateEditStep() {
  return (
    <MediaChrome>
      <CreateEditScreen />
    </MediaChrome>
  );
}

function CreateEditScreen() {
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
    trimSelection,
    setTrimSelection,
    hasUnsavedChanges,
    saveDraft,
    discardChanges,
    isLeaveGuardReleased,
  } = useCreateDraft();
  const navigation = useNavigation();
  const draftsAvailable = isDraftStorageAvailable();

  // L'édition travaille toujours sur le fichier source, jamais sur la découpe.
  const source = sourceMedia ?? media;
  const isVideo = source?.type === 'video';

  const [tool, setTool] = useState<Tool>(null);
  const [soundSheetOpen, setSoundSheetOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [durationMs, setDurationMs] = useState<number>(source?.durationMs ?? 0);
  // Sélection de découpe : dans le contexte (S6), null = sélection par défaut.
  const range = trimSelection;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [composer, setComposer] = useState<{
    id: string | null;
    initial: TextStyleValue | null;
  } | null>(null);
  const [stickerOpen, setStickerOpen] = useState(false);
  const [overlayDragging, setOverlayDragging] = useState(false);
  // Lecture / pause au toucher de la vidéo. Quitter l'écran met aussi en
  // pause (isFocused) ; le choix de l'utilisateur est gardé au retour.
  const [userPaused, setUserPaused] = useState(false);
  const selected = overlays.items.find((o) => o.id === selectedId) ?? null;
  // S7 : pas de sortie pendant la découpe ou l'enregistrement du brouillon.
  useBlockBackWhile(busy || savingDraft);

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
  // Elle reste implicite (null) tant que l'utilisateur n'y touche pas : un
  // brouillon rouvert sans découpe n'apparaît donc pas comme modifié.
  const maxRangeMs = MAX_VIDEO_DURATION_SEC * 1000;
  useEffect(() => {
    if (!(durationMs > 0) || !range) return;
    const c = clampTrimRange(range.startMs, range.endMs, durationMs);
    if (c.startMs !== range.startMs || c.endMs !== range.endMs) setTrimSelection(c);
  }, [durationMs, range, setTrimSelection]);

  const sel =
    range ??
    (durationMs > 0
      ? clampTrimRange(0, Math.min(durationMs, maxRangeMs), durationMs)
      : { startMs: 0, endMs: durationMs });
  const selRef = useRef(sel);
  selRef.current = sel;

  // Lecture : focus, pas de glissé ni de découpe en cours.
  const shouldPlay =
    isVideo && isFocused && !userPaused && !dragging && !busy && !savingDraft && !composer;
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
    // Éditeur P0 : la vidéo composée dure 3 min au plus (vitesse comprise).
    if (isComposerAvailable() && exceedsComposedMax((endMs - startMs) / (playbackSpeed || 1))) {
      Alert.alert(
        t('composer.tooLongTitle'),
        t('composer.tooLongBody', { minutes: String(MAX_COMPOSED_DURATION_MS / 60_000) }),
      );
      return;
    }
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
  }, [busy, isVideo, source, durationMs, trimRange, clearTrim, applyTrimmedVideo, router, t, playbackSpeed]);

  // --- Brouillons (S6) -------------------------------------------------

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
    if (await doSaveDraft()) {
      Alert.alert(t('drafts.savedTitle'), t('drafts.savedBody'));
    }
  }, [doSaveDraft, t]);

  // Sortie de l'éditeur (flèche, retour Android, geste iOS) avec des
  // modifications non enregistrées. Après une publication réussie, la garde
  // est levée : la sortie du parcours se fait sans question.
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
          // Voile sombre fixe, jamais la surface du thème : lisible sur
          // n'importe quelle image et dans tous les thèmes.
          backgroundColor: colors.mediaScrimStrong,
        },
        tool: { alignItems: 'center', minWidth: 58, paddingVertical: 4 },
        toolLabel: { fontFamily: Fonts.medium, fontSize: 12, marginTop: 4, ...MediaTextShadow },
        playBadge: {
          ...StyleSheet.absoluteFill,
          alignItems: 'center',
          justifyContent: 'center',
        },
        playCircle: {
          width: 72,
          height: 72,
          borderRadius: 36,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.mediaScrim,
        },
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

      {/* Toucher le média : désélectionner le calque, sinon lecture / pause. */}
      <Pressable
        style={styles.media}
        onPress={() => {
          if (selectedId || tool === 'layers') {
            setSelectedId(null);
            if (tool === 'layers') setTool(null);
            return;
          }
          if (isVideo) setUserPaused((p) => !p);
        }}
        accessible={isVideo}
        accessibilityRole={isVideo ? 'button' : undefined}
        accessibilityLabel={isVideo ? (userPaused ? t('feed.play') : t('feed.pause')) : undefined}
      />
      {isVideo && userPaused && !composer ? (
        <View pointerEvents="none" style={styles.playBadge}>
          <View style={styles.playCircle}>
            <Ionicons name="play" size={34} color={colors.onMedia} style={{ marginLeft: 4 }} />
          </View>
        </View>
      ) : null}
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
          active={isFocused && !userPaused && !busy && !dragging && !composer}
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
            disabled={busy || savingDraft}
            style={[styles.iconBtn, (busy || savingDraft) && { opacity: 0.6 }]}
            accessibilityRole="button"
            accessibilityLabel={t('create.editBack')}
          >
            <Ionicons name="chevron-back" size={24} color={colors.onMedia} />
          </Pressable>
          <View style={styles.topRight}>
            {draftsAvailable ? (
              <Pressable
                onPress={() => void onSaveDraftPress()}
                disabled={busy || savingDraft}
                style={[styles.draftBtn, (busy || savingDraft) && { opacity: 0.6 }]}
                accessibilityRole="button"
                accessibilityLabel={t('drafts.saveA11y')}
              >
                <Ionicons name="bookmark-outline" size={16} color={colors.onMedia} />
                <Text style={styles.draftText}>{t('drafts.save')}</Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => void next()}
              disabled={busy || savingDraft}
              style={[styles.nextBtn, (busy || savingDraft) && { opacity: 0.6 }]}
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
                  onChange={(s, e) => setTrimSelection({ startMs: s, endMs: e })}
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
                    onPress={() => setTrimSelection(null)}
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
              // Désactivé : atténué mais lisible (≥ 3:1), sans opacité en plus.
              const color = tl.disabled
                ? colors.onMediaDisabled
                : on
                  ? colors.onMediaAccent
                  : colors.onMedia;
              return (
                <Pressable
                  key={tl.id}
                  style={styles.tool}
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

      {busy || savingDraft ? (
        <View style={styles.busyWrap}>
          <ActivityIndicator color={colors.or} size="large" />
          <Text style={styles.busyText}>
            {savingDraft ? t('drafts.saving') : t('create.editTrimming')}
          </Text>
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
