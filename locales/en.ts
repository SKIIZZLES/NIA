import type { TranslationKeys } from './fr';

/** English — keep keys in sync with fr.ts for future African locales. */
const en: TranslationKeys = {
  common: {
    error: 'Error',
    or: 'or',
    email: 'Email',
    password: 'Password',
    username: 'Username',
    guest: 'Guest',
    loading: 'Loading…',
  },
  brand: {
    tagline: 'VIDEOS · CULTURES · TALENTS · WITHOUT BORDERS',
    heroPrimary: 'HERE, AFRICAN TALENTS GO FURTHER',
    heroSecondary: 'MORE THAN VIDEOS — AN AFRICA THAT TELLS ITS STORY',
  },
  tabs: {
    home: 'Home',
    discover: 'Discover',
    create: 'Create',
    notifications: 'Notifications',
    profile: 'Profile',
  },
  welcome: {
    createAccount: 'Create an account',
    signIn: 'Sign in',
    mockHint:
      'Native Expo Go = mock auth · Full Supabase via web or native build',
    supabaseHint: 'Supabase auth connected',
    authMockBadge: 'AUTH MOCK MVP',
  },
  auth: {
    loginTitle: 'Sign in',
    registerTitle: 'Create an account',
    signIn: 'Sign in',
    createAccount: 'Create my account',
    emailPlaceholder: 'you@email.com',
    usernamePlaceholder: 'your_handle',
    loginFail: 'Could not sign in',
    registerFail: 'Could not register',
    mockLoginHint:
      'Accepts any email / password. Session stored locally (AsyncStorage). Set EXPO_PUBLIC_SUPABASE_* in .env to enable Supabase.',
    supabaseLoginHint:
      'Email / password via Supabase Auth. Create an account on the Sign up screen.',
    mockRegisterHint:
      'Stub form — no server validation. Creates a local session.',
    supabaseRegisterHint:
      'Supabase Auth signup. A profile is created automatically (SQL trigger). Disable “Confirm email” in Auth → Providers to test without mail.',
    authMockBadge: 'AUTH MOCK MVP',
    authSupabaseBadge: 'AUTH SUPABASE',
  },
  google: {
    continue: 'Continue with Google',
    fail: 'Google sign-in failed',
    alertTitle: 'Google',
    hintWeb: 'Native Google = EAS Android/iOS build',
    hintMock: 'Mock mode: local session (Expo Go or missing env)',
    hintMissingId: 'Set EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID (EAS)',
  },
  create: {
    title: 'Create',
    subtitleMock:
      'Mock mode — media, caption, #hashtags and category. Publishes to the local feed.',
    subtitleSupabase:
      'Supabase mode — Storage upload + videos row (published status).',
    pickMedia: 'Choose media (gallery)',
    noMedia: 'No media selected',
    video: 'Video',
    image: 'Image',
    captionLabel: 'Caption & hashtags',
    captionPlaceholder: 'Describe your talent… Add #africa #culture',
    hashtagHint: '#words in the caption become hashtags on publish.',
    categoryLabel: 'Category',
    limits: 'Max %{minutes} min · %{mb} MB',
    publish: 'Publish',
    publishedMockTitle: 'Published (mock)',
    publishedTitle: 'Published',
    publishedMockBody: 'Added to the local “For you” feed.',
    publishedBody:
      'Video uploaded to Supabase Storage + videos table (published status).',
    publishFail: 'Publish failed',
    alertTooLarge: 'File too large',
    alertTooLong: 'Video too long',
    alertMediaRequired: 'Media required',
    alertCategory: 'Category',
    errNoMedia: 'Select a video or image to publish.',
    errTooLarge: 'File exceeds the maximum size (%{mb} MB).',
    errTooLong: 'Video exceeds the maximum duration (%{minutes} min).',
    errCategoryRequired: 'Choose a category for your post.',
  },
  profile: {
    defaultBio: 'NIA profile',
    posts: 'Posts',
    followers: 'Followers',
    following: 'Following',
    editProfile: 'Edit profile',
    viewPublic: 'View my public profile',
    signOut: 'Sign out',
    signIn: 'Sign in',
    empty: 'No posts yet.',
    language: 'Language',
  },
  notifications: {
    title: 'Notifications',
    subtitle: 'Activity around your profile and posts.',
    emptyTitle: 'Nothing yet',
    emptyBody:
      'When the community interacts with your content, it will show up here — clearly, without noise.',
    note:
      'Sign in with Supabase to receive likes, comments and new followers. Private messaging is phase 2.',
    someone: 'Someone',
    liked: 'liked your video',
    commented: 'commented on your video',
    followed: 'followed you',
    system: 'System notification',
    interacted: 'interacted with you',
    justNow: 'just now',
    minutesAgo: '%{count} min ago',
    hoursAgo: '%{count} h ago',
    daysAgo: '%{count} d ago',
  },
  errors: {
    boundaryTitle: 'Something went wrong',
  },
  language: {
    label: 'Language / Langue',
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

export default en;
