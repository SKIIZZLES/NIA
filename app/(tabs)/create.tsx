import React, { useMemo, useState } from 'react';
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/Button';
import { useFeed } from '@/context/FeedContext';
import { useI18n } from '@/context/I18nContext';
import { Colors, Fonts, Radii, Spacing } from '@/constants/theme';
import {
  DISCOVER_CATEGORIES,
  type CategoryId,
} from '@/constants/categories';
import {
  MAX_UPLOAD_BYTES,
  MAX_VIDEO_DURATION_SEC,
  parseHashtags,
} from '@/constants/publish';

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
    active: false,
    icon: 'radio-outline',
    titleKey: 'create.hubLive',
    descKey: 'create.hubLiveDesc',
  },
  {
    id: 'event',
    active: false,
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
  const { t } = useI18n();
  const router = useRouter();
  const [mode, setMode] = useState<CreateMode | null>(null);
  const [caption, setCaption] = useState('');
  const [media, setMedia] = useState<PickedMedia | null>(null);
  const [cover, setCover] = useState<PickedMedia | null>(null);
  const [category, setCategory] = useState<CategoryId | null>(null);
  const [busy, setBusy] = useState(false);

  const hashtags = useMemo(() => parseHashtags(caption), [caption]);
  const maxMinutes = Math.round(MAX_VIDEO_DURATION_SEC / 60);
  const maxMb = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024));

  const resetForm = () => {
    setCaption('');
    setMedia(null);
    setCover(null);
    setCategory(null);
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
                      color={disabled ? Colors.textMuted : Colors.or}
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
          <Ionicons name="chevron-back" size={22} color={Colors.sable} />
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
              <Image source={{ uri: media.uri }} style={styles.thumb} />
              <View style={styles.previewBadge}>
                <Text style={styles.previewBadgeText}>
                  {media.type === 'video' ? t('create.video') : t('create.image')}
                  {media.durationMs != null
                    ? ` · ${Math.round(media.durationMs / 1000)} s`
                    : ''}
                  {media.fileSize != null
                    ? ` · ${(media.fileSize / (1024 * 1024)).toFixed(1)} Mo`
                    : ''}
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

        <Text style={styles.label}>{t('create.captionLabel')}</Text>
        <TextInput
          style={styles.input}
          multiline
          value={caption}
          onChangeText={setCaption}
          placeholder={t('create.captionPlaceholder')}
          placeholderTextColor={Colors.textMuted}
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
                  {c.label}
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

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.noir,
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
    color: Colors.sable,
    fontFamily: Fonts.medium,
    fontSize: 15,
  },
  title: {
    color: Colors.sable,
    fontFamily: Fonts.bold,
    fontSize: 28,
    marginTop: Spacing.md,
  },
  subtitle: {
    color: Colors.textSecondary,
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
    backgroundColor: Colors.noirElevated,
    borderRadius: Radii.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
    minHeight: 148,
  },
  hubCardPressed: {
    borderColor: Colors.or,
    backgroundColor: Colors.noirSoft,
  },
  hubCardDisabled: {
    opacity: 0.55,
    backgroundColor: Colors.noirSoft,
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
    color: Colors.sable,
    fontFamily: Fonts.bold,
    fontSize: 17,
    marginBottom: 4,
  },
  hubCardTitleDisabled: {
    color: Colors.textMuted,
  },
  hubCardDesc: {
    color: Colors.textSecondary,
    fontFamily: Fonts.regular,
    fontSize: 12,
    lineHeight: 16,
  },
  hubCardDescDisabled: {
    color: Colors.textMuted,
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
    borderColor: Colors.border,
  },
  soonText: {
    color: Colors.textMuted,
    fontFamily: Fonts.medium,
    fontSize: 10,
    letterSpacing: 0.3,
  },
  preview: {
    height: 220,
    borderRadius: Radii.lg,
    backgroundColor: Colors.noirSoft,
    borderWidth: 1,
    borderColor: Colors.border,
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
    color: Colors.textMuted,
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
    color: Colors.sable,
    fontFamily: Fonts.medium,
    fontSize: 11,
  },
  label: {
    marginTop: Spacing.lg,
    marginBottom: 6,
    color: Colors.sable,
    fontFamily: Fonts.medium,
    fontSize: 13,
  },
  input: {
    minHeight: 100,
    textAlignVertical: 'top',
    backgroundColor: Colors.noirSoft,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radii.md,
    color: Colors.sable,
    fontFamily: Fonts.regular,
    fontSize: 15,
    padding: 14,
  },
  hint: {
    marginTop: 8,
    color: Colors.textMuted,
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
    backgroundColor: Colors.noirSoft,
    borderWidth: 1,
    borderColor: Colors.or,
    borderRadius: Radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  tagText: {
    color: Colors.or,
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
    borderColor: Colors.border,
    backgroundColor: Colors.noirSoft,
  },
  catChipOn: {
    borderColor: Colors.or,
    backgroundColor: 'rgba(201, 162, 39, 0.18)',
  },
  catText: {
    color: Colors.textSecondary,
    fontFamily: Fonts.medium,
    fontSize: 13,
  },
  catTextOn: {
    color: Colors.or,
  },
  coverBlock: {
    marginTop: Spacing.md,
  },
  coverPreview: {
    marginTop: Spacing.sm,
    width: '100%',
    height: 140,
    borderRadius: Radii.md,
    backgroundColor: Colors.noirSoft,
  },
});
