/**
 * Paires texte / fond auditées pour chaque thème d'Apparence (WCAG 2.x AA).
 *
 * - texte courant, secondaire et atténué : ≥ 4.5:1 sur les trois surfaces ;
 * - désactivé, contour de contrôle, icônes : ≥ 3:1 ;
 * - contrôles sur média : mesurés sur un fond **blanc pur** (pire image
 *   possible sous un voile sombre), identiques dans tous les thèmes.
 *
 * Consommé par `__tests__/constants/themeContrast.test.ts`. Pour sortir le
 * tableau : `CONTRAST_TABLE=1 npx jest themeContrast`.
 */
import {
  FEED_TOP_FADE,
  MEDIA_OVERLAY,
  THEME_IDS,
  mediaPalette,
  resolveThemeColors,
  type ThemeColors,
  type ThemeId,
} from '@/constants/themes';
import { AA_LARGE, AA_TEXT, contrastRatio } from '@/lib/contrast';

export type ContrastRow = {
  theme: string;
  pair: string;
  ratio: number;
  /** Seuil exigé ; 0 = informatif (bordure décorative). */
  min: number;
};

type Surface = 'noir' | 'noirElevated' | 'noirSoft';
const SURFACES: Surface[] = ['noir', 'noirElevated', 'noirSoft'];

const TEXT_TOKENS = ['textPrimary', 'sable', 'sableMuted', 'textSecondary', 'textMuted', 'or', 'danger'] as const;
const LARGE_TOKENS = ['textDisabled', 'borderStrong'] as const;

/** Pire fond sous un voile sombre : blanc pur. */
const WORST_MEDIA = '#FFFFFF';
/** Vidéo sombre (fond de VideoCard). */
const DARK_MEDIA = '#0B0B0B';

function paletteRows(theme: string, c: ThemeColors): ContrastRow[] {
  const rows: ContrastRow[] = [];
  for (const s of SURFACES) {
    for (const tk of TEXT_TOKENS) {
      rows.push({ theme, pair: `${tk} / ${s}`, ratio: contrastRatio(c[tk], c[s]), min: AA_TEXT });
    }
    for (const tk of LARGE_TOKENS) {
      rows.push({ theme, pair: `${tk} / ${s}`, ratio: contrastRatio(c[tk], c[s]), min: AA_LARGE });
    }
    rows.push({ theme, pair: `border / ${s} (décoratif)`, ratio: contrastRatio(c.border, c[s]), min: 0 });
  }
  // Libellés posés sur l'accent (boutons « Suivant », puces actives).
  rows.push({ theme, pair: 'noir / or (libellé sur bouton ocre)', ratio: contrastRatio(c.noir, c.or), min: AA_TEXT });
  rows.push({ theme, pair: 'onAccent / or', ratio: contrastRatio(c.onAccent, c.or), min: AA_TEXT });
  // Puce de filtre active : libellé principal sur teinte ocre 18 % (FilterCarousel).
  rows.push({ theme, pair: 'textPrimary / puce active (or 18 % sur noirSoft)', ratio: contrastRatio(c.textPrimary, c.noirSoft, [c.or + '2E']), min: AA_TEXT });
  // Sélecteur de langue (LanguageToggle) : libellé ocre sur teinte ocre 8 % du fond,
  // et séparateur « ou » de GoogleSignInButton.
  rows.push({ theme, pair: 'or / sélecteur de langue (or 8 % sur noir)', ratio: contrastRatio(c.or, c.noir, [c.or + '14']), min: AA_TEXT });
  rows.push({ theme, pair: 'or / langue choisie (or 10 % sur noirElevated)', ratio: contrastRatio(c.or, c.noirElevated, [c.or + '1A']), min: AA_TEXT });
  // Bouton désactivé (Button) : libellé et contour sur noirSoft.
  rows.push({ theme, pair: 'textDisabled / bouton désactivé (noirSoft)', ratio: contrastRatio(c.textDisabled, c.noirSoft), min: AA_LARGE });
  return rows;
}

