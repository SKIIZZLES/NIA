import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Dimensions,
  type GestureResponderEvent,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts, Radii } from '@/constants/theme';
import { useColors } from '@/context/ThemeContext';
import { formatCount, VideoItem } from '@/data/mockVideos';
import { useFeed } from '@/context/FeedContext';
import { useAuth } from '@/context/AuthContext';
import { useI18n } from '@/context/I18nContext';
import { FollowButton } from '@/components/FollowButton';
import { VideoMenuSheet } from '@/components/VideoMenuSheet';
import { ReportSheet } from '@/components/ReportSheet';
import { ModerationBanner } from '@/components/ModerationBanner';
import { isKeywordHeld } from '@/lib/textFilter';
import { shareVideo } from '@/lib/share';
import { VideoProgressBar } from '@/components/VideoProgressBar';
import { videoDeleteFeedback } from '@/components/videoDeleteFeedback';
import { useIsFocused, useRouter } from 'expo-router';
import { SyncedSound } from '@/components/SyncedSound';
import { OverlayLayer } from '@/components/OverlayLayer';
import { canRepostItem } from '@/lib/publishOptions';

const { height: SCREEN_H, width: SCREEN_W } = Dimensions.get('window');
const SEEK_SEC = 5;
/** Marge droite de la zone de tap : laisse le rail d'actions cliquable. */
const TAP_ZONE_RIGHT = 72;
const DOUBLE_TAP_MS = 280;

type Props = {
  item: VideoItem;
  isActive: boolean;
  bottomInset?: number;
  onOpenComments?: (videoId: string) => void;
  /**
   * Écran plein écran (`/video/[id]`) : le coin haut-gauche est pris par le
   * bouton retour. Le bouton son passe alors en bas, juste à droite du @handle.
   */
  muteBesideHandle?: boolean;
};

