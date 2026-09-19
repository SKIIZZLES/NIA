import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/Button';
import { LanguageToggle } from '@/components/LanguageToggle';
import { MediaThumb } from '@/components/MediaThumb';
import { useAuth } from '@/context/AuthContext';
import { useFeed } from '@/context/FeedContext';
import { useI18n } from '@/context/I18nContext';
import { Fonts, Radii, Spacing } from '@/constants/theme';
import { useColors } from '@/context/ThemeContext';
import { useRouter } from 'expo-router';
import {
  countFollowers,
  countFollowing,
  fetchVideosByUserId,
} from '@/lib/profiles';
import { fetchSavedVideos } from '@/lib/saves';
import { updateVideoStatus } from '@/lib/videos';
import { listSeriesByUser, type SeriesListItem } from '@/lib/series';
import type { VideoItem } from '@/data/mockVideos';
import { formatCount } from '@/data/mockVideos';

type ProfileTab = 'publications' | 'archives' | 'saves' | 'series';

export default function ProfileScreen() {
  const { user, signOut } = useAuth();
  const { videos, savedIds, toggleSave, refresh } = useFeed();
  const { t } = useI18n();
  const colors = useColors();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const gap = 2;
  const cols = 3;
  const size = (width - gap * (cols - 1)) / cols;

  const [followerCount, setFollowerCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [activeTab, setActiveTab] = useState<ProfileTab>('publications');
  const [published, setPublished] = useState<VideoItem[]>([]);
  const [archived, setArchived] = useState<VideoItem[]>([]);
  const [saved, setSaved] = useState<VideoItem[]>([]);
  const [seriesList, setSeriesList] = useState<SeriesListItem[]>([]);

  const myFeedVideos = useMemo(
    () =>
      videos.filter(
        (v) =>
          user &&
          (v.userId === user.id ||
            v.handle === `@${user.username}` ||
            v.id.startsWith('local_')),
      ),
    [videos, user],
  );

  const loadProfileData = useCallback(async () => {
    if (!user) {
      setFollowerCount(0);
      setFollowingCount(0);
      setPublished([]);
      setArchived([]);
      setSaved([]);
      setSeriesList([]);
      return;
    }
    try {
      const [f1, f2, remote, savedRemote, seriesRemote] = await Promise.all([
        countFollowers(user.id),
        countFollowing(user.id),
        fetchVideosByUserId(user.id, { includeArchived: true }),
        fetchSavedVideos(user.id),
        listSeriesByUser(user.id),
      ]);
      setFollowerCount(f1);
      setFollowingCount(f2);

      const own =
        remote.length > 0
          ? remote
          : myFeedVideos.filter((v) => v.status !== 'deleted');
      setPublished(own.filter((v) => !v.status || v.status === 'published'));
      setArchived(own.filter((v) => v.status === 'archived'));

      if (savedRemote.length) {
        setSaved(savedRemote);
      } else if (savedIds.size) {
        const fromFeed = videos.filter((v) => savedIds.has(v.id));
        setSaved(fromFeed);
      } else {
        setSaved([]);
      }
      setSeriesList(seriesRemote);
    } catch {
      const own = myFeedVideos.filter((v) => v.status !== 'deleted');
      setPublished(own.filter((v) => !v.status || v.status === 'published'));
      setArchived(own.filter((v) => v.status === 'archived'));
      setSaved(videos.filter((v) => savedIds.has(v.id)));
      setSeriesList([]);
    }
  }, [user, myFeedVideos, videos, savedIds]);

  useEffect(() => {
    void loadProfileData();
  }, [loadProfileData]);

  const listData =
    activeTab === 'publications'
      ? published
      : activeTab === 'archives'
        ? archived
        : activeTab === 'saves'
          ? saved
          : [];

  const emptyMessage =
    activeTab === 'publications'
      ? t('profile.empty')
      : activeTab === 'archives'
        ? t('profile.emptyArchives')
        : activeTab === 'saves'
          ? t('profile.emptySaves')
          : t('profile.emptySeries');

  const onUnarchive = (item: VideoItem) => {
    if (!user) return;
    void (async () => {
      const result = await updateVideoStatus(user.id, item.id, 'published');
      if (!result.ok) {
        Alert.alert(t('common.error'), result.message);
        return;
      }
      setArchived((prev) => prev.filter((v) => v.id !== item.id));
      setPublished((prev) => [{ ...item, status: 'published' }, ...prev]);
      void refresh();
    })();
  };

  const onDeleteArchived = (item: VideoItem) => {
    if (!user) return;
    Alert.alert(t('feed.deleteConfirmTitle'), t('feed.deleteConfirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('feed.delete'),
        style: 'destructive',
        onPress: () => {
          void (async () => {
            const result = await updateVideoStatus(user.id, item.id, 'deleted');
            if (!result.ok) {
              Alert.alert(t('common.error'), result.message);
              return;
            }
            setArchived((prev) => prev.filter((v) => v.id !== item.id));
          })();
        },
      },
    ]);
  };

  const onUnsave = (item: VideoItem) => {
    toggleSave(item.id);
    setSaved((prev) => prev.filter((v) => v.id !== item.id));
  };

  const confirmUnsave = (item: VideoItem) => {
    Alert.alert(t('profile.unsaveTitle'), t('profile.unsaveBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('profile.unsave'),
        style: 'destructive',
        onPress: () => onUnsave(item),
      },
    ]);
  };

  const tabs: { key: ProfileTab; label: string }[] = [
    { key: 'publications', label: t('profile.tabPublications') },
    { key: 'archives', label: t('profile.tabArchives') },
    { key: 'saves', label: t('profile.tabSaves') },
    { key: 'series', label: t('profile.tabSeries') },
  ];

  const isGrid = activeTab === 'publications' || activeTab === 'saves';
  const isSeries = activeTab === 'series';

  const styles = useMemo(() => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.noir },
  header: {
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
    paddingTop: Spacing.md,
  },
  avatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 2,
    borderColor: colors.or,
  },
  displayName: {
    marginTop: Spacing.md,
    color: colors.sable,
    fontFamily: Fonts.bold,
    fontSize: 20,
  },
  username: {
    marginTop: 4,
    color: colors.textSecondary,
    fontFamily: Fonts.medium,
    fontSize: 14,
  },
  bio: {
    marginTop: 6,
    color: colors.textSecondary,
    fontFamily: Fonts.regular,
    fontSize: 14,
    textAlign: 'center',
  },
  stats: {
    flexDirection: 'row',
    gap: 28,
    marginTop: Spacing.lg,
  },
  stat: { alignItems: 'center' },
  statValue: {
    color: colors.sable,
    fontFamily: Fonts.bold,
    fontSize: 16,
  },
  statLabel: {
    color: colors.textMuted,
    fontFamily: Fonts.regular,
    fontSize: 11,
    marginTop: 2,
  },
  settingsRow: {
    marginTop: Spacing.md,
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: Radii.md,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: colors.noirElevated,
  },
  settingsRowText: {
    color: colors.sable,
    fontFamily: Fonts.medium,
    fontSize: 14,
  },
  settingsRowChevron: {
    color: colors.textMuted,
    fontSize: 22,
    lineHeight: 22,
  },
  editBtn: {
    marginTop: Spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  editBtnText: {
    color: colors.sable,
    fontFamily: Fonts.medium,
    fontSize: 14,
  },
  linkBtn: { marginTop: Spacing.sm, padding: 6 },
  linkText: {
    color: colors.or,
    fontFamily: Fonts.medium,
    fontSize: 13,
  },
  segment: {
    marginTop: Spacing.lg,
    alignSelf: 'stretch',
    flexDirection: 'row',
    backgroundColor: colors.noirSoft,
    borderRadius: Radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: 3,
    gap: 2,
  },
  segmentItem: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderRadius: Radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentItemActive: {
    backgroundColor: colors.noirElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(209, 127, 42, 0.55)',
  },
  segmentLabel: {
    color: colors.textMuted,
    fontFamily: Fonts.medium,
    fontSize: 10,
    textAlign: 'center',
  },
  segmentLabelActive: {
    color: colors.or,
    fontFamily: Fonts.bold,
  },
  empty: {
    textAlign: 'center',
    color: colors.textMuted,
    fontFamily: Fonts.regular,
    marginTop: Spacing.lg,
    paddingHorizontal: Spacing.lg,
  },
  archiveRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    alignItems: 'center',
  },
  archiveThumbWrap: {
    position: 'relative',
  },
  archiveThumb: {
    width: 72,
    height: 72 * (16 / 9),
    borderRadius: Radii.sm,
    overflow: 'hidden',
    backgroundColor: colors.noirSoft,
  },
  archiveBadge: {
    position: 'absolute',
    left: 4,
    bottom: 4,
    backgroundColor: 'rgba(11,11,11,0.75)',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 6,
  },
  archiveBadgeText: {
    color: colors.or,
    fontFamily: Fonts.medium,
    fontSize: 9,
  },
  archiveMeta: {
    flex: 1,
    gap: 8,
  },
  archiveCaption: {
    color: colors.sable,
    fontFamily: Fonts.medium,
    fontSize: 13,
  },
  archiveActions: {
    flexDirection: 'row',
    gap: 10,
  },
  archiveActionBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  archiveActionPrimary: {
    color: colors.or,
    fontFamily: Fonts.medium,
    fontSize: 12,
  },
  archiveActionDanger: {
    color: colors.danger,
    fontFamily: Fonts.medium,
    fontSize: 12,
  },
  seriesCreateBtn: {
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
  },
  seriesCard: {
    flex: 1,
    margin: 4,
    backgroundColor: colors.noirSoft,
    borderRadius: Radii.md,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  seriesCover: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: colors.noirElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  seriesCoverImg: {
    width: '100%',
    height: '100%',
  },
  seriesCardTitle: {
    color: colors.sable,
    fontFamily: Fonts.medium,
    fontSize: 13,
    paddingHorizontal: 8,
    paddingTop: 8,
  },
  seriesCardMeta: {
    color: colors.textMuted,
    fontFamily: Fonts.regular,
    fontSize: 11,
    paddingHorizontal: 8,
    paddingBottom: 10,
    paddingTop: 2,
  },
}), [colors]);

  const header = (
    <View style={styles.header}>
      <Image
        source={{
          uri: user?.avatarUrl || 'https://i.pravatar.cc/200?u=nia',
        }}
        style={styles.avatar}
      />
      <Text style={styles.displayName}>
        {user?.displayName || user?.username || t('common.guest')}
      </Text>
      <Text style={styles.username}>@{user?.username || 'invite'}</Text>
      <Text style={styles.bio}>{user?.bio || t('profile.defaultBio')}</Text>
      <View style={styles.stats}>
        <Stat label={t('profile.posts')} value={String(published.length)} />
        <Stat label={t('profile.followers')} value={formatCount(followerCount)} />
        <Stat label={t('profile.following')} value={formatCount(followingCount)} />
      </View>
      <LanguageToggle />
      <Pressable
        style={styles.settingsRow}
        onPress={() => router.push('/appearance')}
        accessibilityRole="button"
      >
        <Text style={styles.settingsRowText}>{t('profile.appearance')}</Text>
        <Text style={styles.settingsRowChevron}>›</Text>
      </Pressable>
      {user ? (
        <>
          <Pressable
            style={styles.editBtn}
            onPress={() => router.push('/edit-profile')}
          >
            <Text style={styles.editBtnText}>{t('profile.editProfile')}</Text>
          </Pressable>
          <Pressable
            style={styles.linkBtn}
            onPress={() => router.push(`/user/${user.username}`)}
          >
            <Text style={styles.linkText}>{t('profile.viewPublic')}</Text>
          </Pressable>
          <Button
            title={t('profile.signOut')}
            variant="outline"
            onPress={async () => {
              await signOut();
              router.replace('/welcome');
            }}
            style={{ marginTop: Spacing.md, alignSelf: 'stretch' }}
          />
        </>
      ) : (
        <Button
          title={t('profile.signIn')}
          variant="gold"
          onPress={() => router.push('/(auth)/login')}
          style={{ marginTop: Spacing.md, alignSelf: 'stretch' }}
        />
      )}

      {user ? (
        <View style={styles.segment}>
          {tabs.map((tab) => {
            const active = tab.key === activeTab;
            return (
              <Pressable
                key={tab.key}
                onPress={() => setActiveTab(tab.key)}
                style={[styles.segmentItem, active && styles.segmentItemActive]}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
              >
                <Text
                  style={[styles.segmentLabel, active && styles.segmentLabelActive]}
                  numberOfLines={1}
                >
                  {tab.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );

  if (isSeries) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <FlatList
          ListHeaderComponent={
            <>
              {header}
              {user ? (
                <Button
                  title={t('series.createCta')}
                  variant="gold"
                  onPress={() => router.push('/series/create')}
                  style={styles.seriesCreateBtn}
                />
              ) : null}
            </>
          }
          data={seriesList}
          keyExtractor={(i) => i.id}
          numColumns={2}
          columnWrapperStyle={{ paddingHorizontal: 4 }}
          contentContainerStyle={{ paddingBottom: Spacing.xxl }}
          ListEmptyComponent={
            user ? <Text style={styles.empty}>{emptyMessage}</Text> : null
          }
          renderItem={({ item }) => (
            <Pressable
              style={styles.seriesCard}
              onPress={() => router.push(`/series/${item.id}`)}
            >
              <View style={styles.seriesCover}>
                {item.coverUrl ? (
                  <Image source={{ uri: item.coverUrl }} style={styles.seriesCoverImg} />
                ) : (
                  <Text style={{ color: colors.or, fontFamily: Fonts.bold }}>S</Text>
                )}
              </View>
              <Text style={styles.seriesCardTitle} numberOfLines={2}>
                {item.title}
              </Text>
              <Text style={styles.seriesCardMeta}>
                {t('series.episodeCount', { count: item.episodeCount })}
              </Text>
            </Pressable>
          )}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <FlatList
        key={isGrid ? `grid-${activeTab}` : 'archives-list'}
        ListHeaderComponent={header}
        data={user ? listData : []}
        keyExtractor={(i) => i.id}
        numColumns={isGrid ? cols : 1}
        columnWrapperStyle={isGrid ? { gap } : undefined}
        contentContainerStyle={{ gap, paddingBottom: Spacing.xxl }}
        ListEmptyComponent={
          user ? <Text style={styles.empty}>{emptyMessage}</Text> : null
        }
        renderItem={({ item }) => {
          if (activeTab === 'archives') {
            return (
              <View style={styles.archiveRow}>
                <Pressable
                  onPress={() => router.push(`/video/${item.id}`)}
                  style={styles.archiveThumbWrap}
                >
                  <MediaThumb
                    thumbnailUrl={item.thumbnailUrl}
                    mediaType={item.mediaType}
                    videoUrl={item.videoUrl}
                    style={styles.archiveThumb}
                  />
                  <View style={styles.archiveBadge}>
                    <Text style={styles.archiveBadgeText}>
                      {t('feed.archivedBadge')}
                    </Text>
                  </View>
                </Pressable>
                <View style={styles.archiveMeta}>
                  <Text style={styles.archiveCaption} numberOfLines={2}>
                    {item.caption || item.handle}
                  </Text>
                  <View style={styles.archiveActions}>
                    <Pressable
                      style={styles.archiveActionBtn}
                      onPress={() => onUnarchive(item)}
                    >
                      <Text style={styles.archiveActionPrimary}>
                        {t('profile.unarchive')}
                      </Text>
                    </Pressable>
                    <Pressable
                      style={styles.archiveActionBtn}
                      onPress={() => onDeleteArchived(item)}
                    >
                      <Text style={styles.archiveActionDanger}>
                        {t('feed.delete')}
                      </Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            );
          }

          return (
            <Pressable
              onPress={() => router.push(`/video/${item.id}`)}
              onLongPress={
                activeTab === 'saves' ? () => confirmUnsave(item) : undefined
              }
              delayLongPress={350}
              accessibilityRole="button"
              accessibilityLabel={t('feed.play')}
            >
              <MediaThumb
                thumbnailUrl={item.thumbnailUrl}
                mediaType={item.mediaType}
                videoUrl={item.videoUrl}
                style={{
                  width: size,
                  height: size * (16 / 9),
                  backgroundColor: colors.noirSoft,
                  overflow: 'hidden',
                }}
              />
            </Pressable>
          );
        }}
      />
    </SafeAreaView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  const colors = useColors();
  return (
    <View style={{ alignItems: 'center' }}>
      <Text
        style={{
          color: colors.sable,
          fontFamily: Fonts.bold,
          fontSize: 16,
        }}
      >
        {value}
      </Text>
      <Text
        style={{
          color: colors.textMuted,
          fontFamily: Fonts.regular,
          fontSize: 11,
          marginTop: 2,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

