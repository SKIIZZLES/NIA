/**
 * Éditeur V2 — polices des textes posés sur la vidéo.
 *
 * Toutes libres (SIL Open Font License 1.1, Google Fonts), fournies par les
 * paquets @expo-google-fonts (un seul fichier .ttf importé par police : Metro
 * n'embarque que celui-là). Licences : docs/fonts-licenses.md.
 *
 * Les clés sont les noms de famille utilisés par lib/overlays (OVERLAY_FONTS).
 * Chargées sans bloquer le démarrage (app/_layout) puis de nouveau, en
 * attendant la fin, avant chaque capture des calques (lib/overlayBake) : le
 * texte incrusté utilise donc toujours la vraie police.
 */
import { CourierPrime_700Bold } from '@expo-google-fonts/courier-prime/700Bold';
import { TiltNeon_400Regular } from '@expo-google-fonts/tilt-neon/400Regular';
import { Caveat_700Bold } from '@expo-google-fonts/caveat/700Bold';
import { Oswald_700Bold } from '@expo-google-fonts/oswald/700Bold';
import { PlayfairDisplay_700Bold } from '@expo-google-fonts/playfair-display/700Bold';
import { Fredoka_600SemiBold } from '@expo-google-fonts/fredoka/600SemiBold';

export const OVERLAY_FONT_SOURCES = {
  CourierPrime_700Bold,
  TiltNeon_400Regular,
  Caveat_700Bold,
  Oswald_700Bold,
  PlayfairDisplay_700Bold,
  Fredoka_600SemiBold,
} as const;
