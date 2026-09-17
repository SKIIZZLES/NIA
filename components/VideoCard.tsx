import React, { useEffect, useRef, useState } from 'react';
import {
  Dimensions,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Video, ResizeMode, AVPlaybackStatus } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '@/constants/theme';
import { formatCount, VideoItem } from '@/data/mockVideos';
import { useFeed } from '@/context/FeedContext';
import { useAuth } from '@/context/AuthContext';
import { FollowButton } from '@/components/FollowButton';

const { height: SCREEN_H, width: SCREEN_W } = Dimensions.get('window');

type Props = {
  item: VideoItem;
  isActive: boolean;
  bottomInset?: number;
  onOpenComments?: (videoId: string) => void;
};

export function VideoCard({
  item,
  isActive,
  bottomInset = 80,
  onOpenComments,
}: Props) {
  const videoRef = useRef<Video>(null);
  const { user } = useAuth();
  const { toggleLike, likedIds, followingIds, toggleFollow } = useFeed();
  const liked = likedIds.has(item.id);
  const authorId = item.userId;
  const following = authorId ? followingIds.has(authorId) : false;
  const isOwn =
    !!user &&
    (!!authorId
      ? authorId === user.id
      : item.handle === `@${user.username}`);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    (async () => {
      if (!videoRef.current) return;
      try {
        if (isActive) {
          await videoRef.current.playAsync();
        } else {
          await videoRef.current.pauseAsync();
          await videoRef.current.setPositionAsync(0);
        }
      } catch {
        // ignore playback race
      }
    })();
  }, [isActive]);

  const onStatus = (_status: AVPlaybackStatus) => {};

  return (
    <View style={[styles.container, { height: SCREEN_H - bottomInset }]}>
      <Video
        ref={videoRef}
        style={StyleSheet.absoluteFill}
        source={{ uri: item.videoUrl }}
        resizeMode={ResizeMode.COVER}
        isLooping
        isMuted={muted}
        shouldPlay={isActive}
        onPlaybackStatusUpdate={onStatus}
      />
      <View style={styles.gradient} pointerEvents="none" />

      {/* Right rail */}
      <View style={styles.rail}>
        <View style={styles.avatarWrap}>
          <Image source={{ uri: item.avatarUrl }} style={styles.avatar} />
          {authorId && !isOwn ? (
            <View style={styles.followBadge}>
              <FollowButton
                following={following}
                compact
                onPress={() => toggleFollow(authorId)}
              />
            </View>
          ) : null}
        </View>
        <RailAction
          icon={liked ? 'heart' : 'heart-outline'}
          color={liked ? '#E74C3C' : Colors.sable}
          label={formatCount(item.likes)}
          onPress={() => toggleLike(item.id)}
        />
        <RailAction
          icon="chatbubble-outline"
          label={formatCount(item.comments)}
          onPress={() => onOpenComments?.(item.id)}
        />
        <RailAction icon="arrow-redo-outline" label={formatCount(item.shares)} />
        <Pressable onPress={() => setMuted((m) => !m)} style={styles.muteBtn}>
          <Ionicons
            name={muted ? 'volume-mute' : 'volume-high'}
            size={22}
            color={Colors.sable}
          />
        </Pressable>
      </View>

      {/* Caption */}
      <View style={styles.meta}>
        <Text style={styles.handle}>{item.handle}</Text>
        <Text style={styles.caption} numberOfLines={3}>
          {item.caption}
        </Text>
        {item.country ? (
          <Text style={styles.country}>{item.country}</Text>
        ) : null}
      </View>
    </View>
  );
}

function RailAction({
  icon,
  label,
  onPress,
  color = Colors.sable,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress?: () => void;
  color?: string;
}) {
  return (
    <Pressable onPress={onPress} style={styles.railItem}>
      <Ionicons name={icon} size={28} color={color} />
      <Text style={styles.railLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    width: SCREEN_W,
    backgroundColor: Colors.noir,
    overflow: 'hidden',
  },
  gradient: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'transparent',
    borderBottomWidth: 180,
    borderBottomColor: Colors.overlay,
  },
  rail: {
    position: 'absolute',
    right: 12,
    bottom: 100,
    alignItems: 'center',
    gap: 18,
  },
  avatarWrap: {
    alignItems: 'center',
    marginBottom: 8,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: Colors.or,
  },
  followBadge: {
    marginTop: -10,
  },
  railItem: { alignItems: 'center', gap: 4 },
  railLabel: {
    color: Colors.sable,
    fontFamily: Fonts.medium,
    fontSize: 12,
  },
  muteBtn: {
    marginTop: 4,
    padding: 6,
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderRadius: 20,
  },
  meta: {
    position: 'absolute',
    left: 16,
    right: 80,
    bottom: 28,
  },
  handle: {
    color: Colors.sable,
    fontFamily: Fonts.bold,
    fontSize: 16,
    marginBottom: 6,
  },
  caption: {
    color: Colors.textPrimary,
    fontFamily: Fonts.regular,
    fontSize: 14,
    lineHeight: 20,
  },
  country: {
    marginTop: 8,
    color: Colors.or,
    fontFamily: Fonts.medium,
    fontSize: 12,
  },
});
