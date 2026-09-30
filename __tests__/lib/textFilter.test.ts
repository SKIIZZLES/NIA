/**
 * Filtre de mots (018) côté app : verdicts, repli sans 018, profils
 * masqués / en attente, vidéos retenues.
 */
import {
  burnedVerdictFrom,
  checkBurnedText,
  checkText,
  checkTexts,
  isKeywordHeld,
  isRpcMissing,
  isTextRefusedError,
  parseVerdict,
  profileFieldOutcome,
  worstVerdict,
} from '@/lib/textFilter';
import { getSupabase } from '@/lib/supabase';

jest.mock('@/lib/supabase', () => ({
  getSupabase: jest.fn(),
  isSupabaseConfigured: true,
}));
const mocked = getSupabase as jest.MockedFunction<typeof getSupabase>;

function rpcReturning(impl: (fn: string, args: Record<string, unknown>) => unknown) {
  const rpc = jest.fn(async (fn: string, args: Record<string, unknown>) => impl(fn, args));
  mocked.mockReturnValue({ rpc } as never);
  return rpc;
}

afterEach(() => mocked.mockReset());

describe('verdicts', () => {
  it('valeurs inattendues → ok (le serveur tranche de toute façon)', () => {
    expect(parseVerdict('held')).toBe('held');
    expect(parseVerdict('masked')).toBe('masked');
    expect(parseVerdict('refused')).toBe('refused');
    expect(parseVerdict('ok')).toBe('ok');
    expect(parseVerdict(null)).toBe('ok');
    expect(parseVerdict('HELD')).toBe('ok');
    expect(parseVerdict(42)).toBe('ok');
  });

  it('le plus sévère l’emporte', () => {
    expect(worstVerdict([])).toBe('ok');
    expect(worstVerdict(['ok', 'masked'])).toBe('masked');
    expect(worstVerdict(['masked', 'held', 'ok'])).toBe('held');
    expect(worstVerdict(['held', 'refused'])).toBe('refused');
  });
});

