/**
 * Contrat JS ↔ natif de la caméra « visage masqué » (A1, jalon 1).
 */
import type { ViewProps } from 'react-native';

/** Effet cuit dans l'aperçu et dans le fichier. */
/**
 * `skimask` (cagoule, yeux voilés) et `fullmask` (masque intégral) suivent
 * les repères MediaPipe Face Landmarker ; sans repères, le visage reste flouté.
 */
export type NiaFaceEffect = 'blur' | 'pixelate' | 'skimask' | 'fullmask';

/**
 * `live` (défaut) : chaque image caméra est dessinée dès son arrivée, avec
 * les dernières analyses prolongées par le mouvement (cadence de la caméra,
 * latence la plus faible). `exact` : chaque image attend sa propre analyse
 * (calage image par image, plus de latence). Changer de mode relie la caméra
 * (ignoré pendant un enregistrement, appliqué à la fin).
 */
export type NiaSyncMode = 'live' | 'exact';

export type NiaCameraStats = {
  renderFps: number;
  analysisFps: number;
  detectMsAvg: number;
  detectMsMax: number;
  analysisMsAvg: number;
  /** -1 si la base de temps de la caméra est inconnue. */
  latencyMsAvg: number;
  latencyMsMax: number;
  exact: number;
  neighbor: number;
  hold: number;
  /** Images dessinées en direct (synchro `live`). */
  live?: number;
  cover: number;
  /** % d'analyses avec au moins un visage. */
  faceRatio: number;
  syncOk: number;
  syncMissed: number;
  clock: string;
  mode: NiaSyncMode;
  effect: NiaFaceEffect;
  // --- Diagnostic du test sur téléphone (absents sur les anciens APK).
  /** Tampon donné à MediaPipe (avant rotation). */
  analysisWidth?: number;
  analysisHeight?: number;
  /** Rotation annoncée par CameraX (degrés, sens horaire). */
  analysisRotation?: number;
  /** Correction trouvée automatiquement (0 si CameraX a raison). */
  rotationOffset?: number;
  /** Luminance moyenne 0–255 de l'image analysée ; -1 si aucune analyse. */
  lumaMean?: number;
  /** Écart max − min de luminance (≈ 0 : image plate / noire). */
  lumaRange?: number;
  /** Détections MediaPipe tous scores (≥ 0,3) sur la seconde. */
  rawDetections?: number;
  /** Meilleur score MediaPipe de la seconde (0–1). */
  bestScore?: number;
  /** Temps de dessin du masque sur le fil GL (ms). */
  drawMsAvg?: number;
  drawMsMax?: number;
  /** Anciens APK (avant jalon 2b) : calques non redessinés. */
  redrawSkipped?: number;
  /** Fin d'analyse → image dessinée (ms) ; -1 si inconnu. */
  glWaitMsAvg?: number;
  /** Image caméra reçue par l'effet (px). */
  frameWidth?: number;
  frameHeight?: number;
  frameRotation?: number;
  /** Flux de PreviewView : 'streaming' quand l'aperçu reçoit des images. */
  previewState?: string;
  /** Taille posée de la vue d'aperçu, « LxH ». */
  previewViewSize?: string;
  /** Tampon reçu de CameraX, avant réduction à ≤ 640 px. */
  sourceWidth?: number;
  sourceHeight?: number;
  /** Copie + réduction + redressement avant MediaPipe (ms). */
  prepMsAvg?: number;
  /** Capture → début d'analyse (ms) ; -1 si inconnu. */
  cameraToAnalysisMsAvg?: number;
  // --- Repères Face Landmarker (jalon 2).
  /** 'off' | 'loading' | 'ready' | 'error'. */
  landmarkState?: string;
  landmarkMsAvg?: number;
  landmarkMsMax?: number;
  /** Analyses de la seconde avec au moins un visage à repères. */
  landmarkFrames?: number;
  /** Visages du détecteur sans repères (flou de repli). */
  fallbackFaces?: number;
  /** Anciens APK : visages vus par les repères seuls. */
  landmarkOnlyFaces?: number;
  // --- Jalon 2b : rendu découplé de l'analyse.
  /** Passages de Face Landmarker par seconde (son propre fil). */
  landmarkFps?: number;
  /** Inférence + géométrie + pré-rendu du masque (ms). */
  landmarkTotalMsAvg?: number;
  /** Images passées sans repères (fil des repères occupé). */
  landmarkSkipped?: number;
  /** 'GPU' | 'CPU' | '—'. */
  landmarkDelegate?: string;
  /** Maillages écartés (incohérents avec BlazeFace : inclinaison, forme, taille). */
  landmarkRejected?: number;
  /** Côté moyen du recadrage donné à Face Landmarker (px). */
  landmarkRoiAvg?: number;
  /** Âge de l'analyse posée sur l'image au moment du dessin (ms) ; -1 si inconnu. */
  analysisAgeMsAvg?: number;
  /** Âge des repères du masque au moment du dessin (ms) ; -1 sans masque. */
  landmarkAgeMsAvg?: number;
  /** Images de la seconde avec au moins un masque à repères. */
  maskFrames?: number;
  /** Capteur → résultat de capture Camera2 (HAL / ISP, ms) ; -1 si inconnu. */
  cameraPipelineMsAvg?: number;
  /** SENSOR_INFO_TIMESTAMP_SOURCE : 'realtime' | 'unknown' | '—'. */
  timestampSource?: string;
};

export type NiaCameraError = { code: 'ERR_CAMERA' | 'ERR_DETECTOR' | string; message: string };

export type NiaRecordOptions = {
  /** Secondes. */
  maxDuration?: number;
  /** Octets. */
  maxFileSize?: number;
};

export type NiaCameraProps = ViewProps & {
  facing: 'back' | 'front';
  effect: NiaFaceEffect;
  syncMode?: NiaSyncMode;
  /** 0 → 1, comme expo-camera. */
  zoom?: number;
  enableTorch?: boolean;
  mute?: boolean;
  onCameraReady?: () => void;
  onMountError?: (error: NiaCameraError) => void;
  /** Visage détecté (avec hystérésis) : débloque le déclencheur. */
  onFaceChange?: (detected: boolean) => void;
  /** Mesures, une fois par seconde. */
  onStats?: (stats: NiaCameraStats) => void;
};

/** Même forme que la partie vidéo de `CameraView` (expo-camera). */
export type NiaCameraHandle = {
  recordAsync(options?: NiaRecordOptions): Promise<{ uri: string } | undefined>;
  stopRecording(): void;
};
