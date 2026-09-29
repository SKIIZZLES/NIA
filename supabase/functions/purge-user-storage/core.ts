/**
 * Logique pure du worker de purge Storage (014_account_deletion.sql).
 *
 * Aucune API Deno, aucun import réseau : ce module est importé par index.ts
 * (Deno, Edge Function) ET par les tests Jest (__tests__/supabase/).
 *
 * Journalisation : identifiants de job, compteurs et codes d'erreur
 * UNIQUEMENT. Jamais d'user_id, de préfixe, de chemin, d'e-mail, de légende,
 * de message d'erreur brut ni de jeton.
 */

/** Buckets qu'un job a le droit de viser (miroir de la contrainte SQL). */
export const ALLOWED_BUCKETS: readonly string[] = ['videos'];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ligne renvoyée par public.claim_storage_purge_jobs (sous-ensemble utile). */
export type PurgeJob = {
  id: string;
  user_id: string;
  bucket: string;
  prefix: string;
  attempts: number;
  max_attempts?: number;
};

/** Entrée de `storage.from(bucket).list()` : un dossier a `id === null`. */
export type StorageEntry = { name: string; id: string | null };

/** Accès Storage minimal, adapté de supabase-js dans index.ts, simulé dans les tests. */
export interface StorageGateway {
  list(
    bucket: string,
    folder: string,
    opts: { limit: number; offset: number },
  ): Promise<StorageEntry[]>;
  /** Renvoie le nombre d'objets effectivement supprimés. */
  remove(bucket: string, paths: string[]): Promise<number>;
}

export interface JobQueue {
  claim(batch: number): Promise<PurgeJob[]>;
  complete(jobId: string): Promise<boolean>;
  fail(jobId: string, code: string): Promise<boolean>;
}

export type LogFields = Record<string, string | number | boolean>;
export type Logger = (event: string, fields: LogFields) => void;

/** Erreur portant un code court, sûr à stocker et à journaliser. */
export class PurgeError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = 'PurgeError';
    this.code = sanitizeCode(code);
  }
}

/** Garde [a-z0-9_:.-], 80 caractères max. */
export function sanitizeCode(raw: string): string {
  const cleaned = String(raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9_:.-]/g, '_')
    .slice(0, 80);
  return cleaned || 'unknown';
}

/**
 * Code d'erreur à partir d'une erreur supabase-js / PostgREST : seulement le
 * statut HTTP ou le code SQL/PostgREST, jamais `message` (qui peut contenir
 * un chemin, donc un user_id, ou des données).
 */
export function errorCode(prefix: string, err: unknown): string {
  if (err instanceof PurgeError) return err.code;
  const e = (err ?? {}) as { status?: unknown; statusCode?: unknown; code?: unknown };
  const status = typeof e.status === 'number' ? e.status : Number(e.statusCode);
  if (Number.isInteger(status) && status > 0) return sanitizeCode(`${prefix}:${status}`);
  if (typeof e.code === 'string' && /^[A-Z0-9]{3,10}$/i.test(e.code)) {
    return sanitizeCode(`${prefix}:${e.code}`);
  }
  return sanitizeCode(`${prefix}:unknown`);
}

/** Comparaison en temps constant (sur la plus grande des deux longueurs). */
export function timingSafeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  const len = Math.max(ea.length, eb.length);
  for (let i = 0; i < len; i++) {
    diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  }
  return diff === 0;
}

/** Un secret de moins de 32 caractères est refusé : la fonction répond 503. */
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

