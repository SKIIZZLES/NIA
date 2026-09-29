/**
 * Import d'un fichier audio depuis l'appareil vers « Mes sons ».
 *
 * Logique extraite de l'étape Publier (inchangée) pour être partagée avec la
 * feuille son de la caméra : sélecteur de documents système (aucune
 * permission), mp3 / m4a / wav, upload Storage + ligne `sounds` via
 * createSound. En mode démo, le son reste local (URI du fichier).
 */
import * as DocumentPicker from 'expo-document-picker';
import { createSound, type SoundItem } from '@/lib/sounds';

export const AUDIO_PICKER_TYPES = [
  'audio/*',
  'audio/mpeg',
  'audio/mp4',
  'audio/wav',
  'audio/x-m4a',
];

export type ImportSoundInput = {
  user: { id: string; username: string };
  isMockFeed: boolean;
  /** Titre saisi ; à défaut, nom du fichier, puis `defaultTitle`. */
  title?: string | null;
  defaultTitle: string;
  /** Appelé une fois le fichier choisi, avant l'upload (indicateur). */
  onUploadStart?: () => void;
};

/** Renvoie le son créé, ou null si l'utilisateur a annulé. */
export async function importSoundFromDevice({
  user,
  isMockFeed,
  title,
  defaultTitle,
  onUploadStart,
}: ImportSoundInput): Promise<SoundItem | null> {
  const res = await DocumentPicker.getDocumentAsync({
    type: AUDIO_PICKER_TYPES,
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (res.canceled || !res.assets?.[0]) return null;
  const asset = res.assets[0];
  const finalTitle =
    (title || '').trim() ||
    (asset.name ? asset.name.replace(/\.[^.]+$/, '') : '') ||
    defaultTitle;

  if (isMockFeed || user.id.startsWith('mock_')) {
    return {
      id: `local_sound_${Date.now()}`,
      userId: user.id,
      title: finalTitle,
      storagePath: '',
      publicUrl: asset.uri,
      durationMs: null,
      useCount: 0,
      createdAt: new Date().toISOString(),
      handle: `@${user.username}`,
    };
  }

  onUploadStart?.();
  return createSound({
    userId: user.id,
    title: finalTitle,
    localUri: asset.uri,
    mimeType: asset.mimeType ?? null,
    fileName: asset.name ?? null,
  });
}
