/**
 * Sons NIA — sons uploadés / originaux uniquement (pas de catalogue commercial).
 */
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';
import type { ProfileRow, SoundRow } from '@/types/database';

export const SOUND_PROFILE_SELECT =
  '*, profiles!sounds_user_id_fkey(username, avatar_url, display_name)';

export type SoundWithProfile = SoundRow & {
  profiles: Pick<ProfileRow, 'username' | 'avatar_url' | 'display_name'> | null;
};

export type SoundItem = {
  id: string;
  userId: string;
  title: string;
  storagePath: string;
  publicUrl: string;
  durationMs: number | null;
  useCount: number;
  createdAt: string;
  handle: string;
  avatarUrl?: string;
};

const AUDIO_EXT_TO_MIME: Record<string, string> = {
  mp3: 'audio/mpeg',
  mpeg: 'audio/mpeg',
  mp4: 'audio/mp4',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
};

const AUDIO_MIME_TO_EXT: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
};

function stripMimeParams(mime: string): string {
  return mime.split(';')[0].trim().toLowerCase();
}

function extFromName(name: string): string | null {
  const m = name.match(/\.([a-zA-Z0-9]+)(?:\?|#|$)/);
  return m ? m[1].toLowerCase() : null;
}

export function resolveAudioContentType(input: {
  mimeType?: string | null;
  localUri: string;
  fileName?: string | null;
}): { contentType: string; ext: string } {
  let mime: string | null = null;
  if (input.mimeType) {
    const cleaned = stripMimeParams(input.mimeType);
    if (cleaned.startsWith('audio/') && cleaned !== 'audio/octet-stream') {
      mime = cleaned === 'audio/mp3' ? 'audio/mpeg' : cleaned;
    }
  }
  if (!mime) {
    const fromFile = input.fileName ? extFromName(input.fileName) : null;
    const fromUri = extFromName(input.localUri);
    const ext = fromFile || fromUri;
    if (ext && AUDIO_EXT_TO_MIME[ext]) mime = AUDIO_EXT_TO_MIME[ext];
  }
  if (!mime) mime = 'audio/mpeg';
  const ext = AUDIO_MIME_TO_EXT[mime] || 'mp3';
  return { contentType: mime, ext };
}

export function mapSoundRow(
  row: SoundWithProfile,
  publicUrl: string,
): SoundItem {
  const username = row.profiles?.username || 'createur';
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    storagePath: row.storage_path,
    publicUrl,
    durationMs: row.duration_ms,
    useCount: row.use_count ?? 0,
    createdAt: row.created_at,
    handle: `@${username}`,
    avatarUrl: row.profiles?.avatar_url || undefined,
  };
}

function publicUrlForPath(storagePath: string): string {
  const sb = getSupabase();
  if (!sb) return '';
  const { data } = sb.storage.from('videos').getPublicUrl(storagePath);
  return data.publicUrl;
}

export async function fetchSoundById(id: string): Promise<SoundItem | null> {
  const sb = getSupabase();
  if (!sb || !id) return null;

  const { data, error } = await sb
    .from('sounds')
    .select(SOUND_PROFILE_SELECT)
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  const row = data as unknown as SoundWithProfile;
  return mapSoundRow(row, publicUrlForPath(row.storage_path));
}

export async function listSoundsByUser(
  userId: string,
  options?: { limit?: number },
): Promise<SoundItem[]> {
  const sb = getSupabase();
  if (!sb || !userId) return [];

  const { data, error } = await sb
    .from('sounds')
    .select(SOUND_PROFILE_SELECT)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(options?.limit ?? 50);

  if (error) throw error;
  const rows = (data || []) as unknown as SoundWithProfile[];
  return rows.map((row) => mapSoundRow(row, publicUrlForPath(row.storage_path)));
}

export type CreateSoundInput = {
  userId: string;
  title: string;
  localUri: string;
  mimeType?: string | null;
  fileName?: string | null;
  durationMs?: number | null;
};

export async function createSound(input: CreateSoundInput): Promise<SoundItem> {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase non configuré');

  const { data: sessionData } = await sb.auth.getSession();
  const sessionUserId = sessionData.session?.user?.id;
  if (!sessionUserId) {
    throw new Error('Session expirée. Reconnectez-vous pour ajouter un son.');
  }
  if (input.userId && input.userId !== sessionUserId) {
    throw new Error('Identifiant créateur incohérent avec la session.');
  }
  const creatorId = sessionUserId;

  const title = (input.title || '').trim() || 'Son original';
  const { contentType, ext } = resolveAudioContentType({
    mimeType: input.mimeType,
    localUri: input.localUri,
    fileName: input.fileName,
  });

  const path = `${creatorId}/sounds/${Date.now()}.${ext}`;
  const response = await fetch(input.localUri);
  if (!response.ok) {
    throw new Error(`Impossible de lire le fichier audio (${response.status})`);
  }
  const arrayBuffer = await response.arrayBuffer();

  const { error: upErr } = await sb.storage.from('videos').upload(path, arrayBuffer, {
    contentType,
    upsert: false,
  });
  if (upErr) throw upErr;

  const insertPayload = {
    user_id: creatorId,
    title,
    storage_path: path,
    duration_ms:
      typeof input.durationMs === 'number' && Number.isFinite(input.durationMs)
        ? Math.max(0, Math.round(input.durationMs))
        : null,
  };

  const { data: inserted, error: insErr } = await sb
    .from('sounds')
    .insert(insertPayload as never)
    .select(SOUND_PROFILE_SELECT)
    .single();

  if (insErr) throw insErr;
  const row = inserted as unknown as SoundWithProfile;
  return mapSoundRow(row, publicUrlForPath(row.storage_path));
}

/** Bump use_count (+1). Soft-fails if migration missing. */
export async function incrementSoundUseCount(soundId: string): Promise<void> {
  const sb = getSupabase();
  if (!sb || !soundId) return;

  const { data: row } = await sb
    .from('sounds')
    .select('use_count')
    .eq('id', soundId)
    .maybeSingle();

  if (!row) return;
  const next = (row.use_count ?? 0) + 1;
  await sb.from('sounds').update({ use_count: next } as never).eq('id', soundId);
}

/** Attach sound_id on a video row (owner publish path). */
export async function attachSoundToVideo(
  videoId: string,
  soundId: string,
): Promise<void> {
  const sb = getSupabase();
  if (!sb || !videoId || !soundId) return;

  const { error } = await sb
    .from('videos')
    .update({ sound_id: soundId } as never)
    .eq('id', videoId);

  if (error) {
    // Soft: column missing if 008 not applied
    if (
      error.message?.includes('sound_id') ||
      error.code === 'PGRST204' ||
      error.code === '42703'
    ) {
      return;
    }
    throw error;
  }
  await incrementSoundUseCount(soundId);
}

export { isSupabaseConfigured };
