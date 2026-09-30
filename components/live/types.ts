import type { LiveStreamItem } from '@/lib/live';

export type LiveHostStageProps = {
  live: LiveStreamItem;
  userId: string;
  /** Quitter sans terminer (aperçu, erreur). */
  onClose: () => void;
  /** Appelé après « Terminer » réussi (statut « ended » enregistré). */
  onEnded: () => void;
};

export type LiveViewerStageProps = {
  live: LiveStreamItem;
  onClose: () => void;
};
