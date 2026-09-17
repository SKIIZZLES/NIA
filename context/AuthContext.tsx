import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SESSION_KEY = '@nia/session_v1';

export type NiaUser = {
  id: string;
  email: string;
  username: string;
  bio: string;
  avatarUrl: string;
};

type AuthContextValue = {
  user: NiaUser | null;
  loading: boolean;
  /** MVP mock — accepte n'importe quel email/mot de passe */
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, username?: string) => Promise<void>;
  signOut: () => Promise<void>;
  isMockAuth: true;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function mockUserFromEmail(email: string, username?: string): NiaUser {
  const local = email.split('@')[0] || 'createur';
  const handle = (username || local).replace(/[^a-zA-Z0-9._]/g, '').toLowerCase() || 'createur';
  return {
    id: `mock_${Date.now()}`,
    email,
    username: handle,
    bio: 'Créateur·rice sur NIA · cultures & talents 🌍',
    avatarUrl: `https://i.pravatar.cc/200?u=${encodeURIComponent(handle)}`,
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<NiaUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(SESSION_KEY);
        if (raw) setUser(JSON.parse(raw) as NiaUser);
      } catch {
        // ignore corrupt session
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const persist = useCallback(async (next: NiaUser | null) => {
    setUser(next);
    if (next) await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(next));
    else await AsyncStorage.removeItem(SESSION_KEY);
  }, []);

  const signIn = useCallback(
    async (email: string, _password: string) => {
      // MVP MOCK AUTH — pas de vérification serveur
      const next = mockUserFromEmail(email.trim() || 'demo@nia.app');
      await persist(next);
    },
    [persist],
  );

  const signUp = useCallback(
    async (email: string, _password: string, username?: string) => {
      // MVP MOCK AUTH — accepte tout
      const next = mockUserFromEmail(email.trim() || 'nouveau@nia.app', username);
      await persist(next);
    },
    [persist],
  );

  const signOut = useCallback(async () => {
    await persist(null);
  }, [persist]);

  const value = useMemo(
    () =>
      ({
        user,
        loading,
        signIn,
        signUp,
        signOut,
        isMockAuth: true as const,
      }),
    [user, loading, signIn, signUp, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth doit être utilisé dans AuthProvider');
  return ctx;
}
