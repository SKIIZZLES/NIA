/**
 * Signalements v2 (migration 017) — 10 catégories, précisions, preuves.
 *
 * Tant que 017 n'est pas appliquée, l'app retombe sur l'ancien schéma : le
 * motif est stocké dans `reports.reason` sous la forme « Libellé — précisions »
 * (017 sait le reclasser à l'application). Signaler un live exige 017 : sans
 * elle, l'app affiche « indisponible » au lieu d'échouer.
 */
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';
import type { ReportTargetType } from '@/types/database';

/**
 * `labelFr` n'est PAS ce qui s'affiche : c'est la valeur stable écrite dans
 * `reports.reason` (lue par la modération et par 017). L'affichage passe par
 * `key` (i18n). Ordre = ordre d'affichage.
 */
export const REPORT_CATEGORIES = [
  { id: 'insultes_harcelement', labelFr: 'Insultes / harcèlement', priority: 3, key: 'report.catInsults' },
  { id: 'nudite_sexuel', labelFr: 'Nudité / contenu sexuel', priority: 2, key: 'report.catNudity' },
  { id: 'actes_inhumains', labelFr: 'Actes inhumains', priority: 2, key: 'report.catInhuman' },
  { id: 'negrophobie', labelFr: 'Négrophobie', priority: 3, key: 'report.catNegrophobia' },
  { id: 'racisme_haine', labelFr: 'Racisme / haine', priority: 3, key: 'report.catRacism' },
  { id: 'homophobie', labelFr: 'Propos homophobes', priority: 3, key: 'report.catHomophobia' },
  { id: 'pedocriminalite', labelFr: 'Pédocriminalité', priority: 0, key: 'report.catChild' },
  { id: 'spam', labelFr: 'Spam', priority: 4, key: 'report.catSpam' },
  { id: 'menace_danger', labelFr: 'Menace / danger immédiat', priority: 1, key: 'report.catThreat' },
  { id: 'injustice_autre', labelFr: 'Injustice / autre', priority: 4, key: 'report.catOther' },
] as const;

export type ReportCategoryId = (typeof REPORT_CATEGORIES)[number]['id'];

/** Catégorie P0 : masquage immédiat, écran PHAROS / 119 / 17, aucune pièce jointe. */
export const P0_CATEGORY: ReportCategoryId = 'pedocriminalite';

export const REPORT_DETAILS_MAX = 1000;
export const EVIDENCE_MAX_FILES = 3;
export const EVIDENCE_MAX_BYTES = 20 * 1024 * 1024;
export const EVIDENCE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
  'video/quicktime',
] as const;

export function isReportCategory(id: unknown): id is ReportCategoryId {
  return REPORT_CATEGORIES.some((c) => c.id === id);
}

export function reportCategory(id: string) {
  return REPORT_CATEGORIES.find((c) => c.id === id);
}

/** Clé i18n d'une catégorie (catégorie inconnue → « autre »). */
export function reportCategoryKey(id: string | null | undefined): string {
  return reportCategory(id ?? '')?.key ?? 'report.catOther';
}

export function allowsEvidence(category: ReportCategoryId): boolean {
  return category !== P0_CATEGORY;
}

/** Ancien schéma : `reason` = libellé français + « — précisions » (≤ 1000). */
export function legacyReason(category: ReportCategoryId, details?: string | null): string {
  const label = reportCategory(category)?.labelFr ?? 'Injustice / autre';
  const d = (details ?? '').trim();
  return d ? `${label} — ${d}`.slice(0, REPORT_DETAILS_MAX + label.length + 3) : label;
}

export type ReportErrorKey =
  | 'report.errorNetwork'
  | 'report.errorSend'
  | 'report.rateLimited'
  | 'report.notFound'
  | 'report.selfReport'
  | 'report.unavailable'
  | 'report.signInRequired';

export type ReportResult =
  | {
      ok: true;
      mock: boolean;
      /** Id du signalement créé (null si mock, ancien schéma ou déjà signalé). */
      reportId: string | null;
      /** 017 appliquée : preuves possibles, catégorie en colonne. */
      v2: boolean;
      alreadyReported: boolean;
    }
  /** Clé i18n, pas une phrase : l'appelant traduit dans la langue en cours. */
  | { ok: false; errorKey: ReportErrorKey };

