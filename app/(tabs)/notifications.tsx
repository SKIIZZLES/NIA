import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { MediaThumb } from '@/components/MediaThumb';
import { Fonts, Radii, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/context/ThemeContext';
import { useFeed } from '@/context/FeedContext';
import { useI18n } from '@/context/I18nContext';
import {
  fetchNotifications,
  markNotificationRead,
  isSupabaseConfigured,
  type NotificationWithActor,
} from '@/lib/notifications';

/**
 * Notifications — même grammaire visuelle que Découvrir : puces de filtre,
 * liste épurée, couleurs via useColors(). Groupées par fraîcheur.
 */

type FilterId = 'all' | 'like' | 'comment' | 'follow';
type Bucket = 'today' | 'week' | 'earlier';

const DAY_MS = 86_400_000;

const FILTER_ICONS: Record<FilterId, keyof typeof Ionicons.glyphMap> = {
  all: 'sparkles-outline',
  like: 'heart-outline',
  comment: 'chatbubble-outline',
  follow: 'person-add-outline',
};

const TYPE_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  like: 'heart',
  comment: 'chatbubble',
  follow: 'person-add',
};

function actorUsername(n: NotificationWithActor): string | null {
  const raw = n.profiles?.username;
  return raw ? raw.replace(/^@/, '') : null;
}

function actorAvatar(n: NotificationWithActor): string {
  if (n.profiles?.avatar_url) return n.profiles.avatar_url;
  const seed = actorUsername(n) || n.actor_id || 'nia';
  return `https://i.pravatar.cc/96?u=${encodeURIComponent(seed)}`;
}

/** Jour calendaire, puis 7 jours glissants, puis le reste. */
function bucketOf(iso: string, now: number): Bucket {
  const created = new Date(iso);
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  if (created.getTime() >= startOfToday.getTime()) return 'today';
  if (now - created.getTime() < 7 * DAY_MS) return 'week';
  return 'earlier';
}

