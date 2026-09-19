import { MediaThumb } from '@/components/MediaThumb';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Fonts, Radii, Spacing } from '@/constants/theme';
import { useColors } from '@/context/ThemeContext';
import {
  DISCOVER_CATEGORIES,
  type CategoryId,
  type DiscoverCategory,
} from '@/constants/categories';
import { useFeed } from '@/context/FeedContext';
import { DEMO_VIDEOS, type VideoItem, formatCount } from '@/data/mockVideos';
import { isSupabaseConfigured } from '@/lib/supabase';
import { fetchVideosFromSupabase } from '@/lib/videos';

export default function DiscoverScreen() {
  const { videos: feedVideos } = useFeed();
  const colors = useColors();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<CategoryId | null>(null);
  const [remoteByCategory, setRemoteByCategory] = useState<VideoItem[]>([]);
  const [loadingRemote, setLoadingRemote] = useState(false);

  const filteredCategories = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return DISCOVER_CATEGORIES;
    return DISCOVER_CATEGORIES.filter(
      (c) =>
        c.label.toLowerCase().includes(q) ||
        c.blurb.toLowerCase().includes(q) ||
        c.id.includes(q),
    );
  }, [query]);

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

  /** Mock : filtre feed / démos par category. Supabase : remote puis feed (pas de DEMO). */
  const categoryVideos = useMemo(() => {
    if (!selected) return [];
    if (isSupabaseConfigured) {
      if (remoteByCategory.length) return remoteByCategory;
      return feedVideos.filter((v) => v.category === selected);
    }
    const fromFeed = feedVideos.filter((v) => v.category === selected);
    if (fromFeed.length) return fromFeed;
    return DEMO_VIDEOS.filter((v) => v.category === selected);
  }, [selected, remoteByCategory, feedVideos]);

  const onSelectCategory = (item: DiscoverCategory) => {
    setSelected((prev) => (prev === item.id ? null : item.id));
  };

  const styles = useMemo(() => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.noir, paddingHorizontal: Spacing.lg },
  title: {
    color: colors.sable,
    fontFamily: Fonts.bold,
    fontSize: 28,
    marginTop: Spacing.md,
  },
  subtitle: {
    color: colors.textSecondary,
    fontFamily: Fonts.regular,
    fontSize: 13,
    marginTop: 6,
    marginBottom: Spacing.md,
    lineHeight: 18,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.noirSoft,
    borderRadius: Radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  input: {
    flex: 1,
    color: colors.sable,
    fontFamily: Fonts.regular,
    fontSize: 16,
  },
  section: {
    marginTop: Spacing.xl,
    marginBottom: Spacing.sm,
    color: colors.textSecondary,
    fontFamily: Fonts.medium,
    fontSize: 13,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  listContent: { paddingBottom: Spacing.xxl },
  resultsBlock: {
    marginBottom: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radii.md,
    backgroundColor: colors.noirElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  resultsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.sm,
  },
  resultsTitle: {
    color: colors.sable,
    fontFamily: Fonts.bold,
    fontSize: 16,
  },
  clearFilter: {
    color: colors.or,
    fontFamily: Fonts.medium,
    fontSize: 13,
  },
  emptyCat: {
    color: colors.textMuted,
    fontFamily: Fonts.regular,
    fontSize: 13,
    marginVertical: 8,
  },
  mockHint: {
    marginTop: 8,
    color: colors.textMuted,
    fontFamily: Fonts.regular,
    fontSize: 11,
  },
  thumbCard: {
    width: 120,
  },
  thumb: {
    width: 120,
    height: 180,
    borderRadius: Radii.sm,
    backgroundColor: colors.noirSoft,
  },
  thumbHandle: {
    marginTop: 6,
    color: colors.sable,
    fontFamily: Fonts.medium,
    fontSize: 12,
  },
  thumbMeta: {
    color: colors.textMuted,
    fontFamily: Fonts.regular,
    fontSize: 11,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 12,
    marginBottom: 8,
    borderRadius: Radii.md,
    backgroundColor: colors.noirElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardActive: {
    borderColor: colors.or,
    backgroundColor: colors.noirSoft,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: Radii.sm,
    backgroundColor: colors.noirSoft,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(201, 162, 39, 0.35)',
  },
  iconWrapActive: {
    backgroundColor: colors.or,
    borderColor: colors.or,
  },
  cardBody: { flex: 1 },
  cardTitle: {
    color: colors.sable,
    fontFamily: Fonts.bold,
    fontSize: 15,
  },
  cardBlurb: {
    marginTop: 3,
    color: colors.textSecondary,
    fontFamily: Fonts.regular,
    fontSize: 12,
    lineHeight: 16,
  },
  empty: {
    alignItems: 'center',
    paddingVertical: Spacing.xxl,
    paddingHorizontal: Spacing.md,
    gap: 10,
  },
  emptyTitle: {
    color: colors.sable,
    fontFamily: Fonts.bold,
    fontSize: 16,
  },
  emptyBody: {
    color: colors.textMuted,
    fontFamily: Fonts.regular,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  footerNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radii.md,
    backgroundColor: colors.noirElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  footerText: {
    flex: 1,
    color: colors.textMuted,
    fontFamily: Fonts.regular,
    fontSize: 12,
    lineHeight: 17,
  },
}), [colors]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Text style={styles.title}>Découvrir</Text>
      <Text style={styles.subtitle}>
        Explorez les scènes, cultures et talents — filtrez par univers.
      </Text>

      <View style={styles.searchBox}>
        <Ionicons name="search" size={20} color={colors.textMuted} />
        <TextInput
          style={styles.input}
          value={query}
          onChangeText={setQuery}
          placeholder="Catégories, scènes, thèmes…"
          placeholderTextColor={colors.textMuted}
          accessibilityLabel="Recherche dans Découvrir"
        />
        {query.length > 0 ? (
          <Pressable onPress={() => setQuery('')} hitSlop={8}>
            <Ionicons name="close-circle" size={18} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>

      <Text style={styles.section}>Univers</Text>

      <FlatList
        data={filteredCategories}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          selected ? (
            <View style={styles.resultsBlock}>
              <View style={styles.resultsHeader}>
                <Text style={styles.resultsTitle}>
                  {DISCOVER_CATEGORIES.find((c) => c.id === selected)?.label}
                </Text>
                <Pressable onPress={() => setSelected(null)} hitSlop={8}>
                  <Text style={styles.clearFilter}>Effacer</Text>
                </Pressable>
              </View>
              {loadingRemote ? (
                <ActivityIndicator color={colors.or} style={{ marginVertical: 16 }} />
              ) : categoryVideos.length === 0 ? (
                <Text style={styles.emptyCat}>
                  Aucune vidéo dans cet univers pour l’instant.
                </Text>
              ) : (
                <FlatList
                  data={categoryVideos}
                  keyExtractor={(v) => v.id}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: 10, paddingBottom: 8 }}
                  renderItem={({ item: v }) => (
                    <View style={styles.thumbCard}>
                      <MediaThumb
                        thumbnailUrl={v.thumbnailUrl}
                        mediaType={v.mediaType}
                        videoUrl={v.videoUrl}
                        style={styles.thumb}
                      />
                      <Text style={styles.thumbHandle} numberOfLines={1}>
                        {v.handle}
                      </Text>
                      <Text style={styles.thumbMeta} numberOfLines={1}>
                        {formatCount(v.likes)} likes
                      </Text>
                    </View>
                  )}
                />
              )}
              {!isSupabaseConfigured ? (
                <Text style={styles.mockHint}>Mode mock — catégories locales.</Text>
              ) : null}
            </View>
          ) : null
        }
        renderItem={({ item }) => {
          const active = selected === item.id;
          return (
            <Pressable
              style={[styles.card, active && styles.cardActive]}
              onPress={() => onSelectCategory(item)}
            >
              <View style={[styles.iconWrap, active && styles.iconWrapActive]}>
                <Ionicons
                  name={item.icon}
                  size={22}
                  color={active ? colors.noir : colors.or}
                />
              </View>
              <View style={styles.cardBody}>
                <Text style={styles.cardTitle}>{item.label}</Text>
                <Text style={styles.cardBlurb}>{item.blurb}</Text>
              </View>
              <Ionicons
                name="chevron-forward"
                size={18}
                color={colors.textMuted}
              />
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="compass-outline" size={40} color={colors.or} />
            <Text style={styles.emptyTitle}>Aucun univers trouvé</Text>
            <Text style={styles.emptyBody}>
              Essayez un autre mot-clé. La recherche full-text arrive bientôt.
            </Text>
          </View>
        }
        ListFooterComponent={
          <View style={styles.footerNote}>
            <Ionicons name="sparkles-outline" size={16} color={colors.or} />
            <Text style={styles.footerText}>
              Filtre sur `videos.category` (migration 002) quand Supabase est
              configuré ; sinon démos par catégorie.
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

