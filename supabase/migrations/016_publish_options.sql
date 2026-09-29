-- NIA — 016 : options de publication et réglages d'édition (sprint Créer S5)
-- À exécuter APRÈS 015 dans Supabase Dashboard → SQL Editor.
-- Idempotent : peut être rejoué sans effet de bord (ADD COLUMN IF NOT EXISTS,
-- DROP … IF EXISTS puis CREATE, CREATE OR REPLACE FUNCTION).
--
-- Ce que ça change :
--  1. videos : visibility ('public' | 'followers' | 'private'), allow_comments,
--     allow_reuse, ai_generated, alt_text (≤ 500), location_text (≤ 100),
--     edit_meta (jsonb ≤ 16 Ko : découpe, vitesse, son, volumes, calques).
--     Les vidéos existantes restent publiques, commentables et republiables
--     (valeurs par défaut) : aucun changement visible pour elles.
--  2. Lecture des vidéos (policy videos_select_public, remplacée) :
--     - publiée + public → tout le monde (comme avant) ;
--     - publiée + followers → le créateur et ses abonnés ;
--     - private → le créateur seulement (non répertoriée ailleurs) ;
--     - le créateur voit toujours ses vidéos non supprimées (comme avant) ;
--     - une republication (repost_of) n'est visible que tant que l'original
--       est publié, public et republiable.
--  3. Commentaires : écrire exige de pouvoir voir la vidéo, qu'elle soit
--     publiée et que allow_comments soit vrai. Lire les commentaires exige de
--     pouvoir voir la vidéo — sauf ses propres commentaires, toujours lisibles
--     (la suppression de son commentaire, PR #27, fait DELETE … RETURNING et
--     doit continuer à voir sa ligne).
--  4. Republication : la ligne `reposts` et la ligne `videos` (repost_of)
--     exigent un original publié, public, avec allow_reuse, et qui n'est pas
--     lui-même une republication.
--
--  5. Storage (bucket `videos`) : la policy SELECT « videos_storage_public_read »
--     (001, lecture de storage.objects par tout le monde) permettait de LISTER
--     le dossier {user_id}/ de n'importe qui via l'API Storage, donc de
--     retrouver les fichiers des vidéos « followers » / « private ». Elle est
--     remplacée par « videos_storage_read_own » : chacun ne liste que son
--     dossier (nécessaire à remove/upsert côté app). Les téléchargements par
--     URL publique (/object/public/…) ne passent pas par cette policy : lecture
--     des vidéos, couvertures et sons inchangée. La purge (Edge Function,
--     service_role) n'est pas concernée.
--
-- Limite connue, inchangée : le bucket reste « public ». La visibilité masque
-- la vidéo des listes, des profils, de l'API et du listing Storage ; elle ne
-- protège pas un fichier dont on connaît déjà l'URL (chemin
-- {user_id}/{uploadId aléatoire}, non devinable, mais une URL partagée reste
-- lisible).
--
-- Les fonctions nia_* sont SECURITY DEFINER (propriétaire : postgres, qui
-- n'est pas soumis à la RLS de ses tables) avec search_path vide : elles
-- évitent la récursion « policy videos → videos » et ne renvoient qu'un booléen.

-- ===========================================================================
-- 1. Colonnes
-- ===========================================================================
alter table public.videos add column if not exists visibility text not null default 'public';
alter table public.videos add column if not exists allow_comments boolean not null default true;
alter table public.videos add column if not exists allow_reuse boolean not null default true;
alter table public.videos add column if not exists ai_generated boolean not null default false;
alter table public.videos add column if not exists alt_text text;
alter table public.videos add column if not exists location_text text;
alter table public.videos add column if not exists edit_meta jsonb;

-- Validation de edit_meta (fonction immuable : utilisable dans un CHECK).
-- Évalue les champs dans l'ordre, sans conversion hasardeuse : un document
-- mal formé est refusé (false), jamais une erreur de cast.
create or replace function public.nia_edit_meta_ok(m jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v jsonb;
  -- Nombre JSON borné, sans cast tant que le type n'est pas vérifié
  -- (IF imbriqués : l'ordre d'évaluation d'un OR SQL n'est pas garanti).
  k text;
begin
  if m is null then
    return true;
  end if;
  if jsonb_typeof(m) <> 'object' then
    return false;
  end if;
  if octet_length(m::text) > 16384 then
    return false;
  end if;

  -- speed ∈ [0.25, 4], originalVolume ∈ [0, 1]
  foreach k in array array['speed', 'originalVolume'] loop
    v := m -> k;
    if v is not null and jsonb_typeof(v) <> 'null' then
      if jsonb_typeof(v) <> 'number' then
        return false;
      end if;
      if k = 'speed' and (v #>> '{}')::numeric not between 0.25 and 4 then
        return false;
      end if;
      if k = 'originalVolume' and (v #>> '{}')::numeric not between 0 and 1 then
        return false;
      end if;
    end if;
  end loop;

  -- sound : { offsetMs ∈ [0, 1 h], volume ∈ [0, 1] }
  v := m -> 'sound';
  if v is not null and jsonb_typeof(v) <> 'null' then
    if jsonb_typeof(v) <> 'object' then
      return false;
    end if;
    if v ? 'offsetMs' then
      if jsonb_typeof(v -> 'offsetMs') <> 'number' then
        return false;
      end if;
      if (v ->> 'offsetMs')::numeric not between 0 and 3600000 then
        return false;
      end if;
    end if;
    if v ? 'volume' then
      if jsonb_typeof(v -> 'volume') <> 'number' then
        return false;
      end if;
      if (v ->> 'volume')::numeric not between 0 and 1 then
        return false;
      end if;
    end if;
  end if;

  -- overlays : { items: [≤ 20] }. L'app plafonne à 8 Ko (JSON compact,
  -- lib/overlays.ts) ; le texte jsonb de Postgres ajoute des espaces, d'où
  -- la marge (10 Ko ici, 16 Ko pour tout edit_meta, 12 Ko côté app).
  v := m -> 'overlays';
  if v is not null and jsonb_typeof(v) <> 'null' then
    if jsonb_typeof(v) <> 'object' then
      return false;
    end if;
    if octet_length(v::text) > 10240 then
      return false;
    end if;
    if v ? 'items' then
      if jsonb_typeof(v -> 'items') <> 'array' then
        return false;
      end if;
      if jsonb_array_length(v -> 'items') > 20 then
        return false;
      end if;
    end if;
  end if;

  return true;
end;
$$;

alter table public.videos drop constraint if exists videos_visibility_check;
alter table public.videos add constraint videos_visibility_check
  check (visibility in ('public', 'followers', 'private'));

alter table public.videos drop constraint if exists videos_alt_text_len_check;
alter table public.videos add constraint videos_alt_text_len_check
  check (alt_text is null or char_length(alt_text) <= 500);

alter table public.videos drop constraint if exists videos_location_text_len_check;
alter table public.videos add constraint videos_location_text_len_check
  check (location_text is null or char_length(location_text) <= 100);

alter table public.videos drop constraint if exists videos_edit_meta_check;
alter table public.videos add constraint videos_edit_meta_check
  check (public.nia_edit_meta_ok(edit_meta));

-- Vidéos non publiques du créateur (profil) : index partiel léger.
create index if not exists videos_visibility_idx on public.videos (user_id, visibility)
  where visibility <> 'public';

-- ===========================================================================
-- 2. Fonctions d'accès (booléens seulement)
-- ===========================================================================

-- L'utilisateur courant suit-il p_owner ?
create or replace function public.nia_is_follower(p_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from public.follows f
     where f.follower_id = auth.uid() and f.following_id = p_owner
  );
$$;

-- Un original accepte-t-il d'être republié ?
create or replace function public.nia_video_reusable(p_video_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.videos v
     where v.id = p_video_id
       and v.status = 'published'
       and v.visibility = 'public'
       and v.allow_reuse
       and v.repost_of is null
  );
$$;

-- Règle de lecture d'une ligne videos (utilisée par la policy SELECT).
create or replace function public.nia_video_row_visible(
  p_owner uuid,
  p_status text,
  p_visibility text,
  p_repost_of uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (
      (p_status = 'published' and (
          coalesce(p_visibility, 'public') = 'public'
          or (p_visibility = 'followers'
              and (auth.uid() = p_owner or public.nia_is_follower(p_owner)))
      ))
      or (auth.uid() = p_owner and p_status is distinct from 'deleted')
    )
    and (p_repost_of is null or public.nia_video_reusable(p_repost_of));
$$;

-- L'utilisateur courant peut-il voir cette vidéo ?
create or replace function public.nia_can_view_video(p_video_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.videos v
     where v.id = p_video_id
       and public.nia_video_row_visible(v.user_id, v.status, v.visibility, v.repost_of)
  );
$$;

-- L'utilisateur courant peut-il commenter cette vidéo ?
create or replace function public.nia_video_accepts_comments(p_video_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.videos v
     where v.id = p_video_id
       and v.status = 'published'
       and v.allow_comments
       and public.nia_video_row_visible(v.user_id, v.status, v.visibility, v.repost_of)
  );
$$;

revoke all on function public.nia_is_follower(uuid) from public;
revoke all on function public.nia_video_reusable(uuid) from public;
revoke all on function public.nia_video_row_visible(uuid, text, text, uuid) from public;
revoke all on function public.nia_can_view_video(uuid) from public;
revoke all on function public.nia_video_accepts_comments(uuid) from public;
grant execute on function public.nia_is_follower(uuid) to anon, authenticated, service_role;
grant execute on function public.nia_video_reusable(uuid) to anon, authenticated, service_role;
grant execute on function public.nia_video_row_visible(uuid, text, text, uuid) to anon, authenticated, service_role;
grant execute on function public.nia_can_view_video(uuid) to anon, authenticated, service_role;
grant execute on function public.nia_video_accepts_comments(uuid) to anon, authenticated, service_role;
grant execute on function public.nia_edit_meta_ok(jsonb) to anon, authenticated, service_role;

-- ===========================================================================
-- 3. Policies
-- ===========================================================================

-- videos : lecture (remplace 005/006).
drop policy if exists "videos_select_public" on public.videos;
create policy "videos_select_public"
  on public.videos for select
  using (public.nia_video_row_visible(user_id, status, visibility, repost_of));

-- videos : insertion (remplace 006) + garde-fou republication.
drop policy if exists "videos_insert_own" on public.videos;
create policy "videos_insert_own"
  on public.videos for insert
  to authenticated
  with check (
    auth.uid() is not null
    and auth.uid() = user_id
    and (repost_of is null or public.nia_video_reusable(repost_of))
  );

-- comments : lecture (remplace 002, qui était « using (true) »).
drop policy if exists "comments_select_public" on public.comments;
create policy "comments_select_public"
  on public.comments for select
  using (auth.uid() = user_id or public.nia_can_view_video(video_id));

-- comments : écriture (remplace 002).
drop policy if exists "comments_insert_own" on public.comments;
create policy "comments_insert_own"
  on public.comments for insert
  with check (auth.uid() = user_id and public.nia_video_accepts_comments(video_id));

-- comments_update_own / comments_delete_own (002) : inchangées.

-- reposts : écriture (remplace 003).
drop policy if exists "reposts_insert_own" on public.reposts;
create policy "reposts_insert_own"
  on public.reposts for insert
  with check (auth.uid() = user_id and public.nia_video_reusable(video_id));

-- ===========================================================================
-- 4. Storage : plus de listing des dossiers des autres (remplace 001)
-- ===========================================================================
drop policy if exists "videos_storage_public_read" on storage.objects;
drop policy if exists "videos_storage_read_own" on storage.objects;
create policy "videos_storage_read_own"
  on storage.objects for select
  using (
    bucket_id = 'videos'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ===========================================================================
-- ROLLBACK (à exécuter à la main, dans cet ordre, si 016 doit être retiré)
-- ===========================================================================
-- -- Policies d'avant 016 (identiques à 006 / 002 / 003 / 001) :
-- drop policy if exists "videos_storage_read_own" on storage.objects;
-- create policy "videos_storage_public_read" on storage.objects for select
--   using (bucket_id = 'videos');
-- drop policy if exists "videos_select_public" on public.videos;
-- create policy "videos_select_public" on public.videos for select
--   using (status = 'published' or (auth.uid() = user_id and status is distinct from 'deleted'));
-- drop policy if exists "videos_insert_own" on public.videos;
-- create policy "videos_insert_own" on public.videos for insert to authenticated
--   with check (auth.uid() is not null and auth.uid() = user_id);
-- drop policy if exists "comments_select_public" on public.comments;
-- create policy "comments_select_public" on public.comments for select using (true);
-- drop policy if exists "comments_insert_own" on public.comments;
-- create policy "comments_insert_own" on public.comments for insert
--   with check (auth.uid() = user_id);
-- drop policy if exists "reposts_insert_own" on public.reposts;
-- create policy "reposts_insert_own" on public.reposts for insert
--   with check (auth.uid() = user_id);
--
-- -- Fonctions :
-- drop function if exists public.nia_video_accepts_comments(uuid);
-- drop function if exists public.nia_can_view_video(uuid);
-- drop function if exists public.nia_video_row_visible(uuid, text, text, uuid);
-- drop function if exists public.nia_video_reusable(uuid);
-- drop function if exists public.nia_is_follower(uuid);
--
-- -- Colonnes (PERTE DE DONNÉES : options et réglages d'édition des vidéos
-- -- publiées après 016). Facultatif : les garder ne gêne pas l'ancienne app.
-- drop index if exists public.videos_visibility_idx;
-- alter table public.videos drop constraint if exists videos_edit_meta_check;
-- alter table public.videos drop constraint if exists videos_location_text_len_check;
-- alter table public.videos drop constraint if exists videos_alt_text_len_check;
-- alter table public.videos drop constraint if exists videos_visibility_check;
-- drop function if exists public.nia_edit_meta_ok(jsonb);
-- alter table public.videos
--   drop column if exists edit_meta,
--   drop column if exists location_text,
--   drop column if exists alt_text,
--   drop column if exists ai_generated,
--   drop column if exists allow_reuse,
--   drop column if exists allow_comments,
--   drop column if exists visibility;
-- ⚠️ Retirer les policies SANS retirer les colonnes rend les vidéos
-- « followers » et « private » lisibles par tous : toujours restaurer les
-- policies ET passer ces vidéos en archived, ou ne rien retirer.
