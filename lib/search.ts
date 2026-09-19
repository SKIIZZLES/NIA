/**
 * Recherche unifiée NIA V2.4 — text match simple (ilike / contains), pas de ranking.
 * Personnes · Publications · Sons · Événements · Hashtags.
 */
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';
import { DEMO_VIDEOS, type VideoItem } from '@/data/mockVideos';
import { parseHashtags } from '@/constants/publish';
import {
  mapRowToVideoItem,
  VIDEO_PROFILE_SELECT_NO_SOUND,
} from '@/lib/videos';
import { mapSoundRow, SOUND_PROFILE_SELECT, type SoundItem, type SoundWithProfile } from '@/lib/sounds';
import type { EventItem, EventWithOrganizer } from '@/lib/events';
import { EVENT_PROFILE_SELECT } from '@/lib/events';
import type { ProfileRow, VideoRow } from '@/types/database';

export type SearchTab =
  | 'all'
  | 'people'
  | 'publications'
  | 'sounds'
  | 'events'
  | 'hashtags';

export const SEARCH_TABS: SearchTab[] = [
  'all',
  'people',
  'publications',
  'sounds',
  'events',
  'hashtags',
];

export type SearchPerson = {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string;
  bio: string;
};

export type SearchHashtag = {
  tag: string;
};

export type UnifiedSearchResults = {
  people: SearchPerson[];
  publications: VideoItem[];
  sounds: SoundItem[];
  events: EventItem[];
  hashtags: SearchHashtag[];
};

const EMPTY: UnifiedSearchResults = {
  people: [],
  publications: [],
  sounds: [],
  events: [],
  hashtags: [],
};

const DEFAULT_LIMIT = 20;

type VideoWithProfile = VideoRow & {
  profiles: Pick<ProfileRow, 'username' | 'avatar_url' | 'display_name'> | null;
};

function normalizeQuery(raw: string): string {
  return raw.trim().replace(/^#+/, '').trim();
}

function escapeIlike(value: string): string {
  return value.replace(/[%_\\]/g, '\\$&');
}

function wants(
  tab: SearchTab | undefined,
  section: Exclude<SearchTab, 'all'>,
): boolean {
  return !tab || tab === 'all' || tab === section;
}

function publicUrlForPath(storagePath: string): string {
  const sb = getSupabase();
  if (!sb) return '';
  const { data } = sb.storage.from('videos').getPublicUrl(storagePath);
  return data.publicUrl;
}

function mapEventSearchRow(row: EventWithOrganizer): EventItem {
  const username = row.profiles?.username || 'createur';
  const countRaw = row.event_attendees?.[0]?.count;
  const attendeeCount =
    typeof countRaw === 'number' && Number.isFinite(countRaw) ? countRaw : 0;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    coverPath: row.cover_path,
    coverUrl: row.cover_path ? publicUrlForPath(row.cover_path) : null,
    locationText: row.location_text,
    city: row.city,
    country: row.country,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    category: (row.category as EventItem['category']) || 'other',
    createdBy: row.created_by,
    createdAt: row.created_at,
    organizerHandle: `@${username}`,
    organizerAvatarUrl: row.profiles?.avatar_url || undefined,
    attendeeCount,
    myStatus: null,
  };
}

