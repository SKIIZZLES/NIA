import React, { useMemo, useState } from 'react';
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
import { Colors, Fonts } from '@/constants/theme';
import { VideoItem } from '@/data/mockVideos';

type FeedTab = 'pour-toi' | 'abonnements' | 'afrique' | 'decouvrir';

const TABS: { key: FeedTab; label: string }[] = [
  { key: 'pour-toi', label: 'Pour toi' },
  { key: 'abonnements', label: 'Abonnements' },
  { key: 'afrique', label: 'Afrique' },
  { key: 'decouvrir', label: 'Découvrir' },
];

function filterVideos(videos: VideoItem[], tab: FeedTab): VideoItem[] {
  if (tab === 'pour-toi') return videos;
  const filtered = videos.filter((v) => v.tab === tab);
  return filtered.length ? filtered : videos;
}

export default function HomeScreen() {
  const { videos } = useFeed();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [tab, setTab] = useState<FeedTab>('pour-toi');
  const tabBarApprox = 64;
  const bottomInset = tabBarApprox;

  const data = useMemo(() => filterVideos(videos, tab), [videos, tab]);

  return (
    <View style={[styles.root, { height }]}>
      <FeedPager videos={data} bottomInset={bottomInset} />

      <View style={[styles.topTabs, { paddingTop: insets.top + 4 }]} pointerEvents="box-none">
        <View style={styles.tabsRow}>
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
    gap: 14,
    paddingHorizontal: 8,
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
