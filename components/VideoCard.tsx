import React, { memo, useCallback, useEffect, useState } from 'react';
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
import { Colors, Fonts, Radii } from '@/constants/theme';
import { formatCount, VideoItem } from '@/data/mockVideos';
import { useFeed } from '@/context/FeedContext';
import { useAuth } from '@/context/AuthContext';
import { useI18n } from '@/context/I18nContext';
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

function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const s = Math.floor(seconds);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

function VideoCardInner({
  item,
  isActive,
  bottomInset = 80,
  onOpenComments,
}: Props) {
  const player = useVideoPlayer(item.videoUrl, (p) => {
    p.loop = true;
    p.muted = false;
    p.timeUpdateEventInterval = 0.25;
  });
  const router = useRouter();
  const { t } = useI18n();
  const { user } = useAuth();
  const {
    toggleLike,
    likedIds,
    followingIds,
    toggleFollow,
    blockUser,
    repostVideo,
  } = useFeed();
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
  const [repostBusy, setRepostBusy] = useState(false);
  const [timeLabel, setTimeLabel] = useState('0:00');

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
        // Pause off-screen without seek — faster resume / less rebuffer
        player.pause();
      }
    } catch {
      // ignore playback race
    }
  }, [isActive, player]);

  useEffect(() => {
    if (!isActive) return;
    const sub = player.addListener('timeUpdate', ({ currentTime }) => {
      const duration = player.duration;
      if (duration > 0 && Number.isFinite(duration)) {
        // Instagram Reels-style remaining time
        const remaining = Math.max(0, duration - currentTime);
        setTimeLabel(formatClock(remaining));
      } else {
        setTimeLabel(formatClock(currentTime));
      }
    });
    return () => {
      try {
        sub.remove();
      } catch {
        // ignore
      }
    };
  }, [isActive, player]);

  const onShare = async () => {
    await shareVideo(item);
  };

  const onRepost = useCallback(async () => {
    if (!user) {
      Alert.alert(t('feed.loginRequiredTitle'), t('feed.loginRequired'));
      return;
    }
    if (repostBusy) return;
    setRepostBusy(true);
    try {
      const result = await repostVideo(item);
      if (!result.ok) {
        if (result.message === 'login_required') {
          Alert.alert(t('feed.loginRequiredTitle'), t('feed.loginRequired'));
        } else if (result.message === 'already') {
          Alert.alert(t('feed.repost'), t('feed.repostAlready'));
        } else {
          Alert.alert(
            t('feed.repostFail'),
            result.message === 'repost_fail'
              ? t('feed.repostFail')
              : result.message,
          );
        }
        return;
      }
      Alert.alert(
        t('feed.repostSuccess'),
        result.mock ? t('feed.repostSuccessMock') : t('feed.repostSuccessBody'),
      );
    } finally {
      setRepostBusy(false);
    }
  }, [user, repostBusy, repostVideo, item, t]);

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

  const isRepost = !!item.repostOf;
  const originalHandle = item.originalHandle;

  return (
    <View style={[styles.container, { height: SCREEN_H - bottomInset }]}>
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        nativeControls={false}
      />
      <View style={styles.gradient} pointerEvents="none" />

      {isActive ? (
        <View style={styles.durationPill} pointerEvents="none">
          <Text style={styles.durationText}>{timeLabel}</Text>
        </View>
      ) : null}

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
            <Image
              source={{ uri: item.avatarUrl }}
              style={styles.avatar}
              // RN default disk/memory cache for remote URIs
            />
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
          accessibilityLabel={t('feed.share')}
        />
        <RailAction
          icon="repeat-outline"
          label={t('feed.repost')}
          onPress={() => void onRepost()}
          color={Colors.or}
          accessibilityLabel={t('feed.repost')}
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
        {isRepost ? (
          <Text style={styles.repostLine} numberOfLines={1}>
            <Text style={styles.repostHandle}>{item.handle}</Text>
            {' '}
            {t('feed.repostedBy')}
            {originalHandle ? (
              <Text style={styles.repostOrig}> {originalHandle}</Text>
            ) : null}
          </Text>
        ) : null}
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
  accessibilityLabel,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress?: () => void;
  color?: string;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={styles.railItem}
      accessibilityLabel={accessibilityLabel || label}
    >
      <Ionicons name={icon} size={28} color={color} />
      <Text style={styles.railLabel}>{label}</Text>
    </Pressable>
  );
}

export const VideoCard = memo(VideoCardInner);

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
  durationPill: {
    position: 'absolute',
    top: 56,
    left: 14,
    zIndex: 5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radii.pill,
    backgroundColor: 'rgba(10, 10, 10, 0.62)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(201, 162, 39, 0.55)',
  },
  durationText: {
    color: Colors.sable,
    fontFamily: Fonts.medium,
    fontSize: 12,
    letterSpacing: 0.3,
    fontVariant: ['tabular-nums'],
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
    gap: 16,
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
    fontSize: 11,
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
  repostLine: {
    color: Colors.textSecondary,
    fontFamily: Fonts.medium,
    fontSize: 12,
    marginBottom: 4,
  },
  repostHandle: {
    color: Colors.or,
    fontFamily: Fonts.bold,
  },
  repostOrig: {
    color: Colors.sable,
    fontFamily: Fonts.medium,
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
