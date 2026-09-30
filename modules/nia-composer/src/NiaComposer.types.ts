/**
 * Contrat JSON entre l'app et le module natif NiaComposer (P0).
 *
 * Les durées sont en millisecondes, les volumes entre 0 et 1. Les URI sont
 * des `file://` (ou chemins absolus) ; le son peut aussi être une URL https,
 * mais l'app le télécharge d'abord dans le cache (lecture plus sûre).
 */
export type ComposerClip = {
  uri: string;
  startMs: number;
  /** null = jusqu'à la fin du fichier. */
  endMs: number | null;
  /** 0,25 → 4 ; appliquée à l'image et au son du clip. */
  speed: number;
};

export type ComposerAudio = {
  uri: string;
  /** Début dans le son ; le son reprend à 0 s'il est plus court que la vidéo. */
  offsetMs: number;
  volume: number;
};

export type ComposerOutput = {
  /** Chemin absolu du MP4 produit (sans « file:// »). */
  path: string;
  /** Petit côté de la sortie (jamais agrandi). */
  shortSide: number;
  /** Boîte de sortie (orientée comme la vidéo) : 720 × 1280. */
  maxWidth: number;
  maxHeight: number;
  fps: number;
  videoBitrate: number;
  audioBitrate: number;
};

export type Composition = {
  clips: ComposerClip[];
  audio: ComposerAudio | null;
  /** Volume du son d'origine des clips. */
  originalVolume: number;
  output: ComposerOutput;
};

export type ComposeResult = {
  uri: string;
  size: number;
  durationMs: number;
  width: number;
  height: number;
  /** moov avant mdat : la lecture démarre sans télécharger tout le fichier. */
  fastStart: boolean;
};

export type ComposerProgressEvent = { progress: number };
