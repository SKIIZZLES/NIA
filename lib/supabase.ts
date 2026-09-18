/**
 * Guaranteed-open build: always mock auth/data.
 * Prioritize APK opening over live Supabase.
 *
 * - isSupabaseConfigured is always false → AuthContext / Feed use mocks.
 * - getSupabase() never calls createClient and never loads the real SDK.
 * - On android/ios, Metro resolves @supabase/* to shims/supabase-js-native.js
 *   so the real client is not in the APK bundle.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

/** Always false for this guaranteed-open Android preview. */
export const isSupabaseConfigured: boolean = false;

/**
 * Always null. Real createClient is intentionally unreachable so the native
 * bundle never depends on SecureStore / ws / stream via supabase-js.
 *
 * Dead path below is kept only so a future flip of isSupabaseConfigured can
 * re-enable web via dynamic require without a static top-level import.
 */
export function getSupabase(): SupabaseClient<Database> | null {
  if (!isSupabaseConfigured) return null;

  // Unreachable while isSupabaseConfigured === false (intentional).
  try {
    // Dynamic require — not evaluated on the mock path; Metro stubs on native.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@supabase/supabase-js') as {
      createClient: (
        url: string,
        key: string,
        opts?: unknown,
      ) => SupabaseClient<Database>;
    };
    void mod;
  } catch {
    return null;
  }
  return null;
}
