/**
 * Toute clé demandée par un écran existe dans le dictionnaire.
 *
 * C'est le trou le plus large du projet en matière d'i18n : `t(scope: string)`
 * n'est pas typé. `t('comments.deleteConfirmTitel')` compile, passe le bundle,
 * passe la CI — et affiche la chaîne brute à l'écran, dans les vingt langues.
 * Les invariants structurels du fichier voisin comparent les locales entre
 * elles ; ils ne voient pas une clé demandée qui n'existe nulle part.
 *
 * Le contrôle est fait sur `fr`, dictionnaire de référence, parce que
 * `TranslationKeys = DeepStringify<typeof fr>` force les dix-neuf autres à
 * porter exactement les mêmes clés — une locale amputée casse `tsc`.
 */
import fr from '@/locales/fr';

/**
 * Le système de fichiers est déclaré ici, en local, plutôt qu'en ajoutant
 * `@types/node` au champ `types` du tsconfig : ce champ est global, et typer
 * Node pour tout le projet changerait la signature de `setTimeout` dans du code
 * React Native. Ce test est le seul endroit qui lit des fichiers.
 */
type EntreeDossier = { name: string; isDirectory(): boolean };
type FsMinimal = {
  existsSync(chemin: string): boolean;
  readdirSync(chemin: string, options: { withFileTypes: true }): EntreeDossier[];
  readFileSync(chemin: string, encodage: 'utf8'): string;
};
declare function require(id: string): unknown;
declare const __filename: string;
const fs = require('fs') as FsMinimal;

/** `__tests__/locales/` → racine du dépôt. Les chemins restent en POSIX. */
const RACINE = __filename.replace(/\/__tests__\/locales\/[^/]+$/, '');
const DOSSIERS = ['app', 'components', 'context'];

/**
 * `t('a.b')` uniquement, en écartant ce qui finit par un `t` collé à un nom :
 * `Dimensions.get('window')` se lit sinon comme `t('window')`.
 */
const APPEL_T = /(?<![A-Za-z0-9_$.])t\(\s*'([a-z][\w]*(?:\.[\w]+)+)'\s*\)/g;

function fichiersSources(dossier: string): string[] {
  const base = `${RACINE}/${dossier}`;
  if (!fs.existsSync(base)) return [];
  const sortie: string[] = [];
  for (const entree of fs.readdirSync(base, { withFileTypes: true })) {
    if (entree.isDirectory()) {
      sortie.push(...fichiersSources(`${dossier}/${entree.name}`));
    } else if (/\.tsx?$/.test(entree.name)) {
      sortie.push(`${dossier}/${entree.name}`);
    }
  }
  return sortie;
}

function valeur(cle: string): unknown {
  return cle
    .split('.')
    .reduce<unknown>(
      (courant, segment) =>
        courant && typeof courant === 'object'
          ? (courant as Record<string, unknown>)[segment]
          : undefined,
      fr,
    );
}

const utilisees = new Map<string, string[]>();
for (const dossier of DOSSIERS) {
  for (const fichier of fichiersSources(dossier)) {
    const source = fs.readFileSync(`${RACINE}/${fichier}`, 'utf8');
    for (const m of source.matchAll(APPEL_T)) {
      const cle = m[1];
      const deja = utilisees.get(cle) || [];
      if (!deja.includes(fichier)) deja.push(fichier);
      utilisees.set(cle, deja);
    }
  }
}

describe('clés i18n demandées par les écrans', () => {
  it('trouve bien des appels à t() — sinon le test ne prouve rien', () => {
    // Garde-fou du test lui-même : si la regex ou l'arborescence change, ce
    // fichier passerait au vert en ne vérifiant plus rien du tout.
    expect(utilisees.size).toBeGreaterThan(300);
  });

  it('résout chaque clé vers une chaîne du dictionnaire fr', () => {
    const absentes: string[] = [];
    const nonChaines: string[] = [];
    for (const [cle, fichiers] of utilisees) {
      const v = valeur(cle);
      if (v === undefined) absentes.push(`${cle} (${fichiers.join(', ')})`);
      else if (typeof v !== 'string') nonChaines.push(`${cle} → ${typeof v}`);
    }
    expect(absentes).toEqual([]);
    // Une clé qui pointe sur un namespace renvoie un objet : `t()` afficherait
    // « [object Object] ».
    expect(nonChaines).toEqual([]);
  });
});
