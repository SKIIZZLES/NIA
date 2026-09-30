-- NIA — 017 : sécurité, signalements v2, preuves, modération (sprint Sécurité S2)
-- À exécuter APRÈS 016 dans Supabase Dashboard → SQL Editor, en une fois.
-- Idempotent : peut être rejoué sans effet de bord (IF NOT EXISTS, DROP … IF
-- EXISTS puis CREATE, CREATE OR REPLACE, ON CONFLICT). Vérification ensuite :
-- supabase/tests/017_verify_after_apply.sql (chaque ligne doit afficher ok = true).
--
-- Ce que ça change :
--  1. moderators : liste des modérateurs (écriture au SQL Editor uniquement).
--     Les RPC mod_* acceptent un modérateur connecté OU le SQL Editor
--     (connexion directe, sans JWT) OU service_role.
--  2. Colonnes de modération, non modifiables par l'app :
--     videos.moderation_state (visible | held | removed) + moderation_reason,
--     comments.moderation_state, live_streams.moderation_state,
--     profiles.suspended_at / suspended_until, notifications.meta (jsonb).
--  3. Garde-fous (triggers) : l'app ne peut plus écrire les compteurs
--     (like/share/save_count), ni sortir une vidéo de « rejected », ni changer
--     storage_path / repost_of après coup, ni toucher aux colonnes de
--     modération. Limite : 1 commentaire / 3 s et 30 / 10 min par personne.
--     Une vidéo en attente ou retirée ne peut plus être supprimée par son
--     auteur (ni la ligne ni le fichier) : c'est une preuve.
--  4. Blocage appliqué côté serveur : si A bloque B (ou l'inverse), aucun des
--     deux ne voit plus les vidéos, commentaires et lives de l'autre, ni ne
--     peut commenter, liker, sauvegarder, suivre ; les abonnements mutuels sont
--     supprimés au moment du blocage.
--  5. notifications : plus d'insertion directe par l'app (spam, hameçonnage) ;
--     les triggers SECURITY DEFINER continuent de fonctionner. Nouvelles
--     notifications système : accusé de réception du signalement, décision
--     envoyée au signaleur, motif et voie de contestation envoyés à l'auteur
--     (DSA art. 16 et 17). Le texte `body` reste en français pour les anciens
--     APK ; l'app actuelle traduit à partir de `meta`.
--  6. reports v2 : 10 catégories avec priorité (P0 = pédocriminalité), détails
--     (≤ 1000), instantané de la cible, suivi légal (PHAROS), décision,
--     1 signalement ouvert par personne et par cible, 20 / heure, pas
--     d'auto-signalement, cibles video | user | comment | live | live_comment.
--     Masquage automatique : P0 → masqué dès le 1er signalement (au plus 5
--     masquages P0 par signaleur et par 24 h, garde-fou anti-abus) ; autres
--     catégories → masqué quand 3 signaleurs distincts (comptes de plus de
--     24 h) ont signalé la cible. Les signalements survivent à la suppression
--     du compte du signaleur (reporter_id → NULL, anonymisés).
--  7. Preuves : bucket PRIVÉ report-evidence (20 Mo / fichier, 3 fichiers par
--     signalement, images + vidéos, dans l'heure qui suit), lisible par les
--     modérateurs seulement. Interdites pour la pédocriminalité. Purge 90 jours
--     après la décision, 180 si transmis aux autorités.
--  8. Fichiers des vidéos masquées : le bucket `videos` est public, donc une
--     URL connue reste lisible. File moderation_file_holds + Edge Function
--     moderation-hold : le fichier est déplacé dans le bucket PRIVÉ
--     moderation-hold tant que la vidéo n'est pas visible, remis en place si
--     elle est rétablie, effacé à l'échéance (90 / 180 jours) si elle est retirée.
--  9. Inscription : une adresse @users.nia.app (réservée aux comptes Snapchat)
--     est refusée côté serveur, sauf si le compte est créé par l'Edge Function
--     snapchat-auth (app_metadata.nia_origin = 'snapchat-auth').
--     ⚠ Déployer snapchat-auth (version de cette PR) AVANT d'appliquer 017,
--     sinon les NOUVEAUX comptes Snapchat sont refusés (les existants passent).
--
-- Compatibilité : l'APK actuel (reason = 'Spam' | 'Harcèlement' |
-- 'Contenu illégal' | 'Autre', sans catégorie) continue de fonctionner : la
-- catégorie est déduite de reason. setVideoStatus (published/archived),
-- soft_delete_own_video, attachSoundToVideo, updateProfile : inchangés.
-- Anciens APK : un utilisateur bloqué reçoit une erreur 42501 en commentant /
-- likant / suivant (message d'erreur générique, pas de plantage).

-- ===========================================================================
-- 1. Modérateurs
-- ===========================================================================
create table if not exists public.moderators (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  role text not null default 'moderator',
  created_at timestamptz not null default now(),
  constraint moderators_role_check check (role in ('moderator', 'admin'))
);
alter table public.moderators enable row level security;
revoke all on table public.moderators from public, anon, authenticated;
-- Aucune policy : ajout / retrait uniquement au SQL Editor, par exemple :
--   insert into public.moderators (user_id)
--   select id from auth.users where lower(email) = lower('votre@adresse.fr')
--   on conflict (user_id) do nothing;

create or replace function public.nia_is_moderator()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
     and exists (select 1 from public.moderators m where m.user_id = auth.uid());
$$;

-- Contexte autorisé pour les RPC mod_* : modérateur connecté, service_role, ou
-- connexion directe à la base (SQL Editor : aucun claim JWT, session_user
-- différent d'authenticator, le rôle de connexion de PostgREST).
create or replace function public.nia_mod_context()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.nia_is_moderator()
      or coalesce(auth.role(), '') = 'service_role'
      or (coalesce(auth.role(), '') = '' and session_user <> 'authenticator');
$$;

-- Blocage dans un sens ou dans l'autre entre l'utilisateur courant et p_other.
create or replace function public.nia_block_between(p_other uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and p_other is not null and exists (
    select 1 from public.blocks b
     where (b.blocker_id = auth.uid() and b.blocked_id = p_other)
        or (b.blocker_id = p_other and b.blocked_id = auth.uid())
  );
$$;

revoke all on function public.nia_is_moderator() from public;
revoke all on function public.nia_mod_context() from public, anon;
revoke all on function public.nia_block_between(uuid) from public;
grant execute on function public.nia_is_moderator() to anon, authenticated, service_role;
grant execute on function public.nia_mod_context() to authenticated, service_role;
grant execute on function public.nia_block_between(uuid) to anon, authenticated, service_role;

-- ===========================================================================
-- 2. Colonnes de modération
-- ===========================================================================
alter table public.videos add column if not exists moderation_state text not null default 'visible';
alter table public.videos add column if not exists moderation_reason text;
alter table public.comments add column if not exists moderation_state text not null default 'visible';
alter table public.live_streams add column if not exists moderation_state text not null default 'visible';
alter table public.profiles add column if not exists suspended_at timestamptz;
alter table public.profiles add column if not exists suspended_until timestamptz;
alter table public.notifications add column if not exists meta jsonb;

alter table public.videos drop constraint if exists videos_moderation_state_check;
alter table public.videos add constraint videos_moderation_state_check
  check (moderation_state in ('visible', 'held', 'removed'));
alter table public.comments drop constraint if exists comments_moderation_state_check;
alter table public.comments add constraint comments_moderation_state_check
  check (moderation_state in ('visible', 'held', 'removed'));
alter table public.live_streams drop constraint if exists live_streams_moderation_state_check;
alter table public.live_streams add constraint live_streams_moderation_state_check
  check (moderation_state in ('visible', 'held', 'removed'));

create index if not exists videos_moderation_idx on public.videos (moderation_state)
  where moderation_state <> 'visible';
create index if not exists comments_moderation_idx on public.comments (moderation_state)
  where moderation_state <> 'visible';
create index if not exists comments_user_created_idx on public.comments (user_id, created_at desc);
create index if not exists blocks_pair_idx on public.blocks (blocked_id, blocker_id);

-- ===========================================================================
-- 3. Garde-fous
-- ===========================================================================
-- Règle commune : ne s'appliquent qu'aux requêtes « authenticated » de premier
-- niveau. pg_trigger_depth() > 1 = écriture faite par un autre trigger
-- (compteurs de likes, masquage automatique) : autorisée. service_role et
-- SQL Editor (pas de claims) passent. Les RPC de modération (SECURITY DEFINER,
-- rôle JWT toujours 'authenticated') posent nia.mod_trusted = 'on' le temps
-- de leur écriture (set_config n'est pas exposé par PostgREST).

create or replace function public.nia_videos_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'authenticated' or pg_catalog.pg_trigger_depth() > 1
     or coalesce(pg_catalog.current_setting('nia.mod_trusted', true), '') = 'on' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status = 'rejected' then
      raise exception 'video_status_forbidden' using errcode = '42501';
    end if;
    new.moderation_state := 'visible';
    new.moderation_reason := null;
    new.like_count := 0;
    new.share_count := 0;
    new.save_count := 0;
    return new;
  end if;

  if new.user_id is distinct from old.user_id
     or new.like_count is distinct from old.like_count
     or new.share_count is distinct from old.share_count
     or new.save_count is distinct from old.save_count
     or new.moderation_state is distinct from old.moderation_state
     or new.moderation_reason is distinct from old.moderation_reason
     or new.storage_path is distinct from old.storage_path
     or new.repost_of is distinct from old.repost_of then
    raise exception 'video_server_columns_read_only' using errcode = '42501';
  end if;

  if new.status is distinct from old.status then
    -- Une vidéo refusée par la modération ne peut qu'être supprimée.
    if new.status = 'rejected'
       or (old.status = 'rejected' and new.status <> 'deleted')
       or old.status = 'deleted' then
      raise exception 'video_status_transition_forbidden' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists videos_10_guard on public.videos;
create trigger videos_10_guard
  before insert or update on public.videos
  for each row execute function public.nia_videos_guard();

create or replace function public.nia_comments_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'authenticated' or pg_catalog.pg_trigger_depth() > 1
     or coalesce(pg_catalog.current_setting('nia.mod_trusted', true), '') = 'on' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.user_id is distinct from auth.uid() then
      raise exception 'comment_user_mismatch' using errcode = '42501';
    end if;
    new.created_at := pg_catalog.now();
    new.moderation_state := 'visible';
    -- Le trigger passe AVANT le WITH CHECK de la RLS : si la vidéo n'accepte
    -- pas ce commentaire, laisser la RLS répondre 42501 (pas « limite atteinte »).
    if not public.nia_video_accepts_comments(new.video_id) then
      return new;
    end if;
    if exists (
         select 1 from public.comments c
          where c.user_id = new.user_id
            and c.created_at > pg_catalog.now() - interval '3 seconds')
       or (select count(*) from public.comments c
            where c.user_id = new.user_id
              and c.created_at > pg_catalog.now() - interval '10 minutes') >= 30 then
      raise exception 'comment_rate_limited' using errcode = '54000';
    end if;
    return new;
  end if;

  if new.user_id is distinct from old.user_id
     or new.video_id is distinct from old.video_id
     or new.created_at is distinct from old.created_at
     or new.moderation_state is distinct from old.moderation_state then
    raise exception 'comment_server_columns_read_only' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists comments_10_guard on public.comments;
create trigger comments_10_guard
  before insert or update on public.comments
  for each row execute function public.nia_comments_guard();

create or replace function public.nia_profiles_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'authenticated' or pg_catalog.pg_trigger_depth() > 1
     or coalesce(pg_catalog.current_setting('nia.mod_trusted', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.suspended_at := null;
    new.suspended_until := null;
    return new;
  end if;
  if new.id is distinct from old.id
     or new.suspended_at is distinct from old.suspended_at
     or new.suspended_until is distinct from old.suspended_until
     or new.created_at is distinct from old.created_at then
    raise exception 'profile_server_columns_read_only' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_10_guard on public.profiles;
create trigger profiles_10_guard
  before insert or update on public.profiles
  for each row execute function public.nia_profiles_guard();

-- live_streams : seule la colonne de modération est protégée ici (le reste du
-- cycle de vie d'un live est protégé par la future migration live, 019).
create or replace function public.nia_live_streams_mod_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'authenticated' or pg_catalog.pg_trigger_depth() > 1
     or coalesce(pg_catalog.current_setting('nia.mod_trusted', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.moderation_state := 'visible';
  elsif new.moderation_state is distinct from old.moderation_state then
    raise exception 'live_server_columns_read_only' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists live_streams_05_mod_guard on public.live_streams;
create trigger live_streams_05_mod_guard
  before insert or update on public.live_streams
  for each row execute function public.nia_live_streams_mod_guard();

-- Bloquer = ne plus se suivre, dans les deux sens.
create or replace function public.nia_blocks_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.follows f
   where (f.follower_id = new.blocker_id and f.following_id = new.blocked_id)
      or (f.follower_id = new.blocked_id and f.following_id = new.blocker_id);
  return new;
end;
$$;

drop trigger if exists blocks_after_insert on public.blocks;
create trigger blocks_after_insert
  after insert on public.blocks
  for each row execute function public.nia_blocks_after_insert();

-- ===========================================================================
-- 4. Fonctions d'accès de 016 : prise en compte modération + blocage
-- ===========================================================================
-- (même signature : CREATE OR REPLACE, les policies de 016 qui les appellent
-- en profitent sans être recréées)
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
       and v.moderation_state = 'visible'
       and not public.nia_block_between(v.user_id)
  );
$$;

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
       and (v.moderation_state = 'visible' or v.user_id = auth.uid())
       and not public.nia_block_between(v.user_id)
  );
$$;

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
       and v.moderation_state = 'visible'
       and public.nia_video_row_visible(v.user_id, v.status, v.visibility, v.repost_of)
       and not public.nia_block_between(v.user_id)
  );
$$;

-- Lives : visibilité de 010 (public et non annulé, ou le créateur) + modération
-- + blocage. La migration live (019) remplacera la partie « visibilité » ; elle
-- devra garder « moderation_state = 'visible' » (voir section 5).
create or replace function public.nia_live_row_visible(
  p_owner uuid, p_status text, p_visibility text, p_moderation_state text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (auth.uid() is not null and auth.uid() = p_owner)
      or public.nia_is_moderator()
      or (p_status <> 'cancelled'
          and coalesce(p_visibility, 'public') = 'public'
          and coalesce(p_moderation_state, 'visible') = 'visible'
          and not public.nia_block_between(p_owner));
$$;

-- Un chemin Storage du bucket videos appartient-il à une vidéo masquée ou
-- retirée ? (l'auteur ne peut plus le supprimer ni l'écraser : preuve)
create or replace function public.nia_storage_path_on_hold(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.videos v
     where (v.storage_path = p_name or v.cover_path = p_name)
       and v.moderation_state <> 'visible'
  );
$$;

revoke all on function public.nia_live_row_visible(uuid, text, text, text) from public;
revoke all on function public.nia_storage_path_on_hold(text) from public;
grant execute on function public.nia_live_row_visible(uuid, text, text, text) to anon, authenticated, service_role;
grant execute on function public.nia_storage_path_on_hold(text) to authenticated, service_role;

-- ===========================================================================
-- 5. Policies
-- ===========================================================================
drop policy if exists "videos_select_public" on public.videos;
create policy "videos_select_public"
  on public.videos for select
  using (
    public.nia_is_moderator()
    or (
      public.nia_video_row_visible(user_id, status, visibility, repost_of)
      and (moderation_state = 'visible' or auth.uid() = user_id)
      and not public.nia_block_between(user_id)
    )
  );

-- Suppression définitive : plus possible pour une vidéo masquée ou retirée.
drop policy if exists "videos_delete_own" on public.videos;
create policy "videos_delete_own"
  on public.videos for delete
  to authenticated
  using (auth.uid() = user_id and moderation_state = 'visible');

drop policy if exists "comments_select_public" on public.comments;
create policy "comments_select_public"
  on public.comments for select
  using (
    auth.uid() = user_id
    or public.nia_is_moderator()
    or (
      moderation_state = 'visible'
      and public.nia_can_view_video(video_id)
      and not public.nia_block_between(user_id)
    )
  );
-- comments_insert_own (016) appelle nia_video_accepts_comments : blocage inclus.

drop policy if exists "likes_insert_own" on public.likes;
create policy "likes_insert_own"
  on public.likes for insert
  with check (auth.uid() = user_id and public.nia_can_view_video(video_id));

drop policy if exists "saves_insert_own" on public.saves;
create policy "saves_insert_own"
  on public.saves for insert
  with check (auth.uid() = user_id and public.nia_can_view_video(video_id));

drop policy if exists "follows_insert_own" on public.follows;
create policy "follows_insert_own"
  on public.follows for insert
  with check (auth.uid() = follower_id and not public.nia_block_between(following_id));

-- notifications : plus d'insertion par l'app (les triggers definer suffisent).
drop policy if exists "notifications_insert_system" on public.notifications;

-- live_streams : lecture. Si la migration live (nia_can_view_live) est déjà
-- là, on la garde et on ajoute seulement la modération et le blocage.
do $do$
begin
  execute 'drop policy if exists "live_streams_select_public" on public.live_streams';
  if pg_catalog.to_regprocedure('public.nia_can_view_live(uuid, text, text)') is not null then
    execute $p$
      create policy "live_streams_select_public"
        on public.live_streams for select
        using (
          auth.uid() = user_id
          or public.nia_is_moderator()
          or (public.nia_can_view_live(user_id, status, visibility)
              and moderation_state = 'visible'
              and not public.nia_block_between(user_id))
        )
    $p$;
  else
    execute $p$
      create policy "live_streams_select_public"
        on public.live_streams for select
        using (public.nia_live_row_visible(user_id, status, visibility, moderation_state))
    $p$;
  end if;
end
$do$;

-- Storage (bucket videos) : l'auteur ne supprime ni n'écrase plus le fichier
-- d'une vidéo masquée ou retirée (sinon la preuve disparaîtrait avant d'être
-- mise à l'abri par moderation-hold).
drop policy if exists "videos_storage_update_own" on storage.objects;
create policy "videos_storage_update_own"
  on storage.objects for update
  using (
    bucket_id = 'videos'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
    and not public.nia_storage_path_on_hold(name)
  );
drop policy if exists "videos_storage_delete_own" on storage.objects;
create policy "videos_storage_delete_own"
  on storage.objects for delete
  using (
    bucket_id = 'videos'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
    and not public.nia_storage_path_on_hold(name)
  );

-- ===========================================================================
-- 6. Signalements v2
-- ===========================================================================
alter table public.reports add column if not exists category text;
alter table public.reports add column if not exists details text;
alter table public.reports add column if not exists priority smallint not null default 4;
alter table public.reports add column if not exists target_owner_id uuid;
alter table public.reports add column if not exists target_snapshot jsonb;
alter table public.reports add column if not exists legal_status text not null default 'none';
alter table public.reports add column if not exists legal_ref text;
alter table public.reports add column if not exists resolution text;
alter table public.reports add column if not exists resolution_note text;
alter table public.reports add column if not exists resolved_at timestamptz;
alter table public.reports add column if not exists resolved_by uuid;
alter table public.reports add column if not exists updated_at timestamptz not null default now();
alter table public.reports add column if not exists evidence_count smallint not null default 0;
alter table public.reports add column if not exists auto_hidden boolean not null default false;

-- Le signalement survit à la suppression du compte du signaleur (anonymisé).
alter table public.reports alter column reporter_id drop not null;
alter table public.reports drop constraint if exists reports_reporter_id_fkey;
alter table public.reports add constraint reports_reporter_id_fkey
  foreign key (reporter_id) references public.profiles (id) on delete set null;
alter table public.reports drop constraint if exists reports_resolved_by_fkey;
alter table public.reports add constraint reports_resolved_by_fkey
  foreign key (resolved_by) references public.profiles (id) on delete set null;

-- Motif texte → catégorie. Couvre l'APK actuel ('Spam', 'Harcèlement',
-- 'Contenu illégal', 'Autre') et l'app de cette PR quand 017 n'était pas
-- encore appliquée (libellé français de la catégorie, suivi de « — détails »).
create or replace function public.nia_report_category_from_reason(p_reason text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(coalesce(p_reason, ''), ' — ', 1)))
    when 'spam' then 'spam'
    when 'harcèlement' then 'insultes_harcelement'
    when 'harcelement' then 'insultes_harcelement'
    when 'insultes / harcèlement' then 'insultes_harcelement'
    when 'insultes_harcelement' then 'insultes_harcelement'
    when 'pédocriminalité' then 'pedocriminalite'
    when 'pedocriminalite' then 'pedocriminalite'
    when 'menace / danger immédiat' then 'menace_danger'
    when 'menace_danger' then 'menace_danger'
    when 'négrophobie' then 'negrophobie'
    when 'negrophobie' then 'negrophobie'
    when 'racisme / haine' then 'racisme_haine'
    when 'racisme_haine' then 'racisme_haine'
    when 'propos homophobes' then 'homophobie'
    when 'homophobie' then 'homophobie'
    when 'actes inhumains' then 'actes_inhumains'
    when 'actes_inhumains' then 'actes_inhumains'
    when 'nudité / contenu sexuel' then 'nudite_sexuel'
    when 'nudite_sexuel' then 'nudite_sexuel'
    else 'injustice_autre'
  end;
$$;

-- P0 = traitement immédiat (pédocriminalité) … P4 = file normale.
create or replace function public.nia_report_priority(p_category text)
returns smallint
language sql
immutable
set search_path = ''
as $$
  select (case p_category
    when 'pedocriminalite' then 0
    when 'menace_danger' then 1
    when 'nudite_sexuel' then 2
    when 'actes_inhumains' then 2
    when 'negrophobie' then 3
    when 'racisme_haine' then 3
    when 'homophobie' then 3
    when 'insultes_harcelement' then 3
    else 4
  end)::smallint;
$$;

-- Libellé français (texte de secours des notifications pour les anciens APK).
create or replace function public.nia_report_category_label_fr(p_category text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_category
    when 'pedocriminalite' then 'pédocriminalité'
    when 'menace_danger' then 'menace / danger immédiat'
    when 'negrophobie' then 'négrophobie'
    when 'racisme_haine' then 'racisme / haine'
    when 'homophobie' then 'propos homophobes'
    when 'actes_inhumains' then 'actes inhumains'
    when 'nudite_sexuel' then 'nudité / contenu sexuel'
    when 'insultes_harcelement' then 'insultes / harcèlement'
    when 'spam' then 'spam'
    else 'autre infraction aux règles'
  end;
$$;

update public.reports
   set category = public.nia_report_category_from_reason(reason)
 where category is null;
update public.reports
   set priority = public.nia_report_priority(category)
 where priority is distinct from public.nia_report_priority(category);
update public.reports
   set legal_status = 'to_report'
 where category = 'pedocriminalite' and legal_status = 'none' and status in ('open', 'reviewed');

alter table public.reports alter column category set not null;

alter table public.reports drop constraint if exists reports_category_check;
alter table public.reports add constraint reports_category_check
  check (category in (
    'insultes_harcelement', 'nudite_sexuel', 'actes_inhumains', 'negrophobie',
    'racisme_haine', 'homophobie', 'pedocriminalite', 'menace_danger',
    'spam', 'injustice_autre'
  ));
alter table public.reports drop constraint if exists reports_target_type_check;
alter table public.reports add constraint reports_target_type_check
  check (target_type in ('video', 'user', 'comment', 'live', 'live_comment'));
alter table public.reports drop constraint if exists reports_status_check;
alter table public.reports add constraint reports_status_check
  check (status in ('open', 'in_review', 'actioned', 'dismissed', 'escalated', 'reviewed'));
alter table public.reports drop constraint if exists reports_details_len_check;
alter table public.reports add constraint reports_details_len_check
  check (details is null or char_length(details) <= 1000);
alter table public.reports drop constraint if exists reports_legal_status_check;
alter table public.reports add constraint reports_legal_status_check
  check (legal_status in ('none', 'to_report', 'reported', 'not_required'));
alter table public.reports drop constraint if exists reports_resolution_check;
alter table public.reports add constraint reports_resolution_check
  check (resolution is null or resolution in (
    'content_removed', 'content_restored', 'marked_mature', 'user_warned',
    'user_suspended', 'no_violation', 'duplicate', 'reported_to_authorities'
  ));

-- Doublons ouverts existants (même signaleur, même cible) : on garde le plus
-- ancien, les autres passent en 'dismissed' / 'duplicate' (sinon l'index
-- unique ci-dessous échoue).
update public.reports r
   set status = 'dismissed', resolution = 'duplicate', resolved_at = now()
 where r.status in ('open', 'in_review')
   and exists (
     select 1 from public.reports o
      where o.reporter_id = r.reporter_id and o.target_type = r.target_type
        and o.target_id = r.target_id and o.status in ('open', 'in_review')
        and (o.created_at, o.id) < (r.created_at, r.id));

-- Un signalement ouvert par personne et par cible (l'app traite 23505 comme
-- « déjà signalé, merci »).
create unique index if not exists reports_open_unique_idx
  on public.reports (reporter_id, target_type, target_id)
  where status in ('open', 'in_review');
create index if not exists reports_queue_idx
  on public.reports (priority, created_at)
  where status in ('open', 'in_review', 'escalated');
create index if not exists reports_target_idx on public.reports (target_type, target_id);
create index if not exists reports_reporter_created_idx on public.reports (reporter_id, created_at desc);

-- Notification système (aucun acteur). Texte français en secours, meta pour
-- la traduction dans l'app. Jamais appelable depuis l'API.
create or replace function public.nia_notify(
  p_user uuid, p_type text, p_video uuid, p_body text, p_meta jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user is null or not exists (select 1 from public.profiles p where p.id = p_user) then
    return;
  end if;
  insert into public.notifications (user_id, actor_id, type, video_id, body, meta)
  values (p_user, null, p_type,
          case when p_video is not null and exists (select 1 from public.videos v where v.id = p_video)
               then p_video end,
          pg_catalog.left(coalesce(p_body, ''), 300), p_meta);
end;
$$;
revoke all on function public.nia_notify(uuid, text, uuid, text, jsonb) from public, anon, authenticated;

create or replace function public.nia_reports_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_snap jsonb;
  v_found boolean := false;
  v_authed boolean := coalesce(auth.role(), '') = 'authenticated';
begin
  if new.category is null then
    new.category := public.nia_report_category_from_reason(new.reason);
  end if;
  if new.reason is null or pg_catalog.btrim(new.reason) = '' then
    new.reason := public.nia_report_category_label_fr(new.category);
  end if;
  new.priority := public.nia_report_priority(new.category);
  new.legal_status := case when new.category = 'pedocriminalite' then 'to_report' else 'none' end;
  new.updated_at := pg_catalog.now();
  new.auto_hidden := false;
  new.evidence_count := 0;

  if v_authed then
    if new.reporter_id is distinct from auth.uid() then
      raise exception 'report_user_mismatch' using errcode = '42501';
    end if;
    new.status := 'open';
    new.created_at := pg_catalog.now();
    new.resolution := null; new.resolution_note := null;
    new.resolved_at := null; new.resolved_by := null; new.legal_ref := null;
    if (select count(*) from public.reports r
         where r.reporter_id = auth.uid()
           and r.created_at > pg_catalog.now() - interval '1 hour') >= 20 then
      raise exception 'report_rate_limited' using errcode = '54000';
    end if;
  end if;

  -- Instantané de la cible : preuve même si l'auteur supprime ensuite. Une
  -- cible que le signaleur ne peut pas voir est « introuvable » (pas de fuite).
  if new.target_type = 'video' then
    select v.user_id,
           pg_catalog.jsonb_build_object('caption', v.caption, 'media_type', v.media_type,
             'storage_path', v.storage_path, 'cover_path', v.cover_path, 'status', v.status),
           true
      into v_owner, v_snap, v_found
      from public.videos v where v.id = new.target_id;
    if v_found and v_authed and not public.nia_can_view_video(new.target_id) then
      v_found := false;
    end if;
  elsif new.target_type = 'comment' then
    select c.user_id, pg_catalog.jsonb_build_object('body', c.body, 'video_id', c.video_id), true
      into v_owner, v_snap, v_found
      from public.comments c where c.id = new.target_id;
    if v_found and v_authed
       and not exists (select 1 from public.comments c
                        where c.id = new.target_id and public.nia_can_view_video(c.video_id)) then
      v_found := false;
    end if;
  elsif new.target_type = 'user' then
    select p.id, pg_catalog.jsonb_build_object('username', p.username,
             'display_name', p.display_name, 'bio', p.bio, 'avatar_url', p.avatar_url), true
      into v_owner, v_snap, v_found
      from public.profiles p where p.id = new.target_id;
  elsif new.target_type = 'live' then
    select l.user_id, pg_catalog.jsonb_build_object('title', l.title, 'description', l.description,
             'status', l.status, 'thumbnail_path', l.thumbnail_path), true
      into v_owner, v_snap, v_found
      from public.live_streams l where l.id = new.target_id;
    if v_found and v_authed
       and not exists (select 1 from public.live_streams l
                        where l.id = new.target_id
                          and public.nia_live_row_visible(l.user_id, l.status, l.visibility, l.moderation_state)) then
      v_found := false;
    end if;
  elsif new.target_type = 'live_comment' and pg_catalog.to_regclass('public.live_comments') is not null then
    execute 'select c.user_id, jsonb_build_object(''body'', c.body, ''live_id'', c.live_id), true
               from public.live_comments c where c.id = $1'
       into v_owner, v_snap, v_found using new.target_id;
  end if;

  if not coalesce(v_found, false) then
    raise exception 'report_target_not_found' using errcode = 'P0002';
  end if;
  if v_authed and v_owner = auth.uid() then
    raise exception 'report_self' using errcode = '22023';
  end if;
  new.target_owner_id := v_owner;
  new.target_snapshot := v_snap;
  return new;
end;
$$;

drop trigger if exists reports_before_insert on public.reports;
create trigger reports_before_insert
  before insert on public.reports
  for each row execute function public.nia_reports_before_insert();

-- Change l'état de modération d'une cible. Renvoie true si l'état a changé.
create or replace function public.nia_apply_moderation_state(
  p_target_type text, p_target_id uuid, p_state text, p_reason text default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer := 0;
begin
  if p_state not in ('visible', 'held', 'removed') then
    raise exception 'bad_state' using errcode = '22023';
  end if;
  perform pg_catalog.set_config('nia.mod_trusted', 'on', true);
  if p_target_type = 'video' then
    update public.videos
       set moderation_state = p_state,
           moderation_reason = coalesce(p_reason, moderation_reason)
     where id = p_target_id and moderation_state is distinct from p_state;
    get diagnostics v_n = row_count;
  elsif p_target_type = 'comment' then
    update public.comments set moderation_state = p_state
     where id = p_target_id and moderation_state is distinct from p_state;
    get diagnostics v_n = row_count;
  elsif p_target_type = 'live' then
    update public.live_streams set moderation_state = p_state
     where id = p_target_id and moderation_state is distinct from p_state;
    get diagnostics v_n = row_count;
  elsif p_target_type = 'live_comment' and pg_catalog.to_regclass('public.live_comments') is not null then
    execute 'update public.live_comments set hidden_at = case when $2 = ''visible'' then null else coalesce(hidden_at, now()) end where id = $1'
      using p_target_id, p_state;
    get diagnostics v_n = row_count;
  end if;
  -- 'user' : décision humaine (mod_suspend_user).
  perform pg_catalog.set_config('nia.mod_trusted', '', true);
  return v_n > 0;
end;
$$;
revoke all on function public.nia_apply_moderation_state(text, uuid, text, text) from public, anon, authenticated;

-- Après insertion : accusé de réception + masquage automatique.
create or replace function public.nia_reports_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_distinct int;
  v_p0_recent int;
  v_changed boolean := false;
begin
  -- Accusé de réception (DSA art. 16) : sans rappel du contenu signalé.
  perform public.nia_notify(new.reporter_id, 'report_received', null,
    'NIA a bien reçu votre signalement. Il va être examiné.',
    pg_catalog.jsonb_build_object('code', 'received', 'category', new.category,
      'target_type', new.target_type));

  if new.priority = 0 then
    -- Garde-fou anti-abus : un même compte ne masque pas plus de 5 cibles P0
    -- par 24 h (les signalements suivants restent en tête de file, en P0).
    select count(*) into v_p0_recent
      from public.reports r
     where r.reporter_id = new.reporter_id
       and r.priority = 0
       and r.auto_hidden
       and r.created_at > pg_catalog.now() - interval '24 hours';
    if new.reporter_id is null or v_p0_recent < 5 then
      perform public.nia_apply_moderation_state(new.target_type, new.target_id, 'held', 'auto:p0');
      update public.reports set auto_hidden = true where id = new.id;
    end if;
    -- Pas de notification à l'auteur pour un P0 (ne pas alerter un suspect).
    return new;
  end if;

  select count(distinct r.reporter_id) into v_distinct
    from public.reports r
    join public.profiles p on p.id = r.reporter_id
   where r.target_type = new.target_type
     and r.target_id = new.target_id
     and r.status in ('open', 'in_review')
     and p.created_at < pg_catalog.now() - interval '24 hours';
  if v_distinct >= 3 then
    v_changed := public.nia_apply_moderation_state(new.target_type, new.target_id, 'held', 'auto:3_reports');
    if v_changed then
      update public.reports set auto_hidden = true where id = new.id;
      if new.target_type <> 'user' then
        perform public.nia_notify(new.target_owner_id, 'moderation_notice',
          case when new.target_type = 'video' then new.target_id end,
          'Un de vos contenus est masqué le temps d''une vérification (motif : '
            || public.nia_report_category_label_fr(new.category) || ').',
          pg_catalog.jsonb_build_object('code', 'held', 'category', new.category,
            'target_type', new.target_type));
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists reports_after_insert on public.reports;
create trigger reports_after_insert
  after insert on public.reports
  for each row execute function public.nia_reports_after_insert();

-- RLS : chacun voit ses signalements ; les modérateurs voient tout.
-- Pas de policy UPDATE / DELETE : décisions via mod_resolve_report().
drop policy if exists "reports_select_own" on public.reports;
create policy "reports_select_own"
  on public.reports for select
  using (auth.uid() = reporter_id or public.nia_is_moderator());
-- reports_insert_own (002) : inchangée (auth.uid() = reporter_id).
revoke all on table public.reports from anon;

-- ===========================================================================
-- 7. Preuves jointes (bucket privé)
-- ===========================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'report-evidence', 'report-evidence', false, 20971520, -- 20 Mo
  array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.report_evidence (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports (id) on delete cascade,
  storage_path text not null unique,
  mime_type text not null,
  size_bytes bigint not null,
  created_at timestamptz not null default now(),
  purge_after timestamptz,
  purged_at timestamptz,
  constraint report_evidence_mime_check
    check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime')),
  constraint report_evidence_size_check check (size_bytes between 1 and 20971520)
);
create index if not exists report_evidence_report_idx on public.report_evidence (report_id);
create index if not exists report_evidence_purge_idx on public.report_evidence (purge_after)
  where purged_at is null;
alter table public.report_evidence enable row level security;
revoke all on table public.report_evidence from anon;

-- Le signaleur peut-il encore joindre une preuve à ce signalement ?
-- (son signalement, ouvert, de moins d'1 h, < 3 fichiers, pas P0)
create or replace function public.nia_evidence_upload_ok(p_report_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from public.reports r
     where r.id = p_report_id
       and r.reporter_id = auth.uid()
       and r.status = 'open'
       and r.category <> 'pedocriminalite'
       and r.created_at > pg_catalog.now() - interval '1 hour'
       and (select count(*) from public.report_evidence e where e.report_id = r.id) < 3
  );
$$;
revoke all on function public.nia_evidence_upload_ok(uuid) from public;
grant execute on function public.nia_evidence_upload_ok(uuid) to authenticated, service_role;

drop policy if exists "report_evidence_insert_own" on public.report_evidence;
create policy "report_evidence_insert_own"
  on public.report_evidence for insert
  to authenticated
  with check (
    public.nia_evidence_upload_ok(report_id)
    and storage_path like auth.uid()::text || '/' || report_id::text || '/%'
  );
drop policy if exists "report_evidence_select_mod" on public.report_evidence;
create policy "report_evidence_select_mod"
  on public.report_evidence for select
  using (public.nia_is_moderator());

create or replace function public.nia_report_evidence_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.reports set evidence_count = evidence_count + 1 where id = new.report_id;
  return new;
end;
$$;
drop trigger if exists report_evidence_count on public.report_evidence;
create trigger report_evidence_count
  after insert on public.report_evidence
  for each row execute function public.nia_report_evidence_count();

-- Storage : chemin {reporter_id}/{report_id}/{uuid}.{ext}
drop policy if exists "evidence_storage_insert_own" on storage.objects;
create policy "evidence_storage_insert_own"
  on storage.objects for insert
  with check (
    bucket_id = 'report-evidence'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
    and (storage.foldername(name))[2] ~ '^[0-9a-f-]{36}$'
    and public.nia_evidence_upload_ok(((storage.foldername(name))[2])::uuid)
  );
drop policy if exists "evidence_storage_select_mod" on storage.objects;
create policy "evidence_storage_select_mod"
  on storage.objects for select
  using (bucket_id = 'report-evidence' and public.nia_is_moderator());
-- Aucune policy UPDATE / DELETE : preuve non modifiable par le signaleur.
-- Suppression : Edge Function moderation-hold (service_role, API Storage) à
-- l'échéance purge_after.

-- ===========================================================================
-- 8. Fichiers des vidéos masquées (Edge Function moderation-hold)
-- ===========================================================================
-- Bucket privé : copie des fichiers d'une vidéo masquée ou retirée. Lecture
-- par les modérateurs uniquement ; écriture par service_role (Edge Function).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'moderation-hold', 'moderation-hold', false, 52428800, -- 50 Mo, comme videos
  null  -- tout type accepté par videos (vidéo, image, audio) ; écrit par service_role seul
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "moderation_hold_storage_select_mod" on storage.objects;
create policy "moderation_hold_storage_select_mod"
  on storage.objects for select
  using (bucket_id = 'moderation-hold' and public.nia_is_moderator());

-- Une ligne par vidéo concernée. desired = ce que veut la modération,
-- actual = où sont les fichiers. Le worker rapproche les deux :
--   desired held    + actual public → hold    (copie vers moderation-hold, retrait de videos)
--   desired visible + actual held   → release (remise dans videos, retrait de moderation-hold)
--   actual held + purge_after ≤ now → purge   (effacement définitif de la copie)
-- Pas de clé étrangère vers videos : la ligne doit survivre à la suppression
-- de la vidéo ou du compte (preuve conservée jusqu'à l'échéance).
create table if not exists public.moderation_file_holds (
  video_id uuid primary key,
  owner_id uuid not null,
  paths text[] not null default '{}',
  desired text not null default 'held',
  actual text not null default 'public',
  purge_after timestamptz,
  attempts integer not null default 0,
  max_attempts integer not null default 8,
  last_error text,
  not_before timestamptz not null default now(),
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint moderation_file_holds_desired_check check (desired in ('held', 'visible')),
  constraint moderation_file_holds_actual_check check (actual in ('public', 'held', 'purged', 'missing'))
);
create index if not exists moderation_file_holds_todo_idx
  on public.moderation_file_holds (not_before)
  where actual in ('public', 'held');
alter table public.moderation_file_holds enable row level security;
revoke all on table public.moderation_file_holds from public, anon, authenticated;

create or replace function public.nia_videos_moderation_files()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_paths text[];
begin
  if tg_op = 'DELETE' then
    -- Vidéo effacée (suppression du compte) alors que ses fichiers sont à
    -- l'abri ou en cours de mise à l'abri : on garde la copie jusqu'à
    -- l'échéance, sans jamais la remettre dans un dossier supprimé.
    update public.moderation_file_holds h
       set desired = 'held',
           purge_after = coalesce(h.purge_after, pg_catalog.now()
             + case when exists (select 1 from public.reports r
                                  where r.target_type = 'video' and r.target_id = old.id
                                    and r.legal_status in ('to_report', 'reported'))
                    then interval '180 days' else interval '90 days' end),
           updated_at = pg_catalog.now()
     where h.video_id = old.id and h.actual in ('public', 'held');
    return old;
  end if;

  if new.moderation_state is not distinct from old.moderation_state or new.repost_of is not null then
    return new;  -- une republication partage le fichier de l'original
  end if;

  if new.moderation_state <> 'visible' then
    select coalesce(pg_catalog.array_agg(distinct p), '{}') into v_paths
      from pg_catalog.unnest(array[new.storage_path, new.cover_path]) as p
     where p is not null and p like new.user_id::text || '/%';
    insert into public.moderation_file_holds as h (video_id, owner_id, paths, desired, actual)
    values (new.id, new.user_id, v_paths, 'held', 'public')
    on conflict (video_id) do update
       set desired = 'held',
           paths = case when h.actual = 'public' then excluded.paths else h.paths end,
           attempts = case when h.actual = 'public' then 0 else h.attempts end,
           not_before = pg_catalog.now(),
           updated_at = pg_catalog.now();
  else
    update public.moderation_file_holds h
       set desired = 'visible', purge_after = null, attempts = 0,
           not_before = pg_catalog.now(), updated_at = pg_catalog.now()
     where h.video_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists videos_20_moderation_files on public.videos;
create trigger videos_20_moderation_files
  after update of moderation_state or delete on public.videos
  for each row execute function public.nia_videos_moderation_files();

-- Suppression de compte (014) : la purge de videos/{uid}/ attend que les
-- fichiers en cours de mise à l'abri soient copiés.
create or replace function public.nia_storage_purge_wait_for_holds()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.bucket = 'videos' and exists (
       select 1 from public.moderation_file_holds h
        where h.owner_id = new.user_id and h.desired = 'held' and h.actual = 'public') then
    new.not_before := greatest(new.not_before, pg_catalog.now() + interval '30 minutes');
  end if;
  return new;
end;
$$;

do $do$
begin
  if pg_catalog.to_regclass('public.storage_purge_jobs') is not null then
    execute 'drop trigger if exists storage_purge_jobs_wait_for_holds on public.storage_purge_jobs';
    execute 'create trigger storage_purge_jobs_wait_for_holds
               before insert on public.storage_purge_jobs
               for each row execute function public.nia_storage_purge_wait_for_holds()';
  end if;
end
$do$;

-- Worker : réclame des lignes à traiter (FOR UPDATE SKIP LOCKED, verrou repris
-- après p_stale_minutes).
create or replace function public.moderation_files_claim(
  p_batch integer default 5, p_stale_minutes integer default 15)
returns table (video_id uuid, owner_id uuid, paths text[], action text, attempts integer)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with picked as (
    select h.video_id,
           case
             when h.desired = 'held' and h.actual = 'public' then 'hold'
             when h.desired = 'visible' and h.actual = 'held' then 'release'
             else 'purge'
           end as action
      from public.moderation_file_holds h
     where h.not_before <= pg_catalog.now()
       and h.attempts < h.max_attempts
       and (h.locked_at is null
            or h.locked_at < pg_catalog.now() - pg_catalog.make_interval(mins => greatest(p_stale_minutes, 1)))
       and (   (h.desired = 'held' and h.actual = 'public')
            or (h.desired = 'visible' and h.actual = 'held')
            or (h.actual = 'held' and h.purge_after is not null and h.purge_after <= pg_catalog.now()))
     order by h.not_before
     limit greatest(1, least(coalesce(p_batch, 5), 20))
     for update skip locked
  )
  update public.moderation_file_holds h
     set locked_at = pg_catalog.now(), attempts = h.attempts + 1, updated_at = pg_catalog.now()
    from picked
   where h.video_id = picked.video_id
  returning h.video_id, h.owner_id, h.paths, picked.action, h.attempts;
end;
$$;

-- Worker : l'action a réussi. p_result = held | public | purged | missing.
create or replace function public.moderation_files_complete(p_video_id uuid, p_result text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  if p_result not in ('held', 'public', 'purged', 'missing') then
    raise exception 'bad_result' using errcode = '22023';
  end if;
  update public.moderation_file_holds h
     set actual = p_result, locked_at = null, attempts = 0, last_error = null,
         not_before = pg_catalog.now(), updated_at = pg_catalog.now()
   where h.video_id = p_video_id and h.locked_at is not null;
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;

-- Worker : échec, retenté avec un délai de 2^tentatives minutes (≤ 6 h).
create or replace function public.moderation_files_fail(p_video_id uuid, p_code text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  update public.moderation_file_holds h
     set locked_at = null,
         last_error = pg_catalog.left(coalesce(p_code, 'unknown'), 80),
         not_before = pg_catalog.now()
           + pg_catalog.make_interval(mins => least(360, (2 ^ least(h.attempts, 9))::integer)),
         updated_at = pg_catalog.now()
   where h.video_id = p_video_id;
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;

-- Worker : preuves à supprimer via l'API Storage, puis marquées purgées.
create or replace function public.evidence_due_for_purge(p_limit integer default 50)
returns table (id uuid, storage_path text)
language sql
security definer
set search_path = ''
as $$
  select e.id, e.storage_path from public.report_evidence e
   where e.purged_at is null and e.purge_after is not null and e.purge_after <= pg_catalog.now()
   order by e.purge_after
   limit greatest(1, least(p_limit, 200));
$$;

create or replace function public.evidence_mark_purged(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  update public.report_evidence e
     set purged_at = pg_catalog.now()
   where e.id = any (coalesce(p_ids, '{}')) and e.purged_at is null
     and e.purge_after is not null and e.purge_after <= pg_catalog.now();
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.moderation_files_claim(integer, integer) from public, anon, authenticated;
revoke all on function public.moderation_files_complete(uuid, text) from public, anon, authenticated;
revoke all on function public.moderation_files_fail(uuid, text) from public, anon, authenticated;
revoke all on function public.evidence_due_for_purge(integer) from public, anon, authenticated;
revoke all on function public.evidence_mark_purged(uuid[]) from public, anon, authenticated;
grant execute on function public.moderation_files_claim(integer, integer) to service_role;
grant execute on function public.moderation_files_complete(uuid, text) to service_role;
grant execute on function public.moderation_files_fail(uuid, text) to service_role;
grant execute on function public.evidence_due_for_purge(integer) to service_role;
grant execute on function public.evidence_mark_purged(uuid[]) to service_role;
revoke all on function public.nia_videos_moderation_files() from public, anon, authenticated;
revoke all on function public.nia_storage_purge_wait_for_holds() from public, anon, authenticated;

-- ===========================================================================
-- 9. RPC modérateurs (app d'un modérateur connecté, ou SQL Editor)
-- ===========================================================================
create or replace function public.mod_resolve_report(
  p_report_id uuid,
  p_resolution text,
  p_note text default null,
  p_legal_ref text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.reports%rowtype;
  v_state text;
  v_status text;
  v_legal boolean;
  v_ref text := nullif(pg_catalog.btrim(coalesce(p_legal_ref, '')), '');
  v_changed boolean := false;
  x record;
begin
  if not public.nia_mod_context() then
    raise exception 'not_moderator' using errcode = '42501';
  end if;
  select * into r from public.reports where id = p_report_id for update;
  if not found then
    raise exception 'report_not_found' using errcode = 'P0002';
  end if;
  if p_resolution is null or p_resolution not in (
       'content_removed', 'content_restored', 'marked_mature', 'user_warned',
       'user_suspended', 'no_violation', 'duplicate', 'reported_to_authorities') then
    raise exception 'bad_resolution' using errcode = '22023';
  end if;
  if r.category = 'pedocriminalite' and p_resolution not in ('no_violation', 'duplicate')
     and coalesce(v_ref, r.legal_ref) is null then
    -- P0 confirmé : la décision exige la référence du signalement PHAROS.
    raise exception 'legal_ref_required' using errcode = '22023';
  end if;

  v_legal := v_ref is not null or r.legal_status = 'reported';
  v_status := case when p_resolution in ('no_violation', 'duplicate') then 'dismissed' else 'actioned' end;
  v_state := case p_resolution
    when 'content_removed' then 'removed'
    when 'reported_to_authorities' then 'removed'
    when 'content_restored' then 'visible'
    when 'no_violation' then 'visible'
    else null end;
  if v_state is not null then
    v_changed := public.nia_apply_moderation_state(r.target_type, r.target_id, v_state,
      'report:' || r.category);
  end if;
  if v_state = 'removed' and r.target_type = 'video' then
    update public.moderation_file_holds h
       set purge_after = pg_catalog.now()
         + case when v_legal then interval '180 days' else interval '90 days' end,
           updated_at = pg_catalog.now()
     where h.video_id = r.target_id;
  end if;

  -- Décision envoyée à chaque signaleur (DSA art. 16.5), une fois par personne.
  for x in
    select distinct rr.reporter_id
      from public.reports rr
     where rr.target_type = r.target_type and rr.target_id = r.target_id
       and rr.status in ('open', 'in_review', 'escalated') and rr.reporter_id is not null
  loop
    perform public.nia_notify(x.reporter_id, 'report_decision', null,
      case when v_status = 'actioned'
           then 'Votre signalement a été traité : des mesures ont été prises. Merci.'
           else 'Votre signalement a été examiné : aucune infraction à nos règles n''a été constatée.' end,
      pg_catalog.jsonb_build_object('code', v_status, 'resolution', p_resolution,
        'category', r.category, 'target_type', r.target_type));
  end loop;

  -- Toutes les demandes ouvertes sur la même cible sont closes ensemble.
  update public.reports x2
     set status = v_status,
         resolution = p_resolution,
         resolution_note = pg_catalog.left(p_note, 1000),
         legal_ref = coalesce(v_ref, x2.legal_ref),
         legal_status = case when v_ref is not null then 'reported' else x2.legal_status end,
         resolved_at = pg_catalog.now(),
         resolved_by = case when public.nia_is_moderator() then auth.uid() end,
         updated_at = pg_catalog.now()
   where x2.target_type = r.target_type and x2.target_id = r.target_id
     and x2.status in ('open', 'in_review', 'escalated');

  update public.report_evidence e
     set purge_after = pg_catalog.now()
       + case when v_legal then interval '180 days' else interval '90 days' end
   where e.purged_at is null
     and e.report_id in (select x3.id from public.reports x3
                          where x3.target_type = r.target_type and x3.target_id = r.target_id);

  -- Motif et voie de contestation envoyés à la personne visée (DSA art. 17).
  -- « Pas de violation » sur un contenu masqué par 3 signalements : l'auteur,
  -- prévenu du masquage, est prévenu du rétablissement (jamais pour un P0).
  if p_resolution = 'no_violation' and v_changed and r.category <> 'pedocriminalite' then
    p_resolution := 'content_restored';
  end if;
  if p_resolution in ('content_removed', 'reported_to_authorities', 'content_restored',
                      'user_warned', 'user_suspended')
     and r.target_owner_id is not null then
    perform public.nia_notify(r.target_owner_id, 'moderation_notice',
      case when r.target_type = 'video' and p_resolution = 'content_restored' then r.target_id end,
      case
        when p_resolution = 'content_restored'
          then 'Votre contenu est de nouveau visible après vérification.'
        when p_resolution = 'user_warned'
          then 'Avertissement : un de vos contenus enfreint nos règles (motif : '
               || public.nia_report_category_label_fr(r.category) || '). Contestation : niaapp@outlook.com.'
        when p_resolution = 'user_suspended'
          then 'Votre compte est suspendu pour non-respect des règles (motif : '
               || public.nia_report_category_label_fr(r.category) || '). Contestation : niaapp@outlook.com.'
        else 'Un de vos contenus a été retiré pour non-respect des règles (motif : '
               || public.nia_report_category_label_fr(r.category) || '). Contestation : niaapp@outlook.com.'
      end,
      pg_catalog.jsonb_build_object(
        'code', case p_resolution
                  when 'content_restored' then 'restored'
                  when 'user_warned' then 'warned'
                  when 'user_suspended' then 'suspended'
                  else 'removed' end,
        'resolution', p_resolution, 'category', r.category, 'target_type', r.target_type));
  end if;
end;
$$;

create or replace function public.mod_set_moderation_state(
  p_target_type text, p_target_id uuid, p_state text, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.nia_mod_context() then
    raise exception 'not_moderator' using errcode = '42501';
  end if;
  if p_state not in ('visible', 'held', 'removed') then
    raise exception 'bad_state' using errcode = '22023';
  end if;
  perform public.nia_apply_moderation_state(p_target_type, p_target_id, p_state, p_reason);
end;
$$;

-- Suspension : profil marqué + connexion refusée par Supabase Auth
-- (auth.users.banned_until ; le JWT en cours reste valable jusqu'à expiration,
-- 1 h par défaut). p_days = 0 : levée de la suspension.
create or replace function public.mod_suspend_user(p_user_id uuid, p_days integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.nia_mod_context() then
    raise exception 'not_moderator' using errcode = '42501';
  end if;
  if p_days is null or p_days < 0 or p_days > 36500 then
    raise exception 'bad_duration' using errcode = '22023';
  end if;
  perform pg_catalog.set_config('nia.mod_trusted', 'on', true);
  if p_days = 0 then
    update public.profiles set suspended_at = null, suspended_until = null where id = p_user_id;
    update auth.users set banned_until = null where id = p_user_id;
  else
    update public.profiles
       set suspended_at = pg_catalog.now(),
           suspended_until = pg_catalog.now() + pg_catalog.make_interval(days => p_days)
     where id = p_user_id;
    update auth.users set banned_until = pg_catalog.now() + pg_catalog.make_interval(days => p_days)
     where id = p_user_id;
  end if;
  perform pg_catalog.set_config('nia.mod_trusted', '', true);
end;
$$;

revoke all on function public.mod_resolve_report(uuid, text, text, text) from public, anon;
revoke all on function public.mod_set_moderation_state(text, uuid, text, text) from public, anon;
revoke all on function public.mod_suspend_user(uuid, integer) from public, anon;
grant execute on function public.mod_resolve_report(uuid, text, text, text) to authenticated, service_role;
grant execute on function public.mod_set_moderation_state(text, uuid, text, text) to authenticated, service_role;
grant execute on function public.mod_suspend_user(uuid, integer) to authenticated, service_role;

-- File de modération lisible dans le Dashboard (SQL Editor = postgres).
create or replace view public.moderation_queue
with (security_invoker = true) as
  select r.id, r.priority, r.category, r.target_type, r.target_id, r.target_owner_id,
         p.username as target_owner_username,
         r.status, r.legal_status, r.legal_ref, r.auto_hidden, r.evidence_count, r.details,
         r.target_snapshot, r.created_at,
         count(*) over (partition by r.target_type, r.target_id) as reports_on_target
    from public.reports r
    left join public.profiles p on p.id = r.target_owner_id
   where r.status in ('open', 'in_review', 'escalated')
   order by r.priority, r.created_at;
revoke all on public.moderation_queue from anon;

-- ===========================================================================
-- 10. Inscription : domaine @users.nia.app réservé à snapchat-auth
-- ===========================================================================
-- Trigger de contrainte DIFFÉRÉ (vérifié au COMMIT) : l'API admin de Supabase
-- Auth insère l'utilisateur puis écrit app_metadata dans la même transaction
-- (supabase/auth, internal/api/admin.go, adminUserCreate). Une inscription
-- publique (/signup) ne peut pas écrire app_metadata.
create or replace function public.nia_auth_reserved_email_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_origin text;
begin
  if tg_op = 'UPDATE' and new.email is not distinct from old.email then
    return null;
  end if;
  select u.email, u.raw_app_meta_data ->> 'nia_origin'
    into v_email, v_origin
    from auth.users u where u.id = new.id;
  if not found then
    return null;  -- supprimé dans la même transaction
  end if;
  if pg_catalog.lower(coalesce(v_email, '')) like '%@users.nia.app'
     and coalesce(v_origin, '') <> 'snapchat-auth' then
    raise exception 'reserved_email_domain' using errcode = '42501';
  end if;
  return null;
end;
$$;
revoke all on function public.nia_auth_reserved_email_check() from public, anon, authenticated;

drop trigger if exists nia_reserved_email_domain on auth.users;
create constraint trigger nia_reserved_email_domain
  after insert or update of email on auth.users
  deferrable initially deferred
  for each row execute function public.nia_auth_reserved_email_check();

-- ===========================================================================
-- 11. Rattrapage des signalements existants (idempotent)
-- ===========================================================================
-- Signalements ouverts d'avant 017 : P0 → cible masquée ; 3 signaleurs
-- distincts (comptes de plus de 24 h) → cible masquée. Sans notification.
do $do$
declare
  t record;
begin
  for t in
    select distinct r.target_type, r.target_id
      from public.reports r
     where r.status in ('open', 'in_review') and r.priority = 0
       and r.target_type in ('video', 'comment', 'live')
  loop
    perform public.nia_apply_moderation_state(t.target_type, t.target_id, 'held', 'auto:p0');
  end loop;
  for t in
    select r.target_type, r.target_id
      from public.reports r
      join public.profiles p on p.id = r.reporter_id
     where r.status in ('open', 'in_review')
       and r.target_type in ('video', 'comment', 'live')
       and p.created_at < pg_catalog.now() - interval '24 hours'
     group by r.target_type, r.target_id
    having count(distinct r.reporter_id) >= 3
  loop
    perform public.nia_apply_moderation_state(t.target_type, t.target_id, 'held', 'auto:3_reports');
  end loop;
end
$do$;

-- ===========================================================================
-- ROLLBACK (à la main, dans l'ordre) — résumé
-- ===========================================================================
-- ⚠ D'abord remettre en place les fichiers mis à l'abri :
--   update public.moderation_file_holds set desired = 'visible', not_before = now()
--    where actual = 'held';  puis laisser tourner moderation-hold jusqu'au bout.
-- drop trigger if exists nia_reserved_email_domain on auth.users;
-- drop view if exists public.moderation_queue;
-- drop function if exists public.mod_suspend_user(uuid, integer),
--   public.mod_set_moderation_state(text, uuid, text, text), public.mod_resolve_report(uuid, text, text, text);
-- drop trigger if exists storage_purge_jobs_wait_for_holds on public.storage_purge_jobs;
-- drop trigger if exists videos_20_moderation_files on public.videos;
-- drop policy if exists "moderation_hold_storage_select_mod" on storage.objects;
-- drop policy if exists "evidence_storage_select_mod" on storage.objects;
-- drop policy if exists "evidence_storage_insert_own" on storage.objects;
-- drop table if exists public.report_evidence;  -- ⚠️ vider le bucket report-evidence via l'API avant
-- drop trigger if exists reports_after_insert on public.reports;
-- drop trigger if exists reports_before_insert on public.reports;
-- (policies : recréer videos_select_public / comments_select_public / likes / saves / follows
--  telles qu'en 002/016, live_streams_select_public telle qu'en 010, videos_delete_own telle
--  qu'en 006, videos_storage_update_own / _delete_own telles qu'en 001 ; fonctions nia_* de
--  016 : réexécuter la section 2 de 016)
-- create policy "notifications_insert_system" on public.notifications for insert
--   with check (auth.uid() = user_id or auth.uid() = actor_id);
-- drop trigger if exists videos_10_guard on public.videos;
-- drop trigger if exists comments_10_guard on public.comments;
-- drop trigger if exists profiles_10_guard on public.profiles;
-- drop trigger if exists blocks_after_insert on public.blocks;
-- drop trigger if exists live_streams_05_mod_guard on public.live_streams;
-- Colonnes ajoutées : peuvent rester (valeurs par défaut sans effet pour l'ancienne app).
