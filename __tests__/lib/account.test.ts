/**
 * Suppression de compte — le chemin que Google Play exige.
 *
 * Ces tests couvrent la décision : appeler la RPC, ou ne pas l'appeler.
 * Ils ne couvrent pas la confirmation à l'écran : `Alert.alert` est une
 * fonction vide dans react-native-web (`exports/Alert/index.js`), donc aucun
 * pilotage navigateur ne peut l'exercer. Cette partie-là ne peut être
 * vérifiée que sur un appareil Android réel.
 */
import { deleteOwnAccount } from '@/lib/account';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';

jest.mock('@/lib/supabase', () => ({
  getSupabase: jest.fn(),
  isSupabaseConfigured: true,
}));

const mockedGetSupabase = getSupabase as jest.MockedFunction<typeof getSupabase>;

function client(rpc: jest.Mock) {
  return { rpc } as unknown as ReturnType<typeof getSupabase>;
}

const UUID = '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

describe('deleteOwnAccount — appelle la RPC', () => {
  it('appelle delete_own_account sans argument pour un compte réel', async () => {
    const rpc = jest.fn().mockResolvedValue({ error: null });
    mockedGetSupabase.mockReturnValue(client(rpc));

    await expect(deleteOwnAccount(UUID)).resolves.toEqual({ ok: true, mock: false });
    // Aucun identifiant passé : la fonction SQL lit auth.uid(). Un paramètre
    // ouvrirait la porte à la suppression du compte d'autrui.
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('delete_own_account');
  });

  it('remonte le message d’erreur de Supabase sans le masquer', async () => {
    const rpc = jest.fn().mockResolvedValue({ error: { message: 'permission denied' } });
    mockedGetSupabase.mockReturnValue(client(rpc));

    await expect(deleteOwnAccount(UUID)).resolves.toEqual({
      ok: false,
      message: 'permission denied',
    });
  });

  it('survit à une exception réseau', async () => {
    const rpc = jest.fn().mockRejectedValue(new Error('Network request failed'));
    mockedGetSupabase.mockReturnValue(client(rpc));

    await expect(deleteOwnAccount(UUID)).resolves.toEqual({
      ok: false,
      message: 'Network request failed',
    });
  });
});

describe('deleteOwnAccount — n’appelle pas la RPC', () => {
  it('ne tente rien sans client Supabase', async () => {
    mockedGetSupabase.mockReturnValue(null);
    await expect(deleteOwnAccount(UUID)).resolves.toEqual({ ok: true, mock: true });
  });

  it('ne tente rien pour un utilisateur mock', async () => {
    const rpc = jest.fn();
    mockedGetSupabase.mockReturnValue(client(rpc));
    // L'UI annonce alors « aucun compte réel à supprimer » au lieu de
    // prétendre avoir supprimé quelque chose.
    await expect(deleteOwnAccount('mock_user_aminata')).resolves.toEqual({
      ok: true,
      mock: true,
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('ne tente rien sans identifiant', async () => {
    const rpc = jest.fn();
    mockedGetSupabase.mockReturnValue(client(rpc));
    for (const id of [null, undefined, '']) {
      await expect(deleteOwnAccount(id)).resolves.toEqual({ ok: true, mock: true });
    }
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('isSupabaseConfigured à false', () => {
  // Env Supabase absentes : `lib/supabase.ts` bascule en mock, et rien ne doit
  // partir vers le serveur même si un client existe.
  const supabaseModule = jest.requireMock('@/lib/supabase') as {
    isSupabaseConfigured: boolean;
  };

  afterEach(() => {
    supabaseModule.isSupabaseConfigured = true;
  });

  it('ne tente rien même avec un client et un uuid', async () => {
    const rpc = jest.fn();
    mockedGetSupabase.mockReturnValue(client(rpc));
    supabaseModule.isSupabaseConfigured = false;

    await expect(deleteOwnAccount(UUID)).resolves.toEqual({ ok: true, mock: true });
    expect(rpc).not.toHaveBeenCalled();
  });
});
