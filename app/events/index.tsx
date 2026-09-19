/**
 * Liste des événements — filtres À venir / Week-end / Populaires + catégories.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/Button';
import { useAuth } from '@/context/AuthContext';
import { useI18n } from '@/context/I18nContext';
import { useColors } from '@/context/ThemeContext';
import { Fonts, Radii, Spacing } from '@/constants/theme';
import {
  EVENT_CATEGORIES,
  type EventCategoryId,
} from '@/constants/eventCategories';
import {
  listEvents,
  isSupabaseConfigured,
  type EventItem,
  type EventListFilter,
} from '@/lib/events';
import { formatCount } from '@/data/mockVideos';

function formatWhen(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const tag = locale.startsWith('fr') ? 'fr-FR' : undefined;
  return d.toLocaleString(tag, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function EventsIndexScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { t, locale } = useI18n();
  const colors = useColors();
  const [filter, setFilter] = useState<EventListFilter>('upcoming');
  const [category, setCategory] = useState<EventCategoryId | null>(null);
  const [items, setItems] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      if (!isSupabaseConfigured) {
        setItems([]);
        return;
      }
      const rows = await listEvents({
        filter,
        category,
        userId: user?.id ?? null,
      });
      setItems(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('events.loadFail'));
      setItems([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filter, category, user?.id, t]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  const timeFilters = useMemo(
    () =>
      [
        { id: 'upcoming' as const, label: t('events.filterUpcoming') },
        { id: 'weekend' as const, label: t('events.filterWeekend') },
        { id: 'popular' as const, label: t('events.filterPopular') },
      ] as const,
    [t],
  );

  const styles = useMemo(
    () =>
      StyleSheet.create({
        safe: { flex: 1, backgroundColor: colors.noir },
        topBar: {
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: Spacing.md,
          paddingVertical: Spacing.sm,
          gap: 8,
        },
        backBtn: {
          width: 36,
          height: 36,
          alignItems: 'center',
          justifyContent: 'center',
        },
        topTitle: {
          color: colors.sable,
          fontFamily: Fonts.bold,
          fontSize: 18,
          flex: 1,
        },
        createBtn: {
          paddingHorizontal: 10,
          paddingVertical: 6,
          borderRadius: Radii.pill,
          borderWidth: 1,
          borderColor: colors.or,
        },
        createBtnText: {
          color: colors.or,
          fontFamily: Fonts.medium,
          fontSize: 13,
        },
        subtitle: {
          color: colors.textSecondary,
          fontFamily: Fonts.regular,
          fontSize: 13,
          paddingHorizontal: Spacing.lg,
          marginBottom: Spacing.sm,
          lineHeight: 18,
        },
        chipsRow: {
          paddingHorizontal: Spacing.lg,
          paddingBottom: Spacing.sm,
          flexDirection: 'row',
          alignItems: 'center',
        },
        chip: {
          paddingHorizontal: 12,
          paddingVertical: 8,
          borderRadius: Radii.pill,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.noirSoft,
          marginRight: 8,
        },
        chipOn: {
          borderColor: colors.or,
          backgroundColor: 'rgba(201, 162, 39, 0.18)',
        },
        chipText: {
          color: colors.textSecondary,
          fontFamily: Fonts.medium,
          fontSize: 13,
        },
        chipTextOn: { color: colors.or },
        list: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.xxl },
        card: {
          backgroundColor: colors.noirElevated,
          borderRadius: Radii.lg,
          borderWidth: 1,
          borderColor: colors.border,
          marginBottom: Spacing.md,
          overflow: 'hidden',
        },
        cover: {
          width: '100%',
          height: 140,
          backgroundColor: colors.noirSoft,
        },
        coverPlaceholder: {
          width: '100%',
          height: 140,
          backgroundColor: colors.noirSoft,
          alignItems: 'center',
          justifyContent: 'center',
        },
        cardBody: { padding: Spacing.md, gap: 6 },
        cardTitle: {
          color: colors.sable,
          fontFamily: Fonts.bold,
          fontSize: 17,
        },
        meta: {
          color: colors.textSecondary,
          fontFamily: Fonts.regular,
          fontSize: 13,
          flex: 1,
        },
        rowMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
        catBadge: {
          alignSelf: 'flex-start',
          paddingHorizontal: 8,
          paddingVertical: 3,
          borderRadius: Radii.pill,
          backgroundColor: 'rgba(209, 127, 42, 0.16)',
          borderWidth: 1,
          borderColor: colors.border,
          marginTop: 4,
        },
        catBadgeText: {
          color: colors.or,
          fontFamily: Fonts.medium,
          fontSize: 11,
        },
        center: {
          padding: Spacing.xl,
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          minHeight: 280,
        },
        emptyTitle: {
          color: colors.sable,
          fontFamily: Fonts.bold,
          fontSize: 16,
          textAlign: 'center',
        },
        emptyBody: {
          color: colors.textMuted,
          fontFamily: Fonts.regular,
          fontSize: 13,
          textAlign: 'center',
          lineHeight: 18,
        },
        err: {
          color: colors.textSecondary,
          fontFamily: Fonts.regular,
          fontSize: 14,
          textAlign: 'center',
        },
      }),
    [colors],
  );

  const categoryLabel = (id: EventCategoryId) => {
    const cat = EVENT_CATEGORIES.find((c) => c.id === id);
    return cat ? t(cat.labelKey) : id;
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <Pressable
          onPress={() => router.back()}
          style={styles.backBtn}
          hitSlop={8}
          accessibilityLabel={t('common.back')}
        >
          <Ionicons name="chevron-back" size={24} color={colors.sable} />
        </Pressable>
        <Text style={styles.topTitle}>{t('events.title')}</Text>
        <Pressable
          onPress={() => router.push('/events/create')}
          style={styles.createBtn}
          hitSlop={6}
        >
          <Text style={styles.createBtnText}>{t('events.createShort')}</Text>
        </Pressable>
      </View>

      <Text style={styles.subtitle}>{t('events.subtitle')}</Text>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipsRow}
      >
        {timeFilters.map((f) => {
          const on = filter === f.id;
          return (
            <Pressable
              key={f.id}
              onPress={() => setFilter(f.id)}
              style={[styles.chip, on && styles.chipOn]}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>
                {f.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipsRow}
      >
        <Pressable
          onPress={() => setCategory(null)}
          style={[styles.chip, !category && styles.chipOn]}
        >
          <Text style={[styles.chipText, !category && styles.chipTextOn]}>
            {t('events.filterAll')}
          </Text>
        </Pressable>
        {EVENT_CATEGORIES.map((c) => {
          const on = category === c.id;
          return (
            <Pressable
              key={c.id}
              onPress={() =>
                setCategory((prev) => (prev === c.id ? null : c.id))
              }
              style={[styles.chip, on && styles.chipOn]}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>
                {t(c.labelKey)}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.or} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.err}>{error}</Text>
          <Button
            title={t('common.back')}
            variant="outline"
            onPress={() => {
              setLoading(true);
              void load();
            }}
          />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(e) => e.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void load();
              }}
              tintColor={colors.or}
            />
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Ionicons name="calendar-outline" size={40} color={colors.or} />
              <Text style={styles.emptyTitle}>{t('events.empty')}</Text>
              <Text style={styles.emptyBody}>
                {!isSupabaseConfigured
                  ? t('events.mockHint')
                  : t('events.emptyHint')}
              </Text>
              <Button
                title={t('events.create')}
                variant="gold"
                onPress={() => router.push('/events/create')}
                style={{ marginTop: Spacing.md }}
              />
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              style={styles.card}
              onPress={() => router.push(`/events/${item.id}`)}
            >
              {item.coverUrl ? (
                <Image source={{ uri: item.coverUrl }} style={styles.cover} />
              ) : (
                <View style={styles.coverPlaceholder}>
                  <Ionicons name="calendar" size={36} color={colors.or} />
                </View>
              )}
              <View style={styles.cardBody}>
                <Text style={styles.cardTitle} numberOfLines={2}>
                  {item.title}
                </Text>
                <View style={styles.rowMeta}>
                  <Ionicons
                    name="time-outline"
                    size={14}
                    color={colors.textMuted}
                  />
                  <Text style={styles.meta}>
                    {formatWhen(item.startsAt, locale)}
                  </Text>
                </View>
                {item.city || item.locationText ? (
                  <View style={styles.rowMeta}>
                    <Ionicons
                      name="location-outline"
                      size={14}
                      color={colors.textMuted}
                    />
                    <Text style={styles.meta} numberOfLines={1}>
                      {[item.locationText, item.city, item.country]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                  </View>
                ) : null}
                <View style={styles.rowMeta}>
                  <Ionicons
                    name="people-outline"
                    size={14}
                    color={colors.textMuted}
                  />
                  <Text style={styles.meta}>
                    {t('events.attendees', {
                      count: formatCount(item.attendeeCount),
                    })}
                  </Text>
                </View>
                <View style={styles.catBadge}>
                  <Text style={styles.catBadgeText}>
                    {categoryLabel(item.category)}
                  </Text>
                </View>
              </View>
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}
