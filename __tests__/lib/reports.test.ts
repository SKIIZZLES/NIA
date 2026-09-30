/**
 * Signalements v2 (017) : catégories, repli sur l'ancien schéma tant que 017
 * n'est pas appliquée, erreurs lisibles, pièces jointes.
 */
import {
  REPORT_CATEGORIES,
  __resetReportSchemaCache,
  checkEvidence,
  createReport,
  evidencePath,
  legacyReason,
  reportCategoryKey,
  reportErrorKey,
  uploadReportEvidence,
} from '@/lib/reports';
import { getSupabase } from '@/lib/supabase';
import fr from '@/locales/fr';

jest.mock('@/lib/supabase', () => ({
  getSupabase: jest.fn(),
  isSupabaseConfigured: true,
}));

const mocked = getSupabase as jest.MockedFunction<typeof getSupabase>;
const UID = '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const TID = 'c0ffee00-1111-4222-8333-444455556666';
const RID = '66666666-7777-4888-9999-000000000000';

type Err = { code?: string; message?: string } | null;

/** Double de supabase-js : une réponse par insert, dans l'ordre. */
function double(responses: { data?: unknown; error: Err }[], session?: { id: string; token: string }) {
  const inserts: { table: string; row: Record<string, unknown> }[] = [];
  let n = 0;
  const client = {
    from: (table: string) => ({
      insert(row: Record<string, unknown>) {
        inserts.push({ table, row });
        const r = responses[Math.min(n++, responses.length - 1)];
        const p = Promise.resolve({ data: null, error: r.error });
        return Object.assign(p, {
          select: () => ({ single: () => Promise.resolve({ data: r.data ?? null, error: r.error }) }),
        });
      },
    }),
    auth: {
      getSession: () =>
        Promise.resolve({
          data: { session: session ? { access_token: session.token, user: { id: session.id } } : null },
        }),
    },
  } as unknown as ReturnType<typeof getSupabase>;
  mocked.mockReturnValue(client);
  return inserts;
}

beforeEach(() => __resetReportSchemaCache());

describe('catégories', () => {
  it('10 catégories validées, chacune traduite en français', () => {
    expect(REPORT_CATEGORIES.map((c) => c.id)).toEqual([
      'insultes_harcelement',
      'nudite_sexuel',
      'actes_inhumains',
      'negrophobie',
      'racisme_haine',
      'homophobie',
      'pedocriminalite',
      'spam',
      'menace_danger',
      'injustice_autre',
    ]);
    const report = fr.report as Record<string, string>;
    for (const c of REPORT_CATEGORIES) {
      expect(report[c.key.replace('report.', '')]).toBeTruthy();
    }
    expect(REPORT_CATEGORIES.find((c) => c.id === 'pedocriminalite')?.priority).toBe(0);
  });

  it('catégorie inconnue → « autre »', () => {
    expect(reportCategoryKey('xyz')).toBe('report.catOther');
    expect(reportCategoryKey(null)).toBe('report.catOther');
  });

  it('ancien schéma : libellé français stable, que 017 sait reclasser', () => {
    expect(legacyReason('pedocriminalite')).toBe('Pédocriminalité');
    expect(legacyReason('homophobie', '  dans ses commentaires ')).toBe(
      'Propos homophobes — dans ses commentaires',
    );
  });
});

