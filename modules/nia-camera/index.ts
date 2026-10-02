/**
 * Module Expo local NiaCamera — masques visage cuits dans le fichier (A1).
 *
 * Android : CameraX (Preview + VideoCapture + ImageAnalysis) avec un
 * OverlayEffect appliqué à l'aperçu ET à l'enregistrement, MediaPipe Face
 * Detector sur l'appareil. iOS, web, Expo Go, tests : module absent,
 * `isNiaCameraAvailable()` renvoie false et la caméra habituelle reste seule.
 */
export type * from './src/NiaCamera.types';
export { isNiaCameraAvailable } from './src/availability';
export { NiaCameraView } from './src/NiaCameraView';
