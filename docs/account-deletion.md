# Suppression de compte — conception v2 (migration 014)

Statut : **brouillon local**, branche `haby/account-deletion-014`. Rien n'a été
exécuté ni déployé sur le projet Supabase.

## Pourquoi remplacer 013

`013_account_deletion.sql` supprime les fichiers par
`delete from storage.objects …`. Or, depuis la migration Storage
`0055-prevent-direct-deletes` (supabase/storage, janvier 2026), un trigger
`BEFORE DELETE … FOR EACH STATEMENT` rejette tout DELETE SQL sur
`storage.objects` avec l'erreur 42501, **même quand aucune ligne n'est
visée**. Conséquence : la RPC échoue pour tous les comptes et la transaction
est annulée (rien n'est supprimé). Le test `supabase/tests/013_regression.test.sql`
le reproduit. Et même autorisé, ce DELETE n'effaçait que les métadonnées : les
fichiers restaient chez le fournisseur de stockage.

## Architecture

```
App (AAB inchangé)
  └─ rpc('delete_own_account')            ← même nom, aucun argument
       UNE transaction, security definer, search_path = ''
       1. supprime les reposts faits PAR D'AUTRES du contenu du compte (chaîne repost_of)
       2. supprime les notifications dont il est l'acteur, et celles qui visent ces reposts
       3. INSERT 2 jobs storage_purge_jobs {uid}/ : immédiat + balayage à +70 min
       4. DELETE auth.users → cascade 001–012
  (commit : le compte est supprimé, reconnexion impossible)

pg_cron (toutes les 10 min) ──x-purge-secret──▶ Edge Function purge-user-storage (service_role)
       claim_storage_purge_jobs (SKIP LOCKED) → list récursif → remove() par lots de 100
       → re-list : vide ? complete : fail(code) → retry avec backoff, max 8 tentatives
```

### Atomicité

- Suppression en base et mise en file sont dans **la même transaction**
  (PostgREST exécute la RPC dans une transaction). Si une étape échoue, rien
  n'est supprimé et le compte reste actif. L'app affiche alors l'erreur et ne
  déconnecte pas (profile.tsx:186-188).
- Le job de purge ne peut pas être perdu : s'il est commité, le compte est
  supprimé ; s'il ne l'est pas, le compte existe encore.
- La purge Storage est **asynchrone et retentable**. Le compte est considéré
  supprimé dès le commit : `auth.users` n'existe plus, donc plus de connexion,
  plus de rafraîchissement de jeton, et toutes les lignes publiques ont disparu.
- **Fenêtre résiduelle.** Le bucket `videos` est **public**
  (001_nia_init.sql:116-120, et la policy `videos_storage_public_read`
  001:131-133). Tant que la purge n'est pas passée, une URL publique déjà
  connue (`/storage/v1/object/public/videos/{uid}/…`) reste servie : jusqu'au
  prochain passage du cron (≤ 10 min). À cela s'ajoute le cache CDN :
  `cacheControl` vaut 3600 s à l'upload (lib/upload.ts `CACHE_CONTROL_SECONDS`,
  et la valeur par défaut de storage-js). Sur le plan Free, le CDN « basique »
  peut donc servir une copie en cache jusqu'à 1 h après la suppression ; le
  Smart CDN (Pro et plus) invalide en ~60 s. Plus aucune ligne en base ne
  pointe vers ces URL après le commit : l'app ne les affiche plus.
- **JWT encore valide.** Le jeton d'accès de l'utilisateur supprimé reste
  valide jusqu'à son expiration (1 h par défaut). La policy Storage
  `videos_storage_insert_own` (001:137-143) n'exige que
  `foldername[1] = auth.uid()` : un upload lancé juste avant la suppression
  pourrait donc arriver après la première purge. C'est ce que rattrape le
  second job, planifié à +70 min. Un 2e appel de la RPC avec ce jeton est un
  no-op (test G1).

### Alternative écartée : purger AVANT de supprimer (Edge Function d'abord)

L'app appellerait une Edge Function, qui supprimerait les fichiers puis
ferait `auth.admin.deleteUser`. Écartée pour quatre raisons :

1. **L'AAB construit appelle `rpc('delete_own_account')`** (lib/account.ts:30).
   Passer par une Edge Function imposerait de modifier le client et de
   reconstruire. La 014 garde la même signature : l'AAB actuel fonctionne sans
   changement.
