/**
 * Calculs purs de synchro son ↔ vidéo (sprint S2), isolés pour être testés.
 *
 * Toutes les durées sont en secondes, sauf `offsetMs` (millisecondes, comme
 * dans le brouillon). Un son plus court que la vidéo boucle : la position
 * attendue est ramenée modulo la durée du son.
 */

/** Écart toléré avant de recaler le son (lecture native : ~quelques 100 ms). */
export const SOUND_DRIFT_TOLERANCE_SEC = 0.35;

/** Position attendue du son pour un temps vidéo donné. */
export function soundTargetSec(
  videoTimeSec: number,
  offsetMs: number,
  soundDurationSec: number,
): number {
  const video = Number.isFinite(videoTimeSec) && videoTimeSec > 0 ? videoTimeSec : 0;
  const offset = Number.isFinite(offsetMs) && offsetMs > 0 ? offsetMs / 1000 : 0;
  const raw = offset + video;
  if (!(soundDurationSec > 0) || !Number.isFinite(soundDurationSec)) return raw;
  return raw % soundDurationSec;
}

/**
 * Faut-il recaler le son ? Tient compte de la boucle : 0,1 s et 29,9 s sont
 * à 0,2 s l'un de l'autre sur un son de 30 s.
 */
export function needsResync(
  actualSec: number,
  expectedSec: number,
  soundDurationSec: number,
  toleranceSec: number = SOUND_DRIFT_TOLERANCE_SEC,
): boolean {
  if (!Number.isFinite(actualSec) || !Number.isFinite(expectedSec)) return true;
  let diff = Math.abs(actualSec - expectedSec);
  if (soundDurationSec > 0 && Number.isFinite(soundDurationSec)) {
    diff = Math.min(diff, Math.abs(soundDurationSec - diff));
  }
  return diff > toleranceSec;
}

/** Borne un début de son dans [0, durée − 1 s] (ou [0, ∞[ si durée inconnue). */
export function clampSoundOffsetMs(offsetMs: number, soundDurationMs?: number | null): number {
  const v = Number.isFinite(offsetMs) ? Math.round(offsetMs) : 0;
  const max =
    soundDurationMs != null && soundDurationMs > 0
      ? Math.max(0, soundDurationMs - 1000)
      : Number.POSITIVE_INFINITY;
  return Math.max(0, Math.min(max, v));
}

/** « 1:05 » pour 65 000 ms. */
export function formatSoundTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Niveaux proposés pour le son original de la vidéo. */
export const ORIGINAL_VOLUME_LEVELS = [1, 0.3, 0] as const;
export type OriginalVolumeLevel = (typeof ORIGINAL_VOLUME_LEVELS)[number];
