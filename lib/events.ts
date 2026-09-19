/**
 * Événements NIA — CRUD + liste + participation (going / interested).
 */
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';
import type { EventCategoryId } from '@/constants/eventCategories';
import { isEventCategoryId } from '@/constants/eventCategories';
import type { EventRow, ProfileRow } from '@/types/database';

export type EventAttendeeStatus = 'going' | 'interested';

export type EventListFilter = 'upcoming' | 'weekend' | 'popular';

export type EventWithOrganizer = EventRow & {
  profiles: Pick<ProfileRow, 'username' | 'avatar_url' | 'display_name'> | null;
  event_attendees?: { count: number }[] | null;
};

export type EventItem = {
  id: string;
  title: string;
  description: string | null;
  coverPath: string | null;
  coverUrl: string | null;
  locationText: string | null;
  city: string | null;
  country: string | null;
  startsAt: string;
  endsAt: string | null;
  category: EventCategoryId;
  createdBy: string;
  createdAt: string;
  organizerHandle: string;
  organizerAvatarUrl?: string;
  attendeeCount: number;
  myStatus: EventAttendeeStatus | null;
};

export const EVENT_PROFILE_SELECT =
  '*, profiles!events_created_by_fkey(username, avatar_url, display_name), event_attendees(count)';

function publicUrlForPath(storagePath: string | null | undefined): string | null {
  if (!storagePath) return null;
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = sb.storage.from('videos').getPublicUrl(storagePath);
  return data.publicUrl || null;
}

function mapEventRow(
  row: EventWithOrganizer,
  myStatus: EventAttendeeStatus | null = null,
): EventItem {
  const username = row.profiles?.username || 'createur';
  const countRaw = row.event_attendees?.[0]?.count;
  const attendeeCount =
    typeof countRaw === 'number' && Number.isFinite(countRaw) ? countRaw : 0;
  const category: EventCategoryId = isEventCategoryId(row.category)
    ? row.category
    : 'other';

  return {
    id: row.id,
    title: row.title,
    description: row.description,
    coverPath: row.cover_path,
    coverUrl: publicUrlForPath(row.cover_path),
    locationText: row.location_text,
    city: row.city,
    country: row.country,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    category,
    createdBy: row.created_by,
    createdAt: row.created_at,
    organizerHandle: `@${username}`,
    organizerAvatarUrl: row.profiles?.avatar_url || undefined,
    attendeeCount,
    myStatus,
  };
}

/** Local Saturday 00:00 → Monday 00:00 for "this weekend". */
export function getWeekendRange(now = new Date()): { start: Date; end: Date } {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const toSat = day === 0 ? -1 : day === 6 ? 0 : 6 - day;
  const start = new Date(d);
  start.setDate(d.getDate() + toSat);
  const end = new Date(start);
  end.setDate(start.getDate() + 2);
  return { start, end };
}

export async function listEvents(options?: {
  filter?: EventListFilter;
  category?: EventCategoryId | null;
  limit?: number;
  userId?: string | null;
}): Promise<EventItem[]> {
  const sb = getSupabase();
  if (!sb) return [];

  const filter = options?.filter ?? 'upcoming';
  const limit = options?.limit ?? 50;
  const nowIso = new Date().toISOString();

  let q = sb.from('events').select(EVENT_PROFILE_SELECT);

  if (options?.category) {
    q = q.eq('category', options.category);
  }

  if (filter === 'upcoming' || filter === 'popular') {
    q = q.gte('starts_at', nowIso);
  }

  if (filter === 'weekend') {
    const { start, end } = getWeekendRange();
    q = q
      .gte('starts_at', start.toISOString())
      .lt('starts_at', end.toISOString());
  }

  q = q.order('starts_at', { ascending: true }).limit(limit);

  const { data, error } = await q;
  if (error) {
    if (
      error.message?.includes('events') ||
      error.code === 'PGRST205' ||
      error.code === '42P01'
    ) {
      return [];
    }
    throw error;
  }

  const rows = (data || []) as unknown as EventWithOrganizer[];
  let items = rows.map((row) => mapEventRow(row, null));

  if (filter === 'popular') {
    items = [...items].sort((a, b) => b.attendeeCount - a.attendeeCount);
  }

  if (options?.userId) {
    const statuses = await fetchMyAttendanceMap(
      options.userId,
      items.map((e) => e.id),
    );
    items = items.map((e) => ({
      ...e,
      myStatus: statuses.get(e.id) ?? null,
    }));
  }

  return items;
}

export async function fetchEventById(
  id: string,
  userId?: string | null,
): Promise<EventItem | null> {
  const sb = getSupabase();
  if (!sb || !id) return null;

  const { data, error } = await sb
    .from('events')
    .select(EVENT_PROFILE_SELECT)
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const row = data as unknown as EventWithOrganizer;
  let myStatus: EventAttendeeStatus | null = null;
  if (userId) {
    myStatus = await fetchMyAttendance(userId, id);
  }
  return mapEventRow(row, myStatus);
}

async function fetchMyAttendance(
  userId: string,
  eventId: string,
): Promise<EventAttendeeStatus | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb
    .from('event_attendees')
    .select('status')
    .eq('user_id', userId)
    .eq('event_id', eventId)
    .maybeSingle();
  const status = (data as { status?: string } | null)?.status;
  return status === 'going' || status === 'interested' ? status : null;
}

