/**
 * Écran « Passer en direct » façon Instagram Live (sprint L2, natif).
 *
 * Aperçu caméra plein écran (piste locale LiveKit) avec :
 *   - X en haut à gauche, ⚙ en haut à droite (catégorie, « Programmer pour
 *     plus tard ») ;
 *   - rail latéral : retourner la caméra, micro on/off ;
 *   - en bas : titre, pastille d'audience « Tout le monde » / « Abonnés »,
 *     grand bouton rond « Passer en direct ».
 * Direct instantané (`live` = null) : la ligne live_streams est créée au
 * moment d'appuyer (statut « scheduled », trigger 019) ; le passage à « live »
 * vient de livekit-webhook quand l'hôte est connecté. Live programmé : même
 * écran, titre et audience déjà choisis.
 * À l'antenne : badge « EN DIRECT », durée, spectateurs, « Terminer » avec
 * confirmation (endStream : status « ended »).
 * Filtre de mots 018 : titre retenu → on explique et on laisse modifier
 * (le live n'est pas créé / est annulé) ; titre masqué → affiché tel quel.
 * Volontairement absents : dons, cadeaux, abonnements ; filtres vidéo (les
 * filtres NIA ne s'appliquent pas au flux WebRTC sans traitement natif).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { RTCView } from '@livekit/react-native-webrtc';
import {
  DisconnectReason,
  LocalAudioTrack,
  LocalVideoTrack,
  Room,
  RoomEvent,
  Track,
  TrackEvent,
  createLocalTracks,
} from 'livekit-client';
import {
  LiveBottomSheet,
  LiveCenterMessage,
  LiveErrorState,
  OnAirBadge,
  RoundIconButton,
  ViewerPill,
} from '@/components/live/LiveStageParts';
import type { LiveHostStageProps } from '@/components/live/types';
import { useAge } from '@/context/AgeContext';
import { useI18n } from '@/context/I18nContext';
import { useColors } from '@/context/ThemeContext';
import { Fonts, Radii, Spacing } from '@/constants/theme';
import { LIVE_CATEGORIES, type LiveCategoryId } from '@/constants/liveCategories';
import {
  cancelStream,
  createInstantStream,
  endStream,
  type LiveStreamItem,
} from '@/lib/live';
import {
  GO_LIVE_AUDIENCES,
  LIVE_TITLE_MAX,
  audienceLabelKey,
  formatLiveDuration,
  instantLiveTitle,
  liveTitleOutcome,
  type GoLiveAudience,
} from '@/lib/liveGo';
import { canMarkMature, isMatureError } from '@/lib/age';
import { LiveTokenError, fetchLiveToken, liveTokenErrorKey } from '@/lib/liveToken';
import { checkTexts } from '@/lib/textFilter';
import {
  HOST_ROOM_OPTIONS,
  LIVE_VIDEO_PUBLISH,
  cameraCaptureOptions,
  ensureLiveKitGlobals,
  requestCameraAndMic,
  startHostAudio,
  stopLiveAudio,
} from '@/lib/liveRtcNative';

type Phase = 'preparing' | 'preview' | 'creating' | 'connecting' | 'live' | 'ending' | 'error';
type Facing = 'user' | 'environment';

const KEEP_AWAKE_TAG = 'nia-live-host';
const GO_BUTTON = 84;

export function LiveHostStage({ live, userId, hostHandle, onClose, onEnded, onSchedule }: LiveHostStageProps) {
  const { t } = useI18n();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { status: ageStatus } = useAge();
  const instant = live === null;

  const [phase, setPhase] = useState<Phase>('preparing');
  const [errorKey, setErrorKey] = useState('live.rtc.errServer');
  const [facing, setFacing] = useState<Facing>('user');
  const [micMuted, setMicMuted] = useState(false);
  const [flipping, setFlipping] = useState(false);
  const [viewers, setViewers] = useState(0);
  const [reconnecting, setReconnecting] = useState(false);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);

  // Ligne live_streams (programmée, ou créée par le direct instantané).
  const [current, setCurrent] = useState<LiveStreamItem | null>(live);
  const [title, setTitle] = useState(live?.title ?? '');
  const [audience, setAudience] = useState<GoLiveAudience>(
    live?.visibility === 'followers' ? 'followers' : 'public',
  );
  const [category, setCategory] = useState<LiveCategoryId>(live?.category ?? 'other');
  // 020 : live 18+ (adultes déclarés uniquement ; le serveur revérifie).
  const [mature, setMature] = useState(live?.isMature === true);
  const [notice, setNotice] = useState<string | null>(null);
  const [audienceOpen, setAudienceOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [onAirSince, setOnAirSince] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());

  const mountedRef = useRef(true);
  const roomRef = useRef<Room | null>(null);
  const videoRef = useRef<LocalVideoTrack | null>(null);
  const audioRef = useRef<LocalAudioTrack | null>(null);
  const endingRef = useRef(false);
  const phaseRef = useRef<Phase>('preparing');
  phaseRef.current = phase;
  /** Direct instantané créé ici mais jamais passé à l'antenne : annulé en sortant. */
  const createdIdRef = useRef<string | null>(null);
  const connectedRef = useRef(false);
  const titleInputRef = useRef<TextInput | null>(null);

  const fail = useCallback((key: string) => {
    if (!mountedRef.current) return;
    setErrorKey(key);
    setPhase('error');
  }, []);

  /** Rend la piste vidéo locale affichable par RTCView (et suit les redémarrages). */
  const bindPreview = useCallback((track: LocalVideoTrack) => {
    const refresh = () => {
      if (!mountedRef.current) return;
      // Après registerGlobals(), `mediaStream` est un MediaStream react-native-webrtc.
      const stream = track.mediaStream as unknown as { toURL?: () => string } | undefined;
      setStreamUrl(stream?.toURL ? stream.toURL() : null);
    };
    refresh();
    track.on(TrackEvent.Restarted, refresh);
    return () => {
      track.off(TrackEvent.Restarted, refresh);
    };
  }, []);

  const releaseAll = useCallback(async () => {
    const room = roomRef.current;
    roomRef.current = null;
    if (room) {
      room.removeAllListeners();
      try {
        await room.disconnect(true);
      } catch {
        // déjà fermée
      }
    }
    videoRef.current?.stop();
    audioRef.current?.stop();
    videoRef.current = null;
    audioRef.current = null;
    await stopLiveAudio();
  }, []);

  const unbindRef = useRef<(() => void) | null>(null);

  const prepare = useCallback(async () => {
    setPhase('preparing');
    setReconnecting(false);
    setViewers(0);
    try {
      ensureLiveKitGlobals();
      const granted = await requestCameraAndMic();
      if (!granted) {
        fail('live.rtc.errPermissions');
        return;
      }
      await startHostAudio();
      const tracks = await createLocalTracks({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: cameraCaptureOptions('user'),
      });
      if (!mountedRef.current) {
        tracks.forEach((tr) => tr.stop());
        return;
      }
      const video = tracks.find((tr) => tr.kind === Track.Kind.Video) as LocalVideoTrack | undefined;
      const audio = tracks.find((tr) => tr.kind === Track.Kind.Audio) as LocalAudioTrack | undefined;
      if (!video || !audio) {
        tracks.forEach((tr) => tr.stop());
        fail('live.rtc.errCamera');
        return;
      }
      videoRef.current = video;
      audioRef.current = audio;
      setFacing('user');
      setMicMuted(false);
      unbindRef.current?.();
      unbindRef.current = bindPreview(video);
      setPhase('preview');
    } catch {
      await releaseAll();
      fail('live.rtc.errCamera');
    }
  }, [bindPreview, fail, releaseAll]);

  useEffect(() => {
    mountedRef.current = true;
    void prepare();
    return () => {
      mountedRef.current = false;
      unbindRef.current?.();
      unbindRef.current = null;
      deactivateKeepAwake(KEEP_AWAKE_TAG);
      void releaseAll();
      // Direct instantané abandonné avant l'antenne : on ne laisse pas de ligne orpheline.
      const created = createdIdRef.current;
      if (created && !connectedRef.current) void cancelStream(created).catch(() => undefined);
    };
    // Une seule préparation au montage ; « Réessayer » rappelle prepare().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Écran allumé pendant l'aperçu et le direct.
  useEffect(() => {
    if (phase === 'preview' || phase === 'creating' || phase === 'connecting' || phase === 'live') {
      void activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => undefined);
    } else {
      deactivateKeepAwake(KEEP_AWAKE_TAG);
    }
  }, [phase]);

  // Chrono d'antenne.
  useEffect(() => {
    if (phase !== 'live') return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [phase]);

  // Message éphémère (titre masqué, etc.).
  useEffect(() => {
    if (!notice) return undefined;
    const id = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(id);
  }, [notice]);

  const explainHeld = useCallback(() => {
    Alert.alert(t('textFilter.heldTitle'), t('live.go.heldEdit'), [
      { text: t('textFilter.edit'), onPress: () => titleInputRef.current?.focus() },
    ]);
  }, [t]);

  /** Direct instantané : crée la ligne ; null si l'hôte doit corriger son titre. */
  const ensureRow = useCallback(async (): Promise<LiveStreamItem | null> => {
    if (current) return current;
    const finalTitle = instantLiveTitle(title, t('live.go.defaultTitle', { handle: hostHandle }));
    setPhase('creating');
    // 018 : prévenir avant d'envoyer (la liste de mots reste sur le serveur).
    const verdict = await checkTexts([{ text: finalTitle, field: 'live_title' }]);
    if (!mountedRef.current) return null;
    if (verdict === 'held') {
      setPhase('preview');
      explainHeld();
      return null;
    }
    let row: LiveStreamItem;
    try {
      row = await createInstantStream({
        title: finalTitle,
        visibility: audience,
        category,
        isMature: mature && canMarkMature(ageStatus),
      });
    } catch (e) {
      if (mountedRef.current) {
        setPhase('preview');
        Alert.alert(t('live.rtc.errTitle'), isMatureError(e) ? e.message : t('live.go.createFail'));
      }
      return null;
    }
    if (!mountedRef.current) return null;
    const outcome = liveTitleOutcome(finalTitle, row.title, row.moderationState);
    if (outcome === 'held') {
      // Retenu par le serveur malgré tout : personne ne le verrait. On annule
      // (la retenue reste enregistrée pour la modération) et on laisse corriger.
      void cancelStream(row.id).catch(() => undefined);
      setPhase('preview');
      explainHeld();
      return null;
    }
    createdIdRef.current = row.id;
    setCurrent(row);
    setTitle(row.title);
    if (outcome === 'masked') setNotice(t('live.go.masked'));
    return row;
  }, [ageStatus, audience, category, current, explainHeld, hostHandle, mature, t, title]);

  const goLive = useCallback(async () => {
    const video = videoRef.current;
    const audio = audioRef.current;
    if (!video || !audio || phaseRef.current !== 'preview') return;

    if (current && current.moderationState && current.moderationState !== 'visible') {
      Alert.alert(t('textFilter.heldTitle'), t('textFilter.heldLive'));
      return;
    }
    const row = await ensureRow();
    if (!row || !mountedRef.current) return;
    setPhase('connecting');

    let creds: { token: string; url: string };
    try {
      creds = await fetchLiveToken(row.id, 'publisher');
    } catch (e) {
      if (!mountedRef.current) return;
      const key = e instanceof LiveTokenError ? liveTokenErrorKey(e.code) : 'live.rtc.errServer';
      // Le jeton a échoué : on garde l'aperçu, l'hôte peut réessayer.
      Alert.alert(t('live.rtc.errTitle'), t(key));
      setPhase('preview');
      return;
    }

    const room = new Room(HOST_ROOM_OPTIONS);
    roomRef.current = room;
    const updateViewers = () => {
      if (mountedRef.current) setViewers(room.remoteParticipants.size);
    };
    room
      .on(RoomEvent.ParticipantConnected, updateViewers)
      .on(RoomEvent.ParticipantDisconnected, updateViewers)
      .on(RoomEvent.Reconnecting, () => mountedRef.current && setReconnecting(true))
      .on(RoomEvent.Reconnected, () => mountedRef.current && setReconnecting(false))
      .on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
        if (endingRef.current || !mountedRef.current) return;
        if (roomRef.current !== room) return;
        roomRef.current = null;
        unbindRef.current?.();
        unbindRef.current = null;
        setStreamUrl(null);
        void releaseAll();
        fail(
          reason === DisconnectReason.ROOM_DELETED
            ? 'live.rtc.errRoomClosed'
            : 'live.rtc.errDisconnected',
        );
      });

    try {
      await room.connect(creds.url, creds.token, { autoSubscribe: false });
      connectedRef.current = true;
      await room.localParticipant.publishTrack(video, {
        ...LIVE_VIDEO_PUBLISH,
        source: Track.Source.Camera,
      });
      await room.localParticipant.publishTrack(audio, { source: Track.Source.Microphone });
      if (!mountedRef.current) return;
      updateViewers();
      setOnAirSince(Date.now());
      setNow(Date.now());
      setPhase('live');
    } catch {
      if (!mountedRef.current) return;
      // Échec de connexion ou de publication (quota atteint, réseau…) :
      // on repart d'un état propre ; « Réessayer » relance l'aperçu.
      endingRef.current = true;
      unbindRef.current?.();
      unbindRef.current = null;
      setStreamUrl(null);
      await releaseAll();
      endingRef.current = false;
      connectedRef.current = false;
      fail('live.rtc.errConnect');
    }
  }, [current, ensureRow, fail, releaseAll, t]);

  const flip = useCallback(async () => {
    const video = videoRef.current;
    if (!video || flipping) return;
    const next: Facing = facing === 'user' ? 'environment' : 'user';
    setFlipping(true);
    try {
      await video.restartTrack(cameraCaptureOptions(next));
      if (mountedRef.current) setFacing(next);
    } catch {
      if (mountedRef.current) Alert.alert(t('live.rtc.errTitle'), t('live.rtc.errCamera'));
    } finally {
      if (mountedRef.current) setFlipping(false);
    }
  }, [facing, flipping, t]);

  const toggleMic = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;
    try {
      if (micMuted) await audio.unmute();
      else await audio.mute();
      if (mountedRef.current) setMicMuted(!micMuted);
    } catch {
      // l'état reste inchangé
    }
  }, [micMuted]);

  const doEnd = useCallback(async () => {
    const row = current;
    if (!row) return;
    setPhase('ending');
    try {
      // status « ended » (trigger 019 : ended_at et raison « host » posés par le serveur).
      await endStream(userId, row.id);
    } catch (e) {
      if (!mountedRef.current) return;
      setPhase('live');
      Alert.alert(t('common.error'), e instanceof Error ? e.message : t('live.endFail'));
      return;
    }
    endingRef.current = true;
    unbindRef.current?.();
    unbindRef.current = null;
    setStreamUrl(null);
    const duration = onAirSince ? formatLiveDuration(Date.now() - onAirSince) : null;
    await releaseAll();
    if (!mountedRef.current) return;
    if (duration) Alert.alert(t('live.go.endedTitle'), t('live.go.endedBody', { duration }));
    onEnded(row.id);
  }, [current, onAirSince, onEnded, releaseAll, t, userId]);

  const confirmEnd = useCallback(() => {
    Alert.alert(t('live.rtc.endConfirmTitle'), t('live.rtc.endConfirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('live.rtc.endConfirm'), style: 'destructive', onPress: () => void doEnd() },
    ]);
  }, [doEnd, t]);

  const schedule = useCallback(async () => {
    setSettingsOpen(false);
    if (!onSchedule) return;
    // La caméra WebRTC est libérée avant d'ouvrir le formulaire.
    unbindRef.current?.();
    unbindRef.current = null;
    setStreamUrl(null);
    await releaseAll();
    onSchedule();
  }, [onSchedule, releaseAll]);

  // Retour Android pendant le direct : on demande confirmation au lieu de couper net.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (phaseRef.current === 'live') {
        confirmEnd();
        return true;
      }
      return (
        phaseRef.current === 'creating' ||
        phaseRef.current === 'connecting' ||
        phaseRef.current === 'ending'
      );
    });
    return () => sub.remove();
  }, [confirmEnd]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        root: { flex: 1, backgroundColor: colors.noir },
        topBar: {
          position: 'absolute',
          left: 0,
          right: 0,
          top: insets.top + Spacing.sm,
          paddingHorizontal: Spacing.md,
          flexDirection: 'row',
          alignItems: 'center',
          gap: Spacing.sm,
        },
        spacer: { flex: 1 },
        duration: {
          color: colors.onMedia,
          fontFamily: Fonts.medium,
          fontSize: 12,
          textShadowColor: 'rgba(0,0,0,0.6)',
          textShadowRadius: 4,
        },
        endPill: {
          paddingHorizontal: 14,
          paddingVertical: 8,
          borderRadius: Radii.pill,
          backgroundColor: 'rgba(11,11,11,0.6)',
          borderWidth: 1,
          borderColor: colors.onMedia,
        },
        endPillText: { color: colors.onMedia, fontFamily: Fonts.bold, fontSize: 13 },
        rail: {
          position: 'absolute',
          right: Spacing.md,
          top: insets.top + 76,
          gap: Spacing.md,
          alignItems: 'center',
        },
        railItem: { alignItems: 'center', gap: 4 },
        railLabel: {
          color: colors.onMedia,
          fontFamily: Fonts.medium,
          fontSize: 11,
          textShadowColor: 'rgba(0,0,0,0.7)',
          textShadowRadius: 4,
        },
        banner: {
          position: 'absolute',
          top: insets.top + 64,
          left: Spacing.lg,
          right: 88,
          alignSelf: 'flex-start',
          paddingHorizontal: 14,
          paddingVertical: 8,
          borderRadius: Radii.md,
          backgroundColor: 'rgba(209,127,42,0.92)',
        },
        bannerText: { color: colors.onAccent, fontFamily: Fonts.medium, fontSize: 13, lineHeight: 18 },
        bottom: {
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          paddingBottom: insets.bottom + Spacing.lg,
          paddingHorizontal: Spacing.lg,
          gap: Spacing.md,
          alignItems: 'center',
        },
        titleInput: {
          alignSelf: 'stretch',
          color: colors.onMedia,
          fontFamily: Fonts.bold,
          fontSize: 17,
          textAlign: 'center',
          paddingVertical: 8,
          paddingHorizontal: Spacing.md,
          borderRadius: Radii.md,
          backgroundColor: 'rgba(11,11,11,0.45)',
        },
        titleText: {
          alignSelf: 'stretch',
          color: colors.onMedia,
          fontFamily: Fonts.bold,
          fontSize: 16,
          textAlign: 'center',
          textShadowColor: 'rgba(0,0,0,0.7)',
          textShadowRadius: 4,
        },
        liveTitle: {
          alignSelf: 'flex-start',
          maxWidth: '80%',
          color: colors.onMedia,
          fontFamily: Fonts.bold,
          fontSize: 15,
          textShadowColor: 'rgba(0,0,0,0.7)',
          textShadowRadius: 4,
        },
        audiencePill: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          paddingHorizontal: 14,
          paddingVertical: 7,
          borderRadius: Radii.pill,
          backgroundColor: 'rgba(11,11,11,0.6)',
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.onMedia,
        },
        audienceText: { color: colors.onMedia, fontFamily: Fonts.medium, fontSize: 13 },
        goOuter: {
          width: GO_BUTTON + 12,
          height: GO_BUTTON + 12,
          borderRadius: (GO_BUTTON + 12) / 2,
          borderWidth: 4,
          borderColor: colors.onMedia,
          alignItems: 'center',
          justifyContent: 'center',
        },
        goInner: {
          width: GO_BUTTON,
          height: GO_BUTTON,
          borderRadius: GO_BUTTON / 2,
          backgroundColor: colors.or,
          alignItems: 'center',
          justifyContent: 'center',
        },
        goLabel: { color: colors.onAccent, fontFamily: Fonts.bold, fontSize: 11, letterSpacing: 1, marginTop: 2 },
        hint: {
          color: colors.onMedia,
          fontFamily: Fonts.regular,
          fontSize: 12,
          textAlign: 'center',
          opacity: 0.85,
          textShadowColor: 'rgba(0,0,0,0.7)',
          textShadowRadius: 4,
        },
        overlay: {
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(11,11,11,0.6)',
        },
        option: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingVertical: 12,
          paddingHorizontal: 12,
          borderRadius: Radii.md,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.border,
        },
        optionOn: { borderColor: colors.or, backgroundColor: colors.noirSoft },
        optionBody: { flex: 1, gap: 2 },
        optionTitle: { color: colors.sable, fontFamily: Fonts.bold, fontSize: 15 },
        optionHint: { color: colors.textMuted, fontFamily: Fonts.regular, fontSize: 12, lineHeight: 17 },
        sectionLabel: { color: colors.textMuted, fontFamily: Fonts.medium, fontSize: 12, marginTop: 4 },
        chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
        chip: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          paddingHorizontal: 12,
          paddingVertical: 7,
          borderRadius: Radii.pill,
          backgroundColor: colors.noirSoft,
        },
        chipOn: { backgroundColor: colors.or },
        chipText: { color: colors.sable, fontFamily: Fonts.medium, fontSize: 13 },
        chipTextOn: { color: colors.onAccent, fontFamily: Fonts.bold },
        link: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          paddingVertical: 14,
          marginTop: 4,
        },
        linkText: { color: colors.or, fontFamily: Fonts.bold, fontSize: 15 },
      }),
    [colors, insets.bottom, insets.top],
  );

  const showVideo = !!streamUrl && phase !== 'error' && phase !== 'preparing';
  const inPreview = phase === 'preview' || phase === 'creating' || phase === 'connecting';
  const busy = phase === 'creating' || phase === 'connecting' || phase === 'ending';
  const editableTitle = instant && !current && phase === 'preview';
  const audienceLocked = !instant || !!current;
  const viewersLabel = t('live.go.viewersA11y', { count: viewers });

  return (
    <View style={styles.root}>
      {showVideo ? (
        <RTCView
          streamURL={streamUrl as string}
          style={StyleSheet.absoluteFill}
          objectFit="cover"
          mirror={facing === 'user'}
          zOrder={0}
        />
      ) : null}

      {phase === 'preparing' ? <LiveCenterMessage busy body={t('live.rtc.preparing')} /> : null}

      {phase === 'error' ? (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.noir }]}>
          <LiveErrorState messageKey={errorKey} onRetry={() => void prepare()} onClose={onClose} />
        </View>
      ) : null}

      {busy ? (
        <View style={styles.overlay}>
          <LiveCenterMessage
            busy
            body={phase === 'ending' ? t('live.rtc.ending') : t('live.rtc.starting')}
          />
        </View>
      ) : null}

      {/* Haut : X / ⚙ en aperçu ; EN DIRECT + durée + spectateurs / Terminer à l'antenne. */}
      {phase !== 'error' && phase !== 'preparing' ? (
        <View style={styles.topBar}>
          {phase === 'live' || phase === 'ending' ? (
            <>
              <OnAirBadge label={t('live.rtc.onAir')} />
              <ViewerPill count={viewers} label={viewersLabel} />
              {onAirSince ? (
                <Text style={styles.duration}>{formatLiveDuration(now - onAirSince)}</Text>
              ) : null}
              <View style={styles.spacer} />
              <Pressable
                style={styles.endPill}
                onPress={confirmEnd}
                disabled={phase === 'ending'}
                accessibilityRole="button"
                accessibilityLabel={t('live.rtc.end')}
                hitSlop={6}
              >
                <Text style={styles.endPillText}>{t('live.rtc.end')}</Text>
              </Pressable>
            </>
          ) : (
            <>
              <RoundIconButton icon="close" label={t('live.go.close')} onPress={onClose} disabled={busy} />
              <View style={styles.spacer} />
              {instant ? (
                <RoundIconButton
                  icon="settings-outline"
                  label={t('live.go.settings')}
                  onPress={() => setSettingsOpen(true)}
                  disabled={busy}
                />
              ) : null}
            </>
          )}
        </View>
      ) : null}

      {notice ? (
        <View style={styles.banner} accessibilityLiveRegion="polite">
          <Text style={styles.bannerText}>{notice}</Text>
        </View>
      ) : null}
      {reconnecting && phase === 'live' ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{t('live.rtc.reconnecting')}</Text>
        </View>
      ) : null}

      {/* Rail latéral : caméra, micro. */}
      {inPreview || phase === 'live' ? (
        <View style={styles.rail}>
          <View style={styles.railItem}>
            <RoundIconButton
              icon="camera-reverse-outline"
              label={t('live.rtc.flipCamera')}
              onPress={() => void flip()}
              disabled={flipping || busy}
            />
            <Text style={styles.railLabel}>{t('live.go.flip')}</Text>
          </View>
          <View style={styles.railItem}>
            <RoundIconButton
              icon={micMuted ? 'mic-off' : 'mic-outline'}
              label={micMuted ? t('live.rtc.unmute') : t('live.rtc.mute')}
              onPress={() => void toggleMic()}
              active={micMuted}
            />
            <Text style={styles.railLabel}>{micMuted ? t('live.go.micOff') : t('live.go.micOn')}</Text>
          </View>
        </View>
      ) : null}

      {/* Bas : titre, audience, grand bouton rond. */}
      {inPreview ? (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.bottom}
          pointerEvents="box-none"
        >
          {editableTitle ? (
            <TextInput
              ref={titleInputRef}
              value={title}
              onChangeText={setTitle}
              placeholder={t('live.go.titlePlaceholder')}
              placeholderTextColor="rgba(245,230,211,0.7)"
              maxLength={LIVE_TITLE_MAX}
              style={styles.titleInput}
              accessibilityLabel={t('live.go.titleA11y')}
              returnKeyType="done"
            />
          ) : (
            <Text style={styles.titleText} numberOfLines={2}>
              {current?.title || title}
            </Text>
          )}

          <Pressable
            style={[styles.audiencePill, audienceLocked && { opacity: 0.8 }]}
            onPress={() => setAudienceOpen(true)}
            disabled={audienceLocked || busy}
            accessibilityRole="button"
            accessibilityLabel={t('live.go.audienceA11y', { audience: t(audienceLabelKey(audience)) })}
          >
            <Ionicons
              name={audience === 'followers' ? 'people-outline' : 'earth-outline'}
              size={15}
              color={colors.onMedia}
            />
            <Text style={styles.audienceText}>{t(audienceLabelKey(audience))}</Text>
            {!audienceLocked ? <Ionicons name="chevron-down" size={14} color={colors.onMedia} /> : null}
          </Pressable>

          <Pressable
            onPress={() => void goLive()}
            disabled={phase !== 'preview'}
            accessibilityRole="button"
            accessibilityLabel={t('live.go.goLiveA11y')}
            style={({ pressed }) => [styles.goOuter, (pressed || phase !== 'preview') && { opacity: 0.75 }]}
          >
            <View style={styles.goInner}>
              <Ionicons name="radio" size={28} color={colors.onAccent} />
              <Text style={styles.goLabel}>{t('live.go.goLiveShort')}</Text>
            </View>
          </Pressable>
          <Text style={styles.hint}>{t('live.go.hint')}</Text>
        </KeyboardAvoidingView>
      ) : null}

      {phase === 'live' ? (
        <View style={styles.bottom} pointerEvents="none">
          <Text style={styles.liveTitle} numberOfLines={2}>
            {current?.title}
          </Text>
        </View>
      ) : null}

      {/* Audience : « Tout le monde » / « Abonnés » (visibilités de 010, lues par la RLS 019). */}
      <LiveBottomSheet visible={audienceOpen} title={t('live.go.audienceTitle')} onClose={() => setAudienceOpen(false)}>
        {GO_LIVE_AUDIENCES.map((a) => {
          const on = a === audience;
          return (
            <Pressable
              key={a}
              style={[styles.option, on && styles.optionOn]}
              onPress={() => {
                setAudience(a);
                setAudienceOpen(false);
              }}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
            >
              <Ionicons name={a === 'followers' ? 'people-outline' : 'earth-outline'} size={22} color={colors.or} />
              <View style={styles.optionBody}>
                <Text style={styles.optionTitle}>{t(audienceLabelKey(a))}</Text>
                <Text style={styles.optionHint}>
                  {a === 'followers' ? t('live.go.audienceFollowersHint') : t('live.go.audiencePublicHint')}
                </Text>
              </View>
              {on ? <Ionicons name="checkmark-circle" size={22} color={colors.or} /> : null}
            </Pressable>
          );
        })}
      </LiveBottomSheet>

      {/* Réglages : catégorie, programmer pour plus tard. */}
      <LiveBottomSheet visible={settingsOpen} title={t('live.go.settings')} onClose={() => setSettingsOpen(false)}>
        <Text style={styles.sectionLabel}>{t('live.go.category')}</Text>
        <ScrollView horizontal={false} contentContainerStyle={styles.chips}>
          {LIVE_CATEGORIES.map((c) => {
            const on = c.id === category;
            return (
              <Pressable
                key={c.id}
                style={[styles.chip, on && styles.chipOn]}
                onPress={() => setCategory(c.id)}
                disabled={!!current}
                accessibilityRole="radio"
                accessibilityState={{ selected: on, disabled: !!current }}
              >
                <Ionicons name={c.icon} size={14} color={on ? colors.onAccent : colors.or} />
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{t(c.labelKey)}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        {canMarkMature(ageStatus) ? (
          <View style={styles.link}>
            <Ionicons name="eye-off-outline" size={20} color={colors.or} />
            <View style={styles.optionBody}>
              <Text style={styles.linkText}>{t('age.matureLabel')}</Text>
              <Text style={styles.optionHint}>{t('age.liveMatureHint')}</Text>
            </View>
            <Switch
              value={mature}
              onValueChange={setMature}
              disabled={!!current}
              trackColor={{ false: colors.noirSoft, true: colors.or }}
              thumbColor={colors.sable}
              accessibilityLabel={t('age.matureLabel')}
            />
          </View>
        ) : null}
        {onSchedule && !current ? (
          <Pressable style={styles.link} onPress={() => void schedule()} accessibilityRole="button">
            <Ionicons name="calendar-outline" size={20} color={colors.or} />
            <View style={styles.optionBody}>
              <Text style={styles.linkText}>{t('live.go.schedule')}</Text>
              <Text style={styles.optionHint}>{t('live.go.scheduleHint')}</Text>
            </View>
          </Pressable>
        ) : null}
      </LiveBottomSheet>
    </View>
  );
}
