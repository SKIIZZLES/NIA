import { uploadAvatar } from '@/lib/avatar';
import { getSupabase } from '@/lib/supabase';
import { uploadToStorage, localFileSize } from '@/lib/upload';
import type { ImagePickerAsset } from 'expo-image-picker';

jest.mock('@/lib/supabase', () => ({ getSupabase: jest.fn() }));
jest.mock('@/lib/upload', () => ({ uploadToStorage: jest.fn(), localFileSize: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'unique-photo' }));

const photo: ImagePickerAsset = { uri: 'file:///photo.png', width: 200, height: 200, mimeType: 'image/png' };
const upload = uploadToStorage as jest.Mock;
const getSession = jest.fn();
const getPublicUrl = jest.fn((path: string) => ({ data: { publicUrl: `https://storage/${path}` } }));

beforeEach(() => {
  jest.clearAllMocks();
  (localFileSize as jest.Mock).mockReturnValue(1000);
  getSession.mockResolvedValue({ data: { session: { user: { id: 'user-1' }, access_token: 'token' } }, error: null });
  (getSupabase as jest.Mock).mockReturnValue({ auth: { getSession }, storage: { from: () => ({ getPublicUrl }) } });
  upload.mockResolvedValue(undefined);
});

it('uploads with the real MIME type, an owned folder and a fresh URL', async () => {
  await expect(uploadAvatar('user-1', photo)).resolves.toBe('https://storage/user-1/avatars/unique-photo.png');
  expect(upload).toHaveBeenCalledWith(expect.objectContaining({
    bucket: 'videos', path: 'user-1/avatars/unique-photo.png', contentType: 'image/png',
    accessToken: 'token', upsert: false,
  }));
});

it('refuses a session belonging to another account', async () => {
  await expect(uploadAvatar('other-user', photo)).rejects.toThrow('session');
  expect(upload).not.toHaveBeenCalled();
});

it('does not upload without an authenticated session', async () => {
  getSession.mockResolvedValue({ data: { session: null }, error: null });
  await expect(uploadAvatar('user-1', photo)).rejects.toThrow('session');
  expect(upload).not.toHaveBeenCalled();
});

it('rejects oversized photos and unsupported image types before sending', async () => {
  await expect(uploadAvatar('user-1', { ...photo, fileSize: 11 * 1024 * 1024 })).rejects.toThrow('10 Mo');
  await expect(uploadAvatar('user-1', { ...photo, mimeType: 'image/heic' })).rejects.toThrow('JPEG');
  expect(upload).not.toHaveBeenCalled();
});

it('does not return a public URL when the upload fails', async () => {
  upload.mockRejectedValue(new Error('Storage unavailable'));
  await expect(uploadAvatar('user-1', photo)).rejects.toThrow('Storage unavailable');
  expect(getPublicUrl).not.toHaveBeenCalled();
});
