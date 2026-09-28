/**
 * Règle non négociable du fichier testé : ne jamais passer une URL de vidéo à
 * <Image />. La conséquence d'une erreur ici est une grille de vignettes
 * vides, silencieuse en CI comme au typecheck.
 */
import {
  isLikelyImageUrl,
  isLikelyVideoUrl,
  resolveGridThumbUrl,
} from '@/lib/mediaThumb';

describe('isLikelyVideoUrl', () => {
  it('reconnaît les extensions vidéo', () => {
    for (const url of [
      'https://cdn.nia.app/a.mp4',
      'https://cdn.nia.app/a.m4v',
      'https://cdn.nia.app/a.mov',
      'https://cdn.nia.app/a.webm',
      'https://cdn.nia.app/a.qt',
    ]) {
      expect(isLikelyVideoUrl(url)).toBe(true);
    }
  });

  it('ignore la casse et tolère query string et fragment', () => {
    expect(isLikelyVideoUrl('https://cdn.nia.app/A.MP4')).toBe(true);
    expect(isLikelyVideoUrl('https://cdn.nia.app/a.mp4?token=x')).toBe(true);
    expect(isLikelyVideoUrl('https://cdn.nia.app/a.mp4#t=3')).toBe(true);
  });

  it('n’est pas piégé par l’extension au milieu du chemin', () => {
    // Le nom d'un dossier ne fait pas le type du fichier.
    expect(isLikelyVideoUrl('https://cdn.nia.app/mp4/cover.jpg')).toBe(false);
  });

  it('renvoie false sur vide, null, undefined', () => {
    expect(isLikelyVideoUrl('')).toBe(false);
    expect(isLikelyVideoUrl(null)).toBe(false);
    expect(isLikelyVideoUrl(undefined)).toBe(false);
  });
});

describe('isLikelyImageUrl', () => {
  it('reconnaît les extensions image', () => {
    for (const ext of ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif', 'avif']) {
      expect(isLikelyImageUrl(`https://cdn.nia.app/a.${ext}`)).toBe(true);
    }
  });

  it('refuse une vidéo même quand un autre indice la ferait passer pour une image', () => {
    // Ces trois cas passent tous par la garde vidéo placée en tête de
    // `isLikelyImageUrl`. Chacun est un cas réel, et chacun est nécessaire :
    // le premier seul ne prouve rien, parce que `IMAGE_EXT_RE` exige que
    // l'extension image termine l'URL — `.jpg.mp4` ne matche déjà pas.
    //
    // Vérifié par mutation : sans les deux suivants, retirer la garde ne fait
    // échouer aucun test.
    expect(isLikelyImageUrl('https://cdn.nia.app/a.jpg.mp4')).toBe(false);
    // Une URI locale de picker : le préfixe `file:` suffirait à la laisser passer.
    expect(isLikelyImageUrl('file:///var/tmp/clip.mp4')).toBe(false);
    expect(isLikelyImageUrl('content://media/external/video/42.mov')).toBe(false);
    // Une URL signée dont la query string finit par une extension image.
    expect(isLikelyImageUrl('https://cdn.nia.app/clip.mp4?poster=cover.jpg')).toBe(false);
  });

  it('accepte les URI locales des pickers', () => {
    expect(isLikelyImageUrl('data:image/png;base64,AAAA')).toBe(true);
    expect(isLikelyImageUrl('file:///var/tmp/IMG_0001')).toBe(true);
    expect(isLikelyImageUrl('content://media/external/images/1')).toBe(true);
  });

  it('accepte les CDN d’image sans extension utilisés par les mocks', () => {
    expect(isLikelyImageUrl('https://picsum.photos/seed/nia/400')).toBe(true);
    expect(isLikelyImageUrl('https://i.pravatar.cc/150?u=ama')).toBe(true);
    expect(isLikelyImageUrl('https://images.unsplash.com/photo-1')).toBe(true);
  });

  it('refuse une URL sans indice de type', () => {
    expect(isLikelyImageUrl('https://cdn.nia.app/objects/abc123')).toBe(false);
    expect(isLikelyImageUrl('')).toBe(false);
    expect(isLikelyImageUrl(null)).toBe(false);
  });

  it('refuse data: non-image', () => {
    expect(isLikelyImageUrl('data:video/mp4;base64,AAAA')).toBe(false);
  });
});

describe('resolveGridThumbUrl', () => {
  it('garde une vignette image explicite', () => {
    expect(
      resolveGridThumbUrl({ thumbnailUrl: 'https://cdn.nia.app/t.jpg', mediaType: 'video' }),
    ).toBe('https://cdn.nia.app/t.jpg');
  });

  it('renvoie null plutôt qu’une vignette qui est en fait une vidéo', () => {
    expect(
      resolveGridThumbUrl({ thumbnailUrl: 'https://cdn.nia.app/t.mp4', mediaType: 'video' }),
    ).toBeNull();
  });

  it('coupe les espaces autour de la vignette', () => {
    expect(
      resolveGridThumbUrl({ thumbnailUrl: '  https://cdn.nia.app/t.png  ' }),
    ).toBe('https://cdn.nia.app/t.png');
  });

  it('retombe sur videoUrl pour un post image sans vignette', () => {
    expect(
      resolveGridThumbUrl({
        thumbnailUrl: null,
        mediaType: 'image',
        videoUrl: 'https://cdn.nia.app/p.jpg',
      }),
    ).toBe('https://cdn.nia.app/p.jpg');
  });

  it('accepte une image de storage sans extension quand mediaType le dit', () => {
    // Supabase Storage sert des objets sans extension : le mediaType est la
    // seule information fiable dans ce cas.
    expect(
      resolveGridThumbUrl({
        thumbnailUrl: null,
        mediaType: 'image',
        videoUrl: 'https://xyz.supabase.co/storage/v1/object/public/videos/abc',
      }),
    ).toBe('https://xyz.supabase.co/storage/v1/object/public/videos/abc');
  });

  it('ne retombe jamais sur une vidéo, même pour un post annoncé image', () => {
    expect(
      resolveGridThumbUrl({
        thumbnailUrl: null,
        mediaType: 'image',
        videoUrl: 'https://cdn.nia.app/p.mp4',
      }),
    ).toBeNull();
  });

  it('accepte une vignette de type indécidable sauf si le post est une vidéo', () => {
    const thumb = 'https://cdn.nia.app/objects/abc123';
    expect(resolveGridThumbUrl({ thumbnailUrl: thumb, mediaType: null })).toBe(thumb);
    expect(resolveGridThumbUrl({ thumbnailUrl: thumb, mediaType: 'video' })).toBeNull();
  });

  it('renvoie null quand il n’y a rien à afficher', () => {
    expect(resolveGridThumbUrl({})).toBeNull();
    expect(resolveGridThumbUrl({ thumbnailUrl: '   ', videoUrl: null })).toBeNull();
    expect(
      resolveGridThumbUrl({ thumbnailUrl: null, mediaType: 'video', videoUrl: 'https://x/a.mp4' }),
    ).toBeNull();
  });
});
