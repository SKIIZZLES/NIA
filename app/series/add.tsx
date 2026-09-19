/**
 * Ajouter une vidéo à une série (owner) — liste des séries + créer.
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
import { Button } from '@/components/Button';
import {
  addVideoToSeries,
  isSupabaseConfigured,
  listSeriesByUser,
  type SeriesListItem,
} from '@/lib/series';

export default function AddToSeriesScreen() {
  const { videoId: videoIdParam } = useLocalSearchParams<{ videoId?: string }>();
  const videoId =
    typeof videoIdParam === 'string'
      ? videoIdParam
      : Array.isArray(videoIdParam)
        ? videoIdParam[0]
        : '';
  const router = useRouter();
  const { user } = useAuth();
  const { t } = useI18n();
  const colors = useColors();
  const [series, setSeries] = useState<SeriesListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user?.id) {
      setSeries([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const list = await listSeriesByUser(user.id);
      setSeries(list);
    } catch {
      setSeries([]);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const onPick = async (item: SeriesListItem) => {
    if (!videoId) {
      Alert.alert(t('common.error'), t('series.missingVideo'));
      return;
    }
    if (!isSupabaseConfigured) {
      Alert.alert(t('common.error'), t('series.mockHint'));
      return;
    }
    setBusyId(item.id);
    try {
      const result = await addVideoToSeries(item.id, videoId);
      if (!result.ok) {
        Alert.alert(t('common.error'), result.message);
        return;
      }
      Alert.alert(t('series.addedTitle'), t('series.addedBody', { title: item.title }), [
        {
          text: 'OK',
          onPress: () => router.replace(`/series/${item.id}`),
        },
      ]);
    } finally {
      setBusyId(null);
    }
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
        hint: {
          color: colors.textMuted,
          fontFamily: Fonts.regular,
          fontSize: 13,
          paddingHorizontal: Spacing.lg,
          marginBottom: Spacing.sm,
        },
        row: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: Spacing.md,
          paddingHorizontal: Spacing.lg,
          paddingVertical: Spacing.sm,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: colors.border,
        },
        cover: {
          width: 56,
          height: 56,
          borderRadius: Radii.sm,
          backgroundColor: colors.noirSoft,
        },
        meta: { flex: 1 },
        title: {
          color: colors.sable,
          fontFamily: Fonts.medium,
          fontSize: 15,
        },
        sub: {
          color: colors.textMuted,
          fontFamily: Fonts.regular,
          fontSize: 12,
          marginTop: 2,
        },
        empty: {
          textAlign: 'center',
          color: colors.textMuted,
          fontFamily: Fonts.regular,
          marginTop: Spacing.xl,
          paddingHorizontal: Spacing.lg,
        },
        footer: { padding: Spacing.lg },
        center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
      }),
    [colors],
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={26} color={colors.sable} />
        </Pressable>
        <Text style={styles.topTitle}>{t('series.addTitle')}</Text>
      </View>
      <Text style={styles.hint}>{t('series.addHint')}</Text>
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.or} />
        </View>
      ) : (
        <FlatList
          data={series}
          keyExtractor={(i) => i.id}
          ListEmptyComponent={<Text style={styles.empty}>{t('series.emptyOwn')}</Text>}
          renderItem={({ item }) => (
            <Pressable
              style={styles.row}
              onPress={() => void onPick(item)}
              disabled={busyId === item.id}
            >
              {item.coverUrl ? (
                <Image source={{ uri: item.coverUrl }} style={styles.cover} />
              ) : (
                <View style={[styles.cover, { alignItems: 'center', justifyContent: 'center' }]}>
                  <Ionicons name="albums-outline" size={22} color={colors.or} />
                </View>
              )}
              <View style={styles.meta}>
                <Text style={styles.title} numberOfLines={1}>
                  {item.title}
                </Text>
                <Text style={styles.sub}>
                  {t('series.episodeCount', { count: item.episodeCount })}
                </Text>
              </View>
              {busyId === item.id ? (
                <ActivityIndicator color={colors.or} />
              ) : (
                <Ionicons name="add-circle-outline" size={24} color={colors.or} />
              )}
            </Pressable>
          )}
          ListFooterComponent={
            <View style={styles.footer}>
              <Button
                title={t('series.createCta')}
                variant="gold"
                onPress={() => router.push('/series/create')}
              />
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}
