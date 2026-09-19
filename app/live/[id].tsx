/**
 * Détail live — placeholder NIA honnête (pas de faux player).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/Button';
import { NiaWordmark } from '@/components/NiaWordmark';
import { useAuth } from '@/context/AuthContext';
import { useI18n } from '@/context/I18nContext';
import { useColors } from '@/context/ThemeContext';
import { Fonts, Radii, Spacing } from '@/constants/theme';
import { LIVE_CATEGORIES } from '@/constants/liveCategories';
import {
  fetchLiveStreamById,
  endStream,
  isSupabaseConfigured,
  type LiveStreamItem,
} from '@/lib/live';
import { formatCount } from '@/data/mockVideos';

function formatWhen(iso: string | null, locale: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const tag = locale.startsWith('fr') ? 'fr-FR' : undefined;
  return d.toLocaleString(tag, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function LiveDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const streamId = typeof id === 'string' ? id : Array.isArray(id) ? id[0] : '';
  const router = useRouter();
  const { user } = useAuth();
  const { t, locale } = useI18n();
  const colors = useColors();
  const [stream, setStream] = useState<LiveStreamItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!streamId) {
      setError(t('live.notFound'));
      setLoading(false);
      return;
    }
    if (!isSupabaseConfigured) {
      setError(t('live.notFound'));
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const item = await fetchLiveStreamById(streamId);
      if (!item) {
        setError(t('live.notFound'));
        setStream(null);
      } else {
        setStream(item);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('live.loadFail'));
      setStream(null);
    } finally {
      setLoading(false);
    }
  }, [streamId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const onEnd = async () => {
    if (!user?.id || !stream) return;
    setBusy(true);
    try {
      const updated = await endStream(user.id, stream.id);
      if (updated) setStream(updated);
      else await load();
    } catch (e) {
      Alert.alert(
        t('common.error'),
        e instanceof Error ? e.message : t('live.endFail'),
      );
    } finally {
      setBusy(false);
    }
  };

  const openHost = () => {
    if (!stream?.hostHandle) return;
    const handle = stream.hostHandle.replace(/^@/, '');
    if (!handle) return;
    router.push(`/user/${handle}`);
  };

  const categoryLabel = useMemo(() => {
    if (!stream) return '';
    const cat = LIVE_CATEGORIES.find((c) => c.id === stream.category);
    return cat ? t(cat.labelKey) : stream.category;
  }, [stream, t]);

  const isOwner = !!(user?.id && stream && user.id === stream.userId);
  const showPlaceholder =
    stream?.status === 'live' || stream?.status === 'scheduled';

  const styles = useMemo(
    () =>
      StyleSheet.create({
        safe: { flex: 1, backgroundColor: colors.noir },
        topBar: {
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: Spacing.md,
          paddingVertical: Spacing.sm,
          gap: 8,
        },
        backBtn: {
          width: 36,
          height: 36,
          alignItems: 'center',
          justifyContent: 'center',
        },
        topTitle: {
          color: colors.sable,
          fontFamily: Fonts.bold,
          fontSize: 17,
          flex: 1,
        },
        placeholder: {
          marginHorizontal: Spacing.lg,
          marginTop: Spacing.sm,
          minHeight: 220,
          borderRadius: Radii.lg,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.noirElevated,
          alignItems: 'center',
          justifyContent: 'center',
          padding: Spacing.lg,
          gap: 12,
        },
        placeholderTitle: {
          color: colors.or,
          fontFamily: Fonts.bold,
          fontSize: 16,
          textAlign: 'center',
        },
        placeholderBody: {
          color: colors.textSecondary,
          fontFamily: Fonts.regular,
          fontSize: 13,
          textAlign: 'center',
          lineHeight: 19,
        },
        endedBox: {
          marginHorizontal: Spacing.lg,
          marginTop: Spacing.sm,
          height: 160,
          borderRadius: Radii.lg,
          backgroundColor: colors.noirSoft,
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        },
        cover: { width: '100%', height: '100%' },
        body: {
          paddingHorizontal: Spacing.lg,
          paddingTop: Spacing.md,
          paddingBottom: Spacing.xxl,
          gap: Spacing.sm,
        },
        title: {
          color: colors.sable,
          fontFamily: Fonts.bold,
          fontSize: 24,
        },
        handle: {
          color: colors.or,
          fontFamily: Fonts.medium,
          fontSize: 15,
        },
        meta: {
          color: colors.textSecondary,
          fontFamily: Fonts.regular,
          fontSize: 14,
          lineHeight: 20,
        },
        rowMeta: {
          flexDirection: 'row',
          alignItems: 'flex-start',
          gap: 8,
          marginTop: 4,
        },
        desc: {
          color: colors.sable,
          fontFamily: Fonts.regular,
          fontSize: 15,
          lineHeight: 22,
          marginTop: Spacing.sm,
        },
        catBadge: {
          alignSelf: 'flex-start',
          paddingHorizontal: 10,
          paddingVertical: 4,
          borderRadius: Radii.pill,
          backgroundColor: 'rgba(209, 127, 42, 0.16)',
          borderWidth: 1,
          borderColor: colors.border,
          marginTop: Spacing.sm,
        },
        catBadgeText: {
          color: colors.or,
          fontFamily: Fonts.medium,
          fontSize: 12,
        },
        statusBadge: {
          alignSelf: 'flex-start',
          paddingHorizontal: 10,
          paddingVertical: 4,
          borderRadius: Radii.pill,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.noirSoft,
        },
        statusLive: {
          backgroundColor: 'rgba(220, 38, 38, 0.2)',
          borderColor: 'rgba(220, 38, 38, 0.45)',
        },
        statusText: {
          color: colors.textSecondary,
          fontFamily: Fonts.medium,
          fontSize: 12,
        },
        statusTextLive: { color: '#f87171' },
        actions: {
          marginTop: Spacing.lg,
          gap: Spacing.sm,
        },
        center: {
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          padding: Spacing.lg,
        },
        err: {
          color: colors.textSecondary,
          fontFamily: Fonts.regular,
          fontSize: 14,
          textAlign: 'center',
        },
      }),
    [colors],
  );

  const statusLabel = () => {
    if (!stream) return '';
    if (stream.status === 'live') return t('live.statusLive');
    if (stream.status === 'scheduled') return t('live.statusScheduled');
    if (stream.status === 'ended') return t('live.statusEnded');
    return t('live.statusCancelled');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <Pressable
          onPress={() => router.back()}
          style={styles.backBtn}
          hitSlop={8}
          accessibilityLabel={t('common.back')}
        >
          <Ionicons name="chevron-back" size={24} color={colors.sable} />
        </Pressable>
        <Text style={styles.topTitle}>{t('live.detailTitle')}</Text>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.or} />
        </View>
      ) : error || !stream ? (
        <View style={styles.center}>
          <Text style={styles.err}>{error || t('live.notFound')}</Text>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false}>
          {showPlaceholder ? (
            <View style={styles.placeholder} accessibilityRole="text">
              <NiaWordmark size={40} />
              <Ionicons name="radio-outline" size={40} color={colors.or} />
              <Text style={styles.placeholderTitle}>{t('live.soonBanner')}</Text>
              <Text style={styles.placeholderBody}>
                {t('live.placeholderBody')}
              </Text>
            </View>
          ) : (
            <View style={styles.endedBox}>
              {stream.thumbnailUrl ? (
                <Image
                  source={{ uri: stream.thumbnailUrl }}
                  style={styles.cover}
                />
              ) : (
                <Ionicons name="radio-outline" size={40} color={colors.or} />
              )}
            </View>
          )}

          <View style={styles.body}>
            <View
              style={[
                styles.statusBadge,
                stream.status === 'live' && styles.statusLive,
              ]}
            >
              <Text
                style={[
                  styles.statusText,
                  stream.status === 'live' && styles.statusTextLive,
                ]}
              >
                {statusLabel()}
              </Text>
            </View>

            <Text style={styles.title}>{stream.title}</Text>
            <Pressable onPress={openHost}>
              <Text style={styles.handle}>
                {t('live.hostedBy', { handle: stream.hostHandle })}
              </Text>
            </Pressable>
            <View style={styles.catBadge}>
              <Text style={styles.catBadgeText}>{categoryLabel}</Text>
            </View>

            {stream.scheduledAt ? (
              <View style={styles.rowMeta}>
                <Ionicons name="time-outline" size={18} color={colors.or} />
                <Text style={styles.meta}>
                  {t('live.scheduledLabel')}: {formatWhen(stream.scheduledAt, locale)}
                </Text>
              </View>
            ) : null}

            <View style={styles.rowMeta}>
              <Ionicons name="eye-outline" size={18} color={colors.or} />
              <Text style={styles.meta}>
                {t('live.viewers', {
                  count: formatCount(stream.viewerCount),
                })}
              </Text>
            </View>

            {stream.description ? (
              <Text style={styles.desc}>{stream.description}</Text>
            ) : null}

            {isOwner &&
            (stream.status === 'live' || stream.status === 'scheduled') ? (
              <View style={styles.actions}>
                <Button
                  title={t('live.endStream')}
                  variant="outline"
                  loading={busy}
                  onPress={() => void onEnd()}
                />
              </View>
            ) : null}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
