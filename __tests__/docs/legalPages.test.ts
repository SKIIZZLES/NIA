/**
 * Pages légales publiées (docs/legal, servies par GitHub Pages).
 *
 * Ce sont des engagements publics : CGU, règles de la communauté, normes de
 * protection de l'enfance exigées par Google Play. Ces tests figent ce que le
 * sprint sécurité S1 a validé : aucune nudité, 13 ans minimum, comment
 * signaler, contact, mention de PHAROS, et plus de « suppression immédiate »
 * pour les fichiers (ils partent sous une dizaine de minutes).
 */
import {
  accountDeletionUrl,
  childSafetyUrl,
  communityGuidelinesUrl,
  privacyPolicyUrl,
  termsOfServiceUrl,
} from '@/constants/legal';

/** Même raison que keysUsed.test.ts : pas de @types/node global. */
type FsMinimal = {
  existsSync(chemin: string): boolean;
  readdirSync(chemin: string): string[];
  readFileSync(chemin: string, encodage: 'utf8'): string;
};
declare function require(id: string): unknown;
declare const __filename: string;
const fs = require('fs') as FsMinimal;

const DOSSIER = __filename.replace(/\\/g, '/').replace(/\/__tests__\/docs\/[^/]+$/, '') + '/docs/legal';
const lire = (nom: string) => fs.readFileSync(`${DOSSIER}/${nom}`, 'utf8');
const texte = (nom: string) =>
  lire(nom)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ');
const PAGES = fs.readdirSync(DOSSIER).filter((f) => f.endsWith('.html'));

describe('pages légales — témoin', () => {
  it('trouve les onze pages', () => {
    expect(PAGES.sort()).toEqual(
      [
        'child-safety.html',
        'community-guidelines.html',
        'conditions.html',
        'confidentialite.html',
        'delete-account.html',
        'index.html',
        'privacy.html',
        'regles-communaute.html',
        'securite-enfants.html',
        'suppression-compte.html',
        'terms.html',
      ].sort(),
    );
  });
});

describe('chaque URL câblée dans l’app existe dans docs/legal', () => {
  const fonctions = [
    privacyPolicyUrl,
    accountDeletionUrl,
    termsOfServiceUrl,
    communityGuidelinesUrl,
    childSafetyUrl,
  ];
  it.each(['fr', 'en'])('%s', (locale) => {
    for (const f of fonctions) {
      const nom = f(locale).split('/').pop() as string;
      expect(fs.existsSync(`${DOSSIER}/${nom}`)).toBe(true);
    }
  });
});

describe.each(PAGES)('%s', (page) => {
  it('n’a aucun lien relatif mort', () => {
    const liens = [...lire(page).matchAll(/href="([^"#:]+\.(?:html|css))"/g)].map((m) => m[1]);
    const morts = liens.filter((l) => !fs.existsSync(`${DOSSIER}/${l}`));
    expect(morts).toEqual([]);
  });

  it('n’a plus de marqueur à remplir', () => {
    expect(lire(page)).not.toMatch(/\[\[|a-remplir|TODO|REPLACE/);
  });
});

describe('CGU, règles de la communauté et normes enfance', () => {
  const PAGES_REGLES = [
    'conditions.html',
    'terms.html',
    'regles-communaute.html',
    'community-guidelines.html',
    'securite-enfants.html',
    'child-safety.html',
  ];

  it.each(PAGES_REGLES)('%s : contact, 13 ans, PHAROS, signalement', (page) => {
    const t = texte(page);
    expect(t).toContain('niaapp@outlook.com');
    expect(t).toMatch(/13 ans|at least 13|age of 13/);
    expect(t).toContain('PHAROS');
    expect(t).toContain('internet-signalement.gouv.fr');
    expect(t).toMatch(/⋯.{0,40}(Signaler|Report)/);
  });

  it.each(['conditions.html', 'regles-communaute.html'])(
    '%s : les dix catégories interdites sont nommées',
    (page) => {
      const t = texte(page).toLowerCase();
      for (const categorie of [
        'pédocriminalité',
        'menaces',
        'négrophobie',
        'racisme',
        'homophobes',
        'actes inhumains',
        'nudité',
        'harcèlement',
        'spam',
        'illicites',
      ]) {
        expect(t).toContain(categorie);
      }
    },
  );

  it.each(['terms.html', 'community-guidelines.html'])(
    '%s : les dix catégories interdites sont nommées',
    (page) => {
      const t = texte(page).toLowerCase();
      for (const categorie of [
        'child sexual abuse',
        'threats',
        'anti-black racism',
        'racism and hate',
        'homophobic',
        'inhumane acts',
        'nudity',
        'harassment',
        'spam',
        'illegal',
      ]) {
        expect(t).toContain(categorie);
      }
    },
  );

  it('aucune nudité, même avec le marquage 18+', () => {
    expect(texte('conditions.html')).toContain(
      'aucune nudité et aucun contenu sexuel ne sont acceptés sur NIA',
    );
    expect(texte('regles-communaute.html')).toMatch(/même avec le marquage 18\+/);
    expect(texte('terms.html')).toContain(
      'no nudity and no sexual content are allowed on NIA',
    );
    expect(texte('community-guidelines.html')).toMatch(/even with the 18\+ label/);
    for (const page of PAGES_REGLES.slice(0, 4)) {
      expect(texte(page)).toMatch(/n'autorise jamais|never allows/);
    }
  });

  it('ni abonnement ni don', () => {
    expect(texte('conditions.html')).toContain('ni abonnement, ni don, ni achat');
    expect(texte('terms.html')).toContain('no subscription, no donation and no in-app purchase');
  });
});

describe('suppression de compte : plus de « immédiate » pour les fichiers', () => {
  it.each(['suppression-compte.html', 'confidentialite.html'])('%s', (page) => {
    const t = texte(page);
    expect(t).not.toMatch(/immédiate et définitive/i);
    expect(t).not.toMatch(/depuis l'application \(immédiat\)/i);
    expect(t).toMatch(/dizaine de minutes/);
  });

  it.each(['delete-account.html', 'privacy.html'])('%s', (page) => {
    const t = texte(page);
    expect(t).not.toMatch(/immediate and permanent/i);
    expect(t).not.toMatch(/from the app \(immediate\)/i);
    expect(t).toMatch(/about ten minutes/);
  });
});
