@AGENTS.md

# NIA — contexte partagé Claude Code ↔ Haby

> Lu automatiquement par Claude Code. Haby = Lead Dev / CTO (assistant IA) ;
> le fondateur valide et merge. La ligne `@AGENTS.md` ci-dessus importe les
> consignes Expo existantes : la garder.

## 1. Projet

- **NIA** : écosystème des cultures africaines et diasporiques — vidéo, photo,
  musique, live, événements, communautés, séries. **Pas « un TikTok africain ».**
- **Stack** : Expo SDK 57, React Native 0.86, expo-router, TypeScript, Supabase
  (réf. `odlmbiaocdonlovjepxn`, région eu-central-1), lives via LiveKit.
- **Budget zéro** : offres gratuites uniquement (Supabase Free, EAS, LiveKit…).
  Aucun service payant sans accord du fondateur.
- **Design** : textes sable, bronze et ocre sur fond sombre (pas de blanc pur en
  couleur principale) + thèmes par utilisateur (`constants/themes.ts`, `context/ThemeContext.tsx`,
  écran `app/appearance.tsx`).
- **Musique** : aucun catalogue illégal.
- **Langues** : 20 locales dans `locales/*.ts` (fr = référence).

### Arborescence

| Dossier | Contenu |
|---|---|
| `app/` | écrans expo-router : `(auth)`, `(tabs)`, `create/`, `live/`, `events/`, `series/`, `sound/`, `video/`, `user/`, `search/` |
| `components/`, `hooks/`, `context/`, `lib/`, `constants/`, `types/` | UI, logique, clients Supabase / LiveKit |
| `locales/` | traductions (20 langues) |
| `supabase/migrations/` | SQL numéroté `NNN_nom.sql` |
| `supabase/tests/` | tests SQL locaux + scripts de vérification lecture seule |
| `supabase/functions/` | Edge Functions (un `README.md` chacune) |
| `__tests__/` | Jest (`jest-expo`) |
| `docs/legal/` | pages légales publiées (CGU, confidentialité, règles, sécurité enfants) |

## 2. Règles de travail (obligatoires)

1. **Audit → plan → validation explicite du fondateur** avant de coder.
2. **Aucun changement de base** (migration, SQL en prod, policies, cron, Vault)
   sans OK explicite du fondateur.
