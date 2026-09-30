/**
 * Réglages LiveKit côté téléphone (sprint L1). NATIF UNIQUEMENT :
 * n'importer que depuis des fichiers `*.native.tsx`, pour que les modules
 * WebRTC n'entrent jamais dans le bundle web.
 *
 * `registerGlobals()` est appelé à la demande (entrée sur un écran live),
 * pas au démarrage de l'app : les polyfills WebRTC ne touchent pas le reste
 * de NIA tant qu'on n'ouvre pas un live.
 */
import { PermissionsAndroid, Platform } from 'react-native';
import {
  AndroidAudioTypePresets,
  AudioSession,
  registerGlobals,
} from '@livekit/react-native';
import {
  VideoPresets,
  type RoomOptions,
  type TrackPublishOptions,
  type VideoCaptureOptions,
} from 'livekit-client';

let globalsReady = false;

export function ensureLiveKitGlobals(): void {
  if (globalsReady) return;
  registerGlobals();
  globalsReady = true;
}

/**
 * Diffusion en 540p (960×540, 800 kbit/s, 25 i/s) avec simulcast 180p/360p :
 * c'est le débit descendant qui consomme le quota gratuit LiveKit (50 Go/mois).
 */
export const LIVE_CAPTURE_RESOLUTION = VideoPresets.h540.resolution;

export function cameraCaptureOptions(facing: 'user' | 'environment'): VideoCaptureOptions {
  return { facingMode: facing, resolution: LIVE_CAPTURE_RESOLUTION };
}

export const LIVE_VIDEO_PUBLISH: TrackPublishOptions = {
  simulcast: true,
  videoEncoding: VideoPresets.h540.encoding,
  videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360],
  videoCodec: 'vp8',
};

export const HOST_ROOM_OPTIONS: RoomOptions = {
  adaptiveStream: false,
  dynacast: true,
  publishDefaults: LIVE_VIDEO_PUBLISH,
};

export const VIEWER_ROOM_OPTIONS: RoomOptions = {
  // Le spectateur ne reçoit que la couche adaptée à la taille d'affichage.
  adaptiveStream: { pixelDensity: 'screen' },
  dynacast: true,
};

/** Demande caméra + micro (Android). Renvoie false si l'un est refusé. */
export async function requestCameraAndMic(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const res = await PermissionsAndroid.requestMultiple([
    PermissionsAndroid.PERMISSIONS.CAMERA,
    PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
  ]);
  return (
    res[PermissionsAndroid.PERMISSIONS.CAMERA] === PermissionsAndroid.RESULTS.GRANTED &&
    res[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] === PermissionsAndroid.RESULTS.GRANTED
  );
}

/** Hôte : mode communication (annulation d'écho matérielle). */
export async function startHostAudio(): Promise<void> {
  await AudioSession.configureAudio({
    android: { audioTypeOptions: AndroidAudioTypePresets.communication },
  });
  await AudioSession.startAudioSession();
}

/** Spectateur : lecture média sur le haut-parleur (volume réglable jusqu'à 0). */
export async function startViewerAudio(): Promise<void> {
  await AudioSession.configureAudio({
    android: {
      preferredOutputList: ['speaker', 'headset', 'bluetooth'],
      audioTypeOptions: AndroidAudioTypePresets.media,
    },
  });
  await AudioSession.startAudioSession();
}

export async function stopLiveAudio(): Promise<void> {
  try {
    await AudioSession.stopAudioSession();
  } catch {
    // déjà arrêtée
  }
}
