/**
 * Âge déclaré et contenus 18+ (migration 020) côté app.
 *
 * La date de naissance ne quitte l'appareil qu'une fois, vers la RPC
 * set_my_birth_date (table privée user_birthdates, jamais dans profiles).
 * L'app ne la relit pas : get_my_age_status ne renvoie que des booléens.
 * La décision reste sur le serveur (RLS 020) : ce module sert à demander la
 * date, à prévenir avant d'envoyer et à expliquer.
 *
 * Sans 020 (RPC absente) : `supported: false`, aucune modale, aucune option
 * 18+ ; l'app se comporte comme avant. Mode démo (sans Supabase) : état gardé
 * sur l'appareil.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';
import { isRpcMissing } from '@/lib/textFilter';

/** Âge minimum pour créer un compte (CGU section 2 ; = nia_min_signup_age() de 020). */
export const MIN_SIGNUP_AGE = 13;
/** Âge de la majorité pour les contenus 18+. */
export const ADULT_AGE = 18;

/**
 * Comptes sans date (anciens comptes, Google, ex-Snapchat) :
 *   - 'required'  : modale obligatoire à l'ouverture de l'app ;
 *   - 'on_demand' : date demandée seulement pour activer les contenus 18+.
 * Décision du fondateur (PLAN §4, S3). Par défaut : 'required'.
 */
export const BIRTHDATE_PROMPT: 'required' | 'on_demand' = 'required';

export type AgeStatus = {
  /** false : 020 pas encore appliquée (ou hors ligne au premier chargement). */
  supported: boolean;
  declared: boolean;
  adult: boolean;
  showMature: boolean;
  minAge: number;
};

export const UNSUPPORTED_AGE_STATUS: AgeStatus = {
  supported: false,
  declared: false,
  adult: false,
  showMature: false,
  minAge: MIN_SIGNUP_AGE,
};

export type BirthDateParts = { day: string; month: string; year: string };

export type BirthDateCheck =
  | { ok: true; iso: string; age: number }
  | { ok: false; reason: 'incomplete' | 'invalid' | 'future' | 'too_old' };

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Âge révolu à la date `today` (heure locale). Même règle que
 * nia_is_at_least (020) : né un 29 février, on prend un an le 1er mars les
 * années non bissextiles.
 */
export function ageOn(birth: { year: number; month: number; day: number }, today: Date): number {
  const y = today.getFullYear();
  const m = today.getMonth() + 1;
  const d = today.getDate();
  let age = y - birth.year;
  if (m < birth.month || (m === birth.month && d < birth.day)) age -= 1;
  return age;
}

/** Valide les trois champs (JJ / MM / AAAA) et renvoie la date ISO + l'âge. */
export function checkBirthDate(parts: BirthDateParts, today: Date = new Date()): BirthDateCheck {
  const ds = parts.day.trim();
  const ms = parts.month.trim();
  const ys = parts.year.trim();
  if (!ds || !ms || ys.length !== 4) return { ok: false, reason: 'incomplete' };
  if (!/^\d{1,2}$/.test(ds) || !/^\d{1,2}$/.test(ms) || !/^\d{4}$/.test(ys)) {
    return { ok: false, reason: 'invalid' };
  }
  const day = Number(ds);
  const month = Number(ms);
  const year = Number(ys);
  if (month < 1 || month > 12 || day < 1) return { ok: false, reason: 'invalid' };
  const daysInMonth = new Date(year, month, 0).getDate();
  if (day > daysInMonth) return { ok: false, reason: 'invalid' };
  if (year < 1900) return { ok: false, reason: 'too_old' };
  const todayKey = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
  if (year * 10000 + month * 100 + day > todayKey) return { ok: false, reason: 'future' };
  const age = ageOn({ year, month, day }, today);
  if (age > 120) return { ok: false, reason: 'too_old' };
  return { ok: true, iso: `${year}-${pad2(month)}-${pad2(day)}`, age };
}

/** « 2008-03-01 » → « 01/03/2008 » (affichage de confirmation). */
export function formatBirthDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

export function isOldEnoughToSignUp(age: number, minAge: number = MIN_SIGNUP_AGE): boolean {
  return age >= minAge;
}

/** Clé i18n d'une erreur de saisie locale. */
export function birthDateCheckErrorKey(reason: Exclude<BirthDateCheck, { ok: true }>['reason']): string {
  switch (reason) {
    case 'incomplete':
      return 'age.errIncomplete';
    case 'future':
      return 'age.errFuture';
    case 'too_old':
      return 'age.errTooOld';
    default:
      return 'age.errInvalid';
  }
}

