/**
 * Trois fonctions pures extraites de lib/videos.ts. Les chemins Supabase
 * (fetch / upload / changement de statut) ne sont pas couverts ici : ils
 * demandent un double du client, pas un test unitaire.
 */
import { formatFeedLoadError, mapRowToVideoItem, resolveUploadContentType } from '@/lib/videos';

describe('resolveUploadContentType', () => {
  it('fait confiance au mimeType du picker', () => {
    expect(
      resolveUploadContentType({ mimeType: 'video/mp4', localUri: 'file:///tmp/x' }),
    ).toEqual({ contentType: 'video/mp4', ext: 'mp4' });
  });

  it('nettoie les paramètres du mime et normalise image/jpg', () => {
    expect(
      resolveUploadContentType({ mimeType: 'image/JPEG; charset=utf-8', localUri: 'file:///a' }),
    ).toEqual({ contentType: 'image/jpeg', ext: 'jpg' });
    expect(
      resolveUploadContentType({ mimeType: 'image/jpg', localUri: 'file:///a' }),
    ).toEqual({ contentType: 'image/jpeg', ext: 'jpg' });
  });

  it('ne renvoie jamais text/plain', () => {
    // fetch(file).blob() sur Android annonce régulièrement text/plain : le
    // gober ferait servir la vidéo en texte par Storage.
    const resolved = resolveUploadContentType({
      mimeType: 'text/plain',
      localUri: 'content://media/external/video/42',
      mediaKind: 'video',
    });
    expect(resolved.contentType).toBe('video/mp4');
  });

  it('refuse application/octet-stream et retombe sur l’extension', () => {
    expect(
      resolveUploadContentType({
        mimeType: 'application/octet-stream',
        localUri: 'file:///tmp/clip.mov',
      }),
    ).toEqual({ contentType: 'video/quicktime', ext: 'mov' });
  });

  it('préfère fileName à l’URI quand les deux portent une extension', () => {
    // Le contenu URI Android ne dit rien du format ; fileName, si.
    expect(
      resolveUploadContentType({
        mimeType: null,
        localUri: 'content://media/external/images/1.bin',
        fileName: 'IMG_0001.png',
      }),
    ).toEqual({ contentType: 'image/png', ext: 'png' });
  });

  it('lit l’extension malgré une query string', () => {
    expect(
      resolveUploadContentType({ mimeType: null, localUri: 'file:///tmp/a.webm?x=1' }).contentType,
    ).toBe('video/webm');
  });

  it('utilise mediaKind en dernier recours', () => {
    expect(
      resolveUploadContentType({ mimeType: null, localUri: 'content://x/1', mediaKind: 'image' }),
    ).toEqual({ contentType: 'image/jpeg', ext: 'jpg' });
  });

  it('défaut vidéo quand Android n’a donné ni mime, ni extension, ni kind', () => {
    // NIA est une app de vidéo verticale : le défaut le moins coûteux est mp4.
    expect(
      resolveUploadContentType({ mimeType: null, localUri: 'content://x/1' }),
    ).toEqual({ contentType: 'video/mp4', ext: 'mp4' });
  });
});

describe('formatFeedLoadError', () => {
  it('reconnaît une panne réseau', () => {
    expect(formatFeedLoadError(new Error('Network request failed'))).toMatch(
      /^Réseau indisponible\./,
    );
    expect(formatFeedLoadError({ message: 'fetch failed' })).toMatch(/^Réseau indisponible\./);
    expect(formatFeedLoadError({ message: 'boom', code: 'ETIMEDOUT' })).toMatch(
      /^Réseau indisponible\./,
    );
  });

  it('reconnaît un refus RLS', () => {
    expect(formatFeedLoadError({ message: 'x', code: '42501' })).toMatch(/^Accès refusé \(RLS\)\./);
    expect(formatFeedLoadError({ message: 'permission denied for table videos' })).toMatch(
      /^Accès refusé \(RLS\)\./,
    );
  });

  it('reconnaît un problème de clé ou de session', () => {
    expect(formatFeedLoadError({ message: 'Invalid API key' })).toMatch(/^Clé \/ session API\./);
    expect(formatFeedLoadError({ message: 'x', code: 'PGRST301' })).toMatch(
      /^Clé \/ session API\./,
    );
  });

  it('reconnaît une relation ambiguë', () => {
    expect(formatFeedLoadError({ message: 'x', code: 'PGRST201' })).toMatch(
      /^Relation feed ambiguë\./,
    );
  });

  it('reconnaît une migration manquante', () => {
    // C'est l'erreur que produit un Supabase où les migrations n'ont pas été
    // jouées — le message par défaut n'aiderait pas à la diagnostiquer.
    expect(formatFeedLoadError({ message: 'x', code: '42P01' })).toMatch(
      /^Schéma \/ migration manquante\./,
    );
    expect(formatFeedLoadError({ message: 'relation "sounds" does not exist' })).toMatch(
      /^Schéma \/ migration manquante\./,
    );
  });

  it('préfixe le code inconnu et garde le message', () => {
    expect(formatFeedLoadError({ message: 'quelque chose', code: 'XX999' })).toBe(
      'Impossible de charger le feed. [XX999] quelque chose',
    );
  });

  it('survit à tout ce qui n’est pas une erreur', () => {
    for (const input of [null, undefined, 'texte nu', 42, {}, { message: '   ' }]) {
      const rendered = formatFeedLoadError(input);
      expect(typeof rendered).toBe('string');
      expect(rendered).toContain('Erreur inconnue');
    }
  });
});