type PgError = { code?: string | null; message?: string | null } | null | undefined;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(id: string): boolean {
  return UUID_RE.test(id);
}

/** Colonne inconnue côté PostgREST / Postgres → 017 pas encore appliquée. */
export function isMissingSchema(error: PgError): boolean {
  const code = error?.code ?? '';
  const msg = (error?.message ?? '').toLowerCase();
  return (
    code === 'PGRST204' ||
    code === '42703' ||
    code === 'PGRST205' ||
    code === '42P01' ||
    (msg.includes('column') && msg.includes('does not exist')) ||
    msg.includes('schema cache')
  );
}

export function isNetworkError(error: PgError | unknown): boolean {
  const msg = String((error as { message?: unknown } | null)?.message ?? '').toLowerCase();
  return msg.includes('network') || msg.includes('fetch') || msg.includes('timeout');
}

/** Code SQL / PostgREST → message traduisible. */
export function reportErrorKey(error: PgError): ReportErrorKey {
  switch (error?.code) {
    case '54000':
      return 'report.rateLimited';
    case 'P0002':
      return 'report.notFound';
    case '22023':
      return (error?.message ?? '').includes('report_self') ? 'report.selfReport' : 'report.errorSend';
    case '23514':
      // ancien schéma : target_type 'live' refusé par la contrainte CHECK
      return 'report.unavailable';
    default:
      return isNetworkError(error) ? 'report.errorNetwork' : 'report.errorSend';
  }
}

/** Mémorisé pour la session : 017 appliquée ou non (null = inconnu). */
let schemaV2: boolean | null = null;
/** Tests uniquement. */
export function __resetReportSchemaCache(): void {
  schemaV2 = null;
}

/** Crée un signalement. Mode mock / sans auth réelle → succès mock (pas d'insert). */
export async function createReport(input: {
  reporterId: string | undefined | null;
  targetType: ReportTargetType;
  targetId: string;
  category: ReportCategoryId;
  details?: string | null;
}): Promise<ReportResult> {
  const sb = getSupabase();
  const details = (input.details ?? '').trim().slice(0, REPORT_DETAILS_MAX) || null;
  const category = isReportCategory(input.category) ? input.category : 'injustice_autre';

  if (!sb || !isSupabaseConfigured || !isUuid(input.targetId)) {
    return { ok: true, mock: true, reportId: null, v2: false, alreadyReported: false };
  }
  if (!input.reporterId || input.reporterId.startsWith('mock_')) {
    return { ok: false, errorKey: 'report.signInRequired' };
  }

  const already = (v2: boolean): ReportResult => ({
    ok: true,
    mock: false,
    reportId: null,
    v2,
    alreadyReported: true,
  });

  try {
    if (schemaV2 !== false) {
      const { data, error } = await sb
        .from('reports')
        .insert({
          reporter_id: input.reporterId,
          target_type: input.targetType,
          target_id: input.targetId,
          category,
          details,
        } as never)
        .select('id')
        .single();
      if (!error) {
        schemaV2 = true;
        const id = (data as { id?: string } | null)?.id ?? null;
        return { ok: true, mock: false, reportId: id, v2: true, alreadyReported: false };
      }
      if (error.code === '23505') return already(true);
      if (!isMissingSchema(error)) return { ok: false, errorKey: reportErrorKey(error) };
      schemaV2 = false;
    }

    // Ancien schéma (017 non appliquée).
    if (input.targetType === 'live' || input.targetType === 'live_comment') {
      return { ok: false, errorKey: 'report.unavailable' };
    }
    const { error } = await sb.from('reports').insert({
      reporter_id: input.reporterId,
      target_type: input.targetType,
      target_id: input.targetId,
      reason: legacyReason(category, details),
      status: 'open',
    });
    if (error) {
      if (error.code === '23505') return already(false);
      return { ok: false, errorKey: reportErrorKey(error) };
    }
    return { ok: true, mock: false, reportId: null, v2: false, alreadyReported: false };
  } catch (e) {
    return { ok: false, errorKey: isNetworkError(e) ? 'report.errorNetwork' : 'report.errorSend' };
  }
}

