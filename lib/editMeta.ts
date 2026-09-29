/**
 * Réglages d'édition publiés avec la vidéo (sprint S5, colonne
 * `videos.edit_meta`, migration 016).
 *
 * Écrit par la publication à partir du brouillon (CreateContext), relu par
 * les lecteurs (VideoCard) qui appliquent vitesse, décalage et volume du son,
 * volume original et calques. Les données relues sont non fiables : tout
 * passe par parseEditMeta, qui borne chaque champ.
 *
 * Plafonds alignés sur 016 (nia_edit_meta_ok) : 12 Ko en JSON compact côté
 * app, 16 Ko en base (le texte jsonb de Postgres ajoute des espaces).
 */
import { sanitizeOverlayDoc, type OverlayDoc } from '@/lib/overlays';

export const EDIT_META_VERSION = 1 as const;
export const MAX_EDIT_META_BYTES = 12 * 1024;
export const EDIT_SPEEDS = [0.5, 1, 1.5, 2] as const;
const MAX_SOUND_OFFSET_MS = 3_600_000;

export type EditMeta = {
  v: typeof EDIT_META_VERSION;
  /** Découpe appliquée au fichier source (information : le fichier publié est déjà découpé). */
  trim: { startMs: number; endMs: number; sourceDurationMs: number | null } | null;
  /** Vitesse de lecture. */
  speed: number;
  /** Son ajouté : point de départ et volume. */
  sound: { offsetMs: number; volume: number } | null;
  /** Volume du son original de la vidéo. */
  originalVolume: number;
  overlays: OverlayDoc | null;
};

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function utf8Bytes(s: string): number {
  let bytes = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return bytes;
}

export function editMetaBytes(meta: EditMeta): number {
  return utf8Bytes(JSON.stringify(meta));
}

function nearestSpeed(v: number): number {
  let best: number = 1;
  for (const s of EDIT_SPEEDS) if (Math.abs(s - v) < Math.abs(best - v)) best = s;
  return best;
}

/** Relit un edit_meta non fiable. undefined si absent ou inutilisable. */
export function parseEditMeta(raw: unknown): EditMeta | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;

  const speedRaw = num(r.speed);
  const speed = speedRaw != null && speedRaw > 0 ? nearestSpeed(speedRaw) : 1;

  let sound: EditMeta['sound'] = null;
  if (r.sound && typeof r.sound === 'object' && !Array.isArray(r.sound)) {
    const s = r.sound as Record<string, unknown>;
    sound = {
      offsetMs: Math.round(clamp(num(s.offsetMs) ?? 0, 0, MAX_SOUND_OFFSET_MS)),
      volume: clamp(num(s.volume) ?? 1, 0, 1),
    };
  }

  let trim: EditMeta['trim'] = null;
  if (r.trim && typeof r.trim === 'object' && !Array.isArray(r.trim)) {
    const t = r.trim as Record<string, unknown>;
    const startMs = num(t.startMs);
    const endMs = num(t.endMs);
    if (startMs != null && endMs != null && startMs >= 0 && endMs > startMs) {
      const src = num(t.sourceDurationMs);
      trim = {
        startMs: Math.round(startMs),
        endMs: Math.round(endMs),
        sourceDurationMs: src != null && src > 0 ? Math.round(src) : null,
      };
    }
  }

  let overlays: OverlayDoc | null = null;
  if (r.overlays && typeof r.overlays === 'object') {
    const doc = sanitizeOverlayDoc(r.overlays);
    overlays = doc.items.length > 0 ? doc : null;
  }

  return {
    v: EDIT_META_VERSION,
    trim,
    speed,
    sound,
    originalVolume: clamp(num(r.originalVolume) ?? 1, 0, 1),
    overlays,
  };
}

/** Rien à appliquer : lecture normale. */
export function isDefaultEditMeta(meta: EditMeta): boolean {
  return (
    meta.trim == null &&
    meta.speed === 1 &&
    (meta.sound == null || (meta.sound.offsetMs === 0 && meta.sound.volume === 1)) &&
    meta.originalVolume === 1 &&
    (meta.overlays == null || meta.overlays.items.length === 0)
  );
}

/**
 * Construit l'edit_meta publié depuis le brouillon. null si tout est par
 * défaut (pas de colonne remplie pour rien). Les calques en trop sont retirés
 * pour tenir sous MAX_EDIT_META_BYTES.
 */
export function buildEditMeta(input: {
  trim: { startMs: number; endMs: number } | null;
  sourceDurationMs: number | null;
  speed: number;
  hasSound: boolean;
  soundOffsetMs: number;
  soundVolume: number;
  originalVolume: number;
  overlays: OverlayDoc | null;
  isVideo: boolean;
}): EditMeta | null {
  const overlays =
    input.overlays && input.overlays.items.length > 0 ? sanitizeOverlayDoc(input.overlays) : null;
  const meta: EditMeta = {
    v: EDIT_META_VERSION,
    trim:
      input.isVideo && input.trim
        ? {
            startMs: Math.round(input.trim.startMs),
            endMs: Math.round(input.trim.endMs),
            sourceDurationMs:
              input.sourceDurationMs && input.sourceDurationMs > 0
                ? Math.round(input.sourceDurationMs)
                : null,
          }
        : null,
    speed: input.isVideo ? nearestSpeed(input.speed > 0 ? input.speed : 1) : 1,
    sound: input.hasSound
      ? {
          offsetMs: Math.round(clamp(input.soundOffsetMs, 0, MAX_SOUND_OFFSET_MS)),
          volume: clamp(input.soundVolume, 0, 1),
        }
      : null,
    // Le volume original ne compte qu'avec un son ajouté (comme à l'édition).
    originalVolume: input.isVideo && input.hasSound ? clamp(input.originalVolume, 0, 1) : 1,
    overlays: overlays && overlays.items.length > 0 ? overlays : null,
  };
  while (meta.overlays && editMetaBytes(meta) > MAX_EDIT_META_BYTES) {
    const items = meta.overlays.items.slice(0, -1);
    meta.overlays = items.length ? { ...meta.overlays, items } : null;
  }
  return isDefaultEditMeta(meta) ? null : meta;
}