type Row = Parameters<typeof mapRowToVideoItem>[0];

function row(overrides: Partial<Row> = {}): Row {
  return {
    id: 'vid-1',
    user_id: 'user-1',
    caption: 'Rythmes du marché',
    thumbnail_url: null,
    status: 'published',
    like_count: 3,
    share_count: 1,
    region: null,
    tag: null,
    category: null,
    repost_of: null,
    profiles: { username: 'aminata', avatar_url: null, display_name: 'Aminata' },
    ...overrides,
  } as Row;
}

describe('mapRowToVideoItem', () => {
  const PUBLIC_URL = 'https://xyz.supabase.co/storage/v1/object/public/videos/vid-1.mp4';

  it('mappe les champs de base', () => {
    const item = mapRowToVideoItem(row(), PUBLIC_URL);
    expect(item.id).toBe('vid-1');
    expect(item.videoUrl).toBe(PUBLIC_URL);
    expect(item.handle).toBe('@aminata');
    expect(item.likes).toBe(3);
    expect(item.shares).toBe(1);
    expect(item.userId).toBe('user-1');
    expect(item.mediaType).toBe('video');
  });

  it('ne met jamais une URL de vidéo dans thumbnailUrl', () => {
    // La règle de mediaThumb appliquée à la source : une vignette vidéo est
    // effacée plutôt que servie à <Image />.
    expect(
      mapRowToVideoItem(row({ thumbnail_url: 'https://cdn.nia.app/t.mp4' }), PUBLIC_URL)
        .thumbnailUrl,
    ).toBe('');
    expect(mapRowToVideoItem(row(), PUBLIC_URL).thumbnailUrl).toBe('');
  });

  it('utilise l’URL publique comme vignette d’un post image', () => {
    const item = mapRowToVideoItem(
      { ...row(), media_type: 'image' } as Row,
      'https://xyz.supabase.co/storage/v1/object/public/videos/p.jpg',
    );
    expect(item.mediaType).toBe('image');
    expect(item.thumbnailUrl).toBe(
      'https://xyz.supabase.co/storage/v1/object/public/videos/p.jpg',
    );
  });

  it('remplit les compteurs manquants par zéro', () => {
    // `types/database.ts` déclare ces colonnes non nulles, et pourtant
    // `mapRowToVideoItem` garde un `?? 0`. C'est cette garde qu'on teste : une
    // migration en retard, une vue, un `select` partiel, et Postgres renvoie
    // bien null là où le type promet un nombre. On sort donc du type exprès.
    const item = mapRowToVideoItem(
      { ...row(), like_count: null, share_count: null, save_count: null } as unknown as Row,
      PUBLIC_URL,
    );
    expect(item.likes).toBe(0);
    expect(item.shares).toBe(0);
    expect(item.saves).toBe(0);
  });

  it('fabrique un handle et un avatar quand le profil manque', () => {
    const item = mapRowToVideoItem(row({ profiles: null }), PUBLIC_URL);
    expect(item.handle).toBe('@createur');
    expect(item.avatarUrl).toContain('pravatar.cc');
  });

  it('déduit l’onglet du couple région / tag', () => {
    expect(mapRowToVideoItem(row({ region: 'Sénégal' }), PUBLIC_URL).tab).toBe('pour-toi');
    expect(mapRowToVideoItem(row({ region: 'Afrique' }), PUBLIC_URL).tab).toBe('afrique');
    expect(mapRowToVideoItem(row({ tag: 'decouvrir' }), PUBLIC_URL).tab).toBe('decouvrir');
    expect(mapRowToVideoItem(row({ tag: 'abonnements' }), PUBLIC_URL).tab).toBe('abonnements');
  });

  it('respecte une catégorie explicite et sinon la devine', () => {
    expect(mapRowToVideoItem(row({ category: 'musique' }), PUBLIC_URL).category).toBe('musique');
    expect(mapRowToVideoItem(row({ category: 'nawak', tag: 'beat' }), PUBLIC_URL).category).toBe(
      'musique',
    );
    expect(mapRowToVideoItem(row({ tag: 'maroc' }), PUBLIC_URL).category).toBe('maghreb');
    expect(mapRowToVideoItem(row(), PUBLIC_URL).category).toBeUndefined();
  });

  it('expose le son attaché quand il est joint', () => {
    const item = mapRowToVideoItem(
      {
        ...row(),
        sounds: { id: 's1', title: 'Bataclan', profiles: { username: 'kwame' } },
      } as Row,
      PUBLIC_URL,
    );
    expect(item.soundId).toBe('s1');
    expect(item.soundTitle).toBe('Bataclan');
    expect(item.soundCreatorHandle).toBe('@kwame');
  });
});
