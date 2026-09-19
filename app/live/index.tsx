/**
 * Hub Live — En direct / Programmés / Populaires.
 * Pas de player vidéo fake : listes + CTA créer seulement.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
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
import { useI18n } from '@/context/I18nContext';
import { useColors } from '@/context/ThemeContext';
import { Fonts, Radii, Spacing } from '@/constants/theme';
import { LIVE_CATEGORIES, type LiveCategoryId } from '@/constants/liveCategories';
import {
  listLiveNow,
  listScheduled,
  listPopular,
  isSupabaseConfigured,
  type LiveStreamItem,
} from '@/lib/live';
import { formatCount } from '@/data/mockVideos';

function formatWhen(iso: string | null, locale: string): string {
  if (!iso) return '—';
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

type SectionKey = 'live' | 'scheduled' | 'popular';

export default function LiveIndexScreen() {
  const router = useRouter();
  const { t, locale } = useI18n();
  const colors = useColors();
  const [liveNow, setLiveNow] = useState<LiveStreamItem[]>([]);
  const [scheduled, setScheduled] = useState<LiveStreamItem[]>([]);
  const [popular, setPopular] = useState<LiveStreamItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      if (!isSupabaseConfigured) {
        setLiveNow([]);
        setScheduled([]);
        setPopular([]);
        return;
      }
      const [a, b, c] = await Promise.all([
        listLiveNow(),
        listScheduled(),
        listPopular(),
      ]);
      setLiveNow(a);
      setScheduled(b);
      setPopular(c);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('live.loadFail'));
      setLiveNow([]);
      setScheduled([]);
      setPopular([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [t]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  const categoryLabel = (id: LiveCategoryId) => {
    const cat = LIVE_CATEGORIES.find((c) => c.id === id);
    return cat ? t(cat.labelKey) : id;
  };

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
        honesty: {
          marginHorizontal: Spacing.lg,
          marginBottom: Spacing.md,
          padding: Spacing.md,
          borderRadius: Radii.md,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.noirElevated,
          gap: 6,
        },
        honestyTitle: {
          color: colors.or,
          fontFamily: Fonts.bold,
          fontSize: 13,
        },
        honestyBody: {
          color: colors.textMuted,
          fontFamily: Fonts.regular,
          fontSize: 12,
          lineHeight: 17,
        },
        sectionTitle: {
          color: colors.sable,
          fontFamily: Fonts.bold,
          fontSize: 16,
          paddingHorizontal: Spacing.lg,
          marginTop: Spacing.md,
          marginBottom: Spacing.sm,
        },
        listPad: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.sm },
        card: {
          backgroundColor: colors.noirElevated,
          borderRadius: Radii.lg,
          borderWidth: 1,
          borderColor: colors.border,
          marginBottom: Spacing.md,
          overflow: 'hidden',
          flexDirection: 'row',
        },
        thumb: {
          width: 96,
          height: 96,
          backgroundColor: colors.noirSoft,
        },
        thumbPlaceholder: {
          width: 96,
          height: 96,
          backgroundColor: colors.noirSoft,
          alignItems: 'center',
          justifyContent: 'center',
        },
        cardBody: { flex: 1, padding: Spacing.md, gap: 4 },
        cardTitle: {
          color: colors.sable,
          fontFamily: Fonts.bold,
          fontSize: 15,
        },
        meta: {
          color: colors.textSecondary,
          fontFamily: Fonts.regular,
          fontSize: 12,
        },
        badge: {
          alignSelf: 'flex-start',
          paddingHorizontal: 8,
          paddingVertical: 2,
          borderRadius: Radii.pill,
          backgroundColor: 'rgba(209, 127, 42, 0.16)',
          borderWidth: 1,
          borderColor: colors.border,
          marginTop: 4,
        },
        badgeLive: {
          backgroundColor: 'rgba(220, 38, 38, 0.2)',
          borderColor: 'rgba(220, 38, 38, 0.45)',
        },
        badgeText: {
          color: colors.or,
          fontFamily: Fonts.medium,
          fontSize: 10,
        },
        badgeTextLive: { color: '#f87171' },
        emptyBox: {
          marginHorizontal: Spacing.lg,
          marginBottom: Spacing.md,
          padding: Spacing.md,
          borderRadius: Radii.md,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.noirSoft,
          alignItems: 'center',
          gap: 8,
        },
        emptyText: {
          color: colors.textMuted,
          fontFamily: Fonts.regular,
          fontSize: 13,
          textAlign: 'center',
          lineHeight: 18,
        },
        center: {
          padding: Spacing.xl,
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          minHeight: 200,
        },
        err: {
          color: colors.textSecondary,
          fontFamily: Fonts.regular,
          fontSize: 14,
          textAlign: 'center',
        },
        startWrap: {
          paddingHorizontal: Spacing.lg,
          paddingBottom: Spacing.xxl,
          paddingTop: Spacing.md,
        },
      }),
    [colors],
  );

  const renderCard = (item: LiveStreamItem) => (
    <Pressable
      key={item.id}
      style={styles.card}
      onPress={() => router.push(`/live/${item.id}`)}
    >
      {item.thumbnailUrl ? (
        <Image source={{ uri: item.thumbnailUrl }} style={styles.thumb} />
      ) : (
        <View style={styles.thumbPlaceholder}>
          <Ionicons name="radio-outline" size={28} color={colors.or} />
        </View>
      )}
      <View style={styles.cardBody}>
        <Text style={styles.cardTitle} numberOfLines={2}>
          {item.title}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {item.hostHandle}
          {item.status === 'live'
            ? ` · ${t('live.viewers', { count: formatCount(item.viewerCount) })}`
            : item.scheduledAt
              ? ` · ${formatWhen(item.scheduledAt, locale)}`
              : ''}
        </Text>
        <View
          style={[styles.badge, item.status === 'live' && styles.badgeLive]}
        >
          <Text
            style={[
              styles.badgeText,
              item.status === 'live' && styles.badgeTextLive,
            ]}
          >
            {item.status === 'live'
              ? t('live.statusLive')
              : categoryLabel(item.category)}
          </Text>
        </View>
      </View>
    </Pressable>
  );

  const sectionEmpty = (key: SectionKey) => (
    <View style={styles.emptyBox}>
      <Ionicons
        name={key === 'live' ? 'radio-outline' : 'calendar-outline'}
        size={28}
        color={colors.or}
      />
      <Text style={styles.emptyText}>
        {key === 'live'
          ? t('live.emptyLive')
          : key === 'scheduled'
            ? t('live.emptyScheduled')
            : t('live.emptyPopular')}
      </Text>
    </View>
  );

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
        <Text style={styles.topTitle}>{t('live.title')}</Text>
        <Pressable
          onPress={() => router.push('/live/create')}
          style={styles.createBtn}
          hitSlop={6}
        >
          <Text style={styles.createBtnText}>{t('live.createShort')}</Text>
        </Pressable>
      </View>

      <Text style={styles.subtitle}>{t('live.subtitle')}</Text>

      <View style={styles.honesty}>
        <Text style={styles.honestyTitle}>{t('live.soonBanner')}</Text>
        <Text style={styles.honestyBody}>{t('live.soonBannerBody')}</Text>
      </View>

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
        <ScrollView
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
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.sectionTitle}>{t('live.sectionLive')}</Text>
          {liveNow.length === 0
            ? sectionEmpty('live')
            : liveNow.map(renderCard)}

          <Text style={styles.sectionTitle}>{t('live.sectionScheduled')}</Text>
          {scheduled.length === 0
            ? sectionEmpty('scheduled')
            : scheduled.map(renderCard)}

          <Text style={styles.sectionTitle}>{t('live.sectionPopular')}</Text>
          {popular.length === 0
            ? sectionEmpty('popular')
            : popular.map(renderCard)}

          {!isSupabaseConfigured ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyText}>{t('live.mockHint')}</Text>
            </View>
          ) : null}

          <View style={styles.startWrap}>
            <Button
              title={t('live.startCta')}
              variant="gold"
              onPress={() => router.push('/live/create')}
            />
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
