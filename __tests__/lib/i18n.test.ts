/**
 * `resolveDeviceLocale` est du branchement pur sur 20 locales : aucun test
 * d'UI ne le couvre, et une erreur y envoie un utilisateur entier sur la
 * mauvaise langue sans jamais lever d'exception.
 */
import * as Localization from 'expo-localization';
import {
  APP_LOCALES,
  getI18nLocale,
  i18n,
  isAppLocale,
  resolveDeviceLocale,
  setI18nLocale,
  t,
} from '@/lib/i18n';

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => []),
}));

type DeviceLocale = ReturnType<typeof Localization.getLocales>[number];

const getLocales = Localization.getLocales as jest.MockedFunction<
  typeof Localization.getLocales
>;

/** Construit le minimum de champs que `resolveDeviceLocale` lit vraiment. */
function device(partial: {
  languageCode?: string | null;
  languageTag?: string;
  regionCode?: string | null;
}): DeviceLocale {
  return {
    languageCode: null,
    languageTag: '',
    regionCode: null,
    ...partial,
  } as unknown as DeviceLocale;
}

/**
 * `resolveDeviceLocale` relit `getLocales()` à chaque appel : pas besoin
 * d'isoler le module entre les cas.
 */
function resolveWith(...locales: DeviceLocale[]) {
  // `getLocales()` est typé comme un tuple non vide ; le cas « aucune locale »
  // est pourtant atteignable et doit répondre 'fr', donc on force le type.
  getLocales.mockReturnValue(locales as ReturnType<typeof Localization.getLocales>);
  return resolveDeviceLocale();
}

describe('resolveDeviceLocale — arabe', () => {
  it('reconnaît les trois variantes par language tag', () => {
    expect(resolveWith(device({ languageTag: 'ar-MA', languageCode: 'ar' }))).toBe('ar-MA');
    expect(resolveWith(device({ languageTag: 'ar-SD', languageCode: 'ar' }))).toBe('ar-SD');
    expect(resolveWith(device({ languageTag: 'ar-EG', languageCode: 'ar' }))).toBe('ar-EG');
  });

  it('accepte les tags à underscore et les sous-tags', () => {
    // Android renvoie parfois `ar_EG`; iOS ajoute un script (`ar-EG-u-nu-latn`).
    expect(resolveWith(device({ languageTag: 'ar_EG', languageCode: 'ar' }))).toBe('ar-EG');
    expect(resolveWith(device({ languageTag: 'ar-MA-u-nu-latn', languageCode: 'ar' }))).toBe(
      'ar-MA',
    );
  });

  it('dérive la variante de la région quand le tag ne la porte pas', () => {
    expect(resolveWith(device({ languageCode: 'ar', regionCode: 'SD' }))).toBe('ar-SD');
    expect(resolveWith(device({ languageCode: 'ar', regionCode: 'EG' }))).toBe('ar-EG');
  });

  it('envoie tout arabophone hors Soudan et Égypte sur la darija', () => {
    // Attention à ce que ce test prouve, et à ce qu'il ne prouve pas.
    //
    // `MAGHREB_REGIONS` est aujourd'hui sans effet observable : la ligne qui
    // suit son test renvoie 'ar-MA' de toute façon, pour n'importe quelle
    // région. Vérifié par mutation — retirer 'TN' de l'ensemble ne fait
    // échouer aucun test, et ne peut pas en faire échouer un.
    //
    // Cet ensemble n'est donc pas une règle de routage mais une déclaration
    // d'intention, qui deviendra portante le jour où un bundle arabe standard
    // (`ar`) entrera dans l'app : c'est là que « Maghreb » devra se distinguer
    // du reste. En attendant, ce test caractérise le comportement réel :
    // l'absence de bundle MSA fait que le dialectal vaut mieux que le français.
    for (const region of ['MA', 'DZ', 'TN', 'LY', 'EH', 'MR', 'SA', 'IQ', 'JO', '']) {
      expect(resolveWith(device({ languageCode: 'ar', regionCode: region }))).toBe('ar-MA');
    }
    expect(resolveWith(device({ languageCode: 'ar' }))).toBe('ar-MA');
  });
});

