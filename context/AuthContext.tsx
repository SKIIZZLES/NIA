import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';
import type { ProfileRow } from '@/types/database';
import { updateProfile as persistProfile } from '@/lib/profiles';
import { profileFieldOutcome } from '@/lib/textFilter';
import {
  getGoogleIdToken,
  signInWithGoogleIdToken,
} from '@/lib/googleAuth';
import {
  SNAP_SCOPES,
  exchangeSnapchatCodeForSession,
  getSnapClientId,
  getSnapchatRedirectUri,
  isSnapchatAuthConfigured,
  promptSnapchatOAuth,
  setSupabaseSessionFromSnapchat,
  type SnapchatOAuthResult,
} from '@/lib/snapchatAuth';
import { SNAP_ERR } from '@/lib/snapchatAppSwitch';
import {
  getSnapVariant,
  isSnapchatInstalled,
  startSnapchatAppSwitch,
} from '@/lib/snapchatAppSwitchRuntime';

/** Local auth shapes — no runtime/value import from @supabase/supabase-js. */
type AuthUser = {
  id: string;
  email?: string | null;
  user_metadata?: {
    username?: string;
    full_name?: string;
    name?: string;
    avatar_url?: string;
    picture?: string;
  };
};
type AuthSession = { user: AuthUser } | null;

const SESSION_KEY = '@nia/session_v1';

export type NiaUser = {
  id: string;
  email: string;
  username: string;
  displayName: string;
  bio: string;
  avatarUrl: string;
};

type AuthContextValue = {
  user: NiaUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, username?: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  /**
   * 'signed_in' : session ouverte, à l'appelant de naviguer.
   * 'handled'   : l'écran de retour `app/snapchat-auth.tsx` a déjà navigué.
   */
  signInWithSnapchat: () => Promise<SnapchatSignInResult>;
  /** Échange code + verifier (flux web ou écran de retour app-switch). */
  completeSnapchatSignIn: (oauth: SnapchatOAuthResult) => Promise<void>;
  signOut: () => Promise<void>;
  /**
   * Met à jour bio / display_name (mock local ou profiles). 018 : le serveur
   * peut masquer des mots ou garder l'ancienne valeur le temps d'une
   * vérification ; le résultat le dit, l'état local suit le serveur.
   */
  updateProfile: (patch: { displayName?: string; bio?: string }) => Promise<ProfileUpdateResult>;
  /** true = AsyncStorage mock ; false = Supabase Auth */
  isMockAuth: boolean;
};

export type SnapchatSignInResult = 'signed_in' | 'handled';

const AuthContext = createContext<AuthContextValue | null>(null);

function mockUserFromEmail(email: string, username?: string): NiaUser {
  const local = email.split('@')[0] || 'createur';
  const handle =
    (username || local).replace(/[^a-zA-Z0-9._]/g, '').toLowerCase() || 'createur';
  return {
    id: `mock_${Date.now()}`,
    email,
    username: handle,
    displayName: handle,
    bio: 'Créateur·rice sur NIA · cultures & talents 🌍',
    avatarUrl: `https://i.pravatar.cc/200?u=${encodeURIComponent(handle)}`,
  };
}

export type ProfileUpdateResult = { pending: boolean; masked: boolean };

function profileToUser(sessionUser: AuthUser, profile: ProfileRow | null): NiaUser {
  const meta = sessionUser.user_metadata || {};
  const metaHandle =
    typeof meta.username === 'string' ? meta.username : undefined;
  const email = sessionUser.email || '';
  const handle =
    profile?.username ||
    metaHandle ||
    email.split('@')[0] ||
    'createur';
  const metaName =
    (typeof meta.full_name === 'string' && meta.full_name) ||
    (typeof meta.name === 'string' && meta.name) ||
    undefined;
  const metaAvatar =
    (typeof meta.avatar_url === 'string' && meta.avatar_url) ||
    (typeof meta.picture === 'string' && meta.picture) ||
    undefined;
  return {
    id: sessionUser.id,
    email,
    username: handle,
    displayName: profile?.display_name || metaName || handle,
    bio: profile?.bio || 'Créateur·rice sur NIA · cultures & talents 🌍',
    avatarUrl:
      profile?.avatar_url ||
      metaAvatar ||
      `https://i.pravatar.cc/200?u=${encodeURIComponent(handle)}`,
  };
}

