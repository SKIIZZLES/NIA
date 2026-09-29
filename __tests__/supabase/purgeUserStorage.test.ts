/**
 * @jest-environment node
 *
 * Logique de l'Edge Function purge-user-storage (supabase/functions/
 * purge-user-storage/core.ts) contre un faux Storage en mémoire qui imite
 * `storage.from(bucket).list()` : non récursif, dossiers avec `id: null`,
 * pagination limit/offset, tri par nom.
 */
import {
  chunk,
  errorCode,
  isAuthorized,
  isSafeJob,
  isSecretConfigured,
  listAllObjectPaths,
  makeJobQueue,
  makeStorageGateway,
  processJobs,
  purgePrefix,
  PurgeError,
  timingSafeEqual,
  type JobQueue,
  type PurgeJob,
  type StorageClientLike,
  type StorageEntry,
  type StorageGateway,
} from '../../supabase/functions/purge-user-storage/core';

const A = '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

/** Faux Storage bas niveau (lève comme le réseau), voir SupabaseLike ci-dessous. */
class RawStorage {
  objects = new Map<string, Set<string>>();
  listCalls = 0;
  removeCalls: string[][] = [];
  failRemoveTimes = 0;
  failListTimes = 0;
  /** Ne supprime rien (simule un Storage qui « ment »). */
  removeIsNoop = false;

  constructor(bucket: string, paths: string[]) {
    this.objects.set(bucket, new Set(paths));
  }

  paths(bucket = 'videos'): string[] {
    return [...(this.objects.get(bucket) ?? [])].sort();
  }

  async list(bucket: string, folder: string, { limit, offset }: { limit: number; offset: number }) {
    this.listCalls++;
    if (this.failListTimes > 0) {
      this.failListTimes--;
      throw Object.assign(new Error(`list ${folder} failed for x@y.z`), { status: 503 });
    }
    const base = `${folder.replace(/\/+$/, '')}/`;
    const entries = new Map<string, StorageEntry>();
    for (const p of this.objects.get(bucket) ?? []) {
      if (!p.startsWith(base)) continue;
      const rest = p.slice(base.length);
      const slash = rest.indexOf('/');
      if (slash === -1) entries.set(rest, { name: rest, id: `id-${p}` });
      else entries.set(rest.slice(0, slash), { name: rest.slice(0, slash), id: null });
    }
    return [...entries.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(offset, offset + limit);
  }

  async remove(bucket: string, paths: string[]) {
    this.removeCalls.push(paths);
    if (this.failRemoveTimes > 0) {
      this.failRemoveTimes--;
      throw Object.assign(new Error('token=secret leaked caption "ma légende"'), { status: 500 });
    }
    if (this.removeIsNoop) return 0;
    const set = this.objects.get(bucket) ?? new Set<string>();
    let n = 0;
    for (const p of paths) if (set.delete(p)) n++;
    return n;
  }
}

/**
 * Imite `supabase.storage.from(b).list/remove` ({ data, error }, jamais de
 * throw) ; `makeStorageGateway` — l'adaptateur réellement utilisé par
 * index.ts — le transforme en StorageGateway.
 */
class FakeStorage extends RawStorage implements StorageGateway {
  private readonly gateway: StorageGateway;
  constructor(bucket: string, paths: string[]) {
    super(bucket, paths);
    const raw = this;
    const client: StorageClientLike = {
      storage: {
        from: (b: string) => ({
          list: (path, options) =>
            RawStorage.prototype.list
              .call(raw, b, path, options)
              .then((data) => ({ data, error: null }))
              .catch((error: unknown) => ({ data: null, error })),
          remove: (paths: string[]) =>
            RawStorage.prototype.remove
              .call(raw, b, paths)
              .then((n) => ({ data: Array.from({ length: n }, () => ({})), error: null }))
              .catch((error: unknown) => ({ data: null, error })),
        }),
      },
    };
    this.gateway = makeStorageGateway(client);
  }
  list(bucket: string, folder: string, opts: { limit: number; offset: number }) {
    return this.gateway.list(bucket, folder, opts);
  }
  remove(bucket: string, paths: string[]) {
    return this.gateway.remove(bucket, paths);
  }
}

/** File en mémoire qui imite claim / complete / fail de la migration 014. */
class FakeQueue implements JobQueue {
  jobs: (PurgeJob & { status: string; last_error?: string })[] = [];
  failClaim = false;

