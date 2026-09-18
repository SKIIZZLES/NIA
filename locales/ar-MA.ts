import type { TranslationKeys } from './fr';

/**
 * Maghrebi Arabic / Darija (Morocco–Maghreb dialect), not MSA.
 * Arabic script; layout stays LTR — see README.
 */
const arMA: TranslationKeys = {
  common: {
    error: 'خطأ',
    or: 'ولا',
    email: 'الإيميل',
    password: 'كلمة السر',
    username: 'السميت',
    guest: 'ضيف',
    loading: 'كيتحمّل…',
  },
  brand: {
    tagline: 'فيديوات · ثقافات · مواهب · بلا حدود',
    heroPrimary: 'هنا، المواهب ديال أفريقيا كيمشيو بعيد',
    heroSecondary: 'أكثر من فيديوات — أفريقيا كاتحكي على راسها',
  },
  tabs: {
    home: 'الرئيسية',
    discover: 'اكتشف',
    create: 'نشر',
    notifications: 'الإشعارات',
    profile: 'البروفيل',
  },
  welcome: {
    createAccount: 'أنشئ كونط',
    signIn: 'دخل',
    mockHint:
      'Expo Go أصلي = مصادقة وهمية · Supabase كامل عبر الويب ولا البناء الأصلي',
    supabaseHint: 'مصادقة Supabase متّصلة',
    authMockBadge: 'AUTH MOCK MVP',
  },
  auth: {
    loginTitle: 'دخل',
    registerTitle: 'أنشئ كونط',
    signIn: 'دخل',
    createAccount: 'أنشئ الكونط ديالي',
    emailPlaceholder: 'you@email.com',
    usernamePlaceholder: 'السميت_ديالك',
    loginFail: 'ما قدرناش ندخلوك',
    registerFail: 'ما قدرناش نسجّلوك',
    mockLoginHint:
      'كيتقبل أي إيميل / كلمة سر. الجلسة محفوظة محلياً (AsyncStorage). حط EXPO_PUBLIC_SUPABASE_* فـ .env باش تفعّل Supabase.',
    supabaseLoginHint:
      'إيميل / كلمة سر عبر Supabase Auth. أنشئ كونط من شاشة التسجيل.',
    mockRegisterHint:
      'فورم تجريبي — بلا تحقق من السيرفر. كينشئ جلسة محلية.',
    supabaseRegisterHint:
      'تسجيل عبر Supabase Auth. البروفيل كيتخلق أوتوماتيك (محفّز SQL). عطّل «Confirm email» فـ Auth → Providers باش تجرّب بلا إيميل.',
    authMockBadge: 'AUTH MOCK MVP',
    authSupabaseBadge: 'AUTH SUPABASE',
  },
  google: {
    continue: 'كمّل مع Google',
    fail: 'الدخول بـ Google ما نجحش',
    alertTitle: 'Google',
    hintWeb: 'Google أصلي = بناء EAS ديال Android/iOS',
    hintMock: 'وضع وهمي: جلسة محلية (Expo Go ولا env ناقصة)',
    hintMissingId: 'حط EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID (EAS)',
  },
  create: {
    title: 'نشر',
    subtitleMock:
      'وضع وهمي — ميديا، تعليق، #هاشتاغات وفئة. كينشر فالخلاصة المحلية.',
    subtitleSupabase:
      'وضع Supabase — رفع لـ Storage + سطر videos (حالة published).',
    pickMedia: 'ختار ميديا (المعرض)',
    noMedia: 'ما خترتيش ميديا',
    video: 'فيديو',
    image: 'صورة',
    captionLabel: 'التعليق والهاشتاغات',
    captionPlaceholder: 'وصف الموهبة ديالك… زيد #africa #culture',
    hashtagHint: 'الكلمات اللي بـ # فالتعليق كيوليو هاشتاغات منين تنشر.',
    categoryLabel: 'الفئة',
    limits: 'أقصى %{minutes} د · %{mb} مو',
    publish: 'انشر',
    publishedMockTitle: 'تّنشر (وهمي)',
    publishedTitle: 'تّنشر',
    publishedMockBody: 'تزاد للخلاصة المحلية «لك».',
    publishedBody:
      'الفيديو تصاوب رفعو لـ Supabase Storage + جدول videos (حالة published).',
    publishFail: 'النشر ما نجحش',
    alertTooLarge: 'الملف كبير بزاف',
    alertTooLong: 'الفيديو طويل بزاف',
    alertMediaRequired: 'الميديا ضروريّة',
    alertCategory: 'الفئة',
    errNoMedia: 'ختار فيديو ولا صورة باش تنشر.',
    errTooLarge: 'الملف فات الحجم الأقصى (%{mb} مو).',
    errTooLong: 'الفيديو فات المدة القصوى (%{minutes} د).',
    errCategoryRequired: 'ختار فئة للبوست ديالك.',
  },
  profile: {
    defaultBio: 'بروفيل NIA',
    posts: 'المنشورات',
    followers: 'المتابعين',
    following: 'كنتبع',
    editProfile: 'عدّل البروفيل',
    viewPublic: 'شوف البروفيل العام ديالي',
    signOut: 'خرج',
    signIn: 'دخل',
    empty: 'ما كاين حتى منشور دابا.',
    language: 'اللغة',
  },
  notifications: {
    title: 'الإشعارات',
    subtitle: 'النشاط حول البروفيل والمنشورات ديالك.',
    emptyTitle: 'ما كاين والو دابا',
    emptyBody:
      'منين المجتمع يتفاعل مع المحتوى ديالك، غادي يبان هنا — بوضوح وبلا ضوضاء.',
    note:
      'دخل مع Supabase باش توصل الإعجابات والتعليقات والمتابعين الجداد. الرسائل الخاصة فالمرحلة 2.',
    someone: 'شي واحد',
    liked: 'عجبو الفيديو ديالك',
    commented: 'علّق على الفيديو ديالك',
    followed: 'تبعك',
    system: 'إشعار النظام',
    interacted: 'تفاعل معاك',
    justNow: 'دابا',
    minutesAgo: 'هادي %{count} د',
    hoursAgo: 'هادي %{count} س',
    daysAgo: 'هادي %{count} ي',
  },
  errors: {
    boundaryTitle: 'وقع شي خطأ',
  },
  language: {
    label: 'اللغة / Language',
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

export default arMA;
