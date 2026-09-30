/**
 * @jest-environment node
 *
 * Logique de l'Edge Function moderation-hold (supabase/functions/
 * moderation-hold/core.ts) contre un faux Storage en mémoire.
 */
import {
  EVIDENCE_BUCKET,
  HOLD_BUCKET,
  HoldError,
  SOURCE_BUCKET,
  errorCode,
  holdPath,
  isAuthorized,
  isSafeEvidencePath,
  isSafeJob,
  isSecretConfigured,
  makeHoldQueue,
  makeStorageGateway,
  processHolds,
  type EvidenceItem,
  type HoldJob,
  type HoldQueue,
  type HoldResult,
  type StorageClientLike,
  type StorageGateway,
} from '../../supabase/functions/moderation-hold/core';

const OWNER = '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const VIDEO = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const REPORTER = '11111111-2222-4333-8444-555555555555';
const REPORT = '66666666-7777-4888-9999-000000000000';

class MemStorage implements StorageGateway {
  buckets = new Map<string, Map<string, string>>();
  failCopy = 0;
  copyIsNoop = false;
  removeIsNoop = false;
  calls: string[] = [];

  put(bucket: string, path: string, content = 'bytes') {
    if (!this.buckets.has(bucket)) this.buckets.set(bucket, new Map());
    this.buckets.get(bucket)!.set(path, content);
  }
  has(bucket: string, path: string) {
    return this.buckets.get(bucket)?.has(path) ?? false;
  }
  async exists(bucket: string, path: string) {
    return this.has(bucket, path);
  }
  async copy(fb: string, fp: string, tb: string, tp: string) {
    this.calls.push(`copy ${fb}→${tb}`);
    if (this.failCopy > 0) {
      this.failCopy--;
      throw new HoldError('storage_copy_failed:503');
    }
    const content = this.buckets.get(fb)?.get(fp);
    if (content === undefined) throw new HoldError('storage_copy_failed:404');
    if (!this.copyIsNoop) this.put(tb, tp, content);
  }
  async remove(bucket: string, paths: string[]) {
    this.calls.push(`remove ${bucket}`);
    if (this.removeIsNoop) return 0;
    let n = 0;
    for (const p of paths) if (this.buckets.get(bucket)?.delete(p)) n++;
    return n;
  }
}

class MemQueue implements HoldQueue {
  jobs: HoldJob[] = [];
  completed: [string, HoldResult][] = [];
  failed: [string, string][] = [];
  evidence: EvidenceItem[] = [];
  marked: string[] = [];
  claimError: unknown = null;
  async claim() {
    if (this.claimError) throw this.claimError;
    const j = this.jobs;
    this.jobs = [];
    return j;
  }
  async complete(id: string, r: HoldResult) {
    this.completed.push([id, r]);
    return true;
  }
  async fail(id: string, code: string) {
    this.failed.push([id, code]);
    return true;
  }
  async evidenceDue() {
    return this.evidence;
  }
  async evidenceMarkPurged(ids: string[]) {
    this.marked.push(...ids);
    return ids.length;
  }
}

const job = (action: HoldJob['action'], paths?: string[]): HoldJob => ({
  video_id: VIDEO,
  owner_id: OWNER,
  paths: paths ?? [`${OWNER}/covers/${VIDEO}.jpg`, `${OWNER}/${VIDEO}.mp4`],
  action,
  attempts: 1,
});
const noLog = () => undefined;

describe('moderation-hold — garde-fous', () => {
  it('secret ≥ 32 caractères et comparaison stricte', () => {
    expect(isSecretConfigured('court')).toBe(false);
    const s = 'x'.repeat(40);
    expect(isAuthorized(s, s)).toBe(true);
    expect(isAuthorized(`${s}y`, s)).toBe(false);
    expect(isAuthorized(null, s)).toBe(false);
    expect(isAuthorized(s, 'court')).toBe(false);
  });

  it('refuse un job hors du dossier du propriétaire', () => {
    expect(isSafeJob(job('hold'))).toBe(true);
    expect(isSafeJob(job('hold', [`${OWNER}/../autre/x.mp4`]))).toBe(false);
    expect(isSafeJob(job('hold', ['autre/x.mp4']))).toBe(false);
    expect(isSafeJob(job('hold', [`${OWNER}//x.mp4`]))).toBe(false);
    expect(isSafeJob({ ...job('hold'), owner_id: 'pas-un-uuid' })).toBe(false);
    expect(isSafeJob({ ...job('hold'), action: 'delete' as never })).toBe(false);
  });

  it('chemins de preuves {reporter}/{report}/{fichier}', () => {
    expect(isSafeEvidencePath(`${REPORTER}/${REPORT}/a.jpg`)).toBe(true);
    expect(isSafeEvidencePath(`${REPORTER}/${REPORT}/../x`)).toBe(false);
    expect(isSafeEvidencePath(`${REPORTER}/a.jpg`)).toBe(false);
  });

  it('copie privée sans collision (rang + nom)', () => {
    const j = job('hold', [`${OWNER}/${VIDEO}.jpg`, `${OWNER}/covers/${VIDEO}.jpg`]);
    expect(holdPath(j, 0)).toBe(`${OWNER}/${VIDEO}/0_${VIDEO}.jpg`);
    expect(holdPath(j, 1)).toBe(`${OWNER}/${VIDEO}/1_${VIDEO}.jpg`);
  });

  it('codes d’erreur sans message brut', () => {
    expect(errorCode('x', { status: 403, message: `chemin ${OWNER}` })).toBe('x:403');
    expect(errorCode('x', new Error(`chemin ${OWNER}`))).toBe('x:unknown');
  });
});