  add(job: Partial<PurgeJob> & { user_id: string }) {
    this.jobs.push({
      id: `job-${this.jobs.length + 1}`,
      bucket: 'videos',
      prefix: `${job.user_id}/`,
      attempts: 0,
      status: 'pending',
      ...job,
    });
  }

  async claim(batch: number) {
    if (this.failClaim) throw Object.assign(new Error('boom'), { code: 'PGRST301' });
    const ready = this.jobs.filter((j) => j.status === 'pending' || j.status === 'failed').slice(0, batch);
    for (const j of ready) {
      j.status = 'processing';
      j.attempts++;
    }
    return ready.map((j) => ({ ...j }));
  }

  async complete(id: string) {
    const j = this.jobs.find((x) => x.id === id && x.status === 'processing');
    if (!j) return false;
    j.status = 'done';
    return true;
  }

  async fail(id: string, code: string) {
    const j = this.jobs.find((x) => x.id === id && x.status === 'processing');
    if (!j) return false;
    j.status = 'failed';
    j.last_error = code;
    return true;
  }
}

function userFiles(uid: string, videos = 3): string[] {
  const out: string[] = [];
  for (let i = 0; i < videos; i++) {
    out.push(`${uid}/upload-${i}.mp4`, `${uid}/covers/upload-${i}.jpg`);
  }
  out.push(
    `${uid}/sounds/1700000000000.m4a`,
    `${uid}/events/1700000000001.jpg`,
    `${uid}/series/1700000000002.png`,
    `${uid}/live/1700000000003.jpg`,
  );
  return out;
}

const logs: { event: string; fields: Record<string, unknown> }[] = [];
const log = (event: string, fields: Record<string, string | number | boolean>) =>
  logs.push({ event, fields });

beforeEach(() => {
  logs.length = 0;
});

describe('listAllObjectPaths — liste récursive paginée', () => {
  it('descend dans tous les sous-dossiers de {uid}/ et ignore les autres utilisateurs', async () => {
    const s = new FakeStorage('videos', [...userFiles(A), ...userFiles(B)]);
    const paths = await listAllObjectPaths(s, 'videos', `${A}/`, { pageSize: 2 });
    expect(paths.sort()).toEqual(userFiles(A).sort());
  });

  it('pagine : 250 fichiers avec des pages de 100', async () => {
    const files = Array.from({ length: 250 }, (_, i) => `${A}/f${String(i).padStart(3, '0')}.mp4`);
    const s = new FakeStorage('videos', files);
    const paths = await listAllObjectPaths(s, 'videos', `${A}/`, { pageSize: 100 });
    expect(paths).toHaveLength(250);
    expect(s.listCalls).toBe(3);
  });

  it('dossiers imbriqués sur plusieurs niveaux', async () => {
    const s = new FakeStorage('videos', [`${A}/a/b/c/d.jpg`, `${A}/a/x.jpg`]);
    expect((await listAllObjectPaths(s, 'videos', `${A}/`)).sort()).toEqual([`${A}/a/b/c/d.jpg`, `${A}/a/x.jpg`]);
  });

  it('refuse un préfixe vide (racine du bucket)', async () => {
    const s = new FakeStorage('videos', userFiles(A));
    await expect(listAllObjectPaths(s, 'videos', '/')).rejects.toThrow(PurgeError);
    expect(s.listCalls).toBe(0);
  });
});

describe('chunk', () => {
  it('découpe en lots', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 100)).toEqual([]);
    expect(() => chunk([1], 0)).toThrow(RangeError);
  });
});

