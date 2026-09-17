/**
 * Limites client-side pour la publication (MVP, budget 0 €).
 * Ajustables sans toucher à Supabase.
 */

/** Durée max vidéo (secondes) — ImagePicker fournit `duration` en ms */
export const MAX_VIDEO_DURATION_SEC = 60;

/** Taille max fichier (octets) — ~50 Mo, aligné Free Storage confort */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/** Statut écrit à l’insert (pas de transcoder → published direct) */
export const PUBLISH_STATUS = 'published' as const;

/** Statut stub si un jour on branche un pipeline */
export const PROCESSING_STATUS = 'processing' as const;

export const PUBLISH_ERRORS = {
  noMedia: 'Sélectionnez une vidéo ou une image à publier.',
  tooLarge: `Le fichier dépasse la taille maximale (${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} Mo).`,
  tooLong: `La vidéo dépasse la durée maximale (${MAX_VIDEO_DURATION_SEC} s).`,
  categoryRequired: 'Choisissez une catégorie pour votre publication.',
} as const;

/** Extrait les #hashtags d’une légende (sans le #, en minuscules, uniques). */
export function parseHashtags(caption: string): string[] {
  const matches = caption.match(/#[\w\u00C0-\u024F]+/g) || [];
  const tags = matches.map((t) => t.slice(1).toLowerCase());
  return [...new Set(tags)];
}
