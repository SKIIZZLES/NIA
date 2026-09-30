/**
 * Signalements — insert `reports` ; mock toast-friendly si offline / mock auth.
 */
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';
import type { ReportTargetType } from '@/types/database';

/**
 * `label` n'est PAS ce qui s'affiche — c'est ce qui est stocké dans
 * `reports.reason`. La valeur reste en français, stable, quelle que soit la
 * langue de qui signale : la modération lit une colonne, pas vingt. L'affichage
 * passe par les clés `report.*` (voir components/ReportSheet.tsx).
 */
export const REPORT_REASONS = [
  { id: 'spam', label: 'Spam' },
  { id: 'harcelement', label: 'Harcèlement' },
  { id: 'illegal', label: 'Contenu illégal' },
  { id: 'autre', label: 'Autre' },
] as const;

export type ReportReasonId = (typeof REPORT_REASONS)[number]['id'];

export type ReportResult =
  | { ok: true; mock: boolean }
  /** Clé i18n, pas une phrase : l'appelant traduit dans la langue en cours. */
  | { ok: false; errorKey: 'report.errorNetwork' | 'report.errorSend' };

function isUuid(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    id,
  );
}

/** Crée un signalement. Mode mock / sans auth réelle → succès mock (pas d'insert). */
export async function createReport(input: {
  reporterId: string | undefined | null;
  targetType: ReportTargetType;
  targetId: string;
  reason: ReportReasonId | string;
}): Promise<ReportResult> {
  const reasonLabel =
    REPORT_REASONS.find((r) => r.id === input.reason)?.label ||
    String(input.reason || 'Autre');

  const sb = getSupabase();
  const canPersist =
    !!sb &&
    isSupabaseConfigured &&
    !!input.reporterId &&
    !input.reporterId.startsWith('mock_') &&
    isUuid(input.targetId);

  if (!canPersist) {
    return { ok: true, mock: true };
  }

  try {
    const { error } = await sb!.from('reports').insert({
      reporter_id: input.reporterId!,
      target_type: input.targetType,
      target_id: input.targetId,
      reason: reasonLabel,
      status: 'open',
    });
    if (error) {
      const reseau =
        error.message?.includes('network') || error.message?.includes('fetch');
      return { ok: false, errorKey: reseau ? 'report.errorNetwork' : 'report.errorSend' };
    }
    return { ok: true, mock: false };
  } catch {
    return { ok: false, errorKey: 'report.errorSend' };
  }
}

export { isSupabaseConfigured };
