import React from 'react';
import {
  FlatList,
  Image,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/Button';
import { useAuth } from '@/context/AuthContext';
import { useFeed } from '@/context/FeedContext';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { useRouter } from 'expo-router';

export default function ProfileScreen() {
  const { user, signOut } = useAuth();
  const { videos } = useFeed();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const gap = 2;
  const cols = 3;
  const size = (width - gap * (cols - 1)) / cols;

  const myVideos = videos.filter(
    (v) => user && (v.handle === `@${user.username}` || v.id.startsWith('local_')),
  );
  const grid = myVideos.length ? myVideos : videos.slice(0, 6);

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
            <Text style={styles.username}>@{user?.username || 'invite'}</Text>
            <Text style={styles.bio}>{user?.bio || 'Profil NIA'}</Text>
            <View style={styles.stats}>
              <Stat label="Publications" value={String(grid.length)} />
              <Stat label="Abonnés" value="12.4K" />
              <Stat label="Abonnements" value="128" />
            </View>
            <Button
              title="Se déconnecter"
              variant="outline"
              onPress={async () => {
                await signOut();
                router.replace('/welcome');
              }}
              style={{ marginTop: Spacing.md, alignSelf: 'stretch' }}
            />
          </View>
        }
        data={grid}
        keyExtractor={(i) => i.id}
        numColumns={cols}
        columnWrapperStyle={{ gap }}
        contentContainerStyle={{ gap }}
        renderItem={({ item }) => (
          <Image
            source={{ uri: item.thumbnailUrl }}
            style={{ width: size, height: size * 1.35, backgroundColor: Colors.noirSoft }}
          />
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
  username: {
    marginTop: Spacing.md,
    color: Colors.sable,
    fontFamily: Fonts.bold,
    fontSize: 20,
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
});
