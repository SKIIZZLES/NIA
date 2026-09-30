/**
 * Suppression de son propre commentaire.
 *
 * La politique `comments_delete_own` (migration 002) autorise exactement cela.
 * Ces tests vérifient que la requête part avec les deux filtres, et qu'elle ne
 * part pas du tout quand il n'y a rien à supprimer côté serveur — un
 * commentaire optimiste ou un commentaire du mode démo n'existe que dans l'état
 * de l'écran.
 */
import { deleteOwnComment } from '@/lib/comments';
import { getSupabase } from '@/lib/supabase';

jest.mock('@/lib/supabase', () => ({
  getSupabase: jest.fn(),
  isSupabaseConfigured: true,
}));

const mockedGetSupabase = getSupabase as jest.MockedFunction<typeof getSupabase>;

const UID = '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const CID = 'c0ffee00-1111-4222-8333-444455556666';

type Reponse = { data: unknown; error: { message: string } | null };

function double(reponse: Reponse = { data: { id: CID }, error: null }) {
  const journal = { appels: 0, filtres: [] as [string, unknown][] };
  const client = {
    from: () => {
      const b = {
        delete() {
          journal.appels += 1;
          return b;
        },
        eq(col: string, val: unknown) {
          journal.filtres.push([col, val]);
          return b;
        },
        select() {
          return b;
        },
        maybeSingle: () => Promise.resolve(reponse),
      };
      return b;
    },
  } as unknown as ReturnType<typeof getSupabase>;
  mockedGetSupabase.mockReturnValue(client);
  return journal;
}

describe('deleteOwnComment — envoie la requête', () => {
  it('filtre sur l’identifiant du commentaire ET sur le propriétaire', async () => {
    // Le filtre user_id double la politique RLS. Volontairement : une politique
    // se modifie dans le tableau de bord sans que personne ne relise ce fichier.
    const j = double();
    await expect(deleteOwnComment(UID, CID)).resolves.toEqual({ ok: true, mock: false });
    expect(j.appels).toBe(1);
    expect(j.filtres).toEqual([
      ['id', CID],
      ['user_id', UID],
    ]);
  });

  it('refuse quand aucune ligne n’a été supprimée', async () => {
    // Cas réel : le commentaire appartient à quelqu'un d'autre. La politique
    // filtre, PostgREST renvoie zéro ligne et pas d'erreur.
    double({ data: null, error: null });
    await expect(deleteOwnComment(UID, CID)).resolves.toEqual({
      ok: false,
      message: 'not_owner_or_missing',
    });
  });

  it('remonte le message de Supabase sans le masquer', async () => {
    double({ data: null, error: { message: 'permission denied for table comments' } });
    await expect(deleteOwnComment(UID, CID)).resolves.toEqual({
      ok: false,
      message: 'permission denied for table comments',
    });
  });

  it('survit à une exception réseau', async () => {
    const client = {
      from: () => ({
        delete: () => {
          throw new Error('Network request failed');
        },
      }),
    } as unknown as ReturnType<typeof getSupabase>;
    mockedGetSupabase.mockReturnValue(client);
    await expect(deleteOwnComment(UID, CID)).resolves.toEqual({
      ok: false,
      message: 'Network request failed',
    });
  });
});

describe('deleteOwnComment — n’envoie rien', () => {
  it('ne tente rien sans client Supabase', async () => {
    mockedGetSupabase.mockReturnValue(null);
    await expect(deleteOwnComment(UID, CID)).resolves.toEqual({ ok: true, mock: true });
  });

  it('ne tente rien pour un utilisateur mock', async () => {
    const j = double();
    await expect(deleteOwnComment('mock_user_aminata', CID)).resolves.toEqual({
      ok: true,
      mock: true,
    });
    expect(j.appels).toBe(0);
  });

  it('ne tente rien pour un commentaire optimiste', async () => {
    // `opt_…` n'existe que dans l'état de l'écran : la requête partirait avec un
    // identifiant que PostgREST rejetterait comme uuid invalide.
    const j = double();
    await expect(deleteOwnComment(UID, 'opt_1758000000000')).resolves.toEqual({
      ok: true,
      mock: true,
    });
    expect(j.appels).toBe(0);
  });

  it('ne tente rien pour un commentaire du mode démo', async () => {
    const j = double();
    await expect(deleteOwnComment(UID, 'mock_c_1758000000000')).resolves.toEqual({
      ok: true,
      mock: true,
    });
    expect(j.appels).toBe(0);
  });

  it('refuse un identifiant vide', async () => {
    const j = double();
    await expect(deleteOwnComment(UID, '')).resolves.toEqual({
      ok: false,
      message: 'missing_ids',
    });
    expect(j.appels).toBe(0);
  });
});