describe('createReport', () => {
  it('017 appliquée : category + details, id renvoyé', async () => {
    const ins = double([{ data: { id: RID }, error: null }]);
    const r = await createReport({ reporterId: UID, targetType: 'video', targetId: TID, category: 'spam', details: ' pub ' });
    expect(r).toEqual({ ok: true, mock: false, reportId: RID, v2: true, alreadyReported: false });
    expect(ins[0].row).toEqual({ reporter_id: UID, target_type: 'video', target_id: TID, category: 'spam', details: 'pub' });
  });

  it('017 absente : repli sur reason (et mémorisé)', async () => {
    const ins = double([
      { error: { code: 'PGRST204', message: "Could not find the 'category' column" } },
      { error: null },
      { error: null },
    ]);
    const r = await createReport({ reporterId: UID, targetType: 'user', targetId: TID, category: 'negrophobie', details: 'x' });
    expect(r).toMatchObject({ ok: true, v2: false, reportId: null });
    expect(ins[1].row).toMatchObject({ reason: 'Négrophobie — x', status: 'open' });
    await createReport({ reporterId: UID, targetType: 'user', targetId: TID, category: 'spam' });
    expect(ins).toHaveLength(3);
    expect(ins[2].row).toMatchObject({ reason: 'Spam' });
  });

  it('017 absente : signaler un live → indisponible, sans erreur technique', async () => {
    double([{ error: { code: 'PGRST204', message: 'schema cache' } }]);
    const r = await createReport({ reporterId: UID, targetType: 'live', targetId: TID, category: 'spam' });
    expect(r).toEqual({ ok: false, errorKey: 'report.unavailable' });
  });

  it('déjà signalé (23505) → succès « déjà signalé »', async () => {
    double([{ error: { code: '23505', message: 'duplicate' } }]);
    const r = await createReport({ reporterId: UID, targetType: 'video', targetId: TID, category: 'spam' });
    expect(r).toMatchObject({ ok: true, alreadyReported: true });
  });

  it('codes serveur → messages', () => {
    expect(reportErrorKey({ code: '54000' })).toBe('report.rateLimited');
    expect(reportErrorKey({ code: 'P0002' })).toBe('report.notFound');
    expect(reportErrorKey({ code: '22023', message: 'report_self' })).toBe('report.selfReport');
    expect(reportErrorKey({ code: '23514' })).toBe('report.unavailable');
    expect(reportErrorKey({ message: 'Network request failed' })).toBe('report.errorNetwork');
    expect(reportErrorKey({ code: '42501' })).toBe('report.errorSend');
  });

  it('sans compte réel → connexion demandée ; hors ligne → mock', async () => {
    double([{ error: null }]);
    expect(await createReport({ reporterId: 'mock_1', targetType: 'video', targetId: TID, category: 'spam' })).toEqual({
      ok: false,
      errorKey: 'report.signInRequired',
    });
    expect(await createReport({ reporterId: UID, targetType: 'video', targetId: 'local_1', category: 'spam' })).toMatchObject({
      ok: true,
      mock: true,
    });
  });
});

describe('pièces jointes', () => {
  it('type et taille vérifiés comme en SQL', () => {
    expect(checkEvidence({ localUri: 'a.jpg', mimeType: 'image/jpg', size: 10 })).toEqual({ ok: true, contentType: 'image/jpeg', ext: 'jpg' });
    expect(checkEvidence({ localUri: 'file:///x/clip.MOV', size: 10 })).toEqual({ ok: true, contentType: 'video/quicktime', ext: 'mov' });
    expect(checkEvidence({ localUri: 'a.gif', mimeType: 'image/gif' })).toEqual({ ok: false, errorKey: 'report.evidenceType' });
    expect(checkEvidence({ localUri: 'a.mp4', mimeType: 'video/mp4', size: 21 * 1024 * 1024 })).toEqual({
      ok: false,
      errorKey: 'report.evidenceTooLarge',
    });
  });

  it('chemin {reporter}/{report}/{uuid}.{ext}', () => {
    expect(evidencePath(UID, RID, 'jpg')).toMatch(
      new RegExp(`^${UID}/${RID}/[0-9a-f-]{36}\\.jpg$`),
    );
  });

  it('upload puis métadonnée ; au plus 3 fichiers ; fichier refusé compté', async () => {
    const ins = double([{ error: null }], { id: UID, token: 'jwt' });
    const uploads: string[] = [];
    const res = await uploadReportEvidence({
      reporterId: UID,
      reportId: RID,
      files: [
        { localUri: '1.jpg', mimeType: 'image/jpeg', size: 100 },
        { localUri: '2.gif', mimeType: 'image/gif', size: 100 },
        { localUri: '3.mp4', mimeType: 'video/mp4', size: 100 },
        { localUri: '4.jpg', mimeType: 'image/jpeg', size: 100 },
      ],
      upload: async (a) => {
        expect(a.bucket).toBe('report-evidence');
        expect(a.accessToken).toBe('jwt');
        uploads.push(a.path);
      },
    });
    expect(res).toEqual({ uploaded: 2, failed: 1, errorKey: 'report.evidenceType' });
    expect(uploads).toHaveLength(2);
    expect(ins.map((i) => i.table)).toEqual(['report_evidence', 'report_evidence']);
    expect(ins[0].row).toMatchObject({ report_id: RID, mime_type: 'image/jpeg', size_bytes: 100 });
  });

  it('session d’un autre compte → rien n’est envoyé', async () => {
    double([{ error: null }], { id: TID, token: 'jwt' });
    const upload = jest.fn();
    const res = await uploadReportEvidence({
      reporterId: UID,
      reportId: RID,
      files: [{ localUri: '1.jpg', mimeType: 'image/jpeg' }],
      upload,
    });
    expect(upload).not.toHaveBeenCalled();
    expect(res.failed).toBe(1);
  });
});
