/**
 * Détail événement — Participer + Partager.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/Button';
import { useAuth } from '@/context/AuthContext';
import { useI18n } from '@/context/I18nContext';
import { useColors } from '@/context/ThemeContext';
import { Fonts, Radii, Spacing } from '@/constants/theme';
import { EVENT_CATEGORIES } from '@/constants/eventCategories';
import {
  fetchEventById,
  toggleGoing,
  isSupabaseConfigured,
  type EventItem,
} from '@/lib/events';
import { shareEvent } from '@/lib/share';
import { formatCount } from '@/data/mockVideos';

function formatWhen(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const tag = locale.startsWith('fr') ? 'fr-FR' : undefined;
  return d.toLocaleString(tag, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function EventDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const eventId = typeof id === 'string' ? id : Array.isArray(id) ? id[0] : '';
  const router = useRouter();
  const { user } = useAuth();
  const { t, locale } = useI18n();
  const colors = useColors();
  const [event, setEvent] = useState<EventItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!eventId) {
      setError(t('events.notFound'));
      setLoading(false);
      return;
    }
    if (!isSupabaseConfigured) {
      setError(t('events.notFound'));
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const item = await fetchEventById(eventId, user?.id ?? null);
      if (!item) {
        setError(t('events.notFound'));
        setEvent(null);
      } else {
        setEvent(item);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('events.loadFail'));
      setEvent(null);
    } finally {
      setLoading(false);
    }
  }, [eventId, user?.id, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const onToggleGoing = async () => {
    if (!user?.id) {
      Alert.alert(t('events.loginRequiredTitle'), t('events.loginRequired'));
      return;
    }
    if (!event) return;
    const currentlyGoing = event.myStatus === 'going';
    setBusy(true);
    try {
      const next = await toggleGoing(user.id, event.id, currentlyGoing);
      setEvent((prev) =>
        prev
          ? {
              ...prev,
              myStatus: next,
              attendeeCount: Math.max(
                0,
                prev.attendeeCount + (next === 'going' ? 1 : currentlyGoing ? -1 : 0),
              ),
            }
          : prev,
      );
    } catch (e) {
      Alert.alert(
        t('common.error'),
        e instanceof Error ? e.message : t('events.attendFail'),
      );
    } finally {
      setBusy(false);
    }
  };

  const onShare = async () => {
    if (!event) return;
    await shareEvent({
      id: event.id,
      title: event.title,
      city: event.city,
      startsAt: event.startsAt,
    });
  };

  const openOrganizer = () => {
    if (!event?.organizerHandle) return;
    const handle = event.organizerHandle.replace(/^@/, '');
    if (!handle) return;
    router.push(`/user/${handle}`);
  };

  const categoryLabel = useMemo(() => {
    if (!event) return '';
    const cat = EVENT_CATEGORIES.find((c) => c.id === event.category);
    return cat ? t(cat.labelKey) : event.category;
  }, [event, t]);

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
          fontSize: 17,
          flex: 1,
        },
        cover: {
          width: '100%',
          height: 220,
          backgroundColor: colors.noirSoft,
        },
        coverPlaceholder: {
          width: '100%',
          height: 220,
          backgroundColor: colors.noirSoft,
          alignItems: 'center',
          justifyContent: 'center',
        },
        body: {
          paddingHorizontal: Spacing.lg,
          paddingTop: Spacing.md,
          paddingBottom: Spacing.xxl,
          gap: Spacing.sm,
        },
        title: {
          color: colors.sable,
          fontFamily: Fonts.bold,
          fontSize: 24,
        },
        handle: {
          color: colors.or,
          fontFamily: Fonts.medium,
          fontSize: 15,
        },
        meta: {
          color: colors.textSecondary,
          fontFamily: Fonts.regular,
          fontSize: 14,
          lineHeight: 20,
        },
        rowMeta: {
          flexDirection: 'row',
          alignItems: 'flex-start',
          gap: 8,
          marginTop: 4,
        },
        desc: {
          color: colors.sable,
          fontFamily: Fonts.regular,
          fontSize: 15,
          lineHeight: 22,
          marginTop: Spacing.sm,
        },
        catBadge: {
          alignSelf: 'flex-start',
          paddingHorizontal: 10,
          paddingVertical: 4,
          borderRadius: Radii.pill,
          backgroundColor: 'rgba(209, 127, 42, 0.16)',
          borderWidth: 1,
          borderColor: colors.border,
          marginTop: Spacing.sm,
        },
        catBadgeText: {
          color: colors.or,
          fontFamily: Fonts.medium,
          fontSize: 12,
        },
        actions: {
          marginTop: Spacing.lg,
          gap: Spacing.sm,
        },
        center: {
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          padding: Spacing.lg,
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

  const going = event?.myStatus === 'going';

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
        <Text style={styles.topTitle}>{t('events.detailTitle')}</Text>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.or} />
        </View>
      ) : error || !event ? (
        <View style={styles.center}>
          <Text style={styles.err}>{error || t('events.notFound')}</Text>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false}>
          {event.coverUrl ? (
            <Image source={{ uri: event.coverUrl }} style={styles.cover} />
          ) : (
            <View style={styles.coverPlaceholder}>
              <Ionicons name="calendar" size={48} color={colors.or} />
            </View>
          )}
          <View style={styles.body}>
            <Text style={styles.title}>{event.title}</Text>
            <Pressable onPress={openOrganizer}>
              <Text style={styles.handle}>
                {t('events.organizedBy', { handle: event.organizerHandle })}
              </Text>
            </Pressable>
            <View style={styles.catBadge}>
              <Text style={styles.catBadgeText}>{categoryLabel}</Text>
            </View>

            <View style={styles.rowMeta}>
              <Ionicons name="time-outline" size={18} color={colors.or} />
              <Text style={styles.meta}>
                {formatWhen(event.startsAt, locale)}
                {event.endsAt
                  ? ` → ${formatWhen(event.endsAt, locale)}`
                  : ''}
              </Text>
            </View>

            {event.city || event.locationText || event.country ? (
              <View style={styles.rowMeta}>
                <Ionicons name="location-outline" size={18} color={colors.or} />
                <Text style={styles.meta}>
                  {[event.locationText, event.city, event.country]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </View>
            ) : null}

            <View style={styles.rowMeta}>
              <Ionicons name="people-outline" size={18} color={colors.or} />
              <Text style={styles.meta}>
                {t('events.attendees', {
                  count: formatCount(event.attendeeCount),
                })}
              </Text>
            </View>

            {event.description ? (
              <Text style={styles.desc}>{event.description}</Text>
            ) : null}

            <View style={styles.actions}>
              <Button
                title={going ? t('events.attending') : t('events.attend')}
                variant={going ? 'outline' : 'gold'}
                loading={busy}
                onPress={() => void onToggleGoing()}
              />
              <Button
                title={t('events.share')}
                variant="outline"
                onPress={() => void onShare()}
              />
            </View>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
