/**
 * Détail série — titre + liste d'épisodes (tap → vidéo).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/context/AuthContext';
import { useI18n } from '@/context/I18nContext';
import { useColors } from '@/context/ThemeContext';
import { Fonts, Radii, Spacing } from '@/constants/theme';
import { MediaThumb } from '@/components/MediaThumb';
import {
  deleteSeries,
  fetchSeriesById,
  isSupabaseConfigured,
  removeVideoFromSeries,
  type SeriesDetail,
  type SeriesEpisode,
} from '@/lib/series';

export default function SeriesDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const seriesId = typeof id === 'string' ? id : Array.isArray(id) ? id[0] : '';
  const router = useRouter();
  const { user } = useAuth();
  const { t } = useI18n();
  const colors = useColors();
  const [series, setSeries] = useState<SeriesDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!seriesId) {
      setError(t('series.notFound'));
      setLoading(false);
      return;
    }
    if (!isSupabaseConfigured) {
      setError(t('series.notFound'));
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const item = await fetchSeriesById(seriesId);
      if (!item) {
        setError(t('series.notFound'));
        setSeries(null);
      } else {
        setSeries(item);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('series.loadFail'));
      setSeries(null);
    } finally {
      setLoading(false);
    }
  }, [seriesId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const isOwner = !!user?.id && !!series && user.id === series.userId;

  const onRemoveEpisode = (videoId: string) => {
    if (!series || !isOwner) return;
    Alert.alert(t('series.removeEpisodeTitle'), t('series.removeEpisodeBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('series.removeEpisode'),
        style: 'destructive',
        onPress: () => {
          void (async () => {
            const result = await removeVideoFromSeries(series.id, videoId);
            if (!result.ok) {
              Alert.alert(t('common.error'), result.message);
              return;
            }
            void load();
          })();
        },
      },
    ]);
  };

  const onDeleteSeries = () => {
    if (!series || !isOwner) return;
    Alert.alert(t('series.deleteTitle'), t('series.deleteBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('series.delete'),
        style: 'destructive',
        onPress: () => {
          void (async () => {
            const result = await deleteSeries(series.id);
            if (!result.ok) {
              Alert.alert(t('common.error'), result.message);
              return;
            }
            router.back();
          })();
        },
      },
    ]);
  };

  const styles = useMemo(
    () =>
      StyleSheet.create({
        safe: { flex: 1, backgroundColor: colors.noir },
        topBar: {
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: Spacing.md,
          paddingVertical: Spacing.sm,
          gap: Spacing.sm,
        },
        backBtn: { padding: 6 },
        topTitle: {
          flex: 1,
          color: colors.sable,
          fontFamily: Fonts.bold,
          fontSize: 18,
        },
        center: {
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          padding: Spacing.lg,
        },
        err: {
          color: colors.textMuted,
          fontFamily: Fonts.regular,
          textAlign: 'center',
        },
        header: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.md },
        cover: {
          width: '100%',
          height: 180,
          borderRadius: Radii.md,
          backgroundColor: colors.noirSoft,
          marginBottom: Spacing.md,
        },
        title: {
          color: colors.sable,
          fontFamily: Fonts.bold,
          fontSize: 22,
        },
        meta: {
          color: colors.textMuted,
          fontFamily: Fonts.regular,
          fontSize: 13,
          marginTop: 4,
        },
        desc: {
          color: colors.sable,
          fontFamily: Fonts.regular,
          fontSize: 14,
          marginTop: Spacing.sm,
          lineHeight: 20,
        },
        deleteBtn: { marginTop: Spacing.md, alignSelf: 'flex-start' },
        deleteText: {
          color: colors.danger,
          fontFamily: Fonts.medium,
          fontSize: 13,
        },
        episodeRow: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: Spacing.sm,
          paddingHorizontal: Spacing.lg,
          paddingVertical: Spacing.sm,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: colors.border,
        },
        epNum: {
          width: 28,
          color: colors.or,
          fontFamily: Fonts.bold,
          fontSize: 14,
          textAlign: 'center',
        },
        thumb: {
          width: 64,
          height: 64 * (16 / 9),
          borderRadius: Radii.sm,
          overflow: 'hidden',
          backgroundColor: colors.noirSoft,
        },
        epMeta: { flex: 1, gap: 4 },
        epCaption: {
          color: colors.sable,
          fontFamily: Fonts.medium,
          fontSize: 14,
        },
        epSub: {
          color: colors.textMuted,
          fontFamily: Fonts.regular,
          fontSize: 12,
        },
        removeBtn: { padding: 8 },
        empty: {
          textAlign: 'center',
          color: colors.textMuted,
          fontFamily: Fonts.regular,
          marginTop: Spacing.lg,
          paddingHorizontal: Spacing.lg,
        },
      }),
    [colors],
  );

  const renderEpisode = ({ item }: { item: SeriesEpisode }) => (
    <Pressable
      style={styles.episodeRow}
      onPress={() => router.push(`/video/${item.video.id}`)}
      onLongPress={isOwner ? () => onRemoveEpisode(item.video.id) : undefined}
    >
      <Text style={styles.epNum}>{item.position}</Text>
      <MediaThumb
        thumbnailUrl={item.video.thumbnailUrl}
        mediaType={item.video.mediaType}
        videoUrl={item.video.videoUrl}
        style={styles.thumb}
      />
      <View style={styles.epMeta}>
        <Text style={styles.epCaption} numberOfLines={2}>
          {item.video.caption || t('series.episodeLabel', { n: item.position })}
        </Text>
        <Text style={styles.epSub}>{t('series.episodeLabel', { n: item.position })}</Text>
      </View>
      {isOwner ? (
        <Pressable
          style={styles.removeBtn}
          onPress={() => onRemoveEpisode(item.video.id)}
          hitSlop={8}
        >
          <Ionicons name="remove-circle-outline" size={22} color={colors.danger} />
        </Pressable>
      ) : null}
    </Pressable>
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.topBar}>
          <Pressable style={styles.backBtn} onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={26} color={colors.sable} />
          </Pressable>
          <Text style={styles.topTitle}>{t('series.detailTitle')}</Text>
        </View>
        <View style={styles.center}>
          <ActivityIndicator color={colors.or} />
        </View>
      </SafeAreaView>
    );
  }

  if (error || !series) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.topBar}>
          <Pressable style={styles.backBtn} onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={26} color={colors.sable} />
          </Pressable>
          <Text style={styles.topTitle}>{t('series.detailTitle')}</Text>
        </View>
        <View style={styles.center}>
          <Text style={styles.err}>{error || t('series.notFound')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={26} color={colors.sable} />
        </Pressable>
        <Text style={styles.topTitle} numberOfLines={1}>
          {series.title}
        </Text>
      </View>
      <FlatList
        data={series.episodes}
        keyExtractor={(item) => `${item.position}-${item.video.id}`}
        ListHeaderComponent={
          <View style={styles.header}>
            {series.coverUrl ? (
              <Image source={{ uri: series.coverUrl }} style={styles.cover} />
            ) : (
              <View style={[styles.cover, { alignItems: 'center', justifyContent: 'center' }]}>
                <Ionicons name="albums-outline" size={40} color={colors.or} />
              </View>
            )}
            <Text style={styles.title}>{series.title}</Text>
            <Text style={styles.meta}>
              {series.ownerHandle} ·{' '}
              {t('series.episodeCount', { count: series.episodeCount })}
            </Text>
            {series.description ? <Text style={styles.desc}>{series.description}</Text> : null}
            {isOwner ? (
              <Pressable style={styles.deleteBtn} onPress={onDeleteSeries}>
                <Text style={styles.deleteText}>{t('series.delete')}</Text>
              </Pressable>
            ) : null}
          </View>
        }
        ListEmptyComponent={<Text style={styles.empty}>{t('series.emptyEpisodes')}</Text>}
        renderItem={renderEpisode}
      />
    </SafeAreaView>
  );
}
