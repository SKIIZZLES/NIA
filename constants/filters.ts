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

/**
 * Éclat : chaleur ocre SANS éclaircir (01/10/2026). Gains ≤ 1, aucun
 * décalage (l'ancienne WARM_MATRIX, gains 1,05–1,12, reste pour les autres).
 */
const ECLAT_MATRIX: ColorMatrix5x4 = [
  1, 0, 0, 0, 0,
  0, 0.95, 0, 0, 0,
  0, 0, 0.85, 0, 0,
  0, 0, 0, 1, 0,
];

/** Cool / night blue */
const COOL_MATRIX: ColorMatrix5x4 = [
  0.9, 0, 0.05, 0, 0,
  0, 0.95, 0.05, 0, 0,
  0.05, 0.05, 1.15, 0, 0.02,
  0, 0, 0, 1, 0,
];

/**
 * Glow Sable : teinte chaude SANS éclaircir (01/10/2026). Diagonale ≤ 1 et
 * aucun décalage : aucun canal ne monte, le bleu baisse un peu (chaleur).
 * L'ancienne matrice « beauté » (gains 1,02–1,08 + décalage) éclaircissait.
 */
const GLOW_SABLE_MATRIX: ColorMatrix5x4 = [
  1, 0, 0, 0, 0,
  0, 0.97, 0, 0, 0,
  0, 0, 0.9, 0, 0,
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
    // Jamais d'éclaircissement de la peau (règle NIA) : voile bronze foncé,
    // plus sombre que la peau la plus foncée de l'échelle Monk (MST 10,
    // #292420) — il réchauffe sans jamais éclaircir, aperçu = fichier. Avant
    // (jusqu'au 01/10/2026) : voile crème #F5E6D3 à 19 %, qui éclaircissait
    // les peaux foncées jusqu'à +46/255. Test : __tests__/constants/filtersSkin.test.ts.
    id: 'beaute-glow',
    name: 'Glow Sable',
    category: 'beaute',
    previewColor: '#C8A27A',
    intensity: 0.55,
    type: 'color-matrix',
    overlayColor: '#3A1C06',
    overlayOpacity: 0.14,
    matrix: GLOW_SABLE_MATRIX,
  },
  {
    // Jamais d'éclaircissement (01/10/2026) : voile plus sombre que MST 10 (#292420), il ne peut qu'assombrir ; test __tests__/constants/filtersSkin.test.ts.
    // Douceur = contraste adouci (× 0,87) + chaleur rosée ; avant : voile
    // beige clair #E8C9A0 à 22 % (+37/255 sur MST 10).
    id: 'beaute-soft',
    name: 'Doux',
    category: 'beaute',
    previewColor: '#E8D4B8',
    intensity: 0.5,
    type: 'overlay',
    overlayColor: '#421B12',
    overlayOpacity: 0.13,
  },
  {
    id: 'beaute-eclat',
    name: 'Éclat',
    category: 'beaute',
    previewColor: '#D17F2A',
    intensity: 0.45,
    type: 'color-matrix',
    // Jamais d'éclaircissement (01/10/2026) : voile plus sombre que MST 10 (#292420), il ne peut qu'assombrir ; test __tests__/constants/filtersSkin.test.ts.
    // Éclat = teinte ocre brûlé franche ; avant : ocre #D17F2A à 11 % (+12/255).
    overlayColor: '#521900',
    overlayOpacity: 0.145,
    matrix: ECLAT_MATRIX,
  },

  // —— Lumière ——
  {
    // Jamais d'éclaircissement (01/10/2026) : voile plus sombre que MST 10, même teinte ;
    // avant #D17F2A à 31 % (+31,3/255 sur MST 10).
    id: 'lumiere-golden',
    name: 'Heure dorée',
    category: 'lumiere',
    previewColor: '#C9A227',
    intensity: 0.6,
    type: 'overlay',
    overlayColor: '#391F03',
    overlayOpacity: 0.204,
  },
  {
    // Jamais d'éclaircissement (01/10/2026) : voile plus sombre que MST 10, même teinte ;
    // avant #FFF8EE à 18 % (+38,2/255 sur MST 10).
    id: 'lumiere-softbox',
    name: 'Softbox',
    category: 'lumiere',
    previewColor: '#FFF5E6',
    intensity: 0.4,
    type: 'overlay',
    overlayColor: '#24221F',
    overlayOpacity: 0.2,
  },
  {
    // Jamais d'éclaircissement (01/10/2026) : voile plus sombre que MST 10, même teinte ;
    // avant #3D2914 à 25 % (+1,7/255 sur MST 10).
    id: 'lumiere-contre',
    name: 'Contre-jour',
    category: 'lumiere',
    previewColor: '#8B6914',
    intensity: 0.5,
    type: 'color-matrix',
    overlayColor: '#32200D',
    overlayOpacity: 0.239,
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
    // Jamais d'éclaircissement (01/10/2026) : voile plus sombre que MST 10, même teinte ;
    // avant #C4875A à 20 % (+21,6/255 sur MST 10).
    id: 'portrait-peau',
    name: 'Teint chaud',
    category: 'portrait',
    previewColor: '#C4875A',
    intensity: 0.5,
    type: 'overlay',
    overlayColor: '#3B1E08',
    overlayOpacity: 0.187,
  },

  // —— Culture ——
  {
    // Jamais d'éclaircissement (01/10/2026) : voile plus sombre que MST 10, même teinte ;
    // avant #1E2A4A à 32 % (+1,6/255 sur MST 10).
    id: 'culture-indigo',
    name: 'Indigo',
    category: 'culture',
    previewColor: '#2C3E6B',
    intensity: 0.55,
    type: 'overlay',
    overlayColor: '#182340',
    overlayOpacity: 0.29,
  },
  {
    // Jamais d'éclaircissement (01/10/2026) : voile plus sombre que MST 10, même teinte ;
    // avant #A33227 à 22 % (+8,0/255 sur MST 10).
    id: 'culture-batik',
    name: 'Batik',
    category: 'culture',
    previewColor: '#8B3A2A',
    intensity: 0.5,
    type: 'overlay',
    overlayColor: '#60120B',
    overlayOpacity: 0.194,
  },
  {
    // Jamais d'éclaircissement (01/10/2026) : voile plus sombre que MST 10, même teinte ;
    // avant #C9A227 à 17 % (+21,3/255 sur MST 10).
    id: 'culture-kente',
    name: 'Kente',
    category: 'culture',
    previewColor: '#C9A227',
    intensity: 0.45,
    type: 'overlay',
    overlayColor: '#2C2303',
    overlayOpacity: 0.18,
  },

  // —— Afrique ——
  {
    // Jamais d'éclaircissement (01/10/2026) : voile plus sombre que MST 10, même teinte ;
    // avant #C9A066 à 31 % (+39,3/255 sur MST 10).
    id: 'afrique-sahel',
    name: 'Sahel',
    category: 'afrique',
    previewColor: '#D4A574',
    intensity: 0.6,
    type: 'overlay',
    overlayColor: '#322108',
    overlayOpacity: 0.204,
  },
  {
    // Jamais d'éclaircissement (01/10/2026) : voile plus sombre que MST 10, même teinte ;
    // avant #1B4D3E à 25 % (+7,1/255 sur MST 10).
    id: 'afrique-baobab',
    name: 'Baobab',
    category: 'afrique',
    previewColor: '#1B4D3E',
    intensity: 0.5,
    type: 'overlay',
    overlayColor: '#072B20',
    overlayOpacity: 0.212,
  },
  {
    // Jamais d'éclaircissement (01/10/2026) : voile plus sombre que MST 10, même teinte ;
    // avant #A33227 à 25 % (+9,2/255 sur MST 10).
    id: 'afrique-terre',
    name: 'Terre rouge',
    category: 'afrique',
    previewColor: '#A33227',
    intensity: 0.55,
    type: 'overlay',
    overlayColor: '#60120B',
    overlayOpacity: 0.195,
  },

  // —— Diaspora ——
  {
    // Jamais d'éclaircissement (01/10/2026) : voile plus sombre que MST 10, même teinte ;
    // avant #2D3748 à 22 % (+3,8/255 sur MST 10).
    id: 'diaspora-metro',
    name: 'Métro',
    category: 'diaspora',
    previewColor: '#4A5568',
    intensity: 0.5,
    type: 'color-matrix',
    overlayColor: '#1B2331',
    overlayOpacity: 0.199,
    matrix: COOL_MATRIX,
  },
  {
    // Jamais d'éclaircissement (01/10/2026) : voile plus sombre que MST 10, même teinte ;
    // avant #5B3A8C à 27 % (+9,1/255 sur MST 10).
    id: 'diaspora-neon',
    name: 'Néon nuit',
    category: 'diaspora',
    previewColor: '#6B4C9A',
    intensity: 0.45,
    type: 'overlay',
    overlayColor: '#301953',
    overlayOpacity: 0.229,
  },
  {
    // Jamais d'éclaircissement (01/10/2026) : voile plus sombre que MST 10, même teinte ;
    // avant #4A5568 à 16 % (+7,7/255 sur MST 10).
    id: 'diaspora-bridge',
    name: 'Pont',
    category: 'diaspora',
    previewColor: '#718096',
    intensity: 0.4,
    type: 'color-matrix',
    overlayColor: '#1C232F',
    overlayOpacity: 0.18,
    matrix: FILM_MATRIX,
  },

  // —— Fun ——
  {
    // Jamais d'éclaircissement (01/10/2026) : voile plus sombre que MST 10, même teinte ;
    // avant #D17F2A à 40 % (+40,9/255 sur MST 10).
    id: 'fun-pop',
    name: 'Pop Ocre',
    category: 'fun',
    previewColor: '#FF8C42',
    intensity: 0.65,
    type: 'overlay',
    overlayColor: '#391F03',
    overlayOpacity: 0.224,
  },
  {
    // Jamais d'éclaircissement (01/10/2026) : voile plus sombre que MST 10, même teinte ;
    // avant #E85D4C à 32 % (+26,6/255 sur MST 10).
    id: 'fun-sunset',
    name: 'Sunset',
    category: 'fun',
    previewColor: '#E85D4C',
    intensity: 0.55,
    type: 'overlay',
    overlayColor: '#5D130A',
    overlayOpacity: 0.216,
  },
  {
    id: 'fun-bw',
    name: 'Noir & Sable',
    category: 'fun',
    previewColor: '#9A8B7A',
    intensity: 0.7,
    type: 'color-matrix',
    // Jamais d'éclaircissement (01/10/2026) : voile plus sombre que MST 10 (#292420), il ne peut qu'assombrir ; test __tests__/constants/filtersSkin.test.ts.
    // Voile sépia neutre ; avant : voile crème #F5E6D3 à 14 % (+28/255).
    // NB : la matrice (noir et blanc) est documentaire : l'aperçu et le
    // fichier n'appliquent que le voile.
    overlayColor: '#2B2118',
    overlayOpacity: 0.11,
    matrix: [
      0.33, 0.33, 0.33, 0, 0,
      0.31, 0.31, 0.31, 0, 0,
      0.27, 0.27, 0.27, 0, 0,
      0, 0, 0, 1, 0,
    ],
  },

  // —— NIA Originals ——
  {
    // Jamais d'éclaircissement (01/10/2026) : voile plus sombre que MST 10, même teinte ;
    // avant #D17F2A à 20 % (+20,3/255 sur MST 10).
    id: 'nia-original',
    name: 'NIA Original',
    category: 'nia',
    previewColor: '#D17F2A',
    intensity: 0.5,
    type: 'overlay',
    overlayColor: '#391F03',
    overlayOpacity: 0.187,
  },
  {
    id: 'nia-sable',
    name: 'Sable',
    category: 'nia',
    previewColor: '#F5E6D3',
    intensity: 0.45,
    type: 'overlay',
    // Jamais d'éclaircissement (01/10/2026) : voile plus sombre que MST 10 (#292420), il ne peut qu'assombrir ; test __tests__/constants/filtersSkin.test.ts.
    // Sable = voile sable chaud, contraste adouci ; avant : crème #F5E6D3 à
    // 24 % (+46/255 sur MST 10, peaux foncées grisées).
    overlayColor: '#30200F',
    overlayOpacity: 0.14,
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
    // Jamais d'éclaircissement (01/10/2026) : voile plus sombre que MST 10, même teinte ;
    // avant #D17F2A à 24 % (+24,6/255 sur MST 10).
    id: 'nia-ocre',
    name: 'Ocre',
    category: 'nia',
    previewColor: '#D17F2A',
    intensity: 0.6,
    type: 'color-matrix',
    overlayColor: '#391F03',
    overlayOpacity: 0.183,
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
