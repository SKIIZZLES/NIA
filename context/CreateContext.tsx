/**
 * Brouillon de publication, partagé par les étapes de app/create/*.
 *
 * Le provider vit dans app/create/_layout.tsx : quitter le parcours démonte
 * le provider, donc jette le brouillon. C'est voulu — pas de reset manuel à
 * maintenir dans chaque écran.
 *
 * Toute la logique média (sélection, capture, validation taille/durée,
 * déduction du mimeType) est ici et non dans les écrans : les trois étapes la
 * partagent, et elle était la moitié de l'ancien app/(tabs)/create.tsx.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import { Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useI18n } from '@/context/I18nContext';
import {
  MAX_UPLOAD_BYTES,
  MAX_VIDEO_DURATION_SEC,
  parseHashtags,
} from '@/constants/publish';
import type { CategoryId } from '@/constants/categories';
import type { FilterDefinition } from '@/constants/filters';
import type { SoundItem } from '@/lib/sounds';

export type CreateMode = 'video' | 'photo';

export type PickedMedia = {
  uri: string;
  mimeType: string | null;
  fileName: string | null;
  fileSize: number | null;
  durationMs: number | null;
  type: 'image' | 'video' | 'unknown';
};

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

type CreateContextValue = {
  mode: CreateMode;
  setMode: (next: CreateMode) => void;
  media: PickedMedia | null;
  cover: PickedMedia | null;
  caption: string;
  setCaption: (next: string) => void;
  category: CategoryId | null;
  setCategory: (next: CategoryId | null) => void;
  sound: SoundItem | null;
  setSound: (next: SoundItem | null) => void;
  filter: FilterDefinition | null;
  setFilter: (next: FilterDefinition | null) => void;
  /** Hashtags dérivés de la légende, recalculés à la frappe. */
  hashtags: string[];
  /** Ouvre la galerie pour le mode courant. */
  pickMedia: () => Promise<void>;
  /** Ouvre la caméra pour le mode courant. */
  captureMedia: () => Promise<void>;
  pickCover: () => Promise<void>;
  clearCover: () => void;
  maxMb: number;
  maxMinutes: number;
};

const CreateDraftContext = createContext<CreateContextValue | null>(null);

export function CreateProvider({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const [mode, setModeState] = useState<CreateMode>('video');
  const [media, setMedia] = useState<PickedMedia | null>(null);
  const [cover, setCover] = useState<PickedMedia | null>(null);
  const [caption, setCaption] = useState('');
  const [category, setCategory] = useState<CategoryId | null>(null);
  const [sound, setSound] = useState<SoundItem | null>(null);
  const [filter, setFilter] = useState<FilterDefinition | null>(null);

  const maxMinutes = Math.round(MAX_VIDEO_DURATION_SEC / 60);
  const maxMb = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024));
  const hashtags = useMemo(() => parseHashtags(caption), [caption]);

  /**
   * Changer de mode invalide le média déjà choisi : il est du mauvais type.
   * Les setters sont appelés côte à côte et non dans l'updater de setModeState :
   * un updater useState doit rester pur, sinon React peut le rejouer.
   */
  const setMode = useCallback((next: CreateMode) => {
    setModeState((current) => (current === next ? current : next));
    setMedia((current) => (current === null ? current : null));
    setCover((current) => (current === null ? current : null));
    setFilter((current) => (current === null ? current : null));
  }, []);

  const applyAsset = useCallback(
    (asset: ImagePicker.ImagePickerAsset, expected: CreateMode) => {
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
    },
    [t, maxMb, maxMinutes],
  );

  const pickMedia = useCallback(async () => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: mode === 'photo' ? ['images'] : ['videos'],
      quality: 0.8,
      videoMaxDuration: MAX_VIDEO_DURATION_SEC,
    });
    if (res.canceled || !res.assets[0]) return;
    applyAsset(res.assets[0], mode);
  }, [mode, applyAsset]);

  const captureMedia = useCallback(async () => {
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
  }, [mode, applyAsset, t]);

  const pickCover = useCallback(async () => {
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
  }, [t, maxMb]);

  const clearCover = useCallback(() => setCover(null), []);

  const value = useMemo<CreateContextValue>(
    () => ({
      mode,
      setMode,
      media,
      cover,
      caption,
      setCaption,
      category,
      setCategory,
      sound,
      setSound,
      filter,
      setFilter,
      hashtags,
      pickMedia,
      captureMedia,
      pickCover,
      clearCover,
      maxMb,
      maxMinutes,
    }),
    [
      mode,
      setMode,
      media,
      cover,
      caption,
      category,
      sound,
      filter,
      hashtags,
      pickMedia,
      captureMedia,
      pickCover,
      clearCover,
      maxMb,
      maxMinutes,
    ],
  );

  return (
    <CreateDraftContext.Provider value={value}>
      {children}
    </CreateDraftContext.Provider>
  );
}

export function useCreateDraft(): CreateContextValue {
  const ctx = useContext(CreateDraftContext);
  if (!ctx) {
    throw new Error('useCreateDraft must be used inside CreateProvider');
  }
  return ctx;
}
