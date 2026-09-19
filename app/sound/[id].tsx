/**
 * Page son — titre, @créateur, use count, [Utiliser ce son].
 * Sons uploadés / originaux uniquement (pas de catalogue commercial).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/Button';
import { useI18n } from '@/context/I18nContext';
import { useColors } from '@/context/ThemeContext';
import { Fonts, Radii, Spacing } from '@/constants/theme';
import { fetchSoundById, type SoundItem } from '@/lib/sounds';
import { formatCount } from '@/data/mockVideos';
import { isSupabaseConfigured } from '@/lib/supabase';

export default function SoundScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const soundId = typeof id === 'string' ? id : Array.isArray(id) ? id[0] : '';
  const router = useRouter();
  const { t } = useI18n();
  const colors = useColors();
  const [sound, setSound] = useState<SoundItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!soundId) {
      setError(t('sound.notFound'));
      setLoading(false);
      return;
    }
    if (!isSupabaseConfigured) {
      setError(t('sound.notFound'));
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const item = await fetchSoundById(soundId);
      if (!item) {
        setError(t('sound.notFound'));
        setSound(null);
      } else {
        setSound(item);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : t('sound.loadFail');
      setError(msg);
      setSound(null);
    } finally {
      setLoading(false);
    }
  }, [soundId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const onUse = () => {
    if (!soundId) return;
    router.push({
      pathname: '/(tabs)/create',
      params: { soundId, mode: 'video' },
    });
  };

  const openCreator = () => {
    if (!sound?.handle) return;
    const handle = sound.handle.replace(/^@/, '');
    if (!handle) return;
    router.push(`/user/${handle}`);
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
          fontSize: 17,
          flex: 1,
        },
        body: {
          paddingHorizontal: Spacing.lg,
          paddingTop: Spacing.xl,
          gap: Spacing.md,
        },
        iconWrap: {
          width: 72,
          height: 72,
          borderRadius: Radii.lg,
          backgroundColor: 'rgba(209, 127, 42, 0.16)',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: Spacing.sm,
          borderWidth: 1,
          borderColor: colors.border,
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
          fontSize: 13,
        },
        hint: {
          color: colors.textMuted,
          fontFamily: Fonts.regular,
          fontSize: 12,
          lineHeight: 17,
          marginTop: Spacing.sm,
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
        <Text style={styles.topTitle}>{t('sound.title')}</Text>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.or} />
        </View>
      ) : error || !sound ? (
        <View style={styles.center}>
          <Text style={styles.err}>{error || t('sound.notFound')}</Text>
        </View>
      ) : (
        <View style={styles.body}>
          <View style={styles.iconWrap}>
            <Ionicons name="musical-notes" size={36} color={colors.or} />
          </View>
          <Text style={styles.title}>{sound.title}</Text>
          <Pressable onPress={openCreator}>
            <Text style={styles.handle}>{sound.handle}</Text>
          </Pressable>
          <Text style={styles.meta}>
            {t('sound.useCount', { count: formatCount(sound.useCount) })}
            {sound.durationMs != null && sound.durationMs > 0
              ? ` · ${Math.round(sound.durationMs / 1000)} s`
              : ''}
          </Text>
          <Text style={styles.hint}>{t('sound.originalOnly')}</Text>
          <Button
            title={t('sound.useThis')}
            variant="gold"
            onPress={onUse}
            style={{ marginTop: Spacing.md }}
          />
        </View>
      )}
    </SafeAreaView>
  );
}
