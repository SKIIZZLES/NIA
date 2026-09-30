/**
 * Éditeur, phase P0 — calculs purs autour de l'export natif (NiaComposer).
 *
 * Tout ce qui se calcule sans module natif vit ici pour être testé :
 * - la composition envoyée au module (clip source + découpe, vitesse, son
 *   ajouté, volumes) ;
 * - la durée finale et la règle des 3 min ;
 * - le débit vidéo qui tient sous le plafond d'envoi (50 Mo) ;
 * - les calques recalés sur le fichier « cuit » (vitesse appliquée).
 *
 * Toutes les durées sont en millisecondes.
 */
import { MAX_UPLOAD_BYTES } from '@/constants/publish';
import { MIN_OVERLAY_SPAN_MS, sanitizeOverlayDoc, type OverlayDoc } from '@/lib/overlays';
import type { ComposerClip, Composition } from '@/modules/nia-composer';

/** Durée maximale d'une vidéo composée (décision du fondateur : 3 min). */
export const MAX_COMPOSED_DURATION_MS = 180_000;

/**
 * Plafond d'un fichier SOURCE quand l'export natif est disponible : la vidéo
 * publiée est ré-encodée sous MAX_UPLOAD_BYTES, la source peut donc être plus
 * lourde (3 min filmées en 720p dépassent souvent 50 Mo). Borne de sécurité
 * pour le stockage du téléphone.
 */
export const MAX_SOURCE_BYTES_WITH_COMPOSER = 600 * 1024 * 1024;

/** Sortie : petit côté 720 px, dans une boîte 720 × 1280 (9:16). */
export const OUTPUT_SHORT_SIDE = 720;
export const OUTPUT_MAX_WIDTH = 720;
export const OUTPUT_MAX_HEIGHT = 1280;
export const OUTPUT_FPS = 30;
export const AUDIO_BITRATE = 128_000;
/** 720p30 net ; au-delà, on grossit le fichier sans gain visible. */
export const MAX_VIDEO_BITRATE = 4_000_000;
export const MIN_VIDEO_BITRATE = 700_000;
/** Assemblage intermédiaire (segments de deux caméras) : qualité haute. */
export const INTERMEDIATE_VIDEO_BITRATE = 8_000_000;
/** Marge : l'encodeur matériel dépasse parfois le débit demandé. */
export const SIZE_SAFETY = 0.88;
/** Deuxième essai si le fichier dépasse malgré tout le plafond. */
export const RETRY_BITRATE_FACTOR = 0.75;

