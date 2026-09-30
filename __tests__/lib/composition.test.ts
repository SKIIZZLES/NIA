import { MAX_UPLOAD_BYTES } from '@/constants/publish';
import {
  AUDIO_BITRATE,
  INTERMEDIATE_VIDEO_BITRATE,
  MAX_COMPOSED_DURATION_MS,
  MAX_SOURCE_BYTES_WITH_COMPOSER,
  MAX_VIDEO_BITRATE,
  MIN_VIDEO_BITRATE,
  OUTPUT_FPS,
  OUTPUT_MAX_HEIGHT,
  OUTPUT_MAX_WIDTH,
  OUTPUT_SHORT_SIDE,
  RETRY_BITRATE_FACTOR,
  buildPublishComposition,
  buildSegmentsComposition,
  clipOutputMs,
  composedDurationMs,
  composerOutputName,
  exceedsComposedMax,
  expectedBytes,
  maxVideoSourceBytes,
  overlaysForBakedSpeed,
  videoBitrateFor,
} from '@/lib/composition';
import type { Overlay, OverlayDoc } from '@/lib/overlays';

const sticker = (id: string, startMs: number, endMs: number | null): Overlay => ({
  id,
  type: 'sticker',
  emoji: '🔥',
  x: 0.5,
  y: 0.5,
  size: 0.16,
  rotation: 0,
  startMs,
  endMs,
});

describe('videoBitrateFor', () => {
  it('tient 3 min sous 50 Mo, son compris', () => {
    const br = videoBitrateFor(MAX_COMPOSED_DURATION_MS);
    expect(br).toBeGreaterThan(MIN_VIDEO_BITRATE);
    expect(br).toBeLessThan(MAX_VIDEO_BITRATE);
    expect(expectedBytes(MAX_COMPOSED_DURATION_MS, br)).toBeLessThan(MAX_UPLOAD_BYTES * 0.9);
  });

  it('plafonne les vidéos courtes à 4 Mbit/s', () => {
    expect(videoBitrateFor(15_000)).toBe(MAX_VIDEO_BITRATE);
    expect(videoBitrateFor(60_000)).toBe(MAX_VIDEO_BITRATE);
  });

  it('décroît avec la durée et respecte le plancher', () => {
    expect(videoBitrateFor(120_000)).toBeGreaterThan(videoBitrateFor(180_000));
    expect(videoBitrateFor(60 * 60_000)).toBe(MIN_VIDEO_BITRATE);
  });

  it('applique le facteur du second essai', () => {
    const first = videoBitrateFor(180_000);
    const retry = videoBitrateFor(180_000, MAX_UPLOAD_BYTES, RETRY_BITRATE_FACTOR);
    expect(Math.abs(retry - first * RETRY_BITRATE_FACTOR)).toBeLessThanOrEqual(1);
  });

  it('résiste aux valeurs absurdes', () => {
    expect(videoBitrateFor(Number.NaN)).toBe(MAX_VIDEO_BITRATE);
    expect(videoBitrateFor(0)).toBe(MAX_VIDEO_BITRATE);
    expect(videoBitrateFor(180_000, MAX_UPLOAD_BYTES, -1)).toBe(videoBitrateFor(180_000));
  });

  it('pour toute durée ≤ 3 min, la taille attendue reste sous le plafond', () => {
    for (let ms = 1000; ms <= MAX_COMPOSED_DURATION_MS; ms += 7_000) {
      expect(expectedBytes(ms, videoBitrateFor(ms))).toBeLessThanOrEqual(MAX_UPLOAD_BYTES);
    }
  });
});

describe('durées', () => {
  it('découpe puis vitesse', () => {
    expect(composedDurationMs({ sourceDurationMs: 90_000, trim: null, speed: 1 })).toBe(90_000);
    expect(composedDurationMs({ sourceDurationMs: 90_000, trim: { startMs: 10_000, endMs: 70_000 }, speed: 2 })).toBe(30_000);
    expect(composedDurationMs({ sourceDurationMs: 60_000, trim: null, speed: 0.5 })).toBe(120_000);
    expect(composedDurationMs({ sourceDurationMs: null, trim: null, speed: 1 })).toBeNull();
  });

  it('règle des 3 min, avec une petite tolérance', () => {
    expect(exceedsComposedMax(MAX_COMPOSED_DURATION_MS)).toBe(false);
    expect(exceedsComposedMax(MAX_COMPOSED_DURATION_MS + 200)).toBe(false);
    expect(exceedsComposedMax(MAX_COMPOSED_DURATION_MS + 1000)).toBe(true);
    expect(exceedsComposedMax(null)).toBe(false);
  });

  it('durée d’un clip', () => {
    expect(clipOutputMs({ startMs: 1000, endMs: 5000, speed: 2 })).toBe(2000);
    expect(clipOutputMs({ startMs: 0, endMs: null, speed: 1 }, 8000)).toBe(8000);
    expect(clipOutputMs({ startMs: 0, endMs: null, speed: 1 })).toBeNull();
  });
});

