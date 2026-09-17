# NIA — Schéma de données Sprint 1

Document de conception pour le modèle relationnel à construire / étendre sur **Supabase (plan Free)**.  
Objectif : démo investisseur (feed, publication, profils, engagement de base) à **budget 0 €**.

> Extensible plus tard : tips, brand deals, analytics créateur, lives — sans casser les tables ci-dessous.

---

## État actuel (`supabase/migrations/001_nia_init.sql`)

| Élément | Statut | Notes |
|---------|--------|-------|
| `profiles` | ✅ Existe | `id`, `username`, `bio`, `avatar_url`, `created_at` |
| `videos` | ✅ Existe | `id`, `user_id`, `storage_path`, `caption`, `region`, `tag`, `like_count`, `created_at` |
| Trigger `handle_new_user` | ✅ Existe | Crée un profil à l’inscription Auth |
| Bucket Storage `videos` | ✅ Existe | Public read, upload `{user_id}/…` |
| RLS profiles / videos | ✅ Existe | Select public ; write own |
| `profiles.display_name` | ❌ Manquant | Affichage séparable du `@handle` |
| `videos.thumbnail_url` | ❌ Manquant | Aperçu grille / feed sans lire le média |
| `videos.status` | ❌ Manquant | `draft` / `processing` / `published` / `rejected` |
| `videos.category` | ❌ Manquant | Aligné Découvrir (afrique, diaspora, culture…) |
| `videos` hashtags | ❌ Manquant | Caption seule aujourd’hui ; hashtags structurés à venir |
| `likes` | ❌ Manquant | Compteur dénormalisé seulement (`like_count`) |
| `comments` | ❌ Manquant | — |
| `follows` | ❌ Manquant | — |
| `notifications` | ❌ Manquant | — |
| `reports` | ❌ Manquant | — |
| `blocks` | ❌ Manquant | — |

---

## Tables Sprint 1 (cible)

### 1. `profiles` (étendre)

| Colonne | Type | Description |
|---------|------|-------------|
| `id` | uuid PK → `auth.users` | Existant |
| `username` | text unique | Handle `@…` |
| **`display_name`** | text | Nom affiché (nouveau) |
| `bio` | text | Existant |
| `avatar_url` | text | Existant |
| `created_at` | timestamptz | Existant |
| *(plus tard)* `country_code`, `is_creator`, `stripe_account_id` | — | Économie créateur |

### 2. `videos` (étendre)

| Colonne | Type | Description |
|---------|------|-------------|
| `id` | uuid PK | Existant |
| `user_id` | uuid → profiles | Existant |
| `storage_path` | text | Existant |
| **`thumbnail_url`** | text | Nouveau — URL publique vignette |
| **`status`** | text / enum | Nouveau — défaut `published` (MVP) |
| **`category`** | text | Nouveau — ex. `afrique`, `diaspora`, `culture`, `musique`… |
| `caption` | text | Existant — légende + hashtags en texte libre au MVP |
| **`hashtags`** | text[] *(optionnel)* | Nouveau — extraction / index recherche |
| `region` | text | Existant — pays / zone (legacy ok) |
| `tag` | text | Existant — peut migrer vers `category` |
| `like_count` | int | Existant — tenu à jour via trigger likes |
| `created_at` | timestamptz | Existant |

`status` recommandé : `draft` | `processing` | `published` | `rejected` | `archived`.

### 3. `likes`

| Colonne | Type |
|---------|------|
| `user_id` | uuid → profiles |
| `video_id` | uuid → videos |
| `created_at` | timestamptz |
| PK | `(user_id, video_id)` |

RLS : insert/delete own ; select public ou own selon besoin produit.

### 4. `comments`

| Colonne | Type |
|---------|------|
| `id` | uuid PK |
| `video_id` | uuid → videos |
| `user_id` | uuid → profiles |
| `body` | text |
| `created_at` | timestamptz |
| *(plus tard)* `parent_id` | uuid nullable — threads |

### 5. `follows`

| Colonne | Type |
|---------|------|
| `follower_id` | uuid → profiles |
| `following_id` | uuid → profiles |
| `created_at` | timestamptz |
| PK | `(follower_id, following_id)` |
| Check | `follower_id <> following_id` |

Alimente l’onglet feed **Abonnements**.

### 6. `notifications`

| Colonne | Type |
|---------|------|
| `id` | uuid PK |
| `user_id` | uuid → profiles (destinataire) |
| `actor_id` | uuid → profiles (nullable) |
| `type` | text — `like`, `comment`, `follow`, `system`… |
| `video_id` | uuid nullable → videos |
| `body` | text |
| `read_at` | timestamptz nullable |
| `created_at` | timestamptz |

UI shell déjà en place (onglet Notifications). Backend = Sprint 2.

### 7. `reports`

| Colonne | Type |
|---------|------|
| `id` | uuid PK |
| `reporter_id` | uuid → profiles |
| `target_type` | text — `video` \| `user` \| `comment` |
| `target_id` | uuid |
| `reason` | text |
| `status` | text — `open` \| `reviewed` \| `dismissed` |
| `created_at` | timestamptz |

### 8. `blocks`

| Colonne | Type |
|---------|------|
| `blocker_id` | uuid → profiles |
| `blocked_id` | uuid → profiles |
| `created_at` | timestamptz |
| PK | `(blocker_id, blocked_id)` |

Filtrer feed / commentaires / follows côté requêtes.

---

## Hors Sprint 1 (garder extensible)

- `messages` / `threads` — **phase 2** (retiré de la nav principale)
- `tips`, `creator_payouts`, `brand_campaigns` — économie créateur
- `live_sessions`, `duets` — engagement avancé
- CDN / transcoding (Mux, Cloudflare Stream) — `videos.playback_url` futur

---

## Ordre d’implémentation suggéré (Étape 2+)

1. Migration `002` : colonnes manquantes `profiles` + `videos`
2. Tables `likes`, `comments`, `follows` + triggers compteurs
3. `notifications` + écriture depuis likes/comments/follows
4. `reports` + `blocks` (confiance & sûreté démo)
5. Brancher l’UI Découvrir sur `videos.category` + recherche

Contrainte budget : tout sur **Supabase Free** + Expo ; pas de service payant obligatoire pour la démo.