2. **Il n'y a pas de transaction entre Storage et Postgres.** Si les fichiers
   sont supprimés puis que la suppression en base échoue, on obtient un compte
   actif dont les vidéos sont cassées, sans retour arrière possible. Dans la
   conception retenue, un échec avant le commit ne touche rien, et un échec
   après le commit se rattrape par un simple retry (purge idempotente).
3. La purge peut dépasser la durée d'une requête (gros dossier, erreurs
   réseau). Côté client, l'utilisateur attendrait, ou abandonnerait à
   mi-chemin. Asynchrone, elle a un budget, des retries et une supervision.
4. Cela exposerait publiquement une fonction service_role appelée avec le JWT
   de l'utilisateur. Ici, le worker n'est joignable qu'avec un secret de cron.

Contrepartie assumée : la fenêtre résiduelle décrite ci-dessus (≤ 10 min, plus
le cache CDN).

## Décisions sur les données partagées

| Cas | Décision | Justification |
|---|---|---|
| Reposts faits par d'autres du contenu du compte (`videos.repost_of` → ses vidéos) | **supprimés**, avec leurs likes / commentaires / sauvegardes / reposts / series_items | `createRepost` (lib/reposts.ts:122-136) crée une ligne `videos` au nom du reposteur qui **copie** `storage_path`, `caption`, `hashtags`… de l'original. Avec `repost_of on delete set null` (003:9), cette ligne survivrait avec la légende de la personne supprimée, attribuée à quelqu'un d'autre, et un média cassé après la purge. Ce contenu est celui de la personne supprimée. La chaîne est suivie récursivement (repost d'un repost, données anciennes). |
| Reposts faits par le compte | supprimés (cascade profil) | Le `storage_path` pointe vers le dossier de l'auteur original, qui n'est **pas** purgé (préfixe `{uid}/` uniquement). |
| Notifications dont le compte est l'acteur | **supprimées** | `actor_id on delete set null` (002:140). `notify_on_comment` copie `left(body,120)` du commentaire dans `notifications.body` (002:302-311). Les laisser garderait son texte chez les destinataires. `notify_on_like` et `notify_on_follow` : même logique (action de la personne supprimée). Aucun trigger de notification pour les reposts (002 est la seule migration qui en crée). |
| Notifications visant un repost supprimé | supprimées | Sinon `video_id` passe à NULL : notification orpheline. |
| Notifications reçues | supprimées (cascade `user_id`) | — |
| Signalements faits PAR le compte | supprimés (cascade `reporter_id`, 002:175) | Comportement existant, inchangé. |
| Signalements faits par d'autres SUR le compte, ses vidéos ou ses commentaires (`target_id`, sans FK) | **conservés** | Ils appartiennent au signaleur et servent à la modération (récidive, réinscription, obligations légales). Ils ne contiennent que type, id et raison, sont lisibles seulement par leur auteur (RLS `reports_select_own`) et n'ont pas de FK, donc rien ne casse. |

> **Différence voulue avec la suppression d'UNE vidéo (022).** Supprimer son
> compte efface aussi les reposts faits par d'autres de ses contenus (tableau
> ci-dessus, 014 inchangée). Supprimer définitivement une seule vidéo
> (`delete_own_video_for_good`, migration 022) **laisse** les reposts des
> autres comptes visibles : leur ligne survit (`repost_of` passe à NULL) et le
> fichier est conservé tant qu'une autre ligne `videos` le désigne, quelle que
> soit sa visibilité, son état de modération ou un blocage. Décision du
> fondateur, 30/09/2026.

## Carte Storage (code réel)

Un seul bucket : **`videos`**, public (001:116-120), limite de 50 Mo, types MIME
vidéo, image et audio (008:81-103). Policies (001:130-161) : lecture publique ;
insertion, mise à jour et suppression réservées au dossier
`(storage.foldername(name))[1] = auth.uid()`. **Tout objet d'un utilisateur est
donc forcément sous `{uid}/`**, ce qui rend la purge par préfixe complète.
Aucun `createSignedUrl` dans le code ; 16 appels `getPublicUrl`.

