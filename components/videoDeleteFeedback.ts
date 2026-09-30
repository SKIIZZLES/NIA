/**
 * Message affiché après une suppression définitive de vidéo (fil et profil).
 *
 * Défaut 1 (PR #41) : l'écran n'annonçait que deux issues sur les trois que
 * rend `deleteOwnVideoForGood`, et affirmait « Vidéo et fichier effacés »
 * même quand le fichier était gardé pour un repost. Les deux écrans passent
 * désormais par ici, pour dire la même chose.
 *
 * Rangé dans `components/` pour que le test des clés utilisées
 * (`__tests__/locales/keysUsed.test.ts`) voie les appels `t('…')`.
 */
import {
  videoDeleteOutcome,
  type DeleteOwnVideoResult,
  type VideoDeleteOutcome,
} from '@/lib/videos';

type Translate = (scope: string, options?: Record<string, string | number>) => string;

export type VideoDeleteFeedback = {
  outcome: VideoDeleteOutcome;
  title: string;
  body: string;
};

export function videoDeleteFeedback(
  result: DeleteOwnVideoResult,
  t: Translate,
): VideoDeleteFeedback {
  const outcome = videoDeleteOutcome(result);
  switch (outcome) {
    case 'failed': {
      const message = result.ok ? '' : result.message;
      return {
        outcome,
        title: t('common.error'),
        body: message === 'moderation_hold' ? t('moderation.deleteHeld') : message,
      };
    }
    case 'mock':
      return { outcome, title: t('feed.deleteSuccess'), body: t('feed.deleteSuccessMock') };
    case 'file_error':
      return { outcome, title: t('feed.deleteSuccess'), body: t('feed.deleteFileKept') };
    case 'kept_for_repost':
      return { outcome, title: t('feed.deleteSuccess'), body: t('feed.deleteKeptForRepost') };
    case 'removed':
    default:
      return { outcome, title: t('feed.deleteSuccess'), body: t('feed.deleteSuccessBody') };
  }
}
