/**
 * Brouillon de publication, partagé par les étapes de app/create/*.
 *
 * Le provider vit dans app/create/_layout.tsx : quitter le parcours démonte
 * le provider, donc jette l'état en mémoire. C'est voulu — pas de reset manuel
 * à maintenir dans chaque écran. Pour garder une création, l'utilisateur
 * l'enregistre en brouillon local (S6, lib/drafts) : saveDraft / restoreDraft.
 *
 * Éditeur V1 (montage) : quand l'export natif existe (Android) et en mode
 * vidéo, la création est une timeline de clips (`timeline`). `media` n'est
 * alors qu'un représentant (premier fichier, type vidéo) qui dit « il y a un
 * média » aux écrans et déclenche la navigation ; tout ce qui compte (durée,
 * export, brouillon) se lit dans `timeline`. Sans module (iOS, web), la
 * timeline reste null et rien ne change.
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
import { useAuth } from '@/context/AuthContext';
import { useI18n } from '@/context/I18nContext';
import {
  MAX_UPLOAD_BYTES,
  MAX_VIDEO_DURATION_SEC,
  parseHashtags,
} from '@/constants/publish';
import { isCategoryId, type CategoryId } from '@/constants/categories';
import { getFilterById, type FilterDefinition } from '@/constants/filters';
import type { SoundItem } from '@/lib/sounds';
import { clampSoundOffsetMs } from '@/lib/soundSync';
import { resolveUploadContentType } from '@/lib/videos';
import { deleteCachedFile, localFileSize } from '@/lib/upload';
import { videoFileDurationMs, videoFrameAt } from '@/lib/videoTrim';
import {
  MAX_STILL_MS,
  MAX_TIMELINE_CLIPS,
  appendClips,
  applySourceDuration,
  makeImageClip,
  makeVideoClip,
  timelineDurationMs,
  type TimelineClip,
} from '@/lib/timeline';
import {
  draftSignature,
  saveDraft as saveDraftRecord,
  type DraftInput,
  type LoadedDraft,
} from '@/lib/drafts';
import { EDIT_SPEEDS, buildEditMeta, type EditMeta } from '@/lib/editMeta';
import { maxVideoSourceBytes } from '@/lib/composition';
import { isComposerAvailable } from '@/lib/composer';
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

/** Montage multi-clips possible sur cet appareil (export natif présent). */
export function isTimelineSupported(): boolean {
  return isComposerAvailable();
}

/** Segment de la caméra NIA transmis à la timeline. */
export type CapturedClip = { uri: string; durationMs: number | null; size?: number | null };

/** Média d'un clip, au format des brouillons et des écrans. */
export function clipMedia(clip: TimelineClip): PickedMedia {
  return {
    uri: clip.uri,
    mimeType: clip.mimeType,
    fileName: clip.fileName,
    fileSize: clip.fileSize,
    durationMs: clip.kind === 'video' ? clip.sourceDurationMs : null,
    type: clip.kind === 'image' ? 'image' : 'video',
  };
}

/** Représentant d'une timeline dans `media` (toujours de type vidéo). */
function timelineRepresentative(clips: readonly TimelineClip[]): PickedMedia {
  const first = clips[0];
  return {
    uri: first.uri,
    mimeType: 'video/mp4',
    fileName: first.fileName,
    fileSize: first.fileSize,
    durationMs: timelineDurationMs(clips),
    type: 'video',
  };
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
  /** `baked` : le fichier publié sort de l'export NiaComposer (éditeur P0). */
  buildPublishEditMeta: (options?: { baked?: boolean }) => EditMeta | null;
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
  /**
   * Sélection de découpe en cours à l'édition (S6 : partagée pour être
   * enregistrée dans un brouillon). null : sélection par défaut.
   */
  trimSelection: TrimRange | null;
  setTrimSelection: (next: TrimRange | null) => void;
  /** Brouillon local d'origine (S6), null pour une création jamais enregistrée. */
  draftId: string | null;
  /** Vrai s'il y a un média et des réglages pas encore enregistrés en brouillon. */
  hasUnsavedChanges: boolean;
  /** Enregistre toute la création en brouillon local ; renvoie son id. */
  saveDraft: () => Promise<string>;
  /** Remet l'éditeur exactement dans l'état d'un brouillon relu. */
  restoreDraft: (draft: LoadedDraft) => void;
  /**
   * Abandonne les modifications non enregistrées (« Supprimer » en quittant
   * l'éditeur). Un brouillon rouvert garde sa version enregistrée.
   */
  discardChanges: () => void;
  /**
   * Autorise la sortie du parcours sans confirmation (publication réussie).
   * Lu de façon synchrone par la garde de sortie de l'éditeur.
   */
  releaseLeaveGuard: () => void;
  isLeaveGuardReleased: () => boolean;
  /**
   * Éditeur V1 : montage multi-clips actif (Android, mode vidéo). Faux sur
   * iOS / web : les écrans gardent l'édition à média unique.
   */
  timelineMode: boolean;
  /** Clips du montage, dans l'ordre ; null hors montage. */
  timeline: TimelineClip[] | null;
  /** Remplace la liste (refusée si vide) ; les calques suivent la durée. */
  setTimelineClips: (next: readonly TimelineClip[]) => void;
  /**
   * Segments de la caméra NIA → clips. `append` : ajoutés à la fin du
   * montage en cours, sinon ils le remplacent. false si refusés.
   */
  applyCapturedClips: (clips: readonly CapturedClip[], options?: { append?: boolean }) => boolean;
  /** Galerie (plusieurs vidéos / photos) → clips ajoutés à la fin. */
  addTimelineMedia: () => Promise<void>;
};

