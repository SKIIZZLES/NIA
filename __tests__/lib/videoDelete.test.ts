/**
 * Suppression définitive d'une vidéo, fichiers compris.
 *
 * Ce qui est couvert ici, c'est la décision : quels objets du bucket sont
 * effacés, lesquels sont épargnés, et dans quel ordre. Les politiques RLS
 * refuseraient déjà le dossier d'un autre compte ; ces tests vérifient que le
 * code ne le tente même pas, parce qu'une politique peut être modifiée dans le
 * tableau de bord Supabase sans que personne ne relise ce fichier.
 *
 * La confirmation à l'écran n'est pas testable : `Alert.alert` est une
 * fonction vide dans react-native-web.
 */
import { deleteOwnVideoForGood, ownedVideoFilePaths } from '@/lib/videos';
import { getSupabase } from '@/lib/supabase';

jest.mock('@/lib/supabase', () => ({
  getSupabase: jest.fn(),
  isSupabaseConfigured: true,
}));

const mockedGetSupabase = getSupabase as jest.MockedFunction<typeof getSupabase>;

const UID = '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const AUTRE = '9a8b7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d';
const VID = 'c0ffee00-1111-4222-8333-444455556666';
const MEDIA = `${UID}/upload-1.mp4`;
const COVER = `${UID}/covers/upload-1.jpg`;

type Reponse = { data: unknown; error: { message: string } | null };

type Script = {
  row?: Reponse;
  /** Une réponse par requête de référence, dans l'ordre. */
  refs?: Reponse[];
  del?: Reponse;
  remove?: { error: { message: string } | null };
};

type Journal = {
  sequence: string[];
  removed: string[][];
  refsDemandees: [string, unknown][];
  filtresSuppression: [string, unknown][];
};

function double(script: Script) {
  const journal: Journal = {
    sequence: [],
    removed: [],
    refsDemandees: [],
    filtresSuppression: [],
  };
  let iRefs = 0;

  const from = () => {
    let mode: 'select' | 'delete' = 'select';
    const b = {
      select() {
        return b;
      },
      delete() {
        mode = 'delete';
        return b;
      },
      eq(col: string, val: unknown) {
        if (mode === 'delete') journal.filtresSuppression.push([col, val]);
        else if (col !== 'id') journal.refsDemandees.push([col, val]);
        return b;
      },
      neq() {
        return b;
      },
      limit() {
        journal.sequence.push('refs');
        const r = script.refs?.[iRefs++] ?? { data: [], error: null };
        return Promise.resolve(r);
      },
      maybeSingle() {
        if (mode === 'delete') {
          journal.sequence.push('delete-row');
          return Promise.resolve(script.del ?? { data: { id: VID }, error: null });
        }
        journal.sequence.push('read-row');
        return Promise.resolve(script.row ?? { data: null, error: null });
      },
    };
    return b;
  };

  const client = {
    from,
    storage: {
      from: () => ({
        remove: (chemins: string[]) => {
          journal.sequence.push('storage-remove');
          journal.removed.push(chemins);
          return Promise.resolve(script.remove ?? { error: null });
        },
      }),
    },
  } as unknown as ReturnType<typeof getSupabase>;

  mockedGetSupabase.mockReturnValue(client);
  return journal;
}

function ligne(extra: Record<string, unknown> = {}): Reponse {
  return {
    data: {
      user_id: UID,
      storage_path: MEDIA,
      cover_path: COVER,
      repost_of: null,
      ...extra,
    },
    error: null,
  };
}

describe('ownedVideoFilePaths', () => {
  it('rend le média et la couverture du compte', () => {
    expect(
      ownedVideoFilePaths(UID, { user_id: UID, storage_path: MEDIA, cover_path: COVER }),
    ).toEqual([MEDIA, COVER]);
  });

  it('ne rend rien pour un repost de la vidéo de quelqu’un d’autre', () => {
    // Un repost recopie les chemins de l'original : les fichiers sont ceux de
    // l'auteur. Aucune garde dédiée n'est nécessaire — le préfixe suffit, et
    // c'est lui qu'on vérifie ici.
    expect(
      ownedVideoFilePaths(UID, {
        user_id: UID,
        storage_path: `${AUTRE}/upload-9.mp4`,
        cover_path: `${AUTRE}/covers/upload-9.jpg`,
      }),
    ).toEqual([]);
  });

  it('écarte tout chemin hors du dossier du compte', () => {
    // Témoin direct : sans le filtre de préfixe, une ligne fabriquée ferait
    // viser le dossier de quelqu'un d'autre.
    expect(
      ownedVideoFilePaths(UID, {
        user_id: UID,
        storage_path: `${AUTRE}/upload-9.mp4`,
        cover_path: COVER,
      }),
    ).toEqual([COVER]);
  });

  it('refuse un préfixe qui ressemble au bon sans en être un', () => {
    expect(
      ownedVideoFilePaths(UID, { user_id: UID, storage_path: `${UID}-bis/x.mp4` }),
    ).toEqual([]);
    expect(
      ownedVideoFilePaths(UID, { user_id: UID, storage_path: `autre/${UID}/x.mp4` }),
    ).toEqual([]);
  });

  it('dédoublonne, ignore le vide et les espaces', () => {
    expect(
      ownedVideoFilePaths(UID, { user_id: UID, storage_path: MEDIA, cover_path: MEDIA }),
    ).toEqual([MEDIA]);
    expect(
      ownedVideoFilePaths(UID, { user_id: UID, storage_path: '   ', cover_path: null }),
    ).toEqual([]);
  });

  it('ne rend rien sans identifiant de compte', () => {
    expect(ownedVideoFilePaths('', { user_id: '', storage_path: MEDIA })).toEqual([]);
  });
});

