/**
 * Les deux constructeurs de message sont purs ; `shareVideo` / `shareEvent`
 * ne font qu'appeler Share.share autour d'eux. On teste ce qui part, et le
 * contrat d'erreur : un partage annulé ou échoué renvoie false, jamais une
 * exception qui remonterait dans l'UI.
 */
import { Share } from 'react-native';
import type { VideoItem } from '@/data/mockVideos';
import {
  buildEventShareMessage,
  buildShareMessage,
  shareEvent,
  shareVideo,
} from '@/lib/share';

function video(overrides: Partial<VideoItem> = {}): VideoItem {
  return {
    id: 'v1',
    videoUrl: 'https://cdn.nia.app/v1.mp4',
    thumbnailUrl: 'https://cdn.nia.app/v1.jpg',
    handle: '@aminata.dakar',
    caption: 'Rythmes du marché — Dakar',
    likes: 0,
    comments: 0,
    shares: 0,
    avatarUrl: 'https://i.pravatar.cc/150?u=aminata',
    tab: 'pour-toi',
    ...overrides,
  };
}

describe('buildShareMessage', () => {
  it('assemble légende, handle et lien sur trois lignes', () => {
    expect(buildShareMessage(video()).split('\n')).toEqual([
      'Rythmes du marché — Dakar',
      '@aminata.dakar · NIA',
      'https://nia.app/v/v1',
    ]);
  });

  it('ajoute l’arobase manquante sans la doubler', () => {
    expect(buildShareMessage(video({ handle: 'aminata' }))).toContain('@aminata · NIA');
    expect(buildShareMessage(video({ handle: '@aminata' }))).not.toContain('@@');
  });

  it('remplace une légende vide par une accroche, jamais par une ligne vide', () => {
    for (const caption of ['', '   ']) {
      const lines = buildShareMessage(video({ caption })).split('\n');
      expect(lines).toHaveLength(3);
      expect(lines[0]).toBe('Découvre cette vidéo sur NIA');
    }
  });

  it('encode l’identifiant dans l’URL', () => {
    // Les ids mock contiennent des caractères qui casseraient le lien.
    expect(buildShareMessage(video({ id: 'a b/c?d' }))).toContain(
      'https://nia.app/v/a%20b%2Fc%3Fd',
    );
  });
});

describe('buildEventShareMessage', () => {
  const base = { id: 'e1', title: 'Afrobeat Night', startsAt: '2026-10-15T20:30:00.000Z' };

  it('assemble titre, lieu et date, puis signature et lien', () => {
    const lines = buildEventShareMessage({ ...base, city: 'Dakar' }).split('\n');
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe('Afrobeat Night');
    expect(lines[1]).toContain('Dakar · ');
    expect(lines[2]).toBe('NIA · Événements');
    expect(lines[3]).toBe('https://nia.app/e/e1');
  });

  it('omet la ville quand elle manque, sans laisser de séparateur orphelin', () => {
    for (const city of [null, undefined, '']) {
      const lines = buildEventShareMessage({ ...base, city }).split('\n');
      expect(lines).toHaveLength(4);
      expect(lines[1]).not.toContain(' · ');
    }
  });

  it('formate la date en français', () => {
    // On n'assert pas la chaîne exacte : elle dépend de la version d'ICU du
    // moteur. Ce qui doit tenir, c'est que le formatage a bien eu lieu.
    const line = buildEventShareMessage({ ...base, city: null }).split('\n')[1];
    expect(line).not.toBe(base.startsAt);
    expect(line).toMatch(/\d/);
  });

  it('retombe sur la chaîne brute quand la date est invalide', () => {
    // Une date cassée doit dégrader l'affichage, pas produire « Invalid Date ».
    const lines = buildEventShareMessage({
      id: 'e1',
      title: 'Afrobeat Night',
      city: null,
      startsAt: 'pas-une-date',
    }).split('\n');
    expect(lines[1]).toBe('pas-une-date');
  });
});

describe('shareVideo / shareEvent', () => {
  const shareSpy = jest.spyOn(Share, 'share');

  afterEach(() => shareSpy.mockReset());
  afterAll(() => shareSpy.mockRestore());

  it('renvoie true quand l’utilisateur a partagé', async () => {
    shareSpy.mockResolvedValue({ action: Share.sharedAction, activityType: null });
    await expect(shareVideo(video())).resolves.toBe(true);
    expect(shareSpy).toHaveBeenCalledWith(
      expect.objectContaining({ message: buildShareMessage(video()) }),
    );
  });

  it('renvoie false quand l’utilisateur annule', async () => {
    shareSpy.mockResolvedValue({ action: Share.dismissedAction });
    await expect(shareVideo(video())).resolves.toBe(false);
  });

  it('avale l’exception de la feuille de partage', async () => {
    shareSpy.mockRejectedValue(new Error('activity not available'));
    await expect(shareVideo(video())).resolves.toBe(false);
    await expect(
      shareEvent({ id: 'e1', title: 'Afrobeat Night', startsAt: '2026-10-15T20:30:00.000Z' }),
    ).resolves.toBe(false);
  });
});
