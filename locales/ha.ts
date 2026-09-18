import type { TranslationKeys } from './fr';

/** Hausa — keys in sync with fr.ts. */
const ha: TranslationKeys = {
  common: {
    error: 'Kuskure',
    or: 'ko',
    email: 'Imel',
    password: 'Kalmar sirri',
    username: 'Sunan mai amfani',
    guest: 'Baƙo',
    loading: 'Ana lodawa…',
  },
  brand: {
    tagline: 'BIDIYO · AL’ADU · BASIRA · BA DOKOKI',
    heroPrimary: 'ANAN, BASIRAR AFIRKA TA KARA TAFIYA',
    heroSecondary: 'FIYE DA BIDIYO — AFIRKA DA KE BA DA LABARINTA',
  },
  tabs: {
    home: 'Gida',
    discover: 'Gano',
    create: 'Ƙirƙiri',
    notifications: 'Sanarwa',
    profile: 'Bayanan martaba',
  },
  welcome: {
    createAccount: 'Ƙirƙiri asusu',
    signIn: 'Shiga',
    mockHint:
      'Expo Go na asali = auth na kwaikwayo · Cikakken Supabase ta yanar gizo ko ginin asali',
    supabaseHint: 'Auth na Supabase an haɗa',
    authMockBadge: 'AUTH MOCK MVP',
  },
  auth: {
    loginTitle: 'Shiga',
    registerTitle: 'Ƙirƙiri asusu',
    signIn: 'Shiga',
    createAccount: 'Ƙirƙiri asusuna',
    emailPlaceholder: 'kai@email.com',
    usernamePlaceholder: 'sunanka',
    loginFail: 'An kasa shiga',
    registerFail: 'An kasa yin rajista',
    mockLoginHint:
      'Yana karɓar kowace imel / kalmar sirri. Ana adana zama a cikin na’ura (AsyncStorage). Saita EXPO_PUBLIC_SUPABASE_* a .env don kunna Supabase.',
    supabaseLoginHint:
      'Imel / kalmar sirri ta Supabase Auth. Ƙirƙiri asusu a allon Rajista.',
    mockRegisterHint:
      'Fom na gwaji — babu tabbatarwa ta uwar garken. Yana ƙirƙirar zama na gida.',
    supabaseRegisterHint:
      'Rajista ta Supabase Auth. Ana ƙirƙirar bayanan martaba ta atomatik (SQL trigger). Kashe «Confirm email» a Auth → Providers don gwaji ba tare da imel ba.',
    authMockBadge: 'AUTH MOCK MVP',
    authSupabaseBadge: 'AUTH SUPABASE',
  },
  google: {
    continue: 'Ci gaba da Google',
    fail: 'Shiga da Google ya gaza',
    alertTitle: 'Google',
    hintWeb: 'Google na asali = ginin EAS Android/iOS',
    hintMock: 'Yanayin kwaikwayo: zama na gida (Expo Go ko env ƙasa)',
    hintMissingId: 'Saita EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID (EAS)',
  },
  create: {
    title: 'Ƙirƙiri',
    subtitleMock:
      'Yanayin kwaikwayo — midiya, rubutu, #hashtags da rukuni. Yana wallafa zuwa feed na gida.',
    subtitleSupabase:
      'Yanayin Supabase — ɗora Storage + layin videos (matsayi published).',
    pickMedia: 'Zaɓi midiya (gallery)',
    noMedia: 'Babu midiya da aka zaɓa',
    video: 'Bidiyo',
    image: 'Hoto',
    captionLabel: 'Rubutu da hashtags',
    captionPlaceholder: 'Bayyana basirarka… Ƙara #africa #culture',
    hashtagHint: '#kalmomi a cikin rubutu sun zama hashtags lokacin wallafa.',
    categoryLabel: 'Rukuni',
    limits: 'Mafi yawa %{minutes} minti · %{mb} MB',
    publish: 'Wallafa',
    publishedMockTitle: 'An wallafa (kwaikwayo)',
    publishedTitle: 'An wallafa',
    publishedMockBody: 'An ƙara zuwa feed na gida «Don kai».',
    publishedBody:
      'An ɗora bidiyo zuwa Supabase Storage + teburin videos (matsayi published).',
    publishFail: 'Wallafa ta gaza',
    alertTooLarge: 'Fayil ya yi girma sosai',
    alertTooLong: 'Bidiyo ya yi tsawo sosai',
    alertMediaRequired: 'Ana buƙatar midiya',
    alertCategory: 'Rukuni',
    errNoMedia: 'Zaɓi bidiyo ko hoto don wallafa.',
    errTooLarge: 'Fayil ya wuce girman mafi yawa (%{mb} MB).',
    errTooLong: 'Bidiyo ya wuce tsawon lokaci mafi yawa (%{minutes} minti).',
    errCategoryRequired: 'Zaɓi rukuni don wallafarka.',
  },
  profile: {
    defaultBio: 'Bayanan martaba na NIA',
    posts: 'Wallafe-wallafe',
    followers: 'Mabiya',
    following: 'Ana bi',
    editProfile: 'Gyara bayanan martaba',
    viewPublic: 'Duba bayanana na jama’a',
    signOut: 'Fita',
    signIn: 'Shiga',
    empty: 'Babu wallafe-wallafe tukuna.',
    language: 'Harshe',
  },
  notifications: {
    title: 'Sanarwa',
    subtitle: 'Ayyuka game da bayanan martabarka da wallafe-wallafenkarka.',
    emptyTitle: 'Babu komai tukuna',
    emptyBody:
      'Idan al’umma ta yi hulɗa da abubuwanka, za su bayyana a nan — a bayyane, ba tare da hayaniya ba.',
    note:
      'Shiga da Supabase don karɓar likes, sharhi da sabbin mabiya. Saƙonnin sirri shine mataki na 2.',
    someone: 'Wani',
    liked: 'ya so bidiyonka',
    commented: 'ya yi sharhi a kan bidiyonka',
    followed: 'ya bi ka',
    system: 'Sanarwar tsarin',
    interacted: 'ya yi hulɗa da kai',
    justNow: 'yanzu',
    minutesAgo: 'mintoci %{count} da suka wuce',
    hoursAgo: 'awa %{count} da suka wuce',
    daysAgo: 'kwana %{count} da suka wuce',
  },
  errors: {
    boundaryTitle: 'Wani abu ya yi kuskure',
  },
  language: {
    label: 'Harshe / Language',
    fr: 'FR',
    en: 'EN',
    es: 'ES',
    pt: 'PT',
    sw: 'SW',
    ha: 'HA',
    'ar-MA': 'Darija',
    'ar-SD': 'SD',
  },
};

export default ha;
