# fix(android): enable Expo release R8 shrinking and optimization

## Problème et résultat attendu

La configuration Expo de NIA n'active pas R8 en release et le modèle Android
d'Expo 57.0.23 choisit `proguard-android.txt`, qui désactive l'optimisation.
Cette modification active la réduction/obscurcissement du code et la
suppression des ressources inutilisées avec `expo-build-properties`, puis
sélectionne `proguard-android-optimize.txt` via un plugin persistant au prebuild.
Elle prépare une future release ; elle ne modifie aucun AAB existant.

## Modifications

- Plugin officiel compatible SDK 57 et lock minimal sans mise à jour des
  dépendances existantes.
- Plugin de remplacement du fichier ProGuard, idempotent, avec erreur explicite
  si la structure du modèle Expo change.
- Deux tests exécutés dans la CI existante, sans compilation native.
- Rapport détaillé : `docs/android-r8-audit-20261020.md`.

## Validation

- TypeScript ; 46 suites Jest / 892 tests ; 5 tests de configuration production ;
  2 tests R8 : réussis.
- Installation reproductible du lock avec npm ci --ignore-scripts : réussie.
- Prebuild Android sans compilation, base et branche : réussi. Seuls le choix
  du fichier ProGuard et les deux propriétés R8 diffèrent dans les projets générés.
- Exports JavaScript Android, iOS et web : réussis.
- Expo Doctor : 19/21 sur base et branche ; alertes préexistantes expo-asset
  et 11 correctifs de paquets proposés, laissés hors de cette PR.

## Limites et risque

Pas de compilation Gradle ni de test sur téléphone : le gain DEX et l'absence
de régression native ne sont pas démontrés. Vérifier sur une future release
autorisée les parcours Google Sign-In, caméra/MediaPipe, montage, médias et
LiveKit. Conserver puis analyser le mapping et les métadonnées R8. Les règles
de conservation des dépendances JNI ne sont pas supprimées.

## Périmètre et autorisations

Identifiant app.nia.mobile, credentials, paramètres de connexion, eas.json et
signature configurée inchangés. Aucun build, déploiement, remplacement de
17.aab ou fusion dans main n'a été effectué. Ne pas activer d'auto-merge.
Toute compilation, soumission ou fusion nécessite une autorisation distincte.

Statut : texte de PR prêt pour revue, non publié. Branche distante / PR à
créer seulement après présentation et accord du propriétaire. Vérifier avant
le push les automatisations EAS liées au dépôt pour ne déclencher aucun build.
