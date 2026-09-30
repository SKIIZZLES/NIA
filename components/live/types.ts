import type { LiveStreamItem } from '@/lib/live';

export type LiveHostStageProps = {
  /**
   * Live programmé à diffuser, ou `null` pour un direct instantané : la ligne
   * `live_streams` est alors créée au moment d'appuyer sur le bouton rond.
   */
  live: LiveStreamItem | null;
  userId: string;
  /** « @pseudo » de l'hôte (titre par défaut « Live de @pseudo »). */
  hostHandle: string;
  /** Quitter sans terminer (aperçu, erreur). */
  onClose: () => void;
  /** Appelé après « Terminer » réussi (statut « ended » enregistré). */
  onEnded: (liveId: string) => void;
  /** « Programmer pour plus tard » (direct instantané uniquement). */
  onSchedule?: () => void;
};

export type LiveViewerStageProps = {
  live: LiveStreamItem;
  onClose: () => void;
  /** Ouvre la feuille de signalement du live (S2). */
  onReport?: () => void;
};
