/**
 * Éditeur V1 (Montage) — lecture de la timeline, clip après clip.
 *
 * Deux lecteurs expo-video se relaient (A / B) : pendant qu'un clip joue, le
 * suivant est chargé et placé à son début dans l'autre lecteur, puis les deux
 * vues échangent leur opacité (surface « textureView », seule à respecter
 * l'opacité sur Android). Une photo s'affiche par-dessus, minutée en JS.
 *
 * L'instant de la timeline (vitesse appliquée) est publié dans une
 * TimelineClock : calques, tête de lecture et son ajouté le suivent. Le son
 * ajouté est joué ici, recalé sur l'horloge (même tolérance que S2).
 *
 * Aperçu seulement : le fichier publié sort de NiaComposer, qui enchaîne les
 * mêmes clips sans trou.
 */
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState, Image, StyleSheet, View, type LayoutChangeEvent, type ViewStyle } from 'react-native';
import { useVideoPlayer, VideoView, type VideoPlayer } from 'expo-video';
import { useAudioPlayer } from 'expo-audio';
import { ensureAudioMode } from '@/hooks/useSyncedSound';
import { coverFrameRect } from '@/lib/overlays';
import { needsResync, soundTargetSec } from '@/lib/soundSync';
import {
  clipDurationMs,
  clipStartsMs,
  locate,
  sourceMsAt,
  timelineKey,
  type Timeline,
  type TimelineClip,
} from '@/lib/timeline';
import type { TimelineClock } from '@/lib/timelineClock';

/** Marge avant la fin d'un extrait : on passe au clip suivant. */
const END_EPS_MS = 40;
/** Cadre de l'export quand il est fixe (plusieurs clips, photos). */
const CANVAS_ASPECT = 9 / 16;

export type TimelinePlayerHandle = {
  /** Place la lecture à cet instant de la timeline (ms). */
  seek: (ms: number) => void;
};

type Slot = 0 | 1;
type ViewState = { active: Slot; imageUri: string | null };

function safe(fn: () => void) {
  try {
    fn();
  } catch {
    // lecteur libéré ou pas encore prêt
  }
}

/** Machine de lecture, hors React : les événements natifs arrivent ici. */
class TimelineEngine {
  private clips: Timeline = [];
  private starts: number[] = [];
  private key = '';
  private index = 0;
  private active: Slot = 0;
  private slotUri: [string | null, string | null] = [null, null];
  /** Clip placé à son début dans ce lecteur (préchargé), sinon −1. */
  private slotReady: [number, number] = [-1, -1];
  private playing = false;
  private volume = 1;
  private gen = 0;
  private advancedAt = -1;
  private imageOffsetMs = 0;
  private imageStartedAt = 0;
  private imageTimer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;

  constructor(
    private readonly players: [VideoPlayer, VideoPlayer],
    private readonly clock: TimelineClock,
    private readonly render: (s: ViewState) => void,
  ) {}

  setClips(clips: Timeline) {
    this.clips = clips;
    this.starts = clipStartsMs(clips);
    const key = timelineKey(clips);
    if (key === this.key) return;
    this.key = key;
    this.slotReady = [-1, -1];
    if (clips.length === 0) return;
    const last = clips.length - 1;
    const total = this.starts[last] + clipDurationMs(clips[last]);
    // Montage modifié : reprise au même instant, borné à la nouvelle durée.
    this.seek(Math.min(this.clock.get(), Math.max(0, total - 1)));
  }

  seek(ms: number) {
    const pos = locate(this.clips, ms);
    if (!pos) return;
    void this.enter(pos.index, pos.offsetMs);
  }

