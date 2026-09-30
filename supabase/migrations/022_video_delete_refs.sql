-- NIA — 022 : suppression définitive d'une vidéo par son auteur, reposts conservés
-- À exécuter APRÈS 018 (et 019 si elle est déjà appliquée) dans Supabase
-- Dashboard → SQL Editor, en une fois. 020 et 021 sont réservées : 022 n'en
-- dépend pas. Idempotent : peut être rejoué sans effet de bord
-- (CREATE OR REPLACE, CREATE INDEX IF NOT EXISTS, REVOKE / GRANT).
-- Vérification ensuite : supabase/tests/022_verify_after_apply.sql (chaque
-- ligne doit afficher ok = true).
--
-- Problème (défaut 2, PR #41) : `lib/videos.ts:cheminEncoreReference`
-- comptait les lignes qui désignent encore un fichier du bucket `videos` avec
-- un SELECT ordinaire, donc filtré par la policy `videos_select_public`
-- (016 / 017). Un repost d'autrui archivé, en visibilité « followers » ou
-- « private », masqué par la modération, ou d'un compte avec lequel il y a un
-- blocage était INVISIBLE au comptage : le fichier était effacé et la carte du
-- reposteur pointait sur un 404. La RLS cache ces lignes à raison : le
-- comptage ne peut pas se faire côté client.
--
-- Décision du fondateur : quand un créateur supprime définitivement sa vidéo,
-- les reposts faits par d'autres comptes RESTENT visibles. Le fichier est
-- conservé tant qu'une autre ligne `videos` le désigne, quels que soient sa
-- visibilité, son état de modération, son statut ou un blocage.
--
-- Correctif : RPC `delete_own_video_for_good(p_video_id)`, SECURITY DEFINER,
-- search_path vide (conventions 016 / 017), sur le modèle de la 015. Dans UNE
-- transaction :
--   1. verrouille la ligne (FOR UPDATE) si elle appartient à auth.uid() ;
--   2. refuse une vidéo masquée ou retirée (même règle que la policy
--      `videos_delete_own` de 017 : c'est une preuve) ;
--   3. classe les chemins du dossier `{auth.uid()}/` de la ligne
--      (storage_path, cover_path) en « encore utilisés par une autre ligne »
--      et « effaçables » — sans aucun filtre de visibilité ;
--   4. supprime la ligne.
-- Elle renvoie un jsonb :
--   {"ok": true,  "removable": [...], "kept": [...]}
--   {"ok": false, "reason": "not_found" | "moderation_hold"}
-- `removable` / `kept` ne contiennent que des chemins du dossier de
-- l'appelant, déjà connus de lui : rien sur les autres lignes (ni id, ni
-- propriétaire, ni nombre) ne sort. Une vidéo d'un autre compte et une vidéo
-- inexistante donnent la même réponse (`not_found`).
--
-- L'effacement des fichiers reste fait par l'app via l'API Storage (le
-- trigger storage.protect_delete interdit tout DELETE SQL sur
-- storage.objects, voir 014), sous la policy `videos_storage_delete_own`
-- (017, inchangée : dossier du compte, fichier non retenu par la modération).
--
-- Course avec un nouveau repost : un repost insère une ligne dont repost_of
-- désigne l'original (clé étrangère 003). Le contrôle de clé étrangère prend
-- un verrou FOR KEY SHARE sur l'original, incompatible avec le FOR UPDATE de
-- l'étape 1 : soit le repost est validé avant et il est compté (chaque ordre
-- plpgsql relit un instantané frais en READ COMMITTED), soit il attend la fin
-- de la suppression et échoue (original disparu).
--
-- Inchangé : policies et gardes de 016 / 017 / 018 / 019 (la RPC ne modifie
-- aucune policy ni aucun trigger ; les triggers de `videos` s'appliquent à son
-- DELETE comme à celui de l'app), `soft_delete_own_video` (015), et la
-- suppression de COMPTE (014, `delete_own_account`), qui continue d'effacer
-- les reposts faits par d'autres du contenu du compte supprimé. Les deux
-- chemins diffèrent volontairement : un compte supprimé emporte tout ce qui
-- vient de lui ; une vidéo supprimée laisse vivre les reposts des autres.
--
-- Compatibilité : l'app de cette PR appelle la RPC et, si elle n'existe pas
-- encore (PGRST202 / 42883), reprend l'ancien chemin client. Les anciens APK
-- continuent d'utiliser l'ancien chemin (défaut 2 toujours présent pour eux).

-- Index pour la recherche de références (aussi utile à
-- nia_storage_path_on_hold de 017, appelée par les policies Storage).
create index if not exists videos_storage_path_idx on public.videos (storage_path);
create index if not exists videos_cover_path_idx on public.videos (cover_path)
  where cover_path is not null;

create or replace function public.delete_own_video_for_good(p_video_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_prefix text;
  v_row record;
  v_path text;
  v_kept text[] := '{}';
  v_removable text[] := '{}';
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if p_video_id is null then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  select v.id, v.storage_path, v.cover_path, v.moderation_state
    into v_row
    from public.videos v
   where v.id = p_video_id
     and v.user_id = v_uid
     for update;

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if v_row.moderation_state is distinct from 'visible' then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'moderation_hold');
  end if;

  v_prefix := v_uid::text || '/';
  for v_path in
    select p.path
      from pg_catalog.unnest(array[v_row.storage_path, v_row.cover_path])
             with ordinality as p(path, ord)
     where p.path is not null
       and p.path <> ''
       and pg_catalog.starts_with(p.path, v_prefix)
     group by p.path
     order by pg_catalog.min(p.ord)
  loop
    if exists (
      select 1 from public.videos o
       where o.id <> p_video_id
         and (o.storage_path = v_path or o.cover_path = v_path)
    ) then
      v_kept := v_kept || v_path;
    else
      v_removable := v_removable || v_path;
    end if;
  end loop;

  delete from public.videos v
   where v.id = p_video_id
     and v.user_id = v_uid
     and v.moderation_state = 'visible';

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'removable', pg_catalog.to_jsonb(v_removable),
    'kept', pg_catalog.to_jsonb(v_kept)
  );
end;
$$;

comment on function public.delete_own_video_for_good(uuid) is
  'Supprime définitivement la vidéo de l''appelant (auth.uid()) et classe ses chemins {uid}/ en removable / kept (encore désignés par une autre ligne videos, sans filtre de visibilité). Ne touche jamais storage.objects (022).';

revoke all on function public.delete_own_video_for_good(uuid) from public, anon, service_role;
grant execute on function public.delete_own_video_for_good(uuid) to authenticated;

-- Retour arrière (à la main, si besoin) : l'app reprend alors l'ancien chemin.
-- drop function if exists public.delete_own_video_for_good(uuid);
-- drop index if exists public.videos_cover_path_idx;
-- drop index if exists public.videos_storage_path_idx;