describe('purgePrefix', () => {
  it('supprime par lots de 100 puis vérifie qu’il ne reste rien', async () => {
    const files = Array.from({ length: 230 }, (_, i) => `${A}/covers/c${i}.jpg`);
    const s = new FakeStorage('videos', [...files, ...userFiles(B)]);
    const res = await purgePrefix(s, 'videos', `${A}/`, { batchSize: 100 });
    expect(res.removed).toBe(230);
    expect(s.removeCalls.map((c) => c.length)).toEqual([100, 100, 30]);
    expect(s.paths().filter((p) => p.startsWith(A))).toEqual([]);
    expect(s.paths()).toEqual(userFiles(B).sort());
  });

  it('préfixe déjà vide : removed 0, aucun remove (idempotent)', async () => {
    const s = new FakeStorage('videos', userFiles(B));
    await expect(purgePrefix(s, 'videos', `${A}/`)).resolves.toEqual({ removed: 0, rounds: 1 });
    expect(s.removeCalls).toHaveLength(0);
  });

  it('deux exécutions de suite : la seconde ne fait rien', async () => {
    const s = new FakeStorage('videos', userFiles(A));
    expect((await purgePrefix(s, 'videos', `${A}/`)).removed).toBe(userFiles(A).length);
    expect((await purgePrefix(s, 'videos', `${A}/`)).removed).toBe(0);
  });

  it('objets encore présents après maxRounds → objects_remaining', async () => {
    const s = new FakeStorage('videos', userFiles(A));
    s.removeIsNoop = true;
    await expect(purgePrefix(s, 'videos', `${A}/`, { maxRounds: 2 })).rejects.toMatchObject({
      code: 'objects_remaining',
    });
  });

  it('maxObjects par passe : les passes suivantes finissent le travail', async () => {
    const files = Array.from({ length: 50 }, (_, i) => `${A}/f${i}.mp4`);
    const s = new FakeStorage('videos', files);
    const res = await purgePrefix(s, 'videos', `${A}/`, { maxObjects: 20, maxRounds: 5 });
    expect(res.removed).toBe(50);
    expect(s.paths()).toEqual([]);
  });
});

describe('processJobs', () => {
  it('cas nominal : purge puis complete', async () => {
    const s = new FakeStorage('videos', [...userFiles(A), ...userFiles(B)]);
    const q = new FakeQueue();
    q.add({ user_id: A });
    const sum = await processJobs(q, s, log);
    expect(sum).toMatchObject({ claimed: 1, done: 1, failed: 0 });
    expect(sum.jobs[0]).toEqual({ jobId: 'job-1', status: 'done', removed: userFiles(A).length });
    expect(q.jobs[0].status).toBe('done');
    expect(s.paths()).toEqual(userFiles(B).sort());
  });

  it('échec Storage → fail avec un code sans données, puis retry réussi', async () => {
    const s = new FakeStorage('videos', userFiles(A));
    s.failRemoveTimes = 1;
    const q = new FakeQueue();
    q.add({ user_id: A });

    const first = await processJobs(q, s, log);
    expect(first).toMatchObject({ done: 0, failed: 1 });
    expect(q.jobs[0]).toMatchObject({ status: 'failed', last_error: 'storage_remove_failed:500' });

    const second = await processJobs(q, s, log);
    expect(second).toMatchObject({ done: 1, failed: 0 });
    expect(q.jobs[0]).toMatchObject({ status: 'done', attempts: 2 });
    expect(s.paths()).toEqual([]);
  });

  it('échec de list → storage_list_failed:503', async () => {
    const s = new FakeStorage('videos', userFiles(A));
    s.failListTimes = 1;
    const q = new FakeQueue();
    q.add({ user_id: A });
    await processJobs(q, s, log);
    expect(q.jobs[0].last_error).toBe('storage_list_failed:503');
  });

  it('job dangereux (préfixe ≠ {user_id}/, bucket inconnu) : refusé sans toucher au Storage', async () => {
    const s = new FakeStorage('videos', [...userFiles(A), ...userFiles(B)]);
    const q = new FakeQueue();
    q.add({ user_id: A, prefix: `${B}/` });
    q.add({ user_id: A, prefix: '' });
    q.add({ user_id: A, bucket: 'other' });
    q.add({ user_id: 'not-a-uuid', prefix: 'not-a-uuid/' });
    const sum = await processJobs(q, s, log, { batch: 10 });
    expect(sum.failed).toBe(4);
    expect(q.jobs.every((j) => j.last_error === 'unsafe_job')).toBe(true);
    expect(s.listCalls).toBe(0);
    expect(s.removeCalls).toHaveLength(0);
  });

  it('budget de temps dépassé → deadline_exceeded, job retentable', async () => {
    const s = new FakeStorage('videos', userFiles(A));
    const q = new FakeQueue();
    q.add({ user_id: A });
    let t = 0;
    const sum = await processJobs(q, s, log, { budgetMs: 10, now: () => (t += 100) });
    expect(sum.jobs[0].code).toBe('deadline_exceeded');
    expect(q.jobs[0].status).toBe('failed');
  });

  it('claim en erreur → résumé avec code, rien traité', async () => {
    const q = new FakeQueue();
    q.failClaim = true;
    const sum = await processJobs(q, new FakeStorage('videos', []), log);
    expect(sum).toMatchObject({ claimed: 0, error: 'rpc_claim_failed:pgrst301' });
  });

  it('les logs ne contiennent ni user_id, ni chemin, ni message brut', async () => {
    const s = new FakeStorage('videos', userFiles(A));
    s.failRemoveTimes = 1;
    const q = new FakeQueue();
    q.add({ user_id: A });
    await processJobs(q, s, log);
    await processJobs(q, s, log);
    const dump = JSON.stringify(logs);
    expect(dump).not.toContain(A);
    expect(dump).not.toMatch(/token|légende|x@y\.z|\.mp4|covers/);
    expect(logs.map((l) => l.event)).toEqual(['claimed', 'job_failed', 'claimed', 'job_done']);
  });
});

