import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/Button';
import { useFeed } from '@/context/FeedContext';
import { useAuth } from '@/context/AuthContext';
import { useI18n } from '@/context/I18nContext';
import { Fonts, Radii, Spacing } from '@/constants/theme';
import { useColors } from '@/context/ThemeContext';
import {
  createSound,
  fetchSoundById,
  listSoundsByUser,
  type SoundItem,
} from '@/lib/sounds';
import {
  DISCOVER_CATEGORIES,
  type CategoryId,
} from '@/constants/categories';
import {
  MAX_UPLOAD_BYTES,
  MAX_VIDEO_DURATION_SEC,
  parseHashtags,
} from '@/constants/publish';
import { FilterCarousel } from '@/components/FilterCarousel';
import { FilteredMediaPreview } from '@/components/FilteredMediaPreview';
import type { FilterDefinition } from '@/constants/filters';

type CreateMode = 'video' | 'photo';

type PickedMedia = {
  uri: string;
  mimeType: string | null;
  fileName: string | null;
  fileSize: number | null;
  durationMs: number | null;
  type: 'image' | 'video' | 'unknown';
};

type HubCardDef = {
  id: CreateMode | 'text' | 'live' | 'event';
  active: boolean;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  titleKey: string;
  descKey: string;
};

const HUB_CARDS: HubCardDef[] = [
  {
    id: 'video',
    active: true,
    icon: 'videocam',
    titleKey: 'create.hubVideo',
    descKey: 'create.hubVideoDesc',
  },
  {
    id: 'photo',
    active: true,
    icon: 'camera',
    titleKey: 'create.hubPhoto',
    descKey: 'create.hubPhotoDesc',
  },
  {
    id: 'text',
    active: false,
    icon: 'create-outline',
    titleKey: 'create.hubText',
    descKey: 'create.hubTextDesc',
  },
  {
    id: 'live',
    active: true,
    icon: 'radio-outline',
    titleKey: 'create.hubLive',
    descKey: 'create.hubLiveDesc',
  },
  {
    id: 'event',
    active: true,
    icon: 'calendar-outline',
    titleKey: 'create.hubEvent',
    descKey: 'create.hubEventDesc',
  },
];

/** Android gallery often omits mimeType; infer from type / fileName / URI. */
function inferMimeType(
  asset: ImagePicker.ImagePickerAsset,
  kind: PickedMedia['type'],
): string | null {
  const raw = asset.mimeType?.split(';')[0]?.trim().toLowerCase() || null;
  if (raw && raw !== 'text/plain' && !raw.startsWith('text/')) {
    return raw === 'image/jpg' ? 'image/jpeg' : raw;
  }
  const name = `${asset.fileName || ''} ${asset.uri || ''}`.toLowerCase();
  if (name.includes('.png')) return 'image/png';
  if (name.includes('.webp')) return 'image/webp';
  if (name.includes('.jpg') || name.includes('.jpeg')) return 'image/jpeg';
  if (name.includes('.mov') || name.includes('.qt')) return 'video/quicktime';
  if (name.includes('.webm')) return 'video/webm';
  if (name.includes('.mp4') || name.includes('.m4v')) return 'video/mp4';
  if (kind === 'image') return 'image/jpeg';
  if (kind === 'video') return 'video/mp4';
  return null;
}

