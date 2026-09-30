/**
 * Éditeur V1 (Montage) — modèle de la timeline (lib/timeline).
 */
import {
  MAX_STILL_MS,
  MAX_TIMELINE_CLIPS,
  MIN_CLIP_MS,
  STILL_CLIP_MS,
  appendClips,
  applySourceDuration,
  clipDurationMs,
  clipStartsMs,
  dropIndexFor,
  duplicateClip,
  frameSourceAt,
  locate,
  makeImageClip,
  makeVideoClip,
  moveClip,
  normalizeClipSpeed,
  removeClip,
  sanitizeTimeline,
  setClipSpeed,
  setStillDuration,
  splitAt,
  timelineComposerClips,
  timelineDurationMs,
  timelineExceedsMax,
  timelineKey,
  trimClip,
  type TimelineClip,
} from '@/lib/timeline';

function video(id: string, durationMs: number, patch: Partial<TimelineClip> = {}): TimelineClip {
  const c = makeVideoClip({ uri: `file:///cache/${id}.mp4`, durationMs, mimeType: 'video/mp4' }, id);
  if (!c) throw new Error('clip');
  return { ...c, ...patch };
}

function photo(id: string, patch: Partial<TimelineClip> = {}): TimelineClip {
  const c = makeImageClip({ uri: `file:///cache/${id}.jpg`, mimeType: null, fileName: `${id}.jpg` }, id);
  if (!c) throw new Error('clip');
  return { ...c, ...patch };
}

const ids = (tl: readonly TimelineClip[]) => tl.map((c) => c.id);

describe('création des clips', () => {
  it('une vidéo couvre tout le fichier à 1x ; trop courte ou sans durée → null', () => {
    expect(video('a', 8000)).toMatchObject({ kind: 'video', startMs: 0, endMs: 8000, speed: 1, sourceDurationMs: 8000 });
    expect(makeVideoClip({ uri: 'file:///x.mp4', durationMs: 200 })).toBeNull();
    expect(makeVideoClip({ uri: 'file:///x.mp4', durationMs: null })).toBeNull();
  });

  it('une photo dure 3 s', () => {
    const p = photo('p');
    expect(p).toMatchObject({ kind: 'image', startMs: 0, endMs: STILL_CLIP_MS, speed: 1 });
    expect(clipDurationMs(p)).toBe(3000);
  });

  it('vitesses : la plus proche des cinq proposées', () => {
    expect(normalizeClipSpeed(0.3)).toBe(0.3);
    expect(normalizeClipSpeed(0.35)).toBe(0.3);
    expect(normalizeClipSpeed(1.4)).toBe(1.5);
    expect(normalizeClipSpeed(9)).toBe(2);
    expect(normalizeClipSpeed(-1)).toBe(1);
    expect(normalizeClipSpeed('vite')).toBe(1);
  });
});

describe('durées et positions', () => {
  const tl = [video('a', 6000, { speed: 2 }), photo('p'), video('b', 4000, { startMs: 1000, endMs: 4000, speed: 0.5 })];

  it('durée = somme des extraits divisés par leur vitesse', () => {
    expect(tl.map(clipDurationMs)).toEqual([3000, 3000, 6000]);
    expect(timelineDurationMs(tl)).toBe(12000);
    expect(clipStartsMs(tl)).toEqual([0, 3000, 6000]);
  });

  it('locate : une frontière appartient au clip qui commence', () => {
    expect(locate(tl, 0)).toMatchObject({ index: 0, offsetMs: 0, sourceMs: 0 });
    expect(locate(tl, 1500)).toMatchObject({ index: 0, offsetMs: 1500, sourceMs: 3000 });
    expect(locate(tl, 2999)?.index).toBe(0);
    expect(locate(tl, 3000)).toMatchObject({ index: 1, clipStartMs: 3000, offsetMs: 0 });
    // 0,5x : 2 s de timeline = 1 s de fichier, à partir de 1 s.
    expect(locate(tl, 8000)).toMatchObject({ index: 2, offsetMs: 2000, sourceMs: 2000 });
  });

  it('locate : au-delà de la fin → fin du dernier clip ; avant 0 → début', () => {
    expect(locate(tl, 99_000)).toMatchObject({ index: 2, offsetMs: 6000, sourceMs: 4000 });
    expect(locate(tl, -50)).toMatchObject({ index: 0, offsetMs: 0 });
    expect(locate([], 0)).toBeNull();
  });

  it('image à montrer : fichier et instant du fichier, ou la photo', () => {
    expect(frameSourceAt(tl, 1000)).toEqual({ uri: 'file:///cache/a.mp4', atMs: 2000, image: false });
    expect(frameSourceAt(tl, 4000)).toEqual({ uri: 'file:///cache/p.jpg', atMs: 1000, image: true });
  });

  it('limite des 3 min', () => {
    expect(timelineExceedsMax([video('a', 180_000)])).toBe(false);
    expect(timelineExceedsMax([video('a', 180_000), photo('p')])).toBe(true);
    // 0,5x double la durée.
    expect(timelineExceedsMax([video('a', 100_000, { speed: 0.5 })])).toBe(true);
  });
});

