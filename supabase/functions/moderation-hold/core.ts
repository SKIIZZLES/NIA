/**
 * Logique pure du worker moderation-hold (migration 017, section 8).
 *
 * Quand une vidéo est masquée (P0, 3 signaleurs, décision), sa ligne
 * public.moderation_file_holds passe à desired = 'held'. Le bucket `videos`
 * est PUBLIC : tant que le fichier y reste, son URL directe fonctionne. Ce
 * worker :
 *   - hold    : copie les fichiers dans le bucket privé `moderation-hold`
 *               (`{owner}/{video}/{i}_{nom}`), vérifie la copie, puis les
 *               retire de `videos` ;
 *   - release : contenu rétabli → recopie dans `videos` au même chemin, puis
 *               supprime la copie ;
 *   - purge   : échéance de conservation (90 / 180 jours) → supprime la copie
 *               (et tout reste éventuel dans `videos`) ;
 *   - preuves : supprime les pièces jointes échues du bucket `report-evidence`.
 *
 * Aucune API Deno, aucun import réseau : importé par index.ts ET par Jest.
 * Journalisation : identifiants de vidéo / compteurs / codes UNIQUEMENT.
 */

export const SOURCE_BUCKET = 'videos';
export const HOLD_BUCKET = 'moderation-hold';
export const EVIDENCE_BUCKET = 'report-evidence';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type HoldAction = 'hold' | 'release' | 'purge';
export type HoldResult = 'held' | 'public' | 'purged' | 'missing';

/** Ligne renvoyée par public.moderation_files_claim. */
export type HoldJob = {
  video_id: string;
  owner_id: string;
  paths: string[];
  action: HoldAction;
  attempts: number;
};

export type EvidenceItem = { id: string; storage_path: string };

export interface StorageGateway {
  exists(bucket: string, path: string): Promise<boolean>;
  copy(fromBucket: string, fromPath: string, toBucket: string, toPath: string): Promise<void>;
  /** Renvoie le nombre d'objets supprimés. */
  remove(bucket: string, paths: string[]): Promise<number>;
}

export interface HoldQueue {
  claim(batch: number): Promise<HoldJob[]>;
  complete(videoId: string, result: HoldResult): Promise<boolean>;
  fail(videoId: string, code: string): Promise<boolean>;
  evidenceDue(limit: number): Promise<EvidenceItem[]>;
  evidenceMarkPurged(ids: string[]): Promise<number>;
}

export type LogFields = Record<string, string | number | boolean>;
export type Logger = (event: string, fields: LogFields) => void;

export class HoldError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = 'HoldError';
    this.code = sanitizeCode(code);
  }
}

export function sanitizeCode(raw: string): string {
  const cleaned = String(raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9_:.-]/g, '_')
    .slice(0, 80);
  return cleaned || 'unknown';
}

/** Statut HTTP ou code court seulement, jamais `message` (chemins = user_id). */
export function errorCode(prefix: string, err: unknown): string {
  if (err instanceof HoldError) return err.code;
  const e = (err ?? {}) as { status?: unknown; statusCode?: unknown; code?: unknown };
  const status = typeof e.status === 'number' ? e.status : Number(e.statusCode);
  if (Number.isInteger(status) && status > 0) return sanitizeCode(`${prefix}:${status}`);
  if (typeof e.code === 'string' && /^[A-Z0-9]{3,10}$/i.test(e.code)) {
    return sanitizeCode(`${prefix}:${e.code}`);
  }
  return sanitizeCode(`${prefix}:unknown`);
}

