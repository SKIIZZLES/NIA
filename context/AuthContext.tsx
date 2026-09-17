import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session, User } from '@supabase/supabase-js';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';
import type { ProfileRow } from '@/types/database';

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
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, username?: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** true = AsyncStorage mock ; false = Supabase Auth */
  isMockAuth: boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function mockUserFromEmail(email: string, username?: string): NiaUser {
  const local = email.split('@')[0] || 'createur';
  const handle =
    (username || local).replace(/[^a-zA-Z0-9._]/g, '').toLowerCase() || 'createur';
  return {
    id: `mock_${Date.now()}`,
    email,
    username: handle,
    bio: 'Créateur·rice sur NIA · cultures & talents 🌍',
    avatarUrl: `https://i.pravatar.cc/200?u=${encodeURIComponent(handle)}`,
  };
}

function profileToUser(sessionUser: User, profile: ProfileRow | null): NiaUser {
  const metaHandle =
    typeof sessionUser.user_metadata?.username === 'string'
      ? sessionUser.user_metadata.username
      : undefined;
  const email = sessionUser.email || '';
  const handle =
    profile?.username ||
    metaHandle ||
    email.split('@')[0] ||
    'createur';
  return {
    id: sessionUser.id,
    email,
    username: handle,
    bio: profile?.bio || 'Créateur·rice sur NIA · cultures & talents 🌍',
    avatarUrl:
      profile?.avatar_url ||
      `https://i.pravatar.cc/200?u=${encodeURIComponent(handle)}`,
  };
}

async function loadProfile(userId: string): Promise<ProfileRow | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.from('profiles').select('*').eq('id', userId).maybeSingle();
  return data;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<NiaUser | null>(null);
  const [loading, setLoading] = useState(true);
  const mockMode = !isSupabaseConfigured;

  useEffect(() => {
    let alive = true;
    const sb = getSupabase();

    (async () => {
      try {
        if (!sb) {
          const raw = await AsyncStorage.getItem(SESSION_KEY);
          if (alive && raw) setUser(JSON.parse(raw) as NiaUser);
          return;
        }

        const { data } = await sb.auth.getSession();
        const session = data.session;
        if (session?.user && alive) {
          const profile = await loadProfile(session.user.id);
          if (alive) setUser(profileToUser(session.user, profile));
        }
      } catch {
        // ignore corrupt / network
      } finally {
        if (alive) setLoading(false);
      }
    })();

    if (!sb) return () => {
      alive = false;
    };

    const { data: sub } = sb.auth.onAuthStateChange(async (_event, session: Session | null) => {
      if (!alive) return;
      if (!session?.user) {
        setUser(null);
        return;
      }
      const profile = await loadProfile(session.user.id);
      if (alive) setUser(profileToUser(session.user, profile));
    });

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const persistMock = useCallback(async (next: NiaUser | null) => {
    setUser(next);
    if (next) await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(next));
    else await AsyncStorage.removeItem(SESSION_KEY);
  }, []);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const sb = getSupabase();
      if (!sb) {
        const next = mockUserFromEmail(email.trim() || 'demo@nia.app');
        await persistMock(next);
        return;
      }
      const { error } = await sb.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) throw error;
      // user set via onAuthStateChange
    },
    [persistMock],
  );

  const signUp = useCallback(
    async (email: string, password: string, username?: string) => {
      const sb = getSupabase();
      if (!sb) {
        const next = mockUserFromEmail(email.trim() || 'nouveau@nia.app', username);
        await persistMock(next);
        return;
      }
      const handle = (username || email.split('@')[0] || 'createur')
        .replace(/[^a-zA-Z0-9._]/g, '')
        .toLowerCase();
      const { data, error } = await sb.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: { username: handle },
        },
      });
      if (error) throw error;
      // Si confirmation email désactivée, session présente
      if (data.user && !data.session) {
        // Profil créé par trigger ; demander de se connecter après confirm
        throw new Error(
          'Compte créé. Confirmez votre email (Supabase) puis reconnectez-vous.',
        );
      }
    },
    [persistMock],
  );

  const signOut = useCallback(async () => {
    const sb = getSupabase();
    if (!sb) {
      await persistMock(null);
      return;
    }
    await sb.auth.signOut();
    setUser(null);
  }, [persistMock]);

  const value = useMemo(
    () => ({
      user,
      loading,
      signIn,
      signUp,
      signOut,
      isMockAuth: mockMode,
    }),
    [user, loading, signIn, signUp, signOut, mockMode],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth doit être utilisé dans AuthProvider');
  return ctx;
}
