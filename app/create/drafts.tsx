/**
 * Brouillons locaux (sprint S6).
 *
 * Ouvert depuis la caméra (à côté du déclencheur) ou depuis son profil. Toucher
 * un brouillon le relit, remet l'éditeur exactement dans son état et ouvre
 * /create/edit. La corbeille supprime le brouillon ET ses fichiers copiés,
 * après confirmation.
 *
 * Tout reste sur le téléphone (lib/drafts) : aucune donnée n'est envoyée.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/context/AuthContext';
import { useCreateDraft } from '@/context/CreateContext';
import { useI18n } from '@/context/I18nContext';
import { useColors } from '@/context/ThemeContext';
import { Fonts, Radii, Spacing } from '@/constants/theme';
import { formatSoundTime } from '@/lib/soundSync';
import {
  deleteDraft,
  isDraftStorageAvailable,
  listDrafts,
  loadDraft,
  type DraftSummary,
} from '@/lib/drafts';
import { useBlockBackWhile } from '@/hooks/useBlockBackWhile';

function formatDate(ts: number, locale: string): string {
  const d = new Date(ts);
  try {
    return d.toLocaleString(locale, {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return d.toISOString().slice(0, 16).replace('T', ' ');
  }
}

export default function CreateDraftsScreen() {
  const router = useRouter();
  const colors = useColors();
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const ownerId = user?.id ?? null;
  const { restoreDraft } = useCreateDraft();

  const [items, setItems] = useState<DraftSummary[] | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const available = isDraftStorageAvailable();
  const insets = useSafeAreaInsets();
  // S7 : pas de sortie pendant l'ouverture d'un brouillon.
  useBlockBackWhile(opening != null);

  const refresh = useCallback(async () => {
    if (!available) {
      setItems([]);
      return;
    }
    try {
      setItems(await listDrafts(ownerId));
    } catch {
      setItems([]);
    }
  }, [available, ownerId]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const open = useCallback(
    async (id: string) => {
      if (opening) return;
      setOpening(id);
      try {
        const draft = await loadDraft(id);
        if (!draft) {
          Alert.alert(t('drafts.title'), t('drafts.openFailed'));
          await refresh();
          return;
        }
        restoreDraft(draft);
        router.push('/create/edit');
      } catch {
        // S7 : une lecture qui échoue (fichier illisible, stockage plein)
        // affiche un message au lieu d'un rejet silencieux.
        Alert.alert(t('drafts.title'), t('drafts.openFailed'));
      } finally {
        setOpening(null);
      }
    },
    [opening, restoreDraft, router, refresh, t],
  );

  const confirmDelete = useCallback(
    (id: string) => {
      Alert.alert(t('drafts.deleteTitle'), t('drafts.deleteBody'), [
        { text: t('drafts.leaveCancel'), style: 'cancel' },
        {
          text: t('drafts.deleteConfirm'),
          style: 'destructive',
          onPress: () => {
            void (async () => {
              await deleteDraft(id);
              setItems((cur) => (cur ? cur.filter((d) => d.id !== id) : cur));
            })();
          },
        },
      ]);
    },
    [t],
  );

  const styles = useMemo(
    () =>
      StyleSheet.create({
        safe: { flex: 1, backgroundColor: colors.noir },
        header: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: Spacing.xs,
          paddingHorizontal: Spacing.lg,
          paddingTop: Spacing.sm,
          paddingBottom: Spacing.xs,
        },
        title: { flex: 1, color: colors.sable, fontFamily: Fonts.bold, fontSize: 26 },
        note: {
          color: colors.textMuted,
          fontFamily: Fonts.regular,
          fontSize: 12,
          lineHeight: 17,
          paddingHorizontal: Spacing.lg,
          marginBottom: Spacing.md,
        },
        list: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.xxl, gap: Spacing.sm },
        row: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: Spacing.md,
          padding: Spacing.sm,
          borderRadius: Radii.md,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.border,
          backgroundColor: colors.noirElevated,
        },
        thumb: {
          width: 64,
          height: 96,
          borderRadius: Radii.sm,
          backgroundColor: colors.noirSoft,
          overflow: 'hidden',
          alignItems: 'center',
          justifyContent: 'center',
        },
        thumbImg: { width: '100%', height: '100%' },
        badge: {
          position: 'absolute',
          left: 4,
          bottom: 4,
          paddingHorizontal: 5,
          paddingVertical: 1,
          borderRadius: Radii.pill,
          backgroundColor: colors.mediaScrimStrong,
        },
        badgeText: { color: colors.onMedia, fontFamily: Fonts.medium, fontSize: 10 },
        body: { flex: 1, gap: 4 },
        caption: { color: colors.sable, fontFamily: Fonts.medium, fontSize: 14, lineHeight: 19 },
        captionMuted: { color: colors.textSecondary, fontStyle: 'italic' },
        meta: { color: colors.textMuted, fontFamily: Fonts.regular, fontSize: 12 },
        trash: { padding: Spacing.sm },
        empty: {
          color: colors.textSecondary,
          fontFamily: Fonts.regular,
          fontSize: 14,
          lineHeight: 20,
          textAlign: 'center',
          paddingHorizontal: Spacing.xl,
          marginTop: Spacing.xl,
        },
        overlay: {
          ...StyleSheet.absoluteFill,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.overlay,
          gap: Spacing.sm,
        },
        overlayText: { color: colors.sable, fontFamily: Fonts.medium, fontSize: 14 },
      }),
    [colors],
  );

  const renderItem = ({ item }: { item: DraftSummary }) => {
    const firstLine = item.caption.trim().split('\n')[0] ?? '';
    return (
      <Pressable
        onPress={() => void open(item.id)}
        style={({ pressed }) => [styles.row, pressed && { opacity: 0.8 }]}
        accessibilityRole="button"
        accessibilityLabel={`${t('drafts.open')} — ${firstLine || t('drafts.noCaption')}`}
      >
        <View style={styles.thumb}>
          {item.thumbUri ? (
            <Image source={{ uri: item.thumbUri }} style={styles.thumbImg} resizeMode="cover" />
          ) : (
            <Ionicons
              name={item.mediaType === 'video' ? 'videocam-outline' : 'image-outline'}
              size={24}
              color={colors.textMuted}
            />
          )}
          <View style={styles.badge}>
            <Text style={styles.badgeText}>
              {item.mediaType === 'video'
                ? item.durationMs != null
                  ? formatSoundTime(item.durationMs)
                  : t('drafts.video')
                : t('drafts.photo')}
            </Text>
          </View>
        </View>
        <View style={styles.body}>
          <Text style={[styles.caption, !firstLine && styles.captionMuted]} numberOfLines={2}>
            {firstLine || t('drafts.noCaption')}
          </Text>
          <Text style={styles.meta}>
            {t('drafts.updatedAt', { date: formatDate(item.updatedAt, locale) })}
          </Text>
        </View>
        <Pressable
          onPress={() => confirmDelete(item.id)}
          hitSlop={8}
          style={styles.trash}
          accessibilityRole="button"
          accessibilityLabel={t('drafts.deleteA11y')}
        >
          <Ionicons name="trash-outline" size={22} color={colors.danger} />
        </Pressable>
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))}
          disabled={opening != null}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
        >
          <Ionicons name="chevron-back" size={26} color={colors.sable} />
        </Pressable>
        <Text style={styles.title}>{t('drafts.title')}</Text>
      </View>
      <Text style={styles.note}>
        {available ? t('drafts.localNote') : t('drafts.unavailable')}
      </Text>

      {items == null ? (
        <ActivityIndicator color={colors.or} style={{ marginTop: Spacing.xl }} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(d) => d.id}
          renderItem={renderItem}
          contentContainerStyle={[
            styles.list,
            // Au-dessus de la barre de navigation Android (bord à bord).
            { paddingBottom: Spacing.xxl + insets.bottom },
          ]}
          ListEmptyComponent={
            available ? <Text style={styles.empty}>{t('drafts.empty')}</Text> : null
          }
        />
      )}

      {opening ? (
        <View style={styles.overlay}>
          <ActivityIndicator color={colors.or} size="large" />
          <Text style={styles.overlayText}>{t('drafts.opening')}</Text>
        </View>
      ) : null}
    </SafeAreaView>
  );
}