/** Le job ne peut viser que `{user_id}/` d'un bucket autorisé (défense en profondeur). */
export function isSafeJob(job: PurgeJob): boolean {
  return (
    typeof job.user_id === 'string' &&
    UUID_RE.test(job.user_id) &&
    job.prefix === `${job.user_id.toLowerCase()}/` &&
    ALLOWED_BUCKETS.includes(job.bucket)
  );
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new RangeError('chunk size must be >= 1');
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export type ListOptions = {
  pageSize?: number;
  /** Plafond d'objets par passe ; le reste est traité à la passe suivante. */
  maxObjects?: number;
  maxFolders?: number;
  /** Lève PurgeError('deadline_exceeded') si dépassé. */
  checkDeadline?: () => void;
};

/**
 * Liste récursivement tous les objets sous `prefix` (ex. "uuid/").
 * `list()` de Storage n'est pas récursif : parcours en largeur des dossiers
 * (entrées `id === null`), avec pagination `offset` dans chaque dossier.
 * Renvoie des chemins complets, relatifs au bucket.
 */
export async function listAllObjectPaths(
  storage: StorageGateway,
  bucket: string,
  prefix: string,
  opts: ListOptions = {},
): Promise<string[]> {
  const pageSize = opts.pageSize ?? 100;
  const maxObjects = opts.maxObjects ?? 10_000;
  const maxFolders = opts.maxFolders ?? 2_000;
  const root = prefix.replace(/\/+$/, '');
  if (!root) throw new PurgeError('unsafe_prefix');

  const files: string[] = [];
  const queue: string[] = [root];
  const seen = new Set<string>([root]);

  while (queue.length > 0) {
    const folder = queue.shift() as string;
    for (let offset = 0; ; offset += pageSize) {
      opts.checkDeadline?.();
      const page = await storage.list(bucket, folder, { limit: pageSize, offset });
      for (const entry of page) {
        if (!entry || typeof entry.name !== 'string' || entry.name === '') continue;
        const full = `${folder}/${entry.name}`;
        if (entry.id === null) {
          if (!seen.has(full)) {
            if (seen.size >= maxFolders) throw new PurgeError('too_many_folders');
            seen.add(full);
            queue.push(full);
          }
        } else {
          files.push(full);
          if (files.length >= maxObjects) return files;
        }
      }
      if (page.length < pageSize) break;
    }
  }
  return files;
}

export type PurgeResult = { removed: number; rounds: number };

/**
 * Supprime tout ce qui est sous `prefix` via l'API Storage, par lots, puis
 * vérifie qu'il ne reste rien (nouvelle liste). Idempotent : préfixe vide →
 * { removed: 0 }. Lève PurgeError('objects_remaining') si des objets restent
 * après `maxRounds` passes (le job sera retenté).
 */
export async function purgePrefix(
  storage: StorageGateway,
  bucket: string,
  prefix: string,
  opts: ListOptions & { batchSize?: number; maxRounds?: number } = {},
): Promise<PurgeResult> {
  const batchSize = opts.batchSize ?? 100;
  const maxRounds = opts.maxRounds ?? 5;
  let removed = 0;
  for (let round = 1; round <= maxRounds; round++) {
    const paths = await listAllObjectPaths(storage, bucket, prefix, opts);
    if (paths.length === 0) return { removed, rounds: round };
    for (const batch of chunk(paths, batchSize)) {
      opts.checkDeadline?.();
      removed += await storage.remove(bucket, batch);
    }
  }
  const left = await listAllObjectPaths(storage, bucket, prefix, opts);
  if (left.length === 0) return { removed, rounds: maxRounds };
  throw new PurgeError('objects_remaining');
}

export type JobOutcome = {
  jobId: string;
  status: 'done' | 'failed';
  removed: number;
  code?: string;
};

export type RunSummary = {
  claimed: number;
  done: number;
  failed: number;
  jobs: JobOutcome[];
  error?: string;
};

export type RunOptions = {
  batch?: number;
  /** Budget total en ms (Edge Function : ~150 s de wall clock sur Free). */
  budgetMs?: number;
  now?: () => number;
  pageSize?: number;
  batchSize?: number;
  maxRounds?: number;
};

/**
 * Réclame des jobs et les traite un par un. Tout job réclamé finit en
 * `complete` ou `fail` (jamais laissé « processing » sauf crash du runtime,
 * auquel cas claim_storage_purge_jobs le reprend après 15 min).
 */
export async function processJobs(
  queue: JobQueue,
  storage: StorageGateway,
  log: Logger,
  opts: RunOptions = {},
): Promise<RunSummary> {
  const now = opts.now ?? (() => Date.now());
  const deadline = now() + (opts.budgetMs ?? 110_000);
  const checkDeadline = () => {
    if (now() > deadline) throw new PurgeError('deadline_exceeded');
  };
  const summary: RunSummary = { claimed: 0, done: 0, failed: 0, jobs: [] };

  let jobs: PurgeJob[];
  try {
    jobs = await queue.claim(opts.batch ?? 3);
  } catch (err) {
    summary.error = errorCode('rpc_claim_failed', err);
    log('claim_failed', { code: summary.error });
    return summary;
  }
  summary.claimed = jobs.length;
  log('claimed', { count: jobs.length });

  for (const job of jobs) {
    let outcome: JobOutcome;
    try {
      if (!isSafeJob(job)) throw new PurgeError('unsafe_job');
      checkDeadline();
      const res = await purgePrefix(storage, job.bucket, job.prefix, {
        pageSize: opts.pageSize,
        batchSize: opts.batchSize,
        maxRounds: opts.maxRounds,
        checkDeadline,
      });
      const ok = await queue.complete(job.id);
      if (!ok) throw new PurgeError('complete_rejected');
      outcome = { jobId: job.id, status: 'done', removed: res.removed };
      log('job_done', { jobId: job.id, removed: res.removed, rounds: res.rounds, attempt: job.attempts });
    } catch (err) {
      const code = errorCode('storage_error', err);
      outcome = { jobId: job.id, status: 'failed', removed: 0, code };
      try {
        await queue.fail(job.id, code);
      } catch (failErr) {
        // Le job reste « processing » : repris après expiration du verrou.
        log('fail_mark_failed', { jobId: job.id, code: errorCode('rpc_fail_failed', failErr) });
      }
      log('job_failed', { jobId: job.id, code, attempt: job.attempts });
    }
    summary.jobs.push(outcome);
    if (outcome.status === 'done') summary.done++;
    else summary.failed++;
  }
  return summary;
}

// ---------------------------------------------------------------------------
// Adaptateurs supabase-js (typage structurel : pas d'import de supabase-js ici)
// ---------------------------------------------------------------------------

type ApiResult<T> = { data: T | null; error: unknown };

export interface StorageClientLike {
  storage: {
    from(bucket: string): {
      list(
        path: string,
        options: { limit: number; offset: number; sortBy: { column: string; order: string } },
      ): Promise<ApiResult<{ name: string; id: string | null }[]>>;
      remove(paths: string[]): Promise<ApiResult<unknown[]>>;
    };
  };
}

export interface RpcClientLike {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<ApiResult<unknown>>;
}

/** Storage via l'API (service_role) : list non récursif, remove par chemins. */
export function makeStorageGateway(client: StorageClientLike): StorageGateway {
  return {
    async list(bucket, folder, { limit, offset }) {
      const { data, error } = await client.storage
        .from(bucket)
        .list(folder, { limit, offset, sortBy: { column: 'name', order: 'asc' } });
      if (error) throw new PurgeError(errorCode('storage_list_failed', error));
      return (data ?? []).map((e) => ({ name: e.name, id: e.id ?? null }));
    },
    async remove(bucket, paths) {
      const { data, error } = await client.storage.from(bucket).remove(paths);
      if (error) throw new PurgeError(errorCode('storage_remove_failed', error));
      return Array.isArray(data) ? data.length : 0;
    },
  };
}

/** File de jobs via les RPC de la migration 014 (EXECUTE : service_role seul). */
export function makeJobQueue(client: RpcClientLike, staleMinutes = 15): JobQueue {
  return {
    async claim(batch) {
      const { data, error } = await client.rpc('claim_storage_purge_jobs', {
        p_batch: batch,
        p_stale_minutes: staleMinutes,
      });
      if (error) throw new PurgeError(errorCode('rpc_claim_failed', error));
      return (Array.isArray(data) ? data : []) as PurgeJob[];
    },
    async complete(jobId) {
      const { data, error } = await client.rpc('complete_storage_purge_job', { p_job_id: jobId });
      if (error) throw new PurgeError(errorCode('rpc_complete_failed', error));
      return data === true;
    },
    async fail(jobId, code) {
      const { data, error } = await client.rpc('fail_storage_purge_job', {
        p_job_id: jobId,
        p_error: code,
      });
      if (error) throw new PurgeError(errorCode('rpc_fail_failed', error));
      return data === true;
    },
  };
}
