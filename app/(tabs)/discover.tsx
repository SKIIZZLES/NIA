import { MediaThumb } from '@/components/MediaThumb';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Fonts, Radii, Spacing } from '@/constants/theme';
import { useColors } from '@/context/ThemeContext';
import { useI18n } from '@/context/I18nContext';
import { DISCOVER_CATEGORIES, type CategoryId } from '@/constants/categories';
import { useFeed } from '@/context/FeedContext';
import { DEMO_VIDEOS, type VideoItem, formatCount } from '@/data/mockVideos';
import { isSupabaseConfigured } from '@/lib/supabase';
import { fetchVideosFromSupabase } from '@/lib/videos';

/**
 * Découvrir — logique « contenu d'abord » (type Explorer Instagram / TikTok) :
 * recherche, raccourcis Lives/Événements, puces d'univers, puis grille de vidéos.
 */

const GRID_GAP = 2;
const COLUMNS = 3;

export default function DiscoverScreen() {
  const { videos: feedVideos } = useFeed();
  const colors = useColors();
  const router = useRouter();
  const { t } = useI18n();
  const { width } = useWindowDimensions();
  const [selected, setSelected] = useState<CategoryId | null>(null);
  const [remoteByCategory, setRemoteByCategory] = useState<VideoItem[]>([]);
  const [loadingRemote, setLoadingRemote] = useState(false);

  const tileW = (width - GRID_GAP * (COLUMNS - 1)) / COLUMNS;
  const tileH = Math.round(tileW * 1.4);

  const loadCategoryVideos = useCallback(async (categoryId: CategoryId) => {
    if (!isSupabaseConfigured) {
      setRemoteByCategory([]);
      return;
    }
    setLoadingRemote(true);
    try {
      const rows = await fetchVideosFromSupabase({ category: categoryId, limit: 30 });
      setRemoteByCategory(rows);
    } catch {
      setRemoteByCategory([]);
    } finally {
      setLoadingRemote(false);
    }
  }, []);

  useEffect(() => {
    if (selected) {
      void loadCategoryVideos(selected);
    } else {
      setRemoteByCategory([]);
    }
  }, [selected, loadCategoryVideos]);

  /** « Tout » = vidéos du fil triées par j'aime ; sinon filtre par univers. */
  const gridVideos = useMemo(() => {
    if (!selected) {
      const base = feedVideos.length || isSupabaseConfigured ? feedVideos : DEMO_VIDEOS;
      return [...base].sort((a, b) => (b.likes ?? 0) - (a.likes ?? 0));
    }
    if (isSupabaseConfigured) {
      if (remoteByCategory.length) return remoteByCategory;
      return feedVideos.filter((v) => v.category === selected);
    }
    const fromFeed = feedVideos.filter((v) => v.category === selected);
    if (fromFeed.length) return fromFeed;
    return DEMO_VIDEOS.filter((v) => v.category === selected);
  }, [selected, remoteByCategory, feedVideos]);

  const chips = useMemo(
    () => [
      { id: null as CategoryId | null, label: t('discover.allChip'), icon: 'sparkles-outline' as const },
      ...DISCOVER_CATEGORIES.map((c) => ({ id: c.id as CategoryId | null, label: c.label, icon: c.icon })),
    ],
    [t],
  );

  const styles = useMemo(
    () =>
      StyleSheet.create({
        safe: { flex: 1, backgroundColor: colors.noir },
        header: { paddingHorizontal: Spacing.md, paddingTop: Spacing.sm },
        title: {
          color: colors.sable,
          fontFamily: Fonts.bold,
          fontSize: 24,
          marginBottom: Spacing.md,
        },
        searchBox: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          height: 46,
          backgroundColor: colors.noirSoft,
          borderRadius: Radii.md,
          paddingHorizontal: 14,
        },
        searchText: {
          flex: 1,
          color: colors.textMuted,
          fontFamily: Fonts.regular,
          fontSize: 15,
        },
        shortcuts: {
          flexDirection: 'row',
          gap: 10,
          marginTop: Spacing.md,
        },
        shortcut: {
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          height: 56,
          paddingHorizontal: 12,
          borderRadius: Radii.md,
          backgroundColor: colors.noirElevated,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.border,
        },
        shortcutIcon: {
          width: 32,
          height: 32,
          borderRadius: 16,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.noirSoft,
        },
        liveDot: {
          position: 'absolute',
          top: 2,
          right: 2,
          width: 8,
          height: 8,
          borderRadius: 4,
          backgroundColor: colors.rougeTerre,
          borderWidth: 1.5,
          borderColor: colors.noirElevated,
        },
        shortcutLabel: {
          color: colors.sable,
          fontFamily: Fonts.bold,
          fontSize: 14,
        },
        chipsRow: {
          gap: 8,
          paddingHorizontal: Spacing.md,
          paddingVertical: Spacing.md,
        },
        chip: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          height: 36,
          paddingHorizontal: 14,
          borderRadius: Radii.pill,
          backgroundColor: colors.noirSoft,
        },
        chipActive: { backgroundColor: colors.or },
        chipLabel: {
          color: colors.sable,
          fontFamily: Fonts.medium,
          fontSize: 13,
        },
        chipLabelActive: { color: colors.onAccent, fontFamily: Fonts.bold },
        tile: { width: tileW, height: tileH },
        tileThumb: { width: tileW, height: tileH, borderRadius: 0 },
        tileMeta: {
          position: 'absolute',
          left: 6,
          bottom: 6,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 3,
        },
        tileCount: {
          color: colors.onMedia,
          fontFamily: Fonts.bold,
          fontSize: 12,
          textShadowColor: 'rgba(0,0,0,0.6)',
          textShadowOffset: { width: 0, height: 1 },
          textShadowRadius: 3,
        },
        row: { gap: GRID_GAP },
        rowSpacer: { height: GRID_GAP },
        empty: {
          alignItems: 'center',
          paddingVertical: Spacing.xxl,
          paddingHorizontal: Spacing.lg,
          gap: 10,
        },
        emptyTitle: { color: colors.sable, fontFamily: Fonts.bold, fontSize: 16 },
        emptyBody: {
          color: colors.textMuted,
          fontFamily: Fonts.regular,
          fontSize: 13,
          textAlign: 'center',
          lineHeight: 18,
        },
      }),
    [colors, tileW, tileH],
  );

  const header = (
    <View>
      <View style={styles.header}>
        <Text style={styles.title}>{t('discover.title')}</Text>
        <Pressable
          style={styles.searchBox}
          onPress={() => router.push('/search')}
          accessibilityRole="button"
          accessibilityLabel={t('search.openA11y')}
        >
          <Ionicons name="search" size={19} color={colors.textMuted} />
          <Text style={styles.searchText} numberOfLines={1}>
            {t('search.placeholder')}
          </Text>
        </Pressable>

        <View style={styles.shortcuts}>
          <Pressable
            style={styles.shortcut}
            onPress={() => router.push('/live')}
            accessibilityRole="button"
            accessibilityLabel={t('live.openList')}
          >
            <View style={styles.shortcutIcon}>
              <Ionicons name="radio-outline" size={18} color={colors.or} />
              <View style={styles.liveDot} />
            </View>
            <Text style={styles.shortcutLabel}>{t('live.discoverCta')}</Text>
          </Pressable>
          <Pressable
            style={styles.shortcut}
            onPress={() => router.push('/events')}
            accessibilityRole="button"
            accessibilityLabel={t('events.openList')}
          >
            <View style={styles.shortcutIcon}>
              <Ionicons name="calendar-outline" size={18} color={colors.or} />
            </View>
            <Text style={styles.shortcutLabel}>{t('events.discoverCta')}</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipsRow}
      >
        {chips.map((c) => {
          const active = selected === c.id;
          return (
            <Pressable
              key={c.id ?? 'all'}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => setSelected(c.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Ionicons
                name={c.icon}
                size={15}
                color={active ? colors.onAccent : colors.or}
              />
              <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>
                {c.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <FlatList
        data={loadingRemote ? [] : gridVideos}
        keyExtractor={(v) => v.id}
        numColumns={COLUMNS}
        columnWrapperStyle={styles.row}
        ItemSeparatorComponent={() => <View style={styles.rowSpacer} />}
        ListHeaderComponent={header}
        showsVerticalScrollIndicator={false}
        initialNumToRender={9}
        windowSize={5}
        renderItem={({ item: v }) => (
          <Pressable
            style={styles.tile}
            onPress={() => router.push(`/video/${v.id}`)}
            accessibilityRole="button"
            accessibilityLabel={t('discover.tileA11y', {
              handle: v.handle,
              count: formatCount(v.likes),
            })}
          >
            <MediaThumb
              thumbnailUrl={v.thumbnailUrl}
              mediaType={v.mediaType}
              videoUrl={v.videoUrl}
              style={styles.tileThumb}
              showVideoBadge={false}
            />
            <View style={styles.tileMeta} pointerEvents="none">
              <Ionicons name="heart" size={11} color={colors.onMedia} />
              <Text style={styles.tileCount}>{formatCount(v.likes)}</Text>
            </View>
          </Pressable>
        )}
        ListEmptyComponent={
          loadingRemote ? (
            <ActivityIndicator color={colors.or} style={{ marginVertical: Spacing.xl }} />
          ) : (
            <View style={styles.empty}>
              <Ionicons name="compass-outline" size={36} color={colors.or} />
              <Text style={styles.emptyTitle}>{t('discover.emptyTitle')}</Text>
              <Text style={styles.emptyBody}>{t('discover.emptyBody')}</Text>
            </View>
          )
        }
      />
    </SafeAreaView>
  );
}