describe('buildPublishComposition', () => {
  const input = {
    sourceUri: 'file:///cache/src.mp4',
    sourceDurationMs: 100_000,
    trim: { startMs: 5_000, endMs: 65_000 },
    speed: 1.5,
    soundUri: 'file:///cache/sound.m4a',
    soundOffsetMs: 3_000,
    soundVolume: 0.8,
    originalVolume: 0.3,
    outputPath: '/cache/out.mp4',
  };

  it('un clip découpé, la vitesse, le son et les volumes', () => {
    const { composition, expectedDurationMs } = buildPublishComposition(input);
    expect(composition.clips).toEqual([
      { uri: input.sourceUri, startMs: 5_000, endMs: 65_000, speed: 1.5 },
    ]);
    expect(composition.audio).toEqual({ uri: input.soundUri, offsetMs: 3_000, volume: 0.8 });
    expect(composition.originalVolume).toBe(0.3);
    expect(expectedDurationMs).toBe(40_000);
  });

  it('sortie 720p 30 i/s, AAC, débit calé sur la durée', () => {
    const { composition } = buildPublishComposition(input);
    expect(composition.output).toEqual({
      path: '/cache/out.mp4',
      shortSide: OUTPUT_SHORT_SIDE,
      maxWidth: OUTPUT_MAX_WIDTH,
      maxHeight: OUTPUT_MAX_HEIGHT,
      fps: OUTPUT_FPS,
      videoBitrate: videoBitrateFor(40_000),
      audioBitrate: AUDIO_BITRATE,
    });
    expect([OUTPUT_MAX_WIDTH, OUTPUT_MAX_HEIGHT]).toEqual([720, 1280]);
  });

  it('sans son ajouté : volume original à 100 % (comme à la lecture)', () => {
    const { composition } = buildPublishComposition({ ...input, soundUri: null });
    expect(composition.audio).toBeNull();
    expect(composition.originalVolume).toBe(1);
  });

  it('sans découpe : tout le fichier', () => {
    const { composition } = buildPublishComposition({ ...input, trim: null, speed: 1 });
    expect(composition.clips[0]).toMatchObject({ startMs: 0, endMs: null });
  });

  it('durée inconnue : débit du pire cas (3 min)', () => {
    const { composition, expectedDurationMs } = buildPublishComposition({
      ...input,
      trim: null,
      sourceDurationMs: null,
    });
    expect(expectedDurationMs).toBeNull();
    expect(composition.output.videoBitrate).toBe(videoBitrateFor(MAX_COMPOSED_DURATION_MS));
  });

  it('borne volumes et début du son', () => {
    const { composition } = buildPublishComposition({
      ...input,
      soundVolume: 3,
      originalVolume: -1,
      soundOffsetMs: -500,
      speed: 0,
    });
    expect(composition.audio).toMatchObject({ volume: 1, offsetMs: 0 });
    expect(composition.originalVolume).toBe(0);
    expect(composition.clips[0].speed).toBe(1);
  });

  it('est sérialisable en JSON (contrat du module natif)', () => {
    const { composition } = buildPublishComposition(input);
    expect(JSON.parse(JSON.stringify(composition))).toEqual(composition);
  });
});