/** Réponse de get_my_age_status → état ; toute valeur inattendue = prudence (mineur, 18+ masqué). */
export function parseAgeStatus(data: unknown): AgeStatus {
  const o = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const adult = o.adult === true;
  return {
    supported: true,
    declared: o.declared === true,
    adult,
    showMature: adult && o.show_mature === true,
    minAge: typeof o.min_age === 'number' && o.min_age > 0 ? o.min_age : MIN_SIGNUP_AGE,
  };
}

function errorMessage(error: unknown): string {
  const e = error as { message?: unknown } | null;
  return typeof e?.message === 'string' ? e.message : '';
}

export type DeclareResult =
  | { ok: true; adult: boolean }
  | { ok: false; tooYoung: boolean; errorKey: string; unsupported?: boolean };

/** Erreur de set_my_birth_date → résultat affichable. */
export function declareErrorResult(error: unknown): DeclareResult {
  if (isRpcMissing(error)) return { ok: false, tooYoung: false, errorKey: 'age.unavailable', unsupported: true };
  const msg = errorMessage(error);
  const code = (error as { code?: unknown } | null)?.code;
  if (msg.includes('too_young')) return { ok: false, tooYoung: true, errorKey: 'age.tooYoungBody' };
  if (msg.includes('birth_date_already_set') || code === '23505') {
    return { ok: false, tooYoung: false, errorKey: 'age.errAlreadySet' };
  }
  if (msg.includes('birth_date_invalid')) return { ok: false, tooYoung: false, errorKey: 'age.errInvalid' };
  return { ok: false, tooYoung: false, errorKey: 'age.errServer' };
}

// ---------------------------------------------------------------------------
// Mode démo : état local (aucun serveur).
// ---------------------------------------------------------------------------
const MOCK_KEY = '@nia/age_mock_v1';
type MockState = { birthDate: string; showMature: boolean };

function isoAge(iso: string, today: Date = new Date()): number {
  const [y, m, d] = iso.split('-').map(Number);
  return ageOn({ year: y, month: m, day: d }, today);
}

async function readMock(): Promise<MockState | null> {
  try {
    const raw = await AsyncStorage.getItem(MOCK_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<MockState>) : null;
    return parsed && typeof parsed.birthDate === 'string'
      ? { birthDate: parsed.birthDate, showMature: parsed.showMature === true }
      : null;
  } catch {
    return null;
  }
}

function mockStatus(state: MockState | null): AgeStatus {
  const adult = !!state && isoAge(state.birthDate) >= ADULT_AGE;
  return {
    supported: true,
    declared: !!state,
    adult,
    showMature: adult && !!state?.showMature,
    minAge: MIN_SIGNUP_AGE,
  };
}

// ---------------------------------------------------------------------------
// Serveur (020)
// ---------------------------------------------------------------------------

/** État de l'utilisateur connecté. Ne jette jamais : en cas de doute, `supported: false`. */
export async function fetchMyAgeStatus(): Promise<AgeStatus> {
  const sb = getSupabase();
  if (!sb || !isSupabaseConfigured) return mockStatus(await readMock());
  try {
    const { data, error } = await sb.rpc('get_my_age_status');
    if (error || data == null) return UNSUPPORTED_AGE_STATUS;
    return parseAgeStatus(data);
  } catch {
    return UNSUPPORTED_AGE_STATUS;
  }
}

/** Enregistre la date (une seule fois). */
export async function declareBirthDate(iso: string): Promise<DeclareResult> {
  const sb = getSupabase();
  if (!sb || !isSupabaseConfigured) {
    if (isoAge(iso) < MIN_SIGNUP_AGE) return { ok: false, tooYoung: true, errorKey: 'age.tooYoungBody' };
    const existing = await readMock();
    if (existing) return { ok: false, tooYoung: false, errorKey: 'age.errAlreadySet' };
    await AsyncStorage.setItem(MOCK_KEY, JSON.stringify({ birthDate: iso, showMature: false }));
    return { ok: true, adult: isoAge(iso) >= ADULT_AGE };
  }
  try {
    const { data, error } = await sb.rpc('set_my_birth_date', { p_birth_date: iso });
    if (error) return declareErrorResult(error);
    return { ok: true, adult: data === true };
  } catch (e) {
    return declareErrorResult(e);
  }
}

export type OptInResult = { ok: true; on: boolean } | { ok: false; errorKey: string };