export default function CreateScreen() {
  const { publishPost, isMockFeed } = useFeed();
  const { user } = useAuth();
  const { t } = useI18n();
  const colors = useColors();
  const router = useRouter();
  const params = useLocalSearchParams<{ soundId?: string; mode?: string }>();
  const [mode, setMode] = useState<CreateMode | null>(null);
  const [caption, setCaption] = useState('');
  const [media, setMedia] = useState<PickedMedia | null>(null);
  const [cover, setCover] = useState<PickedMedia | null>(null);
  const [category, setCategory] = useState<CategoryId | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedSound, setSelectedSound] = useState<SoundItem | null>(null);
  const [ownSounds, setOwnSounds] = useState<SoundItem[]>([]);
  const [soundPickerOpen, setSoundPickerOpen] = useState(false);
  const [soundBusy, setSoundBusy] = useState(false);
  const [newSoundTitle, setNewSoundTitle] = useState('');
  const [selectedFilter, setSelectedFilter] = useState<FilterDefinition | null>(null);

  const hashtags = useMemo(() => parseHashtags(caption), [caption]);
  const maxMinutes = Math.round(MAX_VIDEO_DURATION_SEC / 60);
  const maxMb = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024));

  const resetForm = () => {
    setCaption('');
    setMedia(null);
    setCover(null);
    setCategory(null);
    setSelectedSound(null);
    setNewSoundTitle('');
    setSelectedFilter(null);
  };

  const loadOwnSounds = useCallback(async () => {
    if (!user?.id || user.id.startsWith('mock_') || isMockFeed) {
      setOwnSounds([]);
      return;
    }
    try {
      const list = await listSoundsByUser(user.id);
      setOwnSounds(list);
    } catch {
      setOwnSounds([]);
    }
  }, [user?.id, isMockFeed]);

  useEffect(() => {
    void loadOwnSounds();
  }, [loadOwnSounds, mode]);

  // Deep-link from sound page: ?soundId=&mode=video
  useEffect(() => {
    const paramMode = params.mode;
    const paramSound = typeof params.soundId === 'string' ? params.soundId : undefined;
    if (paramMode === 'video' || paramMode === 'photo') {
      setMode(paramMode);
    }
    if (paramSound) {
      void (async () => {
        try {
          const s = await fetchSoundById(paramSound);
          if (s) setSelectedSound(s);
        } catch {
          // ignore
        }
      })();
    }
  }, [params.mode, params.soundId]);

  const pickAudioFile = async () => {
    if (!user?.id) {
      Alert.alert(t('feed.loginRequiredTitle'), t('sound.loginRequired'));
      return;
    }
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ['audio/*', 'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/x-m4a'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (res.canceled || !res.assets?.[0]) return;
      const asset = res.assets[0];
      const title =
        (newSoundTitle || '').trim() ||
        (asset.name ? asset.name.replace(/\.[^.]+$/, '') : '') ||
        t('sound.defaultTitle');

      if (isMockFeed || user.id.startsWith('mock_')) {
        const mock: SoundItem = {
          id: `local_sound_${Date.now()}`,
          userId: user.id,
          title,
          storagePath: '',
          publicUrl: asset.uri,
          durationMs: null,
          useCount: 0,
          createdAt: new Date().toISOString(),
          handle: `@${user.username}`,
        };
        setSelectedSound(mock);
        setOwnSounds((prev) => [mock, ...prev]);
        setSoundPickerOpen(false);
        setNewSoundTitle('');
        return;
      }

      setSoundBusy(true);
      const created = await createSound({
        userId: user.id,
        title,
        localUri: asset.uri,
        mimeType: asset.mimeType ?? null,
        fileName: asset.name ?? null,
      });
      setSelectedSound(created);
      setOwnSounds((prev) => [created, ...prev.filter((s) => s.id !== created.id)]);
      setSoundPickerOpen(false);
      setNewSoundTitle('');
    } catch (e) {
      const msg = e instanceof Error ? e.message : t('sound.uploadFail');
      Alert.alert(t('common.error'), msg);
    } finally {
      setSoundBusy(false);
    }
  };

  const openMode = (next: CreateMode) => {
    resetForm();
    setMode(next);
  };

  const backToHub = () => {
    resetForm();
    setMode(null);
  };

  const applyAsset = (asset: ImagePicker.ImagePickerAsset, expected: CreateMode) => {
    const fileSize = asset.fileSize ?? null;
    const durationMs =
      typeof asset.duration === 'number' ? asset.duration : null;
    const type: PickedMedia['type'] =
      asset.type === 'video'
        ? 'video'
        : asset.type === 'image'
          ? 'image'
          : asset.mimeType?.startsWith('video')
            ? 'video'
            : asset.mimeType?.startsWith('image')
              ? 'image'
              : 'unknown';

    if (expected === 'video' && type === 'image') {
      Alert.alert(t('common.error'), t('create.errWrongMediaVideo'));
      return;
    }
    if (expected === 'photo' && type === 'video') {
      Alert.alert(t('common.error'), t('create.errWrongMediaPhoto'));
      return;
    }

    if (fileSize != null && fileSize > MAX_UPLOAD_BYTES) {
      Alert.alert(
        t('create.alertTooLarge'),
        t('create.errTooLarge', { mb: maxMb }),
      );
      return;
    }
    if (
      type === 'video' &&
      durationMs != null &&
      durationMs > MAX_VIDEO_DURATION_SEC * 1000
    ) {
      Alert.alert(
        t('create.alertTooLong'),
        t('create.errTooLong', { minutes: maxMinutes }),
      );
      return;
    }

    const resolvedType: PickedMedia['type'] =
      expected === 'photo' ? 'image' : type === 'unknown' ? 'video' : type;

    setMedia({
      uri: asset.uri,
      mimeType: inferMimeType(asset, resolvedType),
      fileName: asset.fileName ?? null,
      fileSize,
      durationMs: expected === 'photo' ? null : durationMs,
      type: resolvedType,
    });
    if (expected !== 'video') setCover(null);
  };

  const pickCover = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.85,
    });
    if (res.canceled || !res.assets[0]) return;
    const asset = res.assets[0];
    const fileSize = asset.fileSize ?? null;
    if (fileSize != null && fileSize > MAX_UPLOAD_BYTES) {
      Alert.alert(
        t('create.alertTooLarge'),
        t('create.errTooLarge', { mb: maxMb }),
      );
      return;
    }
    setCover({
      uri: asset.uri,
      mimeType: inferMimeType(asset, 'image'),
      fileName: asset.fileName ?? null,
      fileSize,
      durationMs: null,
      type: 'image',
    });
  };

  const pick = async () => {
    if (!mode) return;
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: mode === 'photo' ? ['images'] : ['videos'],
      quality: 0.8,
      videoMaxDuration: MAX_VIDEO_DURATION_SEC,
    });
    if (res.canceled || !res.assets[0]) return;
    applyAsset(res.assets[0], mode);
  };

  const capture = async () => {
    if (!mode) return;
    const cam = await ImagePicker.requestCameraPermissionsAsync();
    if (!cam.granted) {
      Alert.alert(t('create.alertCamera'), t('create.errCameraDenied'));
      return;
    }
    const res = await ImagePicker.launchCameraAsync({
      mediaTypes: mode === 'photo' ? ['images'] : ['videos'],
      quality: 0.8,
      videoMaxDuration: MAX_VIDEO_DURATION_SEC,
      allowsEditing: false,
    });
    if (res.canceled || !res.assets[0]) return;
    applyAsset(res.assets[0], mode);
  };

  const publish = async () => {
    if (!media?.uri && !isMockFeed) {
      Alert.alert(t('create.alertMediaRequired'), t('create.errNoMedia'));
      return;
    }
    if (!category) {
      Alert.alert(t('create.alertCategory'), t('create.errCategoryRequired'));
      return;
    }
    if (media?.fileSize != null && media.fileSize > MAX_UPLOAD_BYTES) {
      Alert.alert(
        t('create.alertTooLarge'),
        t('create.errTooLarge', { mb: maxMb }),
      );
      return;
    }
    if (
      media?.type === 'video' &&
      media.durationMs != null &&
      media.durationMs > MAX_VIDEO_DURATION_SEC * 1000
    ) {
      Alert.alert(
        t('create.alertTooLong'),
        t('create.errTooLong', { minutes: maxMinutes }),
      );
      return;
    }

    setBusy(true);
    try {
      await publishPost({
        caption,
        localUri: media?.uri || undefined,
        mimeType: media?.mimeType ?? null,
        fileName: media?.fileName ?? null,
        mediaKind: media?.type ?? (mode === 'photo' ? 'image' : 'video'),
        coverUri: media?.type === 'video' ? cover?.uri ?? null : null,
        coverMimeType: media?.type === 'video' ? cover?.mimeType ?? null : null,
        coverFileName: media?.type === 'video' ? cover?.fileName ?? null : null,
        category,
        hashtags,
        fileSize: media?.fileSize ?? undefined,
        durationMs: media?.durationMs ?? undefined,
        soundId: selectedSound?.id ?? null,
        filterId: selectedFilter?.id ?? null,
      });
      resetForm();
      setMode(null);
      Alert.alert(
        isMockFeed ? t('create.publishedMockTitle') : t('create.publishedTitle'),
        isMockFeed ? t('create.publishedMockBody') : t('create.publishedBody'),
      );
      router.push('/(tabs)');
    } catch (e) {
      const msg = e instanceof Error ? e.message : t('create.publishFail');
      Alert.alert(t('common.error'), msg);
    } finally {
      setBusy(false);
    }
  };

  const styles = useMemo(() => StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.noir,
  },
  hubScroll: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xxl,
  },
  scroll: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xxl,
  },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: Spacing.sm,
    marginBottom: Spacing.xs,
    gap: 2,
  },
  backText: {
    color: colors.sable,
    fontFamily: Fonts.medium,
    fontSize: 15,
  },
  title: {
    color: colors.sable,
    fontFamily: Fonts.bold,
    fontSize: 28,
    marginTop: Spacing.md,
  },
  subtitle: {
    color: colors.textSecondary,
    fontFamily: Fonts.regular,
    fontSize: 13,
    marginTop: 8,
    marginBottom: Spacing.lg,
    lineHeight: 18,
  },
  hubGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
  },
  hubCard: {
    width: '47%',
    flexGrow: 1,
    minWidth: '42%',
    backgroundColor: colors.noirElevated,
    borderRadius: Radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: Spacing.md,
    minHeight: 148,
  },
  hubCardPressed: {
    borderColor: colors.or,
    backgroundColor: colors.noirSoft,
  },
  hubCardDisabled: {
    opacity: 0.55,
    backgroundColor: colors.noirSoft,
  },
  hubIconWrap: {
    width: 48,
    height: 48,
    borderRadius: Radii.md,
    backgroundColor: 'rgba(209, 127, 42, 0.16)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.sm,
  },
  hubIconWrapDisabled: {
    backgroundColor: 'rgba(245, 230, 211, 0.06)',
  },
  hubCardTitle: {
    color: colors.sable,
    fontFamily: Fonts.bold,
    fontSize: 17,
    marginBottom: 4,
  },
  hubCardTitleDisabled: {
    color: colors.textMuted,
  },
  hubCardDesc: {
    color: colors.textSecondary,
    fontFamily: Fonts.regular,
    fontSize: 12,
    lineHeight: 16,
  },
  hubCardDescDisabled: {
    color: colors.textMuted,
  },
  soonBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: 'rgba(245, 230, 211, 0.12)',
    borderRadius: Radii.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: colors.border,
  },
  soonText: {
    color: colors.textMuted,
    fontFamily: Fonts.medium,
    fontSize: 10,
    letterSpacing: 0.3,
  },
  preview: {
    height: 220,
    borderRadius: Radii.lg,
    backgroundColor: colors.noirSoft,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.md,
    overflow: 'hidden',
  },
  mediaRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  mediaBtn: {
    flex: 1,
  },
  thumb: { width: '100%', height: '100%' },
  previewHint: {
    color: colors.textMuted,
    fontFamily: Fonts.regular,
  },
  previewBadge: {
    position: 'absolute',
    bottom: 10,
    left: 10,
    backgroundColor: 'rgba(0,0,0,0.65)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radii.pill,
  },
  previewBadgeText: {
    color: colors.sable,
    fontFamily: Fonts.medium,
    fontSize: 11,
  },
  label: {
    marginTop: Spacing.lg,
    marginBottom: 6,
    color: colors.sable,
    fontFamily: Fonts.medium,
    fontSize: 13,
  },
  input: {
    minHeight: 100,
    textAlignVertical: 'top',
    backgroundColor: colors.noirSoft,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: Radii.md,
    color: colors.sable,
    fontFamily: Fonts.regular,
    fontSize: 15,
    padding: 14,
  },
  hint: {
    marginTop: 8,
    color: colors.textMuted,
    fontFamily: Fonts.regular,
    fontSize: 12,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  tagChip: {
    backgroundColor: colors.noirSoft,
    borderWidth: 1,
    borderColor: colors.or,
    borderRadius: Radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  tagText: {
    color: colors.or,
    fontFamily: Fonts.medium,
    fontSize: 12,
  },
  catRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  catChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: Radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.noirSoft,
  },
  catChipOn: {
    borderColor: colors.or,
    backgroundColor: 'rgba(201, 162, 39, 0.18)',
  },
  catText: {
    color: colors.textSecondary,
    fontFamily: Fonts.medium,
    fontSize: 13,
  },
  catTextOn: {
    color: colors.or,
  },
  coverBlock: {
    marginTop: Spacing.md,
  },
  coverPreview: {
    marginTop: Spacing.sm,
    width: '100%',
    height: 140,
    borderRadius: Radii.md,
    backgroundColor: colors.noirSoft,
  },
  soundBlock: {
    marginTop: Spacing.lg,
    padding: Spacing.md,
    borderRadius: Radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.noirElevated,
    gap: 10,
  },
  soundSelected: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  soundSelectedText: {
    color: colors.sable,
    fontFamily: Fonts.medium,
    fontSize: 14,
    flex: 1,
  },
  soundSelectedMeta: {
    color: colors.textSecondary,
    fontFamily: Fonts.regular,
    fontSize: 12,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: colors.noirElevated,
    borderTopLeftRadius: Radii.lg,
    borderTopRightRadius: Radii.lg,
    padding: Spacing.lg,
    maxHeight: '75%',
    borderTopWidth: 1,
    borderColor: colors.border,
  },
  modalTitle: {
    color: colors.sable,
    fontFamily: Fonts.bold,
    fontSize: 18,
    marginBottom: Spacing.sm,
  },
  soundRowItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  soundRowTitle: {
    color: colors.sable,
    fontFamily: Fonts.medium,
    fontSize: 14,
    flex: 1,
  },
  soundRowMeta: {
    color: colors.textMuted,
    fontFamily: Fonts.regular,
    fontSize: 11,
  },
}), [colors]);

  if (!mode) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView
          contentContainerStyle={styles.hubScroll}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.title}>{t('create.hubTitle')}</Text>
          <Text style={styles.subtitle}>{t('create.hubSubtitle')}</Text>

          <View style={styles.hubGrid}>
            {HUB_CARDS.map((card) => {
              const disabled = !card.active;
              return (
                <Pressable
                  key={card.id}
                  disabled={disabled}
                  onPress={() => {
                    if (card.id === 'event') {
                      router.push('/events/create');
                      return;
                    }
                    if (card.id === 'live') {
                      router.push('/live/create');
                      return;
                    }
                    if (card.id === 'video' || card.id === 'photo') {
                      openMode(card.id);
                    }
                  }}
                  style={({ pressed }) => [
                    styles.hubCard,
                    disabled && styles.hubCardDisabled,
                    !disabled && pressed && styles.hubCardPressed,
                  ]}
                >
                  {disabled ? (
                    <View style={styles.soonBadge}>
                      <Text style={styles.soonText}>{t('create.hubSoon')}</Text>
                    </View>
                  ) : null}
                  <View
                    style={[
                      styles.hubIconWrap,
                      disabled && styles.hubIconWrapDisabled,
                    ]}
                  >
                    <Ionicons
                      name={card.icon}
                      size={28}
                      color={disabled ? colors.textMuted : colors.or}
                    />
                  </View>
                  <Text
                    style={[
                      styles.hubCardTitle,
                      disabled && styles.hubCardTitleDisabled,
                    ]}
                  >
                    {t(card.titleKey)}
                  </Text>
                  <Text
                    style={[
                      styles.hubCardDesc,
                      disabled && styles.hubCardDescDisabled,
                    ]}
                  >
                    {t(card.descKey)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const isPhoto = mode === 'photo';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Pressable onPress={backToHub} style={styles.backRow} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={colors.sable} />
          <Text style={styles.backText}>{t('common.back')}</Text>
        </Pressable>

        <Text style={styles.title}>
          {isPhoto ? t('create.titlePhoto') : t('create.titleVideo')}
        </Text>
        <Text style={styles.subtitle}>
          {isMockFeed ? t('create.subtitleMock') : t('create.subtitleSupabase')}
        </Text>

        <View style={styles.preview}>
          {media?.uri ? (
            <>
              <FilteredMediaPreview
                uri={media.uri}
                filter={selectedFilter}
                style={styles.thumb}
              />
              <View style={styles.previewBadge}>
                <Text style={styles.previewBadgeText}>
                  {media.type === 'video' ? t('create.video') : t('create.image')}
                  {media.durationMs != null
                    ? ` · ${Math.round(media.durationMs / 1000)} s`
                    : ''}
                  {media.fileSize != null
                    ? ` · ${(media.fileSize / (1024 * 1024)).toFixed(1)} Mo`
                    : ''}
                  {selectedFilter ? ` · ${selectedFilter.name}` : ''}
                </Text>
              </View>
            </>
          ) : (
            <Text style={styles.previewHint}>{t('create.noMedia')}</Text>
          )}
        </View>

        <View style={styles.mediaRow}>
          <View style={styles.mediaBtn}>
            <Button
              title={isPhoto ? t('create.pickPhoto') : t('create.pickVideo')}
              variant="outline"
              onPress={() => void pick()}
            />
          </View>
          <View style={styles.mediaBtn}>
            <Button
              title={isPhoto ? t('create.takePhoto') : t('create.film')}
              variant="gold"
              onPress={() => void capture()}
            />
          </View>
        </View>
        <Text style={styles.hint}>
          {isPhoto ? t('create.filmHintPhoto') : t('create.filmHintVideo')}
        </Text>

        {media?.uri ? (
          <FilterCarousel
            selectedId={selectedFilter?.id ?? null}
            onSelect={setSelectedFilter}
          />
        ) : null}

        {!isPhoto && media?.type === 'video' ? (
          <View style={styles.coverBlock}>
            <Text style={styles.label}>{t('create.coverLabel')}</Text>
            <Text style={styles.hint}>{t('create.coverHint')}</Text>
            {cover?.uri ? (
              <Image source={{ uri: cover.uri }} style={styles.coverPreview} />
            ) : null}
            <View style={styles.mediaRow}>
              <View style={styles.mediaBtn}>
                <Button
                  title={
                    cover?.uri ? t('create.changeCover') : t('create.pickCover')
                  }
                  variant="outline"
                  onPress={() => void pickCover()}
                />
              </View>
              {cover?.uri ? (
                <View style={styles.mediaBtn}>
                  <Button
                    title={t('create.clearCover')}
                    variant="outline"
                    onPress={() => setCover(null)}
                  />
                </View>
              ) : null}
            </View>
          </View>
        ) : null}


        <View style={styles.soundBlock}>
          <Text style={styles.label}>{t('create.addSound')}</Text>
          <Text style={styles.hint}>{t('create.addSoundHint')}</Text>
          {selectedSound ? (
            <View style={styles.soundSelected}>
              <Ionicons name="musical-notes" size={22} color={colors.or} />
              <View style={{ flex: 1 }}>
                <Text style={styles.soundSelectedText} numberOfLines={1}>
                  {selectedSound.title}
                </Text>
                <Text style={styles.soundSelectedMeta}>{selectedSound.handle}</Text>
              </View>
              <Pressable onPress={() => setSelectedSound(null)} hitSlop={8}>
                <Ionicons name="close-circle" size={22} color={colors.textMuted} />
              </Pressable>
            </View>
          ) : (
            <Button
              title={t('create.pickSound')}
              variant="outline"
              onPress={() => {
                void loadOwnSounds();
                setSoundPickerOpen(true);
              }}
            />
          )}
        </View>

        <Modal
          visible={soundPickerOpen}
          transparent
          animationType="slide"
          onRequestClose={() => setSoundPickerOpen(false)}
        >
          <Pressable
            style={styles.modalBackdrop}
            onPress={() => setSoundPickerOpen(false)}
          >
            <Pressable style={styles.modalSheet} onPress={(e) => e.stopPropagation()}>
              <Text style={styles.modalTitle}>{t('create.pickSound')}</Text>
              <Text style={styles.hint}>{t('sound.originalOnly')}</Text>
              <Text style={styles.label}>{t('sound.uploadTitleLabel')}</Text>
              <TextInput
                style={[styles.input, { minHeight: 44, marginBottom: 8 }]}
                value={newSoundTitle}
                onChangeText={setNewSoundTitle}
                placeholder={t('sound.uploadTitlePlaceholder')}
                placeholderTextColor={colors.textMuted}
              />
              <Button
                title={t('sound.uploadAudio')}
                variant="gold"
                loading={soundBusy}
                onPress={() => void pickAudioFile()}
              />
              <Text style={[styles.label, { marginTop: Spacing.md }]}>
                {t('sound.mySounds')}
              </Text>
              <ScrollView style={{ maxHeight: 220 }}>
                {ownSounds.length === 0 ? (
                  <Text style={styles.hint}>{t('sound.emptyOwn')}</Text>
                ) : (
                  ownSounds.map((s) => (
                    <Pressable
                      key={s.id}
                      style={styles.soundRowItem}
                      onPress={() => {
                        setSelectedSound(s);
                        setSoundPickerOpen(false);
                      }}
                    >
                      <Ionicons name="musical-notes" size={20} color={colors.or} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.soundRowTitle}>{s.title}</Text>
                        <Text style={styles.soundRowMeta}>
                          {t('sound.useCount', { count: String(s.useCount) })}
                        </Text>
                      </View>
                    </Pressable>
                  ))
                )}
              </ScrollView>
              <Button
                title={t('common.cancel')}
                variant="outline"
                onPress={() => setSoundPickerOpen(false)}
                style={{ marginTop: Spacing.md }}
              />
            </Pressable>
          </Pressable>
        </Modal>

        <Text style={styles.label}>{t('create.captionLabel')}</Text>
        <TextInput
          style={styles.input}
          multiline
          value={caption}
          onChangeText={setCaption}
          placeholder={t('create.captionPlaceholder')}
          placeholderTextColor={colors.textMuted}
        />
        {hashtags.length > 0 ? (
          <View style={styles.tagRow}>
            {hashtags.map((tag) => (
              <View key={tag} style={styles.tagChip}>
                <Text style={styles.tagText}>#{tag}</Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={styles.hint}>{t('create.hashtagHint')}</Text>
        )}

        <Text style={styles.label}>{t('create.categoryLabel')}</Text>
        <View style={styles.catRow}>
          {DISCOVER_CATEGORIES.map((c) => {
            const selected = category === c.id;
            return (
              <Pressable
                key={c.id}
                onPress={() => setCategory(c.id)}
                style={[styles.catChip, selected && styles.catChipOn]}
              >
                <Text style={[styles.catText, selected && styles.catTextOn]}>
                  {t(c.labelKey)}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.hint}>
          {t('create.limits', { minutes: maxMinutes, mb: maxMb })}
        </Text>

        <Button
          title={t('create.publish')}
          variant="gold"
          loading={busy}
          onPress={publish}
          style={{ marginTop: Spacing.md, marginBottom: Spacing.xl }}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