describe('deleteOwnVideoForGood — cas courant', () => {
  it('efface le média, la couverture et la ligne', async () => {
    const j = double({ row: ligne(), refs: [{ data: [], error: null }, { data: [], error: null }] });

    await expect(deleteOwnVideoForGood(UID, VID)).resolves.toEqual({
      ok: true,
      removedFiles: [MEDIA, COVER],
      keptFiles: [],
    });
    expect(j.removed).toEqual([[MEDIA, COVER]]);
  });

  it('supprime la ligne AVANT les fichiers', async () => {
    // Dans l'autre ordre, un échec de suppression de ligne laisserait une
    // carte dans le fil avec un fichier manquant. Une ligne partie et un
    // objet resté est une fuite invisible ; l'inverse est un 404 visible.
    const j = double({ row: ligne(), refs: [{ data: [], error: null }, { data: [], error: null }] });
    await deleteOwnVideoForGood(UID, VID);

    expect(j.sequence.indexOf('delete-row')).toBeLessThan(
      j.sequence.indexOf('storage-remove'),
    );
  });

  it('filtre la suppression sur l’identifiant ET le propriétaire', async () => {
    const j = double({ row: ligne(), refs: [{ data: [], error: null }, { data: [], error: null }] });
    await deleteOwnVideoForGood(UID, VID);

    expect(j.filtresSuppression).toEqual([
      ['id', VID],
      ['user_id', UID],
    ]);
  });
});

describe('deleteOwnVideoForGood — fichiers épargnés', () => {
  it('garde un objet qu’une autre ligne désigne encore', async () => {
    // Quelqu'un a reposté : sa ligne porte le même storage_path. Effacer
    // l'objet lui afficherait une carte morte.
    const j = double({
      row: ligne(),
      refs: [{ data: [{ id: 'repost-1' }], error: null }, { data: [], error: null }],
    });

    await expect(deleteOwnVideoForGood(UID, VID)).resolves.toEqual({
      ok: true,
      removedFiles: [COVER],
      keptFiles: [MEDIA],
    });
    expect(j.removed).toEqual([[COVER]]);
  });

  it('ne touche à aucun fichier quand tout est encore référencé', async () => {
    const j = double({
      row: ligne(),
      refs: [
        { data: [{ id: 'repost-1' }], error: null },
        { data: [{ id: 'repost-1' }], error: null },
      ],
    });

    await expect(deleteOwnVideoForGood(UID, VID)).resolves.toEqual({
      ok: true,
      removedFiles: [],
      keptFiles: [MEDIA, COVER],
    });
    expect(j.removed).toEqual([]);
  });

  it('ne touche à aucun fichier en supprimant le repost d’autrui', async () => {
    const j = double({
      row: ligne({
        storage_path: `${AUTRE}/upload-9.mp4`,
        cover_path: `${AUTRE}/covers/upload-9.jpg`,
      }),
    });

    await expect(deleteOwnVideoForGood(UID, VID)).resolves.toEqual({
      ok: true,
      removedFiles: [],
      keptFiles: [],
    });
    expect(j.removed).toEqual([]);
    expect(j.sequence).toContain('delete-row');
    // Aucune requête de référence : il n'y avait rien à effacer, donc rien à
    // vérifier. Une requête ici serait un aller-retour réseau pour rien.
    expect(j.sequence).not.toContain('refs');
  });

  it('efface le fichier de sa propre vidéo repostée par elle-même, quand c’est la dernière ligne', async () => {
    // Repost de sa propre vidéo : les chemins sont dans son dossier. Tant que
    // l'original existe, le fichier reste (test précédent). Quand plus rien ne
    // le désigne, il doit partir — une garde « jamais les fichiers d'un
    // repost » l'aurait laissé orphelin pour toujours.
    const j = double({
      row: ligne(),
      refs: [{ data: [], error: null }, { data: [], error: null }],
    });

    await expect(deleteOwnVideoForGood(UID, VID)).resolves.toEqual({
      ok: true,
      removedFiles: [MEDIA, COVER],
      keptFiles: [],
    });
    expect(j.removed).toEqual([[MEDIA, COVER]]);
  });

  it('cherche les références sur les deux colonnes de chemin', async () => {
    // Une couverture peut être désignée par cover_path chez l'auteur et par
    // le même cover_path chez un reposteur ; ne regarder qu'une colonne
    // laisserait passer l'autre.
    const j = double({ row: ligne(), refs: [{ data: [], error: null }, { data: [], error: null }] });
    await deleteOwnVideoForGood(UID, VID);

    expect(j.refsDemandees).toEqual([
      ['storage_path', MEDIA],
      ['cover_path', MEDIA],
      ['storage_path', COVER],
      ['cover_path', COVER],
    ]);
  });
});