  setPlaying(p: boolean) {
    if (this.playing === p) return;
    this.playing = p;
    const clip = this.clips[this.index];
    if (!clip) return;
    if (clip.kind === 'image') {
      if (p) this.startImageTimer();
      else this.stopImageTimer();
      return;
    }
    const player = this.players[this.active];
    safe(() => (p ? player.play() : player.pause()));
  }

  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
    const player = this.players[this.active];
    safe(() => {
      player.volume = this.volume;
      player.muted = this.volume <= 0;
    });
  }

  onTime(slot: Slot, currentTimeSec: number) {
    if (this.disposed || slot !== this.active) return;
    const clip = this.clips[this.index];
    if (!clip || clip.kind !== 'video') return;
    const ms = currentTimeSec * 1000;
    if (ms < clip.startMs - 300) return; // position d'avant le seek
    if (ms >= clip.endMs - END_EPS_MS) {
      this.advance();
      return;
    }
    const off = Math.max(0, (ms - clip.startMs) / (clip.speed > 0 ? clip.speed : 1));
    this.clock.set(this.starts[this.index] + Math.min(off, clipDurationMs(clip)));
  }

  onEnd(slot: Slot) {
    if (this.disposed || slot !== this.active) return;
    if (this.clips[this.index]?.kind === 'video') this.advance();
  }

  dispose() {
    this.disposed = true;
    this.gen += 1;
    this.stopImageTimer();
  }

  private advance() {
    if (this.advancedAt === this.gen || this.clips.length === 0) return;
    this.advancedAt = this.gen;
    // Fin du montage : on reboucle au début (comme l'aperçu à clip unique).
    const next = (this.index + 1) % this.clips.length;
    void this.enter(next, 0);
  }

  private async enter(idx: number, offsetMs: number) {
    const g = ++this.gen;
    this.stopImageTimer();
    const clip = this.clips[idx];
    if (!clip) return;
    this.index = idx;
    this.clock.set(this.starts[idx] + offsetMs);
    if (clip.kind === 'image') {
      for (const p of this.players) safe(() => p.pause());
      this.imageOffsetMs = offsetMs;
      this.render({ active: this.active, imageUri: clip.uri });
      if (this.playing) this.startImageTimer();
      void this.preloadNext(g);
      return;
    }
    const other: Slot = this.active === 0 ? 1 : 0;
    let slot: Slot;
    if (offsetMs < 1 && this.slotReady[other] === idx && this.slotUri[other] === clip.uri) {
      slot = other;
    } else {
      slot = this.active;
      await this.load(slot, clip, sourceMsAt(clip, offsetMs));
      if (g !== this.gen || this.disposed) return;
    }
    this.slotReady[slot] = -1;
    const player = this.players[slot];
    safe(() => {
      player.playbackRate = clip.speed > 0 ? clip.speed : 1;
      player.preservesPitch = true;
      player.volume = this.volume;
      player.muted = this.volume <= 0;
    });
    if (this.playing) safe(() => player.play());
    const prev = this.active;
    this.active = slot;
    this.render({ active: slot, imageUri: null });
    if (prev !== slot) {
      const old = this.players[prev];
      safe(() => {
        old.pause();
        old.muted = true;
      });
    }
    void this.preloadNext(g);
  }

  private async load(slot: Slot, clip: TimelineClip, atMs: number) {
    const player = this.players[slot];
    this.slotReady[slot] = -1;
    if (this.slotUri[slot] !== clip.uri) {
      this.slotUri[slot] = clip.uri;
      try {
        await player.replaceAsync({ uri: clip.uri });
      } catch {
        this.slotUri[slot] = null;
        return;
      }
    }
    safe(() => {
      player.currentTime = atMs / 1000;
    });
  }

  private async preloadNext(g: number) {
    const n = this.clips.length;
    if (n < 2) return;
    const nextIdx = (this.index + 1) % n;
    const next = this.clips[nextIdx];
    if (next.kind !== 'video') return;
    const slot: Slot = this.active === 0 ? 1 : 0;
    await this.load(slot, next, next.startMs);
    if (g !== this.gen || this.disposed) return;
    const player = this.players[slot];
    safe(() => {
      player.pause();
      player.muted = true;
    });
    this.slotReady[slot] = nextIdx;
  }

  private startImageTimer() {
    if (this.imageTimer) return;
    this.imageStartedAt = Date.now();
    this.imageTimer = setInterval(() => this.imageTick(), 40);
  }

  private stopImageTimer() {
    if (!this.imageTimer) return;
    clearInterval(this.imageTimer);
    this.imageTimer = null;
    this.imageOffsetMs += Date.now() - this.imageStartedAt;
  }

  private imageTick() {
    const clip = this.clips[this.index];
    if (!clip || clip.kind !== 'image') return;
    const off = this.imageOffsetMs + (Date.now() - this.imageStartedAt);
    if (off >= clipDurationMs(clip)) {
      this.advance();
      return;
    }
    this.clock.set(this.starts[this.index] + off);
  }
}

type SoundProps = { url: string; offsetMs: number; volume: number } | null | undefined;

