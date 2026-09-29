/**
 * Lecture d'un son NIA, synchronisée avec un lecteur vidéo (sprint S2).
 *
 * - Avec `video` : le son suit la vidéo — lecture/pause sur `playingChange`,
 *   recalage sur `timeUpdate` dès que l'écart dépasse la tolérance (seek,
 *   boucle de la vidéo, scrub), retour au début sur `playToEnd`.
 *   Le lecteur vidéo doit avoir `timeUpdateEventInterval` > 0.
 * - Sans `video` (post photo, écoute seule, tournage) : le son repart de son
 *   début (`offsetMs`) à chaque démarrage et boucle.
 *
 * Le son s'arrête dès que `active` passe à false (hors écran, écran sans
 * focus, pause) ou que l'application quitte le premier plan. Le mode audio
 * « mixWithOthers » ne demande pas le focus audio : il ne coupe donc pas le
 * son des lecteurs vidéo.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { setAudioModeAsync, useAudioPlayer, type AudioPlayer } from 'expo-audio';
import type { VideoPlayer } from 'expo-video';
import { needsResync, soundTargetSec } from '@/lib/soundSync';

let audioModeReady = false;
function ensureAudioMode() {
  if (audioModeReady) return;
  audioModeReady = true;
  setAudioModeAsync({
    playsInSilentMode: true,
    interruptionMode: 'mixWithOthers',
    shouldPlayInBackground: false,
  }).catch(() => {
    audioModeReady = false;
  });
}

/** Délai minimal entre deux recalages : un seek met un moment à se refléter. */
const MIN_SEEK_GAP_MS = 800;

export type SyncedSoundOptions = {
  /** URL (distante ou fichier local) du son ; null = aucun son. */
  url?: string | null;
  /** Lecteur vidéo à suivre ; absent = lecture autonome. */
  video?: VideoPlayer | null;
  /** Le son a le droit de jouer (écran visible, élément actif, pas en pause). */
  active: boolean;
  /** Bouton son coupé du feed. */
  muted?: boolean;
  /** Début du son, en millisecondes. */
  offsetMs?: number;
  /** Volume du son, 0 → 1. */
  volume?: number;
  /**
   * Vitesse de la vidéo (S3). Le son reste à vitesse normale : il suit la
   * timeline de la vidéo finale, soit (temps vidéo − origine) / vitesse.
   */
  rate?: number;
  /** Début de la timeline dans le fichier vidéo, en secondes (découpe S3). */
  originSec?: number;
};

export function useSyncedSound({
  url,
  video = null,
  active,
  muted = false,
  offsetMs = 0,
  volume = 1,
  rate = 1,
  originSec = 0,
}: SyncedSoundOptions): AudioPlayer {
  const player = useAudioPlayer(url || null, { updateInterval: 250 });
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const [videoPlaying, setVideoPlaying] = useState(false);
  const lastSeekAtRef = useRef(0);
  const offsetRef = useRef(offsetMs);
  offsetRef.current = offsetMs;
  const timelineRef = useRef({ rate, originSec });
  timelineRef.current = { rate: rate > 0 ? rate : 1, originSec };

  useEffect(() => {
    if (url) ensureAudioMode();
  }, [url]);

  useEffect(() => {
    try {
      player.loop = true;
    } catch {
      // lecteur libéré
    }
  }, [player]);

  useEffect(() => {
    try {
      player.volume = Math.max(0, Math.min(1, volume));
      player.muted = muted;
    } catch {
      // lecteur libéré
    }
  }, [player, volume, muted]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setAppActive(s === 'active'));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!video) {
      setVideoPlaying(false);
      return;
    }
    try {
      setVideoPlaying(video.playing);
    } catch {
      setVideoPlaying(false);
    }
    const sub = video.addListener('playingChange', ({ isPlaying }) => setVideoPlaying(isPlaying));
    return () => sub.remove();
  }, [video]);

  const shouldPlay = !!url && active && appActive && (video ? videoPlaying : true);

  /** Recale le son sur la position attendue (vidéo + début du son). */
  const resync = useCallback(
    (force: boolean) => {
      try {
        const duration = player.duration;
        const { rate: r, originSec: o } = timelineRef.current;
        const expected = soundTargetSec(
          video ? Math.max(0, video.currentTime - o) / r : 0,
          offsetRef.current,
          duration,
        );
        const now = Date.now();
        if (!force) {
          if (now - lastSeekAtRef.current < MIN_SEEK_GAP_MS) return;
          if (!needsResync(player.currentTime, expected, duration)) return;
        }
        lastSeekAtRef.current = now;
        void player.seekTo(expected).catch(() => undefined);
      } catch {
        // lecteur libéré ou pas encore prêt
      }
    },
    [player, video],
  );

  // Démarrage / arrêt.
  useEffect(() => {
    if (!url) return;
    try {
      if (shouldPlay) {
        resync(true);
        player.play();
      } else {
        player.pause();
      }
    } catch {
      // lecteur libéré
    }
  }, [shouldPlay, url, player, resync]);

  // Un nouveau début de son (ou vitesse, ou découpe) s'applique tout de suite.
  useEffect(() => {
    if (shouldPlay) resync(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offsetMs, rate, originSec]);

  // Chargement tardif : la durée n'est connue qu'une fois le son prêt.
  useEffect(() => {
    if (!url) return;
    const sub = player.addListener('playbackStatusUpdate', (status) => {
      if (!status.isLoaded || !shouldPlay) return;
      if (video) resync(false);
      else if (!status.playing) player.play();
    });
    return () => sub.remove();
  }, [player, url, video, shouldPlay, resync]);

  // Synchro continue avec la vidéo.
  useEffect(() => {
    if (!video || !url || !shouldPlay) return;
    const timeSub = video.addListener('timeUpdate', () => resync(false));
    const endSub = video.addListener('playToEnd', () => resync(true));
    return () => {
      timeSub.remove();
      endSub.remove();
    };
  }, [video, url, shouldPlay, resync]);

  return player;
}
