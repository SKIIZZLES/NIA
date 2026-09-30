/**
 * Module Expo local NiaComposer (éditeur, phase P0).
 *
 * Android : Media3 Transformer 1.9 (android/…/NiaComposerModule.kt).
 * iOS : bouchon, `isComposerAvailable()` renvoie false.
 * Web, Expo Go, tests : module absent, même réponse.
 */
import { requireOptionalNativeModule } from 'expo';
import type { ComposeResult, ComposerProgressEvent, Composition } from './src/NiaComposer.types';

export type * from './src/NiaComposer.types';

type Subscription = { remove(): void };

type NativeComposer = {
  isAvailable(): boolean;
  exportAsync(json: string): Promise<ComposeResult>;
  cancelAsync(): Promise<void>;
  addListener(event: 'onProgress', listener: (e: ComposerProgressEvent) => void): Subscription;
};

let cached: NativeComposer | null | undefined;

function native(): NativeComposer | null {
  if (cached !== undefined) return cached;
  try {
    cached = requireOptionalNativeModule<NativeComposer>('NiaComposer');
  } catch {
    cached = null;
  }
  return cached;
}

/** Vrai quand l'export natif existe sur cet appareil (Android, build natif). */
export function isComposerAvailable(): boolean {
  const mod = native();
  if (!mod) return false;
  try {
    return mod.isAvailable() === true;
  } catch {
    return false;
  }
}

/** Code d'erreur natif (ERR_CANCELLED, ERR_EXPORT, ERR_BUSY, ERR_INVALID…). */
export function composerErrorCode(e: unknown): string | null {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : null;
}

/** Exporte la composition ; `onProgress` reçoit 0 → 1. */
export async function exportComposition(
  composition: Composition,
  onProgress?: (progress: number) => void,
): Promise<ComposeResult> {
  const mod = native();
  if (!mod || !isComposerAvailable()) {
    const err = new Error('NiaComposer unavailable') as Error & { code: string };
    err.code = 'ERR_UNAVAILABLE';
    throw err;
  }
  const sub = onProgress
    ? mod.addListener('onProgress', (e) => {
        const p = Number(e?.progress);
        if (Number.isFinite(p)) onProgress(Math.max(0, Math.min(1, p)));
      })
    : null;
  try {
    return await mod.exportAsync(JSON.stringify(composition));
  } finally {
    sub?.remove();
  }
}

/** Annule l'export en cours (sans effet s'il n'y en a pas). */
export async function cancelComposition(): Promise<void> {
  const mod = native();
  if (!mod) return;
  try {
    await mod.cancelAsync();
  } catch {
    // rien à annuler
  }
}
