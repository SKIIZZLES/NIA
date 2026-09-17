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
import { CommentsSheet } from './CommentsSheet';
import { Colors } from '@/constants/theme';
import { useFeed } from '@/context/FeedContext';

const { height: SCREEN_H } = Dimensions.get('window');

type Props = {
  videos: VideoItem[];
  bottomInset?: number;
};

export function FeedPager({ videos, bottomInset = 80 }: Props) {
  const { bumpCommentCount } = useFeed();
  const [activeId, setActiveId] = useState(videos[0]?.id);
  const [commentsVideoId, setCommentsVideoId] = useState<string | null>(null);
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

  const openComments = useCallback((videoId: string) => {
    setCommentsVideoId(videoId);
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: VideoItem }) => (
      <VideoCard
        item={item}
        isActive={item.id === activeId}
        bottomInset={bottomInset}
        onOpenComments={openComments}
      />
    ),
    [activeId, bottomInset, openComments],
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
    <View style={styles.root}>
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
      <CommentsSheet
        visible={!!commentsVideoId}
        videoId={commentsVideoId}
        onClose={() => setCommentsVideoId(null)}
        onCommentAdded={bumpCommentCount}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.noir },
  list: { flex: 1, backgroundColor: Colors.noir },
  empty: { backgroundColor: Colors.noir },
});
