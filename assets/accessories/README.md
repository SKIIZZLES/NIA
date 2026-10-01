# Accessoires (A2) — catalogue et licences

Accessoires amusants posés sur le visage dans la caméra (Android). **Ce ne sont
pas des masques d'anonymat** : sans visage, l'accessoire disparaît, rien n'est
flouté. L'anonymat reste le bouton « Masque ».

## Règles (validées par le fondateur le 01/10/2026)
- Images **créées par NIA**, ou commandées à des créateurs africains ou de la
  diaspora **crédités**, ou sous licence **CC0** (domaine public). Rien d'autre :
  pas de licence « non commerciale », pas de source inconnue.
- **Aucune image générée par IA.**
- **Relecture culturelle** avant sortie pour tout motif culturel (2 à 3 personnes
  de la communauté) : rien de sacré ou de rituel en déguisement, pas de traits
  exagérés, pas de « tribal », des noms justes (« inspiré du … » seulement si c'est
  exact et validé).
- **Jamais** de remodelage du visage, de lissage ni d'éclaircissement de la peau.
  Une teinte posée sur la peau (verres, peinture) doit être plus sombre que la peau
  la plus foncée de l'échelle Monk : elle peut assombrir, jamais éclaircir.
- Palette NIA : sable, bronze, ocre, terre, noir chaud.

## Un objet = un dossier
`assets/accessories/<id>/` contient :
- la source vectorielle éditable (`<id>.svg`) ;
- `licence.json` : `id`, `name`, `author`, `source`, `licence` (`NIA-original` ou
  `CC0-1.0`), `createdAt`, `aiGenerated` (toujours `false`), `culturalReview`.

Le dessin utilisé par le téléphone est le même tracé au format Android
(`modules/nia-camera/android/src/main/res/drawable/nia_acc_<id>.xml`, tirets
remplacés par des soulignés). Le catalogue est déclaré deux fois, avec les mêmes
identifiants : `lib/accessories.ts` (libellés, licence) et
`modules/nia-camera/.../Accessories.kt` (ancrage). Le test
`__tests__/lib/accessories.test.ts` vérifie que tout concorde.
