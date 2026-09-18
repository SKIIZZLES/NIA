/**
 * Client Supabase NIA.
 *
 * Real client when EXPO_PUBLIC_SUPABASE_URL + ANON_KEY are set.
 * Mock only when env missing or EXPO_PUBLIC_USE_MOCK=1.
 * Metro stubs @supabase/realtime-js + Node ws/stream (see metro.config.js)
 * so REST / Auth / Storage work on RN without realtime websocket crashes.
 */
import 'react-native-url-polyfill/auto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { Database } from '@/types/database';

const supabaseUrl = (process.env.EXPO_PUBLIC_SUPABASE_URL || '').trim();
const supabaseAnonKey = (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '').trim();
const forceMock =
  (process.env.EXPO_PUBLIC_USE_MOCK || '').trim() === '1' ||
  (process.env.EXPO_PUBLIC_USE_MOCK || '').trim().toLowerCase() === 'true';

const envLooksValid =
  supabaseUrl.length > 0 &&
  supabaseAnonKey.length > 0 &&
  supabaseUrl.startsWith('http');

/**
 * true when URL+anon key are present and mock is not forced.
 * Applies to Expo Go, EAS standalone, bare, and web (realtime stubbed on native).
 */
export const isSupabaseConfigured = !forceMock && envLooksValid;

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

/** In-memory storage for SSR — never touches window / AsyncStorage / SecureStore. */
const memoryStore = new Map<string, string>();

const MemoryAuthStorage = {
  async getItem(key: string): Promise<string | null> {
    return memoryStore.get(key) ?? null;
  },
  async setItem(key: string, value: string): Promise<void> {
    memoryStore.set(key, value);
  },
  async removeItem(key: string): Promise<void> {
    memoryStore.delete(key);
  },
};

/**
 * Stockage session : SecureStore sur natif (valeurs courtes),
 * AsyncStorage sur web / fallback (JWT session peut dépasser 2048 octets).
 * Sur SSR : mémoire uniquement (jamais AsyncStorage/SecureStore).
 */
const ExpoAuthStorage = {
  async getItem(key: string): Promise<string | null> {
    if (!isBrowser()) {
      return MemoryAuthStorage.getItem(key);
    }
    if (Platform.OS === 'web') {
      return AsyncStorage.getItem(key);
    }
    try {
      const secure = await SecureStore.getItemAsync(key);
      if (secure != null) return secure;
      return AsyncStorage.getItem(key);
    } catch {
      return AsyncStorage.getItem(key);
    }
  },
  async setItem(key: string, value: string): Promise<void> {
    if (!isBrowser()) {
      await MemoryAuthStorage.setItem(key, value);
      return;
    }
    if (Platform.OS === 'web') {
      await AsyncStorage.setItem(key, value);
      return;
    }
    try {
      if (value.length < 2000) {
        await SecureStore.setItemAsync(key, value);
        await AsyncStorage.removeItem(key);
      } else {
        await AsyncStorage.setItem(key, value);
        await SecureStore.deleteItemAsync(key).catch(() => {});
      }
    } catch {
      await AsyncStorage.setItem(key, value);
    }
  },
  async removeItem(key: string): Promise<void> {
    if (!isBrowser()) {
      await MemoryAuthStorage.removeItem(key);
      return;
    }
    if (Platform.OS === 'web') {
      await AsyncStorage.removeItem(key);
      return;
    }
    await Promise.all([
      SecureStore.deleteItemAsync(key).catch(() => {}),
      AsyncStorage.removeItem(key),
    ]);
  },
};

let client: SupabaseClient<Database> | null = null;
/** Rebuild if the cached client was created in the wrong environment (SSR vs browser). */
let clientBuiltForBrowser: boolean | null = null;

export function getSupabase(): SupabaseClient<Database> | null {
  if (!isSupabaseConfigured) return null;
  const browser = isBrowser();
  if (!client || clientBuiltForBrowser !== browser) {
    clientBuiltForBrowser = browser;
    client = createClient<Database>(supabaseUrl, supabaseAnonKey, {
      auth: {
        storage: browser ? ExpoAuthStorage : MemoryAuthStorage,
        autoRefreshToken: browser,
        persistSession: browser,
        detectSessionInUrl: false,
      },
    });
  }
  return client;
}

/**
 * Alias pratique — null en mode mock (env manquantes ou EXPO_PUBLIC_USE_MOCK=1).
 */
export const supabase: SupabaseClient<Database> | null = isSupabaseConfigured
  ? getSupabase()
  : null;