describe('checkText / checkTexts', () => {
  it('appelle nia_check_text avec le texte nettoyé et le champ', async () => {
    const rpc = rpcReturning(() => ({ data: 'held', error: null }));
    await expect(checkText('  un texte  ', 'caption')).resolves.toBe('held');
    expect(rpc).toHaveBeenCalledWith('nia_check_text', { p_text: 'un texte', p_field: 'caption' });
  });

  it('texte vide : aucun appel réseau', async () => {
    const rpc = rpcReturning(() => ({ data: 'held', error: null }));
    await expect(checkText('   ')).resolves.toBe('ok');
    await expect(checkText(null)).resolves.toBe('ok');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('018 absente, erreur réseau ou Supabase non configuré → ok', async () => {
    rpcReturning(() => ({ data: null, error: { code: 'PGRST202', message: 'not found' } }));
    await expect(checkText('bonjour')).resolves.toBe('ok');
    mocked.mockReturnValue({ rpc: jest.fn(async () => { throw new Error('Network request failed'); }) } as never);
    await expect(checkText('bonjour')).resolves.toBe('ok');
    mocked.mockReturnValue(null as never);
    await expect(checkText('bonjour')).resolves.toBe('ok');
  });

  it('plusieurs champs : champs vides ignorés, verdict le plus sévère', async () => {
    const rpc = rpcReturning((_fn, args) => ({
      data: args.p_field === 'alt_text' ? 'held' : 'masked',
      error: null,
    }));
    await expect(
      checkTexts([
        { text: 'légende', field: 'caption' },
        { text: '', field: 'hashtags' },
        { text: 'texte alternatif', field: 'alt_text' },
        { text: undefined, field: 'location_text' },
      ]),
    ).resolves.toBe('held');
    expect(rpc).toHaveBeenCalledTimes(2);
    await expect(checkTexts([{ text: ' ', field: 'bio' }])).resolves.toBe('ok');
  });
});

describe('erreurs serveur', () => {
  it('RPC absente', () => {
    expect(isRpcMissing({ code: 'PGRST202' })).toBe(true);
    expect(isRpcMissing({ code: '42883' })).toBe(true);
    expect(isRpcMissing({ code: '42501' })).toBe(false);
    expect(isRpcMissing(null)).toBe(false);
  });

  it('pseudo refusé (text_refused, 22023)', () => {
    expect(isTextRefusedError({ code: '22023', message: 'text_refused', details: 'username' })).toBe(true);
    expect(isTextRefusedError({ code: '22023', message: 'bad_decision' })).toBe(false);
    expect(isTextRefusedError({ code: '23505', message: 'text_refused' })).toBe(false);
    expect(isTextRefusedError(new Error('text_refused'))).toBe(false);
  });
});

describe('profileFieldOutcome', () => {
  it('identique → saved', () => {
    expect(profileFieldOutcome('Ma bio', 'Ma bio')).toBe('saved');
    expect(profileFieldOutcome('  Ma bio ', 'Ma bio')).toBe('saved');
    expect(profileFieldOutcome('', null)).toBe('saved');
  });

  it('même longueur, lettres remplacées par * → masked', () => {
    expect(profileFieldOutcome('quel connard', 'quel c******')).toBe('masked');
    expect(profileFieldOutcome('T’es un enculé !', 'T’es un e***** !')).toBe('masked');
    // émojis et lettres accentuées comptés comme un caractère
    expect(profileFieldOutcome('🌍 connard 🌍', '🌍 c****** 🌍')).toBe('masked');
  });

  it('ancienne valeur gardée → pending', () => {
    expect(profileFieldOutcome('nouvelle bio douteuse', 'ancienne bio')).toBe('pending');
    expect(profileFieldOutcome('Nom', null)).toBe('pending');
    // même longueur mais pas un masque
    expect(profileFieldOutcome('abcdef', 'ghijkl')).toBe('pending');
    expect(profileFieldOutcome('abc*ef', 'abcdef')).toBe('pending');
  });
});

describe('isKeywordHeld', () => {
  it('seulement pour une retenue du filtre de mots', () => {
    expect(isKeywordHeld({ moderationState: 'held', moderationReason: 'auto:keywords' })).toBe(true);
    expect(isKeywordHeld({ moderationState: 'held', moderationReason: 'auto:3_reporters' })).toBe(false);
    expect(isKeywordHeld({ moderationState: 'held' })).toBe(false);
    expect(isKeywordHeld({ moderationState: 'removed', moderationReason: 'auto:keywords' })).toBe(false);
    expect(isKeywordHeld({})).toBe(false);
  });
});

describe('texte incrusté dans la vidéo (éditeur V2)', () => {
  it('tout verdict autre que ok bloque', () => {
    expect(burnedVerdictFrom('ok')).toBe('ok');
    expect(burnedVerdictFrom('masked')).toBe('blocked');
    expect(burnedVerdictFrom('held')).toBe('blocked');
    expect(burnedVerdictFrom('refused')).toBe('blocked');
    expect(burnedVerdictFrom(null)).toBe('unverified');
  });

  it('interroge nia_check_text comme une légende', async () => {
    const rpc = rpcReturning(() => ({ data: 'held', error: null }));
    await expect(checkBurnedText('un texte')).resolves.toBe('blocked');
    expect(rpc).toHaveBeenCalledWith('nia_check_text', { p_text: 'un texte', p_field: 'caption' });
  });

  it('texte vide : rien à vérifier', async () => {
    const rpc = rpcReturning(() => ({ data: 'held', error: null }));
    await expect(checkBurnedText('  ')).resolves.toBe('ok');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('réseau en panne ou erreur : non vérifié (pas d’export)', async () => {
    rpcReturning(() => {
      throw new Error('offline');
    });
    await expect(checkBurnedText('texte')).resolves.toBe('unverified');
    rpcReturning(() => ({ data: null, error: { code: '500', message: 'boom' } }));
    await expect(checkBurnedText('texte')).resolves.toBe('unverified');
  });

  it('018 absente : même repli que checkText', async () => {
    rpcReturning(() => ({ data: null, error: { code: 'PGRST202', message: 'missing' } }));
    await expect(checkBurnedText('texte')).resolves.toBe('ok');
  });
});
