/**
 * Recherche unifiée NIA V2.4 — Tout | Personnes | Publications | Sons | Événements | Hashtags.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { MediaThumb } from '@/components/MediaThumb';
import { useI18n } from '@/context/I18nContext';
import { useColors } from '@/context/ThemeContext';
import { Fonts, Radii, Spacing } from '@/constants/theme';
import { formatCount, type VideoItem } from '@/data/mockVideos';
import {
  isSearchEmpty,
  SEARCH_TABS,
  unifiedSearch,
  type SearchHashtag,
  type SearchPerson,
  type SearchTab,
  type UnifiedSearchResults,
} from '@/lib/search';
import type { SoundItem } from '@/lib/sounds';
import type { EventItem } from '@/lib/events';

const EMPTY_RESULTS: UnifiedSearchResults = {
  people: [],
  publications: [],
  sounds: [],
  events: [],
  hashtags: [],
};

function paramString(v: string | string[] | undefined): string {
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && v[0]) return v[0];
  return '';
}

function isSearchTab(v: string): v is SearchTab {
  return (SEARCH_TABS as string[]).includes(v);
}

type ListRow =
  | { kind: 'section'; key: string; title: string }
  | { kind: 'person'; key: string; item: SearchPerson }
  | { kind: 'publication'; key: string; item: VideoItem }
  | { kind: 'sound'; key: string; item: SoundItem }
  | { kind: 'event'; key: string; item: EventItem }
  | { kind: 'hashtag'; key: string; item: SearchHashtag };

export default function SearchScreen() {
  const router = useRouter();
  const { t } = useI18n();
  const colors = useColors();
  const params = useLocalSearchParams<{ q?: string; tab?: string }>();
  const initialQ = paramString(params.q);
  const initialTab = isSearchTab(paramString(params.tab))
    ? (paramString(params.tab) as SearchTab)
    : 'all';

  const [query, setQuery] = useState(initialQ);
  const [tab, setTab] = useState<SearchTab>(initialTab);
  const [results, setResults] = useState<UnifiedSearchResults>(EMPTY_RESULTS);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    const q = paramString(params.q);
    if (q && q !== query) setQuery(q);
    const tb = paramString(params.tab);
    if (isSearchTab(tb) && tb !== tab) setTab(tb);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync from URL only
  }, [params.q, params.tab]);

  const runSearch = useCallback(
    async (raw: string, activeTab: SearchTab) => {
      const q = raw.trim();
      if (!q) {
        setResults(EMPTY_RESULTS);
        setSearched(false);
        setLoading(false);
        setError(null);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const data = await unifiedSearch(q, { tab: activeTab, limit: 20 });
        setResults(data);
        setSearched(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : t('search.loadFail'));
        setResults(EMPTY_RESULTS);
        setSearched(true);
      } finally {
        setLoading(false);
      }
    },
    [t],
  );

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (!q) {
      setResults(EMPTY_RESULTS);
      setSearched(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(() => {
      void runSearch(q, tab);
    }, 320);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, tab, runSearch]);

  useEffect(() => {
    const tmr = setTimeout(() => inputRef.current?.focus(), 250);
    return () => clearTimeout(tmr);
  }, []);

  const tabLabels = useMemo(
    () =>
      ({
        all: t('search.tabAll'),
        people: t('search.tabPeople'),
        publications: t('search.tabPublications'),
        sounds: t('search.tabSounds'),
        events: t('search.tabEvents'),
        hashtags: t('search.tabHashtags'),
      }) as Record<SearchTab, string>,
    [t],
  );

  const rows: ListRow[] = useMemo(() => {
    const out: ListRow[] = [];
    const showSection = tab === 'all';

    if (tab === 'all' || tab === 'people') {
      if (results.people.length) {
        if (showSection) {
          out.push({ kind: 'section', key: 'sec-people', title: t('search.sectionPeople') });
        }
        for (const item of results.people) {
          out.push({ kind: 'person', key: `p-${item.id}`, item });
        }
      }
    }
    if (tab === 'all' || tab === 'publications') {
      if (results.publications.length) {
        if (showSection) {
          out.push({
            kind: 'section',
            key: 'sec-pubs',
            title: t('search.sectionPublications'),
          });
        }
        for (const item of results.publications) {
          out.push({ kind: 'publication', key: `v-${item.id}`, item });
        }
      }
    }
    if (tab === 'all' || tab === 'sounds') {
      if (results.sounds.length) {
        if (showSection) {
          out.push({ kind: 'section', key: 'sec-sounds', title: t('search.sectionSounds') });
        }
        for (const item of results.sounds) {
          out.push({ kind: 'sound', key: `s-${item.id}`, item });
        }
      }
    }
    if (tab === 'all' || tab === 'events') {
      if (results.events.length) {
        if (showSection) {
          out.push({ kind: 'section', key: 'sec-events', title: t('search.sectionEvents') });
        }
        for (const item of results.events) {
          out.push({ kind: 'event', key: `e-${item.id}`, item });
        }
      }
    }
    if (tab === 'all' || tab === 'hashtags') {
      if (results.hashtags.length) {
        if (showSection) {
          out.push({
            kind: 'section',
            key: 'sec-tags',
            title: t('search.sectionHashtags'),
          });
        }
        for (const item of results.hashtags) {
          out.push({ kind: 'hashtag', key: `h-${item.tag}`, item });
        }
      }
    }
    return out;
  }, [results, tab, t]);

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
        searchBox: {
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          backgroundColor: colors.noirSoft,
          borderRadius: Radii.pill,
          borderWidth: 1,
          borderColor: colors.border,
          paddingHorizontal: 14,
          paddingVertical: 10,
        },
        input: {
          flex: 1,
          color: colors.sable,
          fontFamily: Fonts.regular,
          fontSize: 16,
          padding: 0,
        },
        chipsWrap: { paddingBottom: Spacing.sm },
        chipsRow: {
          paddingHorizontal: Spacing.md,
          flexDirection: 'row',
          alignItems: 'center',
        },
        chip: {
          paddingHorizontal: 12,
          paddingVertical: 8,
          borderRadius: Radii.pill,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.noirSoft,
          marginRight: 8,
        },
        chipOn: {
          borderColor: colors.or,
          backgroundColor: 'rgba(201, 162, 39, 0.18)',
        },
        chipText: {
          color: colors.textSecondary,
          fontFamily: Fonts.medium,
          fontSize: 13,
        },
        chipTextOn: { color: colors.or },
        list: { paddingHorizontal: Spacing.md, paddingBottom: Spacing.xxl },
        section: {
          marginTop: Spacing.md,
          marginBottom: Spacing.sm,
          color: colors.textSecondary,
          fontFamily: Fonts.medium,
          fontSize: 12,
          letterSpacing: 0.4,
          textTransform: 'uppercase',
        },
        row: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingVertical: 12,
          paddingHorizontal: 10,
          marginBottom: 6,
          borderRadius: Radii.md,
          backgroundColor: colors.noirElevated,
          borderWidth: 1,
          borderColor: colors.border,
        },
        avatar: {
          width: 44,
          height: 44,
          borderRadius: 22,
          backgroundColor: colors.noirSoft,
        },
        thumb: {
          width: 44,
          height: 58,
          borderRadius: Radii.sm,
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
        rowBody: { flex: 1, minWidth: 0 },
        rowTitle: {
          color: colors.sable,
          fontFamily: Fonts.bold,
          fontSize: 15,
        },
        rowMeta: {
          marginTop: 2,
          color: colors.textSecondary,
          fontFamily: Fonts.regular,
          fontSize: 12,
        },
        empty: {
          alignItems: 'center',
          paddingVertical: Spacing.xxl,
          paddingHorizontal: Spacing.lg,
          gap: 10,
        },
        emptyTitle: {
          color: colors.sable,
          fontFamily: Fonts.bold,
          fontSize: 17,
          textAlign: 'center',
        },
        emptyBody: {
          color: colors.textMuted,
          fontFamily: Fonts.regular,
          fontSize: 13,
          textAlign: 'center',
          lineHeight: 18,
        },
        hint: {
          color: colors.textMuted,
          fontFamily: Fonts.regular,
          fontSize: 13,
          textAlign: 'center',
          paddingHorizontal: Spacing.lg,
          paddingTop: Spacing.xl,
          lineHeight: 18,
        },
        error: {
          color: colors.or,
          fontFamily: Fonts.regular,
          fontSize: 13,
          textAlign: 'center',
          padding: Spacing.md,
        },
        loadingWrap: { paddingVertical: Spacing.xl, alignItems: 'center' },
      }),
    [colors],
  );

  const onPerson = (p: SearchPerson) => {
    router.push(`/user/${p.username}`);
  };
  const onPublication = (v: VideoItem) => {
    router.push(`/video/${v.id}`);
  };
  const onSound = (s: SoundItem) => {
    router.push(`/sound/${s.id}`);
  };
  const onEvent = (e: EventItem) => {
    router.push(`/events/${e.id}`);
  };
  const onHashtag = (h: SearchHashtag) => {
    setTab('publications');
    setQuery(h.tag);
    router.setParams({ q: h.tag, tab: 'publications' });
  };

  const showEmpty =
    searched && !loading && !error && isSearchEmpty(results) && query.trim().length > 0;
  const showHint = !query.trim() && !loading;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <Pressable
          style={styles.backBtn}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
        >
          <Ionicons name="chevron-back" size={24} color={colors.sable} />
        </Pressable>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={18} color={colors.textMuted} />
          <TextInput
            ref={inputRef}
            style={styles.input}
            value={query}
            onChangeText={setQuery}
            placeholder={t('search.placeholder')}
            placeholderTextColor={colors.textMuted}
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel={t('search.placeholder')}
            onSubmitEditing={() => void runSearch(query, tab)}
          />
          {query.length > 0 ? (
            <Pressable onPress={() => setQuery('')} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color={colors.textMuted} />
            </Pressable>
          ) : null}
        </View>
      </View>

      <View style={styles.chipsWrap}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsRow}
        >
          {SEARCH_TABS.map((id) => {
            const on = tab === id;
            return (
              <Pressable
                key={id}
                style={[styles.chip, on && styles.chipOn]}
                onPress={() => setTab(id)}
              >
                <Text style={[styles.chipText, on && styles.chipTextOn]}>
                  {tabLabels[id]}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {showHint ? (
        <View style={styles.empty}>
          <Ionicons name="search-outline" size={44} color={colors.or} />
          <Text style={styles.emptyTitle}>{t('search.title')}</Text>
          <Text style={styles.hint}>{t('search.hint')}</Text>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.key}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            loading ? (
              <View style={styles.loadingWrap}>
                <ActivityIndicator color={colors.or} />
                <Text style={[styles.emptyBody, { marginTop: 10 }]}>
                  {t('common.loading')}
                </Text>
              </View>
            ) : null
          }
          ListEmptyComponent={
            showEmpty ? (
              <View style={styles.empty}>
                <Ionicons name="compass-outline" size={40} color={colors.or} />
                <Text style={styles.emptyTitle}>{t('search.emptyTitle')}</Text>
                <Text style={styles.emptyBody}>{t('search.emptyBody')}</Text>
              </View>
            ) : null
          }
          renderItem={({ item }) => {
            if (item.kind === 'section') {
              return <Text style={styles.section}>{item.title}</Text>;
            }
            if (item.kind === 'person') {
              const p = item.item;
              return (
                <Pressable style={styles.row} onPress={() => onPerson(p)}>
                  <Image source={{ uri: p.avatarUrl }} style={styles.avatar} />
                  <View style={styles.rowBody}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {p.displayName}
                    </Text>
                    <Text style={styles.rowMeta} numberOfLines={1}>
                      @{p.username}
                      {p.bio ? ` · ${p.bio}` : ''}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                </Pressable>
              );
            }
            if (item.kind === 'publication') {
              const v = item.item;
              return (
                <Pressable style={styles.row} onPress={() => onPublication(v)}>
                  <MediaThumb
                    thumbnailUrl={v.thumbnailUrl}
                    mediaType={v.mediaType}
                    videoUrl={v.videoUrl}
                    style={styles.thumb}
                  />
                  <View style={styles.rowBody}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {v.handle}
                    </Text>
                    <Text style={styles.rowMeta} numberOfLines={2}>
                      {v.caption || t('search.noCaption')}
                    </Text>
                  </View>
                  <Text style={styles.rowMeta}>{formatCount(v.likes)}</Text>
                </Pressable>
              );
            }
            if (item.kind === 'sound') {
              const s = item.item;
              return (
                <Pressable style={styles.row} onPress={() => onSound(s)}>
                  <View style={styles.iconWrap}>
                    <Ionicons name="musical-notes" size={22} color={colors.or} />
                  </View>
                  <View style={styles.rowBody}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {s.title}
                    </Text>
                    <Text style={styles.rowMeta} numberOfLines={1}>
                      {s.handle} · {t('sound.useCount', { count: formatCount(s.useCount) })}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                </Pressable>
              );
            }
            if (item.kind === 'event') {
              const e = item.item;
              return (
                <Pressable style={styles.row} onPress={() => onEvent(e)}>
                  <View style={styles.iconWrap}>
                    <Ionicons name="calendar-outline" size={22} color={colors.or} />
                  </View>
                  <View style={styles.rowBody}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {e.title}
                    </Text>
                    <Text style={styles.rowMeta} numberOfLines={1}>
                      {[e.city, e.organizerHandle].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                </Pressable>
              );
            }
            const h = item.item;
            return (
              <Pressable style={styles.row} onPress={() => onHashtag(h)}>
                <View style={styles.iconWrap}>
                  <Ionicons name="pricetag-outline" size={20} color={colors.or} />
                </View>
                <View style={styles.rowBody}>
                  <Text style={styles.rowTitle}>#{h.tag}</Text>
                  <Text style={styles.rowMeta}>{t('search.hashtagHint')}</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
              </Pressable>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}
