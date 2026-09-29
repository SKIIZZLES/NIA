/**
 * Découpe réelle d'un fichier vidéo (sprint S3).
 *
 * Android : Media3 Transformer en transmux (pas de ré-encodage) ; iOS :
 * AVAssetExportSession. Fournie par react-native-media-toolkit (Nitro).
 *
 * Le module natif est chargé à la demande : un environnement sans lui (Expo
 * Go, tests) reçoit une erreur `trim_unavailable` au lieu de planter à
 * l'import, et l'écran d'édition garde alors la vidéo entière.
 */

export type TrimResult = {
  uri: string;
  durationMs: number;
  size: number;
};

type Toolkit = {
  trimVideo: (
    uri: string,
    options: { startTime: number; endTime: number; outputPath?: string },
  ) => Promise<{ uri: string; duration: number; size: number }>;
};

let cached: Toolkit | null | undefined;

function loadToolkit(): Toolkit | null {
  if (cached !== undefined) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('react-native-media-toolkit') as { MediaToolkit: Toolkit };
    cached = mod.MediaToolkit ?? null;
  } catch {
    cached = null;
  }
  return cached;
}

export function isTrimAvailable(): boolean {
  return loadToolkit() != null;
}

/** Durée minimale d'un extrait, en millisecondes. */
export const MIN_TRIM_MS = 1000;

/** Normalise une sélection [début, fin] dans la durée du fichier. */
export function clampTrimRange(
  startMs: number,
  endMs: number,
  durationMs: number,
): { startMs: number; endMs: number } {
  const dur = Math.max(0, Math.round(durationMs));
  let s = Math.max(0, Math.min(Math.round(startMs), Math.max(0, dur - MIN_TRIM_MS)));
  let e = Math.max(0, Math.min(Math.round(endMs), dur));
  if (e - s < MIN_TRIM_MS) {
    e = Math.min(dur, s + MIN_TRIM_MS);
    s = Math.max(0, e - MIN_TRIM_MS);
  }
  return { startMs: s, endMs: e };
}

/** Vrai si la sélection couvre (à 100 ms près) toute la vidéo. */
export function isFullRange(startMs: number, endMs: number, durationMs: number): boolean {
  return startMs <= 100 && endMs >= durationMs - 100;
}

export async function trimVideoFile(
  uri: string,
  startMs: number,
  endMs: number,
): Promise<TrimResult> {
  const toolkit = loadToolkit();
  if (!toolkit) throw new Error('trim_unavailable');
  const res = await toolkit.trimVideo(uri, {
    startTime: Math.round(startMs),
    endTime: Math.round(endMs),
  });
  const out = res.uri.startsWith('file://') || res.uri.includes('://') ? res.uri : `file://${res.uri}`;
  return {
    uri: out,
    durationMs: Math.round(res.duration || endMs - startMs),
    size: res.size || 0,
  };
}
