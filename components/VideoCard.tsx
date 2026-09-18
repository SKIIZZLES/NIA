import React, { useEffect, useState } from 'react';
import {
  Alert,
  Dimensions,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '@/constants/theme';
import { formatCount, VideoItem } from '@/data/mockVideos';
import { useFeed } from '@/context/FeedContext';
import { useAuth } from '@/context/AuthContext';
import { FollowButton } from '@/components/FollowButton';
import { VideoMenuSheet } from '@/components/VideoMenuSheet';
import { ReportSheet } from '@/components/ReportSheet';
import { shareVideo } from '@/lib/share';
import { useRouter } from 'expo-router';

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
  const player = useVideoPlayer(item.videoUrl, (p) => {
    p.loop = true;
    p.muted = false;
  });
  const router = useRouter();
  const { user } = useAuth();
  const { toggleLike, likedIds, followingIds, toggleFollow, blockUser } =
    useFeed();
  const liked = likedIds.has(item.id);
  const authorId = item.userId;
  const following = authorId ? followingIds.has(authorId) : false;
  const isOwn =
    !!user &&
    (!!authorId
      ? authorId === user.id
      : item.handle === `@${user.username}`);
  const [muted, setMuted] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  const openProfile = () => {
    const handle = item.handle.replace(/^@/, '');
    if (!handle) return;
    router.push(`/user/${handle}`);
  };

  useEffect(() => {
    player.muted = muted;
  }, [muted, player]);

  useEffect(() => {
    try {
      if (isActive) {
        player.play();
      } else {
        player.pause();
        player.currentTime = 0;
      }
    } catch {
      // ignore playback race
    }
  }, [isActive, player]);

  const onShare = async () => {
    await shareVideo(item);
  };

  const onBlock = () => {
    if (!authorId || isOwn) return;
    Alert.alert(
      'Bloquer cet utilisateur ?',
      `Vous ne verrez plus les vidéos de ${item.handle}.`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Bloquer',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              const result = await blockUser(authorId);
              if (!result.ok) {
                Alert.alert('Erreur', result.message);
                return;
              }
              Alert.alert(
                'Utilisateur bloqué',
                result.mock
                  ? 'Blocage enregistré (mode démo).'
                  : `${item.handle} a été bloqué.`,
              );
            })();
          },
        },
      ],
    );
  };

  return (
    <View style={[styles.container, { height: SCREEN_H - bottomInset }]}>
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        nativeControls={false}
      />
      <View style={styles.gradient} pointerEvents="none" />

      <Pressable
        style={styles.menuBtn}
        onPress={() => setMenuOpen(true)}
        hitSlop={12}
        accessibilityLabel="Options vidéo"
      >
        <Ionicons name="ellipsis-vertical" size={22} color={Colors.sable} />
      </Pressable>

      <View style={styles.rail}>
        <View style={styles.avatarWrap}>
          <Pressable onPress={openProfile}>
            <Image source={{ uri: item.avatarUrl }} style={styles.avatar} />
          </Pressable>
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
        <RailAction
          icon="arrow-redo-outline"
          label={formatCount(item.shares)}
          onPress={() => void onShare()}
        />
        <Pressable onPress={() => setMuted((m) => !m)} style={styles.muteBtn}>
          <Ionicons
            name={muted ? 'volume-mute' : 'volume-high'}
            size={22}
            color={Colors.sable}
          />
        </Pressable>
      </View>

      <View style={styles.meta}>
        <Pressable onPress={openProfile}>
          <Text style={styles.handle}>{item.handle}</Text>
        </Pressable>
        <Text style={styles.caption} numberOfLines={3}>
          {item.caption}
        </Text>
        {item.country ? (
          <Text style={styles.country}>{item.country}</Text>
        ) : null}
      </View>

      <VideoMenuSheet
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        canReport={!isOwn}
        canBlock={!!authorId && !isOwn}
        onReport={() => setReportOpen(true)}
        onBlock={onBlock}
        onShare={() => void onShare()}
      />

      <ReportSheet
        visible={reportOpen}
        onClose={() => setReportOpen(false)}
        reporterId={user?.id}
        targetType="video"
        targetId={item.id}
        onDone={(message) => Alert.alert('Signalement', message)}
      />
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
  menuBtn: {
    position: 'absolute',
    top: 56,
    right: 12,
    zIndex: 5,
    padding: 8,
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderRadius: 20,
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