describe('splitAt', () => {
  it('coupe une vidéo à la tête de lecture ; le second morceau reçoit un nouvel id', () => {
    const tl = [video('a', 6000), video('b', 4000)];
    const { timeline, splitIndex } = splitAt(tl, 2500, 'a2');
    expect(splitIndex).toBe(0);
    expect(ids(timeline)).toEqual(['a', 'a2', 'b']);
    expect(timeline[0]).toMatchObject({ startMs: 0, endMs: 2500, uri: 'file:///cache/a.mp4' });
    expect(timeline[1]).toMatchObject({ startMs: 2500, endMs: 6000, uri: 'file:///cache/a.mp4' });
    expect(timelineDurationMs(timeline)).toBe(timelineDurationMs(tl));
  });

  it('tient compte de la vitesse et du début de l’extrait', () => {
    const tl = [video('a', 10_000, { startMs: 2000, endMs: 10_000, speed: 2 })];
    // 1 s de timeline à 2x = 2 s de fichier après le début (2 s) → 4 s.
    const { timeline } = splitAt(tl, 1000, 'n');
    expect(timeline.map((c) => [c.startMs, c.endMs, c.speed])).toEqual([
      [2000, 4000, 2],
      [4000, 10_000, 2],
    ]);
  });

  it('coupe le bon clip après une frontière', () => {
    const tl = [video('a', 3000), video('b', 4000)];
    const { timeline, splitIndex } = splitAt(tl, 5000, 'b2');
    expect(splitIndex).toBe(1);
    expect(timeline.slice(1).map((c) => [c.id, c.startMs, c.endMs])).toEqual([
      ['b', 0, 2000],
      ['b2', 2000, 4000],
    ]);
  });

  it('refuse un morceau plus court que le minimum (bords, frontière)', () => {
    const tl = [video('a', 3000), video('b', 4000)];
    expect(splitAt(tl, 0).splitIndex).toBeNull();
    expect(splitAt(tl, MIN_CLIP_MS - 1).splitIndex).toBeNull();
    expect(splitAt(tl, 3000).splitIndex).toBeNull(); // début de b
    expect(splitAt(tl, 2800).splitIndex).toBeNull(); // 200 ms avant la fin de a
    expect(splitAt(tl, 7000).splitIndex).toBeNull(); // fin
    expect(splitAt(tl, 2800).timeline).toBe(tl);
  });

  it('coupe une photo en deux photos dont la somme fait la durée d’origine', () => {
    const { timeline } = splitAt([photo('p')], 1000, 'p2');
    expect(timeline.map((c) => [c.id, c.kind, c.startMs, c.endMs])).toEqual([
      ['p', 'image', 0, 1000],
      ['p2', 'image', 0, 2000],
    ]);
  });

  it('refuse quand la timeline est pleine', () => {
    const full = Array.from({ length: MAX_TIMELINE_CLIPS }, (_, i) => video(`c${i}`, 2000));
    expect(splitAt(full, 1000).splitIndex).toBeNull();
  });
});

