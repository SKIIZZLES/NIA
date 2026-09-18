import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
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
const REWIND_SEC = 5;
const DOUBLE_TAP_MS = 280;

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
    savedIds,
    toggleSave,
    followingIds,
    toggleFollow,
    blockUser,
    repostVideo,
    archiveOwnVideoInFeed,
    deleteOwnVideoInFeed,
  } = useFeed();
  const liked = likedIds.has(item.id);
  const saved = savedIds.has(item.id);
  const authorId = item.userId;
  const following = authorId ? followingIds.has(authorId) : false;
  const isOwn =
    !!user &&
    (!!authorId
      ? authorId === user.id
      : item.handle === `@${user.username}`);
  const [muted, setMuted] = useState(false);
  const [pausedByUser, setPausedByUser] = useState(false);
  const [showPauseIcon, setShowPauseIcon] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [repostBusy, setRepostBusy] = useState(false);
  const [timeLabel, setTimeLabel] = useState('0:00');
  const lastTapRef = useRef(0);
  const pauseIconTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      if (isActive && !pausedByUser) {
        player.play();
      } else {
        player.pause();
      }
    } catch {
      // ignore playback race
    }
  }, [isActive, pausedByUser, player]);

  useEffect(() => {
    if (!isActive) {
      setPausedByUser(false);
      setShowPauseIcon(false);
    }
  }, [isActive]);

  useEffect(() => {
    if (!isActive) return;
    const sub = player.addListener('timeUpdate', ({ currentTime }) => {
      const duration = player.duration;
      if (duration > 0 && Number.isFinite(duration)) {
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

  useEffect(() => {
    return () => {
      if (pauseIconTimer.current) clearTimeout(pauseIconTimer.current);
    };
  }, []);

  const flashPauseIcon = useCallback((paused: boolean) => {
    setShowPauseIcon(true);
    if (pauseIconTimer.current) clearTimeout(pauseIconTimer.current);
    pauseIconTimer.current = setTimeout(() => setShowPauseIcon(false), 700);
    void paused;
  }, []);

  const rewind = useCallback(() => {
    try {
      const next = Math.max(0, player.currentTime - REWIND_SEC);
      player.currentTime = next;
      // seekBy is also available; currentTime is reliable across platforms
    } catch {
      try {
        player.seekBy(-REWIND_SEC);
      } catch {
        // ignore
      }
    }
  }, [player]);

  const onVideoPress = useCallback(() => {
    const now = Date.now();
    if (now - lastTapRef.current < DOUBLE_TAP_MS) {
      lastTapRef.current = 0;
      rewind();
      return;
    }
    lastTapRef.current = now;
    const tapAt = now;
    setTimeout(() => {
      // Only fire pause/play if no second tap arrived
      if (lastTapRef.current !== tapAt) return;
      setPausedByUser((prev) => {
        const next = !prev;
        flashPauseIcon(next);
        return next;
      });
      lastTapRef.current = 0;
    }, DOUBLE_TAP_MS);
  }, [rewind, flashPauseIcon]);

  const onShare = async () => {
    await shareVideo(item);
  };

  const onSave = useCallback(() => {
    if (!user) {
      Alert.alert(t('feed.loginRequiredTitle'), t('feed.saveLoginRequired'));
      return;
    }
    toggleSave(item.id);
  }, [user, toggleSave, item.id, t]);

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


  const onArchive = useCallback(() => {
    Alert.alert(t('feed.archiveConfirmTitle'), t('feed.archiveConfirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('feed.archive'),
        onPress: () => {
          void (async () => {
            const result = await archiveOwnVideoInFeed(item.id);
            if (!result.ok) {
              Alert.alert(t('common.error'), result.message);
              return;
            }
            Alert.alert(
              t('feed.archiveSuccess'),
              result.mock ? t('feed.archiveSuccessMock') : t('feed.archiveSuccessBody'),
            );
          })();
        },
      },
    ]);
  }, [archiveOwnVideoInFeed, item.id, t]);

  const onDelete = useCallback(() => {
    Alert.alert(t('feed.deleteConfirmTitle'), t('feed.deleteConfirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('feed.delete'),
        style: 'destructive',
        onPress: () => {
          void (async () => {
            const result = await deleteOwnVideoInFeed(item.id);
            if (!result.ok) {
              Alert.alert(t('common.error'), result.message);
              return;
            }
            Alert.alert(
              t('feed.deleteSuccess'),
              result.mock ? t('feed.deleteSuccessMock') : t('feed.deleteSuccessBody'),
            );
          })();
        },
      },
    ]);
  }, [deleteOwnVideoInFeed, item.id, t]);

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
  const saveCount = item.saves ?? 0;

  return (
    <View style={[styles.container, { height: SCREEN_H - bottomInset }]}>
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        nativeControls={false}
      />
      <View style={styles.gradient} pointerEvents="none" />

      {/* Tap zone: pause/play + double-tap rewind (left-biased) */}
      <Pressable
        style={styles.tapZone}
        onPress={onVideoPress}
        accessibilityLabel={pausedByUser ? t('feed.play') : t('feed.pause')}
      />

      {showPauseIcon || (isActive && pausedByUser) ? (
        <View style={styles.pauseOverlay} pointerEvents="none">
          <View style={styles.pauseBadge}>
            <Ionicons
              name={pausedByUser ? 'play' : 'pause'}
              size={36}
              color={Colors.sable}
            />
          </View>
        </View>
      ) : null}

      {isActive ? (
        <View style={styles.topLeftControls}>
          <View style={styles.durationPill} pointerEvents="none">
            <Text style={styles.durationText}>{timeLabel}</Text>
          </View>
          <Pressable
            style={styles.rewindBtn}
            onPress={rewind}
            hitSlop={10}
            accessibilityLabel={t('feed.rewind')}
          >
            <Ionicons name="play-back" size={16} color={Colors.sable} />
            <Text style={styles.rewindLabel}>{REWIND_SEC}s</Text>
          </Pressable>
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
          color={liked ? Colors.rougeTerre : Colors.sable}
          label={formatCount(item.likes)}
          onPress={() => toggleLike(item.id)}
        />
        <RailAction
          icon="chatbubble-ellipses"
          color={Colors.sable}
          label={formatCount(item.comments)}
          onPress={() => onOpenComments?.(item.id)}
          accessibilityLabel={t('feed.comments')}
        />
        <RailAction
          icon={saved ? 'bookmark' : 'bookmark-outline'}
          color={saved ? Colors.or : Colors.sable}
          label={formatCount(saveCount)}
          onPress={onSave}
          accessibilityLabel={t('feed.save')}
        />
        <RailAction
          icon="paper-plane-outline"
          label={formatCount(item.shares)}
          onPress={() => void onShare()}
          accessibilityLabel={t('feed.share')}
        />
        <RailAction
          icon="sync-outline"
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
        canManage={isOwn}
        onReport={() => setReportOpen(true)}
        onBlock={onBlock}
        onShare={() => void onShare()}
        onArchive={onArchive}
        onDelete={onDelete}
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
  tapZone: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 72,
    bottom: 120,
    zIndex: 2,
  },
  pauseOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 3,
  },
  pauseBadge: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(11, 11, 11, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(209, 127, 42, 0.55)',
  },
  topLeftControls: {
    position: 'absolute',
    top: 56,
    left: 14,
    zIndex: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  durationPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radii.pill,
    backgroundColor: 'rgba(11, 11, 11, 0.62)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(209, 127, 42, 0.55)',
  },
  durationText: {
    color: Colors.sable,
    fontFamily: Fonts.medium,
    fontSize: 12,
    letterSpacing: 0.3,
    fontVariant: ['tabular-nums'],
  },
  rewindBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radii.pill,
    backgroundColor: 'rgba(11, 11, 11, 0.62)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(209, 127, 42, 0.4)',
  },
  rewindLabel: {
    color: Colors.sable,
    fontFamily: Fonts.medium,
    fontSize: 11,
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
    gap: 14,
    zIndex: 4,
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
    zIndex: 4,
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
