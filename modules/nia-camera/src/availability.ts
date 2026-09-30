import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';

type NativeCameraModule = { isAvailable(): boolean };

let cached: boolean | undefined;

/** Vrai sur Android avec le module natif compilé (build EAS), faux ailleurs. */
export function isNiaCameraAvailable(): boolean {
  if (cached !== undefined) return cached;
  if (Platform.OS !== 'android') {
    cached = false;
    return cached;
  }
  try {
    const mod = requireOptionalNativeModule<NativeCameraModule>('NiaCamera');
    cached = !!mod && mod.isAvailable() === true;
  } catch {
    cached = false;
  }
  return cached;
}
