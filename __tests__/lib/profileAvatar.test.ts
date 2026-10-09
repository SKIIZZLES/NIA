import { updateProfile } from '@/lib/profiles';
import { getSupabase } from '@/lib/supabase';

jest.mock('@/lib/supabase', () => ({ getSupabase: jest.fn(), isSupabaseConfigured: true }));
jest.mock('@/lib/videos', () => ({ mapRowToVideoItem: jest.fn() }));

it('persists the avatar on the current profile and returns the server value', async () => {
  const row = { id: 'user-1', avatar_url: 'https://storage/new.png' };
  const single = jest.fn().mockResolvedValue({ data: row, error: null });
  const select = jest.fn(() => ({ single }));
  const eq = jest.fn(() => ({ select }));
  const update = jest.fn(() => ({ eq }));
  (getSupabase as jest.Mock).mockReturnValue({ from: () => ({ update }) });

  await expect(updateProfile('user-1', { avatar_url: row.avatar_url })).resolves.toEqual(row);
  expect(update).toHaveBeenCalledWith({ avatar_url: row.avatar_url });
  expect(eq).toHaveBeenCalledWith('id', 'user-1');
});

it('surfaces a rejected profile update instead of announcing success', async () => {
  const error = new Error('Permission denied');
  (getSupabase as jest.Mock).mockReturnValue({ from: () => ({
    update: () => ({ eq: () => ({ select: () => ({ single: async () => ({ data: null, error }) }) }) }),
  }) });
  await expect(updateProfile('user-1', { avatar_url: 'https://storage/new.png' })).rejects.toThrow('Permission denied');
});
