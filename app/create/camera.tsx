/**
 * Caméra NIA — V2 (sprint S1 : le « + » ouvre la caméra directement).
 *
 * Premier écran du « + », plein écran, façon TikTok :
 * - colonne latérale : retourner, flash (torche en vidéo), minuteur 3 s / 10 s,
 *   filtres NIA V2.6 (teinte d'aperçu sur le viseur) ;
 * - en haut : fermer, choix du son ; le son est joué pendant l'enregistrement
 *   (sprint S2, option « Écoute ») et le micro est alors coupé pour éviter l'écho ;
 * - en bas : durée (3 min / 60 s / 15 s / Photo), déclencheur, galerie
 *   (sélecteur système, aucune permission médias), brouillons locaux (S6,
 *   affichés dès qu'il y en a un), onglets Vidéo / Photo / Live ;
 * - zoom au pincement.
 *
 * Sprint S7 — multi-segments façon TikTok : chaque appui (ou maintien) du
 * déclencheur ajoute un segment. La barre du haut montre les segments et
 * leurs séparateurs sur la durée max ; « supprimer le dernier segment » et
 * « Suivant » apparaissent dès le premier segment. À la durée max,
 * l'enregistrement s'arrête seul et passe à l'édition. Le son reprend, à
 * chaque segment, là où le précédent l'a laissé. « Suivant » assemble les
 * segments en une seule vidéo (react-native-media-toolkit, sans ré-encodage)
 * qui entre dans /create/edit comme une prise unique. Quitter la caméra avec
 * des segments demande confirmation.
 *
 * Après une capture ou un import, le média entre dans le CreateContext et
 * l'écran pousse /create/edit (sprint S3), puis aperçu et publication.
 *
 * Les fichiers produits restent sur le disque (cache de l'app) et ne circulent
 * que sous forme d'URI jusqu'à UploadTask. Aucun fetch, aucun arrayBuffer,
 * aucun base64 : c'est la contrainte héritée de la Phase 2.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  BackHandler,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { File, Paths } from 'expo-file-system';
import {
  CameraView,
  useCameraPermissions,
  useMicrophonePermissions,
  type FlashMode,
} from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/Button';
import { CameraSoundSheet } from '@/components/CameraSoundSheet';
import { FilterCarousel } from '@/components/FilterCarousel';
import { useCreateDraft } from '@/context/CreateContext';
import { useI18n } from '@/context/I18nContext';
import { MediaChrome, useColors } from '@/context/ThemeContext';
import { Fonts, MediaTextShadow, Radii, Spacing } from '@/constants/theme';
import { getFilterOverlayStyle } from '@/constants/filters';
import { MAX_VIDEO_DURATION_SEC } from '@/constants/publish';
import { ComposerProgress } from '@/components/ComposerProgress';
import { useComposerJob } from '@/hooks/useComposerJob';
import { composerCachePath, isComposerAvailable, runComposition } from '@/lib/composer';
import { buildSegmentsComposition, maxVideoSourceBytes } from '@/lib/composition';
import { deleteCachedFile, localFileSize } from '@/lib/upload';
import { concatVideoFiles, isConcatAvailable, videoFileDurationMs } from '@/lib/videoTrim';
import {
  addSegment,
  fileUriToPath,
  isFull,
  nextSegmentLimits,
  progressParts,
  remainingMs,
  removeLastSegment,
  resolveSegmentDurationMs,
  segmentsKey,
  soundOffsetForSegment,
  stopDelayMs,
  totalDurationMs,
  type Segment,
} from '@/lib/segments';
import { SyncedSound } from '@/components/SyncedSound';
import { fetchSoundById } from '@/lib/sounds';
import { useDraftCount } from '@/hooks/useDraftCount';

/**
 * 720p : compromis assumé entre lisibilité et budget de 50 Mo. En 1080p le
 * plafond de taille est atteint en quelques dizaines de secondes.
 * Les types signalent cette valeur comme « Android only » — sur iOS le réglage
 * est ignoré et le système choisit sa qualité.
 */
const VIDEO_QUALITY = '720p' as const;

/** Durées proposées, en secondes (toujours bornées par MAX_VIDEO_DURATION_SEC). */
const DURATIONS = [
  { sec: 180, labelKey: 'camera.duration3m' },
  { sec: 60, labelKey: 'camera.duration60' },
  { sec: 15, labelKey: 'camera.duration15' },
] as const;
type DurationSec = (typeof DURATIONS)[number]['sec'];

type TimerSetting = 0 | 3 | 10;
const NEXT_TIMER: Record<TimerSetting, TimerSetting> = { 0: 3, 3: 10, 10: 0 };

type PhotoFlash = 'off' | 'on' | 'auto';
const NEXT_FLASH: Record<PhotoFlash, PhotoFlash> = { off: 'on', on: 'auto', auto: 'off' };

function formatDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

type Phase = 'idle' | 'countdown' | 'recording' | 'processing';

/** Maintien du déclencheur au-delà duquel on filme « tant que le doigt reste ». */
const HOLD_DELAY_MS = 250;

let segmentSeq = 0;
function makeSegmentId(): string {
  segmentSeq += 1;
  return `seg-${Date.now().toString(36)}-${segmentSeq}`;
}

/**
 * La caméra est un écran sur média : palette sombre quel que soit le thème
 * (`MediaChrome`), voiles `mediaScrim` et texte `onMedia` sur la vidéo.
 */
export default function CreateCameraScreen() {
  return (
    <MediaChrome>
      <CameraScreen />
    </MediaChrome>
  );
}

