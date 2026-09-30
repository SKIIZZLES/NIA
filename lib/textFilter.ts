/**
 * Filtre de mots (migration 018) côté app.
 *
 * La liste des termes reste sur le serveur : l'app ne la lit jamais. Elle peut
 * seulement demander un verdict (`nia_check_text`) pour prévenir avant
 * d'envoyer. Le serveur applique le filtre dans tous les cas (anciens APK
 * compris) : ce module ne sert qu'à mieux expliquer ce qui va se passer.
 *
 * Sans 018 (RPC absente), sans réseau ou en mode démo : verdict « ok », et
 * l'app se comporte comme avant.
 */
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';

/** ok : rien à signaler ; masked : insultes masquées (*) ; held : en attente de vérification ; refused : pseudo refusé. */
export type TextVerdict = 'ok' | 'masked' | 'held' | 'refused';

export type TextField =
  | 'comment'
  | 'caption'
  | 'hashtags'
  | 'alt_text'
  | 'location_text'
  | 'display_name'
  | 'bio'
  | 'username'
  | 'live_title'
  | 'live_description';

const RANK: Record<TextVerdict, number> = { ok: 0, masked: 1, held: 2, refused: 3 };

/** Réponse du serveur → verdict ; toute valeur inattendue vaut « ok » (le serveur tranchera). */
export function parseVerdict(value: unknown): TextVerdict {
  return value === 'masked' || value === 'held' || value === 'refused' ? value : 'ok';
}

/** Le verdict le plus sévère d'une liste (refused > held > masked > ok). */
export function worstVerdict(verdicts: readonly TextVerdict[]): TextVerdict {
  return verdicts.reduce<TextVerdict>((acc, v) => (RANK[v] > RANK[acc] ? v : acc), 'ok');
}

/** RPC inconnue : 018 pas encore appliquée. */
export function isRpcMissing(error: unknown): boolean {
  const e = error as { code?: unknown; message?: unknown } | null;
  return e?.code === 'PGRST202' || e?.code === '42883';
}

/** Verdict du serveur pour un texte. Ne jette jamais. */
export async function checkText(text: string | null | undefined, field: TextField = 'comment'): Promise<TextVerdict> {
  const value = (text ?? '').trim();
  if (!value) return 'ok';
  const sb = getSupabase();
  if (!sb || !isSupabaseConfigured) return 'ok';
  try {
    const { data, error } = await sb.rpc('nia_check_text', { p_text: value, p_field: field });
    if (error) return 'ok';
    return parseVerdict(data);
  } catch {
    return 'ok';
  }
}

/** Verdict le plus sévère de plusieurs champs (les champs vides sont ignorés). */
export async function checkTexts(
  items: readonly { text: string | null | undefined; field: TextField }[],
): Promise<TextVerdict> {
  const filled = items.filter((i) => (i.text ?? '').trim() !== '');
  if (filled.length === 0) return 'ok';
  const verdicts = await Promise.all(filled.map((i) => checkText(i.text, i.field)));
  return worstVerdict(verdicts);
}

/** Pseudo refusé par le serveur (018 : `text_refused`, errcode 22023). */
export function isTextRefusedError(error: unknown): boolean {
  const e = error as { code?: unknown; message?: unknown } | null;
  return e?.code === '22023' && typeof e.message === 'string' && e.message.includes('text_refused');
}

/** Vidéo retenue par le filtre de mots (et non masquée après signalements). */
export function isKeywordHeld(item: { moderationState?: string | null; moderationReason?: string | null }): boolean {
  return item.moderationState === 'held' && item.moderationReason === 'auto:keywords';
}

export type ProfileFieldOutcome = 'saved' | 'masked' | 'pending';

/**
 * Compare le texte envoyé et celui que le serveur a enregistré.
 * Identique → saved ; même longueur avec des « * » à la place de lettres →
 * masked ; sinon le serveur a gardé l'ancienne valeur → pending (vérification).
 */
export function profileFieldOutcome(submitted: string, stored: string | null | undefined): ProfileFieldOutcome {
  const sent = Array.from(submitted.trim());
  const kept = Array.from((stored ?? '').trim());
  if (sent.join('') === kept.join('')) return 'saved';
  if (sent.length === kept.length) {
    let starred = false;
    for (let i = 0; i < sent.length; i += 1) {
      if (sent[i] === kept[i]) continue;
      if (kept[i] !== '*') return 'pending';
      starred = true;
    }
    if (starred) return 'masked';
  }
  return 'pending';
}
