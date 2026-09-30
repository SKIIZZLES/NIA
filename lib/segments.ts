/**
 * Enregistrement multi-segments façon TikTok (sprint S7) — calculs purs.
 *
 * La caméra empile des segments (un appui ou un maintien = un segment) sous
 * une durée maximale choisie (15 s, 60 s, 3 min). Tout ce qui se calcule sans
 * module natif vit ici pour être testé : durée cumulée, reste, annulation du
 * dernier segment, coupure à la durée max, limites passées à recordAsync et
 * début du son pour chaque segment.
 *
 * Toutes les durées sont en millisecondes.
 */

export type Segment = {
  /** Identifiant local, stable pour les clés React et le cache de concaténation. */
  id: string;
  /** file:// du fichier produit par la caméra (cache de l'app). */
  uri: string;
  /** Durée retenue du segment (mesure du fichier si disponible). */
  durationMs: number;
  /** Taille en octets, si connue. */
  size: number | null;
  /** Caméra utilisée (éditeur P0 : deux caméras = assemblage ré-encodé). */
  facing?: 'back' | 'front';
};

/** En dessous, un segment est trop court pour être finalisé par la caméra. */
export const MIN_SEGMENT_MS = 500;

/**
 * Reste en deçà duquel l'enregistrement est considéré comme plein : démarrer
 * un segment de quelques dizaines de millisecondes n'aurait pas de sens.
 */
export const FULL_EPSILON_MS = 300;

/** Durée cumulée des segments. */
export function totalDurationMs(segments: readonly Segment[]): number {
  let sum = 0;
  for (const s of segments) {
    if (Number.isFinite(s.durationMs) && s.durationMs > 0) sum += s.durationMs;
  }
  return Math.round(sum);
}

/** Taille cumulée connue des segments, en octets. */
export function totalSizeBytes(segments: readonly Segment[]): number {
  let sum = 0;
  for (const s of segments) {
    if (s.size != null && Number.isFinite(s.size) && s.size > 0) sum += s.size;
  }
  return sum;
}

/** Temps encore disponible sous la durée max (jamais négatif). */
export function remainingMs(segments: readonly Segment[], maxMs: number): number {
  const max = Number.isFinite(maxMs) && maxMs > 0 ? maxMs : 0;
  return Math.max(0, Math.round(max - totalDurationMs(segments)));
}

/** La durée max est atteinte (à FULL_EPSILON_MS près). */
export function isFull(segments: readonly Segment[], maxMs: number): boolean {
  return remainingMs(segments, maxMs) <= FULL_EPSILON_MS;
}

/**
 * Retient la durée d'un segment : la mesure du fichier quand elle existe (plus
 * juste que l'horloge JS, qui inclut le démarrage de l'encodeur), sinon la
 * mesure horloge. Dans les deux cas, bornée au reste disponible : la caméra
 * peut dépasser de quelques centaines de millisecondes l'arrêt demandé.
 */
export function resolveSegmentDurationMs(
  measuredMs: number,
  fileMs: number | null | undefined,
  remaining: number,
): number {
  const pick =
    fileMs != null && Number.isFinite(fileMs) && fileMs > 0
      ? fileMs
      : Number.isFinite(measuredMs) && measuredMs > 0
        ? measuredMs
        : 0;
  const cap = Number.isFinite(remaining) && remaining > 0 ? remaining : 0;
  return Math.round(Math.min(pick, cap));
}

/**
 * Ajoute un segment. Un segment vide ou alors que l'enregistrement est déjà
 * plein est ignoré ; sa durée est bornée au reste disponible.
 */
export function addSegment(
  segments: readonly Segment[],
  segment: Segment,
  maxMs: number,
): Segment[] {
  const left = remainingMs(segments, maxMs);
  const durationMs = Math.round(Math.min(Math.max(0, segment.durationMs || 0), left));
  if (!segment.uri || durationMs <= 0) return [...segments];
  return [...segments, { ...segment, durationMs }];
}

