import type { TranslationKeys } from './fr';

/**
 * Sudanese Arabic dialect (not MSA). Arabic script; layout stays LTR — see README.
 */
const arSD: TranslationKeys = {
  common: {
    error: 'خطأ',
    or: 'أو',
    email: 'الإيميل',
    password: 'الباسورد',
    username: 'اسم المستخدم',
    guest: 'ضيف',
    loading: 'قاعد يحمّل…',
  },
  brand: {
    tagline: 'فيديوهات · ثقافات · مواهب · بدون حدود',
    heroPrimary: 'هنا، مواهب أفريقيا بتمشي بعيد',
    heroSecondary: 'أكثر من فيديوهات — أفريقيا بتحكي قصتها',
  },
  tabs: {
    home: 'الرئيسية',
    discover: 'اكتشف',
    create: 'انشر',
    notifications: 'الإشعارات',
    profile: 'البروفايل',
  },
  welcome: {
    createAccount: 'افتح حساب',
    signIn: 'ادخل',
    mockHint:
      'Expo Go الأصلي = مصادقة وهمية · Supabase كامل عبر الويب أو البناء الأصلي',
    supabaseHint: 'مصادقة Supabase متصلة',
    authMockBadge: 'AUTH MOCK MVP',
  },
  auth: {
    loginTitle: 'ادخل',
    registerTitle: 'افتح حساب',
    signIn: 'ادخل',
    createAccount: 'افتح حسابي',
    emailPlaceholder: 'you@email.com',
    usernamePlaceholder: 'اسمك',
    loginFail: 'ما قدرنا ندخلك',
    registerFail: 'ما قدرنا نسجلك',
    mockLoginHint:
      'بيقبل أي إيميل / باسورد. الجلسة محفوظة محلياً (AsyncStorage). حط EXPO_PUBLIC_SUPABASE_* في .env عشان تفعّل Supabase.',
    supabaseLoginHint:
      'إيميل / باسورد عبر Supabase Auth. افتح حساب من شاشة التسجيل.',
    mockRegisterHint:
      'فورم تجريبي — ما فيه تحقق من السيرفر. بيعمل جلسة محلية.',
    supabaseRegisterHint:
      'تسجيل عبر Supabase Auth. البروفايل بيتخلق أوتوماتيك (محفّز SQL). عطّل «Confirm email» في Auth → Providers عشان تجرب بدون إيميل.',
    authMockBadge: 'AUTH MOCK MVP',
    authSupabaseBadge: 'AUTH SUPABASE',
  },
  google: {
    continue: 'كمّل مع Google',
    fail: 'الدخول بـ Google فشل',
    alertTitle: 'Google',
    hintWeb: 'Google الأصلي = بناء EAS لـ Android/iOS',
    hintMock: 'وضع وهمي: جلسة محلية (Expo Go أو env ناقصة)',
    hintMissingId: 'حط EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID (EAS)',
  },
  create: {
    title: 'انشر',
    subtitleMock:
      'وضع وهمي — ميديا، تعليق، #هاشتاغات وفئة. بينشر في الخلاصة المحلية.',
    subtitleSupabase:
      'وضع Supabase — رفع لـ Storage + صف videos (حالة published).',
    pickMedia: 'اختار ميديا (المعرض)',
    noMedia: 'ما اخترت ميديا',
    video: 'فيديو',
    image: 'صورة',
    captionLabel: 'التعليق والهاشتاغات',
    captionPlaceholder: 'وصف موهبتك… زيد #africa #culture',
    hashtagHint: 'الكلمات اللي بـ # في التعليق بتصير هاشتاغات وقت النشر.',
    categoryLabel: 'الفئة',
    limits: 'أقصى %{minutes} د · %{mb} م.ب',
    publish: 'انشر',
    publishedMockTitle: 'اتنشر (وهمي)',
    publishedTitle: 'اتنشر',
    publishedMockBody: 'اتضاف للخلاصة المحلية «ليك».',
    publishedBody:
      'الفيديو اترفع لـ Supabase Storage + جدول videos (حالة published).',
    publishFail: 'النشر فشل',
    alertTooLarge: 'الملف كبير زيادة',
    alertTooLong: 'الفيديو طويل زيادة',
    alertMediaRequired: 'الميديا مطلوبة',
    alertCategory: 'الفئة',
    errNoMedia: 'اختار فيديو أو صورة عشان تنشر.',
    errTooLarge: 'الملف تجاوز الحجم الأقصى (%{mb} م.ب).',
    errTooLong: 'الفيديو تجاوز المدة القصوى (%{minutes} د).',
    errCategoryRequired: 'اختار فئة للمنشور بتاعك.',
  },
  profile: {
    defaultBio: 'بروفايل NIA',
    posts: 'المنشورات',
    followers: 'المتابعين',
    following: 'بتتابع',
    editProfile: 'عدّل البروفايل',
    viewPublic: 'شوف بروفايلي العام',
    signOut: 'اطلع',
    signIn: 'ادخل',
    empty: 'ما في منشورات لسة.',
    language: 'اللغة',
  },
  notifications: {
    title: 'الإشعارات',
    subtitle: 'النشاط حول بروفايلك ومنشوراتك.',
    emptyTitle: 'ما في حاجة لسة',
    emptyBody:
      'لما المجتمع يتفاعل مع محتواك، هيظهر هنا — بوضوح ومن غير ضوضاء.',
    note:
      'ادخل مع Supabase عشان تستلم الإعجابات والتعليقات والمتابعين الجدد. الرسائل الخاصة في المرحلة 2.',
    someone: 'شخص',
    liked: 'عجبو الفيديو بتاعك',
    commented: 'علّق على الفيديو بتاعك',
    followed: 'تابعك',
    system: 'إشعار النظام',
    interacted: 'تفاعل معاك',
    justNow: 'الحين',
    minutesAgo: 'قبل %{count} د',
    hoursAgo: 'قبل %{count} س',
    daysAgo: 'قبل %{count} ي',
  },
  errors: {
    boundaryTitle: 'حصل خطأ',
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

export default arSD;