function mockSearch(q: string, limit: number): UnifiedSearchResults {
  const lower = q.toLowerCase();
  const tagNeedle = lower.replace(/^#/, '');

  const publications = DEMO_VIDEOS.filter((v) => {
    const hay = `${v.caption} ${v.handle} ${v.category || ''}`.toLowerCase();
    return hay.includes(lower) || hay.includes(`#${tagNeedle}`);
  }).slice(0, limit);

  const peopleMap = new Map<string, SearchPerson>();
  for (const v of DEMO_VIDEOS) {
    const username = v.handle.replace(/^@/, '');
    const display = username.replace(/\./g, ' ');
    const hay = `${username} ${display}`.toLowerCase();
    if (!hay.includes(lower)) continue;
    if (peopleMap.has(username)) continue;
    peopleMap.set(username, {
      id: v.userId || `mock_${username}`,
      username,
      displayName: display,
      avatarUrl: v.avatarUrl,
      bio: '',
    });
  }

  const tagSet = new Set<string>();
  for (const v of DEMO_VIDEOS) {
    for (const tag of parseHashtags(v.caption)) {
      if (tag.includes(tagNeedle) || tagNeedle.includes(tag)) tagSet.add(tag);
    }
  }

  return {
    people: [...peopleMap.values()].slice(0, limit),
    publications,
    sounds: [],
    events: [],
    hashtags: [...tagSet].slice(0, limit).map((tag) => ({ tag })),
  };
}

async function searchPeople(
  q: string,
  limit: number,
): Promise<SearchPerson[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const pattern = `%${escapeIlike(q)}%`;
  const { data, error } = await sb
    .from('profiles')
    .select('id, username, display_name, bio, avatar_url')
    .or(`username.ilike."${pattern}",display_name.ilike."${pattern}"`)
    .limit(limit);

  if (error) {
    // Soft-fail if profiles RLS / schema oddities
    console.warn('[search] people', error.message);
    return [];
  }

  return (data || []).map((row) => {
    const username = row.username || 'createur';
    return {
      id: row.id,
      username,
      displayName: row.display_name || username,
      avatarUrl:
        row.avatar_url ||
        `https://i.pravatar.cc/150?u=${encodeURIComponent(username)}`,
      bio: row.bio || '',
    };
  });
}

async function searchPublications(
  q: string,
  limit: number,
): Promise<VideoItem[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const pattern = `%${escapeIlike(q)}%`;
  const { data, error } = await sb
    .from('videos')
    .select(VIDEO_PROFILE_SELECT_NO_SOUND)
    .eq('status', 'published')
    .ilike('caption', pattern)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    if (
      error.message?.includes('status') ||
      error.code === '42703' ||
      error.code === 'PGRST204'
    ) {
      const fb = await sb
        .from('videos')
        .select(VIDEO_PROFILE_SELECT_NO_SOUND)
        .ilike('caption', pattern)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (fb.error) {
        console.warn('[search] publications', fb.error.message);
        return [];
      }
      const rows = (fb.data || []) as unknown as VideoWithProfile[];
      return rows.map((row) =>
        mapRowToVideoItem(row, publicUrlForPath(row.storage_path)),
      );
    }
    console.warn('[search] publications', error.message);
    return [];
  }

  const rows = (data || []) as unknown as VideoWithProfile[];
  return rows.map((row) =>
    mapRowToVideoItem(row, publicUrlForPath(row.storage_path)),
  );
}

async function searchSounds(q: string, limit: number): Promise<SoundItem[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const pattern = `%${escapeIlike(q)}%`;
  const { data, error } = await sb
    .from('sounds')
    .select(SOUND_PROFILE_SELECT)
    .ilike('title', pattern)
    .order('use_count', { ascending: false })
    .limit(limit);

  if (error) {
    if (
      error.message?.includes('sounds') ||
      error.code === 'PGRST205' ||
      error.code === '42P01'
    ) {
      return [];
    }
    console.warn('[search] sounds', error.message);
    return [];
  }

  const rows = (data || []) as unknown as SoundWithProfile[];
  return rows.map((row) => mapSoundRow(row, publicUrlForPath(row.storage_path)));
}

async function searchEvents(q: string, limit: number): Promise<EventItem[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const pattern = `%${escapeIlike(q)}%`;
  const { data, error } = await sb
    .from('events')
    .select(EVENT_PROFILE_SELECT)
    .or(`title.ilike."${pattern}",city.ilike."${pattern}"`)
    .order('starts_at', { ascending: true })
    .limit(limit);

  if (error) {
    if (
      error.message?.includes('events') ||
      error.code === 'PGRST205' ||
      error.code === '42P01'
    ) {
      return [];
    }
    console.warn('[search] events', error.message);
    return [];
  }

  const rows = (data || []) as unknown as EventWithOrganizer[];
  return rows.map(mapEventSearchRow);
}

/**
 * Hashtags: videos.hashtags contains tag OR caption ilike %#q%.
 * Returns unique tag strings (not ranked).
 */
