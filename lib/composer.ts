/**
 * Éditeur P0 — exécution de l'export natif (NiaComposer) pour la publication.
 *
 * Les calculs (composition, débit, durées) sont dans lib/composition.ts ;
 * ici : téléchargement du son dans le cache, chemins de sortie, second essai
 * à débit réduit si le fichier dépasse malgré tout 50 Mo, nettoyage.
 *
 * Sans module natif (iOS en P0, web, Expo Go, tests) : `isComposerAvailable()`
 * vaut false et l'app garde le comportement d'avant (fichier découpé publié,
 * réglages appliqués à la lecture).
 */
import { File, Paths } from 'expo-file-system';
import { MAX_UPLOAD_BYTES } from '@/constants/publish';
import {
  RETRY_BITRATE_FACTOR,
  buildPublishComposition,
  composerOutputName,
  type PublishCompositionInput,
} from '@/lib/composition';
import { fileUriToPath } from '@/lib/segments';
import { deleteCachedFile } from '@/lib/upload';
import {
  cancelComposition,
  composerErrorCode,
  exportComposition,
  isComposerAvailable,
  type ComposeResult,
  type Composition,
} from '@/modules/nia-composer';

export { cancelComposition, composerErrorCode, isComposerAvailable };
export type { ComposeResult };

/** Chemin absolu (sans file://) d'une sortie dans le cache de l'app. */
export function composerCachePath(prefix: string): string {
  return fileUriToPath(new File(Paths.cache, composerOutputName(prefix)).uri);
}

function codedError(code: string, message: string): Error & { code: string } {
  const e = new Error(message) as Error & { code: string };
  e.code = code;
  return e;
}

/** Son distant → fichier du cache (le module lit un fichier local, plus fiable). */
async function localSound(url: string): Promise<{ uri: string; temp: boolean }> {
  if (!/^https?:\/\//i.test(url)) return { uri: url, temp: false };
  const clean = url.split('?')[0] ?? '';
  const ext = /\.([a-z0-9]{2,4})$/i.exec(clean)?.[1]?.toLowerCase() ?? 'm4a';
  const dest = new File(Paths.cache, `nia-sound-${Date.now().toString(36)}.${ext}`);
  const file = await File.downloadFileAsync(url, dest);
  return { uri: file.uri, temp: true };
}

/** Exporte une composition déjà construite (assemblage des segments, etc.). */
export async function runComposition(
  composition: Composition,
  onProgress?: (p: number) => void,
): Promise<ComposeResult> {
  return exportComposition(composition, onProgress);
}

export type PublishExportInput = Omit<
  PublishCompositionInput,
  'soundUri' | 'outputPath' | 'bitrateFactor'
> & {
  /** URL ou fichier du son ajouté ; null = aucun. */
  soundUrl: string | null;
};

/**
 * Vidéo publiée = MP4 composé (H.264 720p 30 i/s, AAC, faststart, < 50 Mo).
 * Rejette avec `code` : ERR_CANCELLED (annulation), ERR_TOO_LARGE (toujours
 * au-dessus de 50 Mo après le second essai), ERR_EXPORT / ERR_INVALID (natif).
 */
export async function composeForPublish(
  input: PublishExportInput,
  onProgress?: (p: number) => void,
): Promise<ComposeResult> {
  let sound: { uri: string; temp: boolean } | null = null;
  try {
    if (input.soundUrl) {
      try {
        sound = await localSound(input.soundUrl);
      } catch {
        throw codedError('ERR_SOUND', 'Sound download failed');
      }
    }
    let lastSize = 0;
    for (const factor of [1, RETRY_BITRATE_FACTOR]) {
      const { composition } = buildPublishComposition({
        ...input,
        soundUri: sound?.uri ?? null,
        outputPath: composerCachePath('nia-export'),
        bitrateFactor: factor,
      });
      // Deux passes : la barre va de 0 à 100 % sur la première ; un second
      // essai (rare) repart de zéro.
      const res = await exportComposition(composition, onProgress);
      if (res.size > 0 && res.size <= MAX_UPLOAD_BYTES) return res;
      lastSize = res.size;
      deleteCachedFile(res.uri);
      onProgress?.(0);
    }
    throw codedError('ERR_TOO_LARGE', `Composed file still too large (${lastSize} bytes)`);
  } finally {
    if (sound?.temp) deleteCachedFile(sound.uri);
  }
}
