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
import {
  __resetVideoDeleteRpcCache,
  deleteOwnVideoForGood,
  ownedVideoFilePaths,
  parseDeleteRpcResponse,
  videoDeleteOutcome,
} from '@/lib/videos';
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

type Reponse = { data: unknown; error: { message: string; code?: string } | null };

/** Base sans 022 : PostgREST ne trouve pas la fonction. */
const RPC_ABSENTE: Reponse = {
  data: null,
  error: { code: 'PGRST202', message: 'Could not find the function public.delete_own_video_for_good' },
};

type Script = {
  /** Réponse de la RPC 022 ; absente par défaut (ancien chemin). */
  rpc?: Reponse;
  row?: Reponse;
  /** Une réponse par requête de référence, dans l'ordre. */
  refs?: Reponse[];
  del?: Reponse;
  remove?: { error: { message: string } | null };
};

type Journal = {
  sequence: string[];
  rpcs: [string, unknown][];
  removed: string[][];
  refsDemandees: [string, unknown][];
  filtresSuppression: [string, unknown][];
};

function double(script: Script) {
  const journal: Journal = {
    sequence: [],
    rpcs: [],
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
    rpc(nom: string, args: unknown) {
      journal.sequence.push('rpc');
      journal.rpcs.push([nom, args]);
      return Promise.resolve(script.rpc ?? RPC_ABSENTE);
    },
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

beforeEach(() => {
  __resetVideoDeleteRpcCache();
});

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

// Les groupes « cas courant », « fichiers épargnés », « refus » et « échec
// Storage » décrivent l'ANCIEN chemin client : celui que l'app reprend tant
// que 022 n'est pas appliquée (la RPC répond PGRST202).
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

describe('deleteOwnVideoForGood — 022 (RPC delete_own_video_for_good)', () => {
  it('passe par la RPC seule : ni lecture, ni comptage, ni DELETE côté client', async () => {
    const j = double({
      rpc: { data: { ok: true, removable: [MEDIA, COVER], kept: [] }, error: null },
    });

    await expect(deleteOwnVideoForGood(UID, VID)).resolves.toEqual({
      ok: true,
      removedFiles: [MEDIA, COVER],
      keptFiles: [],
    });
    expect(j.rpcs).toEqual([['delete_own_video_for_good', { p_video_id: VID }]]);
    expect(j.sequence).toEqual(['rpc', 'storage-remove']);
    expect(j.removed).toEqual([[MEDIA, COVER]]);
  });

  it('garde le fichier qu’un repost invisible à l’auteur désigne encore', async () => {
    // Défaut 2 : le serveur compte TOUTES les lignes (archivées, followers,
    // private, masquées, blocage). L'app n'efface que ce qu'il déclare libre.
    const j = double({
      rpc: { data: { ok: true, removable: [COVER], kept: [MEDIA] }, error: null },
    });

    await expect(deleteOwnVideoForGood(UID, VID)).resolves.toEqual({
      ok: true,
      removedFiles: [COVER],
      keptFiles: [MEDIA],
    });
    expect(j.removed).toEqual([[COVER]]);
  });

  it('n’appelle pas Storage quand tout est gardé', async () => {
    const j = double({
      rpc: { data: { ok: true, removable: [], kept: [MEDIA, COVER] }, error: null },
    });

    await expect(deleteOwnVideoForGood(UID, VID)).resolves.toEqual({
      ok: true,
      removedFiles: [],
      keptFiles: [MEDIA, COVER],
    });
    expect(j.sequence).toEqual(['rpc']);
  });

  it('n’efface jamais un chemin hors du dossier du compte, même rendu par le serveur', async () => {
    const j = double({
      rpc: {
        data: {
          ok: true,
          removable: [`${AUTRE}/upload-9.mp4`, MEDIA, MEDIA, 42],
          kept: [`${UID}-bis/x.jpg`],
        },
        error: null,
      },
    });

    await expect(deleteOwnVideoForGood(UID, VID)).resolves.toEqual({
      ok: true,
      removedFiles: [MEDIA],
      keptFiles: [],
    });
    expect(j.removed).toEqual([[MEDIA]]);
  });

  it('remonte le refus de modération sans rien effacer', async () => {
    const j = double({ rpc: { data: { ok: false, reason: 'moderation_hold' }, error: null } });

    await expect(deleteOwnVideoForGood(UID, VID)).resolves.toEqual({
      ok: false,
      message: 'moderation_hold',
    });
    expect(j.sequence).toEqual(['rpc']);
  });

  it('remonte « introuvable » (vidéo d’autrui ou absente) sans rien effacer', async () => {
    const j = double({ rpc: { data: { ok: false, reason: 'not_found' }, error: null } });

    await expect(deleteOwnVideoForGood(UID, VID)).resolves.toEqual({
      ok: false,
      message: 'not_found',
    });
    expect(j.removed).toEqual([]);
  });

  it('dit que le fichier est resté si Storage échoue après la RPC', async () => {
    double({
      rpc: { data: { ok: true, removable: [MEDIA], kept: [COVER] }, error: null },
      remove: { error: { message: 'storage offline' } },
    });

    await expect(deleteOwnVideoForGood(UID, VID)).resolves.toEqual({
      ok: true,
      removedFiles: [],
      keptFiles: [COVER],
      fileError: 'storage offline',
    });
  });

  it('une erreur de la RPC (autre que « fonction absente ») ne bascule PAS sur l’ancien chemin', async () => {
    // L'ancien chemin compterait mal : on préfère un échec honnête.
    const j = double({
      rpc: { data: null, error: { code: '08006', message: 'Network request failed' } },
      row: ligne(),
    });

    await expect(deleteOwnVideoForGood(UID, VID)).resolves.toEqual({
      ok: false,
      message: 'Network request failed',
    });
    expect(j.sequence).toEqual(['rpc']);
  });

  it('refuse une réponse illisible sans rien effacer', async () => {
    const j = double({ rpc: { data: 'oui', error: null } });

    await expect(deleteOwnVideoForGood(UID, VID)).resolves.toEqual({
      ok: false,
      message: 'delete_fail',
    });
    expect(j.removed).toEqual([]);
  });
});

describe('deleteOwnVideoForGood — 022 non appliquée (repli, comme S2)', () => {
  it('reprend l’ancien chemin quand la RPC est absente (PGRST202)', async () => {
    const j = double({ row: ligne(), refs: [{ data: [], error: null }, { data: [], error: null }] });

    await expect(deleteOwnVideoForGood(UID, VID)).resolves.toEqual({
      ok: true,
      removedFiles: [MEDIA, COVER],
      keptFiles: [],
    });
    expect(j.sequence).toEqual([
      'rpc',
      'read-row',
      'refs',
      'refs',
      'refs',
      'refs',
      'delete-row',
      'storage-remove',
    ]);
  });

  it('reprend aussi l’ancien chemin sur 42883 (fonction inconnue côté Postgres)', async () => {
    const j = double({
      rpc: { data: null, error: { code: '42883', message: 'function does not exist' } },
      row: ligne(),
    });
    await expect(deleteOwnVideoForGood(UID, VID)).resolves.toMatchObject({ ok: true });
    expect(j.sequence).toContain('delete-row');
  });

  it('mémorise l’absence pour la session : pas de 2e appel RPC', async () => {
    let j = double({ row: ligne() });
    await deleteOwnVideoForGood(UID, VID);
    expect(j.rpcs).toHaveLength(1);

    j = double({ row: ligne() });
    await deleteOwnVideoForGood(UID, VID);
    expect(j.rpcs).toHaveLength(0);
    expect(j.sequence).toContain('delete-row');
  });
});

describe('parseDeleteRpcResponse', () => {
  it('lit les deux formes de réponse', () => {
    expect(parseDeleteRpcResponse(UID, { ok: true, removable: [MEDIA], kept: [COVER] })).toEqual({
      ok: true,
      removable: [MEDIA],
      kept: [COVER],
    });
    expect(parseDeleteRpcResponse(UID, { ok: false, reason: 'not_found' })).toEqual({
      ok: false,
      reason: 'not_found',
    });
  });

  it('tolère des listes absentes, rejette le reste', () => {
    expect(parseDeleteRpcResponse(UID, { ok: true })).toEqual({ ok: true, removable: [], kept: [] });
    expect(parseDeleteRpcResponse(UID, { ok: false })).toEqual({ ok: false, reason: 'delete_fail' });
    expect(parseDeleteRpcResponse(UID, null)).toBeNull();
    expect(parseDeleteRpcResponse(UID, [])).toBeNull();
    expect(parseDeleteRpcResponse(UID, { removable: [MEDIA] })).toBeNull();
  });
});

describe('videoDeleteOutcome — les trois issues (défaut 1)', () => {
  it('fichier effacé', () => {
    expect(videoDeleteOutcome({ ok: true, removedFiles: [MEDIA], keptFiles: [] })).toBe('removed');
    // Repost de la vidéo d'autrui : aucun fichier à soi, rien de gardé.
    expect(videoDeleteOutcome({ ok: true, removedFiles: [], keptFiles: [] })).toBe('removed');
  });

  it('fichier gardé pour un repost — même si la couverture, elle, est partie', () => {
    expect(videoDeleteOutcome({ ok: true, removedFiles: [], keptFiles: [MEDIA] })).toBe(
      'kept_for_repost',
    );
    expect(videoDeleteOutcome({ ok: true, removedFiles: [COVER], keptFiles: [MEDIA] })).toBe(
      'kept_for_repost',
    );
  });

  it('échec : rien supprimé, ou ligne partie mais fichier resté', () => {
    expect(videoDeleteOutcome({ ok: false, message: 'not_found' })).toBe('failed');
    expect(
      videoDeleteOutcome({ ok: true, removedFiles: [], keptFiles: [MEDIA], fileError: 'x' }),
    ).toBe('file_error');
  });

  it('mode démo', () => {
    expect(videoDeleteOutcome({ ok: true, mock: true, removedFiles: [], keptFiles: [] })).toBe(
      'mock',
    );
  });
});
