/**
 * Brouillons locaux (S6) — lib/drafts.
 *
 * expo-file-system est remplacé par un système de fichiers en mémoire : on
 * vérifie ce qui est copié, réutilisé et effacé, sans appareil. AsyncStorage
 * est le double officiel (jest.setup.js).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DRAFT_KEY_PREFIX,
  deleteDraft,
  draftSignature,
  listDrafts,
  loadDraft,
  parseDraftRecord,
  saveDraft,
  type DraftInput,
} from '@/lib/drafts';
import { emptyOverlayDoc } from '@/lib/overlays';
import { DEFAULT_PUBLISH_OPTIONS } from '@/lib/publishOptions';

jest.mock('expo-file-system', () => {
  type MockNode = { dir: boolean; size: number };
  const nodes = new Map<string, MockNode>();
  const failCopy = new Set<string>();
  let copies = 0;
  const uriOf = (p: unknown) => (typeof p === 'string' ? p : (p as { uri: string }).uri);
  const join = (parts: unknown[]) =>
    parts
      .map(uriOf)
      .reduce((a, b) => `${a.replace(/\/+$/, '')}/${b.replace(/^\/+/, '')}`);

  class File {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = join(parts).replace(/\/+$/, '');
    }
    get exists() {
      const n = nodes.get(this.uri);
      return !!n && !n.dir;
    }
    get size() {
      return nodes.get(this.uri)?.size ?? 0;
    }
    get name() {
      return this.uri.split('/').pop() as string;
    }
    async copy(dest: { uri: string }) {
      if (!this.exists || failCopy.has(this.uri)) throw new Error('copy failed');
      copies += 1;
      nodes.set(dest.uri, { dir: false, size: this.size });
    }
    delete() {
      nodes.delete(this.uri);
    }
  }

  class Directory {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = join(parts).replace(/\/*$/, '/');
    }
    get exists() {
      return nodes.get(this.uri)?.dir === true;
    }
    get name() {
      return this.uri.replace(/\/$/, '').split('/').pop() as string;
    }
    create(opts?: { intermediates?: boolean }) {
      if (opts?.intermediates) {
        // Comme le natif : crée aussi les dossiers parents manquants.
        const parts = this.uri.replace(/\/$/, '').split('/');
        for (let i = 4; i < parts.length; i += 1) {
          nodes.set(`${parts.slice(0, i).join('/')}/`, { dir: true, size: 0 });
        }
      }
      nodes.set(this.uri, { dir: true, size: 0 });
    }
    delete() {
      for (const k of [...nodes.keys()]) if (k.startsWith(this.uri)) nodes.delete(k);
    }
    list() {
      const out: (File | Directory)[] = [];
      for (const [k, n] of nodes) {
        if (k === this.uri || !k.startsWith(this.uri)) continue;
        const rest = k.slice(this.uri.length).replace(/\/$/, '');
        if (rest.includes('/')) continue;
        out.push(n.dir ? new Directory(k) : new File(k));
      }
      return out;
    }
  }

  return {
    File,
    Directory,
    Paths: {
      get document() {
        return new Directory('file:///doc/');
      },
      get cache() {
        return new Directory('file:///cache/');
      },
    },
    __fs: {
      put: (uri: string, size = 100) => nodes.set(uri, { dir: false, size }),
      mkdir: (uri: string) => nodes.set(uri, { dir: true, size: 0 }),
      has: (uri: string) => nodes.has(uri),
      remove: (uri: string) => nodes.delete(uri),
      keys: () => [...nodes.keys()],
      failCopy: (uri: string) => failCopy.add(uri),
      copies: () => copies,
      reset: () => {
        nodes.clear();
        failCopy.clear();
        copies = 0;
      },
    },
  };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('expo-file-system').__fs as {
  put: (uri: string, size?: number) => void;
  mkdir: (uri: string) => void;
  has: (uri: string) => boolean;
  remove: (uri: string) => void;
  keys: () => string[];
  failCopy: (uri: string) => void;
  copies: () => number;
  reset: () => void;
};

const DIR = 'file:///doc/drafts/';

function input(overrides: Partial<DraftInput> = {}): DraftInput {
  return {
    mode: 'video',
    source: {
      uri: 'file:///cache/Camera/rec-1.mp4',
      mimeType: 'video/mp4',
      fileName: 'rec-1.mp4',
      fileSize: 5000,
      durationMs: 12000,
      type: 'video',
    },
    trimmed: null,
    trimRange: null,
    trimSelection: null,
    cover: null,
    thumbUri: null,
    speed: 1,
    sound: null,
    soundOffsetMs: 0,
    soundVolume: 1,
    originalVolume: 1,
    filterId: null,
    overlays: emptyOverlayDoc(),
    caption: '',
    category: null,
    publishOptions: DEFAULT_PUBLISH_OPTIONS,
    ...overrides,
  };
}

async function rawKeys(): Promise<string[]> {
  return (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(DRAFT_KEY_PREFIX));
}

beforeEach(async () => {
  fs.reset();
  await AsyncStorage.clear();
  fs.put('file:///cache/Camera/rec-1.mp4', 5000);
  fs.put('file:///cache/trim-1.mp4', 2000);
  fs.put('file:///cache/cover-1.jpg', 300);
  fs.put('file:///cache/thumb-1.jpg', 50);
});

describe('saveDraft', () => {
  it('copie les fichiers dans documents/drafts/<id>/ et écrit un JSON v:2 aux chemins relatifs', async () => {
    const rec = await saveDraft(
      input({
        trimmed: {
          uri: 'file:///cache/trim-1.mp4',
          mimeType: 'video/mp4',
          fileName: 'trim-1.mp4',
          fileSize: 2000,
          durationMs: 4000,
          type: 'video',
        },
        trimRange: { startMs: 1000, endMs: 5000 },
        trimSelection: { startMs: 1000, endMs: 5000 },
        cover: {
          uri: 'file:///cache/cover-1.jpg',
          mimeType: 'image/jpeg',
          fileName: null,
          fileSize: 300,
          durationMs: null,
          type: 'image',
        },
        thumbUri: 'file:///cache/thumb-1.jpg',
        caption: 'Coucher de soleil #dakar',
      }),
      { ownerId: 'u1', now: 1000 },
    );

    expect(rec.v).toBe(2);
    expect(rec.timeline).toBeNull();
    expect(rec.ownerId).toBe('u1');
    expect(rec.source.name).toMatch(/^source-[a-z0-9]+\.mp4$/);
    expect(rec.trimmed?.name).toMatch(/^trimmed-.+\.mp4$/);
    expect(rec.cover?.name).toMatch(/^cover-.+\.jpg$/);
    expect(rec.thumb?.name).toMatch(/^thumb-.+\.jpg$/);
    // Aucun chemin absolu dans ce qui est stocké.
    const stored = (await AsyncStorage.getItem(`${DRAFT_KEY_PREFIX}${rec.id}`)) as string;
    expect(JSON.parse(stored).source.name).not.toContain('/');
    expect(stored).not.toContain(DIR);
    // Les copies existent, les originaux sont intacts.
    expect(fs.has(`${DIR}${rec.id}/${rec.source.name}`)).toBe(true);
    expect(fs.has(`${DIR}${rec.id}/${rec.trimmed?.name}`)).toBe(true);
    expect(fs.has('file:///cache/Camera/rec-1.mp4')).toBe(true);
    expect(fs.copies()).toBe(4);
  });

  it('réenregistrer le même brouillon ne recopie pas le média et retire les fichiers remplacés', async () => {
    const first = await saveDraft(
      input({
        cover: {
          uri: 'file:///cache/cover-1.jpg',
          mimeType: 'image/jpeg',
          fileName: null,
          fileSize: 300,
          durationMs: null,
          type: 'image',
        },
      }),
      { ownerId: 'u1', now: 1000 },
    );
    const oldCover = `${DIR}${first.id}/${first.cover?.name}`;
    expect(fs.copies()).toBe(2);

    fs.put('file:///cache/cover-2.jpg', 400);
    const second = await saveDraft(
      input({
        caption: 'v2',
        cover: {
          uri: 'file:///cache/cover-2.jpg',
          mimeType: 'image/jpeg',
          fileName: null,
          fileSize: 400,
          durationMs: null,
          type: 'image',
        },
      }),
      { id: first.id, ownerId: 'u1', now: 2000 },
    );

    expect(second.id).toBe(first.id);
    expect(second.createdAt).toBe(1000);
    expect(second.updatedAt).toBe(2000);
    expect(second.source.name).toBe(first.source.name);
    expect(fs.copies()).toBe(3); // seule la nouvelle couverture
    expect(fs.has(oldCover)).toBe(false);
    expect(fs.has(`${DIR}${first.id}/${second.cover?.name}`)).toBe(true);
    expect(await rawKeys()).toHaveLength(1);
  });

  it('réutilise les fichiers d’un brouillon rouvert (URI déjà dans son dossier)', async () => {
    const rec = await saveDraft(input(), { ownerId: null, now: 1000 });
    const loaded = await loadDraft(rec.id);
    const before = fs.copies();
    await saveDraft(input({ source: loaded!.source, caption: 'rouvert' }), {
      id: rec.id,
      ownerId: null,
      now: 3000,
    });
    expect(fs.copies()).toBe(before);
  });

  it('un échec de copie du média ne laisse ni clé ni dossier', async () => {
    fs.failCopy('file:///cache/Camera/rec-1.mp4');
    await expect(saveDraft(input(), { ownerId: 'u1' })).rejects.toThrow();
    expect(await rawKeys()).toHaveLength(0);
    expect(fs.keys().filter((k) => k.startsWith(DIR) && k !== DIR)).toEqual([]);
  });

  it('refuse un média source disparu', async () => {
    fs.remove('file:///cache/Camera/rec-1.mp4');
    await expect(saveDraft(input(), { ownerId: 'u1' })).rejects.toThrow('draft_source_missing');
  });
});

describe('listDrafts / loadDraft', () => {
  it('liste les brouillons du propriétaire, du plus récent au plus ancien', async () => {
    const a = await saveDraft(input({ caption: 'a' }), { ownerId: 'u1', now: 1000 });
    const b = await saveDraft(input({ caption: 'b' }), { ownerId: 'u1', now: 5000 });
    await saveDraft(input({ caption: 'autre compte' }), { ownerId: 'u2', now: 9000 });

    const list = await listDrafts('u1');
    expect(list.map((d) => d.id)).toEqual([b.id, a.id]);
    expect(list[0]).toMatchObject({ caption: 'b', mediaType: 'video', durationMs: 12000 });
    expect(await listDrafts('u2')).toHaveLength(1);
    expect(await listDrafts(null)).toHaveLength(0);
  });

  it('relit exactement les réglages enregistrés', async () => {
    const overlays = {
      ...emptyOverlayDoc(0.5625),
      items: [
        {
          id: 'o1',
          type: 'sticker' as const,
          emoji: '🔥',
          x: 0.3,
          y: 0.6,
          size: 0.16,
          rotation: 15,
          startMs: 0,
          endMs: null,
        },
      ],
    };
    const sound = {
      id: 's1',
      userId: 'u9',
      title: 'Afrobeat',
      storagePath: 'u9/s1.mp3',
      publicUrl: 'https://example.test/s1.mp3',
      durationMs: 30000,
      useCount: 3,
      createdAt: '2026-09-01T00:00:00Z',
      handle: '@dj',
    };
    const publishOptions = {
      ...DEFAULT_PUBLISH_OPTIONS,
      visibility: 'followers' as const,
      allowComments: false,
      altText: 'Une plage',
    };
    const rec = await saveDraft(
      input({
        speed: 1.5,
        sound,
        soundOffsetMs: 4200,
        soundVolume: 0.8,
        originalVolume: 0.3,
        filterId: 'warm',
        overlays,
        caption: 'Légende #nia',
        category: 'music',
        publishOptions,
        trimSelection: { startMs: 500, endMs: 9000 },
      }),
      { ownerId: 'u1', now: 1000 },
    );

    const loaded = await loadDraft(rec.id);
    expect(loaded).not.toBeNull();
    const r = loaded!.record;
    expect(r).toMatchObject({
      speed: 1.5,
      sound,
      soundOffsetMs: 4200,
      soundVolume: 0.8,
      originalVolume: 0.3,
      filterId: 'warm',
      caption: 'Légende #nia',
      category: 'music',
      publishOptions,
      trimSelection: { startMs: 500, endMs: 9000 },
    });
    expect(r.overlays.items).toEqual(overlays.items);
    expect(loaded!.source.uri).toBe(`${DIR}${rec.id}/${rec.source.name}`);
    expect(loaded!.source).toMatchObject({ type: 'video', durationMs: 12000, mimeType: 'video/mp4' });
  });

  it('loadDraft renvoie null pour un id inconnu', async () => {
    expect(await loadDraft('inconnu')).toBeNull();
  });
});

describe('deleteDraft', () => {
  it('supprime la clé et tous les fichiers copiés', async () => {
    const rec = await saveDraft(
      input({ thumbUri: 'file:///cache/thumb-1.jpg' }),
      { ownerId: 'u1', now: 1000 },
    );
    expect(fs.keys().some((k) => k.startsWith(`${DIR}${rec.id}/`))).toBe(true);

    await deleteDraft(rec.id);

    expect(await rawKeys()).toHaveLength(0);
    expect(fs.keys().some((k) => k.startsWith(`${DIR}${rec.id}/`))).toBe(false);
    expect(await listDrafts('u1')).toHaveLength(0);
    // L'original du cache n'est jamais touché.
    expect(fs.has('file:///cache/Camera/rec-1.mp4')).toBe(true);
  });
});

describe('entrées corrompues', () => {
  it('retire un JSON illisible, une forme invalide ou une version inconnue', async () => {
    const good = await saveDraft(input(), { ownerId: 'u1', now: 1000 });
    fs.mkdir(`${DIR}broken/`);
    fs.put(`${DIR}broken/source-x.mp4`);
    await AsyncStorage.setItem(`${DRAFT_KEY_PREFIX}broken`, '{pas du json');
    await AsyncStorage.setItem(`${DRAFT_KEY_PREFIX}noshape`, JSON.stringify({ v: 1, id: 'noshape' }));
    await AsyncStorage.setItem(
      `${DRAFT_KEY_PREFIX}v0`,
      JSON.stringify({ v: 0, id: 'v0', mode: 'video', source: { name: 'a.mp4', type: 'video' } }),
    );

    const list = await listDrafts('u1');

    expect(list.map((d) => d.id)).toEqual([good.id]);
    expect(await rawKeys()).toEqual([`${DRAFT_KEY_PREFIX}${good.id}`]);
    expect(fs.has(`${DIR}broken/source-x.mp4`)).toBe(false);
  });

  it('retire un brouillon dont le média a disparu', async () => {
    const rec = await saveDraft(input(), { ownerId: 'u1', now: 1000 });
    fs.remove(`${DIR}${rec.id}/${rec.source.name}`);

    expect(await loadDraft(rec.id)).toBeNull();
    expect(await rawKeys()).toHaveLength(0);
    expect(fs.has(`${DIR}${rec.id}/`)).toBe(false);
  });

  it('garde le brouillon si seule la couverture ou la découpe manque', async () => {
    const rec = await saveDraft(
      input({
        trimmed: {
          uri: 'file:///cache/trim-1.mp4',
          mimeType: 'video/mp4',
          fileName: 'trim-1.mp4',
          fileSize: 2000,
          durationMs: 4000,
          type: 'video',
        },
        trimRange: { startMs: 1000, endMs: 5000 },
        cover: {
          uri: 'file:///cache/cover-1.jpg',
          mimeType: 'image/jpeg',
          fileName: null,
          fileSize: 300,
          durationMs: null,
          type: 'image',
        },
      }),
      { ownerId: 'u1', now: 1000 },
    );
    fs.remove(`${DIR}${rec.id}/${rec.cover?.name}`);
    fs.remove(`${DIR}${rec.id}/${rec.trimmed?.name}`);

    const loaded = await loadDraft(rec.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.cover).toBeNull();
    expect(loaded!.trimmed).toBeNull();
    expect(loaded!.record.trimRange).toBeNull();
    // La sélection est conservée : la découpe sera refaite à « Suivant ».
    expect(loaded!.record.trimSelection).toEqual({ startMs: 1000, endMs: 5000 });
  });

  it('ne supprime pas un brouillon d’un format plus récent, sans le lister', async () => {
    await AsyncStorage.setItem(`${DRAFT_KEY_PREFIX}future`, JSON.stringify({ v: 3, id: 'future' }));
    expect(await listDrafts(null)).toHaveLength(0);
    expect(await rawKeys()).toEqual([`${DRAFT_KEY_PREFIX}future`]);
  });

  it('supprime les dossiers orphelins (sans clé)', async () => {
    const rec = await saveDraft(input(), { ownerId: 'u1', now: 1000 });
    fs.mkdir(`${DIR}orphan/`);
    fs.put(`${DIR}orphan/source-z.mp4`);

    await listDrafts('u1');

    expect(fs.has(`${DIR}orphan/source-z.mp4`)).toBe(false);
    expect(fs.has(`${DIR}${rec.id}/${rec.source.name}`)).toBe(true);
  });
});

describe('parseDraftRecord / draftSignature', () => {
  it('rejette une entrée dont l’id ne correspond pas à sa clé', () => {
    const raw = JSON.stringify({ v: 1, id: 'a', mode: 'video', source: { name: 's.mp4', type: 'video' } });
    expect(parseDraftRecord(raw, 'a').ok).toBe(true);
    expect(parseDraftRecord(raw, 'b').ok).toBe(false);
  });

  it('rejette un nom de fichier qui sortirait du dossier du brouillon', () => {
    const raw = JSON.stringify({ v: 1, id: 'a', mode: 'video', source: { name: '../x.mp4', type: 'video' } });
    expect(parseDraftRecord(raw, 'a').ok).toBe(false);
  });

  it('normalise les valeurs hors bornes', () => {
    const raw = JSON.stringify({
      v: 1,
      id: 'a',
      mode: 'photo',
      source: { name: 's.jpg', type: 'image' },
      soundVolume: 7,
      originalVolume: -1,
      speed: 'vite',
      publishOptions: { visibility: 'tout-le-monde', allowComments: false },
    });
    const res = parseDraftRecord(raw, 'a');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.record.soundVolume).toBe(1);
    expect(res.record.originalVolume).toBe(0);
    expect(res.record.speed).toBe(1);
    expect(res.record.publishOptions).toEqual({ ...DEFAULT_PUBLISH_OPTIONS, allowComments: false });
  });

  it('l’empreinte change avec un réglage, pas avec la miniature ni le cadre des calques', () => {
    const base = input();
    const sig = draftSignature(base);
    expect(draftSignature({ ...base, caption: 'x' })).not.toBe(sig);
    expect(draftSignature({ ...base, speed: 2 })).not.toBe(sig);
    expect(draftSignature({ ...base, thumbUri: 'file:///cache/other.jpg' })).toBe(sig);
    expect(draftSignature({ ...base, overlays: emptyOverlayDoc(1) })).toBe(sig);
  });
});

describe('format v2 (montage)', () => {
  const photo = {
    uri: 'file:///cache/photo-1.jpg',
    mimeType: 'image/jpeg',
    fileName: 'photo-1.jpg',
    fileSize: 800,
    durationMs: null,
    type: 'image' as const,
  };
  const clip2 = {
    uri: 'file:///cache/clip-2.mp4',
    mimeType: 'video/mp4',
    fileName: 'clip-2.mp4',
    fileSize: 3000,
    durationMs: 8000,
    type: 'video' as const,
  };
  function montage(): DraftInput {
    const base = input();
    return input({
      timeline: [
        { id: 'a', kind: 'video', media: base.source, sourceDurationMs: 12000, startMs: 0, endMs: 4000, speed: 1 },
        // Deuxième moitié du même fichier (découpage) : pas de nouvelle copie.
        { id: 'b', kind: 'video', media: base.source, sourceDurationMs: 12000, startMs: 4000, endMs: 12000, speed: 2 },
        { id: 'c', kind: 'image', media: photo, sourceDurationMs: 0, startMs: 0, endMs: 3000, speed: 1 },
        { id: 'd', kind: 'video', media: clip2, sourceDurationMs: 8000, startMs: 1000, endMs: 5000, speed: 0.5 },
      ],
    });
  }

  beforeEach(() => {
    fs.put('file:///cache/photo-1.jpg', 800);
    fs.put('file:///cache/clip-2.mp4', 3000);
  });

  it('enregistre la timeline, copie chaque fichier une seule fois et la relit', async () => {
    const rec = await saveDraft(montage(), { ownerId: 'u1', now: 1000 });
    expect(rec.v).toBe(2);
    expect(rec.timeline?.map((c) => c.id)).toEqual(['a', 'b', 'c', 'd']);
    // source + photo + clip-2 (les clips a et b partagent la source).
    expect(fs.copies()).toBe(3);
    expect(rec.timeline?.[0].file.name).toBe(rec.source.name);
    expect(rec.timeline?.[1].file.name).toBe(rec.source.name);
    expect(rec.timeline?.[2].file.name).toMatch(/^clip-.+\.jpg$/);
    expect(rec.timeline?.[3].file.name).toMatch(/^clip-.+\.mp4$/);

    const loaded = await loadDraft(rec.id);
    expect(loaded?.timeline?.map((c) => [c.id, c.kind, c.startMs, c.endMs, c.speed])).toEqual([
      ['a', 'video', 0, 4000, 1],
      ['b', 'video', 4000, 12000, 2],
      ['c', 'image', 0, 3000, 1],
      ['d', 'video', 1000, 5000, 0.5],
    ]);
    expect(loaded?.timeline?.[2].media.uri).toBe(`${DIR}${rec.id}/${rec.timeline?.[2].file.name}`);

    // Durée listée = durée du montage : 4 s + 8 s / 2 + 3 s + 4 s / 0,5.
    const [summary] = await listDrafts('u1');
    expect(summary.durationMs).toBe(4000 + 4000 + 3000 + 8000);
    expect(summary.mediaType).toBe('video');
  });

  it('réenregistrer ne recopie pas les clips et retire ceux supprimés', async () => {
    const rec = await saveDraft(montage(), { ownerId: 'u1', now: 1000 });
    const photoFile = `${DIR}${rec.id}/${rec.timeline?.[2].file.name}`;
    const before = fs.copies();
    const next = montage();
    next.timeline = next.timeline!.filter((c) => c.id !== 'c');
    const second = await saveDraft(next, { id: rec.id, ownerId: 'u1', now: 2000 });
    expect(fs.copies()).toBe(before);
    expect(second.timeline?.map((c) => c.id)).toEqual(['a', 'b', 'd']);
    expect(fs.has(photoFile)).toBe(false);
  });

  it('un clip dont le fichier a disparu est oublié, le reste du montage demeure', async () => {
    const rec = await saveDraft(montage(), { ownerId: 'u1', now: 1000 });
    fs.remove(`${DIR}${rec.id}/${rec.timeline?.[3].file.name}`);
    const loaded = await loadDraft(rec.id);
    expect(loaded?.timeline?.map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('refuse d’enregistrer un clip dont l’original a disparu', async () => {
    fs.remove('file:///cache/clip-2.mp4');
    await expect(saveDraft(montage(), { ownerId: 'u1' })).rejects.toThrow('draft_clip_missing');
    expect(await rawKeys()).toHaveLength(0);
  });

  it('l’empreinte change avec la timeline', () => {
    const base = montage();
    const sig = draftSignature(base);
    const moved = { ...base, timeline: [...base.timeline!].reverse() };
    expect(draftSignature(moved)).not.toBe(sig);
    const faster = { ...base, timeline: base.timeline!.map((c) => (c.id === 'a' ? { ...c, speed: 1.5 } : c)) };
    expect(draftSignature(faster)).not.toBe(sig);
    expect(draftSignature({ ...base, timeline: null })).not.toBe(sig);
  });

  it('migre un brouillon v1 vidéo en un clip (sélection de découpe et vitesse)', () => {
    const raw = JSON.stringify({
      v: 1,
      id: 'old',
      mode: 'video',
      source: { name: 'source-a.mp4', type: 'video', durationMs: 20000 },
      trimSelection: { startMs: 2000, endMs: 9000 },
      speed: 1.5,
      caption: 'ancien',
    });
    const res = parseDraftRecord(raw, 'old');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.record.v).toBe(2);
    expect(res.record.caption).toBe('ancien');
    expect(res.record.timeline).toEqual([
      {
        id: 'v1clip',
        kind: 'video',
        file: expect.objectContaining({ name: 'source-a.mp4' }),
        sourceDurationMs: 20000,
        startMs: 2000,
        endMs: 9000,
        speed: 1.5,
      },
    ]);
  });

  it('migre un v1 sans découpe (vidéo entière) et laisse une photo sans timeline', () => {
    const video = parseDraftRecord(
      JSON.stringify({ v: 1, id: 'a', mode: 'video', source: { name: 's.mp4', type: 'video', durationMs: 6000 } }),
      'a',
    );
    expect(video.ok && video.record.timeline?.[0]).toMatchObject({ startMs: 0, endMs: 6000, speed: 1 });
    const unknown = parseDraftRecord(
      JSON.stringify({ v: 1, id: 'a', mode: 'video', source: { name: 's.mp4', type: 'video' } }),
      'a',
    );
    expect(unknown.ok && unknown.record.timeline).toBeNull();
    const photo = parseDraftRecord(
      JSON.stringify({ v: 1, id: 'a', mode: 'photo', source: { name: 's.jpg', type: 'image' } }),
      'a',
    );
    expect(photo.ok && photo.record.timeline).toBeNull();
  });

  it('un brouillon v1 enregistré avant la mise à jour se relit et se liste', async () => {
    fs.mkdir(`${DIR}legacy/`);
    fs.put(`${DIR}legacy/source-l.mp4`, 5000);
    await AsyncStorage.setItem(
      `${DRAFT_KEY_PREFIX}legacy`,
      JSON.stringify({
        v: 1,
        id: 'legacy',
        ownerId: 'u1',
        createdAt: 1,
        updatedAt: 2,
        mode: 'video',
        source: { name: 'source-l.mp4', type: 'video', durationMs: 10000 },
        trimSelection: { startMs: 0, endMs: 4000 },
      }),
    );
    const loaded = await loadDraft('legacy');
    expect(loaded?.timeline).toHaveLength(1);
    expect(loaded?.timeline?.[0].media.uri).toBe(`${DIR}legacy/source-l.mp4`);
    const [summary] = await listDrafts('u1');
    expect(summary.durationMs).toBe(4000);
  });

  it('ignore les clips invalides d’une timeline v2 (id en double, bornes, vitesse)', () => {
    const raw = JSON.stringify({
      v: 2,
      id: 'a',
      mode: 'video',
      source: { name: 's.mp4', type: 'video', durationMs: 6000 },
      timeline: [
        { id: 'x', kind: 'video', file: { name: 's.mp4', type: 'video' }, sourceDurationMs: 6000, startMs: 0, endMs: 3000, speed: 7 },
        { id: 'x', kind: 'video', file: { name: 's.mp4', type: 'video' }, sourceDurationMs: 6000, startMs: 0, endMs: 3000, speed: 1 },
        { id: 'y', kind: 'video', file: { name: 's.mp4', type: 'video' }, sourceDurationMs: 6000, startMs: 4000, endMs: 3000, speed: 1 },
        { id: 'z', kind: 'image', file: { name: '../p.jpg', type: 'image' }, startMs: 0, endMs: 3000, speed: 1 },
        { id: 'p', kind: 'image', file: { name: 'p.jpg', type: 'image' }, startMs: 0, endMs: 3000, speed: 2 },
      ],
    });
    const res = parseDraftRecord(raw, 'a');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.record.timeline?.map((c) => [c.id, c.speed])).toEqual([
      ['x', 1],
      ['p', 1],
    ]);
  });
});