function mediaRows(theme: string, c: ThemeColors): ContrastRow[] {
  const m = mediaPalette(c);
  const strong = [c.mediaScrimStrong];
  const soft = [c.mediaScrim];
  return [
    { theme, pair: 'onMedia / mediaScrimStrong sur blanc', ratio: contrastRatio(c.onMedia, WORST_MEDIA, strong), min: AA_TEXT },
    { theme, pair: 'onMediaMuted / mediaScrimStrong sur blanc', ratio: contrastRatio(c.onMediaMuted, WORST_MEDIA, strong), min: AA_TEXT },
    { theme, pair: 'onMediaAccent / mediaScrimStrong sur blanc', ratio: contrastRatio(c.onMediaAccent, WORST_MEDIA, strong), min: AA_TEXT },
    { theme, pair: 'onMediaDisabled / mediaScrimStrong sur blanc', ratio: contrastRatio(c.onMediaDisabled, WORST_MEDIA, strong), min: AA_LARGE },
    { theme, pair: 'onMedia (icône) / mediaScrim sur blanc', ratio: contrastRatio(c.onMedia, WORST_MEDIA, soft), min: AA_LARGE },
    // Panneaux de l'éditeur (palette média, surface élevée à 95 %).
    { theme, pair: 'média : textSecondary / panneau sur blanc', ratio: contrastRatio(m.textSecondary, WORST_MEDIA, [m.noirElevated + 'F2']), min: AA_TEXT },
    { theme, pair: 'média : textMuted / panneau sur blanc', ratio: contrastRatio(m.textMuted, WORST_MEDIA, [m.noirElevated + 'F2']), min: AA_TEXT },
    ...feedOverlayRows(theme, c),
  ];
}

/**
 * Fil (app/(tabs)/index.tsx + VideoCard) : couleurs fixes sur la vidéo,
 * mesurées sur une vidéo blanche et sur une vidéo sombre.
 */
function feedOverlayRows(theme: string, c: ThemeColors): ContrastRow[] {
  const fade = [FEED_TOP_FADE.weakestUnderTabs];
  const chip = [MEDIA_OVERLAY.chipBackdrop];
  const rows: ContrastRow[] = [];
  for (const [bg, label] of [[WORST_MEDIA, 'blanc'], [DARK_MEDIA, 'sombre']] as const) {
    rows.push(
      // En-tête du fil : logo + onglet actif, onglets inactifs, soulignement.
      { theme, pair: `fil : onMedia (logo, onglet actif) / fondu haut sur ${label}`, ratio: contrastRatio(c.onMedia, bg, fade), min: AA_TEXT },
      { theme, pair: `fil : onMediaMuted (onglets) / fondu haut sur ${label}`, ratio: contrastRatio(c.onMediaMuted, bg, fade), min: AA_TEXT },
      { theme, pair: `fil : onMediaAccent (soulignement) / fondu haut sur ${label}`, ratio: contrastRatio(c.onMediaAccent, bg, fade), min: AA_LARGE },
      // VideoCard : pays / lieu, badges (18+, filtre, IA) et note de musique.
      { theme, pair: `vidéo : pays et lieu / puce sur ${label}`, ratio: contrastRatio(MEDIA_OVERLAY.label, bg, chip), min: AA_TEXT },
      { theme, pair: `vidéo : texte et icône des badges / puce sur ${label}`, ratio: contrastRatio(MEDIA_OVERLAY.accent, bg, chip), min: AA_TEXT },
      // Rail : « J'aime » et « Enregistré » actifs (icônes), sans aucun voile derrière.
      { theme, pair: `vidéo : j'aime / enregistré actifs (icône) / ${label}, sans voile`, ratio: contrastRatio(MEDIA_OVERLAY.activeIcon, bg), min: AA_LARGE },
    );
  }
  return rows;
}

const LABELS: Record<ThemeId, string> = {
  gallery: 'Galerie vivante',
  original: 'NIA Original',
  sable: 'Sable',
  terre: 'Terre',
  bronze: 'Bronze',
  nuit: 'Nuit',
  clair: 'Clair',
  auto: 'Auto',
};

export function themeContrastRows(): ContrastRow[] {
  const rows: ContrastRow[] = [];
  for (const id of THEME_IDS) {
    if (id === 'auto') {
      // Auto = Clair ou Original selon le système : les deux résolutions.
      for (const scheme of ['light', 'dark'] as const) {
        const c = resolveThemeColors('auto', scheme);
        const label = `Auto (${scheme === 'light' ? 'clair' : 'sombre'})`;
        rows.push(...paletteRows(label, c), ...mediaRows(label, c));
      }
      continue;
    }
    const c = resolveThemeColors(id, null);
    rows.push(...paletteRows(LABELS[id], c), ...mediaRows(LABELS[id], c));
  }
  return rows;
}

/** Tableau Markdown (thème, paire, ratio, seuil). */
export function contrastTableMarkdown(rows: ContrastRow[]): string {
  const lines = ['| Thème | Paire | Ratio | Seuil |', '|---|---|---:|---:|'];
  for (const r of rows) {
    const min = r.min > 0 ? `${r.min}:1` : 'info';
    const flag = r.min > 0 && r.ratio < r.min ? ' ❌' : '';
    lines.push(`| ${r.theme} | ${r.pair} | ${r.ratio.toFixed(2)}${flag} | ${min} |`);
  }
  return lines.join('\n');
}