export type EvidenceFile = {
  localUri: string;
  mimeType?: string | null;
  fileName?: string | null;
  size?: number | null;
  mediaKind?: 'image' | 'video' | null;
};

export type EvidenceCheck =
  | { ok: true; contentType: (typeof EVIDENCE_MIME_TYPES)[number]; ext: string }
  | { ok: false; errorKey: 'report.evidenceTooLarge' | 'report.evidenceType' };

const EXT_BY_MIME: Record<(typeof EVIDENCE_MIME_TYPES)[number], string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
};
const MIME_BY_EXT: Record<string, (typeof EVIDENCE_MIME_TYPES)[number]> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
};

/** Type et taille d'une pièce jointe (miroir des contraintes SQL de 017). */
export function checkEvidence(file: EvidenceFile): EvidenceCheck {
  if (file.size != null && file.size > EVIDENCE_MAX_BYTES) {
    return { ok: false, errorKey: 'report.evidenceTooLarge' };
  }
  let mime = (file.mimeType ?? '').split(';')[0].trim().toLowerCase();
  if (mime === 'image/jpg') mime = 'image/jpeg';
  if (!(EVIDENCE_MIME_TYPES as readonly string[]).includes(mime)) {
    const name = file.fileName || file.localUri || '';
    const ext = name.split('?')[0].split('.').pop()?.toLowerCase() ?? '';
    mime = MIME_BY_EXT[ext] ?? '';
  }
  if (!mime) return { ok: false, errorKey: 'report.evidenceType' };
  const contentType = mime as (typeof EVIDENCE_MIME_TYPES)[number];
  return { ok: true, contentType, ext: EXT_BY_MIME[contentType] };
}

function randomId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Chemin Storage imposé par 017 : `{reporter}/{report}/{uuid}.{ext}`. */
export function evidencePath(reporterId: string, reportId: string, ext: string): string {
  return `${reporterId}/${reportId}/${randomId()}.${ext}`;
}

export type EvidenceUploadResult = {
  uploaded: number;
  failed: number;
  errorKey?: 'report.evidenceTooLarge' | 'report.evidenceType' | 'report.evidenceFailed';
};

/**
 * Joint jusqu'à 3 fichiers à un signalement v2 (bucket privé report-evidence,
 * lisible par les modérateurs seulement). Un échec n'annule pas le
 * signalement : il est déjà enregistré.
 */
export async function uploadReportEvidence(input: {
  reporterId: string;
  reportId: string;
  files: EvidenceFile[];
  upload: (args: {
    bucket: string;
    path: string;
    localUri: string;
    contentType: string;
    accessToken: string;
  }) => Promise<void>;
  localFileSize?: (uri: string) => number | null;
}): Promise<EvidenceUploadResult> {
  const sb = getSupabase();
  const result: EvidenceUploadResult = { uploaded: 0, failed: 0 };
  if (!sb || !isUuid(input.reportId)) return { ...result, failed: input.files.length };
  const { data: sessionData } = await sb.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token || sessionData.session?.user?.id !== input.reporterId) {
    return { ...result, failed: input.files.length, errorKey: 'report.evidenceFailed' };
  }

  for (const file of input.files.slice(0, EVIDENCE_MAX_FILES)) {
    const size = input.localFileSize?.(file.localUri) ?? file.size ?? null;
    const check = checkEvidence({ ...file, size });
    if (!check.ok) {
      result.failed++;
      result.errorKey = check.errorKey;
      continue;
    }
    const path = evidencePath(input.reporterId, input.reportId, check.ext);
    try {
      await input.upload({
        bucket: 'report-evidence',
        path,
        localUri: file.localUri,
        contentType: check.contentType,
        accessToken: token,
      });
      const { error } = await sb.from('report_evidence' as never).insert({
        report_id: input.reportId,
        storage_path: path,
        mime_type: check.contentType,
        size_bytes: size && size > 0 ? size : 1,
      } as never);
      if (error) throw error;
      result.uploaded++;
    } catch {
      result.failed++;
      result.errorKey = result.errorKey ?? 'report.evidenceFailed';
    }
  }
  return result;
}

export { isSupabaseConfigured };
