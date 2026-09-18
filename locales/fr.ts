/** French (product primary). Add keys here; mirror in en.ts. */
const fr = {
  common: {
    error: 'Erreur',
    or: 'ou',
    email: 'Email',
    password: 'Mot de passe',
    username: 'Nom d\'utilisateur',
    guest: 'Invité',
    loading: 'Chargement…',
  },
  brand: {
    tagline: 'VIDÉOS · CULTURES · TALENTS · SANS FRONTIÈRES',
    heroPrimary: 'ICI, LES TALENTS AFRICAINS VONT PLUS LOIN',
    heroSecondary: 'PLUS QUE DES VIDÉOS UNE AFRIQUE QUI SE RACONTE',
  },
  tabs: {
    home: 'Accueil',
    discover: 'Découvrir',
    create: 'Publier',
    notifications: 'Notifications',
    profile: 'Profil',
  },
  welcome: {
    createAccount: 'Créer un compte',
    signIn: 'Se connecter',
    mockHint:
      'Expo Go natif = auth mock · Supabase complet via web ou build natif',
    supabaseHint: 'Auth Supabase connectée',
    authMockBadge: 'AUTH MOCK MVP',
  },
  auth: {
    loginTitle: 'Se connecter',
    registerTitle: 'Créer un compte',
    signIn: 'Se connecter',
    createAccount: 'Créer mon compte',
    emailPlaceholder: 'vous@email.com',
    usernamePlaceholder: 'votre_handle',
    loginFail: 'Connexion impossible',
    registerFail: 'Inscription impossible',
    mockLoginHint:
      'Accepte n’importe quel email / mot de passe. Session stockée localement (AsyncStorage). Remplissez EXPO_PUBLIC_SUPABASE_* dans .env pour activer Supabase.',
    supabaseLoginHint:
      'Connexion email / mot de passe via Supabase Auth. Créez un compte sur l’écran Inscription.',
    mockRegisterHint:
      'Formulaire stub — aucune validation serveur. Créera une session locale.',
    supabaseRegisterHint:
      'Inscription Supabase Auth. Un profil est créé automatiquement (trigger SQL). Désactivez « Confirm email » dans Auth → Providers pour tester sans mail.',
    authMockBadge: 'AUTH MOCK MVP',
    authSupabaseBadge: 'AUTH SUPABASE',
  },
  google: {
    continue: 'Continuer avec Google',
    fail: 'Connexion Google impossible',
    alertTitle: 'Google',
    hintWeb: 'Google natif = build EAS Android/iOS',
    hintMock: 'Mode mock : session locale (Expo Go ou env manquantes)',
    hintMissingId: 'Définissez EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID (EAS)',
  },
  create: {
    title: 'Créer',
    subtitleMock:
      'Mode mock — média, légende, #hashtags et catégorie. Publication dans le feed local.',
    subtitleSupabase:
      'Mode Supabase — upload Storage + ligne videos (statut published).',
    pickMedia: 'Choisir un média (galerie)',
    noMedia: 'Aucun média sélectionné',
    video: 'Vidéo',
    image: 'Image',
    captionLabel: 'Légende & hashtags',
    captionPlaceholder: 'Décrivez votre talent… Ajoutez #afrique #culture',
    hashtagHint:
      'Les #mots dans la légende deviennent des hashtags à la publication.',
    categoryLabel: 'Catégorie',
    limits: 'Max %{minutes} min · %{mb} Mo',
    publish: 'Publier',
    publishedMockTitle: 'Publié (mock)',
    publishedTitle: 'Publié',
    publishedMockBody: 'Ajouté au fil local « Pour toi ».',
    publishedBody:
      'Vidéo envoyée sur Supabase Storage + table videos (statut published).',
    publishFail: 'Échec de la publication',
    alertTooLarge: 'Fichier trop volumineux',
    alertTooLong: 'Vidéo trop longue',
    alertMediaRequired: 'Média requis',
    alertCategory: 'Catégorie',
    errNoMedia: 'Sélectionnez une vidéo ou une image à publier.',
    errTooLarge: 'Le fichier dépasse la taille maximale (%{mb} Mo).',
    errTooLong: 'La vidéo dépasse la durée maximale (%{minutes} min).',
    errCategoryRequired: 'Choisissez une catégorie pour votre publication.',
  },
  profile: {
    defaultBio: 'Profil NIA',
    posts: 'Publications',
    followers: 'Abonnés',
    following: 'Abonnements',
    editProfile: 'Modifier le profil',
    viewPublic: 'Voir mon profil public',
    signOut: 'Se déconnecter',
    signIn: 'Se connecter',
    empty: 'Aucune publication pour l’instant.',
    language: 'Langue',
  },
  notifications: {
    title: 'Notifications',
    subtitle: 'Activité autour de votre profil et de vos publications.',
    emptyTitle: 'Rien pour l’instant',
    emptyBody:
      'Quand la communauté interagit avec vos contenus, tout apparaîtra ici — clairement, sans bruit inutile.',
    note:
      'Connectez-vous avec Supabase pour recevoir likes, commentaires et nouveaux abonnés. Messagerie privée reportée en phase 2.',
    someone: 'Quelqu’un',
    liked: 'a aimé votre vidéo',
    commented: 'a commenté votre vidéo',
    followed: 's’est abonné·e à vous',
    system: 'Notification système',
    interacted: 'a interagi avec vous',
    justNow: 'à l’instant',
    minutesAgo: 'il y a %{count} min',
    hoursAgo: 'il y a %{count} h',
    daysAgo: 'il y a %{count} j',
  },
  errors: {
    boundaryTitle: 'Une erreur est survenue',
  },
  language: {
    label: 'Langue / Language',
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

type DeepStringify<T> = {
  [K in keyof T]: T[K] extends string ? string : DeepStringify<T[K]>;
};

export default fr;
export type TranslationKeys = DeepStringify<typeof fr>;
