/**
 * Brouillons locaux (sprint S6) — uniquement sur le téléphone.
 *
 * Aucune donnée ne quitte l'appareil : ni table, ni Storage, ni appel réseau.
 *
 * Stockage :
 * - les fichiers (média source, découpe, couverture, miniature) sont COPIÉS
 *   dans `Paths.document/drafts/<id>/` : le cache de l'app peut être vidé par
 *   le système, le dossier documents non ;
 * - la description du brouillon (réglages, légende, options) est un JSON
 *   versionné (`v: 1`) sous la clé AsyncStorage `nia.drafts.item.<id>`. Les
 *   clés sont retrouvées par préfixe (getAllKeys) : pas d'index à tenir à jour,
 *   donc pas d'index désynchronisé.
 *
 * Les chemins de fichiers sont enregistrés RELATIFS au dossier du brouillon :
 * sur iOS, le chemin absolu du conteneur de l'app change à chaque mise à jour.
 *
 * Tolérance : une entrée illisible (JSON cassé, forme inattendue, fichier
 * média disparu) est retirée proprement — clé et dossier — au lieu de faire
 * échouer la liste. Une couverture, une miniature ou une découpe manquante ne
 * coûte que ce fichier : le brouillon reste ouvrable.
 */
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths } from 'expo-file-system';
import type { SoundItem } from '@/lib/sounds';
import { sanitizeOverlayDoc, type OverlayDoc } from '@/lib/overlays';
import { DEFAULT_PUBLISH_OPTIONS, type PublishOptions } from '@/lib/publishOptions';

export const DRAFT_VERSION = 1 as const;
export const DRAFT_KEY_PREFIX = 'nia.drafts.item.';
export const DRAFTS_DIR_NAME = 'drafts';

export type DraftMediaType = 'image' | 'video' | 'unknown';

/** Même forme que PickedMedia (CreateContext), URI absolue. */
export type DraftMedia = {
  uri: string;
  mimeType: string | null;
  fileName: string | null;
  fileSize: number | null;
  durationMs: number | null;
  type: DraftMediaType;
};

export type DraftRange = { startMs: number; endMs: number };

/** Fichier enregistré dans le dossier du brouillon. */
export type DraftFileRef = Omit<DraftMedia, 'uri'> & {
  /** Nom du fichier dans `drafts/<id>/` (jamais un chemin absolu). */
  name: string;
  /** URI d'où la copie a été faite : évite de recopier au réenregistrement. */
  origin: string | null;
};

type FileRole = 'source' | 'trimmed' | 'cover' | 'thumb';

/** Ce que l'éditeur confie au stockage. */
export type DraftInput = {
  mode: 'video' | 'photo';
  source: DraftMedia;
  /** Fichier découpé, s'il a été produit (null : pas de découpe appliquée). */
  trimmed: DraftMedia | null;
  trimRange: DraftRange | null;
  /** Sélection de découpe en cours à l'édition (pas encore appliquée). */
  trimSelection: DraftRange | null;
  cover: DraftMedia | null;
  /** Miniature JPEG pour la liste (facultative). */
  thumbUri?: string | null;
  speed: number;
  sound: SoundItem | null;
  soundOffsetMs: number;
  soundVolume: number;
  originalVolume: number;
  filterId: string | null;
  overlays: OverlayDoc;
  caption: string;
  category: string | null;
  publishOptions: PublishOptions;
};

/** Format stocké (v1). */
export type DraftRecordV1 = {
  v: typeof DRAFT_VERSION;
  id: string;
  ownerId: string | null;
  createdAt: number;
  updatedAt: number;
  mode: 'video' | 'photo';
  source: DraftFileRef;
  trimmed: DraftFileRef | null;
  trimRange: DraftRange | null;
  trimSelection: DraftRange | null;
  cover: DraftFileRef | null;
  thumb: DraftFileRef | null;
  speed: number;
  sound: SoundItem | null;
  soundOffsetMs: number;
  soundVolume: number;
  originalVolume: number;
  filterId: string | null;
  overlays: OverlayDoc;
  caption: string;
  category: string | null;
  publishOptions: PublishOptions;
};

