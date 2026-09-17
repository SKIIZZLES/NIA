# NIA — Schéma de données Sprint 1

Document de conception pour le modèle relationnel à construire / étendre sur **Supabase (plan Free)**.  
Objectif : démo investisseur (feed, publication, profils, engagement de base) à **budget 0 €**.

> Extensible plus tard : tips, brand deals, analytics créateur, lives — sans casser les tables ci-dessous.

---

## État actuel

| Élément | Statut | Notes |
|---------|--------|-------|
| `profiles` | ✅ Existe (001) | `id`, `username`, `bio`, `avatar_url`, `created_at` |
| `videos` | ✅ Existe (001) | `id`, `user_id`, `storage_path`, `caption`, `region`, `tag`, `like_count`, `created_at` |
| Trigger `handle_new_user` | ✅ Existe (001) | Crée un profil à l’inscription Auth |
| Bucket Storage `videos` | ✅ Existe (001) | Public read, upload `{user_id}/…` |
| RLS profiles / videos | ✅ Existe (001) | Select public ; write own |
| `profiles.display_name` | ✅ 002 | Affichage séparable du `@handle` |
| `videos.thumbnail_url` | ✅ 002 | Aperçu grille / feed sans lire le média |
| `videos.status` | ✅ 002 | `draft` / `processing` / `published` / `rejected` / `archived` (défaut `published`) |
| `videos.category` | ✅ 002 | Aligné Découvrir (`afrique`, `diaspora`, `culture`…) |
| `videos.hashtags` | ✅ 002 | `text[]` optionnel |
| `likes` | ✅ 002 | PK `(user_id, video_id)` + trigger `like_count` |
| `comments` | ✅ 002 | RLS own write / public read |
| `follows` | ✅ 002 | Check no-self + RLS |
| `notifications` | ✅ 002 | Triggers stubs like/comment/follow |
| `reports` | ✅ 002 | `video` \| `user` \| `comment` |
| `blocks` | ✅ 002 | PK `(blocker_id, blocked_id)` |

Migrations :

1. `supabase/migrations/001_nia_init.sql` — Auth profiles + vidéos + storage
2. `supabase/migrations/002_sprint1_engagement.sql` — colonnes + engagement + RLS + triggers

---

## Tables Sprint 1 (cible)

### 1. `profiles` (étendre)

| Colonne | Type | Description |
|---------|------|-------------|
| `id` | uuid PK → `auth.users` | Existant |
| `username` | text unique | Handle `@…` |
| **`display_name`** | text | Nom affiché (002) |
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
| **`thumbnail_url`** | text | 002 — URL publique vignette |
| **`status`** | text / enum | 002 — défaut `published` (MVP) |
| **`category`** | text | 002 — ex. `afrique`, `diaspora`, `culture`, `musique`… |
| `caption` | text | Existant — légende + hashtags en texte libre au MVP |
| **`hashtags`** | text[] *(optionnel)* | 002 — extraction / index recherche |
| `region` | text | Existant — pays / zone (legacy ok) |
| `tag` | text | Existant — peut migrer vers `category` |
| `like_count` | int | Existant — tenu à jour via trigger likes (002) |
| `created_at` | timestamptz | Existant |

`status` recommandé : `draft` | `processing` | `published` | `rejected` | `archived`.

### 3. `likes`

| Colonne | Type |
|---------|------|
| `user_id` | uuid → profiles |
| `video_id` | uuid → videos |
| `created_at` | timestamptz |
| PK | `(user_id, video_id)` |

RLS : insert/delete own ; select public.

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

UI shell déjà en place (onglet Notifications). Helpers `lib/notifications.ts` prêts ; UI riche = Étape 4+.

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

## Ordre d’implémentation

1. ~~Migration `002` : colonnes manquantes `profiles` + `videos`~~ ✅
2. ~~Tables `likes`, `comments`, `follows` + triggers compteurs~~ ✅
3. ~~`notifications` + écriture depuis likes/comments/follows~~ ✅ (stubs triggers)
4. ~~`reports` + `blocks`~~ ✅ (schéma + RLS)
5. ~~Brancher l’UI Découvrir sur `videos.category`~~ ✅ (helpers + filtre)
6. **Étape 3** : auth réelle + projet Supabase branché (`.env` + run 001 puis 002)
7. Étapes 4–6 : UI commentaires / follows profil / notifications riches

Contrainte budget : tout sur **Supabase Free** + Expo ; pas de service payant obligatoire pour la démo.