/** Retire le dernier segment ; `removed` est à supprimer du disque. */
export function removeLastSegment(segments: readonly Segment[]): {
  segments: Segment[];
  removed: Segment | null;
} {
  if (segments.length === 0) return { segments: [], removed: null };
  return {
    segments: segments.slice(0, -1),
    removed: segments[segments.length - 1],
  };
}

/**
 * Limites à passer à recordAsync pour le prochain segment.
 * - `maxDurationSec` : entier (expo-camera Android attend un Int), arrondi
 *   au-dessus et au moins 1 s ; l'arrêt exact est fait par `autoStopMs`.
 * - `maxFileSize` : budget d'octets restant sous le plafond d'envoi.
 * - `autoStopMs` : délai après lequel l'écran arrête lui-même le segment.
 */
export function nextSegmentLimits(
  segments: readonly Segment[],
  maxMs: number,
  maxBytes: number,
): { maxDurationSec: number; maxFileSize: number; autoStopMs: number } {
  const left = remainingMs(segments, maxMs);
  const bytesLeft = Math.max(0, Math.floor(maxBytes - totalSizeBytes(segments)));
  return {
    maxDurationSec: Math.max(1, Math.ceil(left / 1000)),
    // 1 Mo minimum : 0 voudrait dire « sans limite » pour la caméra.
    maxFileSize: Math.max(1024 * 1024, bytesLeft),
    autoStopMs: left,
  };
}

/**
 * Début du son pour le segment suivant : le son reprend là où le segment
 * précédent l'a laissé, comme s'il n'y avait eu qu'une seule prise. Même
 * convention de boucle que soundTargetSec (modulo la durée du son).
 */
export function soundOffsetForSegment(
  baseOffsetMs: number,
  elapsedMs: number,
  soundDurationMs?: number | null,
): number {
  const base = Number.isFinite(baseOffsetMs) && baseOffsetMs > 0 ? baseOffsetMs : 0;
  const elapsed = Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs : 0;
  const raw = Math.round(base + elapsed);
  if (soundDurationMs == null || !Number.isFinite(soundDurationMs) || soundDurationMs <= 0) {
    return raw;
  }
  return raw % Math.round(soundDurationMs);
}

/**
 * Délai avant d'honorer une demande d'arrêt : un segment trop court n'est pas
 * finalisé par la caméra (fichier vide, erreur native).
 */
export function stopDelayMs(elapsedMs: number, minMs: number = MIN_SEGMENT_MS): number {
  const e = Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs : 0;
  return Math.max(0, Math.ceil(minMs - e));
}

/**
 * Découpage de la barre de progression : une part par segment (fraction de
 * la durée max), plus la part du segment en cours. Les séparateurs se placent
 * à la fin de chaque segment terminé.
 */
export function progressParts(
  segments: readonly Segment[],
  maxMs: number,
  currentMs = 0,
): { segments: number[]; current: number; separators: number[] } {
  const max = Number.isFinite(maxMs) && maxMs > 0 ? maxMs : 0;
  if (!max) return { segments: segments.map(() => 0), current: 0, separators: [] };
  const parts: number[] = [];
  const separators: number[] = [];
  let acc = 0;
  for (const s of segments) {
    const d = Math.max(0, Math.min(s.durationMs || 0, max - acc));
    acc += d;
    parts.push(d / max);
    separators.push(acc / max);
  }
  const cur = Math.max(0, Math.min(Number.isFinite(currentMs) ? currentMs : 0, max - acc));
  return { segments: parts, current: cur / max, separators };
}

/** Signature d'une liste de segments (réutiliser une concaténation déjà faite). */
export function segmentsKey(segments: readonly Segment[]): string {
  return segments.map((s) => s.id).join('|');
}

/** « /data/…/x.mp4 » pour « file:///data/…/x.mp4 » (chemins attendus par le toolkit). */
export function fileUriToPath(uri: string): string {
  if (!uri.startsWith('file://')) return uri;
  const path = uri.slice('file://'.length);
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}