describe('sécurité', () => {
  const SECRET = 'a'.repeat(16) + 'B'.repeat(16) + '0123';

  it('isAuthorized : bon secret seulement', () => {
    expect(isAuthorized(SECRET, SECRET)).toBe(true);
    expect(isAuthorized(SECRET + 'x', SECRET)).toBe(false);
    expect(isAuthorized(SECRET.slice(0, -1) + 'X', SECRET)).toBe(false);
    expect(isAuthorized('', SECRET)).toBe(false);
    expect(isAuthorized(null, SECRET)).toBe(false);
    expect(isAuthorized(undefined, SECRET)).toBe(false);
  });

  it('secret absent ou trop court : tout est refusé', () => {
    expect(isSecretConfigured('')).toBe(false);
    expect(isSecretConfigured('short')).toBe(false);
    expect(isAuthorized('short', 'short')).toBe(false);
    expect(isAuthorized('', '')).toBe(false);
    expect(isSecretConfigured(SECRET)).toBe(true);
  });

  it('timingSafeEqual', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
    expect(timingSafeEqual('', '')).toBe(true);
  });

  it('isSafeJob miroir de la contrainte SQL', () => {
    expect(isSafeJob({ id: '1', user_id: A, bucket: 'videos', prefix: `${A}/`, attempts: 1 })).toBe(true);
    expect(isSafeJob({ id: '1', user_id: A, bucket: 'videos', prefix: `${A}`, attempts: 1 })).toBe(false);
    expect(isSafeJob({ id: '1', user_id: A, bucket: 'videos', prefix: `${A}/covers/`, attempts: 1 })).toBe(false);
  });

  it('errorCode ne recopie jamais le message', () => {
    const err = Object.assign(new Error('path 3f1b.../x.mp4 token=abc'), { status: 404 });
    expect(errorCode('storage_remove_failed', err)).toBe('storage_remove_failed:404');
    expect(errorCode('x', new Error('secret'))).toBe('x:unknown');
    expect(errorCode('x', { code: 'PGRST202', message: 'user@mail' })).toBe('x:pgrst202');
    expect(errorCode('x', new PurgeError('Objects Remaining!'))).toBe('objects_remaining_');
  });
});

describe('makeJobQueue — appels RPC de la migration 014', () => {
  it('appelle claim / complete / fail avec les bons noms et paramètres', async () => {
    const calls: [string, Record<string, unknown>][] = [];
    const client = {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        calls.push([fn, args]);
        if (fn === 'claim_storage_purge_jobs') {
          return { data: [{ id: 'j1', user_id: A, bucket: 'videos', prefix: `${A}/`, attempts: 1 }], error: null };
        }
        return { data: true, error: null };
      },
    };
    const q = makeJobQueue(client);
    expect(await q.claim(3)).toHaveLength(1);
    expect(await q.complete('j1')).toBe(true);
    expect(await q.fail('j1', 'storage_remove_failed:500')).toBe(true);
    expect(calls).toEqual([
      ['claim_storage_purge_jobs', { p_batch: 3, p_stale_minutes: 15 }],
      ['complete_storage_purge_job', { p_job_id: 'j1' }],
      ['fail_storage_purge_job', { p_job_id: 'j1', p_error: 'storage_remove_failed:500' }],
    ]);
  });

  it('erreur PostgREST → PurgeError avec code, sans message', async () => {
    const q = makeJobQueue({
      rpc: async () => ({ data: null, error: { code: '42501', message: 'permission denied for x@y.z' } }),
    });
    await expect(q.claim(1)).rejects.toMatchObject({ code: 'rpc_claim_failed:42501' });
  });
});
