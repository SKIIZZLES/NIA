import React, { useMemo, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FeedPager } from '@/components/FeedPager';
import { useFeed } from '@/context/FeedContext';
import { useI18n } from '@/context/I18nContext';
import { Fonts, MEDIA_TOKENS, TAB_BAR_BASE_HEIGHT } from '@/constants/theme';
import { useColors } from '@/context/ThemeContext';
import { NiaWordmark } from '@/components/NiaWordmark';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from 'expo-router';
import { setStatusBarStyle } from 'expo-status-bar';
import { VideoItem } from '@/data/mockVideos';

type FeedTab = 'pour-toi' | 'abonnements' | 'afrique';

const TABS: { key: FeedTab; label: string }[] = [
  { key: 'pour-toi', label: 'Pour vous' },
  { key: 'abonnements', label: 'Abonnements' },
  { key: 'afrique', label: 'Afrique' },
];

function filterVideos(
  videos: VideoItem[],
  tab: FeedTab,
  followingIds: Set<string>,
): VideoItem[] {
  if (tab === 'pour-toi') return videos;
  if (tab === 'afrique') {
    const filtered = videos.filter((v) => v.tab === 'afrique' || v.category === 'afrique');
    return filtered.length ? filtered : videos;
  }
  // Abonnements : prioriser les créateurs suivis ; sinon tag legacy / démo
  if (followingIds.size > 0) {
    const followed = videos.filter(
      (v) => v.userId && followingIds.has(v.userId),
    );
    if (followed.length) return followed;
  }
  const tagged = videos.filter((v) => v.tab === 'abonnements');
  return tagged.length ? tagged : videos;
}

export default function HomeScreen() {
  const router = useRouter();
  const colors = useColors();
  const { t } = useI18n();
  const { videos, followingIds } = useFeed();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [tab, setTab] = useState<FeedTab>('pour-toi');
  useFocusEffect(React.useCallback(() => {
    setStatusBarStyle('light');
    return () => setStatusBarStyle(colors.isDark ? 'light' : 'dark');
  }, [colors.isDark]));
  // Doit correspondre exactement à la barre d'onglets, sinon le paging se décale
  const bottomInset = TAB_BAR_BASE_HEIGHT + insets.bottom;

  const data = useMemo(
    () => filterVideos(videos, tab, followingIds),
    [videos, tab, followingIds],
  );

  return (
    <View style={[styles.root, { height, backgroundColor: colors.noir }]}>
      <FeedPager videos={data} bottomInset={bottomInset} />

      <View style={[styles.topTabs, { paddingTop: insets.top + 4 }]} pointerEvents="box-none">
        <LinearGradient
          colors={['rgba(24,17,12,0.68)', 'rgba(24,17,12,0.58)', 'transparent']}
          locations={[0, 0.72, 1]}
          style={[StyleSheet.absoluteFill, { bottom: -36 }]}
          pointerEvents="none"
        />
        <View style={styles.brandRow}>
          <NiaWordmark size={28} onMedia />
          <Pressable
            style={styles.searchBtn}
            onPress={() => router.push('/search')}
            accessibilityRole="button"
            accessibilityLabel={t('search.openA11y')}
          >
            <Ionicons name="search-outline" size={22} color={MEDIA_TOKENS.onMedia} />
          </Pressable>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsRow}>
          {TABS.map((t) => {
            const active = t.key === tab;
            return (
              <Pressable key={t.key} onPress={() => setTab(t.key)} style={styles.tabItem}
                accessibilityRole="tab" accessibilityState={{ selected: active }} aria-selected={active}>
                <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>
                  {t.label}
                </Text>
                {active ? <View style={styles.underline} /> : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  topTabs: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  tabsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 24,
    paddingHorizontal: 20,
  },
  searchBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabItem: {
    alignItems: 'center',
    paddingVertical: 8,
    minHeight: 44,
  },
  tabLabel: {
    color: MEDIA_TOKENS.onMediaMuted,
    fontFamily: Fonts.medium,
    fontSize: 15,
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  tabLabelActive: {
    color: MEDIA_TOKENS.onMedia,
    fontFamily: Fonts.bold,
  },
  underline: {
    marginTop: 4,
    height: 2,
    width: 22,
    backgroundColor: MEDIA_TOKENS.onMediaAccent,
    borderRadius: 1,
  },
});
