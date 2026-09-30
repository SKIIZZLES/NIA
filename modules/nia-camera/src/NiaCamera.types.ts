/**
 * Contrat JS ↔ natif de la caméra « visage masqué » (A1, jalon 1).
 */
import type { ViewProps } from 'react-native';

/** Effet cuit dans l'aperçu et dans le fichier. */
export type NiaFaceEffect = 'blur' | 'pixelate';

/**
 * `exact` : chaque image attend sa propre analyse (latence la plus faible,
 * images sans analyse sautées). `queue` : les images sortent de la file au
 * rythme de la caméra, masquées d'après les analyses voisines.
 */
export type NiaSyncMode = 'exact' | 'queue';

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
