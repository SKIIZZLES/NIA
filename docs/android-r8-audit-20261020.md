# Audit Android / R8 — 20 octobre 2026

Base auditée : `SKIIZZLES/NIA`, `main` à
`967bc4741e3696a850dc2419aa747343e5a893c4`.
Branche de préparation : `codex/android-r8-audit-20261020`.

## Conclusion

Deux lacunes sont reproductibles dans les sources et le modèle Android
embarqué avec Expo : la minification release n'est pas activée explicitement
et le modèle sélectionne `proguard-android.txt` au lieu du fichier optimisé.
Le correctif configure R8 et la suppression des ressources, puis remplace le
fichier par `proguard-android-optimize.txt` lors du prebuild.

Le taux d'obscurcissement de 1 % est rapporté par le propriétaire, pas mesuré
pendant cet audit. L'AAB 17.aab, ses métadonnées R8 et ses journaux EAS n'ont
pas été inspectés. Aucun lien entre son commit de compilation et le `main`
actuel n'est démontré. Les défauts du dépôt expliquent un risque concret,
sans prouver à eux seuls la cause exacte du score du binaire distribué.

## État de la chaîne

| Élément | Observation |
| --- | --- |
| Expo | Déclaration ~57.0.23 ; verrouillé et installé 57.0.23 |
| React / React Native | 19.2.3 / 0.86.3, cohérents avec bundledNativeModules.json du SDK installé |
| Android natif | Non versionné ; généré par Expo prebuild et les plugins |
| Modèle Gradle | Wrapper 9.3.1 ; catalogue RN : AGP 8.12.0, min SDK 24, compile/target SDK 36, NDK 27.1.12297006 ; pas de résolution Gradle exécutée |
| R8 avant | enableMinifyInReleaseBuilds absent, valeur de repli false ; shrinkResources false |
| ProGuard avant | proguard-android.txt, configuration qui désactive l'optimisation |
| EAS production | Environnement production, AAB, version distante, autoIncrement true ; fichier inchangé |
| EAS CLI | Contrainte >=16.0.0, pas de version exacte ; aucune invocation EAS pendant l'audit |
| ABI | armeabi-v7a et arm64-v8a, conservées |

Les paramètres et secrets des consoles EAS, Play et Google Cloud ne sont pas
visibles dans cet audit du dépôt. La signature cryptographique de l'AAB ne
peut donc pas être certifiée ici.

## Changements préparés

1. Ajouter `expo-build-properties` avec la plage ~57.0.18 recommandée par le
   SDK installé, verrouillée en 57.0.22. Le lock conserve les versions des
   dépendances existantes ; seuls ce plugin et son semver imbriqué s'ajoutent.
2. Activer `enableMinifyInReleaseBuilds` et
   `enableShrinkResourcesInReleaseBuilds` dans app.json.
3. Ajouter `plugins/withAndroidR8.js`, appliqué après le plugin officiel.
   Il remplace uniquement le fichier ProGuard par sa variante optimisée.
   Il est idempotent et refuse un modèle inattendu ou non Groovy afin
   d'éviter une perte silencieuse du correctif lors d'une mise à jour Expo.
4. Ajouter deux tests de transformation du modèle Android et les exécuter
   dans la CI existante. Aucune étape de compilation native n'est ajoutée.

Ni `-dontwarn **`, ni désactivation du mode complet de R8, ni nouveau
`-keep class **` ne sont ajoutés. Les règles de React Native, Expo,
Reanimated et des bibliothèques sont conservées. En particulier,
`@livekit/react-native-webrtc/android/consumer-rules.pro` conserve largement
`livekit.org.webrtc.**` et `org.jni_zero.**` ; LiveKit conserve `com.livekit.**`.
Ces protections JNI peuvent limiter les scores ; les enlever sans validation
release serait risqué. Les règles effectives des AAR Maven, dont MediaPipe,
restent à examiner dans une future compilation autorisée.

## Vérification

Environnement local : Node 24.19.0, npm 11.9.0 ; CI du dépôt : Node 22.
Installation `npm ci --ignore-scripts` réussie, y compris après la mise à jour
minimale du lock. Les scripts d'installation des dépendances n'ont pas été
exécutés ; cela ne remplace pas une installation et compilation natives EAS.