function CameraScreen() {
  const router = useRouter();
  const colors = useColors();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const navigation = useNavigation();
  const params = useLocalSearchParams<{ soundId?: string; mode?: string }>();
  const {
    mode,
    setMode,
    media,
    sourceMedia,
    filter,
    setFilter,
    sound,
    setSound,
    soundOffsetMs,
    setSoundOffsetMs,
    soundVolume,
    applyCapturedVideo,
    applyCapturedPhoto,
    captureMedia,
    pickMedia,
    isLeaveGuardReleased,
  } = useCreateDraft();
  const isPhoto = mode === 'photo';
  const draftCount = useDraftCount();

  const [camPermission, requestCamPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();

  const cameraRef = useRef<CameraView | null>(null);
  const [facing, setFacing] = useState<'back' | 'front'>('back');
  const [phase, setPhase] = useState<Phase>('idle');
  const [seconds, setSeconds] = useState(0);
  const [ready, setReady] = useState(false);
  const [cameraFailed, setCameraFailed] = useState(false);
  const [maxSec, setMaxSec] = useState<DurationSec>(60);
  const [timerSetting, setTimerSetting] = useState<TimerSetting>(0);
  const [countdown, setCountdown] = useState(0);
  const [torch, setTorch] = useState(false);
  const [photoFlash, setPhotoFlash] = useState<PhotoFlash>('off');
  const [zoom, setZoom] = useState(0);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [soundSheetOpen, setSoundSheetOpen] = useState(false);
  /** Jouer le son choisi pendant l'enregistrement (micro coupé, anti-écho). */
  const [hearSound, setHearSound] = useState(true);
  /** Segments filmés (S7), dans l'ordre. */
  const [segments, setSegments] = useState<Segment[]>([]);
  const segmentsRef = useRef<Segment[]>(segments);
  segmentsRef.current = segments;
  /** Durée du segment en cours, pour la barre (ms). */
  const [currentMs, setCurrentMs] = useState(0);
  /** Assemblage des segments en cours (« Suivant »). */
  const [assembling, setAssembling] = useState(false);
  /** Dernier assemblage : réutilisé si les segments n'ont pas changé. */
  const lastConcatRef = useRef<{ key: string; uri: string } | null>(null);
  /** Arrêt automatique à la durée max, et arrêt différé d'un segment trop court. */
  const autoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const delayedStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Le segment en cours a été lancé par un maintien du déclencheur. */
  const holdRef = useRef(false);
  /** Fermer après l'arrêt du segment en cours (confirmation ensuite). */
  const askLeaveAfterStopRef = useRef(false);
  /** Caméra du segment en cours (éditeur P0 : retournement entre segments). */
  const facingRef = useRef(facing);
  facingRef.current = facing;
  /** Éditeur P0 : assemblage ré-encodé quand les segments viennent des deux caméras. */
  const composer = useComposerJob();
  const composerRun = composer.run;
  const mediaUriRef = useRef<string | null>(null);
  mediaUriRef.current = (sourceMedia ?? media)?.uri ?? null;

  /** Marque un enregistrement dont le résultat doit être jeté (abandon). */
  const abandonRef = useRef(false);
  /** true quand l'abandon vient d'un geste explicite et doit fermer l'écran. */
  const leaveAfterAbandonRef = useRef(false);
  /** Évite de rejouer le repli caméra système en boucle. */
  const fallbackDoneRef = useRef(false);
  /**
   * Horodatage du début d'enregistrement. La durée ne peut pas être lue dans
   * l'état React après l'await : la closure de `record` a capturé la valeur du
   * démarrage, soit zéro.
   */
  const startedAtRef = useRef(0);
  /** Pincement : distance et zoom au début du geste à deux doigts. */
  const pinchRef = useRef<{ dist: number; zoom: number } | null>(null);

  const micGranted = micPermission?.granted === true;
  const busy = phase !== 'idle' || assembling;
  const playSoundWhileRecording = !!sound?.publicUrl && hearSound;
  const maxMs = maxSec * 1000;
  const hasSegments = segments.length > 0;
  const recordedMs = totalDurationMs(segments);
  const full = hasSegments && isFull(segments, maxMs);
  // Le son reprend, à chaque segment, là où le précédent l'a laissé.
  const segmentSoundOffsetMs = soundOffsetForSegment(
    soundOffsetMs,
    recordedMs,
    sound?.durationMs ?? null,
  );

  /** Supprime un fichier de segment, sauf s'il est devenu le média du brouillon. */
  const dropSegmentFile = useCallback((uri: string) => {
    if (uri && uri !== mediaUriRef.current) deleteCachedFile(uri);
  }, []);

  const clearStopTimers = useCallback(() => {
    if (autoStopRef.current) clearTimeout(autoStopRef.current);
    if (delayedStopRef.current) clearTimeout(delayedStopRef.current);
    autoStopRef.current = null;
    delayedStopRef.current = null;
  }, []);

  // Sortie du parcours : les segments (fichiers du cache) partent avec lui.
  useEffect(
    () => () => {
      clearStopTimers();
      for (const seg of segmentsRef.current) dropSegmentFile(seg.uri);
      // L'assemblage aussi, sauf s'il est devenu le média du brouillon.
      const concat = lastConcatRef.current?.uri;
      if (concat) dropSegmentFile(concat);
    },
    [clearStopTimers, dropSegmentFile],
  );

  // Après un retournement ou un changement de mode, la session native est
  // recréée : le déclencheur attend onCameraReady. Filet de sécurité si
  // l'événement n'arrivait pas (certains appareils) : réarmement après 3 s.
  useEffect(() => {
    if (ready || !isFocused) return;
    const id = setTimeout(() => setReady(true), 3000);
    return () => clearTimeout(id);
  }, [ready, isFocused, facing, mode]);

  // --- Paramètres d'entrée (page d'un son : /create/camera?soundId=…&mode=video).
  // Chaque valeur n'est appliquée qu'une fois, comme à l'étape 1.
  const appliedMode = useRef<string | null>(null);
  useEffect(() => {
    const next = params.mode;
    if (next !== 'video' && next !== 'photo') return;
    if (appliedMode.current === next) return;
    appliedMode.current = next;
    setMode(next);
  }, [params.mode, setMode]);

  useEffect(() => {
    const soundId = typeof params.soundId === 'string' ? params.soundId : null;
    if (!soundId) return;
    void (async () => {
      try {
        const s = await fetchSoundById(soundId);
        if (s) setSound(s);
      } catch {
        // son introuvable : la caméra reste utilisable sans
      }
    })();
  }, [params.soundId, setSound]);

  // --- Un nouveau média (capture, photo, galerie) ouvre l'édition (S3).
  // Revenir de /create/edit ne repousse rien : le média n'a pas changé.
  const lastMediaRef = useRef(media);
  useEffect(() => {
    if (media && media !== lastMediaRef.current && isFocused) {
      router.push('/create/edit');
    }
    lastMediaRef.current = media;
  }, [media, isFocused, router]);

  // --- Compteur de durée. Purement visuel : la limite réelle est appliquée
  // nativement par maxDuration / maxFileSize passés à recordAsync.
  // S7 : le compteur affiche le total (segments précédents + segment en cours).
  // Pendant la finalisation (« processing »), barre et compteur gardent la
  // dernière valeur : pas de recul visible avant l'ajout du segment.
  useEffect(() => {
    if (phase !== 'recording') return;
    setSeconds(Math.floor(totalDurationMs(segmentsRef.current) / 1000));
    setCurrentMs(0);
    const id = setInterval(() => {
      const cur = Date.now() - startedAtRef.current;
      setCurrentMs(cur);
      setSeconds(Math.floor((totalDurationMs(segmentsRef.current) + cur) / 1000));
    }, 100);
    return () => clearInterval(id);
  }, [phase]);

  const stopRecording = useCallback(() => {
    clearStopTimers();
    try {
      cameraRef.current?.stopRecording();
    } catch {
      // pas d'enregistrement en cours : rien à arrêter
    }
  }, [clearStopTimers]);

  /**
   * Arrêt demandé par l'utilisateur (toucher, fin de maintien). Un segment de
   * moins de MIN_SEGMENT_MS n'est pas finalisé par la caméra : l'arrêt est
   * alors différé de ce qui manque.
   */
  const requestStop = useCallback(() => {
    const wait = stopDelayMs(Date.now() - startedAtRef.current);
    if (wait <= 0) {
      stopRecording();
      return;
    }
    if (delayedStopRef.current) return;
    delayedStopRef.current = setTimeout(() => {
      delayedStopRef.current = null;
      stopRecording();
    }, wait);
  }, [stopRecording]);

  // --- Arrêt propre quand l'application passe en arrière-plan.
  // Le fichier éventuel est jeté : l'utilisateur n'a pas choisi de le garder.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') return;
      if (phase === 'recording') {
        abandonRef.current = true;
        stopRecording();
      } else if (phase === 'countdown') {
        setPhase('idle');
      }
    });
    return () => sub.remove();
  }, [phase, stopRecording]);

  // --- Retour matériel Android : pendant l'enregistrement il arrête au lieu
  // de quitter l'écran en laissant une session native ouverte.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (assembling) return true;
      if (phase === 'recording') {
        if (segmentsRef.current.length > 0) {
          // Des segments existent : on garde celui-ci, puis on demande.
          askLeaveAfterStopRef.current = true;
          requestStop();
          return true;
        }
        abandonRef.current = true;
        leaveAfterAbandonRef.current = true;
        stopRecording();
        return true;
      }
      if (phase === 'countdown') {
        setPhase('idle');
        return true;
      }
      if (phase === 'processing') return true;
      // idle : le retour suit son cours ; avec des segments, la garde
      // ci-dessous demande confirmation.
      return false;
    });
    return () => sub.remove();
  }, [phase, assembling, stopRecording, requestStop]);

  // --- Perte de focus : arrêter tout enregistrement. Le démontage de
  // CameraView (conditionné par isFocused au rendu) libère la session native.
  useEffect(() => {
    if (isFocused) return;
    abandonRef.current = true;
    stopRecording();
    setPhase((p) => (p === 'countdown' ? 'idle' : p));
    setReady(false);
  }, [isFocused, stopRecording]);

  /**
   * Premier écran de la pile /create : revenir, c'est retrouver l'onglet d'où
   * l'on vient. Sans historique (lien profond), on retombe sur l'accueil.
   */
  const leave = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [router]);

  const close = useCallback(() => {
    if (assembling || phase === 'processing') return;
    if (phase === 'recording') {
      if (segmentsRef.current.length > 0) {
        askLeaveAfterStopRef.current = true;
        requestStop();
        return;
      }
      abandonRef.current = true;
      leaveAfterAbandonRef.current = true;
      stopRecording();
      return;
    }
    if (phase === 'countdown') setPhase('idle');
    leave();
  }, [phase, assembling, stopRecording, requestStop, leave]);

  /** Jette tous les segments (fichiers compris). */
  const discardSegments = useCallback(() => {
    for (const seg of segmentsRef.current) dropSegmentFile(seg.uri);
    const concat = lastConcatRef.current?.uri;
    if (concat) dropSegmentFile(concat);
    lastConcatRef.current = null;
    segmentsRef.current = [];
    setSegments([]);
  }, [dropSegmentFile]);

  // Quitter la caméra avec des segments (fermer, retour Android, geste iOS) :
  // « Abandonner les segments ? ». Après une publication, la garde est levée.
  usePreventRemove(hasSegments, ({ data }) => {
    if (isLeaveGuardReleased()) {
      navigation.dispatch(data.action);
      return;
    }
    Alert.alert(
      t('camera.discardSegmentsTitle'),
      t('camera.discardSegmentsBody', { count: String(segmentsRef.current.length) }),
      [
        { text: t('camera.discardSegmentsKeep'), style: 'cancel' },
        {
          text: t('camera.discardSegmentsConfirm'),
          style: 'destructive',
          onPress: () => {
            discardSegments();
            navigation.dispatch(data.action);
          },
        },
      ],
      { cancelable: true },
    );
  });

  /**
   * « Suivant » (S7) : assemble les segments en une vidéo et l'envoie à
   * l'édition. Un seul segment est utilisé tel quel. Si les segments n'ont
   * pas changé depuis le dernier assemblage (retour depuis l'édition), la
   * même vidéo est reprise sans perdre les réglages d'édition.
   */
  const finish = useCallback(
    async (list: Segment[]) => {
      if (list.length === 0 || assembling) return;
      const key = segmentsKey(list);
      const last = lastConcatRef.current;
      if (last && last.key === key && mediaUriRef.current === last.uri) {
        router.push('/create/edit');
        return;
      }
      let uri: string;
      let durationMs: number;
      const single = list.length === 1;
      if (single) {
        uri = list[0].uri;
        durationMs = list[0].durationMs;
      } else if (
        isComposerAvailable() &&
        new Set(list.map((sg) => sg.facing ?? 'back')).size > 1
      ) {
        // Les deux caméras : formats différents, collage sans ré-encodage
        // impossible. Un export (qualité haute) en fait une seule vidéo.
        setAssembling(true);
        const out = composerCachePath('nia-segments');
        const outcome = await composerRun((onProgress) =>
          runComposition(
            buildSegmentsComposition(
              list.map((sg) => ({ uri: sg.uri })),
              out,
            ),
            onProgress,
          ),
        );
        if (outcome.status !== 'done') {
          setAssembling(false);
          if (outcome.status === 'left') {
            Alert.alert(t('composer.leftTitle'), t('composer.leftBody'));
          } else if (outcome.status === 'failed') {
            Alert.alert(t('camera.concatFailedTitle'), t('camera.concatFailed'));
          }
          return;
        }
        uri = outcome.value.uri;
        durationMs = outcome.value.durationMs > 0 ? outcome.value.durationMs : totalDurationMs(list);
      } else {
        if (!isConcatAvailable()) {
          Alert.alert(t('common.error'), t('camera.concatUnavailable'));
          return;
        }
        setAssembling(true);
        try {
          const ext = Platform.OS === 'ios' ? 'mov' : 'mp4';
          const out = new File(Paths.cache, `nia-segments-${Date.now().toString(36)}.${ext}`);
          const res = await concatVideoFiles(
            list.map((sg) => fileUriToPath(sg.uri)),
            fileUriToPath(out.uri),
          );
          uri = res.uri;
          durationMs = res.durationMs > 0 ? res.durationMs : totalDurationMs(list);
        } catch {
          setAssembling(false);
          Alert.alert(t('camera.concatFailedTitle'), t('camera.concatFailed'));
          return;
        }
      }
      // Accepté : l'effet sur `media` pousse /create/edit. Refusé (taille,
      // durée) : l'alerte est déjà affichée, les segments restent.
      const accepted = applyCapturedVideo({ uri, durationMs });
      if (accepted) {
        // L'assemblage précédent (s'il n'est pas un segment) est remplacé.
        const previous = lastConcatRef.current?.uri;
        if (previous && previous !== uri && !list.some((sg) => sg.uri === previous)) {
          deleteCachedFile(previous);
        }
        lastConcatRef.current = { key, uri };
      } else if (!single) {
        deleteCachedFile(uri);
      }
      setAssembling(false);
    },
    [assembling, router, applyCapturedVideo, t, composerRun],
  );

  const record = useCallback(async () => {
    if (!cameraRef.current || !ready) {
      setPhase('idle');
      return;
    }
    const before = segmentsRef.current;
    if (isFull(before, maxMs)) {
      setPhase('idle');
      return;
    }
    // Éditeur P0 : la vidéo publiée est ré-encodée sous 50 Mo, la prise peut
    // donc dépasser ce plafond quand l'export natif existe.
    const limits = nextSegmentLimits(before, maxMs, maxVideoSourceBytes(isComposerAvailable()));
    abandonRef.current = false;
    leaveAfterAbandonRef.current = false;
    startedAtRef.current = Date.now();
    setPhase('recording');
    // Arrêt exact à la durée max ; la limite native (en secondes entières)
    // n'est qu'un filet.
    clearStopTimers();
    autoStopRef.current = setTimeout(() => {
      autoStopRef.current = null;
      try {
        cameraRef.current?.stopRecording();
      } catch {
        // déjà arrêté
      }
    }, limits.autoStopMs);
    let result: { uri: string } | undefined;
    try {
      // maxDuration et maxFileSize existent bien dans CameraRecordingOptions
      // de expo-camera 57 (maxDuration en secondes entières sur Android).
      result = await cameraRef.current.recordAsync({
        maxDuration: Math.min(limits.maxDurationSec, MAX_VIDEO_DURATION_SEC),
        maxFileSize: limits.maxFileSize,
      });
    } catch {
      clearStopTimers();
      holdRef.current = false;
      askLeaveAfterStopRef.current = false;
      setPhase('idle');
      Alert.alert(
        t('common.error'),
        before.length > 0 ? t('camera.segmentFailed') : t('camera.recordFailed'),
      );
      return;
    }
    clearStopTimers();
    holdRef.current = false;
    const measuredMs = Date.now() - startedAtRef.current;

    setPhase('processing');
    const uri = result?.uri;

    if (abandonRef.current || !uri) {
      if (uri) deleteCachedFile(uri);
      askLeaveAfterStopRef.current = false;
      setPhase('idle');
      // On ne referme que si l'abandon vient d'un geste explicite. Un abandon
      // provoqué par une perte de focus ou un passage en arrière-plan a déjà
      // quitté l'écran : dépiler à nouveau sortirait du parcours.
      if (leaveAfterAbandonRef.current) leave();
      return;
    }

    // Durée du fichier (plus juste que l'horloge), bornée au reste disponible.
    const fileMs = await videoFileDurationMs(uri);
    const durationMs = resolveSegmentDurationMs(
      measuredMs,
      fileMs,
      remainingMs(segmentsRef.current, maxMs),
    );
    const next = addSegment(
      segmentsRef.current,
      { id: makeSegmentId(), uri, durationMs, size: localFileSize(uri), facing: facingRef.current },
      maxMs,
    );
    if (next.length === segmentsRef.current.length) {
      // Segment vide : rien à garder.
      deleteCachedFile(uri);
    }
    segmentsRef.current = next;
    setSegments(next);
    setPhase('idle');

    if (askLeaveAfterStopRef.current) {
      askLeaveAfterStopRef.current = false;
      leave();
      return;
    }
    // Durée max atteinte : on passe à l'édition, comme une prise unique.
    if (isFull(next, maxMs)) void finish(next);
  }, [ready, maxMs, clearStopTimers, leave, finish, t]);

  /** « Supprimer le dernier segment ». */
  const undoLastSegment = useCallback(() => {
    if (busy) return;
    const { segments: rest, removed } = removeLastSegment(segmentsRef.current);
    if (!removed) return;
    dropSegmentFile(removed.uri);
    segmentsRef.current = rest;
    setSegments(rest);
  }, [busy, dropSegmentFile]);

  const confirmUndo = useCallback(() => {
    if (busy || !segmentsRef.current.length) return;
    Alert.alert(t('camera.undoSegmentTitle'), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('camera.undoSegmentConfirm'), style: 'destructive', onPress: undoLastSegment },
    ]);
  }, [busy, undoLastSegment, t]);

  const takePhoto = useCallback(async () => {
    if (!cameraRef.current || !ready) {
      setPhase('idle');
      return;
    }
    setPhase('processing');
    try {
      const pic = await cameraRef.current.takePictureAsync({ quality: 0.85 });
      if (!pic?.uri) throw new Error('no_uri');
      if (!applyCapturedPhoto({ uri: pic.uri })) deleteCachedFile(pic.uri);
    } catch {
      Alert.alert(t('common.error'), t('camera.photoFailed'));
    } finally {
      setPhase('idle');
    }
  }, [ready, applyCapturedPhoto, t]);

  const capture = useCallback(() => {
    if (isPhoto) void takePhoto();
    else void record();
  }, [isPhoto, takePhoto, record]);

  // --- Minuteur : compte à rebours visible, annulable d'un toucher.
  useEffect(() => {
    if (phase !== 'countdown') return;
    if (countdown <= 0) {
      capture();
      return;
    }
    const id = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [phase, countdown, capture]);

  const onShutter = useCallback(() => {
    if (phase === 'recording') {
      requestStop();
      return;
    }
    if (phase === 'countdown') {
      setPhase('idle');
      return;
    }
    if (phase !== 'idle' || !ready || assembling) return;
    if (!isPhoto && full) return;
    setFiltersOpen(false);
    if (timerSetting > 0) {
      setCountdown(timerSetting);
      setPhase('countdown');
      return;
    }
    capture();
  }, [phase, ready, assembling, isPhoto, full, timerSetting, requestStop, capture]);

  /** Maintien du déclencheur (vidéo, sans minuteur) : filmer tant qu'on tient. */
  const onShutterLongPress = useCallback(() => {
    if (isPhoto || timerSetting > 0 || phase !== 'idle') {
      onShutter();
      return;
    }
    if (!ready || assembling || full) return;
    holdRef.current = true;
    setFiltersOpen(false);
    void record();
  }, [isPhoto, timerSetting, phase, ready, assembling, full, onShutter, record]);

  const onShutterPressOut = useCallback(() => {
    if (!holdRef.current) return;
    holdRef.current = false;
    requestStop();
  }, [requestStop]);

  /**
   * Repli caméra système, déclenché uniquement si CameraView ne démarre pas.
   * Une seule tentative automatique : pas de boucle. Le repli emprunte
   * `captureMedia`, donc le pipeline `applyAsset` existant, inchangé.
   */
  const fallbackToSystemCamera = useCallback(async () => {
    setCameraFailed(true);
    if (fallbackDoneRef.current) return;
    fallbackDoneRef.current = true;
    Alert.alert(t('camera.mountErrorTitle'), t('camera.mountErrorBody'));
    try {
      await captureMedia();
    } catch {
      Alert.alert(t('common.error'), t('camera.recordFailed'));
    }
  }, [captureMedia, t]);

  const openGallery = useCallback(async () => {
    // Sélecteur système (Photo Picker Android) : aucune permission médias.
    await pickMedia();
  }, [pickMedia]);

  const switchMode = useCallback(
    (next: 'video' | 'photo') => {
      if (busy || next === mode) return;
      setReady(false);
      setMode(next);
    },
    [busy, mode, setMode],
  );

  const flipCamera = useCallback(() => {
    if (busy) return;
    // Sans export natif (iOS en P0), les segments sont assemblés sans
    // ré-encodage : ils doivent venir de la même caméra. Avec NiaComposer,
    // un mélange des deux caméras est ré-encodé à l'assemblage.
    if (segmentsRef.current.length > 0 && !isComposerAvailable()) {
      Alert.alert(t('camera.flipLockedTitle'), t('camera.flipLockedBody'));
      return;
    }
    setReady(false);
    setZoom(0);
    setFacing((f) => (f === 'back' ? 'front' : 'back'));
  }, [busy, t]);

  // --- Zoom au pincement : événements tactiles bruts, pas de dépendance.
  const onTouchMove = useCallback(
    (e: GestureResponderEvent) => {
      const touches = e.nativeEvent.touches;
      if (touches.length !== 2) {
        pinchRef.current = null;
        return;
      }
      const [a, b] = touches;
      const dist = Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
      if (!pinchRef.current) {
        pinchRef.current = { dist, zoom };
        return;
      }
      const delta = (dist - pinchRef.current.dist) / 400;
      const next = Math.max(0, Math.min(1, pinchRef.current.zoom + delta));
      setZoom(Math.round(next * 100) / 100);
    },
    [zoom],
  );
  const onTouchEnd = useCallback(() => {
    pinchRef.current = null;
  }, []);

  const overlay = useMemo(() => getFilterOverlayStyle(filter), [filter]);

  const flashIcon: React.ComponentProps<typeof Ionicons>['name'] = isPhoto
    ? photoFlash === 'off'
      ? 'flash-off-outline'
      : photoFlash === 'on'
        ? 'flash'
        : 'flash-outline'
    : torch
      ? 'flash'
      : 'flash-off-outline';
  const flashLabel = isPhoto
    ? photoFlash === 'off'
      ? t('camera.flashOff')
      : photoFlash === 'on'
        ? t('camera.flashOn')
        : t('camera.flashAuto')
    : torch
      ? t('camera.flashOn')
      : t('camera.flashOff');
  // Flash photo en caméra frontale : écran-flash (CameraX / Retina Flash).
  const cameraFlash: FlashMode =
    photoFlash === 'off' ? 'off' : facing === 'front' ? 'screen' : photoFlash;
  const torchUsable = facing === 'back';

  const chrome = colors.onMedia;
  const styles = useMemo(
    () =>
      StyleSheet.create({
        root: { flex: 1, backgroundColor: colors.noir },
        fill: { flex: 1 },
        centered: {
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: Spacing.xl,
          gap: Spacing.md,
        },
        gateTitle: {
          color: colors.sable,
          fontFamily: Fonts.bold,
          fontSize: 20,
          textAlign: 'center',
        },
        gateBody: {
          color: colors.textSecondary,
          fontFamily: Fonts.regular,
          fontSize: 14,
          lineHeight: 20,
          textAlign: 'center',
        },
        progressTrack: {
          position: 'absolute',
          left: Spacing.md,
          right: Spacing.md,
          height: 4,
          borderRadius: 2,
          backgroundColor: colors.mediaScrim,
          overflow: 'hidden',
        },
        progressFill: { height: '100%', backgroundColor: colors.or },
        progressRow: { flexDirection: 'row', height: '100%' },
        progressCurrent: { height: '100%', backgroundColor: colors.onMedia },
        progressSep: {
          position: 'absolute',
          top: 0,
          bottom: 0,
          width: 2,
          marginLeft: -1,
          backgroundColor: colors.noir,
        },
        segCtrl: {
          width: 44,
          height: 44,
          borderRadius: 22,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.mediaScrim,
        },
        segCtrlWrap: { width: 44, height: 44, alignItems: 'center', overflow: 'visible' },
        nextBtn: {
          width: 44,
          height: 44,
          borderRadius: 22,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.or,
        },
        assemblingWrap: {
          ...StyleSheet.absoluteFill,
          alignItems: 'center',
          justifyContent: 'center',
          gap: Spacing.sm,
          backgroundColor: colors.mediaScrimStrong,
        },
        assemblingText: { color: colors.onMedia, fontFamily: Fonts.medium, fontSize: 14 },
        topBar: {
          position: 'absolute',
          left: 0,
          right: 0,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: Spacing.md,
        },
        closeBtn: { position: 'absolute', left: Spacing.md },
        iconBtn: {
          width: 44,
          height: 44,
          borderRadius: 22,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.mediaScrim,
        },
        soundPill: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          maxWidth: '62%',
          paddingHorizontal: 14,
          paddingVertical: 8,
          borderRadius: Radii.pill,
          backgroundColor: colors.mediaScrimStrong,
        },
        soundPillText: { color: chrome, fontFamily: Fonts.medium, fontSize: 13 },
        side: {
          position: 'absolute',
          right: Spacing.sm,
          alignItems: 'center',
          gap: Spacing.md,
        },
        sideItem: { alignItems: 'center', width: 64 },
        sideLabel: {
          marginTop: 2,
          color: chrome,
          fontFamily: Fonts.medium,
          fontSize: 10,
          textAlign: 'center',
          ...MediaTextShadow,
        },
        bottom: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
        durationRow: { flexGrow: 0, marginBottom: Spacing.md },
        durationContent: { gap: 6, paddingHorizontal: Spacing.lg },
        durationChip: {
          paddingHorizontal: 12,
          paddingVertical: 6,
          borderRadius: Radii.pill,
        },
        durationChipOn: { backgroundColor: colors.mediaScrimStrong },
        durationText: {
          color: colors.onMediaMuted,
          fontFamily: Fonts.medium,
          fontSize: 13,
          ...MediaTextShadow,
        },
        durationTextOn: { color: chrome, fontFamily: Fonts.bold },
        shutterRow: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          alignSelf: 'stretch',
          paddingHorizontal: Spacing.xl,
        },
        galleryBtn: {
          width: 44,
          height: 44,
          borderRadius: Radii.sm,
          borderWidth: 2,
          borderColor: chrome,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.mediaScrim,
        },
        draftsBtnWrap: { width: 44, height: 44, alignItems: 'center', overflow: 'visible' },
        draftsCount: {
          position: 'absolute',
          top: -6,
          right: -8,
          minWidth: 20,
          height: 20,
          paddingHorizontal: 5,
          borderRadius: 10,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.or,
        },
        draftsCountText: { color: colors.noir, fontFamily: Fonts.bold, fontSize: 11 },
        draftsLabel: {
          position: 'absolute',
          top: 48,
          width: 80,
          textAlign: 'center',
          color: chrome,
          fontFamily: Fonts.medium,
          fontSize: 10,
          ...MediaTextShadow,
        },
        recordOuter: {
          width: 78,
          height: 78,
          borderRadius: 39,
          borderWidth: 5,
          borderColor: chrome,
          alignItems: 'center',
          justifyContent: 'center',
        },
        recordInner: {
          width: 60,
          height: 60,
          borderRadius: 30,
          backgroundColor: colors.or,
        },
        photoInner: {
          width: 60,
          height: 60,
          borderRadius: 30,
          backgroundColor: chrome,
        },
        recordInnerStop: {
          width: 30,
          height: 30,
          borderRadius: 6,
          backgroundColor: colors.danger,
        },
        modeTabs: {
          flexDirection: 'row',
          justifyContent: 'center',
          gap: Spacing.lg,
          marginTop: Spacing.md,
        },
        modeTab: { paddingVertical: 6, paddingHorizontal: 4, alignItems: 'center' },
        modeText: {
          color: colors.onMediaMuted,
          fontFamily: Fonts.medium,
          fontSize: 14,
          ...MediaTextShadow,
        },
        modeTextOn: { color: chrome, fontFamily: Fonts.bold },
        modeDot: {
          marginTop: 4,
          width: 5,
          height: 5,
          borderRadius: 3,
          backgroundColor: colors.or,
        },
        timerBadge: {
          position: 'absolute',
          left: 0,
          right: 0,
          alignItems: 'center',
        },
        timerText: {
          color: chrome,
          fontFamily: Fonts.bold,
          fontSize: 16,
          backgroundColor: colors.mediaScrimStrong,
          paddingHorizontal: 12,
          paddingVertical: 4,
          borderRadius: Radii.pill,
          overflow: 'hidden',
        },
        countdownWrap: {
          ...StyleSheet.absoluteFill,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'rgba(11,11,11,0.25)',
        },
        countdownText: {
          color: chrome,
          fontFamily: Fonts.bold,
          fontSize: 96,
          textShadowColor: 'rgba(0,0,0,0.6)',
          textShadowOffset: { width: 0, height: 2 },
          textShadowRadius: 6,
        },
        countdownHint: {
          color: chrome,
          fontFamily: Fonts.medium,
          fontSize: 13,
          ...MediaTextShadow,
          marginTop: Spacing.sm,
        },
        zoomBadge: {
          position: 'absolute',
          alignSelf: 'center',
          color: chrome,
          fontFamily: Fonts.bold,
          fontSize: 12,
          backgroundColor: colors.mediaScrimStrong,
          paddingHorizontal: 10,
          paddingVertical: 3,
          borderRadius: Radii.pill,
          overflow: 'hidden',
        },
        filtersPanel: {
          alignSelf: 'stretch',
          backgroundColor: colors.mediaScrimStrong,
          borderTopLeftRadius: Radii.lg,
          borderTopRightRadius: Radii.lg,
          paddingHorizontal: Spacing.md,
          paddingBottom: Spacing.sm,
          marginBottom: Spacing.md,
        },
        micWarn: {
          position: 'absolute',
          left: Spacing.lg,
          right: 80,
          backgroundColor: colors.mediaScrimStrong,
          borderRadius: Radii.md,
          paddingHorizontal: Spacing.md,
          paddingVertical: 8,
        },
        micWarnText: {
          color: colors.onMedia,
          fontFamily: Fonts.medium,
          fontSize: 12,
          textAlign: 'center',
        },
      }),
    [colors, chrome],
  );

  // --- Portail de permissions. Rien n'est demandé automatiquement au montage :
  // l'utilisateur déclenche la demande, ce qui évite une boîte système surgie
  // sans contexte.
  if (!camPermission) {
    return (
      <View style={styles.root}>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.or} />
        </View>
      </View>
    );
  }

  if (!camPermission.granted) {
    const canAsk = camPermission.canAskAgain;
    return (
      <View style={styles.root}>
        <View style={styles.centered}>
          <Ionicons name="videocam-off-outline" size={44} color={colors.textMuted} />
          <Text style={styles.gateTitle}>{t('camera.permissionTitle')}</Text>
          <Text style={styles.gateBody}>
            {canAsk ? t('camera.permissionBody') : t('camera.permissionDenied')}
          </Text>
          <Button
            title={canAsk ? t('camera.allow') : t('camera.openSettings')}
            variant="gold"
            onPress={() => {
              if (canAsk) void requestCamPermission();
              else void Linking.openSettings();
            }}
          />
          <Button
            title={t('camera.gallery')}
            variant="outline"
            onPress={() => void openGallery()}
          />
          <Button title={t('common.back')} variant="outline" onPress={leave} />
        </View>
      </View>
    );
  }

  const bottomBase = Math.max(insets.bottom, 16) + Spacing.sm;
  const sideDisabled = busy ? { opacity: 0.6 } : null;
  const segmentLive = phase === 'recording' || phase === 'processing';
  const bar = progressParts(segments, maxMs, segmentLive ? currentMs : 0);
  const shutterDisabled =
    phase === 'processing' ||
    assembling ||
    (!ready && phase === 'idle') ||
    (!isPhoto && full && phase === 'idle');

  return (
    <View style={styles.root}>
      {/* Monté seulement quand l'écran a le focus : une seule session caméra
          peut être active, et la laisser vivre hors focus la bloquerait pour
          le reste de l'application. */}
      {isFocused && !cameraFailed ? (
        <CameraView
          ref={cameraRef}
          style={styles.fill}
          facing={facing}
          mode={isPhoto ? 'picture' : 'video'}
          videoQuality={VIDEO_QUALITY}
          mute={!micGranted || playSoundWhileRecording}
          zoom={zoom}
          flash={isPhoto ? cameraFlash : 'off'}
          enableTorch={!isPhoto && torch && torchUsable}
          onCameraReady={() => setReady(true)}
          onMountError={() => void fallbackToSystemCamera()}
        />
      ) : cameraFailed ? (
        <View style={styles.centered}>
          <Ionicons name="videocam-off-outline" size={44} color={colors.textMuted} />
          <Text style={styles.gateTitle}>{t('camera.mountErrorTitle')}</Text>
          <Button
            title={isPhoto ? t('create.takePhoto') : t('create.film')}
            variant="gold"
            onPress={() => void captureMedia()}
          />
          <Button
            title={t('camera.gallery')}
            variant="outline"
            onPress={() => void openGallery()}
          />
        </View>
      ) : (
        <View style={styles.fill} />
      )}

      {/* Teinte d'aperçu du filtre NIA V2.6, comme à l'étape Habillage. */}
      {overlay && !cameraFailed ? (
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: overlay.backgroundColor, opacity: overlay.opacity },
          ]}
        />
      ) : null}

      {/* Surface de pincement (sous les contrôles, qui restent cliquables). */}
      {!cameraFailed ? (
        <View
          style={StyleSheet.absoluteFill}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onTouchCancel={onTouchEnd}
        />
      ) : null}

      {!isPhoto && (segmentLive || hasSegments) ? (
        <View
          style={[styles.progressTrack, { top: insets.top + 4 }]}
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel={t('camera.segmentsA11y', {
            count: String(segments.length),
            total: formatDuration(Math.floor(recordedMs / 1000)),
            max: formatDuration(maxSec),
          })}
        >
          <View style={styles.progressRow}>
            {bar.segments.map((frac, i) => (
              <View
                key={segments[i]?.id ?? i}
                style={[styles.progressFill, { width: `${frac * 100}%` }]}
              />
            ))}
            {segmentLive ? (
              <View style={[styles.progressCurrent, { width: `${bar.current * 100}%` }]} />
            ) : null}
          </View>
          {bar.separators.map((at, i) =>
            at > 0 && at < 1 ? (
              <View key={`sep-${i}`} style={[styles.progressSep, { left: `${at * 100}%` }]} />
            ) : null,
          )}
        </View>
      ) : null}

      <View style={[styles.topBar, { top: insets.top + Spacing.md }]}>
        <Pressable
          onPress={close}
          style={[styles.iconBtn, styles.closeBtn]}
          accessibilityRole="button"
          accessibilityLabel={t('camera.close')}
        >
          <Ionicons name="close" size={26} color={chrome} />
        </Pressable>
        <Pressable
          onPress={() => setSoundSheetOpen(true)}
          disabled={busy || hasSegments}
          style={[styles.soundPill, (busy || hasSegments) && { opacity: 0.6 }]}
          accessibilityRole="button"
          accessibilityLabel={t('create.pickSound')}
        >
          <Ionicons name="musical-notes" size={16} color={colors.or} />
          <Text style={styles.soundPillText} numberOfLines={1}>
            {sound ? sound.title : t('create.pickSound')}
          </Text>
        </Pressable>
      </View>

      <View style={[styles.side, { top: insets.top + 72 }]}>
        <SideButton
          icon="camera-reverse-outline"
          label={t('camera.flipShort')}
          a11y={t('camera.flip')}
          onPress={flipCamera}
          disabled={busy}
          dimmed={hasSegments}
          styles={styles}
          color={chrome}
        />
        <SideButton
          icon={flashIcon}
          label={t('camera.flash')}
          a11y={flashLabel}
          onPress={() => {
            if (isPhoto) setPhotoFlash((f) => NEXT_FLASH[f]);
            else setTorch((v) => !v);
          }}
          disabled={!isPhoto && !torchUsable}
          styles={styles}
          color={chrome}
        />
        <SideButton
          icon="timer-outline"
          label={timerSetting > 0 ? `${timerSetting} s` : t('camera.timer')}
          a11y={
            timerSetting === 0
              ? t('camera.timerOff')
              : timerSetting === 3
                ? t('camera.timer3')
                : t('camera.timer10')
          }
          onPress={() => setTimerSetting((v) => NEXT_TIMER[v])}
          disabled={busy}
          active={timerSetting > 0}
          styles={styles}
          color={chrome}
          activeColor={colors.or}
        />
        <SideButton
          icon="color-filter-outline"
          label={t('camera.filters')}
          a11y={t('camera.filters')}
          onPress={() => setFiltersOpen((v) => !v)}
          disabled={busy}
          active={filtersOpen || !!filter}
          styles={styles}
          color={chrome}
          activeColor={colors.or}
        />
        {sound && !isPhoto ? (
          <SideButton
            icon={hearSound ? 'headset' : 'headset-outline'}
            label={t('camera.hearSound')}
            a11y={hearSound ? t('camera.hearSoundOn') : t('camera.hearSoundOff')}
            onPress={() => setHearSound((v) => !v)}
            disabled={busy || hasSegments}
            active={hearSound}
            styles={styles}
            color={chrome}
            activeColor={colors.or}
          />
        ) : null}
      </View>

      {!micGranted && !isPhoto ? (
        <View style={[styles.micWarn, { top: insets.top + 72 }]}>
          <Text style={styles.micWarnText}>{t('camera.micDenied')}</Text>
          {micPermission?.canAskAgain ? (
            <Button
              title={t('camera.allowMic')}
              variant="outline"
              onPress={() => void requestMicPermission()}
              style={{ marginTop: 8 }}
            />
          ) : null}
        </View>
      ) : null}

      {zoom > 0.01 && phase !== 'countdown' ? (
        <Text style={[styles.zoomBadge, { bottom: bottomBase + 230 }]}>
          {`${(1 + zoom * 9).toFixed(1)}×`}
        </Text>
      ) : null}

      {!isPhoto && (segmentLive || hasSegments) ? (
        <View style={[styles.timerBadge, { bottom: bottomBase + 200 }]}>
          <Text style={styles.timerText}>
            {`${formatDuration(
              segmentLive ? seconds : Math.floor(recordedMs / 1000),
            )} / ${formatDuration(maxSec)}`}
          </Text>
        </View>
      ) : null}

      <View style={[styles.bottom, { bottom: bottomBase }]}>
        {filtersOpen && !busy ? (
          <View style={styles.filtersPanel}>
            <FilterCarousel
              compact
              selectedId={filter?.id ?? null}
              onSelect={(f) => setFilter(f)}
            />
          </View>
        ) : !busy && !hasSegments ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.durationRow}
            contentContainerStyle={styles.durationContent}
          >
            {DURATIONS.map((d) => {
              const on = !isPhoto && maxSec === d.sec;
              return (
                <Pressable
                  key={d.sec}
                  onPress={() => {
                    switchMode('video');
                    setMaxSec(d.sec);
                  }}
                  style={[styles.durationChip, on && styles.durationChipOn]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                >
                  <Text style={[styles.durationText, on && styles.durationTextOn]}>
                    {t(d.labelKey)}
                  </Text>
                </Pressable>
              );
            })}
            <Pressable
              onPress={() => switchMode('photo')}
              style={[styles.durationChip, isPhoto && styles.durationChipOn]}
              accessibilityRole="button"
              accessibilityState={{ selected: isPhoto }}
            >
              <Text style={[styles.durationText, isPhoto && styles.durationTextOn]}>
                {t('create.hubPhoto')}
              </Text>
            </Pressable>
          </ScrollView>
        ) : null}

        <View style={styles.shutterRow}>
          {hasSegments && !isPhoto ? (
            // S7 : « supprimer le dernier segment » remplace la galerie.
            <Pressable
              onPress={confirmUndo}
              disabled={busy}
              style={[styles.segCtrlWrap, sideDisabled]}
              accessibilityRole="button"
              accessibilityLabel={t('camera.undoSegment')}
            >
              <View style={styles.segCtrl}>
                <Ionicons name="backspace-outline" size={22} color={chrome} />
              </View>
              <Text style={styles.draftsLabel} numberOfLines={1}>
                {t('camera.undoSegmentShort')}
              </Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={() => void openGallery()}
              disabled={busy}
              style={[styles.galleryBtn, sideDisabled]}
              accessibilityRole="button"
              accessibilityLabel={t('camera.gallery')}
            >
              <Ionicons name="images-outline" size={22} color={chrome} />
            </Pressable>
          )}

          <Pressable
            onPress={onShutter}
            onLongPress={onShutterLongPress}
            delayLongPress={HOLD_DELAY_MS}
            onPressOut={onShutterPressOut}
            disabled={shutterDisabled}
            style={[styles.recordOuter, shutterDisabled && { opacity: 0.6 }]}
            accessibilityRole="button"
            accessibilityLabel={
              phase === 'recording'
                ? t('camera.stop')
                : isPhoto
                  ? t('create.takePhoto')
                  : hasSegments
                    ? t('camera.recordNextSegment')
                    : t('camera.record')
            }
            accessibilityHint={!isPhoto && phase === 'idle' ? t('camera.recordHint') : undefined}
          >
            {phase === 'processing' ? (
              <ActivityIndicator color={chrome} />
            ) : (
              <View
                style={
                  phase === 'recording'
                    ? styles.recordInnerStop
                    : isPhoto
                      ? styles.photoInner
                      : styles.recordInner
                }
              />
            )}
          </Pressable>

          {/* S7 : « Suivant » dès le premier segment ; sinon brouillons locaux
              (S6) ou symétrie avec le bouton galerie. */}
          {hasSegments && !isPhoto ? (
            <Pressable
              onPress={() => void finish(segmentsRef.current)}
              disabled={busy}
              style={[styles.segCtrlWrap, sideDisabled]}
              accessibilityRole="button"
              accessibilityLabel={t('camera.nextA11y')}
            >
              <View style={styles.nextBtn}>
                <Ionicons name="checkmark" size={26} color={colors.onAccent} />
              </View>
              <Text style={styles.draftsLabel} numberOfLines={1}>
                {t('camera.next')}
              </Text>
            </Pressable>
          ) : draftCount > 0 ? (
            <Pressable
              onPress={() => router.push('/create/drafts')}
              disabled={busy}
              style={[styles.draftsBtnWrap, sideDisabled]}
              accessibilityRole="button"
              accessibilityLabel={t('drafts.entryA11y', { count: String(draftCount) })}
            >
              <View style={styles.galleryBtn}>
                <Ionicons name="albums-outline" size={22} color={chrome} />
              </View>
              <View style={styles.draftsCount}>
                <Text style={styles.draftsCountText}>
                  {draftCount > 99 ? '99+' : String(draftCount)}
                </Text>
              </View>
              <Text style={styles.draftsLabel} numberOfLines={1}>
                {t('drafts.entry')}
              </Text>
            </Pressable>
          ) : (
            <View style={{ width: 44, height: 44 }} pointerEvents="none" />
          )}
        </View>

        {!busy && !hasSegments ? (
          <View style={styles.modeTabs}>
            <ModeTab
              label={t('create.hubLive')}
              on={false}
              onPress={() => router.replace('/live/go')}
              styles={styles}
            />
            <ModeTab
              label={t('create.hubVideo')}
              on={!isPhoto}
              onPress={() => switchMode('video')}
              styles={styles}
            />
            <ModeTab
              label={t('create.hubPhoto')}
              on={isPhoto}
              onPress={() => switchMode('photo')}
              styles={styles}
            />
          </View>
        ) : null}
      </View>

      {phase === 'countdown' ? (
        <Pressable
          style={styles.countdownWrap}
          onPress={() => setPhase('idle')}
          accessibilityRole="button"
          accessibilityLabel={t('camera.countdownCancel')}
        >
          <Text style={styles.countdownText}>{countdown}</Text>
          <Text style={styles.countdownHint}>{t('camera.countdownCancel')}</Text>
        </Pressable>
      ) : null}

      {/* Son joué pendant l'enregistrement, depuis le début choisi. Il s'arrête
          avec l'enregistrement, la perte de focus ou le passage en arrière-plan. */}
      {sound?.publicUrl ? (
        <SyncedSound
          url={sound.publicUrl}
          active={playSoundWhileRecording && phase === 'recording' && isFocused}
          offsetMs={segmentSoundOffsetMs}
          volume={soundVolume}
        />
      ) : null}

      <ComposerProgress
        visible={composer.running}
        progress={composer.progress}
        title={t('camera.assembling', { count: String(segments.length) })}
        onCancel={composer.cancel}
      />

      {assembling && !composer.running ? (
        <View style={styles.assemblingWrap} accessibilityLiveRegion="polite">
          <ActivityIndicator color={colors.or} size="large" />
          <Text style={styles.assemblingText}>
            {t('camera.assembling', { count: String(segments.length) })}
          </Text>
        </View>
      ) : null}

      <CameraSoundSheet
        visible={soundSheetOpen}
        selected={sound}
        onSelect={setSound}
        offsetMs={soundOffsetMs}
        onChangeOffset={setSoundOffsetMs}
        onClose={() => setSoundSheetOpen(false)}
      />
    </View>
  );
}