describe('buildPublishComposition — montage (V1)', () => {
  const base = {
    sourceUri: 'file:///cache/a.mp4',
    sourceDurationMs: 10_000,
    trim: { startMs: 1_000, endMs: 2_000 },
    speed: 2,
    soundUri: null,
    soundOffsetMs: 0,
    soundVolume: 1,
    originalVolume: 0.5,
    outputPath: '/cache/out.mp4',
  };
  const clips = [
    { uri: 'file:///cache/a.mp4', startMs: 0, endMs: 6_000, speed: 2 },
    { uri: 'file:///cache/p.jpg', startMs: 0, endMs: 3_000, speed: 1, image: true, mimeType: 'image/jpeg' },
    { uri: 'file:///cache/b.mp4', startMs: 1_000, endMs: 3_000, speed: 0.5 },
  ];

  it('les clips remplacent la source ; durée = somme des clips', () => {
    const { composition, expectedDurationMs } = buildPublishComposition({ ...base, clips });
    expect(composition.clips).toEqual(clips);
    expect(expectedDurationMs).toBe(3_000 + 3_000 + 4_000);
    expect(composition.output.videoBitrate).toBe(videoBitrateFor(10_000));
  });

  it('cadre fixe dès qu’il y a plusieurs clips ou une photo', () => {
    expect(buildPublishComposition({ ...base, clips }).composition.output.fixedCanvas).toBe(true);
    expect(buildPublishComposition({ ...base, clips: [clips[1]] }).composition.output.fixedCanvas).toBe(true);
    // Un seul clip vidéo garde son format (comme P0).
    expect(buildPublishComposition({ ...base, clips: [clips[0]] }).composition.output.fixedCanvas).toBeUndefined();
    expect(buildPublishComposition(base).composition.output.fixedCanvas).toBeUndefined();
  });

  it('le volume original s’applique même sans son ajouté', () => {
    expect(buildPublishComposition({ ...base, clips }).composition.originalVolume).toBe(0.5);
    expect(buildPublishComposition(base).composition.originalVolume).toBe(1);
  });

  it('liste vide : repli sur la source unique', () => {
    const { composition } = buildPublishComposition({ ...base, clips: [] });
    expect(composition.clips).toEqual([{ uri: base.sourceUri, startMs: 1_000, endMs: 2_000, speed: 2 }]);
  });
});

describe('buildSegmentsComposition', () => {
  it('assemble les segments dans l’ordre, en qualité haute, sans son ajouté', () => {
    const c = buildSegmentsComposition([{ uri: 'file:///a.mp4' }, { uri: 'file:///b.mp4' }], '/cache/seg.mp4');
    expect(c.clips.map((x) => x.uri)).toEqual(['file:///a.mp4', 'file:///b.mp4']);
    expect(c.clips.every((x) => x.speed === 1 && x.startMs === 0 && x.endMs === null)).toBe(true);
    expect(c.audio).toBeNull();
    expect(c.output.videoBitrate).toBe(INTERMEDIATE_VIDEO_BITRATE);
  });
});

describe('overlaysForBakedSpeed', () => {
  const doc = (items: Overlay[]): OverlayDoc => ({ v: 1, aspect: 9 / 16, items });

  it('divise l’horaire par la vitesse', () => {
    const out = overlaysForBakedSpeed(doc([sticker('a', 2000, 6000), sticker('b', 1000, null)]), 2);
    expect(out?.items.map((o) => [o.startMs, o.endMs])).toEqual([
      [1000, 3000],
      [500, null],
    ]);
  });

  it('ralenti : l’horaire s’allonge', () => {
    const out = overlaysForBakedSpeed(doc([sticker('a', 1000, 2000)]), 0.5);
    expect(out?.items[0]).toMatchObject({ startMs: 2000, endMs: 4000 });
  });

  it('garde une fenêtre d’au moins 500 ms', () => {
    const out = overlaysForBakedSpeed(doc([sticker('a', 0, 600)]), 2);
    expect(out?.items[0]).toMatchObject({ startMs: 0, endMs: 500 });
  });

  it('1x ou document vide : inchangé', () => {
    const d = doc([sticker('a', 0, 1000)]);
    expect(overlaysForBakedSpeed(d, 1)).toBe(d);
    expect(overlaysForBakedSpeed(null, 2)).toBeNull();
  });
});

describe('divers', () => {
  it('plafond de la source relevé seulement avec l’export natif', () => {
    expect(maxVideoSourceBytes(false)).toBe(MAX_UPLOAD_BYTES);
    expect(maxVideoSourceBytes(true)).toBe(MAX_SOURCE_BYTES_WITH_COMPOSER);
    expect(MAX_SOURCE_BYTES_WITH_COMPOSER).toBeGreaterThan(MAX_UPLOAD_BYTES);
  });

  it('nom de sortie .mp4 unique', () => {
    const a = composerOutputName('nia-export', 1000);
    expect(a).toMatch(/^nia-export-[0-9a-z]+-[0-9a-z]+\.mp4$/);
  });
});
