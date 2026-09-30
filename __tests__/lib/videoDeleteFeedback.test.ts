/**
 * Message après suppression définitive (fil et profil) : trois issues, et
 * jamais « Vidéo et fichier effacés » quand le fichier a été gardé.
 */
import { videoDeleteFeedback } from '@/components/videoDeleteFeedback';
import fr from '@/locales/fr';

jest.mock('@/lib/supabase', () => ({
  getSupabase: jest.fn(),
  isSupabaseConfigured: true,
}));

const UID = '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const MEDIA = `${UID}/upload-1.mp4`;
const COVER = `${UID}/covers/upload-1.jpg`;

/** Traduit vers fr, la référence (et la langue de repli). */
function t(scope: string): string {
  const v = scope
    .split('.')
    .reduce<unknown>(
      (acc, k) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[k] : undefined),
      fr,
    );
  if (typeof v !== 'string') throw new Error(`clé absente : ${scope}`);
  return v;
}

describe('videoDeleteFeedback', () => {
  it('fichier effacé', () => {
    expect(videoDeleteFeedback({ ok: true, removedFiles: [MEDIA, COVER], keptFiles: [] }, t)).toEqual({
      outcome: 'removed',
      title: fr.feed.deleteSuccess,
      body: fr.feed.deleteSuccessBody,
    });
  });

  it('fichier gardé pour un repost : ne prétend pas l’avoir effacé', () => {
    const r = videoDeleteFeedback({ ok: true, removedFiles: [COVER], keptFiles: [MEDIA] }, t);
    expect(r).toEqual({
      outcome: 'kept_for_repost',
      title: fr.feed.deleteSuccess,
      body: fr.feed.deleteKeptForRepost,
    });
    expect(r.body).not.toBe(fr.feed.deleteSuccessBody);
    expect(r.body).toMatch(/repost/);
    expect(r.body).toMatch(/votre/);
  });

  it('échec du fichier après suppression de la ligne', () => {
    expect(
      videoDeleteFeedback(
        { ok: true, removedFiles: [], keptFiles: [], fileError: 'storage offline' },
        t,
      ),
    ).toEqual({ outcome: 'file_error', title: fr.feed.deleteSuccess, body: fr.feed.deleteFileKept });
  });

  it('échec : message du serveur, ou message de modération traduit', () => {
    expect(videoDeleteFeedback({ ok: false, message: 'not_found' }, t)).toEqual({
      outcome: 'failed',
      title: fr.common.error,
      body: 'not_found',
    });
    expect(videoDeleteFeedback({ ok: false, message: 'moderation_hold' }, t)).toEqual({
      outcome: 'failed',
      title: fr.common.error,
      body: fr.moderation.deleteHeld,
    });
  });

  it('mode démo', () => {
    expect(
      videoDeleteFeedback({ ok: true, mock: true, removedFiles: [], keptFiles: [] }, t).body,
    ).toBe(fr.feed.deleteSuccessMock);
  });
});