describe('moderation-hold — traitement', () => {
  it('hold : copie, vérifie, puis retire du bucket public', async () => {
    const st = new MemStorage();
    const j = job('hold');
    j.paths.forEach((p) => st.put(SOURCE_BUCKET, p));
    const q = new MemQueue();
    q.jobs = [j];
    const s = await processHolds(q, st, noLog);
    expect(s).toMatchObject({ claimed: 1, done: 1, failed: 0 });
    expect(q.completed).toEqual([[VIDEO, 'held']]);
    j.paths.forEach((p, i) => {
      expect(st.has(SOURCE_BUCKET, p)).toBe(false);
      expect(st.has(HOLD_BUCKET, holdPath(j, i))).toBe(true);
    });
  });

  it('hold : copie non vérifiée → rien n’est supprimé, échec retenté', async () => {
    const st = new MemStorage();
    const j = job('hold');
    j.paths.forEach((p) => st.put(SOURCE_BUCKET, p));
    st.copyIsNoop = true;
    const q = new MemQueue();
    q.jobs = [j];
    const s = await processHolds(q, st, noLog);
    expect(s.failed).toBe(1);
    expect(q.failed).toEqual([[VIDEO, 'copy_not_verified']]);
    j.paths.forEach((p) => expect(st.has(SOURCE_BUCKET, p)).toBe(true));
  });

  it('hold : erreur réseau → code court, fichiers publics intacts', async () => {
    const st = new MemStorage();
    const j = job('hold');
    j.paths.forEach((p) => st.put(SOURCE_BUCKET, p));
    st.failCopy = 1;
    const q = new MemQueue();
    q.jobs = [j];
    await processHolds(q, st, noLog);
    expect(q.failed).toEqual([[VIDEO, 'storage_copy_failed:503']]);
    expect(st.has(SOURCE_BUCKET, j.paths[0])).toBe(true);
  });

  it('hold : reprise après une passe interrompue (copie déjà faite)', async () => {
    const st = new MemStorage();
    const j = job('hold');
    st.put(HOLD_BUCKET, holdPath(j, 0));
    st.put(SOURCE_BUCKET, j.paths[1]);
    const q = new MemQueue();
    q.jobs = [j];
    await processHolds(q, st, noLog);
    expect(q.completed).toEqual([[VIDEO, 'held']]);
    expect(st.has(HOLD_BUCKET, holdPath(j, 1))).toBe(true);
    expect(st.has(SOURCE_BUCKET, j.paths[1])).toBe(false);
  });

  it('hold : aucun fichier → missing', async () => {
    const q = new MemQueue();
    q.jobs = [job('hold')];
    await processHolds(q, new MemStorage(), noLog);
    expect(q.completed).toEqual([[VIDEO, 'missing']]);
  });

  it('hold : suppression publique qui échoue en silence → échec', async () => {
    const st = new MemStorage();
    const j = job('hold');
    j.paths.forEach((p) => st.put(SOURCE_BUCKET, p));
    st.removeIsNoop = true;
    const q = new MemQueue();
    q.jobs = [j];
    await processHolds(q, st, noLog);
    expect(q.failed).toEqual([[VIDEO, 'source_still_public']]);
  });

  it('release : remet en place puis supprime la copie', async () => {
    const st = new MemStorage();
    const j = job('release');
    j.paths.forEach((_, i) => st.put(HOLD_BUCKET, holdPath(j, i), `c${i}`));
    const q = new MemQueue();
    q.jobs = [j];
    await processHolds(q, st, noLog);
    expect(q.completed).toEqual([[VIDEO, 'public']]);
    j.paths.forEach((p, i) => {
      expect(st.buckets.get(SOURCE_BUCKET)?.get(p)).toBe(`c${i}`);
      expect(st.has(HOLD_BUCKET, holdPath(j, i))).toBe(false);
    });
  });

  it('purge : supprime la copie et tout reste public', async () => {
    const st = new MemStorage();
    const j = job('purge');
    j.paths.forEach((_, i) => st.put(HOLD_BUCKET, holdPath(j, i)));
    st.put(SOURCE_BUCKET, j.paths[1]);
    const q = new MemQueue();
    q.jobs = [j];
    await processHolds(q, st, noLog);
    expect(q.completed).toEqual([[VIDEO, 'purged']]);
    expect(st.buckets.get(HOLD_BUCKET)?.size).toBe(0);
    expect(st.has(SOURCE_BUCKET, j.paths[1])).toBe(false);
  });

  it('job dangereux : refusé sans toucher au Storage', async () => {
    const st = new MemStorage();
    const q = new MemQueue();
    q.jobs = [job('purge', ['autre/x.mp4'])];
    await processHolds(q, st, noLog);
    expect(q.failed).toEqual([[VIDEO, 'unsafe_job']]);
    expect(st.calls).toEqual([]);
  });

  it('preuves échues : supprimées puis marquées ; chemins suspects ignorés', async () => {
    const st = new MemStorage();
    const ok = `${REPORTER}/${REPORT}/a.jpg`;
    st.put(EVIDENCE_BUCKET, ok);
    const q = new MemQueue();
    q.evidence = [
      { id: REPORT, storage_path: ok },
      { id: REPORTER, storage_path: '../../videos/x' },
    ];
    const s = await processHolds(q, st, noLog);
    expect(s.evidencePurged).toBe(1);
    expect(q.marked).toEqual([REPORT]);
    expect(st.has(EVIDENCE_BUCKET, ok)).toBe(false);
  });

  it('échec du claim : les preuves sont quand même traitées', async () => {
    const q = new MemQueue();
    q.claimError = { status: 500 };
    const s = await processHolds(q, new MemStorage(), noLog);
    expect(s.error).toBe('rpc_claim_failed:500');
    expect(s.claimed).toBe(0);
  });

  it('journaux : jamais de chemin ni d’identifiant propriétaire', async () => {
    const st = new MemStorage();
    const j = job('hold');
    j.paths.forEach((p) => st.put(SOURCE_BUCKET, p));
    const q = new MemQueue();
    q.jobs = [j];
    const lines: string[] = [];
    await processHolds(q, st, (e, f) => lines.push(JSON.stringify({ e, ...f })));
    expect(lines.join('\n')).not.toContain(OWNER);
  });
});

