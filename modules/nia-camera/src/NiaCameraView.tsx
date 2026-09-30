import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { requireNativeView } from 'expo';
import type {
  NiaCameraError,
  NiaCameraHandle,
  NiaCameraProps,
  NiaCameraStats,
  NiaRecordOptions,
} from './NiaCamera.types';
import { isNiaCameraAvailable } from './availability';

type NativeEvent<T> = { nativeEvent: T };

type NativeProps = Omit<
  NiaCameraProps,
  'onCameraReady' | 'onMountError' | 'onFaceChange' | 'onStats'
> & {
  ref?: React.Ref<NativeRef>;
  onCameraReady?: () => void;
  onMountError?: (e: NativeEvent<NiaCameraError>) => void;
  onFaceChange?: (e: NativeEvent<{ detected?: boolean }>) => void;
  onStats?: (e: NativeEvent<NiaCameraStats>) => void;
};

type NativeRef = {
  record(options: { maxDuration: number; maxFileSize: number }): Promise<{ uri: string }>;
  stopRecording(): Promise<void>;
};

let NativeView: React.ComponentType<NativeProps> | null = null;

function nativeView(): React.ComponentType<NativeProps> {
  if (!NativeView) NativeView = requireNativeView<NativeProps>('NiaCamera');
  return NativeView;
}

/**
 * Caméra dont l'aperçu ET le fichier portent déjà le masque (Android).
 * Rend `null` là où le module natif n'existe pas (iOS, web, tests).
 */
export const NiaCameraView = forwardRef<NiaCameraHandle, NiaCameraProps>(function NiaCameraView(
  { onCameraReady, onMountError, onFaceChange, onStats, ...rest },
  ref,
) {
  const nativeRef = useRef<NativeRef | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      recordAsync(options?: NiaRecordOptions) {
        const native = nativeRef.current;
        if (!native) return Promise.reject(new Error('NiaCamera not mounted'));
        return native.record({
          maxDuration: options?.maxDuration ?? 0,
          maxFileSize: options?.maxFileSize ?? 0,
        });
      },
      stopRecording() {
        void nativeRef.current?.stopRecording().catch(() => {
          // déjà arrêté
        });
      },
    }),
    [],
  );

  if (!isNiaCameraAvailable()) return null;
  const Native = nativeView();
  return (
    <Native
      {...rest}
      ref={nativeRef}
      onCameraReady={() => onCameraReady?.()}
      onMountError={(e) => onMountError?.(e.nativeEvent)}
      onFaceChange={(e) => onFaceChange?.(e.nativeEvent?.detected === true)}
      onStats={(e) => onStats?.(e.nativeEvent)}
    />
  );
});
