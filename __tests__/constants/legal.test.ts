/**
 * URL légales — Google Play exige que la politique de confidentialité soit
 * atteignable depuis l'application, et que l'URL soit publique et stable.
 *
 * Une faute de frappe ici produit un lien mort dans l'app et un rejet à la
 * revue, sans rien casser au typecheck ni au bundle.
 */
import { accountDeletionUrl, privacyPolicyUrl } from '@/constants/legal';
import { APP_LOCALES } from '@/lib/i18n';

const BASE = 'https://skiizzles.github.io/NIA/legal';

describe('privacyPolicyUrl', () => {
  it('sert l’anglais à en, le français partout ailleurs', () => {
    expect(privacyPolicyUrl('en')).toBe(`${BASE}/privacy.html`);
    expect(privacyPolicyUrl('fr')).toBe(`${BASE}/confidentialite.html`);
    expect(privacyPolicyUrl('ar-MA')).toBe(`${BASE}/confidentialite.html`);
  });

  it('renvoie une URL servie pour chacune des 20 locales', () => {
    // Le dossier docs/legal ne contient que ces deux pages. Toute locale doit
    // tomber sur l'une des deux, jamais sur une URL fabriquée depuis son code.
    const servies = new Set([`${BASE}/privacy.html`, `${BASE}/confidentialite.html`]);
    for (const locale of APP_LOCALES) {
      expect(servies.has(privacyPolicyUrl(locale))).toBe(true);
    }
  });
});

describe('accountDeletionUrl', () => {
  it('sert l’anglais à en, le français partout ailleurs', () => {
    expect(accountDeletionUrl('en')).toBe(`${BASE}/delete-account.html`);
    expect(accountDeletionUrl('fr')).toBe(`${BASE}/suppression-compte.html`);
    expect(accountDeletionUrl('yo')).toBe(`${BASE}/suppression-compte.html`);
  });

  it('renvoie une URL servie pour chacune des 20 locales', () => {
    const servies = new Set([
      `${BASE}/delete-account.html`,
      `${BASE}/suppression-compte.html`,
    ]);
    for (const locale of APP_LOCALES) {
      expect(servies.has(accountDeletionUrl(locale))).toBe(true);
    }
  });
});

describe('forme des URL', () => {
  it('sont en HTTPS, sur le domaine du dépôt, sans double slash', () => {
    // Google Play refuse une politique qui n'est pas publiquement accessible ;
    // une URL en http ou mal formée ne passe pas la revue.
    for (const url of [
      privacyPolicyUrl('fr'),
      privacyPolicyUrl('en'),
      accountDeletionUrl('fr'),
      accountDeletionUrl('en'),
    ]) {
      expect(url.startsWith('https://skiizzles.github.io/NIA/legal/')).toBe(true);
      expect(url.slice('https://'.length)).not.toContain('//');
      expect(url.endsWith('.html')).toBe(true);
    }
  });
});