async function fetchMyAttendanceMap(
  userId: string,
  eventIds: string[],
): Promise<Map<string, EventAttendeeStatus>> {
  const map = new Map<string, EventAttendeeStatus>();
  const sb = getSupabase();
  if (!sb || !userId || eventIds.length === 0) return map;

  const { data } = await sb
    .from('event_attendees')
    .select('event_id, status')
    .eq('user_id', userId)
    .in('event_id', eventIds);

  for (const row of data || []) {
    const r = row as { event_id: string; status: string };
    if (r.status === 'going' || r.status === 'interested') {
      map.set(r.event_id, r.status);
    }
  }
  return map;
}

export type CreateEventInput = {
  userId: string;
  title: string;
  description?: string | null;
  locationText?: string | null;
  city?: string | null;
  country?: string | null;
  startsAt: string;
  endsAt?: string | null;
  category: EventCategoryId;
  coverLocalUri?: string | null;
  coverMimeType?: string | null;
  coverFileName?: string | null;
};

function resolveImageContentType(input: {
  mimeType?: string | null;
  localUri: string;
  fileName?: string | null;
}): { contentType: string; ext: string } {
  const raw = input.mimeType?.split(';')[0]?.trim().toLowerCase() || '';
  if (raw === 'image/png') return { contentType: 'image/png', ext: 'png' };
  if (raw === 'image/webp') return { contentType: 'image/webp', ext: 'webp' };
  if (raw === 'image/jpeg' || raw === 'image/jpg') {
    return { contentType: 'image/jpeg', ext: 'jpg' };
  }
  const name = `${input.fileName || ''} ${input.localUri || ''}`.toLowerCase();
  if (name.includes('.png')) return { contentType: 'image/png', ext: 'png' };
  if (name.includes('.webp')) return { contentType: 'image/webp', ext: 'webp' };
  return { contentType: 'image/jpeg', ext: 'jpg' };
}

export async function createEvent(input: CreateEventInput): Promise<EventItem> {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase non configuré');

  const { data: sessionData } = await sb.auth.getSession();
  const sessionUserId = sessionData.session?.user?.id;
  if (!sessionUserId) {
    throw new Error('Session expirée. Reconnectez-vous pour créer un événement.');
  }
  if (input.userId && input.userId !== sessionUserId) {
    throw new Error('Identifiant organisateur incohérent avec la session.');
  }
  const creatorId = sessionUserId;

  const title = (input.title || '').trim();
  if (!title) throw new Error('Titre requis');
  if (!isEventCategoryId(input.category)) throw new Error('Catégorie invalide');

  let coverPath: string | null = null;
  if (input.coverLocalUri) {
    const { contentType, ext } = resolveImageContentType({
      mimeType: input.coverMimeType,
      localUri: input.coverLocalUri,
      fileName: input.coverFileName,
    });
    const path = `${creatorId}/events/${Date.now()}.${ext}`;
    const response = await fetch(input.coverLocalUri);
    if (!response.ok) {
      throw new Error(`Impossible de lire l'image (${response.status})`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const { error: upErr } = await sb.storage.from('videos').upload(path, arrayBuffer, {
      contentType,
      upsert: false,
    });
    if (upErr) throw upErr;
    coverPath = path;
  }

  const insertPayload = {
    title,
    description: (input.description || '').trim() || null,
    cover_path: coverPath,
    location_text: (input.locationText || '').trim() || null,
    city: (input.city || '').trim() || null,
    country: (input.country || '').trim() || null,
    starts_at: input.startsAt,
    ends_at: input.endsAt || null,
    category: input.category,
    created_by: creatorId,
  };

  const { data: inserted, error: insErr } = await sb
    .from('events')
    .insert(insertPayload as never)
    .select(EVENT_PROFILE_SELECT)
    .single();

  if (insErr) throw insErr;
  return mapEventRow(inserted as unknown as EventWithOrganizer, null);
}

/**
 * Toggle « going ». Returns the new status (null if removed).
 */
export async function toggleGoing(
  userId: string,
  eventId: string,
  currentlyGoing: boolean,
): Promise<EventAttendeeStatus | null> {
  const sb = getSupabase();
  if (!sb || !isSupabaseConfigured) {
    return currentlyGoing ? null : 'going';
  }
  if (!userId || userId.startsWith('mock_')) {
    return currentlyGoing ? null : 'going';
  }

  if (currentlyGoing) {
    const { error } = await sb
      .from('event_attendees')
      .delete()
      .eq('user_id', userId)
      .eq('event_id', eventId);
    if (error) throw error;
    return null;
  }

  const { error } = await sb.from('event_attendees').upsert(
    {
      event_id: eventId,
      user_id: userId,
      status: 'going',
    } as never,
    { onConflict: 'event_id,user_id' },
  );
  if (error) throw error;
  return 'going';
}

export async function setAttendance(
  userId: string,
  eventId: string,
  status: EventAttendeeStatus | null,
): Promise<EventAttendeeStatus | null> {
  const sb = getSupabase();
  if (!sb) return status;

  if (!status) {
    const { error } = await sb
      .from('event_attendees')
      .delete()
      .eq('user_id', userId)
      .eq('event_id', eventId);
    if (error) throw error;
    return null;
  }

  const { error } = await sb.from('event_attendees').upsert(
    {
      event_id: eventId,
      user_id: userId,
      status,
    } as never,
    { onConflict: 'event_id,user_id' },
  );
  if (error) throw error;
  return status;
}

export { isSupabaseConfigured };