describe('trimClip / setStillDuration', () => {
  it('borne l’extrait au fichier', () => {
    const tl = [video('a', 6000)];
    expect(trimClip(tl, 'a', -500, 9000)[0]).toMatchObject({ startMs: 0, endMs: 6000 });
    expect(trimClip(tl, 'a', 1000, 4000)[0]).toMatchObject({ startMs: 1000, endMs: 4000 });
  });

  it('garde un extrait minimal quand les poignées se croisent', () => {
    const tl = [video('a', 6000)];
    const out = trimClip(tl, 'a', 3000, 3100)[0];
    expect(out.endMs - out.startMs).toBe(MIN_CLIP_MS);
    const end = trimClip(tl, 'a', 5900, 6000)[0];
    expect(end).toMatchObject({ startMs: 6000 - MIN_CLIP_MS, endMs: 6000 });
  });

  it('inchangé → même liste ; id inconnu → même liste', () => {
    const tl = [video('a', 6000)];
    expect(trimClip(tl, 'a', 0, 6000)).toBe(tl);
    expect(trimClip(tl, 'zz', 0, 1000)).toBe(tl);
  });

  it('photo : durée bornée entre 0,5 s et 10 s ; sans effet sur une vidéo', () => {
    const tl = [photo('p'), video('a', 6000)];
    expect(setStillDuration(tl, 'p', 5000)[0].endMs).toBe(5000);
    expect(setStillDuration(tl, 'p', 60_000)[0].endMs).toBe(MAX_STILL_MS);
    expect(setStillDuration(tl, 'p', 10)[0].endMs).toBe(500);
    expect(setStillDuration(tl, 'a', 1000)).toBe(tl);
  });
});

describe('réordonner, supprimer, dupliquer, vitesse', () => {
  const tl = [video('a', 2000), video('b', 2000), photo('c'), video('d', 2000)];

  it('moveClip déplace et borne les indices', () => {
    expect(ids(moveClip(tl, 0, 2))).toEqual(['b', 'c', 'a', 'd']);
    expect(ids(moveClip(tl, 3, 0))).toEqual(['d', 'a', 'b', 'c']);
    expect(ids(moveClip(tl, 1, 99))).toEqual(['a', 'c', 'd', 'b']);
    expect(moveClip(tl, 1, 1)).toBe(tl);
    expect(moveClip(tl, 9, 0)).toBe(tl);
    // La durée totale ne change pas.
    expect(timelineDurationMs(moveClip(tl, 0, 3))).toBe(timelineDurationMs(tl));
  });

  it('removeClip garde toujours le dernier clip', () => {
    expect(ids(removeClip(tl, 'b'))).toEqual(['a', 'c', 'd']);
    const one = [video('a', 2000)];
    expect(removeClip(one, 'a')).toBe(one);
    expect(removeClip(tl, 'zz')).toBe(tl);
  });

  it('duplicateClip insère une copie juste après, avec un nouvel id', () => {
    const out = duplicateClip(tl, 'b', 'b2');
    expect(ids(out)).toEqual(['a', 'b', 'b2', 'c', 'd']);
    expect(out[2]).toMatchObject({ uri: tl[1].uri, startMs: tl[1].startMs, endMs: tl[1].endMs });
    const full = Array.from({ length: MAX_TIMELINE_CLIPS }, (_, i) => video(`c${i}`, 2000));
    expect(duplicateClip(full, 'c0')).toBe(full);
  });

  it('setClipSpeed change la durée ; une photo reste à 1x', () => {
    const fast = setClipSpeed(tl, 'a', 2);
    expect(fast[0].speed).toBe(2);
    expect(clipDurationMs(fast[0])).toBe(1000);
    expect(setClipSpeed(tl, 'c', 2)).toBe(tl);
    expect(setClipSpeed(tl, 'a', 1)).toBe(tl);
    expect(clipDurationMs(setClipSpeed(tl, 'a', 0.3)[0])).toBe(6667);
  });

  it('appendClips s’arrête à la limite', () => {
    const many = Array.from({ length: MAX_TIMELINE_CLIPS + 5 }, (_, i) => video(`n${i}`, 1000));
    expect(appendClips(tl, many)).toHaveLength(MAX_TIMELINE_CLIPS);
    expect(appendClips(tl, [])).toBe(tl);
  });
});