3. **Une branche + une PR par changement.** Préfixes : `claude/*` pour Claude
   (ex. `claude/legal-014` #22, `claude/cgu` #24,
   `claude/moderation-commentaires` #27), `haby/*` pour Haby.
4. **Jamais de push sur `main`.** Le fondateur merge.
5. **Haby relit chaque PR de Claude** avant qu'elle soit considérée approuvée.
6. **Ne jamais modifier la branche d'un autre agent** : proposer via commentaire de PR.
7. **Jamais de secret committé** (`.env`, `secrets/`, clés, jetons, client secrets).
   `.env.example` ne contient que des placeholders.
8. **Migrations** : numérotées, idempotentes (rejouables deux fois), avec un
   script de vérification **lecture seule** dans `supabase/tests/`
   (modèle : `017_verify_after_apply.sql`, toutes les lignes à `t`).
   `supabase/tests/run_local.sh` = Postgres local jetable uniquement.
9. **Textes UI en français**, clés présentes dans les 20 locales
   (test `__tests__/locales/`).
10. **Avant de rendre** : `npx tsc --noEmit` = 0 erreur et `npx jest` tout vert
    (la CI joue aussi `expo export` iOS / Android / web).

## 3. État actuel (au 30/09/2026)

**Migrations appliquées en prod** (`supabase/migrations/`) :

| N° | Objet |
|---|---|
| 001–002 | init (profiles, videos, RLS, bucket) ; likes, commentaires, follows, notifications, reports, blocks |
| 003–007 | reposts, saves, archive/suppression, RLS insert vidéos, media_type + couverture |
| 008–012 | sons, événements, live_streams, séries, filtres |
| 013 | suppression de compte v1 — **remplacée par 014, ne jamais la rejouer** |
| 014 | suppression de compte v2 (+ `purge-user-storage`) |
| 015 | suppression douce de vidéo (RPC) |
| 016 | options de publication — appliquée et vérifiée |
| **017** | **signalements / modération** — appliquée et vérifiée |
| **018** | **filtre de mots-clés** (S3) — appliquée et vérifiée |
| **019** | **live L2** (statut réel, webhook LiveKit) — appliquée (#42) |
| **022** | **suppression définitive de vidéo, reposts conservés** — appliquée (#43) |
| **020** | **âge déclaré et contenus 18+** — appliquée et vérifiée le 30/09/2026 (#45, accord du fondateur) : `020_verify` 16/16, 017/018/019/022 relancées toutes `true`, empreinte des 10 tables inchangée |
**Réservée, non écrite** : 021 enregistrements de lives.

**Modération** : compte modérateur `niaapp@outlook.com` (orthographe confirmée
par le fondateur le 30/09/2026, identique à l'adresse de contact publique du
dépôt).

**Edge Functions déployées** : `snapchat-auth`, `purge-user-storage`,
`moderation-hold` (cron `nia-moderation-hold` toutes les 5 min),
`live-token` **v4** (L2, vérification JWT active), `livekit-webhook` (L2,
`--no-verify-jwt`, auth par signature LiveKit, vérifiée). 020 ne demande aucun
redéploiement (live-token lit la ligne avec le JWT de l'appelant : un live 18+
répond 404 aux mineurs).

```bash
npx supabase functions deploy <fn> --project-ref odlmbiaocdonlovjepxn --use-api
# + --no-verify-jwt pour snapchat-auth, moderation-hold, purge-user-storage
#   et livekit-webhook (auth par secret / signature dédiés) ;
#   live-token garde la vérification JWT.
```

Secrets : uniquement dans les secrets de fonction / Vault Supabase, jamais ici.
Détails : `supabase/functions/<fn>/README.md`.

**PR** : #37 (sécurité S1 hygiène + CGU), #38 (sécurité S2 signalements) et
#36 (live L1 LiveKit) ont été **mergées le 30/09/2026 dans cet ordre**, puis
#39 (ce fichier), #40 (S3 filtre de mots, 018), #41 (docs, défauts connus de la
suppression de vidéo), #42 (Live L2, 019) et #43 (022), puis #44 (contraste des
thèmes), #45 (Âge / 18+, migration 020 appliquée en prod le 30/09/2026) et #46
(éditeur P0, `nia-composer`), **mergées le 30/09/2026**, puis #47 (éditeur V1,
montage multi-clips), **mergée le 30/09/2026**. **Ouverte** : #48 éditeur V2
(habillage incrusté : textes, stickers et filtres NIA cuits dans le MP4 ; styles
de texte façon Instagram ; Android ; sans changement de base).

**Suppression définitive de vidéo (#25) — défauts connus : corrigés par 022**
(#43, migration appliquée en prod) :
- défaut 1 (fil et profil annonçaient « Vidéo et fichier effacés » même quand
  le fichier était gardé pour un repost) : trois issues distinguées
  (`components/videoDeleteFeedback.ts`, clé `feed.deleteKeptForRepost`) ;
- défaut 2 (comptage des références filtré par la RLS : un repost archivé,
  followers / private, masqué ou d'un compte bloqué perdait son fichier) :
  RPC `delete_own_video_for_good` (022, security definer) qui compte **toutes**
  les lignes. Décision du fondateur : les reposts des autres comptes restent
  visibles. La suppression de **compte** (014) continue, elle, d'effacer les
  reposts des autres (différence voulue, `docs/account-deletion.md`).
- 022 est appliquée : le défaut 2 est corrigé pour les APK qui passent par la
  RPC. Les anciens APK le gardent actif, faute de passer par la RPC.

**Feuille de route** :
1. ~~S3 — filtre de mots-clés (018)~~ — fait
2. ~~L2 — direct instantané, écran façon Instagram, statut réel (019 +
   `livekit-webhook`)~~ — fait, appliqué
3. ~~Âge / 18+ (020)~~ — fait (migration en prod, app mergée #45)
4. L3 — chat et réactions en live ; L4 — modération des lives
5. Durcissement
6. Replays (optionnel, 021)

**Règles de modération** (017, `docs/legal/`) :
- 10 catégories : insultes/harcèlement, nudité/contenu sexuel, actes inhumains,
  négrophobie, racisme/haine, **propos homophobes**, pédocriminalité,
  menace/danger, spam, autre.
- **Pédocriminalité (P0)** : masquée dès le 1er signalement, écran
  PHAROS / 119 / 17, **aucun envoi de preuve** (garde-fou : 5 masquages P0
  par signaleur / 24 h).
- Autres catégories : masquées à **3 signaleurs distincts** (comptes > 24 h).
- **Aucune nudité ni contenu sexuel.** Âge minimum **13 ans**.
- **18+ (020, appliquée)** : date de naissance privée (`user_birthdates`, saisie
  unique, correction par le support via `mod_set_birth_date`) ; marquage 18+
  par un adulte déclaré ou imposé par la modération (`mod_set_mature`) ;
  visible des seuls adultes ayant activé « Afficher les contenus 18+ »
  (désactivé par défaut) ; jamais republiable ; n'autorise jamais la nudité.
- Contact : niaapp@outlook.com.

## 4. Communication Claude ↔ Haby

- **Description de chaque PR**, sections :
  1. Ce qui a été fait
  2. Fichiers touchés
  3. Changement de base : oui / non (+ lesquels)
  4. Tests lancés
  5. Risques connus
  6. Reste à faire
- **Question pour Haby** : commentaire de PR commençant par `@Haby`.
- **Fin de sprint** : mettre à jour « État actuel » dans la même PR.
- **Journal** (bas de ce fichier) : une ligne par changement notable —
  date, auteur (Claude / Haby), une phrase.

## 5. Commandes utiles

```bash
npm install                 # dépendances (la CI utilise npm ci)
npx tsc --noEmit            # typecheck (= npm run typecheck)
npx jest                    # tests (= npm test)
npx expo start              # dev ; -c pour vider le cache Metro
npx expo start --web        # web
```

Mode mock si `.env` vide ; Google, Snapchat et LiveKit exigent un build EAS
(profils `development` / `preview` / `production` dans `eas.json`), pas Expo Go.

Pour le détail, voir plutôt que dupliquer :
- `README.md` — installation, mock vs Supabase, i18n, architecture, EAS
- `SUPABASE.md` — backend, migrations 001–012, bucket
- `supabase/tests/README.md` — tests SQL locaux (013 → 020, 022)
- `supabase/functions/*/README.md` — déploiement, secrets, cron
- `docs/account-deletion.md`, `GOOGLE_AUTH.md`, `SNAPCHAT_AUTH.md`,
  `PRODUCT.md`, `PERF.md`, `docs/legal/README.md`
- `docs/fonts-licenses.md` — polices de l'Habillage (Google Fonts, OFL 1.1)

## Journal

| Date | Auteur | Changement |
|---|---|---|
| 30/09/2026 | Haby | Haby : création du fichier |
| 30/09/2026 | Claude | Deux défauts de la suppression définitive de vidéo (#25) inscrits dans « État actuel » ; aucun code modifié |
| 30/09/2026 | Haby | Live L2 en PR : direct instantané façon Instagram, statut réel via `livekit-webhook` + migration 019, bande « En direct » dans Découvrir, signalement sur l'écran spectateur. |
| 30/09/2026 | Haby | Correctif 022 : suppression définitive de vidéo par RPC `delete_own_video_for_good` (reposts des autres conservés quelle que soit leur visibilité), trois issues à l'écran ; défauts connus de #41 corrigés, 014 inchangée. |
| 30/09/2026 | Haby | Âge / 18+ en PR (#45) : migration 020 (date de naissance privée, 13 ans minimum, marquage 18+ vidéo et live, choix d'affichage, outils modération) écrite et testée sur un Postgres local jetable, **non appliquée en prod** ; modale de date, réglage « Âge et contenus 18+ », CGU et confidentialité à jour. État actuel : 019 et 022 appliquées, `livekit-webhook` vérifiée, `niaapp@outlook.com` modérateur. |
| 30/09/2026 | Haby | 020 appliquée en prod après accord du fondateur : `020_verify` 16/16, 017/018/019/022 relancées toutes vraies, empreinte des 10 tables inchangée, sonde RLS (transaction annulée) conforme ; `live-token` v4 confirmée. |
| 30/09/2026 | Haby | Contraste des thèmes (sans changement de base) : jetons revus (`textMuted` ≥ 4.5:1, `textDisabled`, `borderStrong`, `danger` lisible, ocre foncé sur Clair), jetons « sur média » fixes (voiles sombres + texte sable) et `MediaChrome` pour caméra / éditeur, `Button` thémé, lecture / pause au toucher dans l'éditeur et l'Habillage, test `themeContrast` ; textes de l'Habillage et de l'éditeur au « vous ». |
| 30/09/2026 | Haby | Éditeur P0 en PR (#46) : module local `modules/nia-composer` (Media3 Transformer 1.9, Android) qui compose un MP4 H.264 720p 30 i/s + AAC < 50 Mo sur l'appareil (découpe, vitesse, musique et volumes cuits), écran d'export au premier plan avec annulation, 3 min max, bascule de caméra entre segments ; `edit_meta.baked` pour les anciens APK, iOS inchangé (stub), aucune migration. |
| 30/09/2026 | Haby | Éditeur V1 en PR (#47) : montage multi-clips sur Android (timeline : couper, découper, déplacer, dupliquer, supprimer ; vitesse par clip 0,3x → 2x ; photos de 3 s ; import multiple de la galerie ; segments caméra = clips), mixage son original / musique / début, aperçu enchaîné avec pause au toucher, export `nia-composer` (photos fixes, cadre 720 × 1280) en un MP4 ≤ 3 min et < 50 Mo, brouillons v2 avec migration des v1 ; iOS inchangé, aucune migration. |
| 30/09/2026 | Haby | Éditeur V2 en PR (#48) : habillage incrusté sur Android — textes et stickers capturés en PNG (`react-native-view-shot`) puis cuits par `nia-composer` (position, taille, rotation, début / fin), filtres NIA cuits (matrice Media3 = voile de l'aperçu), vérification des mots interdits de l'habillage avant export (même RPC que 018), `edit_meta` `baked` avec `overlays: null` et `filter_id` ; 7 styles de texte façon Instagram (polices Google Fonts OFL via expo-font, `docs/fonts-licenses.md`), fonds aucun / pastille / translucide, alignement, nouvelles couleurs ; iOS inchangé, aucune migration. |
| 30/09/2026 | Haby | Effets visage A1, jalon 1 (test de faisabilité, Android) : module local `modules/nia-camera` (CameraX 1.6 `OverlayEffect` sur l'aperçu **et** l'enregistrement + MediaPipe Face Detector (BlazeFace) sur l'appareil, le Face Landmarker arrivant au jalon 2 avec la cagoule), flou ou pixels du visage cuits dans le fichier, flou plein cadre si le visage est perdu plus de 100 ms, bouton d'enregistrement bloqué sans visage, i/s et latence dans les journaux et un panneau de mesures ; avis de première utilisation et phrase de confidentialité (FR/EN) approuvés, ABI limitées à arm64-v8a / armeabi-v7a, aucune migration, APK de test en pré-version `test-ar-spike`. |
| 30/09/2026 | Haby | Effets visage A1, jalon 2 (Android, #50) : **cagoule** (tête couverte, yeux voilés d'un bandeau opaque maillé, bouche opaque) et **masque intégral**, tirés des 478 repères MediaPipe Face Landmarker (mode vidéo, en parallèle de BlazeFace), cuits dans l'aperçu et le fichier ; sous chaque masque un flou elliptique du visage, visage vu par le détecteur ou les repères = masqué, flou de repli sans repères, flou plein cadre au-delà de 100 ms, déclencheur bloqué sans visage ; analyse 4:3 ≤ 640 px pour la latence, mesures des repères au panneau ; jalon 1 validé sur téléphone après correctif de l'aperçu noir (mise en page de `PreviewView`) ; pas de masque en live, aucune retouche de peau ni déformation, aucune migration. |
| 01/10/2026 | Haby | Effets visage A1, jalon 2b (Android, #50) : fluidité des masques (Cagoule 9 i/s et Intégral 17 i/s au test du fondateur, car `OverlayEffect` en synchro exacte jette les images plus anciennes que celle analysée et l'analyse attendait les repères) ; nouvelle synchro **live** par défaut (file 0, chaque image caméra dessinée tout de suite avec la dernière analyse prolongée par la vitesse du visage, zone élargie avec l'âge), synchro exacte gardée au toucher du panneau (reliaison, jamais pendant une prise) ; BlazeFace seul sur le fil d'analyse, Face Landmarker sur son propre fil (une image à la fois, GPU sinon CPU) ; masques pré-rendus en sprites (`MaskSprite`), le fil GL ne fait plus que poser des images ; repères raccordés via la boîte BlazeFace de leur image, repli flou si > 100 ms, déplacement > 30 % ou taille ± 35 % ; flou sous les masques, flou plein cadre (visage absent > 100 ms, plus d'analyse depuis 200 ms) et déclencheur bloqué inchangés ; panneau : âges analyse / repères, GPU/CPU, capteur→résultat Camera2, horloge du capteur ; aucune migration. |
| 01/10/2026 | Haby | Effets visage A1, jalon 2c (Android, #50) : vidéo du fondateur (APK 2b : Intégral 30 i/s, latence ~95 ms, aucune fuite) analysée image par image. Masque déformé / « couché » de 00:15 à 00:20 après une occultation : pas le sondage de rotation (panneau sans « auto »), mais le suivi du mode VIDEO de Face Landmarker accroché à une zone faussée. Repères désormais en mode IMAGE sur un recadrage 2× la boîte BlazeFace de la même image, maillage contrôlé (inclinaison des yeux ≤ 30° de BlazeFace, forme, taille, place) sinon flou de repli ; rotation CameraX par défaut, sondage après 1 s sans visage et 3 confirmations, retour immédiat ; vitesse par filtre alpha-bêta adaptatif, sprite déplacé / mis à l'échelle / tourné d'après la boîte et l'inclinaison BlazeFace fraîches, écart d'inclinaison > 30° = flou ; règles de sécurité inchangées ; aucune migration. |
| 01/10/2026 | Haby | Effets visage A1, jalon 2d (Android, #50) : test 2c du fondateur réussi (aucune fuite, masque revenu droit, 30 i/s) sauf le masque déformé de près ; retours « on voit plus le flou que le masque » et « inspire de mon visage ». Vidéo de référence sans masque analysée hors ligne sur la machine de travail (mêmes modèles, rien dans le dépôt ni dans une pré-version, images du visage supprimées). Déformation de près = forme générique (yeux en rectangles à hauteur fixe, contour remonté de 22 %), pas le recadrage ; tête tournée, l'anneau FACE_OVAL coupait le visage (masque en croissant, 17 images). Masque Intégral = enveloppe convexe des 468 points (+6 / 8 / 4 %), yeux et bouche sur les contours des paupières et des lèvres (amande minimale), sourcils et nez en traits ; grand ovale flou remplacé par un halo plumé (silhouette + 12 %) qui grandit avec l'âge des repères et la vitesse du maillage, petite ellipse de sécurité sur la boîte BlazeFace, masque jamais réduit sous ses repères, repli en ellipse plumée ; recadrage des repères complété en noir au lieu d'être rogné ; contrôle des proportions (œil / écart, yeux → bouche). Simulation : fuite max 3–5 % contre 12–16 % en 2c, flou au repos ≈ 0,7 × le masque contre ≈ 1,0 ; règles de sécurité inchangées ; aucune migration. |
| 01/10/2026 | Haby | Effets visage A1, jalon 2e (Android, #50) : test 2d du fondateur (30 i/s, latence 100–123 ms, rejetés 0, masque tiré du visage visible) mais « le flou du masque est flagrant » : grand rectangle flou aux bords droits autour de la tête, et à 00:08 un rectangle sans masque. Cause, confirmée avec skia-python : `MaskSprite` peignait le flou sur tout le sprite puis le découpait en `DST_IN`, que Skia n'applique que sous la forme ; halo, ellipse de sécurité et repli étaient donc des rectangles (déjà le « rectangle » du 2c) ; la simulation 2d composait avec de vrais masques alpha. En plus, l'âge des repères (≈ 100 ms) et le bruit du maillage gonflaient le halo d'environ 25 % au repos. Correctif : flou peint dans la forme (`BitmapShader` + `BlurMaskFilter`), halo silhouette + 4 % (plume 2,5 %), croissance relative au masque seulement en mouvement ou au maintien, masque maintenu jusqu'à 150 ms s'il couvre encore la boîte BlazeFace (sinon repli), ellipse de repli à sa vraie taille, interrupteur « Contours du flou » et ligne « halo · maintenus · non couverts » au panneau. Émulation Skia sur les deux vidéos (repères 100 ms) : flou hors masque au repos 166–220 % de l'aire du masque → 23 %, liseré 49–63 % → 6,7 % de sa largeur ; fuite moyenne 0,4 % (max ≈ 20 % sur une image de geste brusque) ; règles de sécurité inchangées ; aucune migration. |
| 01/10/2026 | Haby | Effets visage A1, jalon 2f (Android, #50) : test 2e du fondateur (4 vidéos) : Flou et Pixels ne laissent jamais voir le visage mais dessinent un grand rectangle ; demande validée : ovale en forme de tête avec marge. `HeadOval` : « œuf » tiré de la boîte BlazeFace (2 × sa largeur, 1,25 × sa hauteur au-dessus du centre, 1,3 × dessous, 30 % plus étroit vers le menton, tourné selon les yeux) ; `MaskSprite.headSprite` peint le flou (ou les pixels nets) dans le chemin (`BitmapShader` + `BlurMaskFilter`, pas de `DST_IN`), fondu de 6 % entièrement au-dehors, recadrage couvrant le fondu ; marge de vitesse + 15 % par largeur / s au-delà de 0,5 ; même calque pour l'aperçu et l'encodeur. Hors ligne (vidéo de référence, retards 45 / 80 / 120 ms) : maillage hors ovale 0 / 0 / 0 image (rectangle 2e : 0 / 0 / 2), aire ≈ 1,27 × le rectangle. Exposant 2,8 écarté (rectangle arrondi), largeur < 2 écartée (joue hors de l'ovale en rotation). Cagoule, Intégral et règles de sécurité inchangés ; aucune migration. |
