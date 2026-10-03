/**
 * Règles de rédaction NIA vérifiées sur les dictionnaires :
 *
 * - le français vouvoie l'utilisateur (aucun « tu / ton / ta / tes / toi / te ») ;
 * - aucune chaîne affichée par un écran ne contient de texte technique
 *   (nom de service, variable d'environnement, migration, « mock »…), dans
 *   aucune des vingt langues.
 *
 * Les clés « affichées » sont celles qu'un écran appelle par `t('…')`, comme
 * dans `keysUsed.test.ts`. Les impératifs à la 2e personne du singulier
 * (« Touche », « Choisis ») ne se détectent pas par expression régulière :
 * seule une relecture les couvre.
 */
import fr from '@/locales/fr';
import en from '@/locales/en';
import es from '@/locales/es';
import pt from '@/locales/pt';
import sw from '@/locales/sw';
import ha from '@/locales/ha';
import arMA from '@/locales/ar-MA';
import arSD from '@/locales/ar-SD';
import yo from '@/locales/yo';
import zu from '@/locales/zu';
import am from '@/locales/am';
import wo from '@/locales/wo';
import ln from '@/locales/ln';
import arEG from '@/locales/ar-EG';
import ig from '@/locales/ig';
import ff from '@/locales/ff';
import bm from '@/locales/bm';
import ak from '@/locales/ak';
import mnk from '@/locales/mnk';
import dyo from '@/locales/dyo';

type EntreeDossier = { name: string; isDirectory(): boolean };
type FsMinimal = {
  existsSync(chemin: string): boolean;
  readdirSync(chemin: string, options: { withFileTypes: true }): EntreeDossier[];
  readFileSync(chemin: string, encodage: 'utf8'): string;
};
declare function require(id: string): unknown;
declare const __filename: string;
const fs = require('fs') as FsMinimal;

const RACINE = __filename.replace(/\\/g, '/').replace(/\/__tests__\/locales\/[^/]+$/, '');
const DOSSIERS = ['app', 'components', 'context'];
const APPEL_T = /(?<![A-Za-z0-9_$.])t\(\s*'([a-z][\w]*(?:\.[\w]+)+)'\s*[,)]/g;

const BUNDLES: Record<string, unknown> = {
  fr, en, es, pt, sw, ha, 'ar-MA': arMA, 'ar-SD': arSD, yo, zu, am, wo, ln,
  'ar-EG': arEG, ig, ff, bm, ak, mnk, dyo,
};

function fichiersSources(dossier: string): string[] {
  const base = `${RACINE}/${dossier}`;
  if (!fs.existsSync(base)) return [];
  const sortie: string[] = [];
  for (const entree of fs.readdirSync(base, { withFileTypes: true })) {
    if (entree.isDirectory()) sortie.push(...fichiersSources(`${dossier}/${entree.name}`));
    else if (/\.tsx?$/.test(entree.name)) sortie.push(`${dossier}/${entree.name}`);
  }
  return sortie;
}

function feuilles(objet: unknown, prefixe = ''): Array<[string, string]> {
  if (typeof objet === 'string') return [[prefixe, objet]];
  if (!objet || typeof objet !== 'object') return [];
  return Object.entries(objet as Record<string, unknown>).flatMap(([k, v]) =>
    feuilles(v, prefixe ? `${prefixe}.${k}` : k),
  );
}

const clesAffichees = new Set<string>();
for (const dossier of DOSSIERS) {
  for (const fichier of fichiersSources(dossier)) {
    const source = fs.readFileSync(`${RACINE}/${fichier}`, 'utf8');
    for (const m of source.matchAll(APPEL_T)) clesAffichees.add(m[1]);
  }
}

/** Pronoms et possessifs de la 2e personne du singulier, en mots entiers. */
const TUTOIEMENT = /(?<![\p{L}\p{N}_’'-])(tu|toi|ton|ta|tes|te)(?![\p{L}\p{N}_])|-toi(?![\p{L}])/iu;

const TECHNIQUE =
  /supabase|asyncstorage|expo_public|expo go|\bEAS\b|migration|migración|migração|\bmock\b|\bstub\b|ranking|\bMVP\b|webrtc|livekit|\bmux\b/i;

describe('règles de rédaction des textes affichés', () => {
  it('trouve bien les clés affichées — sinon le test ne prouve rien', () => {
    expect(clesAffichees.size).toBeGreaterThan(300);
  });

  it('le français vouvoie : aucun tu / ton / ta / tes / toi / te', () => {
    const fautes = feuilles(fr)
      .filter(([, v]) => TUTOIEMENT.test(v))
      .map(([k, v]) => `${k} : ${v}`);
    expect(fautes).toEqual([]);
  });

  it('aucun texte technique dans les chaînes affichées, dans les vingt langues', () => {
    const fautes: string[] = [];
    for (const [langue, bundle] of Object.entries(BUNDLES)) {
      for (const [k, v] of feuilles(bundle)) {
        if (clesAffichees.has(k) && TECHNIQUE.test(v)) fautes.push(`${langue} ${k} : ${v}`);
      }
    }
    expect(fautes).toEqual([]);
  });

  it('le sous-titre d’accueil français porte sa virgule', () => {
    expect(fr.brand.heroSecondary).toBe('Plus que des vidéos, une Afrique qui se raconte');
  });
});
