/**
 * Options de publication (sprint S5, migration 016) — logique pure.
 *
 * Si 016 n'est pas appliquée, les colonnes n'existent pas : la publication
 * réessaie sans elles, SAUF si une option restreint la diffusion (abonnés,
 * privé, commentaires ou republication désactivés). Publier alors en public
 * trahirait le choix de l'utilisateur : la publication est refusée avec un
 * message clair.
 */
import type { EditMeta } from '@/lib/editMeta';
import type { VideoVisibility } from '@/types/database';

export const MAX_ALT_TEXT = 500;
export const MAX_LOCATION_TEXT = 100;

export type PublishOptions = {
  visibility: VideoVisibility;
  allowComments: boolean;
  allowReuse: boolean;
  aiGenerated: boolean;
  altText: string;
  locationText: string;
};

export const DEFAULT_PUBLISH_OPTIONS: PublishOptions = {
  visibility: 'public',
  allowComments: true,
  allowReuse: true,
  aiGenerated: false,
  altText: '',
  locationText: '',
};

/** Colonnes ajoutées par 016. */
export const PUBLISH_OPTION_COLUMNS = [
  'visibility',
  'allow_comments',
  'allow_reuse',
  'ai_generated',
  'alt_text',
  'location_text',
  'edit_meta',
] as const;

function clip(s: string, max: number): string | null {
  const t = s.replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const chars = Array.from(t);
  return chars.length > max ? chars.slice(0, max).join('') : t;
}

/** Champs 016 de l'insert `videos`. */
export function publishOptionsPayload(
  opts: PublishOptions,
  editMeta: EditMeta | null,
): Record<(typeof PUBLISH_OPTION_COLUMNS)[number], unknown> {
  return {
    visibility: opts.visibility,
    allow_comments: opts.allowComments,
    // Une vidéo non publique n'est jamais republiable (garde-fou 016 aussi).
    allow_reuse: opts.visibility === 'public' ? opts.allowReuse : false,
    ai_generated: opts.aiGenerated,
    alt_text: clip(opts.altText, MAX_ALT_TEXT),
    location_text: clip(opts.locationText, MAX_LOCATION_TEXT),
    edit_meta: editMeta,
  };
}

/** Le choix restreint la diffusion : impossible à honorer sans 016. */
export function hasRestrictiveOptions(opts: PublishOptions): boolean {
  return opts.visibility !== 'public' || !opts.allowComments || !opts.allowReuse;
}

/**
 * Erreur PostgREST / Postgres « colonne inconnue » portant sur une colonne
 * de 016 (migration pas encore appliquée).
 */
export function isMissingPublishOptionsColumn(
  err: { code?: string | null; message?: string | null } | null | undefined,
): boolean {
  if (!err) return false;
  const code = err.code ?? '';
  const msg = (err.message ?? '').toLowerCase();
  const columnError =
    code === 'PGRST204' || code === '42703' || msg.includes('schema cache') || msg.includes('column');
  return columnError && PUBLISH_OPTION_COLUMNS.some((c) => msg.includes(c));
}

/** La vidéo peut-elle être republiée (bouton « Republier ») ? */
export function canRepostItem(item: {
  visibility?: VideoVisibility;
  allowReuse?: boolean;
}): boolean {
  return (item.visibility ?? 'public') === 'public' && item.allowReuse !== false;
}

/** Remplace le mot en cours (#… ou @…) par la suggestion choisie. */
export function currentMentionToken(
  text: string,
  cursor: number = text.length,
): { kind: '#' | '@'; query: string; start: number; end: number } | null {
  const before = text.slice(0, cursor);
  const m = before.match(/(^|\s)([#@])([\w\u00C0-\u024F.]{0,30})$/);
  if (!m) return null;
  const start = before.length - m[3].length - 1;
  return { kind: m[2] as '#' | '@', query: m[3].toLowerCase(), start, end: cursor };
}

export function applyMention(
  text: string,
  token: { kind: '#' | '@'; start: number; end: number },
  value: string,
): { text: string; cursor: number } {
  const insert = `${token.kind}${value} `;
  const next = text.slice(0, token.start) + insert + text.slice(token.end).replace(/^\s+/, '');
  return { text: next, cursor: token.start + insert.length };
}
