import React, { useCallback, useRef, useState } from 'react';
import {
  Dimensions,
  FlatList,
  StyleSheet,
  View,
  ViewToken,
} from 'react-native';
import { VideoItem } from '@/data/mockVideos';
import { VideoCard } from './VideoCard';
import { Colors } from '@/constants/theme';

const { height: SCREEN_H } = Dimensions.get('window');

type Props = {
  videos: VideoItem[];
  bottomInset?: number;
};

export function FeedPager({ videos, bottomInset = 80 }: Props) {
  const [activeId, setActiveId] = useState(videos[0]?.id);
  const itemH = SCREEN_H - bottomInset;

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      const first = viewableItems[0];
      if (first?.item) setActiveId((first.item as VideoItem).id);
    },
  ).current;

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 80,
  }).current;

  const renderItem = useCallback(
    ({ item }: { item: VideoItem }) => (
      <VideoCard item={item} isActive={item.id === activeId} bottomInset={bottomInset} />
    ),
    [activeId, bottomInset],
  );

  const getItemLayout = useCallback(
    (_: unknown, index: number) => ({
      length: itemH,
      offset: itemH * index,
      index,
    }),
    [itemH],
  );

  if (!videos.length) {
    return <View style={[styles.empty, { height: itemH }]} />;
  }

  return (
    <FlatList
      data={videos}
      keyExtractor={(v) => v.id}
      renderItem={renderItem}
      pagingEnabled
      showsVerticalScrollIndicator={false}
      snapToInterval={itemH}
      decelerationRate="fast"
      getItemLayout={getItemLayout}
      onViewableItemsChanged={onViewableItemsChanged}
      viewabilityConfig={viewabilityConfig}
      windowSize={3}
      style={styles.list}
    />
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: Colors.noir },
  empty: { backgroundColor: Colors.noir },
});
