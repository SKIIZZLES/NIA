# NIA — Produit

## Vision

NIA est l’application de vidéos verticales courtes qui met en lumière **les talents africains** et les cultures du continent et de la diaspora — sans frontières.

**Tagline :** VIDÉOS · CULTURES · TALENTS · SANS FRONTIÈRES

**Héro :**
- « ICI, LES TALENTS AFRICAINS VONT PLUS LOIN »
- « PLUS QUE DES VIDÉOS UNE AFRIQUE QUI SE RACONTE »

Positionnement : élégance (Noir), héritage (Terre), créativité (Or africain), ouverture (Sable), avenir (Vert).

## Objectif immédiat

**Démo investisseur (MVP)** : parcours crédible Accueil → Découvrir → Publier → Profil, avec auth mock ou Supabase Free, UI Afro-Tech Premium en français.

## Contrainte budget

**0 €** — stack Expo + **Supabase Free tier** uniquement. Pas d’abonnement payant obligatoire pour la démo (pas de Mux / Stream payant tant que le free tier suffit).

## Navigation cible (bottom tabs)

| Onglet | Rôle |
|--------|------|
| **Accueil** | Feed vertical (Pour toi / Abonnements / Afrique) |
| **Découvrir** | Univers (Afrique, Diaspora, Culture, Musique…) — barre → recherche unifiée `/search` |
| **+ (Publier)** | **Create Hub** (Vidéo / Photo / Live prep / Événement actifs ; Texte = Bientôt) → formulaire publish (mode) → mock local ou Storage |
| **Notifications** | Liste branchée `lib/notifications` (empty state sinon) |
| **Profil** | Grille + compte |

Messages = **phase 2** (retiré de la nav principale). Ancienne « Recherche » remplacée par **Découvrir**.

## Public

- Créateur·rice·s et talents en Afrique & diaspora
- Audience mondiale curieuse des cultures africaines
- Marques & labels culturels (phase monétisation)

## MVP (ce dépôt)

| Zone | Statut |
|------|--------|
| Splash / welcome brand | ✅ |
| Auth email/mdp mock **ou** Supabase Auth | ✅ (fallback mock si env vides) |
| Feed vertical plein écran + démos | ✅ |
| Nav Accueil / Découvrir / + / Notifications / Profil | ✅ Étape 1 |
| Rail like / commentaire / partage | ✅ Étape 4 (compteurs + actions) |
| Création : Create Hub + pick média + publier local **ou** Storage | ✅ Hub Vidéo/Photo/Live prep/Événement ; Texte = Bientôt ; preview, #tags, catégorie, limites |
| Profil + grille | ✅ Étape 5 (profil public + édition bio/display_name) |
| Découvrir (catégories) | ✅ UI shell |
| Recherche unifiée (V2.4) | ✅ Personnes / Pubs / Sons / Events / Hashtags |
| Séries (V2.5) | ✅ `series` + `series_items`, profil onglet Séries, menu vidéo |
| Filtres caméra (V2.6) | ✅ Registry + carousel + preview overlay ; `filter_id` (012). **Pas** d’AR visage / LUT native (V3) |
| Notifications (liste Supabase / empty) | ✅ Étape 4 |
| Schéma SQL init + doc Sprint 1 | ✅ `001` + `002` + `docs/SCHEMA_SPRINT1.md` |
| Helpers likes / comments / follows / notifications | ✅ Étape 2 |
| UI engagement (like, commentaires sheet, follow, abo tab) | ✅ Étape 4 |
| Publication polish + profils publics | ✅ Étape 5 |
| Signalement (spam / harcèlement / illégal / autre) | ✅ Étape 6 |
| Blocage utilisateur + filtre feed | ✅ Étape 6 |
| Partage natif (Share API) + empty/error FR | ✅ Étape 7 |
| Guard rails offline (pas de crash si Supabase down) | ✅ Étape 7 |
| Transcoding / CDN pro | ❌ après MVP |
| Lives (streaming réel) / messagerie / marketplace | ⚠️ Live = préparation UI+DB (010) ; streaming Mux/LiveKit ❌ pas encore |



## Critères Sprint 1 — statut (signup → logout)

| Critère | Statut |
|---------|--------|
| Inscription / connexion (mock **ou** Supabase email) | ✅ |
| Parcours Accueil → Découvrir → Publier → Profil | ✅ |
| Like / commentaire / follow dans le feed | ✅ |
| Publication (mock local **ou** Storage) + profil public | ✅ |
| Signalement + blocage (filtre feed) | ✅ |
| Partage natif + états vides / erreurs FR | ✅ |
| Déconnexion (logout) | ✅ |
| Budget 0 € (Expo + Supabase Free) | ✅ |
| `npx tsc --noEmit` OK | ✅ |

**Parcours démo :** créer un compte → publier → liker / commenter / follow → ouvrir un profil → signaler ou bloquer → partager → se déconnecter.

## Après le MVP

### Phase 2 — Fondations
- OAuth (Google / Apple)
- Transcoding vidéo (Mux / Cloudflare Stream) si free tier insuffisant
- Compteurs commentaires serveur (profils publics : ✅ Étape 5)
- ~~Modération de base + signalements (UI)~~ ✅ Étape 6 (légère, sans IA)
- Messagerie (après nav Notifications)
- OAuth (Google / Apple) — aussi listé ci-dessus

### Phase 3 — Engagement
- ~~Séries / collections de vidéos~~ ✅ V2.5 (`011_series.sql`)
- Live / lives culturels — **préparation V2.3** (DB+UI) ; streaming réel = phase suivante
- Duets / stitches
- Challenges & hashtags géoculturels
- Filtres LUT / AR visage natifs (V3) — au-delà des overlays MVP V2.6

### Phase 4 — Croissance & revenus
- Publicités natives respectueuses de la marque
- Tips / monétisation créateurs
- Brand partnerships & catalogues culturels
- Analytics créateur


## Create Hub (+)

L’onglet **+** ouvre d’abord un hub de création (noir / sable / ocre) :
- **Actifs :** Vidéo, Photo → formulaire publish existant (`mode=video|photo`) avec picker / caméra adaptés, **filtres NIA** (carousel post-capture), légende, hashtags, catégories (dont Maghreb / Actus), upload Supabase + `media_type` + `filter_id`.
- **Actif :** Événement → `/events/create` (migration `009_events.sql`).
- **Actif (préparation) :** Live → `/live/create` (migration `010_live_streams.sql`) — métadonnées + UI only ; **pas** de faux player WebRTC/Mux. Placeholder « Bientôt — infrastructure live à brancher ».
- **Bientôt (désactivé) :** Texte — pas de compositeur texte.

## Principes UX

1. **Dark first** — Noir dominant, Or pour accents (CTA +, underline tabs)
2. **Français d’abord** — labels UI en français
3. **Créateur au centre** — handle + caption toujours visibles
4. **Afrique visible** — onglet feed dédié + univers Découvrir
5. **Pas de clichés touristiques** — ton premium, contemporain, afro-tech

## KPIs MVP (cibles)

- Temps de session feed
- Taux de publication (créateurs)
- Rétention J1 / J7
- Partage hors-app

## Hors scope immédiat

- Web social complet
- Marketplace e-commerce
- Streaming long-form type OTT
- Messagerie temps réel (phase 2)
