/**
 * Éditeur V2 — habillage incrusté : calculs purs (testés sans module natif).
 *
 * Les calques texte / stickers sont capturés un par un en PNG
 * (components/OverlayBakeStage, react-native-view-shot) dans un cadre de
 * `frameWidthPx` pixels de large, puis NiaComposer les pose sur la vidéo
 * (Media3 OverlayEffect) : centre (x, y) en fraction du cadre, rotation,
 * fenêtre d'affichage en temps de SORTIE (vitesse et montage appliqués).
 * L'échelle est la même pour tous : largeur de sortie / frameWidthPx.
 *
 * Le filtre NIA est cuit par une matrice couleur (Media3 RgbMatrix) qui
 * reproduit exactement le voile de l'aperçu : sortie = (1 − a) · pixel + a · teinte.
 */
import { getFilterOverlayStyle, type FilterDefinition } from '@/constants/filters';
import { overlaysForBakedSpeed } from '@/lib/composition';
import {
  DEFAULT_FRAME_ASPECT,
  MIN_OVERLAY_SPAN_MS,
  type Overlay,
  type OverlayDoc,
} from '@/lib/overlays';
import type { ComposerFilter, ComposerOverlay } from '@/modules/nia-composer';

/** Sortie NiaComposer : petit côté 720, boîte 720 × 1280 (voir lib/composition). */
const SHORT_SIDE = 720;
const LONG_SIDE = 1280;

/**
 * Largeur (px) du cadre de sortie attendu pour ce format : la capture est
 * faite à cette taille, donc posée sans agrandissement ni flou.
 */
export function bakeFrameWidthPx(aspect: number, fixedCanvas: boolean): number {
  if (fixedCanvas) return SHORT_SIDE;
  const a = aspect > 0 && Number.isFinite(aspect) ? aspect : DEFAULT_FRAME_ASPECT;
  const w = a >= 1 ? Math.min(LONG_SIDE, SHORT_SIDE * a) : Math.min(SHORT_SIDE, LONG_SIDE * a);
  return Math.max(2, Math.round(w));
}

export type BakePlanItem = {
  overlay: Overlay;
  /** Fenêtre en temps de sortie (ms) ; endMs null = jusqu'à la fin. */
  startMs: number;
  endMs: number | null;
};

export type BakePlan = {
  frameWidthPx: number;
  items: BakePlanItem[];
};

/**
 * Calques à incruster, avec leur horaire sur la vidéo exportée.
 * - `speed` : vitesse du clip unique (P0) ; 1 pour un montage (les calques
 *   y sont déjà en temps de timeline).
 * - `durationMs` : durée finale attendue (null = inconnue) : un calque qui
 *   commence après la fin est ignoré, une fin au-delà devient « jusqu'à la fin ».
 * null s'il n'y a rien à incruster.
 */
export function overlayBakePlan(
  doc: OverlayDoc | null | undefined,
  options: { speed: number; durationMs: number | null; fixedCanvas: boolean },
): BakePlan | null {
  if (!doc || doc.items.length === 0) return null;
  const timed = overlaysForBakedSpeed(doc, options.speed) ?? doc;
  const total = options.durationMs != null && options.durationMs > 0 ? options.durationMs : null;
  const items: BakePlanItem[] = [];
  for (const o of timed.items) {
    const startMs = Math.max(0, Math.round(o.startMs));
    if (total != null && startMs >= total - 50) continue;
    let endMs = o.endMs == null ? null : Math.round(o.endMs);
    if (endMs != null && total != null && endMs >= total - 50) endMs = null;
    if (endMs != null && endMs < startMs + MIN_OVERLAY_SPAN_MS) endMs = startMs + MIN_OVERLAY_SPAN_MS;
    items.push({ overlay: o, startMs, endMs });
  }
  if (items.length === 0) return null;
  return { frameWidthPx: bakeFrameWidthPx(doc.aspect, options.fixedCanvas), items };
}

/** Plan + captures (id → fichier PNG) → calques du contrat NiaComposer. */
export function composerOverlays(
  plan: BakePlan,
  captures: ReadonlyMap<string, string>,
): ComposerOverlay[] {
  const out: ComposerOverlay[] = [];
  for (const it of plan.items) {
    const uri = captures.get(it.overlay.id);
    if (!uri) throw new Error(`Missing capture for overlay ${it.overlay.id}`);
    out.push({
      uri,
      x: it.overlay.x,
      y: it.overlay.y,
      rotation: it.overlay.rotation,
      startMs: it.startMs,
      endMs: it.endMs,
    });
  }
  return out;
}

function hexToRgb01(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
}

const r4 = (v: number) => Math.round(v * 10000) / 10000;

/**
 * Matrice 4 × 4 (colonnes d'abord, convention android.opengl.Matrix, comme
 * Media3 RgbMatrix) du voile de l'aperçu : même couleur, même opacité
 * (getFilterOverlayStyle). null = pas de filtre.
 */
export function filterBakeMatrix(filter: FilterDefinition | null | undefined): number[] | null {
  const wash = getFilterOverlayStyle(filter ?? null);
  if (!wash) return null;
  const rgb = hexToRgb01(wash.backgroundColor);
  const a = Math.max(0, Math.min(1, wash.opacity));
  if (!rgb || a <= 0) return null;
  const k = r4(1 - a);
  return [
    k, 0, 0, 0,
    0, k, 0, 0,
    0, 0, k, 0,
    r4(a * rgb[0]), r4(a * rgb[1]), r4(a * rgb[2]), 1,
  ];
}

/** Filtre au format du contrat NiaComposer. */
export function composerFilter(filter: FilterDefinition | null | undefined): ComposerFilter | null {
  const matrix = filterBakeMatrix(filter);
  return matrix && filter ? { id: filter.id, matrix } : null;
}

/** Applique la matrice à une couleur 0..1 (tests et vérification de l'aperçu). */
export function applyBakeMatrix(m: readonly number[], rgb: readonly [number, number, number]): [number, number, number] {
  const [r, g, b] = rgb;
  return [
    m[0] * r + m[4] * g + m[8] * b + m[12],
    m[1] * r + m[5] * g + m[9] * b + m[13],
    m[2] * r + m[6] * g + m[10] * b + m[14],
  ];
}
