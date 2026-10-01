/**
 * URL légales publiées hors de l'application.
 *
 * Servies par GitHub Pages depuis `docs/` du dépôt (public, donc gratuit).
 * Google Play exige que la politique de confidentialité soit atteignable
 * depuis l'application ET depuis une URL publique, non géo-restreinte, non
 * modifiable par le lecteur.
 *
 * Ces liens ne répondent qu'une fois Pages activé : Settings → Pages →
 * Source « Deploy from a branch », branche `main`, dossier `/docs`.
 */
const BASE = 'https://skiizzles.github.io/NIA/legal';

/** Politique de confidentialité, dans la langue disponible la plus proche. */
export function privacyPolicyUrl(locale: string): string {
  return locale === 'en' ? `${BASE}/privacy.html` : `${BASE}/confidentialite.html`;
}

/** Page publique de demande de suppression de compte. */
export function accountDeletionUrl(locale: string): string {
  return locale === 'en' ? `${BASE}/delete-account.html` : `${BASE}/suppression-compte.html`;
}

/**
 * Conditions d'utilisation. Réclamées par les portails développeur (Google,
 * ex-Snapchat) à côté de la politique, et attendues par la fiche Play dès qu'une app
 * héberge des contenus publiés par ses utilisateurs.
 */
export function termsOfServiceUrl(locale: string): string {
  return locale === 'en' ? `${BASE}/terms.html` : `${BASE}/conditions.html`;
}

/**
 * Règles de la communauté : ce qui est interdit, le signalement, les sanctions.
 * Le socle contractuel reste les CGU ; cette page les explique en clair.
 */
export function communityGuidelinesUrl(locale: string): string {
  return locale === 'en'
    ? `${BASE}/community-guidelines.html`
    : `${BASE}/regles-communaute.html`;
}

/**
 * Normes de protection de l'enfance (CSAE). Google Play (Child Safety
 * Standards) exige une page publique, à renseigner dans la Play Console.
 */
export function childSafetyUrl(locale: string): string {
  return locale === 'en' ? `${BASE}/child-safety.html` : `${BASE}/securite-enfants.html`;
}

/** Contact unique : questions, signalements hors application, recours. */
export const CONTACT_EMAIL = 'niaapp@outlook.com';

/**
 * Signalement aux autorités (France) — affiché pour la pédocriminalité (P0).
 * PHAROS : plateforme officielle de signalement des contenus illicites.
 * 119 : Allô Enfance en Danger (gratuit, 24 h/24). 17 : police / gendarmerie.
 */
export const PHAROS_URL = 'https://www.internet-signalement.gouv.fr';
export const CHILD_HELPLINE = '119';
export const POLICE_NUMBER = '17';

/** Lien `mailto:` vers le contact, avec un objet optionnel (encodé). */
export function contactMailto(subject?: string): string {
  const base = `mailto:${CONTACT_EMAIL}`;
  return subject ? `${base}?subject=${encodeURIComponent(subject)}` : base;
}

/**
 * Domaine réservé aux comptes créés par l'ancienne connexion Snapchat (retirée
 * de l'app le 01/10/2026 ; les comptes existants restent)
 * (`snapchat_{id}@users.nia.app`, voir supabase/functions/snapchat-auth).
 * Une inscription e-mail sur ce domaine pourrait pré-créer le compte qu'un
 * utilisateur Snap recevrait ensuite : l'écran d'inscription la refuse.
 * Refus aussi côté serveur une fois la migration 017 appliquée (trigger sur
 * auth.users ; seule l'Edge Function snapchat-auth peut créer ces comptes).
 */
const RESERVED_SIGNUP_DOMAINS = ['users.nia.app'];

export function isReservedSignupEmail(email: string): boolean {
  const at = email.trim().toLowerCase().lastIndexOf('@');
  if (at < 0) return false;
  const domain = email.trim().toLowerCase().slice(at + 1).replace(/\.+$/, '');
  return RESERVED_SIGNUP_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));
}