export default function NotificationsScreen() {
  const { user } = useAuth();
  const { t } = useI18n();
  const colors = useColors();
  const router = useRouter();
  const { videos } = useFeed();
  const [items, setItems] = useState<NotificationWithActor[]>([]);
  const [filter, setFilter] = useState<FilterId>('all');
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

  /** La vignette vient du fil déjà chargé : aucune requête supplémentaire. */
  const videoById = useMemo(
    () => new Map(videos.map((v) => [v.id, v])),
    [videos],
  );

  const label = useCallback(
    (n: NotificationWithActor): string => {
      if (n.body) return n.body;
      switch (n.type) {
        case 'like':
          return t('notifications.liked');
        case 'comment':
          return t('notifications.commented');
        case 'follow':
          return t('notifications.followed');
        case 'system':
          return t('notifications.system');
        default:
          return t('notifications.interacted');
      }
    },
    [t],
  );

  const actorName = useCallback(
    (n: NotificationWithActor): string => {
      const u = actorUsername(n) || n.profiles?.display_name;
      return u ? `@${u.replace(/^@/, '')}` : t('notifications.someone');
    },
    [t],
  );

  const timeAgo = useCallback(
    (iso: string): string => {
      const diff = Date.now() - new Date(iso).getTime();
      const m = Math.floor(diff / 60000);
      if (m < 1) return t('notifications.justNow');
      if (m < 60) return t('notifications.minutesAgo', { count: m });
      const h = Math.floor(m / 60);
      if (h < 24) return t('notifications.hoursAgo', { count: h });
      const d = Math.floor(h / 24);
      return t('notifications.daysAgo', { count: d });
    },
    [t],
  );

  const filters = useMemo(
    () =>
      [
        { id: 'all' as FilterId, label: t('notifications.filterAll') },
        { id: 'like' as FilterId, label: t('notifications.filterLikes') },
        { id: 'comment' as FilterId, label: t('notifications.filterComments') },
        { id: 'follow' as FilterId, label: t('notifications.filterFollows') },
      ].map((f) => ({ ...f, icon: FILTER_ICONS[f.id] })),
    [t],
  );

  const sections = useMemo(() => {
    const now = Date.now();
    const visible =
      filter === 'all' ? items : items.filter((n) => n.type === filter);

    const groups: Record<Bucket, NotificationWithActor[]> = {
      today: [],
      week: [],
      earlier: [],
    };
    for (const n of visible) groups[bucketOf(n.created_at, now)].push(n);

    const titles: Record<Bucket, string> = {
      today: t('notifications.sectionToday'),
      week: t('notifications.sectionWeek'),
      earlier: t('notifications.sectionEarlier'),
    };

    return (['today', 'week', 'earlier'] as Bucket[])
      .filter((b) => groups[b].length > 0)
      .map((b) => ({ title: titles[b], data: groups[b] }));
  }, [items, filter, t]);

  const openTarget = useCallback(
    (n: NotificationWithActor) => {
      if (n.video_id && n.type !== 'follow') {
        router.push(`/video/${n.video_id}`);
        return;
      }
      const username = actorUsername(n);
      if (username) router.push(`/user/${username}`);
    },
    [router],
  );

  const onPressItem = useCallback(
    async (n: NotificationWithActor) => {
      openTarget(n);
      if (n.read_at) return;
      setItems((prev) =>
        prev.map((x) =>
          x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x,
        ),
      );
      try {
        await markNotificationRead(n.id);
      } catch {
        // Lecture non persistée : sans conséquence pour l'affichage.
      }
    },
    [openTarget],
  );

  const styles = useMemo(
    () =>
      StyleSheet.create({
        safe: { flex: 1, backgroundColor: colors.noir },
        header: { paddingHorizontal: Spacing.md, paddingTop: Spacing.sm },
        title: {
          color: colors.sable,
          fontFamily: Fonts.bold,
          fontSize: 24,
        },
        chipsRow: {
          gap: 8,
          paddingHorizontal: Spacing.md,
          paddingVertical: Spacing.md,
        },
        chip: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          height: 36,
          paddingHorizontal: 14,
          borderRadius: Radii.pill,
          backgroundColor: colors.noirSoft,
        },
        chipActive: { backgroundColor: colors.or },
        chipLabel: {
          color: colors.sable,
          fontFamily: Fonts.medium,
          fontSize: 13,
        },
        chipLabelActive: { color: colors.onAccent, fontFamily: Fonts.bold },
        sectionHeader: {
          paddingHorizontal: Spacing.md,
          paddingTop: Spacing.md,
          paddingBottom: Spacing.sm,
          backgroundColor: colors.noir,
        },
        sectionTitle: {
          color: colors.textSecondary,
          fontFamily: Fonts.medium,
          fontSize: 12,
          letterSpacing: 0.6,
          textTransform: 'uppercase',
        },
        row: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingHorizontal: Spacing.md,
          paddingVertical: 10,
        },
        rowUnread: { backgroundColor: colors.noirElevated },
        avatarWrap: { width: 48, height: 48 },
        avatar: {
          width: 48,
          height: 48,
          borderRadius: 24,
          backgroundColor: colors.noirSoft,
        },
        typeBadge: {
          position: 'absolute',
          right: -2,
          bottom: -2,
          width: 20,
          height: 20,
          borderRadius: 10,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.or,
          borderWidth: 2,
          borderColor: colors.noir,
        },
        body: { flex: 1 },
        text: {
          color: colors.textPrimary,
          fontFamily: Fonts.regular,
          fontSize: 14,
          lineHeight: 19,
        },
        actor: { color: colors.sable, fontFamily: Fonts.bold },
        time: {
          marginTop: 3,
          color: colors.textMuted,
          fontFamily: Fonts.regular,
          fontSize: 11,
        },
        unreadDot: {
          width: 8,
          height: 8,
          borderRadius: 4,
          backgroundColor: colors.or,
        },
        thumb: {
          width: 42,
          height: 56,
          borderRadius: Radii.sm,
        },
        center: {
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          paddingVertical: Spacing.xxl,
        },
        emptyContainer: { flexGrow: 1 },
        empty: {
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: Spacing.lg,
          paddingBottom: Spacing.xxl,
          gap: 10,
        },
        iconRing: {
          width: 64,
          height: 64,
          borderRadius: 32,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.noirSoft,
          marginBottom: Spacing.sm,
        },
        emptyTitle: {
          color: colors.sable,
          fontFamily: Fonts.bold,
          fontSize: 16,
        },
        emptyBody: {
          color: colors.textMuted,
          fontFamily: Fonts.regular,
          fontSize: 13,
          textAlign: 'center',
          lineHeight: 18,
        },
      }),
    [colors],
  );

  const header = (
    <View>
      <View style={styles.header}>
        <Text style={styles.title}>{t('notifications.title')}</Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipsRow}
      >
        {filters.map((f) => {
          const active = filter === f.id;
          return (
            <Pressable
              key={f.id}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => setFilter(f.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Ionicons
                name={f.icon}
                size={15}
                color={active ? colors.onAccent : colors.or}
              />
              <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>
                {f.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );

  const empty =
    loading && items.length === 0 ? (
      <View style={styles.center}>
        <ActivityIndicator color={colors.or} />
      </View>
    ) : (
      <View style={styles.empty}>
        <View style={styles.iconRing}>
          <Ionicons name="notifications-outline" size={30} color={colors.or} />
        </View>
        <Text style={styles.emptyTitle}>{t('notifications.emptyTitle')}</Text>
        <Text style={styles.emptyBody}>{t('notifications.emptyBody')}</Text>
      </View>
    );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <SectionList
        sections={sections}
        keyExtractor={(n) => n.id}
        stickySectionHeadersEnabled={false}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        contentContainerStyle={
          sections.length === 0 ? styles.emptyContainer : undefined
        }
        refreshControl={
          canFetch ? (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void load(true)}
              tintColor={colors.or}
            />
          ) : undefined
        }
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
          </View>
        )}
        renderItem={({ item }) => {
          const video = item.video_id ? videoById.get(item.video_id) : undefined;
          const badge = TYPE_ICONS[item.type];
          const unread = !item.read_at;
          return (
            <Pressable
              style={[styles.row, unread && styles.rowUnread]}
              onPress={() => void onPressItem(item)}
              accessibilityRole="button"
              accessibilityLabel={`${actorName(item)} ${label(item)}`}
            >
              <View style={styles.avatarWrap}>
                <Image
                  source={{ uri: actorAvatar(item) }}
                  style={styles.avatar}
                />
                {badge ? (
                  <View style={styles.typeBadge}>
                    <Ionicons name={badge} size={11} color={colors.onAccent} />
                  </View>
                ) : null}
              </View>

              <View style={styles.body}>
                <Text style={styles.text} numberOfLines={2}>
                  <Text style={styles.actor}>{actorName(item)}</Text>{' '}
                  {label(item)}
                </Text>
                <Text style={styles.time}>{timeAgo(item.created_at)}</Text>
              </View>

              {unread ? <View style={styles.unreadDot} /> : null}

              {video ? (
                <MediaThumb
                  thumbnailUrl={video.thumbnailUrl}
                  mediaType={video.mediaType}
                  videoUrl={video.videoUrl}
                  style={styles.thumb}
                  showVideoBadge={false}
                />
              ) : null}
            </Pressable>
          );
        }}
      />
    </SafeAreaView>
  );
}
