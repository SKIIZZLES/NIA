import React, { useCallback, useEffect, useState } from 'react';
import {
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
import { useAuth } from '@/context/AuthContext';
import { useFeed } from '@/context/FeedContext';
import { useI18n } from '@/context/I18nContext';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { useRouter } from 'expo-router';
import { MediaThumb } from '@/components/MediaThumb';
import {
  countFollowers,
  countFollowing,
  fetchVideosByUserId,
} from '@/lib/profiles';
import { formatCount } from '@/data/mockVideos';

export default function ProfileScreen() {
  const { user, signOut } = useAuth();
  const { videos } = useFeed();
  const { t } = useI18n();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const gap = 2;
  const cols = 3;
  const size = (width - gap * (cols - 1)) / cols;

  const [followerCount, setFollowerCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);

  const myVideos = videos.filter(
    (v) =>
      user &&
      (v.userId === user.id ||
        v.handle === `@${user.username}` ||
        v.id.startsWith('local_')),
  );

  const [grid, setGrid] = useState(myVideos);

  const loadCounts = useCallback(async () => {
    if (!user) {
      setFollowerCount(0);
      setFollowingCount(0);
      return;
    }
    try {
      const [f1, f2, remote] = await Promise.all([
        countFollowers(user.id),
        countFollowing(user.id),
        fetchVideosByUserId(user.id, { includeArchived: true }),
      ]);
      setFollowerCount(f1);
      setFollowingCount(f2);
      if (remote.length) setGrid(remote);
      else setGrid(myVideos.length ? myVideos : []);
    } catch {
      setGrid(myVideos.length ? myVideos : []);
    }
  }, [user, myVideos.length]);

  useEffect(() => {
    loadCounts();
  }, [loadCounts]);

  useEffect(() => {
    if (myVideos.length) setGrid(myVideos);
  }, [videos, user?.id]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <FlatList
        ListHeaderComponent={
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
              <Stat label={t('profile.posts')} value={String(grid.length)} />
              <Stat label={t('profile.followers')} value={formatCount(followerCount)} />
              <Stat label={t('profile.following')} value={formatCount(followingCount)} />
            </View>
            <LanguageToggle />
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
          </View>
        }
        data={grid}
        keyExtractor={(i) => i.id}
        numColumns={cols}
        columnWrapperStyle={{ gap }}
        contentContainerStyle={{ gap }}
        ListEmptyComponent={
          <Text style={styles.empty}>{t('profile.empty')}</Text>
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push(`/video/${item.id}`)}
            accessibilityRole="button"
            accessibilityLabel={t('feed.play')}
          >
            <MediaThumb
              thumbnailUrl={item.thumbnailUrl}
              mediaType={item.mediaType}
              videoUrl={item.videoUrl}
              style={{width: size,
                height: size * (16 / 9),
                backgroundColor: Colors.noirSoft,
                overflow: 'hidden',}}
            />
            {item.status === 'archived' ? (
              <View
                style={{
                  position: 'absolute',
                  left: 6,
                  bottom: 6,
                  backgroundColor: 'rgba(11,11,11,0.7)',
                  paddingHorizontal: 6,
                  paddingVertical: 2,
                  borderRadius: 8,
                }}
              >
                <Text style={{ color: Colors.or, fontFamily: Fonts.medium, fontSize: 10 }}>
                  {t('feed.archivedBadge')}
                </Text>
              </View>
            ) : null}
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.noir },
  header: {
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.lg,
    paddingTop: Spacing.md,
  },
  avatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 2,
    borderColor: Colors.or,
  },
  displayName: {
    marginTop: Spacing.md,
    color: Colors.sable,
    fontFamily: Fonts.bold,
    fontSize: 20,
  },
  username: {
    marginTop: 4,
    color: Colors.textSecondary,
    fontFamily: Fonts.medium,
    fontSize: 14,
  },
  bio: {
    marginTop: 6,
    color: Colors.textSecondary,
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
    color: Colors.sable,
    fontFamily: Fonts.bold,
    fontSize: 16,
  },
  statLabel: {
    color: Colors.textMuted,
    fontFamily: Fonts.regular,
    fontSize: 11,
    marginTop: 2,
  },
  editBtn: {
    marginTop: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 999,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  editBtnText: {
    color: Colors.sable,
    fontFamily: Fonts.medium,
    fontSize: 14,
  },
  linkBtn: { marginTop: Spacing.sm, padding: 6 },
  linkText: {
    color: Colors.or,
    fontFamily: Fonts.medium,
    fontSize: 13,
  },
  empty: {
    textAlign: 'center',
    color: Colors.textMuted,
    fontFamily: Fonts.regular,
    marginTop: Spacing.lg,
  },
});
