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
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Fonts, Radii, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/context/ThemeContext';
import { useFeed } from '@/context/FeedContext';
import { useI18n } from '@/context/I18nContext';
import { fetchBlockedAccounts, type BlockedAccount } from '@/lib/blocks';

/** « Comptes bloqués » : liste et déblocage (réglages du profil). */
export default function BlockedAccountsScreen() {
  const router = useRouter();
  const { t } = useI18n();
  const colors = useColors();
  const { user } = useAuth();
  const { unblockUser } = useFeed();
  const [items, setItems] = useState<BlockedAccount[] | null>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const rows = await fetchBlockedAccounts(user.id);
    setItems(rows);
    setLoading(false);
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const onUnblock = (a: BlockedAccount) => {
    const username = a.username || t('notifications.someone');
    Alert.alert(t('safety.unblockTitle', { username }), t('safety.unblockBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('safety.unblock'),
        onPress: () => {
          void (async () => {
            setBusyId(a.id);
            const result = await unblockUser(a.id);
            setBusyId(null);
            if (!result.ok) {
              Alert.alert(t('common.error'), t(result.errorKey));
              return;
            }
            setItems((prev) => (prev ? prev.filter((x) => x.id !== a.id) : prev));
          })();
        },
      },
    ]);
  };

  const styles = useMemo(
    () =>
      StyleSheet.create({
        safe: { flex: 1, backgroundColor: colors.noir },
        topBar: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: Spacing.md,
          paddingVertical: Spacing.sm,
        },
        backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
        topTitle: { color: colors.sable, fontFamily: Fonts.bold, fontSize: 17 },
        subtitle: {
          color: colors.textSecondary,
          fontFamily: Fonts.regular,
          fontSize: 13,
          lineHeight: 18,
          paddingHorizontal: Spacing.lg,
          marginBottom: Spacing.md,
        },
        list: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.xxl, gap: 10 },
        row: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingVertical: 12,
          paddingHorizontal: 14,
          borderRadius: Radii.md,
          backgroundColor: colors.noirElevated,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.border,
        },
        avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.noirSoft },
        names: { flex: 1 },
        name: { color: colors.sable, fontFamily: Fonts.medium, fontSize: 15 },
        handle: { color: colors.textMuted, fontFamily: Fonts.regular, fontSize: 12 },
        btn: {
          borderWidth: 1,
          borderColor: colors.or,
          borderRadius: 999,
          paddingHorizontal: 14,
          paddingVertical: 7,
          minWidth: 96,
          alignItems: 'center',
        },
        btnText: { color: colors.or, fontFamily: Fonts.medium, fontSize: 13 },
        empty: { alignItems: 'center', paddingHorizontal: Spacing.xl, paddingTop: Spacing.xxl, gap: 10 },
        emptyTitle: { color: colors.sable, fontFamily: Fonts.bold, fontSize: 16, textAlign: 'center' },
        emptyBody: {
          color: colors.textSecondary,
          fontFamily: Fonts.regular,
          fontSize: 13,
          lineHeight: 19,
          textAlign: 'center',
        },
      }),
    [colors],
  );

  const empty = loading ? (
    <View style={styles.empty}>
      <ActivityIndicator color={colors.or} />
    </View>
  ) : items === null ? (
    <View style={styles.empty}>
      <Ionicons name="cloud-offline-outline" size={30} color={colors.or} />
      <Text style={styles.emptyBody}>{t('safety.loadError')}</Text>
      <Pressable style={styles.btn} onPress={() => void load()} accessibilityRole="button">
        <Text style={styles.btnText}>{t('safety.retry')}</Text>
      </Pressable>
    </View>
  ) : (
    <View style={styles.empty}>
      <Ionicons name="ban-outline" size={30} color={colors.or} />
      <Text style={styles.emptyTitle}>{t('safety.blockedEmpty')}</Text>
      <Text style={styles.emptyBody}>{t('safety.blockedEmptyBody')}</Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.topBar}>
        <Pressable
          style={styles.backBtn}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
        >
          <Ionicons name="chevron-back" size={24} color={colors.sable} />
        </Pressable>
        <Text style={styles.topTitle}>{t('safety.blockedAccounts')}</Text>
        <View style={styles.backBtn} />
      </View>
      <Text style={styles.subtitle}>{t('safety.blockedIntro')}</Text>
      <FlatList
        data={loading ? [] : items ?? []}
        keyExtractor={(a) => a.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={empty}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Image
              source={{
                uri: item.avatarUrl || `https://i.pravatar.cc/96?u=${encodeURIComponent(item.id)}`,
              }}
              style={styles.avatar}
            />
            <View style={styles.names}>
              <Text style={styles.name} numberOfLines={1}>
                {item.displayName || item.username || t('notifications.someone')}
              </Text>
              {item.username ? (
                <Text style={styles.handle} numberOfLines={1}>
                  @{item.username}
                </Text>
              ) : null}
            </View>
            <Pressable
              style={styles.btn}
              onPress={() => onUnblock(item)}
              disabled={busyId === item.id}
              accessibilityRole="button"
              accessibilityLabel={`${t('safety.unblock')} ${item.username ?? ''}`}
            >
              {busyId === item.id ? (
                <ActivityIndicator color={colors.or} size="small" />
              ) : (
                <Text style={styles.btnText}>{t('safety.unblock')}</Text>
              )}
            </Pressable>
          </View>
        )}
      />
    </SafeAreaView>
  );
}
