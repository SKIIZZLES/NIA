/**
 * `/live/go` — direct instantané façon Instagram Live (L2).
 * Ouvert depuis l'onglet Live de la caméra, le hub Créer et le hub Live.
 * La ligne live_streams est créée au moment d'appuyer sur le bouton rond
 * (voir components/live/LiveHostStage.native.tsx).
 */
import React, { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { LiveHostStage } from '@/components/live/LiveHostStage';
import { LiveCenterMessage } from '@/components/live/LiveStageParts';
import { useAuth } from '@/context/AuthContext';
import { useI18n } from '@/context/I18nContext';
import { useColors } from '@/context/ThemeContext';
import { isSupabaseConfigured } from '@/lib/live';

export default function LiveGoScreen() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const { t } = useI18n();
  const colors = useColors();

  const close = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)' as Href);
  }, [router]);

  const ended = useCallback(
    (liveId: string) => {
      router.replace(`/live/${liveId}` as Href);
    },
    [router],
  );

  const schedule = useCallback(() => {
    router.replace('/live/create' as Href);
  }, [router]);

  return (
    <View style={[styles.root, { backgroundColor: colors.noir }]}>
      <StatusBar style="light" />
      {loading ? <LiveCenterMessage busy /> : null}
      {!loading && (!user?.id || !isSupabaseConfigured) ? (
        <LiveCenterMessage
          icon="person-circle-outline"
          body={t('live.go.loginRequired')}
          primaryLabel={t('live.go.login')}
          onPrimary={() => router.replace('/(auth)/login' as Href)}
          secondaryLabel={t('live.rtc.leave')}
          onSecondary={close}
        />
      ) : null}
      {!loading && user?.id && isSupabaseConfigured ? (
        <LiveHostStage
          live={null}
          userId={user.id}
          hostHandle={`@${user.username}`}
          onClose={close}
          onEnded={ended}
          onSchedule={schedule}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
