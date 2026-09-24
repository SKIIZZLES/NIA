/**
 * Téléversement vers Supabase Storage sans charger le fichier en mémoire JS.
 *
 * Pourquoi ne pas utiliser sb.storage.from(...).upload() : cette méthode passe
 * par fetch, qui n'expose aucun événement d'envoi — donc aucune progression
 * possible — et impose de lui fournir le contenu. Un ArrayBuffer traverse
 * ensuite trois conversions avant le réseau :
 *
 *   1. l'ArrayBuffer lui-même                        → +N octets
 *   2. bufferClone() dans whatwg-fetch (Body._initBody) → +N
 *   3. convertRequestBody() → { base64: … } pour le    → +1,33 N
 *      bridge React Native
 *
 * Soit ~3,3 × la taille du fichier en mémoire transitoire : à 50 Mo, c'est
 * l'OOM sur un Android d'entrée de gamme.
 *
 * Sur natif on poste donc directement sur l'endpoint REST de Storage — la même
 * URL que celle construite par @supabase/storage-js — avec expo-file-system,
 * dont UploadTask fait streamer le fichier par okhttp (Android) ou URLSession
 * (iOS) depuis le disque. Les octets n'entrent jamais dans le runtime JS.
 *
 * GARDE-FOU ANDROID — le Content-Type est TOUJOURS posé en en-tête HTTP
 * explicite, jamais déduit du fichier. C'est la raison d'être du chemin
 * ArrayBuffer d'origine : la branche Blob de storage-js construit un FormData
 * et utilise Blob.type, que RN Android renseigne souvent à « text/plain »,
 * d'où le rejet « mime type text/plain is not supported ». En UploadType
 * BINARY_CONTENT, expo-file-system ignore son option mimeType et n'attache
 * aucun type au corps (Android : file.asRequestBody(null)) : l'en-tête que
 * nous passons est le seul canal. La protection est donc plus stricte
 * qu'avant, pas contournée.
 *
 * Sur web, expo-file-system est un stub qui journalise un avertissement et
 * résout { body: '', status: 0 } SANS RIEN ENVOYER. Le chemin web garde donc
 * l'implémentation fetch historique, où l'OOM n'est pas un sujet.
 */
import { Platform } from 'react-native';
import { File, Paths, UploadTask, UploadType } from 'expo-file-system';

/** Même source que lib/supabase.ts — variables publiques Expo. */
const SUPABASE_URL = (process.env.EXPO_PUBLIC_SUPABASE_URL || '').trim();
const SUPABASE_ANON_KEY = (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '').trim();

/** Aligné sur le défaut de @supabase/storage-js. */
const CACHE_CONTROL_SECONDS = 3600;

export type UploadProgress = {
  bytesSent: number;
  /** -1 quand la taille totale est inconnue. */
  totalBytes: number;
  /** 0 → 1, ou null si la taille totale est inconnue. */
  ratio: number | null;
};

export type StorageUploadInput = {
  bucket: string;
  /** Chemin dans le bucket, sans slash initial. */
  path: string;
  localUri: string;
  /** Résolu par resolveUploadContentType — jamais deviné ici. */
  contentType: string;
  accessToken: string;
  /** true pour écraser un objet partiel laissé par une tentative précédente. */
  upsert: boolean;
  onProgress?: (p: UploadProgress) => void;
  signal?: AbortSignal;
};

export function storageObjectUrl(bucket: string, path: string): string {
  return `${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`;
}

function buildHeaders(input: StorageUploadInput): Record<string, string> {
  return {
    Authorization: `Bearer ${input.accessToken}`,
    apikey: SUPABASE_ANON_KEY,
    'Content-Type': input.contentType,
    'cache-control': `max-age=${CACHE_CONTROL_SECONDS}`,
    'x-upsert': String(input.upsert),
  };
}

/**
 * Extrait un message lisible du corps d'erreur de Storage, qui renvoie du JSON
 * de la forme { statusCode, error, message }.
 */
function storageErrorMessage(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body) as { message?: string; error?: string };
    const msg = parsed.message || parsed.error;
    if (msg) return `${msg} (HTTP ${status})`;
  } catch {
    // corps non JSON : on retombe sur le brut
  }
  const trimmed = (body || '').trim().slice(0, 200);
  return trimmed ? `${trimmed} (HTTP ${status})` : `Échec du téléversement (HTTP ${status})`;
}

/** true si l'URI désigne un fichier du cache de l'application. */
export function isAppCacheUri(uri: string): boolean {
  if (Platform.OS === 'web') return false;
  try {
    const cache = Paths.cache.uri;
    return Boolean(cache) && uri.startsWith(cache);
  } catch {
    return false;
  }
}

/**
 * Supprime un fichier temporaire, uniquement s'il vit dans le cache de
 * l'application. Une URI hors cache peut désigner un fichier de la galerie de
 * l'utilisateur : la supprimer serait destructif.
 */
export function deleteCachedFile(uri: string): void {
  if (!isAppCacheUri(uri)) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // le cache est jetable par nature — un échec ici n'a aucune conséquence
  }
}

/** Taille du fichier local, ou null si elle n'est pas lisible. */
export function localFileSize(uri: string): number | null {
  if (Platform.OS === 'web') return null;
  try {
    const file = new File(uri);
    return file.exists ? file.size : null;
  } catch {
    return null;
  }
}

async function uploadNative(input: StorageUploadInput): Promise<void> {
  const file = new File(input.localUri);
  if (!file.exists) {
    throw new Error('Le fichier a disparu du stockage local.');
  }

  const task = new UploadTask(file, storageObjectUrl(input.bucket, input.path), {
    httpMethod: 'POST',
    uploadType: UploadType.BINARY_CONTENT,
    headers: buildHeaders(input),
    onProgress: input.onProgress
      ? ({ bytesSent, totalBytes }) => {
          input.onProgress?.({
            bytesSent,
            totalBytes,
            ratio: totalBytes > 0 ? Math.min(1, bytesSent / totalBytes) : null,
          });
        }
      : undefined,
    signal: input.signal,
  });

  const result = await task.uploadAsync();

  // status 0 est la signature du stub web ; sur natif il traduit une requête
  // qui n'a jamais abouti. Dans les deux cas ce n'est pas un succès.
  if (result.status === 0) {
    throw new Error('Téléversement interrompu avant toute réponse du serveur.');
  }
  if (result.status < 200 || result.status >= 300) {
    throw new Error(storageErrorMessage(result.status, result.body));
  }
}

/**
 * Chemin web : le comportement d'avant la Phase 2. Le Content-Type reste posé
 * en en-tête explicite, donc le garde-fou tient aussi ici.
 */
async function uploadWeb(input: StorageUploadInput): Promise<void> {
  const read = await fetch(input.localUri);
  if (!read.ok) {
    throw new Error(`Impossible de lire le média local (${read.status})`);
  }
  const body = await read.arrayBuffer();

  const res = await fetch(storageObjectUrl(input.bucket, input.path), {
    method: 'POST',
    headers: buildHeaders(input),
    body,
    signal: input.signal,
  });
  if (!res.ok) {
    throw new Error(storageErrorMessage(res.status, await res.text()));
  }
  // Le web n'expose pas d'événement d'envoi : on signale la fin, pas une
  // progression inventée.
  input.onProgress?.({ bytesSent: body.byteLength, totalBytes: body.byteLength, ratio: 1 });
}

/** Téléverse un fichier local vers Supabase Storage. */
export async function uploadToStorage(input: StorageUploadInput): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('Supabase non configuré');
  }
  return Platform.OS === 'web' ? uploadWeb(input) : uploadNative(input);
}
