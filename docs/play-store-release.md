# Préparation de la version Google Play

## Build de production

Le profil `production` de `eas.json` produit un AAB pour `app.nia.mobile`,
incrémente le numéro de version Android et sélectionne explicitement
l'environnement EAS `production`.

Avant l'installation des dépendances, le hook `eas-build-pre-install` refuse
un build `production` si les variables EAS suivantes sont absentes ou invalides :

- `EXPO_PUBLIC_SUPABASE_URL` : URL HTTPS du projet.
- `EXPO_PUBLIC_SUPABASE_ANON_KEY` : clé publique publishable ou legacy anon.
- `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` : véritable client OAuth Web.

`EXPO_PUBLIC_USE_MOCK` ne doit valoir ni `1` ni `true`. Une clé `service_role`
ou `sb_secret_…` est refusée : elle ne doit jamais être embarquée dans l'app.
Le contrôle vérifie le format des valeurs, pas leur validité sur les serveurs.
Configurer ces variables dans EAS `production` ; le hook ne charge pas un `.env`
local. Les builds preview et le développement gardent leur fonctionnement actuel.

Contrôle autonome, sans installer les dépendances de l'application :

```bash
npm run test:production-env
```

Le build se lance ensuite avec :

```bash
eas build --platform android --profile production
```

## Contrôles qui nécessitent les consoles ou un téléphone

Les tests JS et les exports de la CI ne valident pas Gradle, les bibliothèques
natives, les réglages du serveur ni la signature distribuée par Google Play.

- Vérifier que les migrations nécessaires à la version sont appliquées dans
  Supabase. Pour la suppression de compte, suivre `docs/account-deletion.md`
  et `supabase/functions/purge-user-storage/README.md` : présence du fichier
  014 dans GitHub ne prouve pas son exécution ni le déploiement de la purge.
- Vérifier le déploiement et les réglages de `live-token` et `livekit-webhook`
  si les lives sont proposés dans la version publiée.
- Tester via la piste interne de Google Play : inscription, connexion e-mail,
  connexion Google, publication caméra/galerie, couverture personnelle,
  affiche d'événement, lecture, signalement, blocage et suppression d'un
  compte de test contenant un média. Contrôler aussi la purge des fichiers.
- Enregistrer dans Google Cloud le SHA-1 de la **clé de signature de l'app
  Google Play**, en plus de celui du build EAS si utilisé : tester seulement
  un APK EAS ne valide pas la connexion Google de l'app distribuée par Play.
- Vérifier que les pages légales publiques sont accessibles et que le formulaire
  Data safety correspond à la version publiée, notamment aux lives et à LiveKit.
- Vérifier l'acceptation des CGU et des règles avant toute publication, y compris
  les comptes créés depuis le bouton Google de bienvenue ou de connexion :
  ces parcours ne passent pas par l'écran d'inscription e-mail qui affiche
  actuellement les liens et la notice d'acceptation. Aucun contrôle d'acceptation
  commun à ces parcours n'a été identifié pendant cette revue.
- Compléter l'identité juridique et le pays d'établissement de l'éditeur
  sur la base d'informations confirmées. La section 12 des CGU reste générique ;
  ne pas déduire le pays d'établissement d'un déplacement ou du nom de marque.
- Vérifier la compatibilité des bibliothèques natives avec les pages mémoire
  de 16 Ko sur le binaire final ; une CI JS verte ne la démontre pas.

Ne pas annoncer « prêt pour publication » tant que ces contrôles ne sont pas
documentés avec leurs résultats. Aucun changement de ce document ne déploie
de fonction ou n'exécute de migration dans Supabase.