describe('applySourceDuration', () => {
  it('borne les clips du fichier à sa durée réelle ; un clip entier suit la durée', () => {
    const tl = [video('a', 5000), video('a', 5000, { id: 'a2', startMs: 3000, endMs: 5000 }), video('b', 5000)];
    const fixed = applySourceDuration(tl, 'file:///cache/a.mp4', 4200);
    expect(fixed[0]).toMatchObject({ sourceDurationMs: 4200, startMs: 0, endMs: 4200 });
    expect(fixed[1]).toMatchObject({ startMs: 3000, endMs: 4200 });
    expect(fixed[2]).toBe(tl[2]);
    // Plus longue : le clip entier s'allonge.
    expect(applySourceDuration(tl, 'file:///cache/b.mp4', 5600)[2].endMs).toBe(5600);
    expect(applySourceDuration(tl, 'file:///cache/b.mp4', 5000)).toBe(tl);
    expect(applySourceDuration(tl, 'file:///cache/b.mp4', Number.NaN)).toBe(tl);
  });
});

describe('export, empreinte, relecture', () => {
  it('clips du compositeur : photos en image fixe avec leur type', () => {
    const tl = [video('a', 6000, { startMs: 1000, endMs: 5000, speed: 1.5 }), photo('p', { endMs: 2000 })];
    expect(timelineComposerClips(tl)).toEqual([
      { uri: 'file:///cache/a.mp4', startMs: 1000, endMs: 5000, speed: 1.5 },
      { uri: 'file:///cache/p.jpg', startMs: 0, endMs: 2000, speed: 1, image: true, mimeType: 'image/jpeg' },
    ]);
    const png = makeImageClip({ uri: 'content://media/42', mimeType: 'image/png' }, 'x')!;
    expect(timelineComposerClips([png])[0].mimeType).toBe('image/png');
  });

  it('l’empreinte change avec l’ordre, la découpe et la vitesse, pas avec l’id', () => {
    const tl = [video('a', 6000), photo('p')];
    const key = timelineKey(tl);
    expect(timelineKey(moveClip(tl, 0, 1))).not.toBe(key);
    expect(timelineKey(trimClip(tl, 'a', 1000, 6000))).not.toBe(key);
    expect(timelineKey(setClipSpeed(tl, 'a', 2))).not.toBe(key);
    expect(timelineKey(tl.map((c) => ({ ...c, id: `${c.id}x` })))).toBe(key);
  });

  it('sanitizeTimeline retire les clips mal formés et borne les valeurs', () => {
    const out = sanitizeTimeline([
      { id: 'a', kind: 'video', uri: 'file:///a.mp4', sourceDurationMs: 5000, startMs: -10, endMs: 9000, speed: 3 },
      { id: 'a', kind: 'video', uri: 'file:///b.mp4', sourceDurationMs: 5000, startMs: 0, endMs: 2000, speed: 1 },
      { id: 'x', kind: 'video', uri: 'file:///c.mp4', sourceDurationMs: 100 },
      { id: 'y', kind: 'gif', uri: 'file:///d.gif' },
      { id: 'p', kind: 'image', uri: 'file:///p.jpg', startMs: 0, endMs: 99_000 },
      null,
      'texte',
    ]);
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ id: 'a', startMs: 0, endMs: 5000, speed: 2 });
    expect(out[1].id).not.toBe('a');
    expect(out[2]).toMatchObject({ kind: 'image', endMs: MAX_STILL_MS, speed: 1 });
    expect(sanitizeTimeline('rien')).toEqual([]);
  });
});

describe('dropIndexFor (glisser-déposer)', () => {
  const widths = [100, 100, 100, 100];

  it('reste en place pour un petit déplacement', () => {
    expect(dropIndexFor(widths, 1, 20, 4)).toBe(1);
    expect(dropIndexFor(widths, 1, -20, 4)).toBe(1);
  });

  it('passe après ou avant les voisins franchis', () => {
    expect(dropIndexFor(widths, 0, 110, 4)).toBe(1);
    expect(dropIndexFor(widths, 0, 320, 4)).toBe(3);
    expect(dropIndexFor(widths, 3, -110, 4)).toBe(2);
    expect(dropIndexFor(widths, 3, -1000, 4)).toBe(0);
    expect(dropIndexFor(widths, 0, 5000, 4)).toBe(3);
  });

  it('largeurs différentes', () => {
    expect(dropIndexFor([50, 200, 50], 0, 120, 0)).toBe(0);
    expect(dropIndexFor([50, 200, 50], 0, 130, 0)).toBe(1);
    expect(dropIndexFor([50, 200, 50], 2, -130, 0)).toBe(1);
    expect(dropIndexFor([50, 200, 50], 2, -40, 0)).toBe(2);
  });
});