function VideoCardInner({
  item,
  isActive,
  bottomInset = 80,
  onOpenComments,
  muteBesideHandle = false,
}: Props) {
  const isImagePost = item.mediaType === 'image';
  // Pas de lecteur vidéo pour les posts photo : l'ancien code chargeait une
  // vidéo de démo distante pour chaque photo (data gaspillée).
  const player = useVideoPlayer(isImagePost ? null : item.videoUrl, (p) => {
    p.loop = true;
    p.muted = false;
    p.timeUpdateEventInterval = 0.25;
  });
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const colors = useColors();
  const chrome = colors.onMedia;
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
  // Écran sans focus (onglet quitté, page poussée par-dessus) : ni la vidéo
  // ni le son ne doivent continuer à jouer derrière.
  const isFocused = useIsFocused();
  const visible = isActive && isFocused;
  // Le fichier du son n'est chargé qu'une fois la carte devenue active :
  // pas de téléchargement pour chaque carte montée par la liste.
  const [soundArmed, setSoundArmed] = useState(false);
  useEffect(() => {
    if (isActive) setSoundArmed(true);
  }, [isActive]);
  const canMute = !isImagePost || !!item.soundUrl;
  const [showPauseIcon, setShowPauseIcon] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [repostBusy, setRepostBusy] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const scrubbingRef = useRef(false);
  const lastTapRef = useRef(0);
  const pauseIconTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openProfile = () => {
    const handle = item.handle.replace(/^@/, '');
    if (!handle) return;
    router.push(`/user/${handle}`);
  };

  const openSound = () => {
    if (!item.soundId) return;
    router.push(`/sound/${item.soundId}`);
  };

  // 016 : réglages d'édition publiés (vitesse, volume original). Sans
  // edit_meta : 1x, volume normal, comme avant.
  const meta = item.editMeta;
  const speed = !isImagePost && meta ? meta.speed : 1;
  const originalVolume = !isImagePost && meta ? meta.originalVolume : 1;
  useEffect(() => {
    try {
      player.muted = muted || originalVolume <= 0;
      player.volume = Math.max(0, Math.min(1, originalVolume));
      if (!isImagePost) {
        player.preservesPitch = true;
        player.playbackRate = speed;
      }
    } catch {
      // lecteur libéré
    }
  }, [muted, player, originalVolume, speed, isImagePost]);

  useEffect(() => {
    try {
      if (isImagePost) {
        try { player.pause(); } catch { /* ignore */ }
      } else if (visible && !pausedByUser) {
        player.play();
      } else {
        player.pause();
      }
    } catch {
      // ignore playback race
    }
  }, [visible, pausedByUser, player, isImagePost]);

  useEffect(() => {
    if (!isActive) {
      setPausedByUser(false);
      setShowPauseIcon(false);
    }
  }, [isActive]);

  useEffect(() => {
    if (!isActive || isImagePost) return;
    const sub = player.addListener('timeUpdate', ({ currentTime: t }) => {
      if (scrubbingRef.current) return;
      const d = player.duration;
      setCurrentTime(t);
      if (d > 0 && Number.isFinite(d)) {
        setDuration(d);
      }
    });
    return () => {
      try {
        sub.remove();
      } catch {
        // ignore
      }
    };
  }, [isActive, player, isImagePost]);

  const seekTo = useCallback(
    (seconds: number) => {
      try {
        const d = player.duration;
        const max = d > 0 && Number.isFinite(d) ? d : seconds;
        const next = Math.max(0, Math.min(max, seconds));
        player.currentTime = next;
        setCurrentTime(next);
      } catch {
        // ignore seek race
      }
    },
    [player],
  );

  const onScrubbingChange = useCallback((active: boolean) => {
    scrubbingRef.current = active;
  }, []);

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
      const next = Math.max(0, player.currentTime - SEEK_SEC);
      player.currentTime = next;
      setCurrentTime(next);
    } catch {
      try {
        player.seekBy(-SEEK_SEC);
      } catch {
        // ignore
      }
    }
  }, [player]);

  const forward = useCallback(() => {
    try {
      const d = player.duration;
      const max = d > 0 && Number.isFinite(d) ? d : player.currentTime + SEEK_SEC;
      const next = Math.min(max, player.currentTime + SEEK_SEC);
      player.currentTime = next;
      setCurrentTime(next);
    } catch {
      try {
        player.seekBy(SEEK_SEC);
      } catch {
        // ignore
      }
    }
  }, [player]);

  const onVideoPress = useCallback((event: GestureResponderEvent) => {
    const now = Date.now();
    // Le double-tap agit selon la moitié touchée : gauche recule, droite avance.
    // La zone de tap s'arrête à 72px du bord droit (rail d'actions).
    const zoneW = SCREEN_W - TAP_ZONE_RIGHT;
    const onRightHalf = event.nativeEvent.locationX > zoneW / 2;
    if (now - lastTapRef.current < DOUBLE_TAP_MS) {
      lastTapRef.current = 0;
      if (onRightHalf) forward();
      else rewind();
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
  }, [rewind, forward, flashPauseIcon]);

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
        } else if (
          result.message === 'not_allowed' ||
          result.message.includes('row-level security')
        ) {
          Alert.alert(t('feed.repost'), t('feed.repostNotAllowed'));
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
            // Trois issues : fichier effacé, fichier gardé pour un repost
            // (qui reste visible), échec. Ne jamais annoncer un effacement
            // qui n'a pas eu lieu.
            const { title, body } = videoDeleteFeedback(result, t);
            Alert.alert(title, body);
          })();
        },
      },
    ]);
  }, [deleteOwnVideoInFeed, item.id, t]);


  const onAddToSeries = useCallback(() => {
    router.push(`/series/add?videoId=${encodeURIComponent(item.id)}`);
  }, [router, item.id]);

  const onBlock = () => {
    if (!authorId || isOwn) return;
    const username = item.handle.replace(/^@/, '');
    Alert.alert(t('safety.blockTitle'), t('safety.blockBody', { username }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('safety.block'),
        style: 'destructive',
        onPress: () => {
          void (async () => {
            const result = await blockUser(authorId);
            if (!result.ok) {
              Alert.alert(t('common.error'), t(result.errorKey));
              return;
            }
            Alert.alert(
              t('safety.blockedTitle'),
              result.mock ? t('safety.blockedMock') : t('safety.blockedBody', { username }),
            );
          })();
        },
      },
    ]);
  };

  const isRepost = !!item.repostOf;
  const originalHandle = item.originalHandle;
  const saveCount = item.saves ?? 0;

  return (
    <View style={[styles.container, { height: SCREEN_H - bottomInset }]}>
      {/* Sprint S2 : son du post joué en synchro (début 0, volumes par défaut
          tant que la base ne stocke pas les réglages). Suit pause, seek,
          boucle et bouton son. */}
      {/* Éditeur P0 : edit_meta.baked = son déjà mixé dans le fichier. */}
      {soundArmed && item.soundUrl && !meta?.baked ? (
        <SyncedSound
          url={item.soundUrl}
          video={isImagePost ? null : player}
          active={visible && !pausedByUser}
          muted={muted}
          offsetMs={meta?.sound?.offsetMs ?? 0}
          volume={meta?.sound?.volume ?? 1}
          rate={speed}
        />
      ) : null}
      {isImagePost ? (
        <Image
          source={{ uri: item.thumbnailUrl || item.videoUrl }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          accessible={!!item.altText}
          accessibilityRole="image"
          accessibilityLabel={item.altText}
        />
      ) : (
        <VideoView
          player={player}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          nativeControls={false}
          accessible={!!item.altText}
          accessibilityLabel={item.altText}
        />
      )}
      {/* Calques texte / stickers (S4), publiés dans edit_meta (016). */}
      <OverlayLayer doc={item.overlays} timeMs={isImagePost ? null : currentTime * 1000} />
      <LinearGradient
        colors={['rgba(11,11,11,0.65)', 'rgba(11,11,11,0)']}
        style={styles.gradientTop}
        pointerEvents="none"
      />
      <LinearGradient
        colors={['rgba(11,11,11,0)', 'rgba(11,11,11,0.6)', 'rgba(11,11,11,0.92)']}
        locations={[0, 0.5, 1]}
        style={styles.gradientBottom}
        pointerEvents="none"
      />

      {/* Tap zone: simple tap = pause/play, double-tap = reculer (gauche) / avancer (droite) */}
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
              color={chrome}
            />
          </View>
        </View>
      ) : null}

      {canMute && !muteBesideHandle ? (
        <Pressable
          style={[styles.muteBtn, { top: insets.top + 4 }]}
          onPress={() => setMuted((m) => !m)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={muted ? t('feed.unmute') : t('feed.mute')}
        >
          <Ionicons
            name={muted ? 'volume-mute' : 'volume-high'}
            size={20}
            color={chrome}
          />
        </Pressable>
      ) : null}

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
          color={liked ? colors.or : chrome}
          label={formatCount(item.likes)}
          onPress={() => toggleLike(item.id)}
        />
        <RailAction
          icon="chatbubble-ellipses"
          color={chrome}
          label={formatCount(item.comments)}
          onPress={() => onOpenComments?.(item.id)}
          accessibilityLabel={t('feed.comments')}
        />
        <RailAction
          icon={saved ? 'bookmark' : 'bookmark-outline'}
          color={saved ? colors.or : chrome}
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
          icon="ellipsis-horizontal"
          label=""
          onPress={() => setMenuOpen(true)}
          accessibilityLabel={t('feed.menuTitle')}
        />
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
        <View style={styles.handleRow}>
          <Pressable onPress={openProfile}>
            <Text style={styles.handle}>{item.handle}</Text>
          </Pressable>
          {canMute && muteBesideHandle ? (
            <Pressable
              onPress={() => setMuted((m) => !m)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={muted ? t('feed.unmute') : t('feed.mute')}
            >
              <Ionicons
                name={muted ? 'volume-mute' : 'volume-high'}
                size={16}
                color={chrome}
              />
            </Pressable>
          ) : null}
          {item.country ? (
            <View style={styles.countryChip}>
              <Ionicons name="location-outline" size={12} color={colors.sableMuted} />
              <Text style={[styles.country, { color: colors.sableMuted }]}>
                {item.country}
              </Text>
            </View>
          ) : null}
        </View>
        {isOwn && (item.moderationState === 'held' || item.moderationState === 'removed') ? (
          <ModerationBanner kind={isKeywordHeld(item) ? 'review' : item.moderationState} />
        ) : null}
        <Text style={styles.caption} numberOfLines={3}>
          {item.caption}
        </Text>
        {item.locationText ? (
          <View style={styles.placeRow}>
            <Ionicons name="location" size={13} color={colors.sableMuted} />
            <Text style={[styles.placeText, { color: colors.sableMuted }]} numberOfLines={1}>
              {item.locationText}
            </Text>
          </View>
        ) : null}
        {item.soundId ? (
          <Pressable onPress={openSound} hitSlop={6} style={styles.soundRow}>
            <Ionicons name="musical-notes" size={14} color={colors.or} />
            <Text style={styles.soundText} numberOfLines={1}>
              {item.soundTitle
                ? item.soundCreatorHandle
                  ? `${item.soundTitle} — ${item.soundCreatorHandle}`
                  : item.soundTitle
                : t('sound.originalLabel', {
                    handle: item.soundCreatorHandle || item.handle,
                  })}
            </Text>
          </Pressable>
        ) : null}
        {item.filterId || item.aiGenerated ? (
          <View style={styles.badgeRow}>
            {item.filterId ? (
              <View style={styles.filterBadge}>
                <Ionicons name="color-filter-outline" size={12} color={colors.or} />
                <Text style={styles.filterBadgeText}>{t('filter.feedBadge')}</Text>
              </View>
            ) : null}
            {/* Label obligatoire des contenus générés par IA (016). */}
            {item.aiGenerated ? (
              <View style={styles.filterBadge}>
                <Ionicons name="sparkles-outline" size={12} color={colors.or} />
                <Text style={styles.filterBadgeText}>{t('feed.aiLabel')}</Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>

      {isActive && !isImagePost ? (
        <VideoProgressBar
          currentTime={currentTime}
          duration={duration}
          onSeek={seekTo}
          onScrubbingChange={onScrubbingChange}
        />
      ) : null}

      <VideoMenuSheet
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        canReport={!isOwn}
        canBlock={!!authorId && !isOwn}
        canManage={isOwn}
        onReport={() => setReportOpen(true)}
        onBlock={onBlock}
        onShare={() => void onShare()}
        onRepost={canRepostItem(item) ? () => void onRepost() : undefined}
        onArchive={onArchive}
        onDelete={onDelete}
        onAddToSeries={onAddToSeries}
      />

      <ReportSheet
        visible={reportOpen}
        onClose={() => setReportOpen(false)}
        reporterId={user?.id}
        targetType="video"
        targetId={item.id}
        onDone={(message) => Alert.alert(t('feed.report'), message)}
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
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
    >
      <Ionicons name={icon} size={30} color={color} style={styles.railIcon} />
      {label ? <Text style={styles.railLabel}>{label}</Text> : null}
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
  gradientTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 150,
    zIndex: 1,
  },
  gradientBottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '45%',
    zIndex: 1,
  },
  tapZone: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: TAP_ZONE_RIGHT,
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
  },
  muteBtn: {
    position: 'absolute',
    left: 8,
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 11,
  },
  rail: {
    position: 'absolute',
    right: 8,
    bottom: 96,
    alignItems: 'center',
    gap: 16,
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
  railItem: { alignItems: 'center', gap: 3, minWidth: 44 },
  railIcon: {
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  railLabel: {
    color: Colors.sable,
    fontFamily: Fonts.bold,
    fontSize: 12,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  meta: {
    position: 'absolute',
    left: 16,
    right: 80,
    bottom: 52,
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
  handleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  handle: {
    color: Colors.sable,
    fontFamily: Fonts.bold,
    fontSize: 16,
  },
  countryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  caption: {
    color: Colors.textPrimary,
    fontFamily: Fonts.regular,
    fontSize: 14,
    lineHeight: 20,
  },
  soundRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
  },
  soundText: {
    color: Colors.or,
    fontFamily: Fonts.medium,
    fontSize: 12,
    flexShrink: 1,
  },
  country: {
    color: Colors.sableMuted,
    fontFamily: Fonts.medium,
    fontSize: 12,
  },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  placeRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  placeText: { fontFamily: Fonts.medium, fontSize: 12, flexShrink: 1 },
  filterBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radii.pill,
    backgroundColor: 'rgba(11, 11, 11, 0.55)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(209, 127, 42, 0.45)',
  },
  filterBadgeText: {
    color: Colors.or,
    fontFamily: Fonts.medium,
    fontSize: 11,
  },
});
