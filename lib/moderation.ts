/**
 * Modération (migration 017) côté app : notifications système traduites,
 * suspension du compte, bannières. Tout est optionnel : sans 017, les
 * colonnes `meta`, `suspended_until`, `moderation_state` sont absentes et
 * rien ne s'affiche.
 */
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';
import { reportCategoryKey } from '@/lib/reports';

export const SYSTEM_NOTIFICATION_TYPES = [
  'report_received',
  'report_decision',
  'moderation_notice',
] as const;

export type SystemNotificationType = (typeof SYSTEM_NOTIFICATION_TYPES)[number];

export function isSystemNotification(type: string | null | undefined): type is SystemNotificationType {
  return (SYSTEM_NOTIFICATION_TYPES as readonly string[]).includes(type ?? '');
}

type NotificationLike = {
  type: string;
  body?: string | null;
  meta?: Record<string, unknown> | null;
};

function metaString(n: NotificationLike, key: string): string | null {
  const v = n.meta?.[key];
  return typeof v === 'string' ? v : null;
}

export type SystemText = {
  /** Clé i18n du texte court (liste). */
  key: string;
  /** Clé i18n de l'explication (au toucher). */
  detailsKey: string;
  /** Clé i18n de la catégorie, à traduire puis passer en %{category}. */
  categoryKey: string;
  /** true : afficher l'adresse de contestation. */
  contest: boolean;
};

/**
 * Texte d'une notification système, d'après `meta.code` (017). null →
 * code inconnu : l'appelant affiche `body` (français, écrit par le serveur).
 */
export function systemNotificationText(n: NotificationLike): SystemText | null {
  if (!isSystemNotification(n.type)) return null;
  const code = metaString(n, 'code');
  const categoryKey = reportCategoryKey(metaString(n, 'category'));
  const base = { categoryKey };
  switch (n.type) {
    case 'report_received':
      return { ...base, key: 'moderation.notifReportReceived', detailsKey: 'moderation.detailsReport', contest: false };
    case 'report_decision':
      if (code === 'actioned') {
        return { ...base, key: 'moderation.notifReportActioned', detailsKey: 'moderation.detailsReport', contest: false };
      }
      if (code === 'dismissed') {
        return { ...base, key: 'moderation.notifReportDismissed', detailsKey: 'moderation.detailsReport', contest: false };
      }
      return null;
    case 'moderation_notice':
      switch (code) {
        case 'held':
          return { ...base, key: 'moderation.notifContentHeld', detailsKey: 'moderation.detailsHeld', contest: true };
        case 'removed':
          return { ...base, key: 'moderation.notifContentRemoved', detailsKey: 'moderation.detailsRemoved', contest: true };
        case 'restored':
          return { ...base, key: 'moderation.notifContentRestored', detailsKey: 'moderation.detailsRestored', contest: false };
        case 'warned':
          return { ...base, key: 'moderation.notifContentWarned', detailsKey: 'moderation.detailsWarned', contest: true };
        case 'suspended':
          return { ...base, key: 'moderation.notifContentSuspended', detailsKey: 'moderation.detailsSuspended', contest: true };
        default:
          return null;
      }
    default:
      return null;
  }
}

/** Suspension en cours ? (`suspended_until` dans le futur). */
export function isSuspended(until: string | null | undefined, now = Date.now()): boolean {
  if (!until) return false;
  const ts = Date.parse(until);
  return Number.isFinite(ts) && ts > now;
}

export type OwnModerationStatus = { suspendedUntil: string | null };

/** Statut de son propre compte. `null` si indisponible (réseau, pas de 017). */
export async function fetchOwnModerationStatus(userId: string): Promise<OwnModerationStatus | null> {
  const sb = getSupabase();
  if (!sb || !isSupabaseConfigured || !userId || userId.startsWith('mock_')) return null;
  try {
    // `*` : suspended_until n'existe qu'après 017 (pas d'erreur avant).
    const { data, error } = await sb.from('profiles').select('*').eq('id', userId).maybeSingle();
    if (error || !data) return null;
    const until = (data as { suspended_until?: unknown }).suspended_until;
    return { suspendedUntil: typeof until === 'string' ? until : null };
  } catch {
    return null;
  }
}

/**
 * Erreur d'écriture renvoyée par le serveur (017) → clé i18n lisible.
 * 42501 : action refusée (blocage, contenu masqué, commentaires fermés).
 * 54000 : limite de débit.
 */
export function writeErrorKey(error: unknown): 'moderation.notAllowed' | 'moderation.rateLimited' | null {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === '42501') return 'moderation.notAllowed';
  if (code === '54000') return 'moderation.rateLimited';
  return null;
}
