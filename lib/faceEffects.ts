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

export type FaceEffectId = 'off' | 'blur' | 'pixelate';

/** Ordre du bouton « Masque » : désactivé → flou → pixels → désactivé. */
export const FACE_EFFECT_ORDER: readonly FaceEffectId[] = ['off', 'blur', 'pixelate'];

export function nextFaceEffect(current: FaceEffectId): FaceEffectId {
  const i = FACE_EFFECT_ORDER.indexOf(current);
  return FACE_EFFECT_ORDER[(i + 1) % FACE_EFFECT_ORDER.length];
}

/** Clé i18n du libellé court sous le bouton. */
export function faceEffectShortLabelKey(effect: FaceEffectId): string {
  if (effect === 'blur') return 'camera.faceMaskShortBlur';
  if (effect === 'pixelate') return 'camera.faceMaskShortPixel';
  return 'camera.faceMask';
}

/** Clé i18n du libellé d'accessibilité. */
export function faceEffectA11yKey(effect: FaceEffectId): string {
  if (effect === 'blur') return 'camera.faceMaskBlur';
  if (effect === 'pixelate') return 'camera.faceMaskPixel';
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
  cover: number;
  syncOk: number;
  syncMissed: number;
  mode: string;
};

/** Lignes des mesures de test (valeurs techniques, non traduites). */
export function formatFaceStats(s: StatsLike): string[] {
  const latency =
    s.latencyMsAvg >= 0 ? `${Math.round(s.latencyMsAvg)} ms (max ${Math.round(s.latencyMsMax)})` : '—';
  return [
    `image ${s.renderFps.toFixed(0)} i/s · analyse ${s.analysisFps.toFixed(0)} i/s`,
    `détection ${s.detectMsAvg.toFixed(0)} ms (max ${s.detectMsMax.toFixed(0)}) · latence ${latency}`,
    `exact ${s.exact} · voisin ${s.neighbor} · maintien ${s.hold} · flou total ${s.cover}`,
    `synchro ${s.mode} ${s.syncOk}/${s.syncOk + s.syncMissed}`,
  ];
}
