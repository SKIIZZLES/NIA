import React, { useMemo, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FeedPager } from '@/components/FeedPager';
import { useFeed } from '@/context/FeedContext';
import { useI18n } from '@/context/I18nContext';
import { Colors, Fonts } from '@/constants/theme';
import { VideoItem } from '@/data/mockVideos';

type FeedTab = 'pour-toi' | 'abonnements' | 'afrique';

const TABS: { key: FeedTab; label: string }[] = [
  { key: 'pour-toi', label: 'Pour toi' },
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
  const { t } = useI18n();
  const { videos, followingIds } = useFeed();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [tab, setTab] = useState<FeedTab>('pour-toi');
  const tabBarApprox = 64;
  const bottomInset = tabBarApprox;

  const data = useMemo(
    () => filterVideos(videos, tab, followingIds),
    [videos, tab, followingIds],
  );

  return (
    <View style={[styles.root, { height }]}>
      <FeedPager videos={data} bottomInset={bottomInset} />

      <View style={[styles.topTabs, { paddingTop: insets.top + 4 }]} pointerEvents="box-none">
        <View style={styles.tabsRow}>
          <View style={styles.tabsSpacer} />
          {TABS.map((t) => {
            const active = t.key === tab;
            return (
              <Pressable key={t.key} onPress={() => setTab(t.key)} style={styles.tabItem}>
                <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>
                  {t.label}
                </Text>
                {active ? <View style={styles.underline} /> : null}
              </Pressable>
            );
          })}
          <Pressable
            style={styles.searchBtn}
            onPress={() => router.push('/search')}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={t('search.openA11y')}
          >
            <Ionicons name="search" size={22} color={Colors.sable} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.noir,
  },
  topTabs: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  tabsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 8,
  },
  tabsSpacer: {
    width: 36,
  },
  searchBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabItem: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  tabLabel: {
    color: Colors.textMuted,
    fontFamily: Fonts.medium,
    fontSize: 14,
  },
  tabLabelActive: {
    color: Colors.sable,
    fontFamily: Fonts.bold,
  },
  underline: {
    marginTop: 4,
    height: 2,
    width: '80%',
    backgroundColor: Colors.or,
    borderRadius: 1,
  },
});
