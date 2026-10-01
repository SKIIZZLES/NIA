/**
 * Masques visage (A1) — logique pure de l'écran caméra.
 *
 * Le masque est dessiné par le module natif `modules/nia-camera` sur chaque
 * image AVANT l'aperçu et l'encodeur : il est cuit dans le fichier, jamais
 * posé par-dessus à la lecture. Ici : choix de l'effet, blocage du
 * déclencheur tant qu'aucun visage n'est repéré, avis de première
 * utilisation (drapeau local, aucune donnée envoyée).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export type FaceEffectId = 'off' | 'blur' | 'pixelate' | 'skimask' | 'fullmask';

/**
 * Ordre du bouton « Masque » : désactivé → flou → pixels → cagoule → masque
 * intégral → désactivé. Aucun effet ne retouche le visage (ni éclaircissement
 * de la peau, ni déformation) : il est caché, jamais embelli.
 */
export const FACE_EFFECT_ORDER: readonly FaceEffectId[] = ['off', 'blur', 'pixelate', 'skimask', 'fullmask'];

/** Effets qui suivent les repères du visage (Face Landmarker). */
export function isLandmarkFaceEffect(effect: FaceEffectId): boolean {
  return effect === 'skimask' || effect === 'fullmask';
}

/** Valeur de la prop `effect` du module natif (null : caméra habituelle). */
export function nativeFaceEffect(effect: FaceEffectId): Exclude<FaceEffectId, 'off'> | null {
  return effect === 'off' ? null : effect;
}

export function nextFaceEffect(current: FaceEffectId): FaceEffectId {
  const i = FACE_EFFECT_ORDER.indexOf(current);
  return FACE_EFFECT_ORDER[(i + 1) % FACE_EFFECT_ORDER.length];
}

/** Clé i18n du libellé court sous le bouton. */
export function faceEffectShortLabelKey(effect: FaceEffectId): string {
  if (effect === 'blur') return 'camera.faceMaskShortBlur';
  if (effect === 'pixelate') return 'camera.faceMaskShortPixel';
  if (effect === 'skimask') return 'camera.faceMaskShortSki';
  if (effect === 'fullmask') return 'camera.faceMaskShortFull';
  return 'camera.faceMask';
}

/** Clé i18n du libellé d'accessibilité. */
export function faceEffectA11yKey(effect: FaceEffectId): string {
  if (effect === 'blur') return 'camera.faceMaskBlur';
  if (effect === 'pixelate') return 'camera.faceMaskPixel';
  if (effect === 'skimask') return 'camera.faceMaskSki';
  if (effect === 'fullmask') return 'camera.faceMaskFull';
  return 'camera.faceMaskOff';
}

/**
 * Déclencheur bloqué : masque actif et aucun visage repéré. Une fois
 * l'enregistrement lancé, le blocage ne s'applique plus : un visage perdu
 * floute alors toute l'image (côté natif), le bouton reste utilisable pour
 * arrêter.
 */
export function isFaceShutterBlocked(input: {
  maskActive: boolean;
  faceDetected: boolean;
  recording: boolean;
}): boolean {
  return input.maskActive && !input.recording && !input.faceDetected;
}

/**
 * Jalon 1 (test de faisabilité) : mesures affichées à l'écran pour le test
 * sur téléphone. À couper avant toute diffusion hors test.
 */
export const SHOW_FACE_METRICS = true;

export const FACE_NOTICE_KEY = 'nia.faceEffects.noticeAccepted.v1';

/** L'avis de première utilisation a déjà été accepté sur cet appareil. */
export async function hasAcceptedFaceNotice(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(FACE_NOTICE_KEY)) === '1';
  } catch {
    return false;
  }
}

export async function acceptFaceNotice(): Promise<void> {
  try {
    await AsyncStorage.setItem(FACE_NOTICE_KEY, '1');
  } catch {
    // l'avis sera simplement montré de nouveau
  }
}

type StatsLike = {
  renderFps: number;
  analysisFps: number;
  detectMsAvg: number;
  detectMsMax: number;
  latencyMsAvg: number;
  latencyMsMax: number;
  exact: number;
  neighbor: number;
  hold: number;
  live?: number;
  cover: number;
  syncOk: number;
  syncMissed: number;
  mode: string;
  analysisWidth?: number;
  analysisHeight?: number;
  analysisRotation?: number;
  rotationOffset?: number;
  lumaMean?: number;
  lumaRange?: number;
  rawDetections?: number;
  bestScore?: number;
  drawMsAvg?: number;
  drawMsMax?: number;
  glWaitMsAvg?: number;
  frameWidth?: number;
  frameHeight?: number;
  previewState?: string;
  previewViewSize?: string;
  sourceWidth?: number;
  sourceHeight?: number;
  prepMsAvg?: number;
  cameraToAnalysisMsAvg?: number;
  landmarkState?: string;
  landmarkMsAvg?: number;
  landmarkMsMax?: number;
  landmarkFrames?: number;
  fallbackFaces?: number;
  landmarkOnlyFaces?: number;
  landmarkFps?: number;
  landmarkTotalMsAvg?: number;
  landmarkSkipped?: number;
  landmarkDelegate?: string;
  landmarkRejected?: number;
  landmarkRoiAvg?: number;
  analysisAgeMsAvg?: number;
  landmarkAgeMsAvg?: number;
  maskFrames?: number;
  cameraPipelineMsAvg?: number;
  timestampSource?: string;
};

/** Valeur en ms arrondie, « — » si inconnue (négative). */
function ms(v: number | undefined): string {
  return v != null && v >= 0 ? `${Math.round(v)} ms` : '—';
}