/** Son ajouté, recalé sur l'horloge de la timeline. */
function useTimelineSound(sound: SoundProps, clock: TimelineClock, playing: boolean) {
  const url = sound?.url || null;
  const player = useAudioPlayer(url, { updateInterval: 250 });
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const offsetRef = useRef(sound?.offsetMs ?? 0);
  offsetRef.current = sound?.offsetMs ?? 0;
  const lastSeekRef = useRef(0);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setAppActive(s === 'active'));
    return () => sub.remove();
  }, []);
  useEffect(() => {
    if (url) ensureAudioMode();
  }, [url]);
  useEffect(() => {
    safe(() => {
      player.loop = true;
    });
  }, [player]);
  const volume = sound?.volume ?? 1;
  useEffect(() => {
    safe(() => {
      player.volume = Math.max(0, Math.min(1, volume));
    });
  }, [player, volume]);

  const active = !!url && playing && appActive;

  const resync = useCallback(
    (force: boolean) => {
      try {
        const d = player.duration;
        const expected = soundTargetSec(clock.get() / 1000, offsetRef.current, d);
        const now = Date.now();
        if (!force) {
          if (now - lastSeekRef.current < 800) return;
          if (!needsResync(player.currentTime, expected, d)) return;
        }
        lastSeekRef.current = now;
        void player.seekTo(expected).catch(() => undefined);
      } catch {
        // lecteur pas encore prêt
      }
    },
    [player, clock],
  );

  useEffect(() => {
    if (!url) return;
    safe(() => {
      if (active) {
        resync(true);
        player.play();
      } else {
        player.pause();
      }
    });
  }, [active, url, player, resync]);

  const offsetMs = sound?.offsetMs ?? 0;
  useEffect(() => {
    if (active) resync(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offsetMs]);

  useEffect(() => {
    if (!active) return;
    let lastMs = clock.get();
    return clock.subscribe((ms) => {
      // Saut (boucle, seek, clip suivant repositionné) : recalage immédiat.
      const jump = Math.abs(ms - lastMs) > 600;
      lastMs = ms;
      resync(jump);
    });
  }, [active, clock, resync]);
}

type Props = {
  clips: Timeline;
  clock: TimelineClock;
  playing: boolean;
  /** Volume du son des vidéos, 0 → 1 (mixage V1). */
  originalVolume: number;
  sound?: SoundProps;
  /** Cadre 9:16 fixe (plusieurs clips ou une photo), comme l'export. */
  fixedCanvas: boolean;
  style?: ViewStyle;
};

export const TimelinePlayer = forwardRef<TimelinePlayerHandle, Props>(function TimelinePlayer(
  { clips, clock, playing, originalVolume, sound, fixedCanvas, style },
  ref,
) {
  const setup = (p: VideoPlayer) => {
    p.loop = false;
    p.timeUpdateEventInterval = 0.05;
    p.preservesPitch = true;
  };
  const playerA = useVideoPlayer(null, setup);
  const playerB = useVideoPlayer(null, setup);
  const [view, setView] = useState<ViewState>({ active: 0, imageUri: null });
  const engine = useMemo(
    () => new TimelineEngine([playerA, playerB], clock, setView),
    [playerA, playerB, clock],
  );
  useEffect(() => () => engine.dispose(), [engine]);

  useEffect(() => {
    const subs = ([playerA, playerB] as const).flatMap((p, i) => [
      p.addListener('timeUpdate', ({ currentTime }) => engine.onTime(i as Slot, currentTime)),
      p.addListener('playToEnd', () => engine.onEnd(i as Slot)),
    ]);
    return () => subs.forEach((s) => s.remove());
  }, [engine, playerA, playerB]);

  // Première liste tout de suite ; ensuite, un petit délai : une poignée de
  // découpe qui glisse ne relance pas un chargement à chaque pixel.
  const firstRef = useRef(true);
  useEffect(() => {
    if (firstRef.current) {
      firstRef.current = false;
      engine.setClips(clips);
      return;
    }
    const id = setTimeout(() => engine.setClips(clips), 150);
    return () => clearTimeout(id);
  }, [engine, clips]);

  useEffect(() => engine.setPlaying(playing), [engine, playing]);
  useEffect(() => engine.setVolume(originalVolume), [engine, originalVolume]);
  useImperativeHandle(ref, () => ({ seek: (ms: number) => engine.seek(ms) }), [engine]);

  useTimelineSound(sound, clock, playing);

  const [box, setBox] = useState({ w: 0, h: 0 });
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setBox((cur) => (cur.w === width && cur.h === height ? cur : { w: width, h: height }));
  };
  const frame = fixedCanvas ? coverFrameRect(box.w, box.h, CANVAS_ASPECT) : null;
  const mediaStyle = frame
    ? { position: 'absolute' as const, left: frame.left, top: frame.top, width: frame.width, height: frame.height }
    : { position: 'absolute' as const, left: 0, top: 0, right: 0, bottom: 0 };
  const fit = fixedCanvas ? 'contain' : 'cover';

  return (
    <View style={[StyleSheet.absoluteFill, style]} onLayout={onLayout} pointerEvents="none">
      {([playerA, playerB] as const).map((p, i) => (
        <VideoView
          key={i}
          player={p}
          style={[mediaStyle, { opacity: view.active === i && !view.imageUri ? 1 : 0 }]}
          contentFit={fit}
          nativeControls={false}
          surfaceType="textureView"
        />
      ))}
      {view.imageUri ? (
        <Image source={{ uri: view.imageUri }} style={mediaStyle} resizeMode={fit} />
      ) : null}
    </View>
  );
});