const finite = (v: unknown, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Débit vidéo (bit/s) pour qu'une vidéo de `durationMs` tienne sous
 * `maxBytes`, son AAC compris, avec la marge SIZE_SAFETY. Plafonné à
 * MAX_VIDEO_BITRATE, jamais sous MIN_VIDEO_BITRATE.
 */
export function videoBitrateFor(
  durationMs: number,
  maxBytes: number = MAX_UPLOAD_BYTES,
  factor = 1,
): number {
  const sec = Math.max(1, finite(durationMs, 0) / 1000);
  const budgetBitsPerSec = (maxBytes * 8 * SIZE_SAFETY) / sec - AUDIO_BITRATE;
  const f = finite(factor, 1) > 0 ? factor : 1;
  return Math.round(clamp(budgetBitsPerSec * f, MIN_VIDEO_BITRATE, MAX_VIDEO_BITRATE));
}

/** Taille attendue (octets) pour un débit et une durée : sert aux tests et aux logs. */
export function expectedBytes(durationMs: number, videoBitrate: number): number {
  return Math.round(((videoBitrate + AUDIO_BITRATE) * Math.max(0, durationMs)) / 1000 / 8);
}

/** Durée d'un clip sur la timeline finale (vitesse appliquée). */
export function clipOutputMs(clip: Pick<ComposerClip, 'startMs' | 'endMs' | 'speed'>, sourceDurationMs?: number | null): number | null {
  const end = clip.endMs ?? (sourceDurationMs != null && sourceDurationMs > 0 ? sourceDurationMs : null);
  if (end == null) return null;
  const speed = finite(clip.speed, 1) > 0 ? clip.speed : 1;
  return Math.max(0, Math.round((end - Math.max(0, clip.startMs)) / speed));
}

/** Durée finale : découpe puis vitesse. null si la durée source est inconnue. */
export function composedDurationMs(input: {
  sourceDurationMs: number | null;
  trim: { startMs: number; endMs: number } | null;
  speed: number;
}): number | null {
  const speed = finite(input.speed, 1) > 0 ? input.speed : 1;
  if (input.trim) return Math.round((input.trim.endMs - input.trim.startMs) / speed);
  if (input.sourceDurationMs == null || !(input.sourceDurationMs > 0)) return null;
  return Math.round(input.sourceDurationMs / speed);
}

/** Dépasse la limite des 3 min (tolérance 250 ms pour les arrondis de mesure). */
export function exceedsComposedMax(durationMs: number | null | undefined): boolean {
  return durationMs != null && durationMs > MAX_COMPOSED_DURATION_MS + 250;
}

export type PublishCompositionInput = {
  /** Fichier source de l'édition (capturé, assemblé ou importé). */
  sourceUri: string;
  sourceDurationMs: number | null;
  trim: { startMs: number; endMs: number } | null;
  speed: number;
  /** Son ajouté, déjà téléchargé en local ; null = aucun. */
  soundUri: string | null;
  soundOffsetMs: number;
  soundVolume: number;
  originalVolume: number;
  outputPath: string;
  /** 1 au premier essai, RETRY_BITRATE_FACTOR ensuite. */
  bitrateFactor?: number;
  /**
   * Éditeur V1 (montage) : clips de la timeline, dans l'ordre. Remplacent
   * alors le clip unique (sourceUri + trim + speed) ; le cadre de sortie est
   * fixe (720 × 1280) dès qu'il y a plusieurs clips ou une photo, et le volume
   * original s'applique même sans son ajouté.
   */
  clips?: ComposerClip[] | null;
};

/** Durée finale d'une liste de clips (null si l'une est inconnue). */
export function clipsDurationMs(clips: readonly ComposerClip[]): number | null {
  let sum = 0;
  for (const c of clips) {
    const d = clipOutputMs(c);
    if (d == null) return null;
    sum += d;
  }
  return sum;
}

/**
 * Composition de la vidéo publiée : un clip (source + découpe), la vitesse,
 * le son ajouté et les deux volumes. Mêmes règles que la lecture
 * (VideoCard / useSyncedSound) pour que le fichier ressemble à l'aperçu :
 * le son joue à vitesse normale depuis `soundOffsetMs`, et le volume
 * original ne s'applique qu'avec un son ajouté.
 */
export function buildPublishComposition(input: PublishCompositionInput): {
  composition: Composition;
  expectedDurationMs: number | null;
} {
  const speed = finite(input.speed, 1) > 0 ? input.speed : 1;
  const montage = !!input.clips && input.clips.length > 0;
  const clips: ComposerClip[] = montage
    ? (input.clips as ComposerClip[])
    : [
        {
          uri: input.sourceUri,
          startMs: input.trim ? Math.max(0, Math.round(input.trim.startMs)) : 0,
          endMs: input.trim ? Math.round(input.trim.endMs) : null,
          speed,
        },
      ];
  const expectedDurationMs = montage
    ? clipsDurationMs(clips)
    : composedDurationMs({
        sourceDurationMs: input.sourceDurationMs,
        trim: input.trim,
        speed,
      });
  const hasSound = !!input.soundUri;
  const composition: Composition = {
    clips,
    audio: hasSound
      ? {
          uri: input.soundUri as string,
          offsetMs: Math.max(0, Math.round(finite(input.soundOffsetMs, 0))),
          volume: clamp(finite(input.soundVolume, 1), 0, 1),
        }
      : null,
    // P0 : comme à la lecture, le volume original ne compte qu'avec un son
    // ajouté. V1 : le panneau de mixage le règle dans tous les cas.
    originalVolume:
      hasSound || montage ? clamp(finite(input.originalVolume, 1), 0, 1) : 1,
    output: {
      path: input.outputPath,
      shortSide: OUTPUT_SHORT_SIDE,
      maxWidth: OUTPUT_MAX_WIDTH,
      maxHeight: OUTPUT_MAX_HEIGHT,
      fps: OUTPUT_FPS,
      // Un seul clip vidéo garde son format (paysage compris, comme en P0).
      ...(montage && (clips.length > 1 || clips.some((c) => c.image)) ? { fixedCanvas: true } : {}),
      // Durée inconnue : on vise le pire cas (3 min).
      videoBitrate: videoBitrateFor(
        expectedDurationMs ?? MAX_COMPOSED_DURATION_MS,
        MAX_UPLOAD_BYTES,
        input.bitrateFactor ?? 1,
      ),
      audioBitrate: AUDIO_BITRATE,
    },
  };
  return { composition, expectedDurationMs };
}

/**
 * Assemblage de segments filmés avec les deux caméras (retournement entre
 * deux segments) : un simple collage sans ré-encodage n'est pas possible,
 * on ré-encode donc une fois en qualité haute. Le fichier obtenu devient la
 * source de l'édition ; l'export final le ramène sous 50 Mo.
 */
export function buildSegmentsComposition(
  segments: readonly { uri: string }[],
  outputPath: string,
): Composition {
  return {
    clips: segments.map((s) => ({ uri: s.uri, startMs: 0, endMs: null, speed: 1 })),
    audio: null,
    originalVolume: 1,
    output: {
      path: outputPath,
      shortSide: OUTPUT_SHORT_SIDE,
      maxWidth: OUTPUT_MAX_WIDTH,
      maxHeight: OUTPUT_MAX_HEIGHT,
      fps: OUTPUT_FPS,
      videoBitrate: INTERMEDIATE_VIDEO_BITRATE,
      audioBitrate: AUDIO_BITRATE,
    },
  };
}

/**
 * Calques recalés sur le fichier cuit : la vitesse est désormais dans le
 * fichier, donc un instant t de l'ancienne timeline (temps média) devient
 * t / vitesse. Les calques restent affichés à la lecture (P0) : seul leur
 * horaire change.
 */
export function overlaysForBakedSpeed(doc: OverlayDoc | null, speed: number): OverlayDoc | null {
  if (!doc || doc.items.length === 0) return doc;
  const s = finite(speed, 1) > 0 ? speed : 1;
  if (s === 1) return doc;
  const items = doc.items.map((o) => {
    const startMs = Math.round(o.startMs / s);
    let endMs = o.endMs == null ? null : Math.round(o.endMs / s);
    if (endMs != null && endMs < startMs + MIN_OVERLAY_SPAN_MS) endMs = startMs + MIN_OVERLAY_SPAN_MS;
    return { ...o, startMs, endMs };
  });
  return sanitizeOverlayDoc({ ...doc, items });
}

/** Chemin absolu (sans file://) d'un fichier de sortie dans le cache. */
export function composerOutputName(prefix: string, now: number = Date.now()): string {
  return `${prefix}-${now.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}.mp4`;
}

/** Plafond d'une vidéo source : relevé quand l'export natif la ramène sous 50 Mo. */
export function maxVideoSourceBytes(composerAvailable: boolean): number {
  return composerAvailable ? MAX_SOURCE_BYTES_WITH_COMPOSER : MAX_UPLOAD_BYTES;
}
