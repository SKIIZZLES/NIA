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
  useEffect,
  useMemo,
  useRef,
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
import { clampSoundOffsetMs } from '@/lib/soundSync';
import { resolveUploadContentType } from '@/lib/videos';
import { deleteCachedFile, localFileSize } from '@/lib/upload';
import { EDIT_SPEEDS, buildEditMeta, type EditMeta } from '@/lib/editMeta';
import { DEFAULT_PUBLISH_OPTIONS, type PublishOptions } from '@/lib/publishOptions';
import {
  canAddOverlay,
  clampOverlayTimes,
  emptyOverlayDoc,
  sanitizeOverlayDoc,
  type Overlay,
  type OverlayDoc,
} from '@/lib/overlays';

export type CreateMode = 'video' | 'photo';

/**
 * Résultat d'un enregistrement de la caméra intégrée.
 *
 * recordAsync() ne renvoie qu'une URI : ni taille, ni durée. La durée est donc
 * mesurée par l'écran caméra, et la taille lue sur le disque.
 */
export type CapturedVideo = {
  uri: string;
  /** Mesurée pendant l'enregistrement, null si la mesure a échoué. */
  durationMs: number | null;
};

/** Photo prise par la caméra intégrée (takePictureAsync). */
export type CapturedPhoto = {
  uri: string;
};

/** Sélection de découpe, en millisecondes dans le fichier source. */
export type TrimRange = { startMs: number; endMs: number };

/** Fichier produit par la découpe (lib/videoTrim). */
export type TrimmedVideo = { uri: string; durationMs: number; size: number };

/** Vitesses proposées à l'édition (lecture seulement jusqu'à S5). */
/** Vitesses proposées : les mêmes que celles relues dans edit_meta (016). */
export const PLAYBACK_SPEEDS = EDIT_SPEEDS;

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

/**
 * Identifiant de brouillon, régénéré à chaque nouveau média choisi.
 *
 * Il ne sert qu'à nommer l'objet Storage : il vit sous le dossier de
 * l'utilisateur, protégé par les policies RLS, donc Math.random suffit — ce
 * n'est pas une frontière de sécurité, seulement une clé d'idempotence.
 */
