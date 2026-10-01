/**
 * Badge First (023) — annuaire des comptes classés.
 * Rangs valides, recherche par identifiant puis par pseudo, chargement
 * silencieux quand 023 n'est pas encore appliquée, cache de 10 minutes.
 */
import {
  buildFirstBadgeDirectory,
  getFirstBadgeDirectory,
  isFirstRank,
  loadFirstBadges,
  lookupFirstRank,
  normalizeUsername,
  resetFirstBadges,
  FIRST_BADGE_TTL_MS,
} from '@/lib/firstBadge';
import { getSupabase } from '@/lib/supabase';

jest.mock('@/lib/supabase', () => ({
  getSupabase: jest.fn(),
  isSupabaseConfigured: true,
}));

const mockedGetSupabase = getSupabase as jest.MockedFunction<typeof getSupabase>;

/** Double minimal de la chaîne PostgREST utilisée par loadFirstBadges. */
function client(result: { data: unknown; error: unknown } | Error) {
  const calls: Record<string, unknown[]> = {};
  const chain: Record<string, jest.Mock> = {};
  const record = (name: string) =>
    jest.fn((...args: unknown[]) => {
      calls[name] = args;
      return chain;
    });
  chain.select = record('select');
  chain.not = record('not');
  chain.order = record('order');
  chain.limit = jest.fn((...args: unknown[]) => {
    calls.limit = args;
    return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
  });
  const from = jest.fn((table: string) => {
    calls.from = [table];
    return chain;
  });
  return { sb: { from } as unknown as ReturnType<typeof getSupabase>, calls, from };
}

const ROWS = [
  { id: 'u-karamba', username: 'karamba.gassama', first_rank: 1 },
  { id: 'u-awa', username: 'Awa.K', first_rank: 12 },
  { id: 'u-bad0', username: 'zero', first_rank: 0 },
  { id: 'u-bad101', username: 'cent_un', first_rank: 101 },
  { id: 'u-null', username: 'sans_rang', first_rank: null },
  { id: 'u-float', username: 'virgule', first_rank: 2.5 },
];

beforeEach(() => {
  resetFirstBadges();
  mockedGetSupabase.mockReset();
  jest.useRealTimers();
});

describe('isFirstRank', () => {
  it('accepte les entiers de 1 à 100 uniquement', () => {
    expect([1, 12, 100].every(isFirstRank)).toBe(true);
    expect([0, 101, -1, 2.5, NaN, null, undefined, '3'].some((v) => isFirstRank(v))).toBe(false);
  });
});

describe('normalizeUsername', () => {
  it('retire le @ et ignore la casse', () => {
    expect(normalizeUsername('@Awa.K')).toBe('awa.k');
    expect(normalizeUsername('  awa.k ')).toBe('awa.k');
    expect(normalizeUsername(null)).toBe('');
  });
});

describe('annuaire', () => {
  const dir = buildFirstBadgeDirectory(ROWS);

  it('ne garde que les rangs valides', () => {
    expect([...dir.byId.keys()].sort()).toEqual(['u-awa', 'u-karamba']);
  });

  it('trouve un compte par identifiant, puis par pseudo (avec ou sans @)', () => {
    expect(lookupFirstRank(dir, { userId: 'u-karamba' })).toBe(1);
    expect(lookupFirstRank(dir, { username: '@awa.k' })).toBe(12);
    expect(lookupFirstRank(dir, { userId: 'inconnu', username: 'AWA.K' })).toBe(12);
  });

  it('renvoie null pour un compte sans badge', () => {
    expect(lookupFirstRank(dir, { userId: 'u-null', username: 'sans_rang' })).toBeNull();
    expect(lookupFirstRank(dir, { userId: 'u-bad101', username: '@cent_un' })).toBeNull();
    expect(lookupFirstRank(dir, {})).toBeNull();
  });
});

describe('loadFirstBadges', () => {
  it('lit au plus 100 profils classés, triés par rang', async () => {
    const { sb, calls } = client({ data: ROWS.slice(0, 2), error: null });
    mockedGetSupabase.mockReturnValue(sb);
    await loadFirstBadges();
    expect(calls.from).toEqual(['profiles']);
    expect(calls.select).toEqual(['id, username, first_rank']);
    expect(calls.not).toEqual(['first_rank', 'is', null]);
    expect(calls.order).toEqual(['first_rank', { ascending: true }]);
    expect(calls.limit).toEqual([100]);
    expect(lookupFirstRank(getFirstBadgeDirectory(), { userId: 'u-awa' })).toBe(12);
  });

  it('reste silencieux si 023 n’est pas appliquée (colonne absente) : aucun badge', async () => {
    const { sb } = client({ data: null, error: { code: '42703', message: 'column profiles.first_rank does not exist' } });
    mockedGetSupabase.mockReturnValue(sb);
    await expect(loadFirstBadges()).resolves.toBeUndefined();
    expect(getFirstBadgeDirectory().byId.size).toBe(0);
  });

  it('survit à une exception réseau', async () => {
    const { sb } = client(new Error('Network request failed'));
    mockedGetSupabase.mockReturnValue(sb);
    await expect(loadFirstBadges()).resolves.toBeUndefined();
    expect(getFirstBadgeDirectory().byId.size).toBe(0);
  });

  it('met l’annuaire en cache 10 minutes et regroupe les appels simultanés', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-01T12:00:00Z') });
    const { sb, from } = client({ data: ROWS.slice(0, 2), error: null });
    mockedGetSupabase.mockReturnValue(sb);
    await Promise.all([loadFirstBadges(), loadFirstBadges(), loadFirstBadges()]);
    expect(from).toHaveBeenCalledTimes(1);
    await loadFirstBadges();
    expect(from).toHaveBeenCalledTimes(1);
    jest.setSystemTime(Date.now() + FIRST_BADGE_TTL_MS + 1);
    await loadFirstBadges();
    expect(from).toHaveBeenCalledTimes(2);
    // Son propre profil : rafraîchi après une minute.
    jest.setSystemTime(Date.now() + 61 * 1000);
    await loadFirstBadges({ maxAgeMs: 60 * 1000 });
    expect(from).toHaveBeenCalledTimes(3);
  });
});
