/**
 * Live L2 — logique pure du direct instantané et de la bande « En direct ».
 * Aucun import natif ni réseau : testé par __tests__/lib/liveGo.test.ts.
 */
import { profileFieldOutcome } from '@/lib/textFilter';

/** Longueur max d'un titre de live (côté app ; le serveur accepte plus). */
export const LIVE_TITLE_MAX = 120;

/**
 * Délai de grâce après la déconnexion de l'hôte (même valeur que
 * HOST_GRACE_SECONDS de livekit-webhook et departureTimeout de live-token).
 */
export const HOST_GRACE_MS = 120_000;

/** Rafraîchissement de la bande « En direct » (pas de Realtime sur mobile). */
export const LIVE_STRIP_REFRESH_MS = 30_000;

/** Audiences proposées sur l'écran « Passer en direct » (visibilités de 010). */
export type GoLiveAudience = 'public' | 'followers';

export const GO_LIVE_AUDIENCES: readonly GoLiveAudience[] = ['public', 'followers'];

export function audienceLabelKey(a: GoLiveAudience | string): string {
  return a === 'followers' ? 'live.go.audienceFollowers' : 'live.go.audiencePublic';
}

export function nextAudience(a: GoLiveAudience): GoLiveAudience {
  return a === 'public' ? 'followers' : 'public';
}

/** Espaces normalisés et longueur bornée (en caractères, pas en octets). */
export function cleanLiveTitle(raw: string | null | undefined): string {
  const collapsed = (raw ?? '').replace(/\s+/g, ' ').trim();
  return Array.from(collapsed).slice(0, LIVE_TITLE_MAX).join('');
}

/** Titre du direct instantané : celui saisi, sinon « Live de @pseudo ». */
export function instantLiveTitle(raw: string | null | undefined, fallback: string): string {
  return cleanLiveTitle(raw) || cleanLiveTitle(fallback) || 'Live';
}

/**
 * Titre enregistré par le serveur (filtre de mots 018) comparé au titre envoyé :
 *   - held   : live retenu (moderation_state = 'held') → invisible pour les autres ;
 *   - masked : insultes remplacées par des « * » ;
 *   - ok     : inchangé.
 */
export type LiveTitleOutcome = 'ok' | 'masked' | 'held';

export function liveTitleOutcome(
  submitted: string,
  stored: string | null | undefined,
  moderationState: string | null | undefined,
): LiveTitleOutcome {
  if (moderationState === 'held' || moderationState === 'removed') return 'held';
  const sent = submitted.trim();
  const kept = (stored ?? '').trim();
  if (sent === kept) return 'ok';
  return profileFieldOutcome(sent, kept) === 'masked' || kept.includes('*') ? 'masked' : 'ok';
}

/** Ligne minimale pour la bande « En direct ». */
export type LiveStripCandidate = {
  id: string;
  userId: string;
  status: string;
  startedAt: string | null;
  hostLeftAt?: string | null;
  moderationState?: string | null;
};

/**
 * Lives à montrer dans la bande Discover : en direct, visibles (la RLS
 * 017/019 a déjà retiré les lives masqués, bloqués, privés ou réservés aux
 * abonnés d'un autre ; on refiltre par prudence), hôte présent ou parti depuis
 * moins que le délai de grâce, sans doublon, du plus récent au plus ancien.
 */
export function filterLiveStrip<T extends LiveStripCandidate>(
  items: readonly T[],
  nowMs: number,
  opts: { graceMs?: number; blockedUserIds?: ReadonlySet<string> } = {},
): T[] {
  const grace = opts.graceMs ?? HOST_GRACE_MS;
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of items) {
    if (it.status !== 'live') continue;
    if ((it.moderationState ?? 'visible') !== 'visible') continue;
    if (opts.blockedUserIds?.has(it.userId)) continue;
    if (it.hostLeftAt) {
      const left = Date.parse(it.hostLeftAt);
      if (Number.isFinite(left) && nowMs - left > grace) continue;
    }
    if (seen.has(it.id)) continue;
    seen.add(it.id);
    out.push(it);
  }
  const t = (s: string | null) => (s ? Date.parse(s) || 0 : 0);
  return out.sort((a, b) => t(b.startedAt) - t(a.startedAt));
}

/** Durée d'antenne « m:ss » ou « h:mm:ss ». */
export function formatLiveDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** L'hôte est-il absent depuis plus que le délai de grâce ? (écran spectateur) */
export function hostGoneTooLong(hostAbsentSinceMs: number | null, nowMs: number, graceMs = HOST_GRACE_MS): boolean {
  return hostAbsentSinceMs !== null && nowMs - hostAbsentSinceMs > graceMs;
}