export function timingSafeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  const len = Math.max(ea.length, eb.length);
  for (let i = 0; i < len; i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

export function isSecretConfigured(secret: string | null | undefined): boolean {
  return typeof secret === 'string' && secret.trim().length >= 32;
}

export function isAuthorized(
  header: string | null | undefined,
  secret: string | null | undefined,
): boolean {
  if (!isSecretConfigured(secret) || typeof header !== 'string' || header.length === 0) {
    return false;
  }
  return timingSafeEqual(header, secret as string);
}

/** Chemin sous `{owner}/`, sans `..`, `//`, ni caractère de contrôle. */
export function isSafePath(owner: string, path: string): boolean {
  return (
    typeof path === 'string' &&
    path.length > owner.length + 1 &&
    path.length <= 512 &&
    path.startsWith(`${owner}/`) &&
    !path.split('/').some((seg) => seg === '' || seg === '.' || seg === '..') &&
    !/[\u0000-\u001f\\]/.test(path)
  );
}

/** Défense en profondeur : job cohérent avec le schéma SQL. */
export function isSafeJob(job: HoldJob): boolean {
  if (!job || !UUID_RE.test(job.video_id ?? '') || !UUID_RE.test(job.owner_id ?? '')) return false;
  if (!['hold', 'release', 'purge'].includes(job.action)) return false;
  if (!Array.isArray(job.paths) || job.paths.length > 10) return false;
  const owner = job.owner_id.toLowerCase();
  return job.paths.every((p) => isSafePath(owner, p));
}

/** Copie privée : `{owner}/{video}/{i}_{nom}` (le rang évite les collisions). */
export function holdPath(job: HoldJob, index: number): string {
  const original = job.paths[index];
  const base = original.slice(original.lastIndexOf('/') + 1);
  return `${job.owner_id.toLowerCase()}/${job.video_id.toLowerCase()}/${index}_${base}`;
}

/** Pièce jointe : `{reporter}/{report}/{fichier}`. */
export function isSafeEvidencePath(path: string): boolean {
  const parts = typeof path === 'string' ? path.split('/') : [];
  return (
    parts.length === 3 &&
    UUID_RE.test(parts[0]) &&
    UUID_RE.test(parts[1]) &&
    /^[A-Za-z0-9._-]{1,120}$/.test(parts[2]) &&
    parts[2] !== '.' &&
    parts[2] !== '..'
  );
}

/** Mise à l'abri : copie vérifiée AVANT toute suppression dans `videos`. */
export async function holdFiles(storage: StorageGateway, job: HoldJob): Promise<HoldResult> {
  let present = 0;
  const toRemove: string[] = [];
  for (let i = 0; i < job.paths.length; i++) {
    const src = job.paths[i];
    const dst = holdPath(job, i);
    const inSource = await storage.exists(SOURCE_BUCKET, src);
    let inHold = await storage.exists(HOLD_BUCKET, dst);
    if (inSource && !inHold) {
      await storage.copy(SOURCE_BUCKET, src, HOLD_BUCKET, dst);
      inHold = await storage.exists(HOLD_BUCKET, dst);
      if (!inHold) throw new HoldError('copy_not_verified');
    }
    if (inHold) present++;
    if (inSource) toRemove.push(src);
  }
  if (toRemove.length > 0) {
    await storage.remove(SOURCE_BUCKET, toRemove);
    for (const src of toRemove) {
      if (await storage.exists(SOURCE_BUCKET, src)) throw new HoldError('source_still_public');
    }
  }
  return present > 0 ? 'held' : 'missing';
}

/** Rétablissement : recopie vérifiée AVANT suppression de la copie privée. */
export async function releaseFiles(storage: StorageGateway, job: HoldJob): Promise<HoldResult> {
  let present = 0;
  const toRemove: string[] = [];
  for (let i = 0; i < job.paths.length; i++) {
    const dst = job.paths[i];
    const src = holdPath(job, i);
    const inHold = await storage.exists(HOLD_BUCKET, src);
    let inSource = await storage.exists(SOURCE_BUCKET, dst);
    if (inHold && !inSource) {
      await storage.copy(HOLD_BUCKET, src, SOURCE_BUCKET, dst);
      inSource = await storage.exists(SOURCE_BUCKET, dst);
      if (!inSource) throw new HoldError('restore_not_verified');
    }
    if (inSource) present++;
    if (inHold) toRemove.push(src);
  }
  if (toRemove.length > 0) await storage.remove(HOLD_BUCKET, toRemove);
  return present > 0 ? 'public' : 'missing';
}

/** Échéance : suppression définitive (copie privée + reste éventuel public). */
export async function purgeFiles(storage: StorageGateway, job: HoldJob): Promise<HoldResult> {
  const held = job.paths.map((_, i) => holdPath(job, i));
  if (held.length > 0) await storage.remove(HOLD_BUCKET, held);
  const leftovers: string[] = [];
  for (const p of job.paths) if (await storage.exists(SOURCE_BUCKET, p)) leftovers.push(p);
  if (leftovers.length > 0) await storage.remove(SOURCE_BUCKET, leftovers);
  for (const p of held) if (await storage.exists(HOLD_BUCKET, p)) throw new HoldError('hold_copy_remaining');
  return 'purged';
}

export type JobOutcome = {
  videoId: string;
  action: HoldAction;
  status: 'done' | 'failed';
  result?: HoldResult;
  code?: string;
};

export type RunSummary = {
  claimed: number;
  done: number;
  failed: number;
  jobs: JobOutcome[];
  evidencePurged: number;
  error?: string;
};

export type RunOptions = {
  batch?: number;
  evidenceLimit?: number;
  budgetMs?: number;
  now?: () => number;
};

export async function processHolds(
  queue: HoldQueue,
  storage: StorageGateway,
  log: Logger,
  opts: RunOptions = {},
): Promise<RunSummary> {
  const now = opts.now ?? (() => Date.now());
  const deadline = now() + (opts.budgetMs ?? 110_000);
  const summary: RunSummary = { claimed: 0, done: 0, failed: 0, jobs: [], evidencePurged: 0 };

  let jobs: HoldJob[] = [];
  try {
    jobs = await queue.claim(opts.batch ?? 5);
  } catch (err) {
    summary.error = errorCode('rpc_claim_failed', err);
    log('claim_failed', { code: summary.error });
  }
  summary.claimed = jobs.length;
  log('claimed', { count: jobs.length });

  for (const job of jobs) {
    let outcome: JobOutcome;
    try {
      if (!isSafeJob(job)) throw new HoldError('unsafe_job');
      if (now() > deadline) throw new HoldError('deadline_exceeded');
      const result =
        job.action === 'hold'
          ? await holdFiles(storage, job)
          : job.action === 'release'
            ? await releaseFiles(storage, job)
            : await purgeFiles(storage, job);
      const ok = await queue.complete(job.video_id, result);
      if (!ok) throw new HoldError('complete_rejected');
      outcome = { videoId: job.video_id, action: job.action, status: 'done', result };
      log('job_done', { videoId: job.video_id, action: job.action, result, attempt: job.attempts });
    } catch (err) {
      const code = errorCode('storage_error', err);
      outcome = { videoId: job.video_id, action: job.action, status: 'failed', code };
      try {
        await queue.fail(job.video_id, code);
      } catch (failErr) {
        log('fail_mark_failed', { videoId: job.video_id, code: errorCode('rpc_fail_failed', failErr) });
      }
      log('job_failed', { videoId: job.video_id, action: job.action, code, attempt: job.attempts });
    }
    summary.jobs.push(outcome);
    if (outcome.status === 'done') summary.done++;
    else summary.failed++;
  }

  // Pièces jointes échues (90 / 180 jours).
  if (now() <= deadline) {
    try {
      const due = await queue.evidenceDue(opts.evidenceLimit ?? 50);
      const safe = due.filter((e) => UUID_RE.test(e.id) && isSafeEvidencePath(e.storage_path));
      if (safe.length !== due.length) log('evidence_skipped', { count: due.length - safe.length });
      if (safe.length > 0) {
        await storage.remove(EVIDENCE_BUCKET, safe.map((e) => e.storage_path));
        const gone: string[] = [];
        for (const e of safe) if (!(await storage.exists(EVIDENCE_BUCKET, e.storage_path))) gone.push(e.id);
        summary.evidencePurged = gone.length > 0 ? await queue.evidenceMarkPurged(gone) : 0;
      }
      log('evidence_done', { purged: summary.evidencePurged });
    } catch (err) {
      const code = errorCode('evidence_error', err);
      summary.error = summary.error ?? code;
      log('evidence_failed', { code });
    }
  }
  return summary;
}

// ---------------------------------------------------------------------------
// Adaptateurs supabase-js (typage structurel)
// ---------------------------------------------------------------------------

type ApiResult<T> = { data: T | null; error: unknown };

export interface StorageClientLike {
  storage: {
    from(bucket: string): {
      list(
        path: string,
        options: { limit: number; offset: number; search: string },
      ): Promise<ApiResult<{ name: string; id: string | null }[]>>;
      copy(
        fromPath: string,
        toPath: string,
        options?: { destinationBucket?: string },
      ): Promise<ApiResult<unknown>>;
      remove(paths: string[]): Promise<ApiResult<unknown[]>>;
    };
  };
}

export interface RpcClientLike {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<ApiResult<unknown>>;
}

export function makeStorageGateway(client: StorageClientLike): StorageGateway {
  return {
    async exists(bucket, path) {
      const slash = path.lastIndexOf('/');
      const folder = slash >= 0 ? path.slice(0, slash) : '';
      const name = path.slice(slash + 1);
      const { data, error } = await client.storage
        .from(bucket)
        .list(folder, { limit: 100, offset: 0, search: name });
      if (error) throw new HoldError(errorCode('storage_list_failed', error));
      return (data ?? []).some((e) => e.name === name && e.id !== null);
    },
    async copy(fromBucket, fromPath, toBucket, toPath) {
      const { error } = await client.storage
        .from(fromBucket)
        .copy(fromPath, toPath, { destinationBucket: toBucket });
      if (error) throw new HoldError(errorCode('storage_copy_failed', error));
    },
    async remove(bucket, paths) {
      const { data, error } = await client.storage.from(bucket).remove(paths);
      if (error) throw new HoldError(errorCode('storage_remove_failed', error));
      return Array.isArray(data) ? data.length : 0;
    },
  };
}

export function makeHoldQueue(client: RpcClientLike, staleMinutes = 15): HoldQueue {
  const call = async (fn: string, args: Record<string, unknown>, code: string) => {
    const { data, error } = await client.rpc(fn, args);
    if (error) throw new HoldError(errorCode(code, error));
    return data;
  };
  return {
    async claim(batch) {
      const data = await call('moderation_files_claim', { p_batch: batch, p_stale_minutes: staleMinutes }, 'rpc_claim_failed');
      return (Array.isArray(data) ? data : []) as HoldJob[];
    },
    async complete(videoId, result) {
      return (await call('moderation_files_complete', { p_video_id: videoId, p_result: result }, 'rpc_complete_failed')) === true;
    },
    async fail(videoId, code) {
      return (await call('moderation_files_fail', { p_video_id: videoId, p_code: code }, 'rpc_fail_failed')) === true;
    },
    async evidenceDue(limit) {
      const data = await call('evidence_due_for_purge', { p_limit: limit }, 'rpc_evidence_due_failed');
      return (Array.isArray(data) ? data : []) as EvidenceItem[];
    },
    async evidenceMarkPurged(ids) {
      const data = await call('evidence_mark_purged', { p_ids: ids }, 'rpc_evidence_mark_failed');
      return typeof data === 'number' ? data : 0;
    },
  };
}
