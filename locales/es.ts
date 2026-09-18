import type { TranslationKeys } from './fr';

/** Spanish — keys in sync with fr.ts. */
const es: TranslationKeys = {
  common: {
    error: 'Error',
    or: 'o',
    email: 'Correo electrónico',
    password: 'Contraseña',
    username: 'Nombre de usuario',
    guest: 'Invitado',
    loading: 'Cargando…',
  },
  brand: {
    tagline: 'VÍDEOS · CULTURAS · TALENTOS · SIN FRONTERAS',
    heroPrimary: 'AQUÍ, LOS TALENTOS AFRICANOS VAN MÁS LEJOS',
    heroSecondary: 'MÁS QUE VÍDEOS — UN ÁFRICA QUE CUENTA SU HISTORIA',
  },
  tabs: {
    home: 'Inicio',
    discover: 'Descubrir',
    create: 'Crear',
    notifications: 'Notificaciones',
    profile: 'Perfil',
  },
  welcome: {
    createAccount: 'Crear una cuenta',
    signIn: 'Iniciar sesión',
    mockHint:
      'Expo Go nativo = auth mock · Supabase completo vía web o build nativo',
    supabaseHint: 'Auth de Supabase conectada',
    authMockBadge: 'AUTH MOCK MVP',
  },
  auth: {
    loginTitle: 'Iniciar sesión',
    registerTitle: 'Crear una cuenta',
    signIn: 'Iniciar sesión',
    createAccount: 'Crear mi cuenta',
    emailPlaceholder: 'tu@email.com',
    usernamePlaceholder: 'tu_usuario',
    loginFail: 'No se pudo iniciar sesión',
    registerFail: 'No se pudo registrar',
    mockLoginHint:
      'Acepta cualquier correo / contraseña. Sesión guardada localmente (AsyncStorage). Define EXPO_PUBLIC_SUPABASE_* en .env para activar Supabase.',
    supabaseLoginHint:
      'Correo / contraseña vía Supabase Auth. Crea una cuenta en la pantalla de Registro.',
    mockRegisterHint:
      'Formulario stub — sin validación en el servidor. Crea una sesión local.',
    supabaseRegisterHint:
      'Registro con Supabase Auth. Se crea un perfil automáticamente (trigger SQL). Desactiva «Confirm email» en Auth → Providers para probar sin correo.',
    authMockBadge: 'AUTH MOCK MVP',
    authSupabaseBadge: 'AUTH SUPABASE',
  },
  google: {
    continue: 'Continuar con Google',
    fail: 'Falló el inicio de sesión con Google',
    alertTitle: 'Google',
    hintWeb: 'Google nativo = build EAS Android/iOS',
    hintMock: 'Modo mock: sesión local (Expo Go o env faltantes)',
    hintMissingId: 'Define EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID (EAS)',
  },
  create: {
    title: 'Crear',
    subtitleMock:
      'Modo mock — media, descripción, #hashtags y categoría. Publica en el feed local.',
    subtitleSupabase:
      'Modo Supabase — subida a Storage + fila videos (estado published).',
    pickMedia: 'Elegir media (galería)',
    noMedia: 'Ninguna media seleccionada',
    video: 'Vídeo',
    image: 'Imagen',
    captionLabel: 'Descripción y hashtags',
    captionPlaceholder: 'Describe tu talento… Añade #africa #cultura',
    hashtagHint: 'Las #palabras en la descripción se convierten en hashtags al publicar.',
    categoryLabel: 'Categoría',
    limits: 'Máx. %{minutes} min · %{mb} MB',
    publish: 'Publicar',
    publishedMockTitle: 'Publicado (mock)',
    publishedTitle: 'Publicado',
    publishedMockBody: 'Añadido al feed local «Para ti».',
    publishedBody:
      'Vídeo subido a Supabase Storage + tabla videos (estado published).',
    publishFail: 'Error al publicar',
    alertTooLarge: 'Archivo demasiado grande',
    alertTooLong: 'Vídeo demasiado largo',
    alertMediaRequired: 'Media requerida',
    alertCategory: 'Categoría',
    errNoMedia: 'Selecciona un vídeo o una imagen para publicar.',
    errTooLarge: 'El archivo supera el tamaño máximo (%{mb} MB).',
    errTooLong: 'El vídeo supera la duración máxima (%{minutes} min).',
    errCategoryRequired: 'Elige una categoría para tu publicación.',
  },
  profile: {
    defaultBio: 'Perfil NIA',
    posts: 'Publicaciones',
    followers: 'Seguidores',
    following: 'Siguiendo',
    editProfile: 'Editar perfil',
    viewPublic: 'Ver mi perfil público',
    signOut: 'Cerrar sesión',
    signIn: 'Iniciar sesión',
    empty: 'Aún no hay publicaciones.',
    language: 'Idioma',
  },
  notifications: {
    title: 'Notificaciones',
    subtitle: 'Actividad en torno a tu perfil y publicaciones.',
    emptyTitle: 'Nada todavía',
    emptyBody:
      'Cuando la comunidad interactúe con tu contenido, aparecerá aquí — con claridad, sin ruido.',
    note:
      'Inicia sesión con Supabase para recibir me gusta, comentarios y nuevos seguidores. Mensajería privada en la fase 2.',
    someone: 'Alguien',
    liked: 'le gustó tu vídeo',
    commented: 'comentó tu vídeo',
    followed: 'te siguió',
    system: 'Notificación del sistema',
    interacted: 'interactuó contigo',
    justNow: 'ahora mismo',
    minutesAgo: 'hace %{count} min',
    hoursAgo: 'hace %{count} h',
    daysAgo: 'hace %{count} d',
  },
  errors: {
    boundaryTitle: 'Algo salió mal',
  },
  language: {
    label: 'Idioma / Language',
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

export default es;