async function searchHashtags(
  q: string,
  limit: number,
): Promise<SearchHashtag[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const tag = q.toLowerCase().replace(/^#/, '');
  if (!tag) return [];

  const captionPattern = `%#${escapeIlike(tag)}%`;
  const tagSet = new Set<string>();

  // Array contains exact element (stored without #)
  const byArray = await sb
    .from('videos')
    .select('hashtags, caption')
    .eq('status', 'published')
    .contains('hashtags', [tag])
    .limit(limit);

  if (!byArray.error && byArray.data) {
    for (const row of byArray.data) {
      const arr = row.hashtags || [];
      for (const h of arr) {
        if (typeof h === 'string' && h.toLowerCase().includes(tag)) {
          tagSet.add(h.toLowerCase());
        }
      }
      for (const h of parseHashtags(row.caption || '')) {
        if (h.includes(tag)) tagSet.add(h);
      }
    }
  }

  const byCaption = await sb
    .from('videos')
    .select('hashtags, caption')
    .eq('status', 'published')
    .ilike('caption', captionPattern)
    .limit(limit);

  if (!byCaption.error && byCaption.data) {
    for (const row of byCaption.data) {
      for (const h of row.hashtags || []) {
        if (typeof h === 'string' && h.toLowerCase().includes(tag)) {
          tagSet.add(h.toLowerCase());
        }
      }
      for (const h of parseHashtags(row.caption || '')) {
        if (h.includes(tag)) tagSet.add(h);
      }
    }
  }

  // Soft fallback without status filter
  if (tagSet.size === 0 && (byArray.error || byCaption.error)) {
    const fb = await sb
      .from('videos')
      .select('hashtags, caption')
      .or(`caption.ilike.${captionPattern}`)
      .limit(limit);
    if (!fb.error && fb.data) {
      for (const row of fb.data) {
        for (const h of row.hashtags || []) {
          if (typeof h === 'string' && h.toLowerCase().includes(tag)) {
            tagSet.add(h.toLowerCase());
          }
        }
        for (const h of parseHashtags(row.caption || '')) {
          if (h.includes(tag)) tagSet.add(h);
        }
      }
    }
  }

  // Also include the query itself if we found matching videos via contains
  if (tagSet.size === 0 && !byArray.error && byArray.data && byArray.data.length > 0) {
    tagSet.add(tag);
  }

  return [...tagSet].slice(0, limit).map((t) => ({ tag: t }));
}

export async function unifiedSearch(
  query: string,
  options?: { limit?: number; tab?: SearchTab },
): Promise<UnifiedSearchResults> {
  const q = normalizeQuery(query);
  if (!q) return { ...EMPTY };

  const limit = options?.limit ?? DEFAULT_LIMIT;
  const tab = options?.tab;

  if (!isSupabaseConfigured) {
    const mock = mockSearch(q, limit);
    if (!tab || tab === 'all') return mock;
    return {
      people: tab === 'people' ? mock.people : [],
      publications: tab === 'publications' ? mock.publications : [],
      sounds: tab === 'sounds' ? mock.sounds : [],
      events: tab === 'events' ? mock.events : [],
      hashtags: tab === 'hashtags' ? mock.hashtags : [],
    };
  }

  const tasks: Promise<void>[] = [];
  const out: UnifiedSearchResults = { ...EMPTY, people: [], publications: [], sounds: [], events: [], hashtags: [] };

  if (wants(tab, 'people')) {
    tasks.push(
      searchPeople(q, limit).then((r) => {
        out.people = r;
      }),
    );
  }
  if (wants(tab, 'publications')) {
    tasks.push(
      searchPublications(q, limit).then((r) => {
        out.publications = r;
      }),
    );
  }
  if (wants(tab, 'sounds')) {
    tasks.push(
      searchSounds(q, limit).then((r) => {
        out.sounds = r;
      }),
    );
  }
  if (wants(tab, 'events')) {
    tasks.push(
      searchEvents(q, limit).then((r) => {
        out.events = r;
      }),
    );
  }
  if (wants(tab, 'hashtags')) {
    tasks.push(
      searchHashtags(q, limit).then((r) => {
        out.hashtags = r;
      }),
    );
  }

  await Promise.all(tasks);
  return out;
}

export function isSearchEmpty(results: UnifiedSearchResults): boolean {
  return (
    results.people.length === 0 &&
    results.publications.length === 0 &&
    results.sounds.length === 0 &&
    results.events.length === 0 &&
    results.hashtags.length === 0
  );
}

export { isSupabaseConfigured };
