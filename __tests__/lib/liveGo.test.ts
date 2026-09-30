import {
  GO_LIVE_AUDIENCES,
  HOST_GRACE_MS,
  LIVE_TITLE_MAX,
  audienceLabelKey,
  cleanLiveTitle,
  filterLiveStrip,
  formatLiveDuration,
  hostGoneTooLong,
  instantLiveTitle,
  liveTitleOutcome,
  nextAudience,
} from '@/lib/liveGo';
import fr from '@/locales/fr';

function frHas(path: string): boolean {
  let cur: unknown = fr;
  for (const part of path.split('.')) {
    if (!cur || typeof cur !== 'object' || !(part in (cur as object))) return false;
    cur = (cur as Record<string, unknown>)[part];
  }
  return typeof cur === 'string';
}

describe('liveGo — audience', () => {
  it('propose Tout le monde puis Abonnés, clés présentes en fr', () => {
    expect(GO_LIVE_AUDIENCES).toEqual(['public', 'followers']);
    for (const a of GO_LIVE_AUDIENCES) expect(frHas(audienceLabelKey(a))).toBe(true);
    expect(fr.live.go.audiencePublic).toBe('Tout le monde');
    expect(fr.live.go.audienceFollowers).toBe('Abonnés');
  });
  it('valeur inconnue → libellé public', () => {
    expect(audienceLabelKey('private')).toBe('live.go.audiencePublic');
  });
  it('bascule public ↔ followers', () => {
    expect(nextAudience('public')).toBe('followers');
    expect(nextAudience('followers')).toBe('public');
  });
});

describe('liveGo — titre', () => {
  it('normalise les espaces et borne la longueur (caractères)', () => {
    expect(cleanLiveTitle('  Soirée   afrobeats \n live ')).toBe('Soirée afrobeats live');
    expect(cleanLiveTitle(null)).toBe('');
    const long = '🥁'.repeat(LIVE_TITLE_MAX + 20);
    expect(Array.from(cleanLiveTitle(long))).toHaveLength(LIVE_TITLE_MAX);
  });
  it('titre vide → titre par défaut, sinon « Live »', () => {
    expect(instantLiveTitle('  ', 'Live de @awa')).toBe('Live de @awa');
    expect(instantLiveTitle('Mon live', 'Live de @awa')).toBe('Mon live');
    expect(instantLiveTitle('', '   ')).toBe('Live');
  });
  it('titre retenu / masqué / inchangé', () => {
    expect(liveTitleOutcome('Bonsoir', 'Bonsoir', 'visible')).toBe('ok');
    expect(liveTitleOutcome('Bonsoir', 'Bonsoir', 'held')).toBe('held');
    expect(liveTitleOutcome('Bonsoir', 'Bonsoir', 'removed')).toBe('held');
    expect(liveTitleOutcome('va con', 'va ***', 'visible')).toBe('masked');
    expect(liveTitleOutcome('  Bonsoir ', 'Bonsoir', undefined)).toBe('ok');
    expect(liveTitleOutcome('Bonsoir', 'Bonsoir tout le monde', 'visible')).toBe('ok');
  });
});

describe('liveGo — bande « En direct »', () => {
  const now = Date.parse('2026-09-30T10:00:00Z');
  const base = { userId: 'u1', startedAt: '2026-09-30T09:00:00Z', status: 'live' };

  it('garde les lives en direct visibles, triés du plus récent', () => {
    const out = filterLiveStrip(
      [
        { ...base, id: 'a', startedAt: '2026-09-30T09:00:00Z' },
        { ...base, id: 'b', startedAt: '2026-09-30T09:30:00Z' },
        { ...base, id: 'c', startedAt: null },
      ],
      now,
    );
    expect(out.map((x) => x.id)).toEqual(['b', 'a', 'c']);
  });
  it('retire les lives non « live », retenus, retirés, doublons', () => {
    const out = filterLiveStrip(
      [
        { ...base, id: 'a' },
        { ...base, id: 'a' },
        { ...base, id: 'b', status: 'scheduled' },
        { ...base, id: 'c', status: 'ended' },
        { ...base, id: 'd', moderationState: 'held' },
        { ...base, id: 'e', moderationState: 'removed' },
        { ...base, id: 'f', moderationState: 'visible' },
      ],
      now,
    );
    expect(out.map((x) => x.id)).toEqual(['a', 'f']);
  });
  it('retire les comptes bloqués transmis', () => {
    const out = filterLiveStrip(
      [
        { ...base, id: 'a', userId: 'bad' },
        { ...base, id: 'b' },
      ],
      now,
      { blockedUserIds: new Set(['bad']) },
    );
    expect(out.map((x) => x.id)).toEqual(['b']);
  });
  it('hôte parti depuis plus que le délai de grâce → retiré', () => {
    const recent = new Date(now - HOST_GRACE_MS + 5_000).toISOString();
    const old = new Date(now - HOST_GRACE_MS - 5_000).toISOString();
    const out = filterLiveStrip(
      [
        { ...base, id: 'a', hostLeftAt: recent },
        { ...base, id: 'b', hostLeftAt: old },
        { ...base, id: 'c', hostLeftAt: 'pas une date' },
      ],
      now,
    );
    expect(out.map((x) => x.id).sort()).toEqual(['a', 'c']);
  });
});

describe('liveGo — durée et hôte absent', () => {
  it('formate m:ss et h:mm:ss', () => {
    expect(formatLiveDuration(0)).toBe('0:00');
    expect(formatLiveDuration(-5)).toBe('0:00');
    expect(formatLiveDuration(65_000)).toBe('1:05');
    expect(formatLiveDuration(3_725_000)).toBe('1:02:05');
  });
  it('hôte absent au-delà du délai de grâce', () => {
    expect(hostGoneTooLong(null, 10_000_000)).toBe(false);
    expect(hostGoneTooLong(0, HOST_GRACE_MS)).toBe(false);
    expect(hostGoneTooLong(0, HOST_GRACE_MS + 1)).toBe(true);
    expect(hostGoneTooLong(0, 2_000, 1_000)).toBe(true);
  });
});

describe('liveGo — chaînes L2 présentes en fr', () => {
  it.each([
    'live.hubSubtitle',
    'live.rtc.errNotStarted',
    'live.go.defaultTitle',
    'live.go.heldEdit',
    'live.go.masked',
    'live.go.endedBody',
    'live.strip.title',
    'live.strip.cardA11y',
    'live.watch.report',
    'live.watch.hostAway',
  ])('%s', (key) => {
    expect(frHas(key)).toBe(true);
  });
});