- TypeScript : réussi.
- Jest : 46 suites, 892 tests réussis.
- Garde de configuration production : 5 tests réussis.
- Garde du modèle R8 : 2 tests réussis, également après réinstallation du lock.
- Expo prebuild Android sans installation : réussi sur la base et le correctif.
- Comparaison complète des dossiers Android générés : seuls
  `android/app/build.gradle` (nom du fichier ProGuard) et
  `android/gradle.properties` (deux options true) diffèrent.
  Manifeste, ressources, identifiant, paramètres Gradle de signature, ABI
  et sources Android générés sont identiques.
- Export JavaScript Android : réussi. Ce n'est pas un AAB.
- Export JavaScript web et rendu des 43 routes : réussi.
- Export JavaScript iOS : réussi après réinstallation complète des dépendances.
  Une première tentative avait échoué pendant la réinstallation npm concurrente
  (fichier temporairement absent) ; le contrôle isolé est passé.
- `git diff --check` : réussi.

`expo-doctor` : 19/21 contrôles réussis, les deux mêmes alertes reproduites
sur la base sans correctif et la branche :

- `expo-asset`, requis par expo-audio, n'est pas déclaré directement.
- 11 correctifs recommandés : expo ~57.0.30, expo-camera ~57.0.6,
  expo-constants ~57.0.22, expo-crypto ~57.0.4, expo-document-picker ~57.0.3,
  expo-image-picker ~57.0.20, expo-linking ~57.0.13, expo-router ~57.0.28,
  expo-splash-screen ~57.0.10, expo-video ~57.0.5, jest-expo ~57.0.6.

Ces mises à jour restent proposées séparément pour isoler le changement R8.
Le prebuild signale aussi l'absence de expo-system-ui pour userInterfaceStyle,
sur les deux configurations. npm avertit d'un conflit de peer React dans
test-renderer/react-reconciler ; les tests passent malgré cet avertissement.

## Risques et validation encore nécessaires

Le code et les ressources utilisés par réflexion ou JNI constituent le risque
principal : Expo Modules, Google Sign-In, WebRTC, MediaPipe et les modules
locaux caméra/composition. Une CI JS verte ne valide pas leur exécution
après réduction R8. Aucun taux final ou gain de taille n'est promis.

Après autorisation distincte d'une compilation release :

1. Contrôler `minifyReleaseWithR8`, les avertissements de classes manquantes
   et `configuration.txt`, `usage.txt`, `mapping.txt` dans les sorties Gradle.
   Ajouter seulement les règles ciblées démontrées nécessaires.
2. Vérifier les métadonnées du nouvel AAB :
   `BUNDLE-METADATA/com.android.tools/r8.json` et
   `BUNDLE-METADATA/com.android.tools.build.obfuscation/proguard.map`.
   Comparer les métriques DEX à celles du binaire de référence en lecture seule.
3. Sur téléphone, tester démarrage à froid, connexion e-mail et Google avec
   la signature Play, persistance de session, caméra avant/arrière et masques,
   micro, galerie, montage/export/miniatures, publication/lecture vidéo,
   live LiveKit et navigation. Vérifier ressources et modèles MediaPipe.
4. Confirmer l'identité et les certificats de signature avant toute soumission.
   Une compilation EAS autorisée ne constitue pas une autorisation de déployer.

## Contraintes respectées

Aucun accès en écriture à Play Console ; 17.aab inchangé. Aucun build natif,
EAS Build, déploiement, soumission, modification des credentials ou fusion.
`app.nia.mobile`, scheme, projet EAS, eas.json et fichiers de connexion sont
inchangés. Les fichiers Android générés restent ignorés par git. Le modèle
local contient sa signature debug standard ; aucun changement n'y est apporté
et les credentials réels de production ne sont ni lus ni remplacés.

La branche est préparée localement et la description de PR est disponible
dans `docs/android-r8-pr-draft.md`. La publication distante reste en attente
de revue par le propriétaire, conformément à sa demande de présentation
avant toute publication. Aucune PR n'a encore été ouverte.

## Sources officielles consultées

- https://docs.expo.dev/versions/v57.0.0/
- https://docs.expo.dev/versions/v57.0.0/sdk/build-properties/
- https://expo.dev/changelog/sdk-57
- https://developer.android.com/topic/performance/app-optimization/enable-app-optimization
- https://developer.android.com/google/play/vitals/code-optimization

Les preuves les plus spécifiques sont locales à la version installée :
`node_modules/expo/template.tgz`, `expo/bundledNativeModules.json`, le catalogue
Gradle React Native et les règles consumer des dépendances npm verrouillées.
