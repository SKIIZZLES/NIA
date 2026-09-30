import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Image,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/Button';
import { LanguageToggle } from '@/components/LanguageToggle';
import { MediaThumb } from '@/components/MediaThumb';
import { ModerationBanner } from '@/components/ModerationBanner';
import { isKeywordHeld } from '@/lib/textFilter';
import { useAuth } from '@/context/AuthContext';
import { useFeed } from '@/context/FeedContext';
import { useI18n } from '@/context/I18nContext';
import { Fonts, Radii, Spacing } from '@/constants/theme';
import { useColors } from '@/context/ThemeContext';
import { useRouter, type Href } from 'expo-router';
import {
  countFollowers,
  countFollowing,
  fetchVideosByUserId,
} from '@/lib/profiles';
import * as WebBrowser from 'expo-web-browser';
import { deleteOwnAccount } from '@/lib/account';
import {
  CONTACT_EMAIL,
  communityGuidelinesUrl,
  contactMailto,
  privacyPolicyUrl,
  termsOfServiceUrl,
} from '@/constants/legal';
import { fetchSavedVideos } from '@/lib/saves';
import { fetchOwnModerationStatus, isSuspended } from '@/lib/moderation';
import { deleteOwnVideoForGood, updateVideoStatus } from '@/lib/videos';
import { listSeriesByUser, type SeriesListItem } from '@/lib/series';
import type { VideoItem } from '@/data/mockVideos';
import { formatCount } from '@/data/mockVideos';
import { useDraftCount } from '@/hooks/useDraftCount';

type ProfileTab = 'publications' | 'archives' | 'saves' | 'series';