const CreateDraftContext = createContext<CreateContextValue | null>(null);

export function CreateProvider({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const ownerId = user?.id ?? null;
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
  const [trimSelection, setTrimSelectionState] = useState<TrimRange | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  /** Empreinte de la dernière version enregistrée (ou rouverte). */
  const [savedSignature, setSavedSignature] = useState<string | null>(null);
  /** Média remis en place par restoreDraft : pas un nouvel import. */
  const restoredDraftUriRef = useRef<string | null>(null);
  /** Après restoreDraft : l'empreinte du prochain rendu devient la référence. */
  const pendingCleanRef = useRef(false);
  const [cleanTick, setCleanTick] = useState(0);
  const leaveGuardReleasedRef = useRef(false);
  const [leaveReleased, setLeaveReleased] = useState(false);
  const timelineMode = isTimelineSupported() && mode === 'video';
  const [timeline, setTimeline] = useState<TimelineClip[] | null>(null);
  const timelineRef = useRef(timeline);
  timelineRef.current = timeline;
  /**
   * Représentant posé par installTimeline : l'effet sur `media` ne doit pas
   * le prendre pour un nouvel import à média unique. `fresh` : nouvelle
   * création (découpe, vitesse, calques et brouillon remis à zéro).
   */
  const timelineMediaRef = useRef<{ media: PickedMedia; fresh: boolean } | null>(null);
  /** Fichiers dont la durée réelle a déjà été mesurée. */
  const probedUrisRef = useRef(new Set<string>());

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
    setTimeline((current) => (current === null ? current : null));
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
      // Éditeur P0 : une vidéo est ré-encodée sous 50 Mo à la publication, la
      // source peut donc être plus lourde quand l'export natif existe.
      const sourceMax =
        type === 'image' ? MAX_UPLOAD_BYTES : maxVideoSourceBytes(isComposerAvailable());
      if (fileSize != null && fileSize > sourceMax) {
        Alert.alert(
          t('create.alertTooLarge'),
          t('create.errTooLarge', { mb: Math.round(sourceMax / (1024 * 1024)) }),
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

  // --- Éditeur V1 : timeline ------------------------------------------

  /** Pose une timeline et son représentant dans `media`. */
  const installTimeline = useCallback((clips: TimelineClip[], fresh: boolean) => {
    const rep = timelineRepresentative(clips);
    timelineMediaRef.current = { media: rep, fresh };
    timelineRef.current = clips;
    setTimeline(clips);
    setMedia(rep);
    if (fresh) setUploadId(makeUploadId());
  }, []);

  const setTimelineClips = useCallback((next: readonly TimelineClip[]) => {
    if (next.length === 0) return;
    const clips = next.slice(0, MAX_TIMELINE_CLIPS);
    timelineRef.current = clips;
    setTimeline(clips);
    const total = timelineDurationMs(clips);
    setOverlays((cur) => {
      const items = clampOverlayTimes(cur.items, total);
      const same = items.length === cur.items.length && items.every((o, i) => o === cur.items[i]);
      return same ? cur : { ...cur, items };
    });
  }, []);

  /**
   * Assets de la galerie → clips. Vidéo trop lourde / trop longue / illisible,
   * photo trop lourde : ignorées et comptées (une seule alerte).
   */
  const clipsFromAssets = useCallback(
    async (assets: ImagePicker.ImagePickerAsset[]): Promise<{ clips: TimelineClip[]; skipped: number }> => {
      const clips: TimelineClip[] = [];
      let skipped = 0;
      const videoMax = maxVideoSourceBytes(true);
      for (const asset of assets) {
        const isImage =
          asset.type === 'image' || (asset.type !== 'video' && !!asset.mimeType?.startsWith('image'));
        const fileSize = asset.fileSize ?? null;
        const base = {
          uri: asset.uri,
          fileName: asset.fileName ?? null,
          fileSize,
        };
        if (isImage) {
          if (fileSize != null && fileSize > MAX_UPLOAD_BYTES) {
            skipped += 1;
            continue;
          }
          const clip = makeImageClip({ ...base, mimeType: inferMimeType(asset, 'image') });
          if (clip) clips.push(clip);
          else skipped += 1;
          continue;
        }
        let durationMs = typeof asset.duration === 'number' ? asset.duration : null;
        if (durationMs == null) durationMs = await videoFileDurationMs(asset.uri);
        if (
          (fileSize != null && fileSize > videoMax) ||
          (durationMs != null && durationMs > MAX_VIDEO_DURATION_SEC * 1000)
        ) {
          skipped += 1;
          continue;
        }
        const clip = makeVideoClip({ ...base, mimeType: inferMimeType(asset, 'video'), durationMs });
        if (clip) clips.push(clip);
        else skipped += 1;
      }
      return { clips, skipped };
    },
    [],
  );

  const launchTimelinePicker = useCallback(async (limit: number) => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos', 'images'],
      allowsMultipleSelection: true,
      selectionLimit: Math.max(1, limit),
      orderedSelection: true,
      quality: 0.8,
      videoMaxDuration: MAX_VIDEO_DURATION_SEC,
    });
    return res.canceled ? [] : res.assets;
  }, []);

  const alertSkipped = useCallback(
    (skipped: number) => {
      if (skipped > 0) {
        Alert.alert(t('timeline.importSkippedTitle'), t('timeline.importSkippedBody', { count: String(skipped) }));
      }
    },
    [t],
  );

  const addTimelineMedia = useCallback(async () => {
    const cur = timelineRef.current;
    if (!cur) return;
    const room = MAX_TIMELINE_CLIPS - cur.length;
    if (room <= 0) {
      Alert.alert(t('timeline.fullTitle'), t('timeline.fullBody', { count: String(MAX_TIMELINE_CLIPS) }));
      return;
    }
    const assets = await launchTimelinePicker(room);
    if (assets.length === 0) return;
    const { clips, skipped } = await clipsFromAssets(assets);
    alertSkipped(skipped);
    const latest = timelineRef.current;
    if (!latest || clips.length === 0) return;
    setTimelineClips(appendClips(latest, clips));
  }, [t, launchTimelinePicker, clipsFromAssets, alertSkipped, setTimelineClips]);

  const applyCapturedClips = useCallback(
    (captured: readonly CapturedClip[], options?: { append?: boolean }): boolean => {
      const sourceMax = maxVideoSourceBytes(true);
      const clips: TimelineClip[] = [];
      for (const c of captured) {
        if (!c.uri) continue;
        const fileSize = c.size ?? localFileSize(c.uri);
        if (fileSize != null && fileSize > sourceMax) {
          Alert.alert(
            t('create.alertTooLarge'),
            t('create.errTooLarge', { mb: Math.round(sourceMax / (1024 * 1024)) }),
          );
          return false;
        }
        const fileName = c.uri.split('/').pop() || null;
        const { contentType } = resolveUploadContentType({
          mimeType: null,
          localUri: c.uri,
          fileName,
          mediaKind: 'video',
        });
        const clip = makeVideoClip({ uri: c.uri, mimeType: contentType, fileName, fileSize, durationMs: c.durationMs });
        if (clip) clips.push(clip);
      }
      if (clips.length === 0) {
        Alert.alert(t('common.error'), t('timeline.importFailed'));
        return false;
      }
      const cur = timelineRef.current;
      if (options?.append && cur && cur.length > 0) {
        // Nouvel objet `media` : l'écran caméra repousse l'édition.
        installTimeline([...appendClips(cur, clips)], false);
      } else {
        installTimeline(clips.slice(0, MAX_TIMELINE_CLIPS), true);
      }
      return true;
    },
    [t, installTimeline],
  );

  // Durée réelle des fichiers (la galerie arrondit, la caméra mesure à la
  // main) : les clips concernés sont bornés à la durée mesurée.
  useEffect(() => {
    if (!timeline) return;
    const pending = [
      ...new Set(timeline.filter((c) => c.kind === 'video').map((c) => c.uri)),
    ].filter((uri) => !probedUrisRef.current.has(uri));
    if (pending.length === 0) return;
    for (const uri of pending) probedUrisRef.current.add(uri);
    void (async () => {
      for (const uri of pending) {
        const d = await videoFileDurationMs(uri);
        const cur = timelineRef.current;
        if (d == null || !cur) continue;
        const next = applySourceDuration(cur, uri, d);
        if (next !== cur) setTimelineClips(next);
      }
    })();
  }, [timeline, setTimelineClips]);

  const pickMedia = useCallback(async () => {
    if (timelineMode) {
      const assets = await launchTimelinePicker(MAX_TIMELINE_CLIPS);
      if (assets.length === 0) return;
      const { clips, skipped } = await clipsFromAssets(assets);
      alertSkipped(skipped);
      if (clips.length > 0) installTimeline(clips, true);
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: mode === 'photo' ? ['images'] : ['videos'],
      quality: 0.8,
      videoMaxDuration: MAX_VIDEO_DURATION_SEC,
    });
    if (res.canceled || !res.assets[0]) return;
    applyAsset(res.assets[0], mode);
  }, [mode, applyAsset, timelineMode, launchTimelinePicker, clipsFromAssets, alertSkipped, installTimeline]);

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
      const sourceMax = maxVideoSourceBytes(isComposerAvailable());
      if (fileSize != null && fileSize > sourceMax) {
        Alert.alert(
          t('create.alertTooLarge'),
          t('create.errTooLarge', { mb: Math.round(sourceMax / (1024 * 1024)) }),
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
    const owned = timelineMediaRef.current;
    if (media && owned && owned.media === media) {
      // Représentant de la timeline (V1).
      timelineMediaRef.current = null;
      if (!owned.fresh) return;
      if (trimOutputRef.current) {
        deleteCachedFile(trimOutputRef.current);
        trimOutputRef.current = null;
      }
      setSourceMedia(media);
      setTrimRange(null);
      setTrimSelectionState(null);
      setPlaybackSpeedState(1);
      setOverlays(emptyOverlayDoc());
      setDraftId(null);
      setSavedSignature(null);
      return;
    }
    if (!media) {
      timelineRef.current = null;
      setTimeline(null);
      setSourceMedia(null);
      setTrimRange(null);
      setTrimSelectionState(null);
      setOverlays((cur) => (cur.items.length ? emptyOverlayDoc() : cur));
      setDraftId(null);
      setSavedSignature(null);
      return;
    }
    if (media.uri === restoredDraftUriRef.current) {
      restoredDraftUriRef.current = null;
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
    setTrimSelectionState(null);
    setPlaybackSpeedState(1);
    setOverlays(emptyOverlayDoc());
    // V1 : une vidéo importée seule (caméra système, repli) devient un clip.
    const single = isTimelineSupported() && media.type === 'video' ? makeVideoClip(media) : null;
    timelineRef.current = single ? [single] : null;
    setTimeline(single ? [single] : null);
    // Nouveau média : ce n'est plus le brouillon rouvert (S6).
    setDraftId(null);
    setSavedSignature(null);
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
    (options?: { baked?: boolean }) =>
      buildEditMeta({
        // Montage : découpes et vitesses sont dans le fichier exporté, les
        // calques déjà en temps de sortie.
        trim: timeline ? null : trimRange,
        sourceDurationMs: timeline ? timelineDurationMs(timeline) : sourceMedia?.durationMs ?? null,
        speed: timeline ? 1 : playbackSpeed,
        hasSound: !!sound,
        soundOffsetMs,
        soundVolume,
        originalVolume,
        overlays,
        isVideo: media?.type === 'video',
        baked: options?.baked === true,
      }),
    [
      timeline,
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

  // --- Brouillons locaux (S6) ------------------------------------------

  const setTrimSelection = useCallback((next: TrimRange | null) => {
    setTrimSelectionState((cur) => {
      if (!next) return null;
      const clean = { startMs: Math.round(next.startMs), endMs: Math.round(next.endMs) };
      return cur && cur.startMs === clean.startMs && cur.endMs === clean.endMs ? cur : clean;
    });
  }, []);

  /** Tout ce qu'un brouillon enregistre, sauf la miniature. */
  const draftInput = useMemo<Omit<DraftInput, 'thumbUri'> | null>(() => {
    if (timeline && timeline.length > 0) {
      return {
        mode,
        source: clipMedia(timeline[0]),
        trimmed: null,
        trimRange: null,
        trimSelection: null,
        cover,
        speed: 1,
        sound,
        soundOffsetMs,
        soundVolume,
        originalVolume,
        filterId: filter?.id ?? null,
        overlays,
        caption,
        category,
        publishOptions,
        timeline: timeline.map((c) => ({
          id: c.id,
          kind: c.kind,
          media: clipMedia(c),
          sourceDurationMs: c.sourceDurationMs,
          startMs: c.startMs,
          endMs: c.endMs,
          speed: c.speed,
        })),
      };
    }
    const src = sourceMedia ?? media;
    if (!src?.uri) return null;
    const trimmed = media && sourceMedia && media.uri !== sourceMedia.uri ? media : null;
    return {
      mode,
      source: src,
      trimmed,
      trimRange: trimmed ? trimRange : null,
      trimSelection,
      cover: src.type === 'video' ? cover : null,
      speed: playbackSpeed,
      sound,
      soundOffsetMs,
      soundVolume,
      originalVolume,
      filterId: filter?.id ?? null,
      overlays,
      caption,
      category,
      publishOptions,
    };
  }, [
    timeline,
    mode,
    media,
    sourceMedia,
    trimRange,
    trimSelection,
    cover,
    playbackSpeed,
    sound,
    soundOffsetMs,
    soundVolume,
    originalVolume,
    filter?.id,
    overlays,
    caption,
    category,
    publishOptions,
  ]);

  const signature = useMemo(
    () => (draftInput ? draftSignature(draftInput) : null),
    [draftInput],
  );
  const signatureRef = useRef(signature);
  signatureRef.current = signature;
  const draftInputRef = useRef(draftInput);
  draftInputRef.current = draftInput;
  const draftIdRef = useRef(draftId);
  draftIdRef.current = draftId;

  useEffect(() => {
    if (!pendingCleanRef.current) return;
    pendingCleanRef.current = false;
    setSavedSignature(signature);
  }, [signature, cleanTick]);

  const hasUnsavedChanges =
    !leaveReleased && signature != null && signature !== savedSignature;

  const saveDraft = useCallback(async (): Promise<string> => {
    const input = draftInputRef.current;
    if (!input) throw new Error('draft_no_media');
    const sig = signatureRef.current;
    // Miniature de la liste : la couverture si elle existe, sinon une image
    // de la vidéo au début de l'extrait retenu.
    let thumbUri: string | null = null;
    const firstClip = input.timeline?.[0];
    if (firstClip) {
      if (firstClip.kind === 'video' && !input.cover) {
        thumbUri = await videoFrameAt(firstClip.media.uri, firstClip.startMs, 360);
      }
    } else if (input.source.type === 'video' && !input.cover) {
      const at = input.trimmed ? 0 : input.trimSelection?.startMs ?? 0;
      thumbUri = await videoFrameAt((input.trimmed ?? input.source).uri, at, 360);
    }
    try {
      const record = await saveDraftRecord(
        { ...input, thumbUri },
        { id: draftIdRef.current, ownerId },
      );
      draftIdRef.current = record.id;
      setDraftId(record.id);
      setSavedSignature(sig);
      return record.id;
    } finally {
      if (thumbUri) deleteCachedFile(thumbUri);
    }
  }, [ownerId]);

  const restoreDraft = useCallback((draft: LoadedDraft) => {
    const r = draft.record;
    const clips: TimelineClip[] | null =
      isTimelineSupported() && r.mode === 'video' && draft.timeline?.length
        ? draft.timeline.map((c) => ({
            id: c.id,
            kind: c.kind,
            uri: c.media.uri,
            mimeType: c.media.mimeType,
            fileName: c.media.fileName,
            fileSize: c.media.fileSize,
            sourceDurationMs: c.kind === 'image' ? MAX_STILL_MS : c.sourceDurationMs,
            startMs: c.startMs,
            endMs: c.endMs,
            speed: c.speed,
          }))
        : null;
    const src = clips ? timelineRepresentative(clips) : draft.source;
    const trimmed = clips ? null : draft.trimmed;
    const shown = trimmed ?? src;
    // L'effet sur `media` ne doit pas traiter ce média comme un nouvel import.
    restoredDraftUriRef.current = shown.uri;
    restoredSourceRef.current = null;
    // Découpe temporaire de la création précédente : elle n'a plus d'usage.
    const previousTrim = trimOutputRef.current;
    if (previousTrim && previousTrim !== trimmed?.uri) deleteCachedFile(previousTrim);
    trimOutputRef.current = trimmed ? trimmed.uri : null;
    soundIdRef.current = r.sound?.id ?? null;
    leaveGuardReleasedRef.current = false;
    setLeaveReleased(false);

    timelineMediaRef.current = null;
    timelineRef.current = clips;
    setTimeline(clips);
    // Fichiers du brouillon : durées déjà justes.
    for (const c of clips ?? []) probedUrisRef.current.add(c.uri);

    setModeState(r.mode);
    setMedia(shown);
    setSourceMedia(src);
    setTrimRange(trimmed ? r.trimRange : null);
    setTrimSelectionState(clips ? null : r.trimSelection);
    setPlaybackSpeedState(
      !clips && (PLAYBACK_SPEEDS as readonly number[]).includes(r.speed) ? r.speed : 1,
    );
    setCover(src.type === 'video' ? draft.cover : null);
    setSoundState(r.sound);
    setSoundOffsetMsState(r.sound ? clampSoundOffsetMs(r.soundOffsetMs, r.sound.durationMs) : 0);
    setSoundVolumeState(r.soundVolume);
    setOriginalVolumeState(r.originalVolume);
    setFilter(getFilterById(r.filterId));
    setOverlays(sanitizeOverlayDoc(r.overlays));
    setCaption(r.caption);
    setCategory(isCategoryId(r.category) ? r.category : null);
    setPublishOptionsState({ ...DEFAULT_PUBLISH_OPTIONS, ...r.publishOptions });
    setUploadId(makeUploadId());
    setDraftId(r.id);
    draftIdRef.current = r.id;
    pendingCleanRef.current = true;
    setCleanTick((n) => n + 1);
  }, []);

  const discardChanges = useCallback(() => {
    if (!draftIdRef.current) {
      // Création jamais enregistrée : rien d'autre à défaire, l'état reste
      // celui d'avant S6 (le son choisi à la caméra est conservé).
      setSavedSignature(signatureRef.current);
      return;
    }
    // Brouillon rouvert : on oublie ses réglages pour que la prochaine
    // capture ne les hérite pas. Le média reste en place (l'éditeur est en
    // train de se fermer) ; il sera remplacé par la prochaine capture.
    draftIdRef.current = null;
    setDraftId(null);
    setCaption('');
    setCategory(null);
    setSoundState(null);
    soundIdRef.current = null;
    setSoundOffsetMsState(0);
    setSoundVolumeState(1);
    setOriginalVolumeState(1);
    setFilter(null);
    setCover(null);
    setPublishOptionsState(DEFAULT_PUBLISH_OPTIONS);
    pendingCleanRef.current = true;
    setCleanTick((n) => n + 1);
  }, []);

  const releaseLeaveGuard = useCallback(() => {
    leaveGuardReleasedRef.current = true;
    setLeaveReleased(true);
  }, []);
  const isLeaveGuardReleased = useCallback(() => leaveGuardReleasedRef.current, []);

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
      trimSelection,
      setTrimSelection,
      draftId,
      hasUnsavedChanges,
      saveDraft,
      restoreDraft,
      discardChanges,
      releaseLeaveGuard,
      isLeaveGuardReleased,
      timelineMode,
      timeline,
      setTimelineClips,
      applyCapturedClips,
      addTimelineMedia,
    }),
    [
      timelineMode,
      timeline,
      setTimelineClips,
      applyCapturedClips,
      addTimelineMedia,
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
      trimSelection,
      setTrimSelection,
      draftId,
      hasUnsavedChanges,
      saveDraft,
      restoreDraft,
      discardChanges,
      releaseLeaveGuard,
      isLeaveGuardReleased,
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