describe('resolveDeviceLocale — autres langues', () => {
  it('reconnaît chaque locale par son code sec', () => {
    const cases: Array<[string, string]> = [
      ['fr', 'fr'],
      ['en', 'en'],
      ['es', 'es'],
      ['pt', 'pt'],
      ['sw', 'sw'],
      ['ha', 'ha'],
      ['yo', 'yo'],
      ['zu', 'zu'],
      ['am', 'am'],
      ['wo', 'wo'],
      ['ln', 'ln'],
      ['ig', 'ig'],
      ['ff', 'ff'],
      ['bm', 'bm'],
      ['ak', 'ak'],
      ['mnk', 'mnk'],
      ['dyo', 'dyo'],
    ];
    for (const [code, expected] of cases) {
      expect(resolveWith(device({ languageCode: code }))).toBe(expected);
    }
  });

  it('reconnaît les variantes régionales par tag', () => {
    expect(resolveWith(device({ languageCode: 'pt', languageTag: 'pt-BR' }))).toBe('pt');
    expect(resolveWith(device({ languageCode: 'en', languageTag: 'en-GB' }))).toBe('en');
    expect(resolveWith(device({ languageCode: 'sw', languageTag: 'sw-KE' }))).toBe('sw');
  });

  it('absorbe les alias ISO des langues à codes multiples', () => {
    // Le peul et le mandingue ont plusieurs codes en circulation ; le twi est
    // la variété d'akan qu'Android expose.
    expect(resolveWith(device({ languageCode: 'ful' }))).toBe('ff');
    expect(resolveWith(device({ languageCode: 'fuf' }))).toBe('ff');
    expect(resolveWith(device({ languageCode: 'tw' }))).toBe('ak');
    expect(resolveWith(device({ languageTag: 'man-GM' }))).toBe('mnk');
    expect(resolveWith(device({ languageTag: 'man' }))).toBe('mnk');
  });
});

describe('resolveDeviceLocale — repli', () => {
  it('replie sur le français quand rien ne correspond', () => {
    expect(resolveWith(device({ languageCode: 'de', languageTag: 'de-DE' }))).toBe('fr');
    expect(resolveWith()).toBe('fr');
  });

  it('prend la première locale reconnue, pas la première de la liste', () => {
    // iOS renvoie les préférences ordonnées : une langue non supportée en tête
    // ne doit pas court-circuiter une langue supportée juste derrière.
    expect(
      resolveWith(
        device({ languageCode: 'de', languageTag: 'de-DE' }),
        device({ languageCode: 'sw', languageTag: 'sw-TZ' }),
      ),
    ).toBe('sw');
  });

  it('respecte l’ordre de préférence entre deux langues supportées', () => {
    expect(
      resolveWith(
        device({ languageCode: 'yo', languageTag: 'yo-NG' }),
        device({ languageCode: 'en', languageTag: 'en-NG' }),
      ),
    ).toBe('yo');
  });

  it('survit à des champs manquants ou nuls', () => {
    expect(resolveWith(device({ languageCode: null, languageTag: '' }))).toBe('fr');
  });
});

describe('isAppLocale', () => {
  it('accepte les 20 locales et rien d’autre', () => {
    for (const locale of APP_LOCALES) expect(isAppLocale(locale)).toBe(true);
    for (const value of ['', 'FR', 'ar', 'ar-DZ', 'de', null, undefined]) {
      expect(isAppLocale(value)).toBe(false);
    }
  });
});

describe('t', () => {
  it('rend la traduction de la locale active', () => {
    setI18nLocale('fr');
    expect(getI18nLocale()).toBe('fr');
    const inFrench = t('common.cancel');

    setI18nLocale('en');
    expect(getI18nLocale()).toBe('en');
    const inEnglish = t('common.cancel');

    expect(inFrench).toBe('Annuler');
    expect(inEnglish).not.toBe(inFrench);
  });

  it('interpole les placeholders', () => {
    setI18nLocale('fr');
    expect(t('notifications.minutesAgo', { count: 7 })).toBe('il y a 7 min');
  });

  it('ne jette pas sur un scope inexistant', () => {
    // `t(scope: string)` n'est pas typé : une faute de frappe compile. Le
    // comportement observable est un rendu dégradé, jamais un crash.
    setI18nLocale('fr');
    const rendered = t('cette.cle.nexiste.pas');
    expect(typeof rendered).toBe('string');
    expect(rendered).toContain('cette.cle.nexiste.pas');
  });

  it('remet le français quand la locale courante sort du jeu supporté', () => {
    i18n.locale = 'de-DE';
    expect(getI18nLocale()).toBe('fr');
    setI18nLocale('fr');
  });
});
