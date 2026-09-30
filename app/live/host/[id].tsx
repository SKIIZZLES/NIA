/**
 * `/live/host/[id]` — « Passer en direct » un live programmé (L1, écran L2
 * façon Instagram). La diffusion est dans components/live/LiveHostStage(.native).tsx ;
 * le direct instantané passe par `/live/go`.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { LiveHostStage } from '@/components/live/LiveHostStage';
import { LiveCenterMessage } from '@/components/live/LiveStageParts';
import { useAuth } from '@/context/AuthContext';
import { useI18n } from '@/context/I18nContext';
import { useColors } from '@/context/ThemeContext';
import { fetchLiveStreamById, type LiveStreamItem } from '@/lib/live';

export default function LiveHostScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const streamId = typeof id === 'string' ? id : Array.isArray(id) ? id[0] : '';
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { t } = useI18n();
  const colors = useColors();
  const [live, setLive] = useState<LiveStreamItem | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [msgKey, setMsgKey] = useState('live.notFound');

  useEffect(() => {
    if (authLoading) return undefined;
    let cancelled = false;
    (async () => {
      if (!streamId) {
        setState('error');
        return;
      }
      try {
        const item = await fetchLiveStreamById(streamId);
        if (cancelled) return;
        if (!item) {
          setMsgKey('live.notFound');
          setState('error');
        } else if (!user?.id || user.id !== item.userId) {
          setMsgKey('live.rtc.errForbidden');
          setState('error');
        } else if (item.status !== 'scheduled' && item.status !== 'live') {
          setMsgKey('live.rtc.errNotActive');
          setState('error');
        } else {
          setLive(item);
          setState('ready');
        }
      } catch {
        if (!cancelled) {
          setMsgKey('live.loadFail');
          setState('error');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, streamId, user?.id]);

  const close = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace(`/live/${streamId}` as Href);
  }, [router, streamId]);

  const ended = useCallback(
    (liveId: string) => {
      router.replace(`/live/${liveId || streamId}` as Href);
    },
    [router, streamId],
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.noir }]}>
      <StatusBar style="light" />
      {state === 'loading' ? <LiveCenterMessage busy /> : null}
      {state === 'error' ? (
        <LiveCenterMessage
          icon="alert-circle-outline"
          body={t(msgKey)}
          secondaryLabel={t('live.rtc.leave')}
          onSecondary={close}
        />
      ) : null}
      {state === 'ready' && live && user?.id ? (
        <LiveHostStage
          live={live}
          userId={user.id}
          hostHandle={live.hostHandle}
          onClose={close}
          onEnded={ended}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
