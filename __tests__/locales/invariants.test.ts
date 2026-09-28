/**
 * Invariants structurels des 20 locales.
 *
 * Ces contrôles ont été faits à la main, à coups de scripts jetables, pendant
 * les lots B1 à B8. Leur place est ici : `tsc` et `expo export` passeraient à
 * l'identique avec une locale amputée de la moitié de ses clés, parce que
 * `t(scope: string)` n'est pas typé. Une clé manquante s'affiche brute à
 * l'écran sans rien casser en CI.
 *
 * Ce que ces tests NE garantissent pas : le sens. Une traduction entièrement
 * fausse passe tous les contrôles ci-dessous. Seule une relecture humaine
 * couvre ça.
 */
import { APP_LOCALES, type AppLocale } from '@/lib/i18n';
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

const BUNDLES: Record<AppLocale, unknown> = {
  fr,
  en,
  es,
  pt,
  sw,
  ha,
  'ar-MA': arMA,
  'ar-SD': arSD,
  yo,
  zu,
  am,
  wo,
  ln,
  'ar-EG': arEG,
  ig,
  ff,
  bm,
  ak,
  mnk,
  dyo,
};

type Leaf = { path: string; value: string };

/** Aplatit un bundle en chemins pointés. Jette si une feuille n'est pas une string. */
function flatten(node: unknown, prefix: string, out: Leaf[]): Leaf[] {
  if (typeof node === 'string') {
    out.push({ path: prefix, value: node });
    return out;
  }
  if (node === null || typeof node !== 'object' || Array.isArray(node)) {
    throw new Error(
      `Feuille invalide à « ${prefix} » : ${Array.isArray(node) ? 'tableau' : String(node)}`,
    );
  }
  for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
    flatten(child, prefix ? `${prefix}.${key}` : key, out);
  }
  return out;
}

const PLACEHOLDER_RE = /%\{([a-zA-Z0-9_]+)\}/g;

/** Multiensemble trié : l'ordre des placeholders peut légitimement changer d'une langue à l'autre, pas leur nombre. */
function placeholders(value: string): string[] {
  return [...value.matchAll(PLACEHOLDER_RE)].map((m) => m[1]).sort();
}

const FR_LEAVES = flatten(fr, '', []);
const FR_PATHS = FR_LEAVES.map((l) => l.path);
const FR_BY_PATH = new Map(FR_LEAVES.map((l) => [l.path, l.value]));

describe('locales — témoin', () => {
  // Témoin : un contrôle incapable de trouver quoi que ce soit ne prouve rien.
  // Si `flatten` se casse et renvoie une liste vide, tous les tests de parité
  // ci-dessous passeraient en comparant du vide à du vide.
  it('fr expose plusieurs centaines de clés', () => {
    expect(FR_PATHS.length).toBeGreaterThan(400);
  });

  it('APP_LOCALES couvre exactement les bundles chargés, sans doublon', () => {
    expect([...APP_LOCALES].sort()).toEqual(Object.keys(BUNDLES).sort());
    expect(new Set(APP_LOCALES).size).toBe(APP_LOCALES.length);
  });
});

describe.each(APP_LOCALES)('locale %s', (locale) => {
  const leaves = flatten(BUNDLES[locale], '', []);
  const paths = leaves.map((l) => l.path);

  it('a exactement les mêmes clés que fr, dans le même ordre', () => {
    // L'ordre compte : `TranslationKeys = DeepStringify<typeof fr>` impose la
    // complétude, pas l'ordre. Garder l'ordre garde les fichiers comparables
    // ligne à ligne, ce dont dépend toute relecture de diff.
    expect(paths).toEqual(FR_PATHS);
  });

  it('n’a aucune valeur vide', () => {
    const empty = leaves.filter((l) => l.value.trim() === '').map((l) => l.path);
    expect(empty).toEqual([]);
  });

  it('a les mêmes placeholders que fr sur chaque clé', () => {
    const deviations = leaves
      .filter((l) => {
        const source = FR_BY_PATH.get(l.path);
        if (source === undefined) return false; // couvert par le test de parité des clés
        return placeholders(l.value).join(',') !== placeholders(source).join(',');
      })
      .map((l) => ({
        path: l.path,
        attendu: placeholders(FR_BY_PATH.get(l.path) as string),
        trouvé: placeholders(l.value),
      }));
    expect(deviations).toEqual([]);
  });

  it('n’a aucun placeholder malformé', () => {
    // `%{` sans fermeture, ou `%{ }` avec espaces : i18n-js laisse la chaîne
    // brute à l'écran au lieu d'interpoler.
    const malformed = leaves
      .filter((l) => {
        const opens = (l.value.match(/%\{/g) || []).length;
        const valid = placeholders(l.value).length;
        return opens !== valid;
      })
      .map((l) => `${l.path} → ${l.value}`);
    expect(malformed).toEqual([]);
  });
});
