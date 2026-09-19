/**
 * NIA Filters V2.6 — registry of camera/create filters.
 *
 * Architecture: add a new FilterDefinition to FILTERS — no app rewrite required.
 * Categories drive the horizontal carousel chips.
 *
 * Honesty (MVP Free / zero-budget):
 * - Preview uses color overlays / approximate saturation matrices on Image.
 * - No native AR face mesh, no real 3D LUT pipeline, no paid Snap-like SDK.
 * - True LUT / live AR face tracking = V3 (native SDK).
 * - filter_id is stored as text on videos; no binary filter assets in Storage.
 */

export type FilterCategoryId =
  | 'beaute'
  | 'lumiere'
  | 'portrait'
  | 'culture'
  | 'afrique'
  | 'diaspora'
  | 'fun'
  | 'nia';

export type FilterType = 'color-matrix' | 'overlay';

/** 4×5 color matrix (RN / CSS-compatible row-major). Used for preview docs + future native. */
export type ColorMatrix5x4 = readonly [
  number, number, number, number, number,
  number, number, number, number, number,
  number, number, number, number, number,
  number, number, number, number, number,
];

export type FilterDefinition = {
  id: string;
  /** Display name (NIA identity — not Snap branding) */
  name: string;
  category: FilterCategoryId;
  /** Chip / LUT preview swatch */
  previewColor: string;
  /** Default intensity 0–1 */
  intensity: number;
  type: FilterType;
  /** Overlay tint (hex) when type === 'overlay' or as soft wash for matrix preview */
  overlayColor?: string;
  /** Default opacity for overlay wash */
  overlayOpacity?: number;
  /** Optional documented matrix for color-matrix filters (preview may approximate) */
  matrix?: ColorMatrix5x4;
};

export type FilterCategoryMeta = {
  id: FilterCategoryId;
  /** i18n key under filter.cat* */
  labelKey: string;
};

export const FILTER_CATEGORIES: FilterCategoryMeta[] = [
  { id: 'beaute', labelKey: 'filter.catBeaute' },
  { id: 'lumiere', labelKey: 'filter.catLumiere' },
  { id: 'portrait', labelKey: 'filter.catPortrait' },
  { id: 'culture', labelKey: 'filter.catCulture' },
  { id: 'afrique', labelKey: 'filter.catAfrique' },
  { id: 'diaspora', labelKey: 'filter.catDiaspora' },
  { id: 'fun', labelKey: 'filter.catFun' },
  { id: 'nia', labelKey: 'filter.catNia' },
];

/** Identity matrix */
const ID_MATRIX: ColorMatrix5x4 = [
  1, 0, 0, 0, 0,
  0, 1, 0, 0, 0,
  0, 0, 1, 0, 0,
  0, 0, 0, 1, 0,
];

/** Soft warm boost (ocre-leaning) */
const WARM_MATRIX: ColorMatrix5x4 = [
  1.12, 0.05, 0, 0, 0.02,
  0.04, 1.05, 0, 0, 0,
  0, 0.02, 0.92, 0, 0,
  0, 0, 0, 1, 0,
];

/** Cool / night blue */
const COOL_MATRIX: ColorMatrix5x4 = [
  0.9, 0, 0.05, 0, 0,
  0, 0.95, 0.05, 0, 0,
  0.05, 0.05, 1.15, 0, 0.02,
  0, 0, 0, 1, 0,
];

/** Soft beauty (slight contrast + warm) */
const BEAUTY_MATRIX: ColorMatrix5x4 = [
  1.08, 0.04, 0.02, 0, 0.01,
  0.03, 1.06, 0.02, 0, 0.01,
  0.02, 0.03, 1.02, 0, 0,
  0, 0, 0, 1, 0,
];

/** High contrast portrait */
const PORTRAIT_MATRIX: ColorMatrix5x4 = [
  1.15, -0.02, -0.02, 0, 0,
  -0.02, 1.12, -0.02, 0, 0,
  -0.02, -0.02, 1.1, 0, 0,
  0, 0, 0, 1, 0,
];

/** Desaturate slightly (film) */
const FILM_MATRIX: ColorMatrix5x4 = [
  0.85, 0.1, 0.05, 0, 0.02,
  0.08, 0.82, 0.08, 0, 0.01,
  0.05, 0.1, 0.8, 0, 0,
  0, 0, 0, 1, 0,
];