function makeUploadId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
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
  /**
   * Réglages du son (sprint S2). Locaux au brouillon pour l'instant : la
   * publication n'envoie que sound_id (début 0, volumes par défaut) tant que
   * la base n'a pas les colonnes correspondantes (S5).
   */
  soundOffsetMs: number;
  setSoundOffsetMs: (next: number) => void;
  /** Volume du son ajouté, 0 → 1. */
  soundVolume: number;
  setSoundVolume: (next: number) => void;
  /** Volume du son original de la vidéo, 0 → 1 (1 normal, 0,3 bas, 0 coupé). */
  originalVolume: number;
  setOriginalVolume: (next: number) => void;
  filter: FilterDefinition | null;
  setFilter: (next: FilterDefinition | null) => void;
  /**
   * Édition (sprint S3). `sourceMedia` est le fichier capturé/importé, jamais
   * modifié : on peut revenir sur une découpe. `media` devient le fichier
   * découpé après applyTrimmedVideo, et c'est lui qui est publié.
   */
  sourceMedia: PickedMedia | null;
  trimRange: TrimRange | null;
  applyTrimmedVideo: (trimmed: TrimmedVideo, range: TrimRange) => void;
  /** Annule la découpe : le brouillon repasse sur le fichier source. */
  clearTrim: () => void;
  /**
   * Vitesse de lecture choisie à l'édition. Locale au brouillon : appliquée à
   * l'aperçu via playbackRate, la vidéo publiée est lue en 1x jusqu'à S5.
   */
  playbackSpeed: number;
  setPlaybackSpeed: (next: number) => void;
  /** Couverture tirée d'une image de la vidéo (fichier JPEG local). */
  setCoverFromFrame: (uri: string, fileSize?: number | null) => void;
  /**
   * Calques texte / stickers (sprint S4), au format de edit_meta.overlays.
   * Locaux au brouillon jusqu'à S5 : la publication ne les envoie pas encore.
   */
  overlays: OverlayDoc;
  /** Format du cadre (largeur / hauteur) mesuré sur le média. */
  setOverlayAspect: (aspect: number) => void;
  /** false si un plafond (nombre, taille) serait dépassé. */
  addOverlay: (overlay: Overlay) => boolean;
  updateOverlay: (id: string, patch: Partial<Overlay>) => void;
  removeOverlay: (id: string) => void;
  /** Options de publication (S5, colonnes 016). */
  publishOptions: PublishOptions;
  setPublishOptions: (patch: Partial<PublishOptions>) => void;
  /** Réglages d'édition à publier (edit_meta, 016) ; null si tout est par défaut. */
  buildPublishEditMeta: () => EditMeta | null;
  /** Hashtags dérivés de la légende, recalculés à la frappe. */
  hashtags: string[];
  /**
   * Stable tant que le média ne change pas. Deux tentatives de publication du
   * même brouillon visent donc le même objet Storage, ce qui rend le réessai
   * idempotent : pas de doublon, pas d'orphelin.
   */
  uploadId: string;
  /** Ouvre la galerie pour le mode courant. */
  pickMedia: () => Promise<void>;
  /** Ouvre la caméra système pour le mode courant (repli et mode photo). */
  captureMedia: () => Promise<void>;
  /**
   * Enregistre dans le brouillon une vidéo produite par la caméra intégrée.
   * Renvoie false si le fichier est refusé (trop lourd, trop long) : l'appelant
   * reste alors sur l'écran caméra au lieu de revenir avec un brouillon vide.
   */
  applyCapturedVideo: (captured: CapturedVideo) => boolean;
  /** Même contrat que applyCapturedVideo, pour une photo de la caméra NIA. */
  applyCapturedPhoto: (captured: CapturedPhoto) => boolean;
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
  const [sound, setSoundState] = useState<SoundItem | null>(null);
  const [soundOffsetMs, setSoundOffsetMsState] = useState(0);
  const [soundVolume, setSoundVolumeState] = useState(1);
  const [originalVolume, setOriginalVolumeState] = useState(1);
  const soundIdRef = useRef<string | null>(null);
  const [sourceMedia, setSourceMedia] = useState<PickedMedia | null>(null);
  const [trimRange, setTrimRange] = useState<TrimRange | null>(null);
  const [playbackSpeed, setPlaybackSpeedState] = useState(1);
  /** URI du dernier fichier découpé : ne doit pas devenir une nouvelle source. */
  const trimOutputRef = useRef<string | null>(null);
  /** Source remise en place par clearTrim : pas un nouvel import. */
  const restoredSourceRef = useRef<string | null>(null);
  const [filter, setFilter] = useState<FilterDefinition | null>(null);
  const [overlays, setOverlays] = useState<OverlayDoc>(() => emptyOverlayDoc());
  const [publishOptions, setPublishOptionsState] = useState<PublishOptions>(
    DEFAULT_PUBLISH_OPTIONS,
  );
  const [uploadId, setUploadId] = useState<string>(makeUploadId);

  /** Un autre son repart de son début ; le même son garde son réglage. */
  const setSound = useCallback((next: SoundItem | null) => {
    const nextId = next?.id ?? null;
    if (nextId !== soundIdRef.current) {
      soundIdRef.current = nextId;
      setSoundOffsetMsState(0);
    }
    setSoundState(next);
  }, []);

  const setSoundOffsetMs = useCallback(
    (next: number) => setSoundOffsetMsState(clampSoundOffsetMs(next, sound?.durationMs)),
    [sound?.durationMs],
  );
  const setSoundVolume = useCallback(
    (next: number) => setSoundVolumeState(Math.max(0, Math.min(1, next))),
    [],
  );
  const setOriginalVolume = useCallback(
    (next: number) => setOriginalVolumeState(Math.max(0, Math.min(1, next))),
    [],
  );

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
      // Autre fichier, autre objet Storage : sinon un réessai après changement
      // de média écraserait l'objet du précédent.
      setUploadId(makeUploadId());
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

  /**
   * Intègre au brouillon une vidéo filmée par la caméra NIA.
   *
   * La taille vient de `localFileSize`, qui interroge le système de fichiers —
   * le fichier n'est jamais lu en JS. C'est la contrainte héritée de la Phase 2 :
   * ni fetch(uri), ni arrayBuffer(), ni blob(), ni base64. Le média ne circule
   * que sous forme d'URI jusqu'à `UploadTask`.
   *
   * Le Content-Type est résolu par `resolveUploadContentType`, la même fonction
   * que le reste du pipeline, plutôt qu'une table dupliquée ici : .mp4 (Android)
   * et .mov (iOS) y sont déjà couverts.
   */
  const applyCapturedVideo = useCallback(
    ({ uri, durationMs }: CapturedVideo): boolean => {
      if (!uri) return false;

      const fileSize = localFileSize(uri);
      if (fileSize != null && fileSize > MAX_UPLOAD_BYTES) {
        Alert.alert(
          t('create.alertTooLarge'),
          t('create.errTooLarge', { mb: maxMb }),
        );
        return false;
      }
      if (durationMs != null && durationMs > MAX_VIDEO_DURATION_SEC * 1000) {
        Alert.alert(
          t('create.alertTooLong'),
          t('create.errTooLong', { minutes: maxMinutes }),
        );
        return false;
      }

      const fileName = uri.split('/').pop() || null;
      const { contentType } = resolveUploadContentType({
        mimeType: null,
        localUri: uri,
        fileName,
        mediaKind: 'video',
      });

      setMedia({
        uri,
        mimeType: contentType,
        fileName,
        fileSize,
        durationMs,
        type: 'video',
      });
      // Nouveau fichier, nouvel objet Storage — même règle que pour un import.
      setUploadId(makeUploadId());
      return true;
    },
    [t, maxMb, maxMinutes],
  );

  /**
   * Intègre au brouillon une photo prise par la caméra NIA. Même règle que la
   * vidéo : le fichier n'est jamais lu en JS, seule sa taille est interrogée.
   * takePictureAsync produit un JPEG dans le cache de l'app.
   */
  const applyCapturedPhoto = useCallback(
    ({ uri }: CapturedPhoto): boolean => {
      if (!uri) return false;
      const fileSize = localFileSize(uri);
      if (fileSize != null && fileSize > MAX_UPLOAD_BYTES) {
        Alert.alert(
          t('create.alertTooLarge'),
          t('create.errTooLarge', { mb: maxMb }),
        );
        return false;
      }
      setMedia({
        uri,
        mimeType: 'image/jpeg',
        fileName: uri.split('/').pop() || null,
        fileSize,
        durationMs: null,
        type: 'image',
      });
      setUploadId(makeUploadId());
      setCover(null);
      return true;
    },
    [t, maxMb],
  );

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

  // Tout nouveau média capturé ou importé devient la source de l'édition, et
  // remet découpe et vitesse à zéro. Le fichier découpé, lui, n'en est pas une.
  useEffect(() => {
    if (!media) {
      setSourceMedia(null);
      setTrimRange(null);
      setOverlays((cur) => (cur.items.length ? emptyOverlayDoc() : cur));
      return;
    }
    if (media.uri === trimOutputRef.current) return;
    if (media.uri === restoredSourceRef.current) {
      restoredSourceRef.current = null;
      return;
    }
    if (trimOutputRef.current) {
      deleteCachedFile(trimOutputRef.current);
      trimOutputRef.current = null;
    }
    setSourceMedia(media);
    setTrimRange(null);
    setPlaybackSpeedState(1);
    setOverlays(emptyOverlayDoc());
  }, [media]);

  const applyTrimmedVideo = useCallback(
    (trimmed: TrimmedVideo, range: TrimRange) => {
      const src = sourceMedia;
      if (!src || !trimmed.uri) return;
      const previous = trimOutputRef.current;
      trimOutputRef.current = trimmed.uri;
      if (previous && previous !== trimmed.uri) deleteCachedFile(previous);
      setMedia({
        uri: trimmed.uri,
        mimeType: 'video/mp4',
        fileName: trimmed.uri.split('/').pop() || null,
        fileSize: trimmed.size > 0 ? trimmed.size : localFileSize(trimmed.uri),
        durationMs: trimmed.durationMs,
        type: 'video',
      });
      setTrimRange(range);
      // Les fenêtres d'affichage des calques suivent la nouvelle durée.
      setOverlays((cur) => ({
        ...cur,
        items: clampOverlayTimes(cur.items, Math.max(0, range.endMs - range.startMs)),
      }));
      // Nouveau fichier, nouvel objet Storage.
      setUploadId(makeUploadId());
    },
    [sourceMedia],
  );

  const clearTrim = useCallback(() => {
    const src = sourceMedia;
    const previous = trimOutputRef.current;
    if (!src || !previous) {
      setTrimRange(null);
      return;
    }
    // Le média redevient la source : l'effet ci-dessus ne doit pas la traiter
    // comme un nouvel import (la vitesse est conservée).
    trimOutputRef.current = null;
    restoredSourceRef.current = src.uri;
    deleteCachedFile(previous);
    setMedia(src);
    setTrimRange(null);
    setUploadId(makeUploadId());
  }, [sourceMedia]);

  const setPlaybackSpeed = useCallback((next: number) => {
    const ok = (PLAYBACK_SPEEDS as readonly number[]).includes(next);
    setPlaybackSpeedState(ok ? next : 1);
  }, []);

  const setCoverFromFrame = useCallback((uri: string, fileSize?: number | null) => {
    if (!uri) return;
    setCover({
      uri,
      mimeType: 'image/jpeg',
      fileName: uri.split('/').pop() || null,
      fileSize: fileSize ?? localFileSize(uri),
      durationMs: null,
      type: 'image',
    });
  }, []);

  const setOverlayAspect = useCallback((aspect: number) => {
    setOverlays((cur) => {
      const next = sanitizeOverlayDoc({ ...cur, aspect });
      return next.aspect === cur.aspect ? cur : { ...cur, aspect: next.aspect };
    });
  }, []);

  // Lu dans un ref : addOverlay répond tout de suite (plafond atteint ou non).
  const overlaysRef = useRef(overlays);
  overlaysRef.current = overlays;

  const addOverlay = useCallback((overlay: Overlay) => {
    const cur = overlaysRef.current;
    const clean = sanitizeOverlayDoc({ ...cur, items: [overlay] }).items[0];
    if (!clean || !canAddOverlay(cur, clean)) return false;
    const next = { ...cur, items: [...cur.items, clean] };
    overlaysRef.current = next;
    setOverlays(next);
    return true;
  }, []);

  const updateOverlay = useCallback((id: string, patch: Partial<Overlay>) => {
    setOverlays((cur) => {
      const idx = cur.items.findIndex((o) => o.id === id);
      if (idx < 0) return cur;
      const merged = { ...cur.items[idx], ...patch, id } as Overlay;
      const clean = sanitizeOverlayDoc({ ...cur, items: [merged] }).items[0];
      if (!clean) return cur;
      const items = cur.items.slice();
      items[idx] = clean;
      const next = sanitizeOverlayDoc({ ...cur, items });
      // Modification refusée si elle ferait sortir du plafond d'octets.
      return next.items.length === items.length ? next : cur;
    });
  }, []);

  const removeOverlay = useCallback((id: string) => {
    setOverlays((cur) =>
      cur.items.some((o) => o.id === id)
        ? { ...cur, items: cur.items.filter((o) => o.id !== id) }
        : cur,
    );
  }, []);

  const setPublishOptions = useCallback((patch: Partial<PublishOptions>) => {
    // Non public ⇒ jamais republiable : appliqué à l'envoi
    // (publishOptionsPayload), le choix de l'utilisateur est conservé ici.
    setPublishOptionsState((cur) => ({ ...cur, ...patch }));
  }, []);

  const buildPublishEditMeta = useCallback(
    () =>
      buildEditMeta({
        trim: trimRange,
        sourceDurationMs: sourceMedia?.durationMs ?? null,
        speed: playbackSpeed,
        hasSound: !!sound,
        soundOffsetMs,
        soundVolume,
        originalVolume,
        overlays,
        isVideo: media?.type === 'video',
      }),
    [
      trimRange,
      sourceMedia?.durationMs,
      playbackSpeed,
      sound,
      soundOffsetMs,
      soundVolume,
      originalVolume,
      overlays,
      media?.type,
    ],
  );

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
      soundOffsetMs,
      setSoundOffsetMs,
      soundVolume,
      setSoundVolume,
      originalVolume,
      setOriginalVolume,
      filter,
      setFilter,
      sourceMedia,
      trimRange,
      applyTrimmedVideo,
      clearTrim,
      playbackSpeed,
      setPlaybackSpeed,
      setCoverFromFrame,
      overlays,
      setOverlayAspect,
      addOverlay,
      updateOverlay,
      removeOverlay,
      publishOptions,
      setPublishOptions,
      buildPublishEditMeta,
      hashtags,
      uploadId,
      pickMedia,
      captureMedia,
      applyCapturedVideo,
      applyCapturedPhoto,
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
      setSound,
      soundOffsetMs,
      setSoundOffsetMs,
      soundVolume,
      setSoundVolume,
      originalVolume,
      setOriginalVolume,
      filter,
      sourceMedia,
      trimRange,
      applyTrimmedVideo,
      clearTrim,
      playbackSpeed,
      setPlaybackSpeed,
      setCoverFromFrame,
      overlays,
      setOverlayAspect,
      addOverlay,
      updateOverlay,
      removeOverlay,
      publishOptions,
      setPublishOptions,
      buildPublishEditMeta,
      hashtags,
      uploadId,
      pickMedia,
      captureMedia,
      applyCapturedVideo,
      applyCapturedPhoto,
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
