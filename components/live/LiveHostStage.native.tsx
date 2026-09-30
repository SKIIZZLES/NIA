/**
 * Écran hôte « Passer en direct » (sprint L1, natif).
 *
 * Aperçu caméra local → « Démarrer le direct » (jeton publisher via
 * live-token, connexion LiveKit, publication 540p simulcast) → à l'antenne :
 * retourner la caméra, couper le micro, « Terminer » (endStream existant,
 * statut « ended »), puis déconnexion.
 *
 * L1 n'écrit rien d'autre en base : le statut ne passe pas à « live » côté
 * serveur (voir supabase/functions/live-token/core.ts).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, BackHandler, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
import { Button } from '@/components/Button';
import {
  LiveCenterMessage,
  LiveErrorState,
  OnAirBadge,
  RoundIconButton,
} from '@/components/live/LiveStageParts';
import type { LiveHostStageProps } from '@/components/live/types';
import { useI18n } from '@/context/I18nContext';
import { useColors } from '@/context/ThemeContext';
import { Fonts, Radii, Spacing } from '@/constants/theme';
import { endStream } from '@/lib/live';
import { LiveTokenError, fetchLiveToken, liveTokenErrorKey } from '@/lib/liveToken';
import {
  HOST_ROOM_OPTIONS,
  LIVE_VIDEO_PUBLISH,
  cameraCaptureOptions,
  ensureLiveKitGlobals,
  requestCameraAndMic,
  startHostAudio,
  stopLiveAudio,
} from '@/lib/liveRtcNative';

type Phase = 'preparing' | 'preview' | 'connecting' | 'live' | 'ending' | 'error';
type Facing = 'user' | 'environment';

const KEEP_AWAKE_TAG = 'nia-live-host';

export function LiveHostStage({ live, userId, onClose, onEnded }: LiveHostStageProps) {
  const { t } = useI18n();
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const [phase, setPhase] = useState<Phase>('preparing');
  const [errorKey, setErrorKey] = useState('live.rtc.errServer');
  const [facing, setFacing] = useState<Facing>('user');
  const [micMuted, setMicMuted] = useState(false);
  const [flipping, setFlipping] = useState(false);
  const [viewers, setViewers] = useState(0);
  const [reconnecting, setReconnecting] = useState(false);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const roomRef = useRef<Room | null>(null);
  const videoRef = useRef<LocalVideoTrack | null>(null);
  const audioRef = useRef<LocalAudioTrack | null>(null);
  const endingRef = useRef(false);
  const phaseRef = useRef<Phase>('preparing');
  phaseRef.current = phase;

  const fail = useCallback((key: string) => {
    if (!mountedRef.current) return;
    setErrorKey(key);
    setPhase('error');
  }, []);

  /** Rend la piste vidéo locale affichable par RTCView (et suit les redémarrages). */
  const bindPreview = useCallback((track: LocalVideoTrack) => {
    const refresh = () => {
      if (!mountedRef.current) return;
      // Après registerGlobals(), `mediaStream` est un MediaStream react-native-webrtc
      // (même approche que VideoTrack du SDK).
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
    };
    // Une seule préparation au montage ; « Réessayer » rappelle prepare().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Écran allumé pendant l'aperçu et le direct.
  useEffect(() => {
    if (phase === 'preview' || phase === 'connecting' || phase === 'live') {
      void activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => undefined);
    } else {
      deactivateKeepAwake(KEEP_AWAKE_TAG);
    }
  }, [phase]);

  const start = useCallback(async () => {
    const video = videoRef.current;
    const audio = audioRef.current;
    if (!video || !audio || phaseRef.current !== 'preview') return;
    setPhase('connecting');

    let creds: { token: string; url: string };
    try {
      creds = await fetchLiveToken(live.id, 'publisher');
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
      await room.localParticipant.publishTrack(video, {
        ...LIVE_VIDEO_PUBLISH,
        source: Track.Source.Camera,
      });
      await room.localParticipant.publishTrack(audio, { source: Track.Source.Microphone });
      if (!mountedRef.current) return;
      updateViewers();
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
      fail('live.rtc.errConnect');
    }
  }, [fail, live.id, releaseAll, t]);

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
    setPhase('ending');
    try {
      // Logique « Terminer » existante : status='ended', ended_at=now() (RLS propriétaire).
      await endStream(userId, live.id);
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
    await releaseAll();
    if (mountedRef.current) onEnded();
  }, [live.id, onEnded, releaseAll, t, userId]);

  const confirmEnd = useCallback(() => {
    Alert.alert(t('live.rtc.endConfirmTitle'), t('live.rtc.endConfirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('live.rtc.endConfirm'), style: 'destructive', onPress: () => void doEnd() },
    ]);
  }, [doEnd, t]);

  // Retour Android pendant le direct : on demande confirmation au lieu de couper net.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (phaseRef.current === 'live') {
        confirmEnd();
        return true;
      }
      return phaseRef.current === 'connecting' || phaseRef.current === 'ending';
    });
    return () => sub.remove();
  }, [confirmEnd]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        root: { flex: 1, backgroundColor: '#000' },
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
        title: {
          flex: 1,
          color: colors.onMedia,
          fontFamily: Fonts.bold,
          fontSize: 15,
          textShadowColor: 'rgba(0,0,0,0.6)',
          textShadowRadius: 4,
        },
        pill: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          paddingHorizontal: 10,
          paddingVertical: 5,
          borderRadius: Radii.pill,
          backgroundColor: 'rgba(11,11,11,0.55)',
        },
        pillText: { color: colors.onMedia, fontFamily: Fonts.medium, fontSize: 12 },
        banner: {
          position: 'absolute',
          top: insets.top + 64,
          alignSelf: 'center',
          paddingHorizontal: 14,
          paddingVertical: 6,
          borderRadius: Radii.pill,
          backgroundColor: 'rgba(209,127,42,0.9)',
        },
        bannerText: { color: colors.onAccent, fontFamily: Fonts.medium, fontSize: 13 },
        bottom: {
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: insets.bottom + Spacing.lg,
          paddingHorizontal: Spacing.lg,
          gap: Spacing.md,
        },
        controls: { flexDirection: 'row', justifyContent: 'center', gap: Spacing.lg },
        hint: {
          color: colors.onMedia,
          fontFamily: Fonts.regular,
          fontSize: 13,
          textAlign: 'center',
          opacity: 0.85,
        },
        overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(11,11,11,0.6)' },
      }),
    [colors, insets.bottom, insets.top],
  );

  const showVideo = !!streamUrl && phase !== 'error' && phase !== 'preparing';

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

      {phase === 'preparing' ? (
        <LiveCenterMessage busy body={t('live.rtc.preparing')} />
      ) : null}

      {phase === 'error' ? (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.noir }]}>
          <LiveErrorState
            messageKey={errorKey}
            onRetry={() => void prepare()}
            onClose={onClose}
          />
        </View>
      ) : null}

      {phase === 'connecting' || phase === 'ending' ? (
        <View style={styles.overlay}>
          <LiveCenterMessage
            busy
            body={phase === 'connecting' ? t('live.rtc.starting') : t('live.rtc.ending')}
          />
        </View>
      ) : null}

      {phase !== 'error' ? (
        <View style={styles.topBar}>
          {phase === 'live' ? <OnAirBadge label={t('live.rtc.onAir')} /> : null}
          <Text style={styles.title} numberOfLines={1}>
            {live.title}
          </Text>
          {phase === 'live' ? (
            <View style={styles.pill} accessibilityLabel={t('live.rtc.viewersNow', { count: viewers })}>
              <Text style={styles.pillText}>{t('live.rtc.viewersNow', { count: viewers })}</Text>
            </View>
          ) : null}
          {phase === 'preview' || phase === 'preparing' ? (
            <RoundIconButton icon="close" label={t('live.rtc.leave')} onPress={onClose} />
          ) : null}
        </View>
      ) : null}

      {reconnecting && phase === 'live' ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{t('live.rtc.reconnecting')}</Text>
        </View>
      ) : null}

      {phase === 'preview' || phase === 'live' ? (
        <View style={styles.bottom}>
          <View style={styles.controls}>
            <RoundIconButton
              icon="camera-reverse-outline"
              label={t('live.rtc.flipCamera')}
              onPress={() => void flip()}
              disabled={flipping}
            />
            <RoundIconButton
              icon={micMuted ? 'mic-off' : 'mic-outline'}
              label={micMuted ? t('live.rtc.unmute') : t('live.rtc.mute')}
              onPress={() => void toggleMic()}
              active={micMuted}
            />
          </View>
          {phase === 'preview' ? (
            <>
              <Text style={styles.hint}>{t('live.rtc.previewHint')}</Text>
              <Button title={t('live.rtc.startBroadcast')} variant="gold" onPress={() => void start()} />
            </>
          ) : (
            <Button title={t('live.rtc.end')} variant="outline" onPress={confirmEnd} />
          )}
        </View>
      ) : null}
    </View>
  );
}