/** Brouillon relu, fichiers vérifiés et résolus en URI absolues. */
export type LoadedDraft = {
  record: DraftRecordV1;
  source: DraftMedia;
  trimmed: DraftMedia | null;
  cover: DraftMedia | null;
  thumbUri: string | null;
};

/** Ligne de la liste des brouillons. */
export type DraftSummary = {
  id: string;
  updatedAt: number;
  createdAt: number;
  mode: 'video' | 'photo';
  mediaType: DraftMediaType;
  caption: string;
  /** Durée publiée (découpe appliquée ou sélection), en ms ; null pour une photo. */
  durationMs: number | null;
  /** Image à afficher : couverture, miniature, ou la photo elle-même. */
  thumbUri: string | null;
};

// ---------------------------------------------------------------------------
// Disponibilité, identifiants, chemins

/** Le web n'a pas de système de fichiers persistant utilisable ici. */
export function isDraftStorageAvailable(): boolean {
  return Platform.OS !== 'web';
}

export function makeDraftId(): string {
  return `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

const ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const NAME_RE = /^[a-zA-Z0-9._-]{1,128}$/;

function draftKey(id: string): string {
  return `${DRAFT_KEY_PREFIX}${id}`;
}

function rootDir(): Directory {
  return new Directory(Paths.document, DRAFTS_DIR_NAME);
}

function draftDir(id: string): Directory {
  return new Directory(Paths.document, DRAFTS_DIR_NAME, id);
}

function withSlash(uri: string): string {
  return uri.endsWith('/') ? uri : `${uri}/`;
}

/** URI absolue d'un fichier du brouillon. */
export function draftFileUri(id: string, name: string): string {
  return new File(draftDir(id), name).uri;
}

function fileExists(uri: string): boolean {
  try {
    return new File(uri).exists;
  } catch {
    return false;
  }
}

function safeDeleteDir(id: string): void {
  if (!ID_RE.test(id)) return;
  try {
    const dir = draftDir(id);
    if (dir.exists) dir.delete();
  } catch {
    // dossier déjà parti ou verrouillé : rien de plus à faire
  }
}

function extensionFor(media: DraftMedia, role: FileRole): string {
  const candidates = [media.fileName, media.uri.split('?')[0]];
  for (const c of candidates) {
    const m = c ? /\.([a-zA-Z0-9]{1,5})$/.exec(c) : null;
    if (m) return `.${m[1].toLowerCase()}`;
  }
  if (role === 'cover' || role === 'thumb' || media.type === 'image') return '.jpg';
  return '.mp4';
}

// ---------------------------------------------------------------------------
// Sérialisation / validation

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const numOrNull = (v: unknown): number | null => (finite(v) ? v : null);
const clamp01 = (v: unknown, fallback: number) =>
  finite(v) ? Math.max(0, Math.min(1, v)) : fallback;

function parseRange(v: unknown): DraftRange | null {
  if (!isObj(v) || !finite(v.startMs) || !finite(v.endMs)) return null;
  if (v.startMs < 0 || v.endMs <= v.startMs) return null;
  return { startMs: Math.round(v.startMs), endMs: Math.round(v.endMs) };
}

function parseMediaType(v: unknown): DraftMediaType | null {
  return v === 'image' || v === 'video' || v === 'unknown' ? v : null;
}

function parseFileRef(v: unknown): DraftFileRef | null {
  if (!isObj(v) || typeof v.name !== 'string' || !NAME_RE.test(v.name)) return null;
  const type = parseMediaType(v.type);
  if (!type) return null;
  return {
    name: v.name,
    origin: strOrNull(v.origin),
    mimeType: strOrNull(v.mimeType),
    fileName: strOrNull(v.fileName),
    fileSize: numOrNull(v.fileSize),
    durationMs: numOrNull(v.durationMs),
    type,
  };
}

function parseSound(v: unknown): SoundItem | null {
  if (!isObj(v) || typeof v.id !== 'string' || typeof v.publicUrl !== 'string') return null;
  return {
    id: v.id,
    userId: typeof v.userId === 'string' ? v.userId : '',
    title: typeof v.title === 'string' ? v.title : '',
    storagePath: typeof v.storagePath === 'string' ? v.storagePath : '',
    publicUrl: v.publicUrl,
    durationMs: numOrNull(v.durationMs),
    useCount: finite(v.useCount) ? v.useCount : 0,
    createdAt: typeof v.createdAt === 'string' ? v.createdAt : '',
    handle: typeof v.handle === 'string' ? v.handle : '',
    ...(typeof v.avatarUrl === 'string' ? { avatarUrl: v.avatarUrl } : {}),
  };
}

function parsePublishOptions(v: unknown): PublishOptions {
  const r = isObj(v) ? v : {};
  const d = DEFAULT_PUBLISH_OPTIONS;
  const vis = r.visibility;
  return {
    visibility: vis === 'public' || vis === 'followers' || vis === 'private' ? vis : d.visibility,
    allowComments: typeof r.allowComments === 'boolean' ? r.allowComments : d.allowComments,
    allowReuse: typeof r.allowReuse === 'boolean' ? r.allowReuse : d.allowReuse,
    aiGenerated: typeof r.aiGenerated === 'boolean' ? r.aiGenerated : d.aiGenerated,
    altText: typeof r.altText === 'string' ? r.altText : d.altText,
    locationText: typeof r.locationText === 'string' ? r.locationText : d.locationText,
  };
}

export type ParseResult =
  | { ok: true; record: DraftRecordV1 }
  /** Format plus récent que cette version de l'app : on n'y touche pas. */
  | { ok: false; reason: 'future' }
  | { ok: false; reason: 'corrupt' };

/** Valide un JSON brut de brouillon. Pure : aucun accès disque. */
export function parseDraftRecord(raw: string | null | undefined, expectedId?: string): ParseResult {
  if (typeof raw !== 'string' || !raw) return { ok: false, reason: 'corrupt' };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'corrupt' };
  }
  if (!isObj(data)) return { ok: false, reason: 'corrupt' };
  if (finite(data.v) && data.v > DRAFT_VERSION) return { ok: false, reason: 'future' };
  if (data.v !== DRAFT_VERSION) return { ok: false, reason: 'corrupt' };
  if (typeof data.id !== 'string' || !ID_RE.test(data.id)) return { ok: false, reason: 'corrupt' };
  if (expectedId && data.id !== expectedId) return { ok: false, reason: 'corrupt' };
  const source = parseFileRef(data.source);
  if (!source) return { ok: false, reason: 'corrupt' };
  const mode = data.mode === 'photo' ? 'photo' : data.mode === 'video' ? 'video' : null;
  if (!mode) return { ok: false, reason: 'corrupt' };
  const createdAt = finite(data.createdAt) ? data.createdAt : 0;
  const updatedAt = finite(data.updatedAt) ? data.updatedAt : createdAt;
  const trimmed = parseFileRef(data.trimmed);
  const trimRange = parseRange(data.trimRange);
  return {
    ok: true,
    record: {
      v: DRAFT_VERSION,
      id: data.id,
      ownerId: strOrNull(data.ownerId),
      createdAt,
      updatedAt,
      mode,
      source,
      // Une découpe sans son intervalle (ou l'inverse) n'est pas exploitable.
      trimmed: trimmed && trimRange ? trimmed : null,
      trimRange: trimmed && trimRange ? trimRange : null,
      trimSelection: parseRange(data.trimSelection),
      cover: parseFileRef(data.cover),
      thumb: parseFileRef(data.thumb),
      speed: finite(data.speed) && data.speed > 0 ? data.speed : 1,
      sound: parseSound(data.sound),
      soundOffsetMs: finite(data.soundOffsetMs) && data.soundOffsetMs > 0 ? Math.round(data.soundOffsetMs) : 0,
      soundVolume: clamp01(data.soundVolume, 1),
      originalVolume: clamp01(data.originalVolume, 1),
      filterId: strOrNull(data.filterId),
      overlays: sanitizeOverlayDoc(data.overlays),
      caption: typeof data.caption === 'string' ? data.caption : '',
      category: strOrNull(data.category),
      publishOptions: parsePublishOptions(data.publishOptions),
    },
  };
}

/**
 * Empreinte des réglages qui comptent pour l'utilisateur : sert à savoir s'il
 * reste des modifications non enregistrées. Le format du cadre des calques
 * (mesuré, pas choisi) et la miniature n'en font pas partie.
 */
export function draftSignature(input: DraftInput): string {
  return JSON.stringify([
    input.mode,
    input.source.uri,
    input.trimmed?.uri ?? null,
    input.trimRange,
    input.trimSelection,
    input.cover?.uri ?? null,
    input.speed,
    input.sound?.id ?? null,
    input.sound ? input.soundOffsetMs : 0,
    input.soundVolume,
    input.originalVolume,
    input.filterId,
    input.overlays.items,
    input.caption,
    input.category,
    input.publishOptions,
  ]);
}

// ---------------------------------------------------------------------------
// File d'attente : les opérations d'écriture ne se chevauchent pas.

let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

// ---------------------------------------------------------------------------
// Lecture

async function readAllRaw(): Promise<{ id: string; raw: string | null }[]> {
  let keys: readonly string[] = [];
  try {
    keys = await AsyncStorage.getAllKeys();
  } catch {
    return [];
  }
  const ours = keys.filter((k) => k.startsWith(DRAFT_KEY_PREFIX));
  if (!ours.length) return [];
  const pairs = await AsyncStorage.multiGet(ours);
  return pairs.map(([k, v]) => ({ id: k.slice(DRAFT_KEY_PREFIX.length), raw: v }));
}

async function dropDraft(id: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(draftKey(id));
  } catch {
    // la clé reviendra au prochain passage : elle sera retirée à nouveau
  }
  safeDeleteDir(id);
}

function resolveRef(id: string, ref: DraftFileRef | null): DraftMedia | null {
  if (!ref) return null;
  const uri = draftFileUri(id, ref.name);
  if (!fileExists(uri)) return null;
  const { name: _n, origin: _o, ...rest } = ref;
  return { ...rest, uri };
}

/**
 * Vérifie les fichiers d'un enregistrement valide. null si le média source a
 * disparu ; les fichiers secondaires manquants sont simplement oubliés.
 */
function resolveRecord(record: DraftRecordV1): LoadedDraft | null {
  const source = resolveRef(record.id, record.source);
  if (!source) return null;
  const trimmed = resolveRef(record.id, record.trimmed);
  const cover = resolveRef(record.id, record.cover);
  const thumb = resolveRef(record.id, record.thumb);
  const fixed: DraftRecordV1 = {
    ...record,
    trimmed: trimmed ? record.trimmed : null,
    trimRange: trimmed ? record.trimRange : null,
    // Découpe perdue : la sélection reste, elle sera réappliquée à « Suivant ».
    trimSelection: trimmed ? record.trimSelection : record.trimSelection ?? record.trimRange,
    cover: cover ? record.cover : null,
    thumb: thumb ? record.thumb : null,
  };
  return { record: fixed, source, trimmed, cover, thumbUri: thumb?.uri ?? null };
}

function summarize(d: LoadedDraft): DraftSummary {
  const r = d.record;
  const isVideo = d.source.type === 'video';
  const durationMs = !isVideo
    ? null
    : d.trimmed?.durationMs ??
      (r.trimSelection ? r.trimSelection.endMs - r.trimSelection.startMs : d.source.durationMs);
  return {
    id: r.id,
    updatedAt: r.updatedAt,
    createdAt: r.createdAt,
    mode: r.mode,
    mediaType: d.source.type,
    caption: r.caption,
    durationMs,
    thumbUri: d.cover?.uri ?? d.thumbUri ?? (isVideo ? null : d.source.uri),
  };
}

/** Identifiants en cours d'enregistrement : leur dossier n'est pas orphelin. */
const savingIds = new Set<string>();

/** Supprime les dossiers de brouillon qu'aucune clé ne référence. */
function pruneOrphanDirs(knownIds: Set<string>): void {
  try {
    const root = rootDir();
    if (!root.exists) return;
    for (const entry of root.list()) {
      if (!(entry instanceof Directory)) continue;
      const id = entry.name;
      if (!ID_RE.test(id) || knownIds.has(id) || savingIds.has(id)) continue;
      try {
        entry.delete();
      } catch {
        // on réessaiera au prochain passage
      }
    }
  } catch {
    // liste impossible : rien de grave, ce n'est que du ménage
  }
}

/**
 * Brouillons de `ownerId` (null : sans compte), du plus récent au plus ancien.
 * Retire au passage les entrées illisibles et les dossiers orphelins.
 */
export function listDrafts(ownerId: string | null): Promise<DraftSummary[]> {
  if (!isDraftStorageAvailable()) return Promise.resolve([]);
  return serialized(async () => {
    const all = await readAllRaw();
    const keep = new Set<string>();
    const out: DraftSummary[] = [];
    for (const { id, raw } of all) {
      const parsed = parseDraftRecord(raw, id);
      if (!parsed.ok) {
        if (parsed.reason === 'future') keep.add(id);
        else await dropDraft(id);
        continue;
      }
      const loaded = resolveRecord(parsed.record);
      if (!loaded) {
        await dropDraft(id);
        continue;
      }
      keep.add(id);
      if ((loaded.record.ownerId ?? null) === (ownerId ?? null)) out.push(summarize(loaded));
    }
    pruneOrphanDirs(keep);
    out.sort((a, b) => b.updatedAt - a.updatedAt);
    return out;
  });
}

export async function countDrafts(ownerId: string | null): Promise<number> {
  return (await listDrafts(ownerId)).length;
}

/**
 * Relit un brouillon pour le rouvrir. null s'il est introuvable, illisible ou
 * si son média a disparu — dans ces deux derniers cas il est retiré.
 */
export function loadDraft(id: string): Promise<LoadedDraft | null> {
  if (!isDraftStorageAvailable() || !ID_RE.test(id)) return Promise.resolve(null);
  return serialized(async () => {
    let raw: string | null = null;
    try {
      raw = await AsyncStorage.getItem(draftKey(id));
    } catch {
      return null;
    }
    if (raw == null) {
      safeDeleteDir(id);
      return null;
    }
    const parsed = parseDraftRecord(raw, id);
    if (!parsed.ok) {
      if (parsed.reason === 'corrupt') await dropDraft(id);
      return null;
    }
    const loaded = resolveRecord(parsed.record);
    if (!loaded) {
      await dropDraft(id);
      return null;
    }
    return loaded;
  });
}

/** Supprime un brouillon et tous ses fichiers copiés. */
export function deleteDraft(id: string): Promise<void> {
  if (!isDraftStorageAvailable() || !ID_RE.test(id)) return Promise.resolve();
  return serialized(() => dropDraft(id));
}

// ---------------------------------------------------------------------------
// Écriture

async function readRecord(id: string): Promise<DraftRecordV1 | null> {
  try {
    const parsed = parseDraftRecord(await AsyncStorage.getItem(draftKey(id)), id);
    return parsed.ok ? parsed.record : null;
  } catch {
    return null;
  }
}

/**
 * Place un fichier dans le dossier du brouillon. Réutilise la copie existante
 * si le fichier y est déjà (brouillon rouvert) ou s'il a déjà été copié depuis
 * la même URI (réenregistrement) : un média de 50 Mo n'est copié qu'une fois.
 */
async function placeFile(
  dir: Directory,
  id: string,
  role: FileRole,
  media: DraftMedia,
  previous: DraftFileRef | null,
  stamp: string,
): Promise<DraftFileRef> {
  const meta = {
    mimeType: media.mimeType,
    fileName: media.fileName,
    fileSize: media.fileSize,
    durationMs: media.durationMs,
    type: media.type,
  };
  const prefix = withSlash(dir.uri);
  if (media.uri.startsWith(prefix)) {
    const name = media.uri.slice(prefix.length);
    if (NAME_RE.test(name) && fileExists(media.uri)) {
      return { ...meta, name, origin: previous?.name === name ? previous.origin : null };
    }
  }
  if (
    previous &&
    previous.origin === media.uri &&
    fileExists(draftFileUri(id, previous.name))
  ) {
    return { ...meta, name: previous.name, origin: previous.origin };
  }
  const src = new File(media.uri);
  if (!src.exists) throw new Error(`draft_${role}_missing`);
  const name = `${role}-${stamp}${extensionFor(media, role)}`;
  const dest = new File(dir, name);
  await src.copy(dest);
  let size = media.fileSize;
  try {
    size = dest.size ?? size;
  } catch {
    // taille illisible : on garde celle connue
  }
  return { ...meta, fileSize: size, name, origin: media.uri };
}

/** Retire les fichiers du dossier que l'enregistrement ne référence plus. */
function collectGarbage(dir: Directory, record: DraftRecordV1): void {
  const used = new Set(
    [record.source, record.trimmed, record.cover, record.thumb]
      .filter((r): r is DraftFileRef => !!r)
      .map((r) => r.name),
  );
  try {
    for (const entry of dir.list()) {
      if (entry instanceof File && !used.has(entry.name)) {
        try {
          entry.delete();
        } catch {
          // fichier verrouillé : il partira au prochain enregistrement
        }
      }
    }
  } catch {
    // ménage impossible : sans conséquence
  }
}

export type SaveDraftOptions = {
  /** Brouillon à mettre à jour ; absent ou null : nouveau brouillon. */
  id?: string | null;
  ownerId: string | null;
  now?: number;
};

/**
 * Enregistre (ou met à jour) un brouillon. Les fichiers sont copiés AVANT
 * d'écrire la description, et les anciens ne sont supprimés qu'APRÈS : une
 * coupure en plein enregistrement laisse l'ancienne version intacte.
 */
export function saveDraft(input: DraftInput, opts: SaveDraftOptions): Promise<DraftRecordV1> {
  if (!isDraftStorageAvailable()) return Promise.reject(new Error('drafts_unavailable'));
  return serialized(async () => {
    const id = opts.id && ID_RE.test(opts.id) ? opts.id : makeDraftId();
    const now = opts.now ?? Date.now();
    const previous = opts.id ? await readRecord(id) : null;
    const dir = draftDir(id);
    const isNewDir = !dir.exists;
    savingIds.add(id);
    try {
      dir.create({ intermediates: true, idempotent: true });
      const stamp = now.toString(36);
      const source = await placeFile(dir, id, 'source', input.source, previous?.source ?? null, stamp);
      const optional = async (role: FileRole, media: DraftMedia | null, prev: DraftFileRef | null) => {
        if (!media?.uri) return null;
        try {
          return await placeFile(dir, id, role, media, prev, stamp);
        } catch (e) {
          // Sans découpe, le brouillon serait faux (autre durée) : on échoue.
          if (role === 'trimmed') throw e;
          return null;
        }
      };
      const trimmed = input.trimRange
        ? await optional('trimmed', input.trimmed, previous?.trimmed ?? null)
        : null;
      const cover = await optional('cover', input.cover, previous?.cover ?? null);
      const thumbMedia: DraftMedia | null = input.thumbUri
        ? {
            uri: input.thumbUri,
            mimeType: 'image/jpeg',
            fileName: null,
            fileSize: null,
            durationMs: null,
            type: 'image',
          }
        : null;
      const thumb = await optional('thumb', thumbMedia, previous?.thumb ?? null);

      const record: DraftRecordV1 = {
        v: DRAFT_VERSION,
        id,
        ownerId: opts.ownerId ?? null,
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
        mode: input.mode,
        source,
        trimmed: trimmed && input.trimRange ? trimmed : null,
        trimRange: trimmed && input.trimRange ? input.trimRange : null,
        trimSelection: input.trimSelection,
        cover,
        thumb,
        speed: input.speed,
        sound: input.sound,
        soundOffsetMs: input.soundOffsetMs,
        soundVolume: input.soundVolume,
        originalVolume: input.originalVolume,
        filterId: input.filterId,
        overlays: input.overlays,
        caption: input.caption,
        category: input.category,
        publishOptions: input.publishOptions,
      };
      await AsyncStorage.setItem(draftKey(id), JSON.stringify(record));
      collectGarbage(dir, record);
      return record;
    } catch (e) {
      // Nouveau brouillon raté : ne rien laisser derrière. Un brouillon
      // existant garde ses fichiers (sa description n'a pas été réécrite).
      if (isNewDir) safeDeleteDir(id);
      throw e;
    } finally {
      savingIds.delete(id);
    }
  });
}
