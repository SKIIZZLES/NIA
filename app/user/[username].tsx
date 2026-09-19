import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
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
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { MediaThumb } from '@/components/MediaThumb';
import { Ionicons } from '@expo/vector-icons';
import { FollowButton } from '@/components/FollowButton';
import { ReportSheet } from '@/components/ReportSheet';
import { useAuth } from '@/context/AuthContext';
import { useFeed } from '@/context/FeedContext';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import {
  fetchProfileByUsername,
  fetchVideosByUserId,
  type PublicProfile,
} from '@/lib/profiles';
import type { VideoItem } from '@/data/mockVideos';
import { formatCount } from '@/data/mockVideos';

export default function PublicProfileScreen() {
  const { username: raw } = useLocalSearchParams<{ username: string }>();
  const username = (Array.isArray(raw) ? raw[0] : raw || '').replace(/^@/, '');
  const router = useRouter();
  const { user } = useAuth();
  const {
    followingIds,
    toggleFollow,
    videos: feedVideos,
    blockedIds,
    blockUser,
  } = useFeed();
  const { width } = useWindowDimensions();
  const gap = 2;
  const cols = 3;
  const size = (width - gap * (cols - 1)) / cols;

  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [grid, setGrid] = useState<VideoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);

  const load = useCallback(async () => {
    if (!username) {
      setError('Profil introuvable');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const p = await fetchProfileByUsername(username);
      if (!p) {
        setProfile(null);
        setGrid([]);
        setError('Profil introuvable');
        return;
      }
      setProfile(p);
      let vids = await fetchVideosByUserId(p.id);
      if (!vids.length) {
        vids = feedVideos.filter(
          (v) =>
            v.userId === p.id ||
            v.handle.replace(/^@/, '').toLowerCase() === p.username.toLowerCase(),
        );
      }
      setGrid(vids);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur de chargement');
    } finally {
      setLoading(false);
    }
  }, [username, feedVideos]);

  useEffect(() => {
    load();
  }, [load]);

  const isOwn = !!user && !!profile && (user.id === profile.id || user.username === profile.username);
  const following = profile ? followingIds.has(profile.id) : false;
  const isBlocked = profile ? blockedIds.has(profile.id) : false;

  const onBlock = () => {
    if (!profile || isOwn) return;
    Alert.alert(
      'Bloquer cet utilisateur ?',
      `Vous ne verrez plus les vidéos de @${profile.username}.`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Bloquer',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              const result = await blockUser(profile.id);
              if (!result.ok) {
                Alert.alert('Erreur', result.message);
                return;
              }
              Alert.alert(
                'Utilisateur bloqué',
                result.mock
                  ? 'Blocage enregistré (mode démo).'
                  : `@${profile.username} a été bloqué.`,
              );
              router.back();
            })();
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color={Colors.sable} />
        </Pressable>
        <Text style={styles.topTitle} numberOfLines={1}>
          @{username || 'profil'}
        </Text>
        {!isOwn && profile ? (
          <Pressable
            onPress={() => setReportOpen(true)}
            hitSlop={12}
            style={styles.backBtn}
            accessibilityLabel="Signaler le profil"
          >
            <Ionicons name="flag-outline" size={22} color={Colors.sable} />
          </Pressable>
        ) : (
          <View style={{ width: 36 }} />
        )}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.or} />
        </View>
      ) : error || !profile ? (
        <View style={styles.center}>
          <Ionicons name="person-outline" size={40} color={Colors.textMuted} />
          <Text style={styles.error}>{error || 'Profil introuvable'}</Text>
          <Pressable style={styles.retryBtn} onPress={() => void load()}>
            <Text style={styles.retryText}>Réessayer</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          ListHeaderComponent={
            <View style={styles.header}>
              <Image source={{ uri: profile.avatarUrl }} style={styles.avatar} />
              <Text style={styles.displayName}>{profile.displayName}</Text>
              <Text style={styles.username}>@{profile.username}</Text>
              {profile.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}
              <View style={styles.stats}>
                <Stat label="Publications" value={String(grid.length)} />
                <Stat label="Abonnés" value={formatCount(profile.followerCount)} />
                <Stat label="Abonnements" value={formatCount(profile.followingCount)} />
              </View>
              {isOwn ? (
                <Pressable
                  style={styles.editBtn}
                  onPress={() => router.push('/edit-profile')}
                >
                  <Text style={styles.editBtnText}>Modifier le profil</Text>
                </Pressable>
              ) : (
                <View style={styles.actionsRow}>
                  <FollowButton
                    following={following}
                    onPress={() => toggleFollow(profile.id)}
                  />
                  <Pressable
                    style={[styles.blockBtn, isBlocked && styles.blockBtnDone]}
                    onPress={onBlock}
                    disabled={isBlocked}
                  >
                    <Text style={styles.blockBtnText}>
                      {isBlocked ? 'Bloqué' : 'Bloquer'}
                    </Text>
                  </Pressable>
                </View>
              )}
            </View>
          }
          data={grid}
          keyExtractor={(i) => i.id}
          numColumns={cols}
          columnWrapperStyle={{ gap }}
          contentContainerStyle={{ gap, paddingBottom: Spacing.xxl }}
          ListEmptyComponent={
            <Text style={styles.empty}>Aucune publication pour l’instant.</Text>
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push(`/video/${item.id}`)}
              accessibilityRole="button"
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
            </Pressable>
          )}
        />
      )}

      {profile ? (
        <ReportSheet
          visible={reportOpen}
          onClose={() => setReportOpen(false)}
          reporterId={user?.id}
          targetType="user"
          targetId={profile.id}
          onDone={(message) => Alert.alert('Signalement', message)}
        />
      ) : null}
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
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  topTitle: {
    flex: 1,
    textAlign: 'center',
    color: Colors.sable,
    fontFamily: Fonts.bold,
    fontSize: 16,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: Spacing.lg },
  error: {
    color: Colors.textSecondary,
    fontFamily: Fonts.regular,
    fontSize: 15,
  },
  header: {
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.lg,
    paddingTop: Spacing.sm,
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
    marginTop: 8,
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
  actionsRow: {
    marginTop: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  blockBtn: {
    borderWidth: 1,
    borderColor: Colors.danger,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  blockBtnDone: {
    opacity: 0.55,
    borderColor: Colors.border,
  },
  blockBtnText: {
    color: Colors.danger,
    fontFamily: Fonts.medium,
    fontSize: 14,
  },
  retryBtn: {
    marginTop: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 8,
  },
  retryText: {
    color: Colors.or,
    fontFamily: Fonts.medium,
    fontSize: 14,
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
  empty: {
    textAlign: 'center',
    color: Colors.textMuted,
    fontFamily: Fonts.regular,
    marginTop: Spacing.lg,
  },
});
