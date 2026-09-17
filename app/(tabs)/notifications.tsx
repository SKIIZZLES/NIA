import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { Colors, Fonts, Radii, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import {
  fetchNotifications,
  markNotificationRead,
  isSupabaseConfigured,
  type NotificationWithActor,
} from '@/lib/notifications';

function actorName(n: NotificationWithActor): string {
  const u = n.profiles?.username || n.profiles?.display_name;
  if (u) return `@${u.replace(/^@/, '')}`;
  return 'Quelqu’un';
}

function actorAvatar(n: NotificationWithActor): string {
  if (n.profiles?.avatar_url) return n.profiles.avatar_url;
  const u = n.profiles?.username || n.actor_id || 'nia';
  return `https://i.pravatar.cc/80?u=${encodeURIComponent(u)}`;
}

function notifLabel(n: NotificationWithActor): string {
  if (n.body) return n.body;
  switch (n.type) {
    case 'like':
      return 'a aimé votre vidéo';
    case 'comment':
      return 'a commenté votre vidéo';
    case 'follow':
      return 's’est abonné·e à vous';
    case 'system':
      return 'Notification système';
    default:
      return 'a interagi avec vous';
  }
}

function notifIcon(type: string): keyof typeof Ionicons.glyphMap {
  switch (type) {
    case 'like':
      return 'heart';
    case 'comment':
      return 'chatbubble';
    case 'follow':
      return 'person-add';
    default:
      return 'notifications';
  }
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'à l’instant';
  if (m < 60) return `il y a ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.floor(h / 24);
  return `il y a ${d} j`;
}

export default function NotificationsScreen() {
  const { user } = useAuth();
  const [items, setItems] = useState<NotificationWithActor[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const canFetch =
    isSupabaseConfigured && !!user && !user.id.startsWith('mock_');

  const load = useCallback(
    async (soft = false) => {
      if (!canFetch) {
        setItems([]);
        return;
      }
      if (soft) setRefreshing(true);
      else setLoading(true);
      try {
        const rows = await fetchNotifications(user!.id);
        setItems(rows);
      } catch {
        setItems([]);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [canFetch, user],
  );

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const onPressItem = async (n: NotificationWithActor) => {
    if (n.read_at) return;
    setItems((prev) =>
      prev.map((x) =>
        x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x,
      ),
    );
    try {
      await markNotificationRead(n.id);
    } catch {
      // ignore
    }
  };

  const empty = (
    <View style={styles.emptyCard}>
      <View style={styles.iconRing}>
        <Ionicons name="notifications-outline" size={36} color={Colors.or} />
      </View>
      <Text style={styles.emptyTitle}>Rien pour l’instant</Text>
      <Text style={styles.emptyBody}>
        Quand la communauté interagit avec vos contenus, tout apparaîtra ici —
        clairement, sans bruit inutile.
      </Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Text style={styles.title}>Notifications</Text>
      <Text style={styles.subtitle}>
        Activité autour de votre profil et de vos publications.
      </Text>

      {loading && items.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.or} />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(n) => n.id}
          refreshControl={
            canFetch ? (
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => void load(true)}
                tintColor={Colors.or}
              />
            ) : undefined
          }
          ListEmptyComponent={empty}
          contentContainerStyle={
            items.length === 0 ? styles.emptyContainer : undefined
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => void onPressItem(item)}
              style={[styles.row, !item.read_at && styles.rowUnread]}
            >
              <Image source={{ uri: actorAvatar(item) }} style={styles.avatar} />
              <View style={styles.rowBody}>
                <Text style={styles.rowText}>
                  <Text style={styles.actor}>{actorName(item)}</Text>
                  {' '}
                  {notifLabel(item)}
                </Text>
                <Text style={styles.time}>{timeAgo(item.created_at)}</Text>
              </View>
              <Ionicons
                name={notifIcon(item.type)}
                size={18}
                color={item.type === 'like' ? '#E74C3C' : Colors.or}
              />
            </Pressable>
          )}
        />
      )}

      {!canFetch ? (
        <View style={styles.note}>
          <Ionicons name="information-circle-outline" size={14} color={Colors.textMuted} />
          <Text style={styles.noteText}>
            Connectez-vous avec Supabase pour recevoir likes, commentaires et
            nouveaux abonnés. Messagerie privée reportée en phase 2.
          </Text>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.noir, paddingHorizontal: Spacing.lg },
  title: {
    color: Colors.sable,
    fontFamily: Fonts.bold,
    fontSize: 28,
    marginTop: Spacing.md,
  },
  subtitle: {
    color: Colors.textSecondary,
    fontFamily: Fonts.regular,
    fontSize: 13,
    marginTop: 6,
    marginBottom: Spacing.lg,
    lineHeight: 18,
  },
  center: { paddingVertical: 48, alignItems: 'center' },
  emptyContainer: { flexGrow: 1 },
  emptyCard: {
    alignItems: 'center',
    paddingVertical: Spacing.xl,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radii.lg,
    backgroundColor: Colors.noirElevated,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  iconRing: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.noirSoft,
    borderWidth: 1,
    borderColor: 'rgba(201, 162, 39, 0.4)',
    marginBottom: Spacing.md,
  },
  emptyTitle: {
    color: Colors.sable,
    fontFamily: Fonts.bold,
    fontSize: 18,
  },
  emptyBody: {
    marginTop: 8,
    color: Colors.textSecondary,
    fontFamily: Fonts.regular,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: Radii.md,
    backgroundColor: Colors.noirElevated,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 8,
  },
  rowUnread: {
    borderColor: 'rgba(201, 162, 39, 0.45)',
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: Colors.or,
  },
  rowBody: { flex: 1 },
  rowText: {
    color: Colors.textPrimary,
    fontFamily: Fonts.regular,
    fontSize: 14,
    lineHeight: 20,
  },
  actor: {
    color: Colors.sable,
    fontFamily: Fonts.bold,
  },
  time: {
    marginTop: 4,
    color: Colors.textMuted,
    fontFamily: Fonts.regular,
    fontSize: 11,
  },
  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: Spacing.md,
    marginBottom: Spacing.lg,
    padding: Spacing.md,
    borderRadius: Radii.md,
    backgroundColor: Colors.noirSoft,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  noteText: {
    flex: 1,
    color: Colors.textMuted,
    fontFamily: Fonts.regular,
    fontSize: 12,
    lineHeight: 17,
  },
});
