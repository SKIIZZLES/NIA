/**
 * Écran spectateur `/live/watch/[id]` (sprint L1, natif).
 *
 * « Rejoindre » → jeton viewer (abonnement seul) via live-token → connexion
 * LiveKit → vidéo plein écran de l'hôte (identité = user_id du live) et son.
 * États : attente de l'hôte, reconnexion, live terminé, erreur avec Réessayer.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { VideoTrack, type TrackReference } from '@livekit/react-native';
import {
  DisconnectReason,
  Room,
  RoomEvent,
  Track,
  type RemoteParticipant,
} from 'livekit-client';
import {
  LiveCenterMessage,
  LiveErrorState,
  OnAirBadge,
  RoundIconButton,
} from '@/components/live/LiveStageParts';
import type { LiveViewerStageProps } from '@/components/live/types';
import { useI18n } from '@/context/I18nContext';
import { useColors } from '@/context/ThemeContext';
import { Fonts, Radii, Spacing } from '@/constants/theme';
import { fetchLiveStreamById } from '@/lib/live';
import { LiveTokenError, fetchLiveToken, liveTokenErrorKey } from '@/lib/liveToken';
import {
  VIEWER_ROOM_OPTIONS,
  ensureLiveKitGlobals,
  startViewerAudio,
  stopLiveAudio,
} from '@/lib/liveRtcNative';

type Phase = 'idle' | 'joining' | 'watching' | 'ended' | 'error';

const KEEP_AWAKE_TAG = 'nia-live-viewer';

export function LiveViewerStage({ live, onClose }: LiveViewerStageProps) {
  const { t } = useI18n();
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const [phase, setPhase] = useState<Phase>(
    live.status === 'ended' || live.status === 'cancelled' ? 'ended' : 'idle',
  );
  const [errorKey, setErrorKey] = useState('live.rtc.errServer');
  const [hostTrack, setHostTrack] = useState<TrackReference | null>(null);
  const [hostPresent, setHostPresent] = useState(false);
  const [viewers, setViewers] = useState(0);
  const [reconnecting, setReconnecting] = useState(false);

  const mountedRef = useRef(true);
  const roomRef = useRef<Room | null>(null);
  const hostIdentity = live.userId.toLowerCase();

  const leaveRoom = useCallback(async () => {
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
    await stopLiveAudio();
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      deactivateKeepAwake(KEEP_AWAKE_TAG);
      void leaveRoom();
    };
  }, [leaveRoom]);

  useEffect(() => {
    if (phase === 'watching') {
      void activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => undefined);
    } else {
      deactivateKeepAwake(KEEP_AWAKE_TAG);
    }
  }, [phase]);

  const refresh = useCallback(
    (room: Room) => {
      if (!mountedRef.current || roomRef.current !== room) return;
      let host: RemoteParticipant | undefined;
      room.remoteParticipants.forEach((p) => {
        if (p.identity.toLowerCase() === hostIdentity) host = p;
      });
      setHostPresent(!!host);
      // Spectateurs = participants sauf l'hôte, soi compris.
      setViewers(room.remoteParticipants.size - (host ? 1 : 0) + 1);
      const pub = host?.getTrackPublication(Track.Source.Camera);
      if (host && pub && pub.isSubscribed && pub.track && !pub.isMuted) {
        setHostTrack({ participant: host, publication: pub, source: Track.Source.Camera });
      } else {
        setHostTrack(null);
      }
    },
    [hostIdentity],
  );

  /** L'hôte est parti : live terminé (endStream) ou simple coupure ? */
  const checkEnded = useCallback(async () => {
    try {
      const fresh = await fetchLiveStreamById(live.id);
      if (!mountedRef.current) return;
      if (!fresh || fresh.status === 'ended' || fresh.status === 'cancelled') {
        await leaveRoom();
        if (mountedRef.current) {
          setHostTrack(null);
          setPhase('ended');
        }
      }
    } catch {
      // réseau : on reste en attente de l'hôte
    }
  }, [leaveRoom, live.id]);

  const join = useCallback(async () => {
    setPhase('joining');
    setReconnecting(false);
    setHostTrack(null);
    try {
      ensureLiveKitGlobals();
    } catch {
      setErrorKey('live.rtc.errConnect');
      setPhase('error');
      return;
    }

    let creds: { token: string; url: string };
    try {
      creds = await fetchLiveToken(live.id, 'viewer');
    } catch (e) {
      if (!mountedRef.current) return;
      if (e instanceof LiveTokenError && e.code === 'not_active') {
        setPhase('ended');
        return;
      }
      setErrorKey(e instanceof LiveTokenError ? liveTokenErrorKey(e.code) : 'live.rtc.errServer');
      setPhase('error');
      return;
    }

    const room = new Room(VIEWER_ROOM_OPTIONS);
    roomRef.current = room;
    const onChange = () => refresh(room);
    room
      .on(RoomEvent.ParticipantConnected, onChange)
      .on(RoomEvent.ParticipantDisconnected, (p: RemoteParticipant) => {
        onChange();
        if (p.identity.toLowerCase() === hostIdentity) void checkEnded();
      })
      .on(RoomEvent.TrackSubscribed, onChange)
      .on(RoomEvent.TrackUnsubscribed, onChange)
      .on(RoomEvent.TrackMuted, onChange)
      .on(RoomEvent.TrackUnmuted, onChange)
      .on(RoomEvent.TrackPublished, onChange)
      .on(RoomEvent.TrackUnpublished, onChange)
      .on(RoomEvent.Reconnecting, () => mountedRef.current && setReconnecting(true))
      .on(RoomEvent.Reconnected, () => {
        if (!mountedRef.current) return;
        setReconnecting(false);
        onChange();
      })
      .on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
        if (!mountedRef.current || roomRef.current !== room) return;
        roomRef.current = null;
        void stopLiveAudio();
        setHostTrack(null);
        if (reason === DisconnectReason.ROOM_DELETED) {
          setPhase('ended');
        } else {
          setErrorKey('live.rtc.errDisconnected');
          setPhase('error');
        }
      });

    try {
      await startViewerAudio();
      await room.connect(creds.url, creds.token, { autoSubscribe: true });
      if (!mountedRef.current) return;
      setPhase('watching');
      refresh(room);
    } catch {
      if (!mountedRef.current) return;
      await leaveRoom();
      setErrorKey('live.rtc.errConnect');
      setPhase('error');
    }
  }, [checkEnded, hostIdentity, leaveRoom, live.id, refresh]);

  const leave = useCallback(() => {
    void leaveRoom();
    onClose();
  }, [leaveRoom, onClose]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        root: { flex: 1, backgroundColor: '#000' },
        cover: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.noir },
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
        titleWrap: { flex: 1 },
        title: {
          color: colors.onMedia,
          fontFamily: Fonts.bold,
          fontSize: 15,
          textShadowColor: 'rgba(0,0,0,0.6)',
          textShadowRadius: 4,
        },
        host: {
          color: colors.or,
          fontFamily: Fonts.medium,
          fontSize: 13,
          textShadowColor: 'rgba(0,0,0,0.6)',
          textShadowRadius: 4,
        },
        pill: {
          paddingHorizontal: 10,
          paddingVertical: 5,
          borderRadius: Radii.pill,
          backgroundColor: 'rgba(11,11,11,0.55)',
        },
        pillText: { color: colors.onMedia, fontFamily: Fonts.medium, fontSize: 12 },
        banner: {
          position: 'absolute',
          top: insets.top + 72,
          alignSelf: 'center',
          paddingHorizontal: 14,
          paddingVertical: 6,
          borderRadius: Radii.pill,
          backgroundColor: 'rgba(209,127,42,0.9)',
        },
        bannerText: { color: colors.onAccent, fontFamily: Fonts.medium, fontSize: 13 },
      }),
    [colors, insets.top],
  );

  const onAir = phase === 'watching' && !!hostTrack;

  return (
    <View style={styles.root}>
      {phase === 'watching' && hostTrack ? (
        <VideoTrack trackRef={hostTrack} style={StyleSheet.absoluteFill} objectFit="cover" zOrder={0} />
      ) : (
        <View style={styles.cover}>
          {phase === 'idle' ? (
            <LiveCenterMessage
              icon="radio-outline"
              body={t('live.rtc.joinHint')}
              primaryLabel={t('live.rtc.join')}
              onPrimary={() => void join()}
            />
          ) : null}
          {phase === 'joining' ? <LiveCenterMessage busy body={t('live.rtc.joining')} /> : null}
          {phase === 'watching' && !hostTrack ? (
            <LiveCenterMessage
              busy
              body={hostPresent ? t('live.rtc.hostPaused') : t('live.rtc.waitingHost')}
            />
          ) : null}
          {phase === 'ended' ? (
            <LiveCenterMessage
              icon="checkmark-circle-outline"
              title={t('live.rtc.ended')}
              secondaryLabel={t('live.rtc.leave')}
              onSecondary={leave}
            />
          ) : null}
          {phase === 'error' ? (
            <LiveErrorState messageKey={errorKey} onRetry={() => void join()} onClose={leave} />
          ) : null}
        </View>
      )}

      <View style={styles.topBar}>
        {onAir ? <OnAirBadge label={t('live.rtc.onAir')} /> : null}
        <View style={styles.titleWrap}>
          <Text style={styles.title} numberOfLines={1}>
            {live.title}
          </Text>
          <Text style={styles.host} numberOfLines={1}>
            {live.hostHandle}
          </Text>
        </View>
        {phase === 'watching' ? (
          <View style={styles.pill}>
            <Text style={styles.pillText}>{t('live.rtc.viewersNow', { count: viewers })}</Text>
          </View>
        ) : null}
        <RoundIconButton icon="close" label={t('live.rtc.leave')} onPress={leave} />
      </View>

      {reconnecting && phase === 'watching' ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{t('live.rtc.reconnecting')}</Text>
        </View>
      ) : null}
    </View>
  );
}