describe('deleteOwnVideoForGood — refus', () => {
  it('refuse une ligne qui appartient à quelqu’un d’autre', async () => {
    const j = double({ row: ligne({ user_id: AUTRE }) });

    await expect(deleteOwnVideoForGood(UID, VID)).resolves.toEqual({
      ok: false,
      message: 'not_owner',
    });
    expect(j.sequence).not.toContain('delete-row');
    expect(j.removed).toEqual([]);
  });

  it('refuse une ligne introuvable', async () => {
    const j = double({ row: { data: null, error: null } });
    await expect(deleteOwnVideoForGood(UID, VID)).resolves.toEqual({
      ok: false,
      message: 'not_found',
    });
    expect(j.sequence).not.toContain('delete-row');
  });

  it('n’efface rien quand la recherche de références échoue', async () => {
    // Sans réponse fiable, on ne peut pas savoir si l'objet est partagé.
    const j = double({
      row: ligne(),
      refs: [{ data: null, error: { message: 'timeout' } }],
    });

    await expect(deleteOwnVideoForGood(UID, VID)).resolves.toEqual({
      ok: false,
      message: 'timeout',
    });
    expect(j.sequence).not.toContain('delete-row');
    expect(j.removed).toEqual([]);
  });

  it('n’efface aucun fichier si la suppression de la ligne échoue', async () => {
    const j = double({
      row: ligne(),
      refs: [{ data: [], error: null }, { data: [], error: null }],
      del: { data: null, error: { message: 'permission denied' } },
    });

    await expect(deleteOwnVideoForGood(UID, VID)).resolves.toEqual({
      ok: false,
      message: 'permission denied',
    });
    expect(j.removed).toEqual([]);
  });

  it('remonte l’erreur de lecture sans la masquer', async () => {
    double({ row: { data: null, error: { message: 'Network request failed' } } });
    await expect(deleteOwnVideoForGood(UID, VID)).resolves.toEqual({
      ok: false,
      message: 'Network request failed',
    });
  });

  it('refuse des identifiants vides', async () => {
    const j = double({ row: ligne() });
    await expect(deleteOwnVideoForGood(UID, '')).resolves.toEqual({
      ok: false,
      message: 'missing_ids',
    });
    expect(j.sequence).toEqual([]);
  });
});

describe('deleteOwnVideoForGood — échec Storage', () => {
  it('dit que le fichier est resté au lieu d’annoncer une suppression complète', async () => {
    const j = double({
      row: ligne(),
      refs: [{ data: [], error: null }, { data: [], error: null }],
      remove: { error: { message: 'storage offline' } },
    });

    await expect(deleteOwnVideoForGood(UID, VID)).resolves.toEqual({
      ok: true,
      removedFiles: [],
      keptFiles: [],
      fileError: 'storage offline',
    });
    // La ligne est bien partie : la vidéo a disparu de l'application.
    expect(j.sequence).toContain('delete-row');
  });
});

describe('deleteOwnVideoForGood — sans backend', () => {
  it('ne tente rien sans client Supabase', async () => {
    mockedGetSupabase.mockReturnValue(null);
    await expect(deleteOwnVideoForGood(UID, VID)).resolves.toEqual({
      ok: true,
      mock: true,
      removedFiles: [],
      keptFiles: [],
    });
  });

  it('ne tente rien pour un utilisateur mock', async () => {
    const j = double({ row: ligne() });
    await expect(deleteOwnVideoForGood('mock_user_aminata', VID)).resolves.toEqual({
      ok: true,
      mock: true,
      removedFiles: [],
      keptFiles: [],
    });
    expect(j.sequence).toEqual([]);
  });
});