/**
 * Registry — extend by appending. Keep ids stable (stored on videos.filter_id).
 * Visual language: sable / ocre / noir — never Snap yellow ghost branding.
 */
export const FILTERS: FilterDefinition[] = [
  // —— Beauté ——
  {
    id: 'beaute-glow',
    name: 'Glow Sable',
    category: 'beaute',
    previewColor: '#F5E6D3',
    intensity: 0.55,
    type: 'color-matrix',
    overlayColor: '#F5E6D3',
    overlayOpacity: 0.18,
    matrix: BEAUTY_MATRIX,
  },
  {
    id: 'beaute-soft',
    name: 'Doux',
    category: 'beaute',
    previewColor: '#E8D4B8',
    intensity: 0.5,
    type: 'overlay',
    overlayColor: '#E8C9A0',
    overlayOpacity: 0.22,
  },
  {
    id: 'beaute-eclat',
    name: 'Éclat',
    category: 'beaute',
    previewColor: '#D17F2A',
    intensity: 0.45,
    type: 'color-matrix',
    overlayColor: '#D17F2A',
    overlayOpacity: 0.12,
    matrix: WARM_MATRIX,
  },

  // —— Lumière ——
  {
    id: 'lumiere-golden',
    name: 'Heure dorée',
    category: 'lumiere',
    previewColor: '#C9A227',
    intensity: 0.6,
    type: 'overlay',
    overlayColor: '#D17F2A',
    overlayOpacity: 0.28,
  },
  {
    id: 'lumiere-softbox',
    name: 'Softbox',
    category: 'lumiere',
    previewColor: '#FFF5E6',
    intensity: 0.4,
    type: 'overlay',
    overlayColor: '#FFF8EE',
    overlayOpacity: 0.2,
  },
  {
    id: 'lumiere-contre',
    name: 'Contre-jour',
    category: 'lumiere',
    previewColor: '#8B6914',
    intensity: 0.5,
    type: 'color-matrix',
    overlayColor: '#3D2914',
    overlayOpacity: 0.25,
    matrix: FILM_MATRIX,
  },

  // —— Portrait ——
  {
    id: 'portrait-studio',
    name: 'Studio',
    category: 'portrait',
    previewColor: '#A67C52',
    intensity: 0.55,
    type: 'color-matrix',
    overlayColor: '#2A1A0A',
    overlayOpacity: 0.15,
    matrix: PORTRAIT_MATRIX,
  },
  {
    id: 'portrait-ombre',
    name: 'Ombre',
    category: 'portrait',
    previewColor: '#1C1C1C',
    intensity: 0.5,
    type: 'overlay',
    overlayColor: '#0B0B0B',
    overlayOpacity: 0.32,
  },
  {
    id: 'portrait-peau',
    name: 'Teint chaud',
    category: 'portrait',
    previewColor: '#C4875A',
    intensity: 0.5,
    type: 'overlay',
    overlayColor: '#C4875A',
    overlayOpacity: 0.2,
  },

  // —— Culture ——
  {
    id: 'culture-indigo',
    name: 'Indigo',
    category: 'culture',
    previewColor: '#2C3E6B',
    intensity: 0.55,
    type: 'overlay',
    overlayColor: '#1E2A4A',
    overlayOpacity: 0.3,
  },
  {
    id: 'culture-batik',
    name: 'Batik',
    category: 'culture',
    previewColor: '#8B3A2A',
    intensity: 0.5,
    type: 'overlay',
    overlayColor: '#A33227',
    overlayOpacity: 0.22,
  },
  {
    id: 'culture-kente',
    name: 'Kente',
    category: 'culture',
    previewColor: '#C9A227',
    intensity: 0.45,
    type: 'overlay',
    overlayColor: '#C9A227',
    overlayOpacity: 0.18,
  },

  // —— Afrique ——
  {
    id: 'afrique-sahel',
    name: 'Sahel',
    category: 'afrique',
    previewColor: '#D4A574',
    intensity: 0.6,
    type: 'overlay',
    overlayColor: '#C9A066',
    overlayOpacity: 0.28,
  },
  {
    id: 'afrique-baobab',
    name: 'Baobab',
    category: 'afrique',
    previewColor: '#1B4D3E',
    intensity: 0.5,
    type: 'overlay',
    overlayColor: '#1B4D3E',
    overlayOpacity: 0.25,
  },
  {
    id: 'afrique-terre',
    name: 'Terre rouge',
    category: 'afrique',
    previewColor: '#A33227',
    intensity: 0.55,
    type: 'overlay',
    overlayColor: '#A33227',
    overlayOpacity: 0.24,
  },

  // —— Diaspora ——
  {
    id: 'diaspora-metro',
    name: 'Métro',
    category: 'diaspora',
    previewColor: '#4A5568',
    intensity: 0.5,
    type: 'color-matrix',
    overlayColor: '#2D3748',
    overlayOpacity: 0.22,
    matrix: COOL_MATRIX,
  },
  {
    id: 'diaspora-neon',
    name: 'Néon nuit',
    category: 'diaspora',
    previewColor: '#6B4C9A',
    intensity: 0.45,
    type: 'overlay',
    overlayColor: '#5B3A8C',
    overlayOpacity: 0.28,
  },
  {
    id: 'diaspora-bridge',
    name: 'Pont',
    category: 'diaspora',
    previewColor: '#718096',
    intensity: 0.4,
    type: 'color-matrix',
    overlayColor: '#4A5568',
    overlayOpacity: 0.18,
    matrix: FILM_MATRIX,
  },

  // —— Fun ——
  {
    id: 'fun-pop',
    name: 'Pop Ocre',
    category: 'fun',
    previewColor: '#FF8C42',
    intensity: 0.65,
    type: 'overlay',
    overlayColor: '#D17F2A',
    overlayOpacity: 0.35,
  },
  {
    id: 'fun-sunset',
    name: 'Sunset',
    category: 'fun',
    previewColor: '#E85D4C',
    intensity: 0.55,
    type: 'overlay',
    overlayColor: '#E85D4C',
    overlayOpacity: 0.3,
  },
  {
    id: 'fun-bw',
    name: 'Noir & Sable',
    category: 'fun',
    previewColor: '#9A8B7A',
    intensity: 0.7,
    type: 'color-matrix',
    overlayColor: '#F5E6D3',
    overlayOpacity: 0.12,
    matrix: [
      0.33, 0.33, 0.33, 0, 0.02,
      0.33, 0.33, 0.33, 0, 0.01,
      0.33, 0.33, 0.33, 0, 0,
      0, 0, 0, 1, 0,
    ],
  },

  // —— NIA Originals ——
  {
    id: 'nia-original',
    name: 'NIA Original',
    category: 'nia',
    previewColor: '#D17F2A',
    intensity: 0.5,
    type: 'overlay',
    overlayColor: '#D17F2A',
    overlayOpacity: 0.2,
  },
  {
    id: 'nia-sable',
    name: 'Sable',
    category: 'nia',
    previewColor: '#F5E6D3',
    intensity: 0.45,
    type: 'overlay',
    overlayColor: '#F5E6D3',
    overlayOpacity: 0.25,
  },
  {
    id: 'nia-noir',
    name: 'Noir Terre',
    category: 'nia',
    previewColor: '#0B0B0B',
    intensity: 0.55,
    type: 'overlay',
    overlayColor: '#0B0B0B',
    overlayOpacity: 0.35,
  },
  {
    id: 'nia-ocre',
    name: 'Ocre',
    category: 'nia',
    previewColor: '#D17F2A',
    intensity: 0.6,
    type: 'color-matrix',
    overlayColor: '#D17F2A',
    overlayOpacity: 0.22,
    matrix: WARM_MATRIX,
  },
];

const FILTER_BY_ID = new Map(FILTERS.map((f) => [f.id, f]));

export function getFilterById(id: string | null | undefined): FilterDefinition | null {
  if (!id) return null;
  return FILTER_BY_ID.get(id) ?? null;
}

export function filtersForCategory(category: FilterCategoryId): FilterDefinition[] {
  return FILTERS.filter((f) => f.category === category);
}

export function isFilterId(value: string | null | undefined): boolean {
  return !!value && FILTER_BY_ID.has(value);
}

/**
 * Resolve overlay style for create preview / feed badge wash.
 * intensity scales the default overlayOpacity (clamped).
 */
export function getFilterOverlayStyle(
  filter: FilterDefinition | null,
  intensityOverride?: number,
): { backgroundColor: string; opacity: number } | null {
  if (!filter?.overlayColor) return null;
  const base = filter.overlayOpacity ?? 0.2;
  const intensity =
    typeof intensityOverride === 'number' ? intensityOverride : filter.intensity;
  const opacity = Math.max(0, Math.min(0.65, base * (0.5 + intensity)));
  return { backgroundColor: filter.overlayColor, opacity };
}

export { ID_MATRIX };
