/**
 * Google Sign-In natif → Supabase Auth (signInWithIdToken).
 * Requiert un build EAS (pas Expo Go). Voir GOOGLE_AUTH.md.
 */
import { Platform } from 'react-native';
import {
  GoogleSignin,
  isSuccessResponse,
  statusCodes,
} from '@react-native-google-signin/google-signin';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';

const webClientId = (process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || '').trim();
const iosClientId = (process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || '').trim();

let configured = false;

export function isGoogleAuthConfigured(): boolean {
  return webClientId.length > 0 && !webClientId.includes('PLACEHOLDER');
}

function ensureConfigured(): void {
  if (configured) return;
  if (!isGoogleAuthConfigured()) {
    throw new Error(
      'Google non configuré. Définissez EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID (voir GOOGLE_AUTH.md).',
    );
  }
  GoogleSignin.configure({
    webClientId,
    ...(Platform.OS === 'ios' && iosClientId && !iosClientId.includes('PLACEHOLDER')
      ? { iosClientId }
      : {}),
    offlineAccess: false,
  });
  configured = true;
}

export type GoogleSignInResult = {
  idToken: string;
  email: string | null;
  name: string | null;
  photo: string | null;
};

/**
 * Lance le flux Google natif et retourne l'idToken pour Supabase.
 * Annulation utilisateur → Error avec code 'CANCELLED'.
 */
export async function getGoogleIdToken(): Promise<GoogleSignInResult> {
  if (Platform.OS === 'web') {
    throw new Error(
      'Google Sign-In natif n’est pas disponible sur le web. Utilisez un APK EAS.',
    );
  }

  ensureConfigured();

  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  } catch {
    // iOS n'a pas Play Services — ignore
  }

  let response;
  try {
    response = await GoogleSignin.signIn();
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string };
    if (err?.code === statusCodes.SIGN_IN_CANCELLED || err?.code === statusCodes.IN_PROGRESS) {
      const cancel = new Error('Connexion Google annulée');
      (cancel as Error & { code?: string }).code = 'CANCELLED';
      throw cancel;
    }
    if (err?.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
      throw new Error('Google Play Services indisponible ou obsolète.');
    }
    // Module natif absent (Expo Go)
    const msg = err?.message || String(e);
    if (
      msg.includes('RNGoogleSignin') ||
      msg.includes('native module') ||
      msg.includes('null is not an object')
    ) {
      throw new Error(
        'Google Sign-In nécessite un build EAS (development/preview), pas Expo Go. Voir GOOGLE_AUTH.md.',
      );
    }
    throw e instanceof Error ? e : new Error(msg);
  }

  if (!isSuccessResponse(response)) {
    const cancel = new Error('Connexion Google annulée');
    (cancel as Error & { code?: string }).code = 'CANCELLED';
    throw cancel;
  }

  const idToken = response.data.idToken;
  if (!idToken) {
    throw new Error(
      'Pas d’idToken Google. Vérifiez EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID (type Web) et le SHA-1 Android.',
    );
  }

  return {
    idToken,
    email: response.data.user.email ?? null,
    name: response.data.user.name ?? null,
    photo: response.data.user.photo ?? null,
  };
}

/**
 * Échange l'idToken Google contre une session Supabase.
 * Documenter « Skip nonce check » dans le Dashboard Google provider (MVP).
 */
export async function signInWithGoogleIdToken(idToken: string): Promise<void> {
  const sb = getSupabase();
  if (!sb || !isSupabaseConfigured) {
    throw new Error('Supabase non configuré.');
  }
  const { error } = await sb.auth.signInWithIdToken({
    provider: 'google',
    token: idToken,
  });
  if (error) throw error;
}
