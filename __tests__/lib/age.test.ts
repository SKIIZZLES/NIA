/**
 * Âge déclaré et contenus 18+ (migration 020) — logique côté app.
 * Le serveur revérifie tout (tests SQL 020) ; ici : saisie, lecture des
 * réponses, traduction des erreurs, date gardée entre inscription et session.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  AGE_REFUSED_LOCK_MS,
  UNSUPPORTED_AGE_STATUS,
  ageOn,
  birthDateCheckErrorKey,
  canMarkMature,
  checkBirthDate,
  declareErrorResult,
  formatBirthDate,
  isAgeRefused,
  isMatureError,
  isOldEnoughToSignUp,
  markAgeRefused,
  matureError,
  matureErrorKey,
  parseAgeStatus,
  savePendingBirthDate,
  takePendingBirthDate,
} from '@/lib/age';
import {
  DEFAULT_PUBLISH_OPTIONS,
  canRepostItem,
  hasRestrictiveOptions,
  publishOptionsPayload,
} from '@/lib/publishOptions';
import fr from '@/locales/fr';

const TODAY = new Date(2026, 8, 30); // 30/09/2026, heure locale
const parts = (day: string, month: string, year: string) => ({ day, month, year });

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('checkBirthDate', () => {
  it('accepte une date valide et calcule l’âge révolu', () => {
    expect(checkBirthDate(parts('30', '9', '2013'), TODAY)).toEqual({ ok: true, iso: '2013-09-30', age: 13 });
    expect(checkBirthDate(parts('1', '10', '2013'), TODAY)).toEqual({ ok: true, iso: '2013-10-01', age: 12 });
    expect(checkBirthDate(parts('30', '09', '2008'), TODAY)).toEqual({ ok: true, iso: '2008-09-30', age: 18 });
  });

  it('refuse les saisies incomplètes, impossibles, futures ou trop anciennes', () => {
    expect(checkBirthDate(parts('', '9', '2000'), TODAY)).toEqual({ ok: false, reason: 'incomplete' });
    expect(checkBirthDate(parts('1', '9', '200'), TODAY)).toEqual({ ok: false, reason: 'incomplete' });
    expect(checkBirthDate(parts('31', '4', '2000'), TODAY)).toEqual({ ok: false, reason: 'invalid' });
    expect(checkBirthDate(parts('1', '13', '2000'), TODAY)).toEqual({ ok: false, reason: 'invalid' });
    expect(checkBirthDate(parts('29', '2', '2023'), TODAY)).toEqual({ ok: false, reason: 'invalid' });
    expect(checkBirthDate(parts('1', '10', '2026'), TODAY)).toEqual({ ok: false, reason: 'future' });
    expect(checkBirthDate(parts('1', '1', '1899'), TODAY)).toEqual({ ok: false, reason: 'too_old' });
  });

  it('né un 29 février : un an de plus le 1er mars les années non bissextiles (comme 020)', () => {
    const b = { year: 2008, month: 2, day: 29 };
    expect(ageOn(b, new Date(2026, 1, 28))).toBe(17);
    expect(ageOn(b, new Date(2026, 2, 1))).toBe(18);
    expect(checkBirthDate(parts('29', '2', '2008'), TODAY)).toMatchObject({ ok: true, age: 18 });
  });

  it('âge minimum 13 ans', () => {
    expect(isOldEnoughToSignUp(12)).toBe(false);
    expect(isOldEnoughToSignUp(13)).toBe(true);
  });

  it('chaque erreur de saisie a un texte', () => {
    for (const reason of ['incomplete', 'invalid', 'future', 'too_old'] as const) {
      const key = birthDateCheckErrorKey(reason).replace(/^age\./, '') as keyof typeof fr.age;
      expect(fr.age[key]).toBeTruthy();
    }
    expect(formatBirthDate('2008-03-01')).toBe('01/03/2008');
  });
});

describe('parseAgeStatus', () => {
  it('lit la réponse de get_my_age_status', () => {
    expect(parseAgeStatus({ declared: true, adult: true, show_mature: true, min_age: 13 })).toEqual({
      supported: true,
      declared: true,
      adult: true,
      showMature: true,
      minAge: 13,
    });
  });

  it('prudence : un mineur ou une réponse inattendue ne voit jamais le 18+', () => {
    expect(parseAgeStatus({ declared: true, adult: false, show_mature: true }).showMature).toBe(false);
    expect(parseAgeStatus(null)).toMatchObject({ supported: true, declared: false, adult: false, showMature: false, minAge: 13 });
    expect(parseAgeStatus({ adult: 'true' }).adult).toBe(false);
  });

  it('seul un adulte déclaré, base à jour, peut marquer 18+', () => {
    expect(canMarkMature(UNSUPPORTED_AGE_STATUS)).toBe(false);
    expect(canMarkMature({ ...UNSUPPORTED_AGE_STATUS, supported: true, declared: true, adult: false })).toBe(false);
    expect(canMarkMature({ ...UNSUPPORTED_AGE_STATUS, supported: true, declared: true, adult: true })).toBe(true);
  });
});

describe('erreurs serveur', () => {
  it('set_my_birth_date', () => {
    expect(declareErrorResult({ code: '22023', message: 'too_young' })).toEqual({
      ok: false,
      tooYoung: true,
      errorKey: 'age.tooYoungBody',
    });
    expect(declareErrorResult({ code: '23505', message: 'birth_date_already_set' })).toMatchObject({
      tooYoung: false,
      errorKey: 'age.errAlreadySet',
    });
    expect(declareErrorResult({ code: '22023', message: 'birth_date_invalid' })).toMatchObject({ errorKey: 'age.errInvalid' });
    expect(
      declareErrorResult({ code: 'PGRST202', message: 'Could not find the function public.set_my_birth_date' }),
    ).toMatchObject({ errorKey: 'age.unavailable', unsupported: true });
    expect(declareErrorResult(new Error('Network request failed'))).toMatchObject({ errorKey: 'age.errServer' });
  });

  it('marquage 18+ refusé ou 020 absente', () => {
    expect(matureErrorKey({ code: '42501', message: 'mature_requires_adult' })).toBe('age.matureRequiresAdult');
    expect(matureErrorKey({ code: '42501', message: 'mature_locked' })).toBe('age.matureLocked');
    expect(
      matureErrorKey({ code: 'PGRST204', message: "Could not find the 'is_mature' column of 'videos' in the schema cache" }),
    ).toBe('age.matureNeedsServer');
    expect(matureErrorKey({ code: '42703', message: 'column videos.visibility does not exist' })).toBeNull();
    expect(matureErrorKey({ code: '42501', message: 'new row violates row-level security policy' })).toBeNull();
    expect(matureErrorKey(null)).toBeNull();
  });

  it('erreur 18+ déjà traduite, reconnaissable', () => {
    const e = matureError('msg');
    expect(isMatureError(e)).toBe(true);
    expect(e.message).toBe('msg');
    expect(isMatureError(new Error('msg'))).toBe(false);
    expect(isMatureError({ message: 'mature_locked' })).toBe(false);
  });
});

describe('date gardée entre inscription et première session', () => {
  it('rendue une seule fois, au bon compte', async () => {
    await savePendingBirthDate(' Awa@Exemple.com ', '2001-05-04');
    expect(await takePendingBirthDate('autre@exemple.com')).toBeNull();
    expect(await takePendingBirthDate('awa@exemple.com')).toBe('2001-05-04');
    expect(await takePendingBirthDate('awa@exemple.com')).toBeNull();
  });

  it('refus d’âge : verrou limité dans le temps', async () => {
    expect(await isAgeRefused()).toBe(false);
    await markAgeRefused();
    expect(await isAgeRefused()).toBe(true);
    expect(await isAgeRefused(Date.now() + AGE_REFUSED_LOCK_MS + 1000)).toBe(false);
  });
});

describe('publication 18+', () => {
  it('is_mature envoyé seulement s’il est choisi', () => {
    expect(publishOptionsPayload(DEFAULT_PUBLISH_OPTIONS, null)).not.toHaveProperty('is_mature');
    expect(publishOptionsPayload({ ...DEFAULT_PUBLISH_OPTIONS, isMature: true }, null).is_mature).toBe(true);
  });

  it('jamais publiée sans le marquage, jamais republiable', () => {
    expect(hasRestrictiveOptions({ ...DEFAULT_PUBLISH_OPTIONS, isMature: true })).toBe(true);
    expect(canRepostItem({ visibility: 'public', allowReuse: true, isMature: true })).toBe(false);
    expect(canRepostItem({ visibility: 'public', allowReuse: true, isMature: false })).toBe(true);
  });
});