async function loadProfile(userId: string): Promise<ProfileRow | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.from('profiles').select('*').eq('id', userId).maybeSingle();
  return data;
}

/**
 * Après Google (ou email) : crée / enrichit le profil si le trigger n'a pas tout rempli.
 */
async function ensureProfileRow(
  sessionUser: AuthUser,
  extras?: { name?: string | null; photo?: string | null },
): Promise<ProfileRow | null> {
  const sb = getSupabase();
  if (!sb) return null;

  const existing = await loadProfile(sessionUser.id);
  const meta = sessionUser.user_metadata || {};
  const email = sessionUser.email || '';
  const handleBase =
    existing?.username ||
    (typeof meta.username === 'string' && meta.username) ||
    email.split('@')[0] ||
    'createur';
  const handle =
    handleBase.replace(/[^a-zA-Z0-9._]/g, '').toLowerCase() || 'createur';

  const displayName =
    existing?.display_name ||
    extras?.name ||
    (typeof meta.full_name === 'string' && meta.full_name) ||
    (typeof meta.name === 'string' && meta.name) ||
    handle;

  const avatarUrl =
    existing?.avatar_url ||
    extras?.photo ||
    (typeof meta.avatar_url === 'string' && meta.avatar_url) ||
    (typeof meta.picture === 'string' && meta.picture) ||
    `https://i.pravatar.cc/200?u=${encodeURIComponent(handle)}`;

  if (!existing) {
    const { data, error } = await sb
      .from('profiles')
      .upsert(
        {
          id: sessionUser.id,
          username: handle,
          display_name: displayName,
          bio: 'Créateur·rice sur NIA · cultures & talents 🌍',
          avatar_url: avatarUrl,
        },
        { onConflict: 'id' },
      )
      .select('*')
      .maybeSingle();
    if (error) {
      // Trigger may have raced — reload
      return loadProfile(sessionUser.id);
    }
    return data;
  }

  // Enrichir display_name / avatar si encore vides / génériques
  const patch: { display_name?: string; avatar_url?: string } = {};
  if (!existing.display_name && displayName) patch.display_name = displayName;
  if (
    extras?.photo &&
    (!existing.avatar_url || existing.avatar_url.includes('i.pravatar.cc'))
  ) {
    patch.avatar_url = extras.photo;
  }
  if (Object.keys(patch).length === 0) return existing;

  const { data } = await sb
    .from('profiles')
    .update(patch)
    .eq('id', sessionUser.id)
    .select('*')
    .maybeSingle();
  return data ?? existing;
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
          if (alive && raw) {
            const parsed = JSON.parse(raw) as NiaUser;
            if (!parsed.displayName) parsed.displayName = parsed.username;
            setUser(parsed);
          }
          return;
        }

        const { data } = await sb.auth.getSession();
        const session = data.session;
        if (session?.user && alive) {
          const profile = await ensureProfileRow(session.user);
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

    const { data: sub } = sb.auth.onAuthStateChange(async (_event: string, session: AuthSession) => {
      if (!alive) return;
      if (!session?.user) {
        setUser(null);
        return;
      }
      const profile = await ensureProfileRow(session.user);
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

  const signInWithGoogle = useCallback(async () => {
    const sb = getSupabase();
    if (!sb || !isSupabaseConfigured) {
      // Mock / Expo Go : session locale « Google »
      const next = mockUserFromEmail(
        `google_${Date.now()}@nia.app`,
        `google${Date.now().toString(36).slice(-6)}`,
      );
      next.displayName = 'Google User';
      await persistMock(next);
      return;
    }

    const google = await getGoogleIdToken();
    await signInWithGoogleIdToken(google.idToken);

    // Enrichir profil avec nom / photo Google (trigger peut avoir créé le row)
    const { data } = await sb.auth.getSession();
    const sessionUser = data.session?.user;
    if (sessionUser) {
      const profile = await ensureProfileRow(sessionUser, {
        name: google.name,
        photo: google.photo,
      });
      setUser(profileToUser(sessionUser, profile));
    }
  }, [persistMock]);

  const completeSnapchatSignIn = useCallback(async (oauth: SnapchatOAuthResult) => {
    const sb = getSupabase();
    if (!sb || !isSupabaseConfigured) {
      throw new Error('Supabase non configuré.');
    }
    const tokens = await exchangeSnapchatCodeForSession(oauth);
    await setSupabaseSessionFromSnapchat(tokens);

    const { data } = await sb.auth.getSession();
    const sessionUser = data.session?.user;
    if (sessionUser) {
      const profile = await ensureProfileRow(sessionUser, {
        name: tokens.displayName,
        photo: tokens.avatarUrl,
      });
      setUser(profileToUser(sessionUser, profile));
    }
  }, []);

  const signInWithSnapchat = useCallback(async (): Promise<SnapchatSignInResult> => {
    const sb = getSupabase();
    if (!sb || !isSupabaseConfigured) {
      // Mock / Expo Go : session locale « Snapchat »
      const next = mockUserFromEmail(
        `snapchat_${Date.now()}@users.nia.app`,
        `snap${Date.now().toString(36).slice(-6)}`,
      );
      next.displayName = 'Snapchat User';
      await persistMock(next);
      return 'signed_in';
    }

    if (!isSnapchatAuthConfigured()) {
      throw new Error(
        'Configure Snap Kit + deploy function — EXPO_PUBLIC_SNAP_CLIENT_ID manquant (voir SNAPCHAT_AUTH.md).',
      );
    }

    // Spike app-switch : Android + Snapchat installé → ouvrir l'app Snapchat.
    if (Platform.OS === 'android') {
      const variant = await getSnapVariant();
      if (variant !== 'web' && (await isSnapchatInstalled())) {
        try {
          await startSnapchatAppSwitch({
            clientId: getSnapClientId(),
            redirectUri: getSnapchatRedirectUri(),
            scopes: SNAP_SCOPES,
            variant,
          });
          return 'handled';
        } catch (e) {
          const code = (e as { code?: string })?.code;
          // Rien ne s'est ouvert : on garde le flux web (Custom Tab).
          if (code !== SNAP_ERR.unavailable) throw e;
        }
      }
    }

    const oauth = await promptSnapchatOAuth();
    await completeSnapchatSignIn(oauth);
    return 'signed_in';
  }, [persistMock, completeSnapchatSignIn]);

  const updateProfile = useCallback(
    async (patch: { displayName?: string; bio?: string }) => {
      if (!user) throw new Error('Connectez-vous pour modifier le profil.');
      const nextDisplay =
        patch.displayName !== undefined ? patch.displayName.trim() : user.displayName;
      const nextBio = patch.bio !== undefined ? patch.bio.trim() : user.bio;

      if (!isSupabaseConfigured || user.id.startsWith('mock_')) {
        const next: NiaUser = {
          ...user,
          displayName: nextDisplay,
          bio: nextBio,
        };
        await persistMock(next);
        return { pending: false, masked: false };
      }

      const row = await persistProfile(user.id, {
        display_name: nextDisplay,
        bio: nextBio,
      });
      if (!row) {
        setUser({ ...user, displayName: nextDisplay, bio: nextBio });
        return { pending: false, masked: false };
      }
      // 018 : seules les valeurs modifiées passent par le filtre ; une valeur
      // inchangée revient telle quelle (« saved »).
      const outcomes = [
        nextDisplay === user.displayName ? 'saved' : profileFieldOutcome(nextDisplay, row.display_name),
        nextBio === user.bio ? 'saved' : profileFieldOutcome(nextBio, row.bio),
      ];
      setUser({
        ...user,
        displayName: row.display_name ?? user.displayName,
        bio: row.bio ?? '',
      });
      return {
        pending: outcomes.includes('pending'),
        masked: outcomes.includes('masked'),
      };
    },
    [user, persistMock],
  );

  const signOut = useCallback(async () => {
    const sb = getSupabase();
    if (!sb) {
      await persistMock(null);
      return;
    }
    try {
      // Best-effort Google sign-out (ignore si module absent)
      const { GoogleSignin } = await import('@react-native-google-signin/google-signin');
      await GoogleSignin.signOut().catch(() => {});
    } catch {
      // ignore
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
      signInWithGoogle,
      signInWithSnapchat,
      completeSnapchatSignIn,
      signOut,
      updateProfile,
      isMockAuth: mockMode,
    }),
    [
      user,
      loading,
      signIn,
      signUp,
      signInWithGoogle,
      signInWithSnapchat,
      completeSnapchatSignIn,
      signOut,
      updateProfile,
      mockMode,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth doit être utilisé dans AuthProvider');
  return ctx;
}
