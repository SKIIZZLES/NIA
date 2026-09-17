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
| **Découvrir** | Univers (Afrique, Diaspora, Culture, Musique…) — recherche full-text plus tard |
| **+ (Publier)** | Pick média + légende → mock local ou Storage |
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
| Création : pick média + publier local **ou** Storage | ✅ Étape 5 (preview, #tags, catégorie, limites) |
| Profil + grille | ✅ Étape 5 (profil public + édition bio/display_name) |
| Découvrir (catégories) | ✅ UI shell |
| Notifications (liste Supabase / empty) | ✅ Étape 4 |
| Schéma SQL init + doc Sprint 1 | ✅ `001` + `002` + `docs/SCHEMA_SPRINT1.md` |
| Helpers likes / comments / follows / notifications | ✅ Étape 2 |
| UI engagement (like, commentaires sheet, follow, abo tab) | ✅ Étape 4 |
| Publication polish + profils publics | ✅ Étape 5 |
| Transcoding / CDN pro | ❌ prochain |
| Lives / messagerie / marketplace | ❌ hors scope immédiat |

## Après le MVP

### Phase 2 — Fondations
- OAuth (Google / Apple)
- Transcoding vidéo (Mux / Cloudflare Stream) si free tier insuffisant
- Compteurs commentaires serveur (profils publics : ✅ Étape 5)
- Modération de base + signalements (UI)
- Messagerie (après nav Notifications)
- OAuth (Google / Apple) — aussi listé ci-dessus

### Phase 3 — Engagement
- Live / lives culturels
- Duets / stitches
- Challenges & hashtags géoculturels

### Phase 4 — Croissance & revenus
- Publicités natives respectueuses de la marque
- Tips / monétisation créateurs
- Brand partnerships & catalogues culturels
- Analytics créateur

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
