import type { ImagePickerAsset } from 'expo-image-picker';
import { randomUUID } from 'expo-crypto';
import { getSupabase } from '@/lib/supabase';
import { localFileSize, uploadToStorage } from '@/lib/upload';

const MAX_AVATAR_BYTES = 10 * 1024 * 1024;

/** Reuses the image-capable bucket and its user-folder ownership policies. */
export async function uploadAvatar(userId: string, asset: ImagePickerAsset): Promise<string> {
  const mime = asset.mimeType?.toLowerCase() ||
    (/\.png(?:\?|$)/i.test(asset.uri) ? 'image/png' :
      /\.webp(?:\?|$)/i.test(asset.uri) ? 'image/webp' : 'image/jpeg');
  const extensions: Record<string, string> = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  };
  const extension = extensions[mime];
  if (!extension) throw new Error('Choisissez une photo JPEG, PNG ou WebP.');
  const size = asset.fileSize ?? localFileSize(asset.uri);
  if (size !== null && size > MAX_AVATAR_BYTES) {
    throw new Error('La photo est trop volumineuse (10 Mo maximum).');
  }
  const sb = getSupabase();
  if (!sb || userId.startsWith('mock_')) {
    throw new Error('Connectez-vous pour enregistrer une photo de profil.');
  }
  const { data, error } = await sb.auth.getSession();
  if (error) throw error;
  if (!data.session || data.session.user.id !== userId) {
    throw new Error('Votre session a expiré. Reconnectez-vous.');
  }
  // A fresh URL prevents the old avatar from being served from the image cache.
  const path = `${userId}/avatars/${randomUUID()}.${extension}`;
  await uploadToStorage({
    bucket: 'videos', path, localUri: asset.uri, contentType: mime,
    accessToken: data.session.access_token, upsert: false,
  });
  return sb.storage.from('videos').getPublicUrl(path).data.publicUrl;
}
