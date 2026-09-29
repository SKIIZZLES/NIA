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
