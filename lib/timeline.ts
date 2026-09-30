/**
 * Éditeur V1 (Montage) — modèle de la timeline multi-clips, calculs purs.
 *
 * Une timeline est une liste ordonnée de clips :
 * - clip vidéo : un fichier, un extrait [startMs, endMs[ de ce fichier et une
 *   vitesse (0,3x → 2x) ;
 * - clip photo : une image fixe affichée `endMs - startMs` ms (3 s par
 *   défaut), sans vitesse.
 *
 * Les clips issus d'un découpage (« Couper ») partagent le même fichier : rien
 * n'est recopié ni ré-encodé avant l'export final (NiaComposer).
 *
 * Temps : `startMs` / `endMs` sont dans le fichier source (temps média) ; la
 * « timeline » (lecture, tête de lecture, calques) est en temps de sortie,
 * vitesse appliquée : durée d'un clip = (fin − début) / vitesse.
 *
 * Toutes les fonctions sont pures et renvoient une nouvelle liste (jamais de
 * mutation) : l'écran les applique telles quelles au CreateContext.
 */
import { exceedsComposedMax } from '@/lib/composition';
import type { ComposerClip } from '@/modules/nia-composer';

/** Vitesses proposées par clip (décision du plan V1). */
export const CLIP_SPEEDS = [0.3, 0.5, 1, 1.5, 2] as const;
export type ClipSpeed = (typeof CLIP_SPEEDS)[number];

/** Durée d'une photo importée. */
export const STILL_CLIP_MS = 3000;
/** Durées proposées pour une photo. */
export const STILL_DURATIONS_MS = [1000, 2000, 3000, 5000, 8000] as const;
export const MIN_STILL_MS = 500;
export const MAX_STILL_MS = 10_000;
/** Extrait minimal d'un clip vidéo (temps média). */
export const MIN_CLIP_MS = 500;
/** Nombre maximal de clips (le module natif en accepte 100). */
export const MAX_TIMELINE_CLIPS = 30;

export type ClipKind = 'video' | 'image';

export type TimelineClip = {
  /** Identifiant local, stable (clés React, sélection). */
  id: string;
  kind: ClipKind;
  /** file:// du fichier (cache ou dossier du brouillon). */
  uri: string;
  mimeType: string | null;
  fileName: string | null;
  fileSize: number | null;
  /** Vidéo : durée du fichier. Photo : MAX_STILL_MS (borne des poignées). */
  sourceDurationMs: number;
  startMs: number;
  endMs: number;
  /** Toujours 1 pour une photo. */
  speed: number;
};

export type Timeline = readonly TimelineClip[];

/** Média ajouté à la timeline (galerie, caméra, brouillon). */
export type ClipSourceMedia = {
  uri: string;
  mimeType?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
  /** Durée du fichier vidéo ; ignorée pour une photo. */
  durationMs?: number | null;
};

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