const LANDMARK_STATE_LABEL: Record<string, string> = {
  loading: 'chargement',
  ready: 'prêts',
  error: 'en erreur',
};

/** En dessous : l'image donnée à MediaPipe est (presque) noire ou plate. */
export const DARK_FRAME_LUMA = 12;
export const FLAT_FRAME_RANGE = 6;

/** Image analysée noire ou uniforme (caméra muette, tampon vide…). */
export function isAnalysisFrameBlank(s: Pick<StatsLike, 'lumaMean' | 'lumaRange'>): boolean {
  if (s.lumaMean == null || s.lumaMean < 0) return false;
  return s.lumaMean < DARK_FRAME_LUMA || (s.lumaRange != null && s.lumaRange >= 0 && s.lumaRange < FLAT_FRAME_RANGE);
}

/** Lignes des mesures de test (valeurs techniques, non traduites). */
export function formatFaceStats(s: StatsLike): string[] {
  const latency =
    s.latencyMsAvg >= 0 ? `${Math.round(s.latencyMsAvg)} ms (max ${Math.round(s.latencyMsMax)})` : '—';
  const lines = [
    `image ${s.renderFps.toFixed(0)} i/s · analyse ${s.analysisFps.toFixed(0)} i/s`,
    `détection ${s.detectMsAvg.toFixed(0)} ms (max ${s.detectMsMax.toFixed(0)}) · latence ${latency}`,
    s.mode === 'live'
      ? `direct ${s.live ?? 0} · flou total ${s.cover}`
      : `exact ${s.exact} · voisin ${s.neighbor} · maintien ${s.hold} · flou total ${s.cover}`,
    s.mode === 'live'
      ? `synchro directe · âge analyse ${ms(s.analysisAgeMsAvg)} · âge repères ${ms(s.landmarkAgeMsAvg)}`
      : `synchro ${s.mode === 'exact' ? 'exacte' : s.mode} ${s.syncOk}/${s.syncOk + s.syncMissed}`,
  ];
  // Diagnostic (APK récents seulement).
  if (s.previewState != null) {
    const frame = s.frameWidth ? ` · cadre ${s.frameWidth}×${s.frameHeight}` : '';
    const view = s.previewViewSize ? ` · vue ${s.previewViewSize.replace('x', '×')}` : '';
    lines.push(`aperçu ${s.previewState === 'streaming' ? 'actif' : 'inactif'}${view}${frame}`);
  }
  if (s.analysisWidth) {
    const offset = s.rotationOffset ? ` (+${s.rotationOffset}° auto)` : '';
    const luma =
      s.lumaMean != null && s.lumaMean >= 0 ? ` · luminance ${s.lumaMean} (écart ${s.lumaRange ?? 0})` : '';
    lines.push(`analysé ${s.analysisWidth}×${s.analysisHeight} · rotation ${s.analysisRotation ?? 0}°${offset}${luma}`);
  }
  if (s.rawDetections != null) {
    lines.push(`visages bruts ${s.rawDetections} · meilleur score ${(s.bestScore ?? 0).toFixed(2)}`);
  }
  if (s.cameraToAnalysisMsAvg != null) {
    const cam = s.cameraToAnalysisMsAvg >= 0 ? `${Math.round(s.cameraToAnalysisMsAvg)} ms` : '—';
    const source = s.sourceWidth ? ` · source ${s.sourceWidth}×${s.sourceHeight}` : '';
    lines.push(`caméra→analyse ${cam} · préparation ${Math.round(s.prepMsAvg ?? 0)} ms${source}`);
  }
  if (s.cameraPipelineMsAvg != null) {
    lines.push(`capteur→résultat ${ms(s.cameraPipelineMsAvg)} · horloge ${s.timestampSource ?? '—'}`);
  }
  if (s.landmarkState != null && s.landmarkState !== 'off') {
    const label = LANDMARK_STATE_LABEL[s.landmarkState] ?? s.landmarkState;
    if (s.landmarkFps != null) {
      const delegate = s.landmarkDelegate && s.landmarkDelegate !== '—' ? ` (${s.landmarkDelegate})` : '';
      lines.push(
        `repères ${label}${delegate} · ${Math.round(s.landmarkMsAvg ?? 0)} ms (max ${Math.round(s.landmarkMsMax ?? 0)}) · ` +
          `${s.landmarkFps.toFixed(0)} i/s · sautées ${s.landmarkSkipped ?? 0}` +
          (s.landmarkRejected != null ? ` · rejetés ${s.landmarkRejected}` : '') +
          (s.landmarkRoiAvg ? ` · zone ${s.landmarkRoiAvg} px` : ''),
      );
      lines.push(
        `masques ${s.maskFrames ?? 0} images · repli ${s.fallbackFaces ?? 0} · ` +
          `préparation masque ${Math.round(s.landmarkTotalMsAvg ?? 0)} ms`,
      );
    } else {
      lines.push(
        `repères ${label} · ${Math.round(s.landmarkMsAvg ?? 0)} ms (max ${Math.round(s.landmarkMsMax ?? 0)}) · ` +
          `images ${s.landmarkFrames ?? 0} · repli ${s.fallbackFaces ?? 0} · seuls ${s.landmarkOnlyFaces ?? 0}`,
      );
    }
  }
  if (s.drawMsAvg != null) {
    const wait = s.glWaitMsAvg != null && s.glWaitMsAvg >= 0 ? ` · attente GL ${Math.round(s.glWaitMsAvg)} ms` : '';
    lines.push(`dessin ${Math.round(s.drawMsAvg)} ms (max ${Math.round(s.drawMsMax ?? 0)})${wait}`);
  }
  if (isAnalysisFrameBlank(s)) lines.push('alerte : image analysée noire ou uniforme');
  return lines;
}