type CameraStyles = {
  sideItem: object;
  sideLabel: object;
  iconBtn: object;
  modeTab: object;
  modeText: object;
  modeTextOn: object;
  modeDot: object;
};

function SideButton({
  icon,
  label,
  a11y,
  onPress,
  disabled,
  dimmed,
  active,
  styles,
  color,
  activeColor,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  a11y: string;
  onPress: () => void;
  disabled?: boolean;
  /** Visible mais atténué : le toucher explique pourquoi c'est bloqué. */
  dimmed?: boolean;
  active?: boolean;
  styles: CameraStyles;
  color: string;
  activeColor?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.sideItem, (disabled || dimmed) && { opacity: 0.6 }]}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ disabled: !!disabled, selected: !!active }}
    >
      <View style={styles.iconBtn}>
        <Ionicons name={icon} size={24} color={active && activeColor ? activeColor : color} />
      </View>
      <Text style={styles.sideLabel} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function ModeTab({
  label,
  on,
  onPress,
  styles,
}: {
  label: string;
  on: boolean;
  onPress: () => void;
  styles: CameraStyles;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={styles.modeTab}
      accessibilityRole="tab"
      accessibilityState={{ selected: on }}
    >
      <Text style={[styles.modeText, on && styles.modeTextOn]}>{label}</Text>
      {on ? <View style={styles.modeDot} /> : <View style={{ height: 9 }} />}
    </Pressable>
  );
}