/** « Afficher les contenus 18+ ». */
export async function setMatureOptIn(on: boolean): Promise<OptInResult> {
  const sb = getSupabase();
  if (!sb || !isSupabaseConfigured) {
    const state = await readMock();
    if (!state) return on ? { ok: false, errorKey: 'age.needBirthDate' } : { ok: true, on: false };
    if (on && isoAge(state.birthDate) < ADULT_AGE) return { ok: false, errorKey: 'age.minorInfo' };
    await AsyncStorage.setItem(MOCK_KEY, JSON.stringify({ ...state, showMature: on }));
    return { ok: true, on };
  }
  try {
    const { data, error } = await sb.rpc('set_my_mature_opt_in', { p_on: on });
    if (error) {
      if (isRpcMissing(error)) return { ok: false, errorKey: 'age.unavailable' };
      const msg = errorMessage(error);
      if (msg.includes('not_adult')) return { ok: false, errorKey: 'age.minorInfo' };
      if (msg.includes('birth_date_missing')) return { ok: false, errorKey: 'age.needBirthDate' };
      return { ok: false, errorKey: 'age.optInError' };
    }
    return { ok: true, on: data === true };
  } catch {
    return { ok: false, errorKey: 'age.optInError' };
  }
}

// ---------------------------------------------------------------------------
// Inscription : date saisie avant que la session existe (confirmation e-mail).
// ---------------------------------------------------------------------------
const PENDING_KEY = '@nia/pending_birth_date_v1';
const REFUSED_KEY = '@nia/age_refused_v1';

function emailKey(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase();
}

/** Garde la date saisie à l'inscription jusqu'à la première session du compte. */
export async function savePendingBirthDate(email: string, iso: string): Promise<void> {
  try {
    await AsyncStorage.setItem(PENDING_KEY, JSON.stringify({ email: emailKey(email), iso }));
  } catch {
    // la modale la redemandera
  }
}

/** Date saisie à l'inscription pour ce compte (puis oubliée), ou null. */
export async function takePendingBirthDate(email: string | null | undefined): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { email?: string; iso?: string };
    if (parsed.email !== emailKey(email) || typeof parsed.iso !== 'string') return null;
    await AsyncStorage.removeItem(PENDING_KEY);
    return /^\d{4}-\d{2}-\d{2}$/.test(parsed.iso) ? parsed.iso : null;
  } catch {
    return null;
  }
}

/**
 * Âge minimum non atteint sur cet appareil : pas de nouvel essai avec une
 * autre date pendant AGE_REFUSED_LOCK_MS (le support peut corriger une
 * erreur). Limité dans le temps pour ne pas bloquer à vie un appareil
 * partagé.
 */
export const AGE_REFUSED_LOCK_MS = 24 * 60 * 60 * 1000;

export async function markAgeRefused(): Promise<void> {
  try {
    await AsyncStorage.setItem(REFUSED_KEY, String(Date.now()));
  } catch {
    // ignore
  }
}

export async function isAgeRefused(now: number = Date.now()): Promise<boolean> {
  try {
    const at = Number(await AsyncStorage.getItem(REFUSED_KEY));
    return Number.isFinite(at) && at > 0 && now - at < AGE_REFUSED_LOCK_MS;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Publication et live
// ---------------------------------------------------------------------------

/** L'option 18+ peut-elle être proposée à la publication / au live ? */
export function canMarkMature(status: AgeStatus): boolean {
  return status.supported && status.adult;
}

/** Erreur Postgres / PostgREST liée au 18+ → clé i18n, ou null. */
export function matureErrorKey(err: { code?: string | null; message?: string | null } | null | undefined): string | null {
  if (!err) return null;
  const msg = (err.message ?? '').toLowerCase();
  if (msg.includes('mature_requires_adult')) return 'age.matureRequiresAdult';
  if (msg.includes('mature_locked')) return 'age.matureLocked';
  const code = err.code ?? '';
  const columnError =
    code === 'PGRST204' || code === '42703' || msg.includes('schema cache') || msg.includes('column');
  if (columnError && msg.includes('is_mature')) return 'age.matureNeedsServer';
  return null;
}

const MATURE_ERROR_NAME = 'NiaMatureError';

/** Erreur déjà traduite, à afficher telle quelle (publication, live). */
export function matureError(message: string): Error {
  const e = new Error(message);
  e.name = MATURE_ERROR_NAME;
  return e;
}

export function isMatureError(e: unknown): e is Error {
  return e instanceof Error && e.name === MATURE_ERROR_NAME;
}