let idSeq = 0;
export function makeClipId(): string {
  idSeq = (idSeq + 1) % 1_000_000;
  return `c${Date.now().toString(36)}${idSeq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Vitesse autorisée la plus proche (1 pour une valeur absurde). */
export function normalizeClipSpeed(v: unknown): ClipSpeed {
  if (!finite(v) || v <= 0) return 1;
  let best: ClipSpeed = 1;
  for (const s of CLIP_SPEEDS) if (Math.abs(s - v) < Math.abs(best - v)) best = s;
  return best;
}

/** Clip vidéo couvrant tout le fichier ; null si la durée est inconnue ou trop courte. */
export function makeVideoClip(media: ClipSourceMedia, id: string = makeClipId()): TimelineClip | null {
  const d = finite(media.durationMs) ? Math.round(media.durationMs) : 0;
  if (!media.uri || d < MIN_CLIP_MS) return null;
  return {
    id,
    kind: 'video',
    uri: media.uri,
    mimeType: media.mimeType ?? null,
    fileName: media.fileName ?? null,
    fileSize: media.fileSize ?? null,
    sourceDurationMs: d,
    startMs: 0,
    endMs: d,
    speed: 1,
  };
}

/** Photo affichée STILL_CLIP_MS. */
export function makeImageClip(media: ClipSourceMedia, id: string = makeClipId()): TimelineClip | null {
  if (!media.uri) return null;
  return {
    id,
    kind: 'image',
    uri: media.uri,
    mimeType: media.mimeType ?? null,
    fileName: media.fileName ?? null,
    fileSize: media.fileSize ?? null,
    sourceDurationMs: MAX_STILL_MS,
    startMs: 0,
    endMs: STILL_CLIP_MS,
    speed: 1,
  };
}

/** Durée d'un clip sur la timeline (vitesse appliquée), en ms. */
export function clipDurationMs(clip: TimelineClip): number {
  const span = Math.max(0, clip.endMs - clip.startMs);
  if (clip.kind === 'image') return Math.round(span);
  const speed = clip.speed > 0 ? clip.speed : 1;
  return Math.round(span / speed);
}

export function timelineDurationMs(tl: Timeline): number {
  let sum = 0;
  for (const c of tl) sum += clipDurationMs(c);
  return sum;
}

/** Début de chaque clip sur la timeline. */
export function clipStartsMs(tl: Timeline): number[] {
  const out: number[] = [];
  let acc = 0;
  for (const c of tl) {
    out.push(acc);
    acc += clipDurationMs(c);
  }
  return out;
}

export type TimelinePosition = {
  index: number;
  clip: TimelineClip;
  /** Début du clip sur la timeline. */
  clipStartMs: number;
  /** Instant dans le clip (temps de sortie). */
  offsetMs: number;
  /** Instant correspondant dans le fichier source (temps média). */
  sourceMs: number;
};

/**
 * Clip sous l'instant `timeMs` de la timeline. Une frontière appartient au
 * clip qui commence ; au-delà de la fin, le dernier clip (à sa fin).
 */
export function locate(tl: Timeline, timeMs: number): TimelinePosition | null {
  if (tl.length === 0) return null;
  const t = Math.max(0, finite(timeMs) ? timeMs : 0);
  let acc = 0;
  for (let i = 0; i < tl.length; i++) {
    const clip = tl[i];
    const d = clipDurationMs(clip);
    if (t < acc + d || i === tl.length - 1) {
      const offsetMs = clamp(t - acc, 0, d);
      return { index: i, clip, clipStartMs: acc, offsetMs, sourceMs: sourceMsAt(clip, offsetMs) };
    }
    acc += d;
  }
  return null;
}

/** Instant du fichier source pour un instant (temps de sortie) dans le clip. */
export function sourceMsAt(clip: TimelineClip, offsetMs: number): number {
  const speed = clip.kind === 'image' ? 1 : clip.speed > 0 ? clip.speed : 1;
  return Math.round(clamp(clip.startMs + offsetMs * speed, clip.startMs, clip.endMs));
}

/** Instant de la timeline correspondant au début du clip `index`. */
export function clipStartAt(tl: Timeline, index: number): number {
  return clipStartsMs(tl)[index] ?? 0;
}

// ---------------------------------------------------------------------------
// Opérations

/**
 * Coupe le clip sous `timeMs` en deux. Refusé (liste inchangée) si l'un des
 * morceaux ferait moins que le minimum ou si la timeline est pleine.
 * Le premier morceau garde l'identifiant ; le second en reçoit un nouveau.
 */
export function splitAt(
  tl: Timeline,
  timeMs: number,
  newId: string = makeClipId(),
): { timeline: Timeline; splitIndex: number | null } {
  const pos = locate(tl, timeMs);
  if (!pos || tl.length >= MAX_TIMELINE_CLIPS) return { timeline: tl, splitIndex: null };
  const { clip, index, sourceMs } = pos;
  const min = clip.kind === 'image' ? MIN_STILL_MS : MIN_CLIP_MS;
  if (clip.kind === 'image') {
    const at = Math.round(pos.offsetMs);
    const total = clip.endMs - clip.startMs;
    if (at < min || total - at < min) return { timeline: tl, splitIndex: null };
    const a: TimelineClip = { ...clip, startMs: 0, endMs: at };
    const b: TimelineClip = { ...clip, id: newId, startMs: 0, endMs: total - at };
    return { timeline: [...tl.slice(0, index), a, b, ...tl.slice(index + 1)], splitIndex: index };
  }
  if (sourceMs - clip.startMs < min || clip.endMs - sourceMs < min) {
    return { timeline: tl, splitIndex: null };
  }
  const a: TimelineClip = { ...clip, endMs: sourceMs };
  const b: TimelineClip = { ...clip, id: newId, startMs: sourceMs };
  return { timeline: [...tl.slice(0, index), a, b, ...tl.slice(index + 1)], splitIndex: index };
}

/** Nouvelle découpe d'un clip, bornée au fichier et à l'extrait minimal. */
export function trimClip(tl: Timeline, id: string, startMs: number, endMs: number): Timeline {
  const i = tl.findIndex((c) => c.id === id);
  if (i < 0) return tl;
  const c = tl[i];
  let next: TimelineClip;
  if (c.kind === 'image') {
    const d = clamp(Math.round((finite(endMs) ? endMs : c.endMs) - (finite(startMs) ? startMs : 0)), MIN_STILL_MS, MAX_STILL_MS);
    next = { ...c, startMs: 0, endMs: d };
  } else {
    const dur = c.sourceDurationMs;
    const min = Math.min(MIN_CLIP_MS, dur);
    let s = clamp(Math.round(finite(startMs) ? startMs : c.startMs), 0, Math.max(0, dur - min));
    let e = clamp(Math.round(finite(endMs) ? endMs : c.endMs), 0, dur);
    if (e - s < min) {
      e = Math.min(dur, s + min);
      s = Math.max(0, e - min);
    }
    next = { ...c, startMs: s, endMs: e };
  }
  if (next.startMs === c.startMs && next.endMs === c.endMs) return tl;
  const out = tl.slice();
  out[i] = next;
  return out;
}

/** Durée d'affichage d'une photo. */
export function setStillDuration(tl: Timeline, id: string, durationMs: number): Timeline {
  const c = tl.find((x) => x.id === id);
  if (!c || c.kind !== 'image') return tl;
  return trimClip(tl, id, 0, durationMs);
}

/** Déplace le clip `from` à la position `to` (indices bornés). */
export function moveClip(tl: Timeline, from: number, to: number): Timeline {
  if (from < 0 || from >= tl.length) return tl;
  const target = clamp(Math.round(to), 0, tl.length - 1);
  if (target === from) return tl;
  const out = tl.slice();
  const [c] = out.splice(from, 1);
  out.splice(target, 0, c);
  return out;
}

/** Retire un clip. Le dernier clip ne peut pas être retiré. */
export function removeClip(tl: Timeline, id: string): Timeline {
  if (tl.length <= 1) return tl;
  const out = tl.filter((c) => c.id !== id);
  return out.length === tl.length ? tl : out;
}

/** Duplique un clip juste après lui (même fichier, mêmes réglages). */
export function duplicateClip(tl: Timeline, id: string, newId: string = makeClipId()): Timeline {
  if (tl.length >= MAX_TIMELINE_CLIPS) return tl;
  const i = tl.findIndex((c) => c.id === id);
  if (i < 0) return tl;
  return [...tl.slice(0, i + 1), { ...tl[i], id: newId }, ...tl.slice(i + 1)];
}

/** Vitesse d'un clip vidéo (une photo reste à 1x). */
export function setClipSpeed(tl: Timeline, id: string, speed: number): Timeline {
  const i = tl.findIndex((c) => c.id === id);
  if (i < 0 || tl[i].kind === 'image') return tl;
  const s = normalizeClipSpeed(speed);
  if (tl[i].speed === s) return tl;
  const out = tl.slice();
  out[i] = { ...tl[i], speed: s };
  return out;
}

/** Ajoute des clips à la fin, dans la limite de MAX_TIMELINE_CLIPS. */
export function appendClips(tl: Timeline, clips: readonly TimelineClip[]): Timeline {
  const room = Math.max(0, MAX_TIMELINE_CLIPS - tl.length);
  if (room === 0 || clips.length === 0) return tl;
  return [...tl, ...clips.slice(0, room)];
}

/**
 * Durée réelle d'un fichier connue après coup (la mesure de la caméra est
 * approximative) : les clips de ce fichier sont bornés à cette durée.
 */
export function applySourceDuration(tl: Timeline, uri: string, durationMs: number): Timeline {
  if (!finite(durationMs) || durationMs < MIN_CLIP_MS) return tl;
  const d = Math.round(durationMs);
  let changed = false;
  const out = tl.map((c) => {
    if (c.kind !== 'video' || c.uri !== uri || c.sourceDurationMs === d) return c;
    changed = true;
    const wasFull = c.endMs >= c.sourceDurationMs - 1;
    let e = wasFull ? d : Math.min(c.endMs, d);
    let s = Math.min(c.startMs, Math.max(0, d - MIN_CLIP_MS));
    if (e - s < MIN_CLIP_MS) {
      e = Math.min(d, s + MIN_CLIP_MS);
      s = Math.max(0, e - MIN_CLIP_MS);
    }
    return { ...c, sourceDurationMs: d, startMs: s, endMs: e };
  });
  return changed ? out : tl;
}

/** Dépasse la limite des 3 min de la vidéo composée. */
export function timelineExceedsMax(tl: Timeline): boolean {
  return exceedsComposedMax(timelineDurationMs(tl));
}

/** Contient au moins une vidéo (sinon : diaporama de photos). */
export function hasVideoClip(tl: Timeline): boolean {
  return tl.some((c) => c.kind === 'video');
}

// ---------------------------------------------------------------------------
// Export, brouillons, clés

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
};

/** Type MIME d'une photo : celui connu, sinon déduit de l'extension. */
export function imageMimeType(clip: Pick<TimelineClip, 'mimeType' | 'fileName' | 'uri'>): string {
  if (clip.mimeType && clip.mimeType.startsWith('image/')) {
    return clip.mimeType === 'image/jpg' ? 'image/jpeg' : clip.mimeType;
  }
  for (const c of [clip.fileName, clip.uri.split('?')[0]]) {
    const ext = c ? /\.([a-zA-Z0-9]{2,5})$/.exec(c)?.[1]?.toLowerCase() : undefined;
    if (ext && IMAGE_MIME_BY_EXT[ext]) return IMAGE_MIME_BY_EXT[ext];
  }
  return 'image/jpeg';
}

/** Clips envoyés au module natif, dans l'ordre de la timeline. */
export function timelineComposerClips(tl: Timeline): ComposerClip[] {
  return tl.map((c) =>
    c.kind === 'image'
      ? {
          uri: c.uri,
          startMs: 0,
          endMs: Math.round(c.endMs - c.startMs),
          speed: 1,
          image: true,
          mimeType: imageMimeType(c),
        }
      : { uri: c.uri, startMs: Math.round(c.startMs), endMs: Math.round(c.endMs), speed: c.speed },
  );
}

/** Empreinte de ce qui change le fichier exporté (cache de l'export). */
export function timelineKey(tl: Timeline): string {
  return JSON.stringify(tl.map((c) => [c.kind, c.uri, c.startMs, c.endMs, c.speed]));
}

/**
 * Relit une timeline enregistrée (brouillon) : clips mal formés retirés,
 * valeurs ramenées dans leurs bornes. Liste vide si rien d'exploitable.
 */
export function sanitizeTimeline(raw: unknown): TimelineClip[] {
  if (!Array.isArray(raw)) return [];
  const out: TimelineClip[] = [];
  const seen = new Set<string>();
  for (const v of raw) {
    if (out.length >= MAX_TIMELINE_CLIPS) break;
    if (!v || typeof v !== 'object') continue;
    const r = v as Record<string, unknown>;
    const kind = r.kind === 'image' ? 'image' : r.kind === 'video' ? 'video' : null;
    if (!kind || typeof r.uri !== 'string' || !r.uri) continue;
    let id = typeof r.id === 'string' && /^[a-zA-Z0-9_-]{1,40}$/.test(r.id) ? r.id : makeClipId();
    if (seen.has(id)) id = makeClipId();
    seen.add(id);
    const base = {
      id,
      uri: r.uri,
      mimeType: typeof r.mimeType === 'string' ? r.mimeType : null,
      fileName: typeof r.fileName === 'string' ? r.fileName : null,
      fileSize: finite(r.fileSize) ? r.fileSize : null,
    };
    if (kind === 'image') {
      const span = finite(r.endMs) && finite(r.startMs) ? r.endMs - r.startMs : STILL_CLIP_MS;
      out.push({
        ...base,
        kind,
        sourceDurationMs: MAX_STILL_MS,
        startMs: 0,
        endMs: clamp(Math.round(span), MIN_STILL_MS, MAX_STILL_MS),
        speed: 1,
      });
      continue;
    }
    const dur = finite(r.sourceDurationMs) ? Math.round(r.sourceDurationMs) : 0;
    if (dur < MIN_CLIP_MS) continue;
    let s = finite(r.startMs) ? clamp(Math.round(r.startMs), 0, dur - MIN_CLIP_MS) : 0;
    let e = finite(r.endMs) ? clamp(Math.round(r.endMs), 0, dur) : dur;
    if (e - s < MIN_CLIP_MS) {
      e = Math.min(dur, s + MIN_CLIP_MS);
      s = Math.max(0, e - MIN_CLIP_MS);
    }
    out.push({ ...base, kind, sourceDurationMs: dur, startMs: s, endMs: e, speed: normalizeClipSpeed(r.speed) });
  }
  return out;
}

/**
 * Image à montrer pour l'instant `timeMs` (bande des calques, miniatures) :
 * fichier et instant dans ce fichier, ou la photo elle-même.
 */
export function frameSourceAt(
  tl: Timeline,
  timeMs: number,
): { uri: string; atMs: number; image: boolean } | null {
  const pos = locate(tl, timeMs);
  if (!pos) return null;
  return { uri: pos.clip.uri, atMs: pos.sourceMs, image: pos.clip.kind === 'image' };
}

/** Index cible d'un clip glissé de `dx` px, les largeurs des vignettes étant connues. */
export function dropIndexFor(widths: readonly number[], from: number, dx: number, gap = 0): number {
  if (from < 0 || from >= widths.length) return from;
  const starts: number[] = [];
  let acc = 0;
  for (const w of widths) {
    starts.push(acc);
    acc += w + gap;
  }
  const center = starts[from] + widths[from] / 2 + dx;
  let target = 0;
  for (let i = 0; i < widths.length; i++) {
    if (center >= starts[i] + widths[i] / 2) target = i;
  }
  // Sans le clip déplacé, les suivants reculent d'un cran.
  if (center < starts[from] + widths[from] / 2) {
    for (let i = 0; i < widths.length; i++) {
      if (center < starts[i] + widths[i] / 2) return i;
    }
  }
  return target;
}