export default function ProfileScreen() {
  const { user, signOut } = useAuth();
  const { videos, savedIds, toggleSave, refresh } = useFeed();
  const { t, locale } = useI18n();
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const gap = 2;
  const cols = 3;
  const size = (width - gap * (cols - 1)) / cols;

  const [followerCount, setFollowerCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [activeTab, setActiveTab] = useState<ProfileTab>('publications');
  const [published, setPublished] = useState<VideoItem[]>([]);
  const [archived, setArchived] = useState<VideoItem[]>([]);
  const [saved, setSaved] = useState<VideoItem[]>([]);
  const [seriesList, setSeriesList] = useState<SeriesListItem[]>([]);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  /** 017 : suspension en cours du compte (bannière). */
  const [suspendedUntil, setSuspendedUntil] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!user?.id) {
      setSuspendedUntil(null);
      return;
    }
    void fetchOwnModerationStatus(user.id).then((st) => {
      if (!cancelled) setSuspendedUntil(st?.suspendedUntil ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);
  /** Brouillons locaux (S6) : visibles seulement par soi, sur ce téléphone. */
  const draftCount = useDraftCount();

  const myFeedVideos = useMemo(
    () =>
      videos.filter(
        (v) =>
          user &&
          (v.userId === user.id ||
            v.handle === `@${user.username}` ||
            v.id.startsWith('local_')),
      ),
    [videos, user],
  );

  const loadProfileData = useCallback(async () => {
    if (!user) {
      setFollowerCount(0);
      setFollowingCount(0);
      setPublished([]);
      setArchived([]);
      setSaved([]);
      setSeriesList([]);
      return;
    }
    try {
      const [f1, f2, remote, savedRemote, seriesRemote] = await Promise.all([
        countFollowers(user.id),
        countFollowing(user.id),
        fetchVideosByUserId(user.id, { includeArchived: true }),
        fetchSavedVideos(user.id),
        listSeriesByUser(user.id),
      ]);
      setFollowerCount(f1);
      setFollowingCount(f2);

      const own =
        remote.length > 0
          ? remote
          : myFeedVideos.filter((v) => v.status !== 'deleted');
      setPublished(own.filter((v) => !v.status || v.status === 'published'));
      setArchived(own.filter((v) => v.status === 'archived'));

      if (savedRemote.length) {
        setSaved(savedRemote);
      } else if (savedIds.size) {
        const fromFeed = videos.filter((v) => savedIds.has(v.id));
        setSaved(fromFeed);
      } else {
        setSaved([]);
      }
      setSeriesList(seriesRemote);
    } catch {
      const own = myFeedVideos.filter((v) => v.status !== 'deleted');
      setPublished(own.filter((v) => !v.status || v.status === 'published'));
      setArchived(own.filter((v) => v.status === 'archived'));
      setSaved(videos.filter((v) => savedIds.has(v.id)));
      setSeriesList([]);
    }
  }, [user, myFeedVideos, videos, savedIds]);

  useEffect(() => {
    void loadProfileData();
  }, [loadProfileData]);

  const listData =
    activeTab === 'publications'
      ? published
      : activeTab === 'archives'
        ? archived
        : activeTab === 'saves'
          ? saved
          : [];

  const emptyMessage =
    activeTab === 'publications'
      ? t('profile.empty')
      : activeTab === 'archives'
        ? t('profile.emptyArchives')
        : activeTab === 'saves'
          ? t('profile.emptySaves')
          : t('profile.emptySeries');

  const onUnarchive = (item: VideoItem) => {
    if (!user) return;
    void (async () => {
      const result = await updateVideoStatus(user.id, item.id, 'published');
      if (!result.ok) {
        Alert.alert(t('common.error'), result.message);
        return;
      }
      setArchived((prev) => prev.filter((v) => v.id !== item.id));
      setPublished((prev) => [{ ...item, status: 'published' }, ...prev]);
      void refresh();
    })();
  };

  const onDeleteArchived = (item: VideoItem) => {
    if (!user) return;
    Alert.alert(t('feed.deleteConfirmTitle'), t('feed.deleteConfirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('feed.delete'),
        style: 'destructive',
        onPress: () => {
          void (async () => {
            const result = await deleteOwnVideoForGood(user.id, item.id);
            if (!result.ok) {
              Alert.alert(
                t('common.error'),
                result.message === 'moderation_hold' ? t('moderation.deleteHeld') : result.message,
              );
              return;
            }
            setArchived((prev) => prev.filter((v) => v.id !== item.id));
            if (result.fileError) {
              Alert.alert(t('feed.deleteSuccess'), t('feed.deleteFileKept'));
            }
          })();
        },
      },
    ]);
  };

  /**
   * Suppression de compte — exigence Google Play. Irreversible : une seule
   * confirmation, explicite sur ce qui part, puis deconnexion.
   */
  const onDeleteAccount = () => {
    Alert.alert(t('account.deleteTitle'), t('account.deleteBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('account.deleteConfirm'),
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setDeletingAccount(true);
            const result = await deleteOwnAccount(user?.id);
            setDeletingAccount(false);
            if (!result.ok) {
              Alert.alert(t('common.error'), result.message || t('account.deleteError'));
              return;
            }
            if (result.mock) {
              Alert.alert(t('common.error'), t('account.deleteMock'));
              return;
            }
            await signOut();
            router.replace('/welcome');
          })();
        },
      },
    ]);
  };

  const onSignOut = async () => {
    await signOut();
    router.replace('/welcome');
  };

  const onUnsave = (item: VideoItem) => {
    toggleSave(item.id);
    setSaved((prev) => prev.filter((v) => v.id !== item.id));
  };

  const confirmUnsave = (item: VideoItem) => {
    Alert.alert(t('profile.unsaveTitle'), t('profile.unsaveBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('profile.unsave'),
        style: 'destructive',
        onPress: () => onUnsave(item),
      },
    ]);
  };

  const tabs: { key: ProfileTab; label: string }[] = [
    { key: 'publications', label: t('profile.tabPublications') },
    { key: 'archives', label: t('profile.tabArchives') },
    { key: 'saves', label: t('profile.tabSaves') },
    { key: 'series', label: t('profile.tabSeries') },
  ];

  const isGrid = activeTab === 'publications' || activeTab === 'saves';
  const isSeries = activeTab === 'series';

  const styles = useMemo(() => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.noir },
  header: {
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
    paddingTop: Spacing.md,
  },
  avatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 2,
    borderColor: colors.or,
  },
  displayName: {
    marginTop: Spacing.md,
    color: colors.sable,
    fontFamily: Fonts.bold,
    fontSize: 20,
  },
  username: {
    marginTop: 4,
    color: colors.textSecondary,
    fontFamily: Fonts.medium,
    fontSize: 14,
  },
  bio: {
    marginTop: 6,
    color: colors.textSecondary,
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
    color: colors.sable,
    fontFamily: Fonts.bold,
    fontSize: 16,
  },
  statLabel: {
    color: colors.textMuted,
    fontFamily: Fonts.regular,
    fontSize: 11,
    marginTop: 2,
  },
  menuBtn: {
    position: 'absolute',
    top: Spacing.sm,
    right: Spacing.md,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipsScroll: {
    marginTop: Spacing.md,
    alignSelf: 'stretch',
    marginHorizontal: -Spacing.lg,
    flexGrow: 0,
  },
  chipsContent: {
    flexGrow: 1,
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
  },
  menuBackdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
  },
  menuSheet: {
    backgroundColor: colors.noirElevated,
    borderTopLeftRadius: Radii.lg,
    borderTopRightRadius: Radii.lg,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
  },
  menuHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: Spacing.md,
  },
  menuTitle: {
    color: colors.sable,
    fontFamily: Fonts.bold,
    fontSize: 18,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  menuRowLabel: {
    color: colors.sable,
    fontFamily: Fonts.medium,
    fontSize: 15,
  },
  menuRowDanger: { color: colors.danger },
  menuClose: {
    marginTop: Spacing.sm,
    alignItems: 'center',
    paddingVertical: 12,
  },
  menuCloseText: {
    color: colors.textMuted,
    fontFamily: Fonts.medium,
    fontSize: 15,
  },
  segment: {
    marginTop: Spacing.md,
    alignSelf: 'stretch',
    flexDirection: 'row',
    backgroundColor: colors.noirSoft,
    borderRadius: Radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: 3,
    gap: 2,
  },
  segmentItem: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderRadius: Radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentItemActive: {
    backgroundColor: colors.noirElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(209, 127, 42, 0.55)',
  },
  segmentLabel: {
    color: colors.textMuted,
    fontFamily: Fonts.medium,
    fontSize: 10,
    textAlign: 'center',
  },
  segmentLabelActive: {
    color: colors.or,
    fontFamily: Fonts.bold,
  },
  empty: {
    textAlign: 'center',
    color: colors.textMuted,
    fontFamily: Fonts.regular,
    marginTop: Spacing.lg,
    paddingHorizontal: Spacing.lg,
  },
  archiveRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    alignItems: 'center',
  },
  archiveThumbWrap: {
    position: 'relative',
  },
  archiveThumb: {
    width: 72,
    height: 72 * (16 / 9),
    borderRadius: Radii.sm,
    overflow: 'hidden',
    backgroundColor: colors.noirSoft,
  },
  archiveBadge: {
    position: 'absolute',
    left: 4,
    bottom: 4,
    backgroundColor: 'rgba(11,11,11,0.75)',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 6,
  },
  modBadge: {
    position: 'absolute',
    left: 4,
    top: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.overlay,
    borderColor: colors.or,
    borderWidth: 1,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 6,
  },
  modBadgeText: {
    color: colors.or,
    fontFamily: Fonts.medium,
    fontSize: 9,
  },
  archiveBadgeText: {
    color: colors.or,
    fontFamily: Fonts.medium,
    fontSize: 9,
  },
  archiveMeta: {
    flex: 1,
    gap: 8,
  },
  archiveCaption: {
    color: colors.sable,
    fontFamily: Fonts.medium,
    fontSize: 13,
  },
  archiveActions: {
    flexDirection: 'row',
    gap: 10,
  },
  archiveActionBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  archiveActionPrimary: {
    color: colors.or,
    fontFamily: Fonts.medium,
    fontSize: 12,
  },
  archiveActionDanger: {
    color: colors.danger,
    fontFamily: Fonts.medium,
    fontSize: 12,
  },
  seriesCreateBtn: {
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
  },
  seriesCard: {
    flex: 1,
    margin: 4,
    backgroundColor: colors.noirSoft,
    borderRadius: Radii.md,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  seriesCover: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: colors.noirElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  seriesCoverImg: {
    width: '100%',
    height: '100%',
  },
  seriesCardTitle: {
    color: colors.sable,
    fontFamily: Fonts.medium,
    fontSize: 13,
    paddingHorizontal: 8,
    paddingTop: 8,
  },
  seriesCardMeta: {
    color: colors.textMuted,
    fontFamily: Fonts.regular,
    fontSize: 11,
    paddingHorizontal: 8,
    paddingBottom: 10,
    paddingTop: 2,
  },
}), [colors]);

  const header = (
    <View style={styles.header}>
      <Pressable
        style={styles.menuBtn}
        onPress={() => setMenuOpen(true)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={t('profile.menu')}
      >
        <Ionicons name="menu" size={26} color={colors.sable} />
      </Pressable>
      <Image
        source={{
          uri: user?.avatarUrl || 'https://i.pravatar.cc/200?u=nia',
        }}
        style={styles.avatar}
      />
      <Text style={styles.displayName}>
        {user?.displayName || user?.username || t('common.guest')}
      </Text>
      <Text style={styles.username}>@{user?.username || 'invite'}</Text>
      <Text style={styles.bio}>{user?.bio || t('profile.defaultBio')}</Text>
      {user && isSuspended(suspendedUntil) ? <ModerationBanner kind="suspended" /> : null}
      <View style={styles.stats}>
        <Stat label={t('profile.posts')} value={String(published.length)} />
        <Stat label={t('profile.followers')} value={formatCount(followerCount)} />
        <Stat label={t('profile.following')} value={formatCount(followingCount)} />
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipsScroll}
        contentContainerStyle={styles.chipsContent}
      >
        {user && draftCount > 0 ? (
          <Chip
            icon="albums-outline"
            label={t('drafts.profileChip', { count: String(draftCount) })}
            onPress={() => router.push('/create/drafts')}
          />
        ) : null}
        {user ? (
          <Chip
            icon="create-outline"
            label={t('profile.editProfile')}
            onPress={() => router.push('/edit-profile')}
          />
        ) : null}
        <Chip
          icon="color-palette-outline"
          label={t('profile.appearance')}
          onPress={() => router.push('/appearance')}
        />
        {user ? (
          <Chip
            icon="person-circle-outline"
            label={t('profile.viewPublic')}
            onPress={() => router.push(`/user/${user.username}`)}
          />
        ) : null}
      </ScrollView>
      {!user ? (
        <Button
          title={t('profile.signIn')}
          variant="gold"
          onPress={() => router.push('/(auth)/login')}
          style={{ marginTop: Spacing.md, alignSelf: 'stretch' }}
        />
      ) : null}

      {user ? (
        <View style={styles.segment}>
          {tabs.map((tab) => {
            const active = tab.key === activeTab;
            return (
              <Pressable
                key={tab.key}
                onPress={() => setActiveTab(tab.key)}
                style={[styles.segmentItem, active && styles.segmentItemActive]}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
              >
                <Text
                  style={[styles.segmentLabel, active && styles.segmentLabelActive]}
                  numberOfLines={1}
                >
                  {tab.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );

  const menuSheet = (
    <Modal
      visible={menuOpen}
      animationType="slide"
      transparent
      onRequestClose={() => setMenuOpen(false)}
    >
      <Pressable
        style={styles.menuBackdrop}
        onPress={() => setMenuOpen(false)}
        accessibilityRole="button"
        accessibilityLabel={t('profile.closeMenu')}
      />
      <View
        style={[
          styles.menuSheet,
          { paddingBottom: Math.max(insets.bottom, Spacing.md) + Spacing.sm },
        ]}
      >
        <View style={styles.menuHandle} />
        <Text style={styles.menuTitle}>{t('profile.settingsTitle')}</Text>
        <LanguageToggle />
        <View style={{ height: Spacing.md }} />
        {user ? (
          <Pressable
            style={styles.menuRow}
            onPress={() => {
              setMenuOpen(false);
              void onSignOut();
            }}
            accessibilityRole="button"
          >
            <Ionicons name="log-out-outline" size={22} color={colors.or} />
            <Text style={styles.menuRowLabel}>{t('profile.signOut')}</Text>
          </Pressable>
        ) : null}
        {/*
          Accessible sans compte a dessein : Google Play exige que la politique
          soit atteignable depuis l'application, et quelqu'un doit pouvoir la
          lire AVANT de creer un compte, pas seulement apres.
        */}
        <Pressable
          style={styles.menuRow}
          onPress={() => {
            setMenuOpen(false);
            void WebBrowser.openBrowserAsync(privacyPolicyUrl(locale));
          }}
          accessibilityRole="link"
          accessibilityLabel={t('profile.privacyPolicy')}
        >
          <Ionicons name="shield-checkmark-outline" size={22} color={colors.or} />
          <Text style={styles.menuRowLabel}>{t('profile.privacyPolicy')}</Text>
        </Pressable>
        {/* Meme raison : les CGU doivent etre lisibles avant de creer un compte. */}
        <Pressable
          style={styles.menuRow}
          onPress={() => {
            setMenuOpen(false);
            void WebBrowser.openBrowserAsync(termsOfServiceUrl(locale));
          }}
          accessibilityRole="link"
          accessibilityLabel={t('profile.terms')}
        >
          <Ionicons name="document-text-outline" size={22} color={colors.or} />
          <Text style={styles.menuRowLabel}>{t('profile.terms')}</Text>
        </Pressable>
        {/*
          Règles de la communauté et contact : sans compte aussi. Un visiteur
          doit pouvoir lire ce qui est interdit et signaler un problème par
          e-mail (DSA art. 16 : le signalement est ouvert à toute personne).
        */}
        <Pressable
          style={styles.menuRow}
          onPress={() => {
            setMenuOpen(false);
            void WebBrowser.openBrowserAsync(communityGuidelinesUrl(locale));
          }}
          accessibilityRole="link"
          accessibilityLabel={t('safety.communityRules')}
        >
          <Ionicons name="people-outline" size={22} color={colors.or} />
          <Text style={styles.menuRowLabel}>{t('safety.communityRules')}</Text>
        </Pressable>
        <Pressable
          style={styles.menuRow}
          onPress={() => {
            setMenuOpen(false);
            void Linking.openURL(contactMailto(t('safety.contactSubject'))).catch(() => {
              // Aucune app de messagerie : l'adresse reste lisible et recopiable.
              Alert.alert(
                t('safety.contact'),
                t('safety.contactFallback', { email: CONTACT_EMAIL }),
              );
            });
          }}
          accessibilityRole="link"
          accessibilityLabel={t('safety.contact')}
        >
          <Ionicons name="mail-outline" size={22} color={colors.or} />
          <Text style={styles.menuRowLabel}>{t('safety.contact')}</Text>
        </Pressable>
        {user ? (
          <Pressable
            style={styles.menuRow}
            onPress={() => {
              setMenuOpen(false);
              router.push('/blocked' as Href);
            }}
            accessibilityRole="button"
            accessibilityLabel={t('safety.blockedAccounts')}
          >
            <Ionicons name="ban-outline" size={22} color={colors.or} />
            <Text style={styles.menuRowLabel}>{t('safety.blockedAccounts')}</Text>
          </Pressable>
        ) : null}
        {user ? (
          <Pressable
            style={styles.menuRow}
            // Feuille laissee ouverte : l'Alert de confirmation s'affiche
            // par-dessus (iOS ne l'affiche pas pendant la fermeture d'une Modal).
            onPress={onDeleteAccount}
            disabled={deletingAccount}
            accessibilityRole="button"
            accessibilityLabel={t('profile.deleteAccount')}
            accessibilityState={{ disabled: deletingAccount }}
          >
            <Ionicons name="trash-outline" size={22} color={colors.danger} />
            <Text style={[styles.menuRowLabel, styles.menuRowDanger]}>
              {t('profile.deleteAccount')}
            </Text>
          </Pressable>
        ) : null}
        <Pressable
          style={styles.menuClose}
          onPress={() => setMenuOpen(false)}
          accessibilityRole="button"
        >
          <Text style={styles.menuCloseText}>{t('profile.closeMenu')}</Text>
        </Pressable>
      </View>
    </Modal>
  );

  if (isSeries) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <FlatList
          ListHeaderComponent={
            <>
              {header}
              {user ? (
                <Button
                  title={t('series.createCta')}
                  variant="gold"
                  onPress={() => router.push('/series/create')}
                  style={styles.seriesCreateBtn}
                />
              ) : null}
            </>
          }
          data={seriesList}
          keyExtractor={(i) => i.id}
          numColumns={2}
          columnWrapperStyle={{ paddingHorizontal: 4 }}
          contentContainerStyle={{ paddingBottom: Spacing.xxl }}
          ListEmptyComponent={
            user ? <Text style={styles.empty}>{emptyMessage}</Text> : null
          }
          renderItem={({ item }) => (
            <Pressable
              style={styles.seriesCard}
              onPress={() => router.push(`/series/${item.id}`)}
            >
              <View style={styles.seriesCover}>
                {item.coverUrl ? (
                  <Image source={{ uri: item.coverUrl }} style={styles.seriesCoverImg} />
                ) : (
                  <Text style={{ color: colors.or, fontFamily: Fonts.bold }}>S</Text>
                )}
              </View>
              <Text style={styles.seriesCardTitle} numberOfLines={2}>
                {item.title}
              </Text>
              <Text style={styles.seriesCardMeta}>
                {t('series.episodeCount', { count: item.episodeCount })}
              </Text>
            </Pressable>
          )}
        />
        {menuSheet}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <FlatList
        key={isGrid ? `grid-${activeTab}` : 'archives-list'}
        ListHeaderComponent={header}
        data={user ? listData : []}
        keyExtractor={(i) => i.id}
        numColumns={isGrid ? cols : 1}
        columnWrapperStyle={isGrid ? { gap } : undefined}
        contentContainerStyle={{ gap, paddingBottom: Spacing.xxl }}
        ListEmptyComponent={
          user ? <Text style={styles.empty}>{emptyMessage}</Text> : null
        }
        renderItem={({ item }) => {
          if (activeTab === 'archives') {
            return (
              <View style={styles.archiveRow}>
                <Pressable
                  onPress={() => router.push(`/video/${item.id}`)}
                  style={styles.archiveThumbWrap}
                >
                  <MediaThumb
                    thumbnailUrl={item.thumbnailUrl}
                    mediaType={item.mediaType}
                    videoUrl={item.videoUrl}
                    style={styles.archiveThumb}
                  />
                  <View style={styles.archiveBadge}>
                    <Text style={styles.archiveBadgeText}>
                      {t('feed.archivedBadge')}
                    </Text>
                  </View>
                </Pressable>
                <View style={styles.archiveMeta}>
                  <Text style={styles.archiveCaption} numberOfLines={2}>
                    {item.caption || item.handle}
                  </Text>
                  <View style={styles.archiveActions}>
                    <Pressable
                      style={styles.archiveActionBtn}
                      onPress={() => onUnarchive(item)}
                    >
                      <Text style={styles.archiveActionPrimary}>
                        {t('profile.unarchive')}
                      </Text>
                    </Pressable>
                    <Pressable
                      style={styles.archiveActionBtn}
                      onPress={() => onDeleteArchived(item)}
                    >
                      <Text style={styles.archiveActionDanger}>
                        {t('feed.delete')}
                      </Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            );
          }

          return (
            <Pressable
              onPress={() => router.push(`/video/${item.id}`)}
              onLongPress={
                activeTab === 'saves' ? () => confirmUnsave(item) : undefined
              }
              delayLongPress={350}
              accessibilityRole="button"
              accessibilityLabel={t('feed.play')}
            >
              <MediaThumb
                thumbnailUrl={item.thumbnailUrl}
                mediaType={item.mediaType}
                videoUrl={item.videoUrl}
                style={{
                  width: size,
                  height: size * (16 / 9),
                  backgroundColor: colors.noirSoft,
                  overflow: 'hidden',
                }}
              />
              {item.moderationState === 'held' || item.moderationState === 'removed' ? (
                <View style={styles.modBadge} pointerEvents="none">
                  <Ionicons
                    name={item.moderationState === 'held' ? 'eye-off' : 'shield'}
                    size={11}
                    color={colors.or}
                  />
                  <Text style={styles.modBadgeText}>
                    {t(
                      isKeywordHeld(item)
                        ? 'moderation.badgeReview'
                        : item.moderationState === 'held'
                          ? 'moderation.badgeHeld'
                          : 'moderation.badgeRemoved',
                    )}
                  </Text>
                </View>
              ) : null}
            </Pressable>
          );
        }}
      />
      {menuSheet}
    </SafeAreaView>
  );
}

function Chip({
  icon,
  label,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderRadius: Radii.pill,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.border,
        backgroundColor: colors.noirElevated,
      }}
    >
      <Ionicons name={icon} size={15} color={colors.or} />
      <Text
        style={{ color: colors.sable, fontFamily: Fonts.medium, fontSize: 13 }}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  const colors = useColors();
  return (
    <View style={{ alignItems: 'center' }}>
      <Text
        style={{
          color: colors.sable,
          fontFamily: Fonts.bold,
          fontSize: 16,
        }}
      >
        {value}
      </Text>
      <Text
        style={{
          color: colors.textMuted,
          fontFamily: Fonts.regular,
          fontSize: 11,
          marginTop: 2,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

