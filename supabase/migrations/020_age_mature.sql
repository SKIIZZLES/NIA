-- NIA — 020 : âge déclaré et contenus 18+ (« thèmes matures licites »).
--
-- À exécuter APRÈS 017, 018 et 019 (SQL Editor Supabase), 022 indifférente.
-- Idempotente : rejouable deux fois sans effet (vérifié sur un Postgres local
-- jetable, voir supabase/tests/020_age_mature.test.sql). Aucune donnée
-- existante modifiée : les nouvelles colonnes valent false pour toutes les
-- lignes existantes, aucune ligne n'est mise à jour ni supprimée.
--
-- ⚠️ 18+ ≠ contenu sexuel. La nudité et le contenu sexuel restent INTERDITS
-- (CGU, règles de la communauté, catégorie de signalement nudite_sexuel).
-- Le marquage 18+ sert aux thèmes difficiles mais licites : rites et
-- scarifications, circoncision, abattage rituel, violence de guerre ou
-- documentaire, langage cru.
--
-- Contenu :
--   1. user_birthdates : date de naissance déclarée, table PRIVÉE (profiles est
--      lisible par tous : la date n'y va pas). Chacun ne lit que sa ligne ;
--      aucune écriture directe par l'app. Saisie une seule fois par
--      l'utilisateur (RPC set_my_birth_date) ; correction par le support
--      (mod_set_birth_date). + show_mature : choix explicite « Afficher les
--      contenus 18+ » (désactivé par défaut, réservé aux majeurs).
--   2. Âge minimum d'inscription : nia_min_signup_age() = 13 (CGU, section 2).
--   3. videos.is_mature / mature_locked ; live_streams.is_mature / mature_locked.
--      Marquer 18+ est réservé aux comptes majeurs ; un marquage imposé par un
--      modérateur (mature_locked) ne peut pas être retiré par le créateur.
--   4. Lecture : un contenu 18+ n'est visible que par son créateur, un
--      modérateur, ou un utilisateur connecté, majeur (âge déclaré ≥ 18) ET
--      qui a activé show_mature. Visiteurs non connectés, mineurs, comptes sans
--      date de naissance et majeurs sans activation : jamais (vidéo, commentaires,
--      j'aime, enregistrements, republication, live — et donc jeton live-token,
--      qui lit la ligne avec le JWT de l'appelant).
--   5. Pas de republication d'un contenu 18+ ; les reposts existants d'une vidéo
--      qui devient 18+ disparaissent avec elle (règle de 016 sur repost_of).
--   6. RPC : set_my_birth_date, set_my_mature_opt_in, get_my_age_status
--      (authenticated) ; mod_set_mature, mod_set_birth_date (modérateurs,
--      service_role, SQL Editor).
--
-- Politiques remplacées (mêmes noms, mêmes règles qu'en 016/017/019 + 18+) :
-- videos_select_public, live_streams_select_public. Fonctions remplacées (même
-- signature) : nia_video_reusable, nia_can_view_video, nia_video_accepts_comments.
-- Rollback : en bas du fichier (commenté).

-- ===========================================================================
-- 1. Date de naissance (privée) et choix « Afficher les contenus 18+ »
-- ===========================================================================
create table if not exists public.user_birthdates (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  birth_date date not null,
  source text not null default 'self_declared',
  show_mature boolean not null default false,
  show_mature_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_birthdates drop constraint if exists user_birthdates_source_check;
alter table public.user_birthdates add constraint user_birthdates_source_check
  check (source in ('self_declared', 'corrected_by_support', 'verified'));
alter table public.user_birthdates drop constraint if exists user_birthdates_birth_date_check;
alter table public.user_birthdates add constraint user_birthdates_birth_date_check
  check (birth_date >= date '1900-01-01');

comment on table public.user_birthdates is
  'Date de naissance déclarée (privée : jamais dans profiles). Écriture par RPC uniquement (020).';

alter table public.user_birthdates enable row level security;
revoke all on table public.user_birthdates from public, anon, authenticated;
grant select on table public.user_birthdates to authenticated;
grant all on table public.user_birthdates to service_role;

drop policy if exists "user_birthdates_select_own" on public.user_birthdates;
create policy "user_birthdates_select_own"
  on public.user_birthdates for select
  to authenticated
  using (auth.uid() = user_id);

-- Âge minimum pour créer un compte (CGU section 2). Changer ici ET dans
-- lib/age.ts (MIN_SIGNUP_AGE).
create or replace function public.nia_min_signup_age()
returns integer
language sql
immutable
set search_path = ''
as $$ select 13 $$;

-- Âge révolu à la date du jour (comme lib/age.ts : un 29 février devient
-- majeur le 1er mars les années non bissextiles).
create or replace function public.nia_is_at_least(p_birth_date date, p_years integer)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_birth_date is not null
     and p_birth_date <= (current_date - pg_catalog.make_interval(years => p_years))::date;
$$;

create or replace function public.nia_viewer_is_adult()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from public.user_birthdates b
     where b.user_id = auth.uid()
       and public.nia_is_at_least(b.birth_date, 18)
  );
$$;

-- Majeur ET a choisi d'afficher les contenus 18+.
create or replace function public.nia_viewer_sees_mature()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from public.user_birthdates b
     where b.user_id = auth.uid()
       and b.show_mature
       and public.nia_is_at_least(b.birth_date, 18)
  );
$$;

-- Une ligne (vidéo, live) marquée p_is_mature est-elle lisible ?
create or replace function public.nia_mature_ok(p_is_mature boolean, p_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not coalesce(p_is_mature, false)
      or (auth.uid() is not null and auth.uid() = p_owner)
      or public.nia_viewer_sees_mature()
      or public.nia_is_moderator();
$$;

revoke all on function public.nia_min_signup_age() from public;
revoke all on function public.nia_is_at_least(date, integer) from public;
revoke all on function public.nia_viewer_is_adult() from public;
revoke all on function public.nia_viewer_sees_mature() from public;
revoke all on function public.nia_mature_ok(boolean, uuid) from public;
grant execute on function public.nia_min_signup_age() to anon, authenticated, service_role;
grant execute on function public.nia_is_at_least(date, integer) to anon, authenticated, service_role;
grant execute on function public.nia_viewer_is_adult() to anon, authenticated, service_role;
grant execute on function public.nia_viewer_sees_mature() to anon, authenticated, service_role;
grant execute on function public.nia_mature_ok(boolean, uuid) to anon, authenticated, service_role;

-- Saisie unique par l'utilisateur. Renvoie true si l'utilisateur est majeur.
-- Erreurs : not_authenticated (42501), birth_date_invalid (22023),
-- too_young (22023, rien n'est enregistré), birth_date_already_set (23505).
create or replace function public.set_my_birth_date(p_birth_date date)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if p_birth_date is null or p_birth_date < date '1900-01-01' or p_birth_date > current_date then
    raise exception 'birth_date_invalid' using errcode = '22023';
  end if;
  if not public.nia_is_at_least(p_birth_date, public.nia_min_signup_age()) then
    raise exception 'too_young' using errcode = '22023';
  end if;
  insert into public.user_birthdates (user_id, birth_date)
  values (v_uid, p_birth_date)
  on conflict (user_id) do nothing;
  if not found then
    raise exception 'birth_date_already_set' using errcode = '23505';
  end if;
  return public.nia_is_at_least(p_birth_date, 18);
end;
$$;

-- « Afficher les contenus 18+ » (réglages). Activer exige d'être majeur ;
-- désactiver est toujours possible. Renvoie l'état enregistré.
create or replace function public.set_my_mature_opt_in(p_on boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_birth date;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select b.birth_date into v_birth from public.user_birthdates b where b.user_id = v_uid for update;
  if not found then
    if coalesce(p_on, false) then
      raise exception 'birth_date_missing' using errcode = '22023';
    end if;
    return false;
  end if;
  if coalesce(p_on, false) and not public.nia_is_at_least(v_birth, 18) then
    raise exception 'not_adult' using errcode = '42501';
  end if;
  update public.user_birthdates
     set show_mature = coalesce(p_on, false),
         show_mature_at = pg_catalog.now(),
         updated_at = pg_catalog.now()
   where user_id = v_uid;
  return coalesce(p_on, false);
end;
$$;

-- État pour l'app, sans renvoyer la date elle-même.
create or replace function public.get_my_age_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'declared', b.user_id is not null,
    'adult', coalesce(public.nia_is_at_least(b.birth_date, 18), false),
    'show_mature', coalesce(b.show_mature and public.nia_is_at_least(b.birth_date, 18), false),
    'min_age', public.nia_min_signup_age())
    from (select auth.uid() as uid) me
    left join public.user_birthdates b on b.user_id = me.uid
   where me.uid is not null;
$$;

revoke all on function public.set_my_birth_date(date) from public, anon;
revoke all on function public.set_my_mature_opt_in(boolean) from public, anon;
revoke all on function public.get_my_age_status() from public, anon;
grant execute on function public.set_my_birth_date(date) to authenticated;
grant execute on function public.set_my_mature_opt_in(boolean) to authenticated;
grant execute on function public.get_my_age_status() to authenticated;

-- ===========================================================================
-- 2. Colonnes 18+
-- ===========================================================================
-- ADD COLUMN … DEFAULT false : pas de réécriture de table (PG ≥ 11), les
-- lignes existantes valent false.
alter table public.videos add column if not exists is_mature boolean not null default false;
alter table public.videos add column if not exists mature_locked boolean not null default false;
alter table public.live_streams add column if not exists is_mature boolean not null default false;
alter table public.live_streams add column if not exists mature_locked boolean not null default false;

comment on column public.videos.is_mature is
  '18+ (thèmes matures licites, jamais de nudité) : visible du créateur, des modérateurs et des majeurs qui l''ont activé (020).';
comment on column public.videos.mature_locked is
  '18+ imposé par un modérateur (mod_set_mature) : non retirable par le créateur.';
comment on column public.live_streams.is_mature is
  '18+ (thèmes matures licites) : visible du créateur, des modérateurs et des majeurs qui l''ont activé (020).';
comment on column public.live_streams.mature_locked is
  '18+ imposé par un modérateur (mod_set_mature) : non retirable par le créateur.';

create index if not exists videos_mature_idx on public.videos (user_id) where is_mature;

-- Garde commune (videos, live_streams). Même règle que 017 : seules les
-- requêtes « authenticated » de premier niveau sont contrôlées ; service_role,
-- SQL Editor, triggers imbriqués et RPC de modération (nia.mod_trusted) passent.
create or replace function public.nia_mature_guard()
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
    new.mature_locked := false;
    if new.is_mature and not public.nia_viewer_is_adult() then
      raise exception 'mature_requires_adult' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.mature_locked is distinct from old.mature_locked
     or (old.mature_locked and not new.is_mature) then
    raise exception 'mature_locked' using errcode = '42501';
  end if;
  if new.is_mature and not old.is_mature and not public.nia_viewer_is_adult() then
    raise exception 'mature_requires_adult' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.nia_mature_guard() from public, anon, authenticated;

-- 15 : après la garde 10 (017 / 019), avant 20 (fichiers) et 30 (filtre 018).
drop trigger if exists videos_15_mature_guard on public.videos;
create trigger videos_15_mature_guard
  before insert or update on public.videos
  for each row execute function public.nia_mature_guard();

drop trigger if exists live_streams_15_mature_guard on public.live_streams;
create trigger live_streams_15_mature_guard
  before insert or update on public.live_streams
  for each row execute function public.nia_mature_guard();

-- ===========================================================================
-- 3. Lecture des vidéos : 016 + 017 + 18+
-- ===========================================================================
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
       and not v.is_mature  -- 020 : pas de republication d'un contenu 18+
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
       and public.nia_mature_ok(v.is_mature, v.user_id)
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
       and public.nia_mature_ok(v.is_mature, v.user_id)
  );
$$;

-- comments_select_public, likes_insert_own, saves_insert_own (017) et
-- comments_insert_own, reposts_insert_own, videos_insert_own (016) appellent
-- ces fonctions : le 18+ s'y applique sans les recréer.
drop policy if exists "videos_select_public" on public.videos;
create policy "videos_select_public"
  on public.videos for select
  using (
    public.nia_is_moderator()
    or (
      public.nia_video_row_visible(user_id, status, visibility, repost_of)
      and (moderation_state = 'visible' or auth.uid() = user_id)
      and not public.nia_block_between(user_id)
      and public.nia_mature_ok(is_mature, user_id)
    )
  );

-- ===========================================================================
-- 4. Lecture des lives : 017 / 019 (nia_live_row_visible) + 18+
-- ===========================================================================
-- nia_live_row_visible garde sa définition (019 : public / abonnés, masquage,
-- blocage ; le créateur et les modérateurs voient tout). live-token lit la
-- ligne avec le JWT de l'appelant : un mineur n'obtient pas de jeton (404).
drop policy if exists "live_streams_select_public" on public.live_streams;
create policy "live_streams_select_public"
  on public.live_streams for select
  using (
    public.nia_live_row_visible(user_id, status, visibility, moderation_state)
    and public.nia_mature_ok(is_mature, user_id)
  );

-- ===========================================================================
-- 5. RPC modérateur / support
-- ===========================================================================
-- Imposer (p_mature = true, verrouillé) ou retirer le 18+ d'une vidéo ou d'un live.
create or replace function public.mod_set_mature(p_target_type text, p_target_id uuid, p_mature boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.nia_mod_context() then
    raise exception 'not_moderator' using errcode = '42501';
  end if;
  if p_mature is null then
    raise exception 'bad_value' using errcode = '22023';
  end if;
  perform pg_catalog.set_config('nia.mod_trusted', 'on', true);
  if p_target_type = 'video' then
    update public.videos set is_mature = p_mature, mature_locked = p_mature where id = p_target_id;
  elsif p_target_type = 'live' then
    update public.live_streams set is_mature = p_mature, mature_locked = p_mature where id = p_target_id;
  else
    perform pg_catalog.set_config('nia.mod_trusted', '', true);
    raise exception 'bad_target' using errcode = '22023';
  end if;
  perform pg_catalog.set_config('nia.mod_trusted', '', true);
end;
$$;

-- Correction de la date par le support (demande de l'utilisateur, erreur de
-- saisie, compte d'un mineur). p_birth_date null : date effacée, l'app la
-- redemande. Aucun âge minimum ici : le support doit pouvoir enregistrer la
-- date réelle d'un compte à supprimer.
create or replace function public.mod_set_birth_date(p_user_id uuid, p_birth_date date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.nia_mod_context() then
    raise exception 'not_moderator' using errcode = '42501';
  end if;
  if p_birth_date is null then
    delete from public.user_birthdates where user_id = p_user_id;
    return;
  end if;
  if p_birth_date < date '1900-01-01' or p_birth_date > current_date then
    raise exception 'birth_date_invalid' using errcode = '22023';
  end if;
  insert into public.user_birthdates (user_id, birth_date, source)
  values (p_user_id, p_birth_date, 'corrected_by_support')
  on conflict (user_id) do update
    set birth_date = excluded.birth_date,
        source = 'corrected_by_support',
        -- Devenu mineur : le choix 18+ est remis à zéro.
        show_mature = public.user_birthdates.show_mature
                      and public.nia_is_at_least(excluded.birth_date, 18),
        updated_at = pg_catalog.now();
end;
$$;

revoke all on function public.mod_set_mature(text, uuid, boolean) from public, anon;
revoke all on function public.mod_set_birth_date(uuid, date) from public, anon;
grant execute on function public.mod_set_mature(text, uuid, boolean) to authenticated, service_role;
grant execute on function public.mod_set_birth_date(uuid, date) to authenticated, service_role;

-- ===========================================================================
-- Rollback (à exécuter à la main si besoin, dans cet ordre)
-- ===========================================================================
-- 1. Policies et fonctions d'avant 020 :
--    videos_select_public, nia_video_reusable, nia_can_view_video,
--    nia_video_accepts_comments : réexécuter les sections 4 et 5 de 017 (versions
--    sans « is_mature ») ; live_streams_select_public :
--      drop policy if exists "live_streams_select_public" on public.live_streams;
--      create policy "live_streams_select_public" on public.live_streams for select
--        using (public.nia_live_row_visible(user_id, status, visibility, moderation_state));
-- 2. drop trigger if exists videos_15_mature_guard on public.videos;
--    drop trigger if exists live_streams_15_mature_guard on public.live_streams;
--    drop function if exists public.nia_mature_guard();
-- 3. drop function if exists public.mod_set_mature(text, uuid, boolean),
--      public.mod_set_birth_date(uuid, date), public.get_my_age_status(),
--      public.set_my_mature_opt_in(boolean), public.set_my_birth_date(date),
--      public.nia_mature_ok(boolean, uuid), public.nia_viewer_sees_mature(),
--      public.nia_viewer_is_adult();
--    (garder nia_is_at_least / nia_min_signup_age tant que la table existe)
-- 4. ⚠ drop table public.user_birthdates : efface les dates déclarées.
-- Colonnes is_mature / mature_locked : peuvent rester (valeurs par défaut sans
-- effet ; l'app d'avant 020 ne les lit pas).