describe('moderation-hold — adaptateurs supabase-js', () => {
  it('exists / copy / remove', async () => {
    const calls: unknown[] = [];
    const client: StorageClientLike = {
      storage: {
        from: (bucket: string) => ({
          list: async (path, opts) => {
            calls.push(['list', bucket, path, opts.search]);
            return { data: [{ name: `${VIDEO}.mp4`, id: 'x' }, { name: 'dossier', id: null }], error: null };
          },
          copy: async (from, to, opts) => {
            calls.push(['copy', bucket, from, to, opts?.destinationBucket]);
            return { data: {}, error: null };
          },
          remove: async (paths) => {
            calls.push(['remove', bucket, paths]);
            return { data: paths, error: null };
          },
        }),
      },
    };
    const g = makeStorageGateway(client);
    expect(await g.exists('videos', `${OWNER}/${VIDEO}.mp4`)).toBe(true);
    expect(await g.exists('videos', `${OWNER}/dossier`)).toBe(false);
    await g.copy('videos', 'a/b', 'moderation-hold', 'a/c');
    expect(await g.remove('videos', ['a', 'b'])).toBe(2);
    expect(calls[0]).toEqual(['list', 'videos', OWNER, `${VIDEO}.mp4`]);
    expect(calls[2]).toEqual(['copy', 'videos', 'a/b', 'a/c', 'moderation-hold']);
  });

  it('RPC : noms et arguments de la migration 017', async () => {
    const calls: [string, Record<string, unknown>][] = [];
    const q = makeHoldQueue({
      rpc: (fn, args) => {
        calls.push([fn, args]);
        const data = fn === 'moderation_files_claim' ? [] : fn === 'evidence_mark_purged' ? 2 : true;
        return Promise.resolve({ data, error: null });
      },
    });
    await q.claim(3);
    expect(await q.complete(VIDEO, 'held')).toBe(true);
    await q.fail(VIDEO, 'x');
    await q.evidenceDue(10);
    expect(await q.evidenceMarkPurged([REPORT])).toBe(2);
    expect(calls.map((c) => c[0])).toEqual([
      'moderation_files_claim',
      'moderation_files_complete',
      'moderation_files_fail',
      'evidence_due_for_purge',
      'evidence_mark_purged',
    ]);
    expect(calls[0][1]).toEqual({ p_batch: 3, p_stale_minutes: 15 });
    expect(calls[1][1]).toEqual({ p_video_id: VIDEO, p_result: 'held' });
  });
});
