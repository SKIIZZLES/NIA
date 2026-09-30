/**
 * Notifications système de 017, suspension, erreurs d'écriture ; blocages.
 */
import { isSuspended, systemNotificationText, writeErrorKey } from '@/lib/moderation';
import { blockUser, fetchBlockedAccounts, mapBlockedRows, unblockUser } from '@/lib/blocks';
import { getSupabase } from '@/lib/supabase';
import fr from '@/locales/fr';

jest.mock('@/lib/supabase', () => ({
  getSupabase: jest.fn(),
  isSupabaseConfigured: true,
}));
const mocked = getSupabase as jest.MockedFunction<typeof getSupabase>;
const UID = '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

function has(key: string): boolean {
  const [ns, k] = key.split('.');
  return typeof (fr as unknown as Record<string, Record<string, string>>)[ns]?.[k] === 'string';
}

describe('notifications système', () => {
  const cases: [string, string | null, string][] = [
    ['report_received', 'received', 'moderation.notifReportReceived'],
    ['report_decision', 'actioned', 'moderation.notifReportActioned'],
    ['report_decision', 'dismissed', 'moderation.notifReportDismissed'],
    ['moderation_notice', 'held', 'moderation.notifContentHeld'],
    ['moderation_notice', 'removed', 'moderation.notifContentRemoved'],
    ['moderation_notice', 'restored', 'moderation.notifContentRestored'],
    ['moderation_notice', 'warned', 'moderation.notifContentWarned'],
    ['moderation_notice', 'suspended', 'moderation.notifContentSuspended'],
    ['moderation_notice', 'held_keywords', 'moderation.notifKeywordHeld'],
    ['moderation_notice', 'approved', 'moderation.notifContentApproved'],
  ];
  it.each(cases)('%s / %s → %s (clés existantes)', (type, code, key) => {
    const t = systemNotificationText({ type, meta: { code, category: 'negrophobie' } });
    expect(t?.key).toBe(key);
    expect(t?.categoryKey).toBe('report.catNegrophobia');
    expect(has(t!.key) && has(t!.detailsKey) && has(t!.categoryKey)).toBe(true);
  });

  it('contestation proposée pour les décisions défavorables seulement', () => {
    expect(systemNotificationText({ type: 'moderation_notice', meta: { code: 'removed' } })?.contest).toBe(true);
    expect(systemNotificationText({ type: 'moderation_notice', meta: { code: 'restored' } })?.contest).toBe(false);
    expect(systemNotificationText({ type: 'report_decision', meta: { code: 'actioned' } })?.contest).toBe(false);
  });

  it('018 : retenue d’un profil, rien à contester tant que rien n’est décidé', () => {
    const profile = systemNotificationText({
      type: 'moderation_notice',
      meta: { code: 'held_keywords', category: 'homophobie', target_type: 'user', field: 'bio' },
    });
    expect(profile?.key).toBe('moderation.notifProfileHeld');
    expect(profile?.detailsKey).toBe('moderation.detailsProfileHeld');
    expect(has(profile!.key) && has(profile!.detailsKey)).toBe(true);
    expect(profile?.contest).toBe(false);
    const video = systemNotificationText({
      type: 'moderation_notice',
      meta: { code: 'held_keywords', category: 'negrophobie', target_type: 'video' },
    });
    expect(video?.detailsKey).toBe('moderation.detailsKeywordHeld');
    expect(video?.contest).toBe(false);
  });

  it('code inconnu, meta absente ou type ordinaire → null (repli sur body)', () => {
    expect(systemNotificationText({ type: 'moderation_notice', meta: { code: 'nouveau' } })).toBeNull();
    expect(systemNotificationText({ type: 'report_decision', meta: null })).toBeNull();
    expect(systemNotificationText({ type: 'like', meta: { code: 'held' } })).toBeNull();
  });
});

describe('suspension et erreurs', () => {
  it('suspended_until dans le futur seulement', () => {
    const now = Date.parse('2026-09-30T10:00:00Z');
    expect(isSuspended('2026-10-01T00:00:00Z', now)).toBe(true);
    expect(isSuspended('2026-09-01T00:00:00Z', now)).toBe(false);
    expect(isSuspended(null, now)).toBe(false);
    expect(isSuspended('pas une date', now)).toBe(false);
  });
  it('42501 / 54000 → messages lisibles', () => {
    expect(writeErrorKey({ code: '42501' })).toBe('moderation.notAllowed');
    expect(writeErrorKey({ code: '54000' })).toBe('moderation.rateLimited');
    expect(writeErrorKey(new Error('x'))).toBeNull();
  });
});

describe('blocages', () => {
  it('se bloquer soi-même : refusé sans requête', async () => {
    mocked.mockReturnValue(null);
    expect(await blockUser(UID, UID)).toEqual({ ok: false, errorKey: 'safety.blockSelf' });
  });

  it('déjà bloqué (23505) = succès ; autre erreur = clé traduisible', async () => {
    const insert = jest.fn().mockResolvedValueOnce({ error: { code: '23505' } }).mockResolvedValueOnce({ error: { code: '500' } });
    mocked.mockReturnValue({ from: () => ({ insert }) } as unknown as ReturnType<typeof getSupabase>);
    expect(await blockUser(UID, B)).toEqual({ ok: true, mock: false, blocked: true });
    expect(await blockUser(UID, B)).toEqual({ ok: false, errorKey: 'safety.blockError' });
    expect(has('safety.blockError') && has('safety.unblockError') && has('safety.serviceUnavailable')).toBe(true);
  });

  it('débloquer filtre sur les deux identifiants', async () => {
    const filtres: [string, string][] = [];
    const b = {
      delete: () => b,
      eq: (c: string, v: string) => {
        filtres.push([c, v]);
        return filtres.length === 2 ? Promise.resolve({ error: null }) : b;
      },
    };
    mocked.mockReturnValue({ from: () => b } as unknown as ReturnType<typeof getSupabase>);
    expect(await unblockUser(UID, B)).toEqual({ ok: true, mock: false, blocked: false });
    expect(filtres).toEqual([
      ['blocker_id', UID],
      ['blocked_id', B],
    ]);
  });

  it('liste des comptes bloqués : profil joint ; erreur → null', async () => {
    expect(
      mapBlockedRows([
        { blocked_id: B, created_at: 'x', profiles: { username: 'awa', display_name: 'Awa', avatar_url: null } },
      ]),
    ).toEqual([{ id: B, username: 'awa', displayName: 'Awa', avatarUrl: null, blockedAt: 'x' }]);
    const b = {
      select: () => b,
      eq: () => b,
      order: () => b,
      limit: () => Promise.resolve({ data: null, error: { code: '500' } }),
    };
    mocked.mockReturnValue({ from: () => b } as unknown as ReturnType<typeof getSupabase>);
    expect(await fetchBlockedAccounts(UID)).toBeNull();
  });
});
