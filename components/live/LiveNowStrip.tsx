/**
 * Bandeau horizontal « En direct » (Découvrir, L2).
 *
 * Liste les lives au statut « live » via listLiveNow() : la policy SELECT de
 * live_streams (017, conservée par 019) masque déjà les lives en vérification
 * / retirés et ceux des comptes bloqués ; filterLiveStrip() refait le tri côté
 * client par sécurité. Rafraîchi toutes les 30 s tant que l'écran est affiché ;
 * rien n'est rendu quand personne n'est en direct.
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { Fonts, Radii, Spacing } from '@/constants/theme';
import { useColors } from '@/context/ThemeContext';
import { useI18n } from '@/context/I18nContext';
import { formatCount } from '@/data/mockVideos';
import { isSupabaseConfigured, listLiveNow, type LiveStreamItem } from '@/lib/live';
import { LIVE_STRIP_REFRESH_MS } from '@/lib/liveGo';

const CARD_W = 116;
const CARD_H = 172;

export function LiveNowStrip() {
  const router = useRouter();
  const colors = useColors();
  const { t } = useI18n();
  const [items, setItems] = useState<LiveStreamItem[]>([]);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    try {
      const next = await listLiveNow({ limit: 20 });
      if (mounted.current) setItems(next);
    } catch {
      // Bandeau décoratif : en cas d'erreur réseau on garde la dernière liste.
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      mounted.current = true;
      void load();
      const id = setInterval(() => void load(), LIVE_STRIP_REFRESH_MS);
      return () => {
        clearInterval(id);
        mounted.current = false;
      };
    }, [load]),
  );

  const styles = useMemo(
    () =>
      StyleSheet.create({
        wrap: { marginTop: Spacing.md },
        head: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: Spacing.sm,
        },
        titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
        dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.rougeTerre },
        title: { color: colors.sable, fontFamily: Fonts.bold, fontSize: 16 },
        seeAll: { color: colors.or, fontFamily: Fonts.medium, fontSize: 13 },
        row: { gap: 10, paddingRight: Spacing.md },
        card: {
          width: CARD_W,
          height: CARD_H,
          borderRadius: Radii.md,
          overflow: 'hidden',
          backgroundColor: colors.noirElevated,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.border,
        },
        cover: { ...StyleSheet.absoluteFill },
        coverFallback: {
          ...StyleSheet.absoluteFill,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.noirSoft,
        },
        shade: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.28)' },
        badges: {
          position: 'absolute',
          top: 6,
          left: 6,
          right: 6,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        },
        onAir: {
          paddingHorizontal: 6,
          paddingVertical: 2,
          borderRadius: 4,
          backgroundColor: colors.rougeTerre,
        },
        onAirText: { color: colors.onMedia, fontFamily: Fonts.bold, fontSize: 10, letterSpacing: 0.4 },
        viewers: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 3,
          paddingHorizontal: 6,
          paddingVertical: 2,
          borderRadius: Radii.pill,
          backgroundColor: 'rgba(0,0,0,0.55)',
        },
        viewersText: { color: colors.onMedia, fontFamily: Fonts.medium, fontSize: 10 },
        foot: { position: 'absolute', left: 8, right: 8, bottom: 8, gap: 2 },
        avatar: {
          width: 28,
          height: 28,
          borderRadius: 14,
          borderWidth: 2,
          borderColor: colors.or,
          backgroundColor: colors.noirSoft,
          marginBottom: 4,
        },
        handle: { color: colors.onMedia, fontFamily: Fonts.bold, fontSize: 12 },
        liveTitle: { color: colors.onMedia, fontFamily: Fonts.regular, fontSize: 11, opacity: 0.9 },
      }),
    [colors],
  );

  if (items.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <View style={styles.titleRow}>
          <View style={styles.dot} />
          <Text style={styles.title}>{t('live.strip.title')}</Text>
        </View>
        <Pressable
          onPress={() => router.push('/live' as Href)}
          hitSlop={8}
          accessibilityRole="button"
        >
          <Text style={styles.seeAll}>{t('live.strip.seeAll')}</Text>
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {items.map((item) => {
          const cover = item.thumbnailUrl || item.hostAvatarUrl || null;
          return (
            <Pressable
              key={item.id}
              style={styles.card}
              onPress={() => router.push(`/live/watch/${item.id}` as Href)}
              accessibilityRole="button"
              accessibilityLabel={t('live.strip.cardA11y', {
                handle: item.hostHandle,
                title: item.title,
                count: item.viewerCount,
              })}
            >
              {cover ? (
                <Image source={{ uri: cover }} style={styles.cover} resizeMode="cover" />
              ) : (
                <View style={styles.coverFallback}>
                  <Ionicons name="radio-outline" size={30} color={colors.or} />
                </View>
              )}
              <View style={styles.shade} />
              <View style={styles.badges}>
                <View style={styles.onAir}>
                  <Text style={styles.onAirText}>{t('live.statusLive')}</Text>
                </View>
                <View style={styles.viewers}>
                  <Ionicons name="eye-outline" size={10} color={colors.onMedia} />
                  <Text style={styles.viewersText}>{formatCount(item.viewerCount)}</Text>
                </View>
              </View>
              <View style={styles.foot}>
                {item.hostAvatarUrl ? (
                  <Image source={{ uri: item.hostAvatarUrl }} style={styles.avatar} />
                ) : null}
                <Text style={styles.handle} numberOfLines={1}>
                  {item.hostHandle}
                </Text>
                <Text style={styles.liveTitle} numberOfLines={2}>
                  {item.title}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
