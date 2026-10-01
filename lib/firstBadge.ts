/**
 * Badge « First » : les 100 premiers comptes (migration 023,
 * `profiles.first_rank`, 1..100, attribué par le serveur).
 *
 * Plutôt que d'ajouter `first_rank` aux quinze `select` qui embarquent un
 * profil (fil, commentaires, recherche, sons…), l'app charge une fois
 * l'annuaire des comptes classés : 100 lignes au plus, quelques Ko, mis en
 * cache 10 minutes. Avantage : rien ne casse tant que 023 n'est pas appliquée
 * (la requête échoue, l'annuaire reste vide, aucun badge ne s'affiche).
 */
import { useEffect, useSyncExternalStore } from 'react';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';

export const FIRST_BADGE_LIMIT = 100;
/** Durée de vie du cache de l'annuaire. */
export const FIRST_BADGE_TTL_MS = 10 * 60 * 1000;

export type FirstBadgeRow = {
  id: string;
  username: string | null;
  first_rank: number | null;
};

export type FirstBadgeDirectory = {
  byId: ReadonlyMap<string, number>;
  byUsername: ReadonlyMap<string, number>;
};

const EMPTY: FirstBadgeDirectory = { byId: new Map(), byUsername: new Map() };

/** Rang valide : entier de 1 à 100. */
export function isFirstRank(rank: unknown): rank is number {
  return (
    typeof rank === 'number' &&
    Number.isInteger(rank) &&
    rank >= 1 &&
    rank <= FIRST_BADGE_LIMIT
  );
}

/** `@Awa.K` → `awa.k` (les pseudos sont comparés sans @ ni casse). */
export function normalizeUsername(username: string | null | undefined): string {
  return (username || '').trim().replace(/^@+/, '').toLowerCase();
}

export function buildFirstBadgeDirectory(rows: readonly FirstBadgeRow[]): FirstBadgeDirectory {
  const byId = new Map<string, number>();
  const byUsername = new Map<string, number>();
  for (const row of rows) {
    if (!row || !row.id || !isFirstRank(row.first_rank)) continue;
    byId.set(row.id, row.first_rank);
    const u = normalizeUsername(row.username);
    if (u) byUsername.set(u, row.first_rank);
  }
  return { byId, byUsername };
}

/**
 * Rang d'un compte, par identifiant d'abord (stable), sinon par pseudo
 * (cartes du fil sans `user_id`, données de démonstration).
 */
export function lookupFirstRank(
  dir: FirstBadgeDirectory,
  who: { userId?: string | null; username?: string | null },
): number | null {
  if (who.userId) {
    const r = dir.byId.get(who.userId);
    if (r !== undefined) return r;
  }
  const u = normalizeUsername(who.username);
  if (u) {
    const r = dir.byUsername.get(u);
    if (r !== undefined) return r;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Cache partagé (un seul annuaire pour toute l'app)
// ---------------------------------------------------------------------------
let directory: FirstBadgeDirectory = EMPTY;
let fetchedAt = 0;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function subscribeFirstBadges(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getFirstBadgeDirectory(): FirstBadgeDirectory {
  return directory;
}

/** Remplace l'annuaire (tests, ou données déjà chargées ailleurs). */
export function setFirstBadgeRows(rows: readonly FirstBadgeRow[]): void {
  directory = buildFirstBadgeDirectory(rows);
  fetchedAt = Date.now();
  emit();
}

/** Tests uniquement : vide le cache. */
export function resetFirstBadges(): void {
  directory = EMPTY;
  fetchedAt = 0;
  inflight = null;
  emit();
}

/**
 * Charge l'annuaire si le cache a plus de `maxAgeMs` (10 min par défaut).
 * Silencieux en cas d'échec (023 absente, hors ligne, mode démo) : l'annuaire
 * précédent est gardé.
 */
export function loadFirstBadges(options: { maxAgeMs?: number } = {}): Promise<void> {
  const maxAge = options.maxAgeMs ?? FIRST_BADGE_TTL_MS;
  if (inflight) return inflight;
  if (fetchedAt > 0 && Date.now() - fetchedAt < maxAge) return Promise.resolve();
  if (!isSupabaseConfigured) return Promise.resolve();
  const sb = getSupabase();
  if (!sb) return Promise.resolve();
  inflight = (async () => {
    try {
      const { data, error } = await sb
        .from('profiles')
        .select('id, username, first_rank')
        .not('first_rank', 'is', null)
        .order('first_rank', { ascending: true })
        .limit(FIRST_BADGE_LIMIT);
      fetchedAt = Date.now();
      if (error || !Array.isArray(data)) return;
      directory = buildFirstBadgeDirectory(data as FirstBadgeRow[]);
      emit();
    } catch {
      fetchedAt = Date.now();
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/**
 * Rang « First » d'un compte (null = pas de badge). Déclenche le chargement
 * de l'annuaire au premier usage. `maxAgeMs` plus court sur son propre profil :
 * un compte qui vient de s'inscrire voit son badge sans attendre 10 minutes.
 */
export function useFirstRank(
  who: { userId?: string | null; username?: string | null },
  maxAgeMs: number = FIRST_BADGE_TTL_MS,
): number | null {
  const dir = useSyncExternalStore(subscribeFirstBadges, getFirstBadgeDirectory, getFirstBadgeDirectory);
  useEffect(() => {
    void loadFirstBadges({ maxAgeMs });
  }, [maxAgeMs]);
  return lookupFirstRank(dir, who);
}