| Bucket | Chemin | Type | Table.colonne | Propriétaire | Méthode d'upload (fichier:ligne) | Purge |
|---|---|---|---|---|---|---|
| videos | `{uid}/{uploadId}.{ext}` | vidéo ou image (post) | `videos.storage_path` (videos.ts:501) | auteur | `uploadToStorage` → REST `POST /storage/v1/object/videos/…` (videos.ts:404, 424 ; upload.ts:68-69, 141, 180, 195) | oui |
| videos | `{uid}/covers/{uploadId}.{jpg\|png\|webp}` | image (couverture) | `videos.cover_path` (videos.ts:509), URL dans `videos.thumbnail_url` | auteur | `uploadToStorage` (videos.ts:472, 477) | oui |
| videos | `{uid}/sounds/{ts}.{ext}` | audio | `sounds.storage_path` (sounds.ts:186) | auteur | `sb.storage.from('videos').upload` (sounds.ts:170, 177) | oui |
| videos | `{uid}/events/{ts}.{ext}` | image | `events.cover_path` (events.ts:297) | organisateur | `.upload` (events.ts:280, 286) | oui |
| videos | `{uid}/series/{ts}.{ext}` | image | `series.cover_path` (series.ts:262) | auteur | `.upload` (series.ts:242, 248) | oui |
| videos | `{uid}/live/{ts}.{ext}` | image | `live_streams.thumbnail_path` (live.ts:288) | auteur | `.upload` (live.ts:269, 275) | oui |
| (aucun) | — | repost | `videos.storage_path` / `cover_path` **copiés** depuis l'original (reposts.ts:125, 128) | reposteur (ligne), auteur original (fichier) | pas d'upload | fichier sous le `{uid}/` de l'auteur original : purgé seulement si c'est lui qui supprime son compte. La ligne du reposteur est alors supprimée par 014. |
| (aucun) | — | avatar | `profiles.avatar_url` | — | **aucun upload** : URL externe (photo Google, Snapchat pour les anciens comptes, ou `i.pravatar.cc`), posée par `handle_new_user` (001:91-99) et `AuthContext.tsx:145-150, 175-181` | rien à purger ; la ligne `profiles` part par cascade |

## Ce que supprime `delete_own_account()` (014)

| Donnée | Sort | Mécanisme |
|---|---|---|
| auth.users | supprimé | DELETE explicite |
| profiles | supprimé | cascade (001:11) |
| videos (y compris soft-deleted et reposts faits par le compte) | supprimé | cascade (001:38) |
| lignes `videos` de reposts faits par d'autres | supprimé | DELETE explicite (014) |
| likes, comments, saves, reposts, series_items (visant ses vidéos ou les reposts ci-dessus) | supprimé | cascade via `video_id` |
| likes, comments, saves, reposts, follows (les deux sens), blocks (les deux sens) du compte | supprimé | cascade via `profiles` |
| notifications reçues | supprimé | cascade (`user_id`) |
| notifications émises (acteur) | supprimé | DELETE explicite (014) |
| reports faits par le compte | supprimé | cascade (`reporter_id`) |
| reports sur le compte | **conservé** | pas de FK (voir plus haut) |
| sounds | supprimé | cascade ; `videos.sound_id` des autres passe à NULL (008:37) |
| events, event_attendees (dont ceux des autres sur ses événements) | supprimé | cascade ; `videos.event_id` des autres passe à NULL (009:63) |
| live_streams | supprimé | cascade |
| series, series_items | supprimé | cascade ; les séries des autres perdent ses épisodes (des trous peuvent apparaître dans `position`) |
| fichiers `videos/{uid}/…` | supprimés **de façon asynchrone** | Edge Function `purge-user-storage` (API Storage) |
| storage_purge_jobs | conservé (trace technique : uuid, statut, codes) | aucune donnée personnelle hormis l'uuid |

## Mise en production (à faire à la main, après validation)

1. SQL Editor : exécuter `014_account_deletion.sql` (après 013 ; ne jamais
   ré-exécuter 013 ensuite).
2. Secret `PURGE_CRON_SECRET`, déploiement de `purge-user-storage`
   (`--no-verify-jwt`), test manuel, puis cron : voir
   `supabase/functions/purge-user-storage/README.md`.
3. Test sur appareil Android réel avec un compte jetable.
