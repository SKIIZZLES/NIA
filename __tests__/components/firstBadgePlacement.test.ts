/**
 * Le badge First est posé à côté du pseudo partout où il s'affiche : profil,
 * profil public, fil, commentaires, recherche. Contrôle de source (ces écrans
 * dépendent de trop de contextes natifs pour être montés ici).
 */
type FsMinimal = { readFileSync(chemin: string, encodage: 'utf8'): string };
declare function require(id: string): unknown;
declare const __filename: string;
const fs = require('fs') as FsMinimal;
const RACINE = __filename.replace(/\\/g, '/').replace(/\/__tests__\/components\/[^/]+$/, '');

const ATTENDU: Array<[fichier: string, occurrences: number, variante: 'dark' | 'theme']> = [
  ['app/(tabs)/profile.tsx', 1, 'theme'],
  ['app/user/[username].tsx', 1, 'dark'],
  ['components/VideoCard.tsx', 1, 'dark'],
  ['components/CommentsSheet.tsx', 1, 'dark'],
  ['app/search/index.tsx', 2, 'theme'],
];

describe('badge First — emplacements', () => {
  it.each(ATTENDU)('%s : %i badge(s), ton %s', (fichier, n, variante) => {
    const src = fs.readFileSync(`${RACINE}/${fichier}`, 'utf8');
    const badges = src.match(/<FirstBadge\b[^>]*\/>/gs) || [];
    expect(badges).toHaveLength(n);
    for (const b of badges) {
      if (variante === 'dark') expect(b).toMatch(/variant="dark"/);
      else expect(b).not.toMatch(/variant=/);
      expect(b).toMatch(/userId=\{/);
      expect(b).toMatch(/username=\{/);
    }
  });
});
