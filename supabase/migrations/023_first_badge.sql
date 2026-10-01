-- NIA — 023 : badge « First » pour les 100 premiers comptes.
--
-- À exécuter APRÈS 020 et 022 (SQL Editor Supabase). 021 reste réservée
-- (enregistrements de lives) et n'est pas nécessaire.
-- Idempotente : rejouable deux fois sans effet (vérifié sur un Postgres local
-- jetable, voir supabase/tests/023_first_badge.test.sql). Le rattrapage
-- (section 4) ne s'exécute qu'au tout premier passage.
--
-- Choix : une colonne de rang, profiles.first_rank smallint NULL (1..100,
-- unique), plutôt qu'un booléen is_first. Le badge se déduit du rang
-- (first_rank is not null) et l'app pourra afficher « First #12 » plus tard
-- sans nouvelle migration. NULL = pas de badge.
--
-- Contenu :
--   1. profiles.first_rank (lisible par tous, comme le reste du profil),
--      contraintes 1..100 et unicité.
--   2. nia_first_badge_counter : compteur privé à une seule ligne (rangs déjà
--      attribués). Un rang n'est JAMAIS réattribué : la suppression d'un
--      compte classé ne libère pas sa place (« First #12 » = 12e inscription
--      retenue, pour toujours).
--   3. Trigger profiles_90_first_rank (BEFORE INSERT OR UPDATE) :
--      - INSERT (profil créé par handle_new_user à l'inscription, ou insertion
--        directe autorisée par profiles_insert_own) : toute valeur fournie est
--        ignorée ; si le compte est éligible et que moins de 100 rangs ont été
--        attribués, le rang suivant est pris. Concurrence : UPDATE … RETURNING
--        sur la ligne unique du compteur, qui sérialise les inscriptions
--        simultanées (verrou de ligne jusqu'au COMMIT ; une inscription annulée
--        rend son rang). Contrainte d'unicité en filet de sécurité.
--      - UPDATE : first_rank est en lecture seule pour anon et authenticated,
--        y compris au travers des RPC SECURITY DEFINER de modération (le rôle
--        JWT reste « authenticated »). Seuls service_role et le SQL Editor
--        (aucun claim JWT) peuvent le corriger.
--      Pourquoi un trigger et pas un REVOKE de colonne : Supabase accorde
--      UPDATE sur toute la table à anon / authenticated ; un REVOKE UPDATE
--      (first_rank) n'aurait aucun effet tant que ce droit de table existe
--      (même principe que nia_profiles_guard en 017).
--   4. Rattrapage (premier passage seulement) : comptes existants classés dans
--      l'ordre d'inscription (auth.users.created_at), en EXCLUANT les comptes
--      techniques : domaines réservés aux tests (RFC 2606 / 6761 :
--      example.com/.net/.org, *.example, *.test, *.invalid, *.localhost),
--      comptes anonymes, et comptes modérateurs (public.moderators).
--      Les nouvelles inscriptions excluent les mêmes domaines et les comptes
--      anonymes (un modérateur est nommé après son inscription).
--
-- Aucune autre donnée modifiée : seule la colonne first_rank des comptes
-- retenus est remplie. Rollback : en bas du fichier (commenté).

-- ===========================================================================
-- 1. Colonne
-- ===========================================================================
alter table public.profiles add column if not exists first_rank smallint;

alter table public.profiles drop constraint if exists profiles_first_rank_check;
alter table public.profiles add constraint profiles_first_rank_check
  check (first_rank is null or first_rank between 1 and 100);

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.profiles'::regclass
                    and conname = 'profiles_first_rank_key') then
    alter table public.profiles add constraint profiles_first_rank_key unique (first_rank);
  end if;
end $$;

comment on column public.profiles.first_rank is
  'Badge First : rang d''inscription (1..100) des 100 premiers comptes, NULL sinon. Attribué par le serveur (023), lecture seule pour l''app.';

-- ===========================================================================
-- 2. Compteur privé (une seule ligne)
-- ===========================================================================
create table if not exists public.nia_first_badge_counter (
  singleton boolean primary key default true check (singleton),
  issued smallint not null default 0 check (issued between 0 and 100),
  updated_at timestamptz not null default now()
);

alter table public.nia_first_badge_counter enable row level security;
-- Aucune policy : ni anon ni authenticated n'y accèdent (et aucun droit).
revoke all on table public.nia_first_badge_counter from public, anon, authenticated;

-- ===========================================================================
-- 3. Éligibilité et attribution
-- ===========================================================================
-- Compte technique : adresse d'un domaine réservé aux tests ou compte anonyme.
-- to_jsonb(u) : lit is_anonymous sans dépendre de la présence de la colonne.
create or replace function public.nia_first_badge_eligible(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from auth.users u
     where u.id = p_user
       and coalesce((pg_catalog.to_jsonb(u) ->> 'is_anonymous')::boolean, false) = false
       and coalesce(pg_catalog.lower(pg_catalog.split_part(u.email, '@', 2)), '')
           !~ '(^|\.)(example\.(com|net|org)|example|test|invalid|localhost)$'
  );
$$;

revoke all on function public.nia_first_badge_eligible(uuid) from public, anon, authenticated;

create or replace function public.nia_profiles_first_rank()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rank smallint;
begin
  if tg_op = 'INSERT' then
    new.first_rank := null;
    if public.nia_first_badge_eligible(new.id) then
      update public.nia_first_badge_counter
         set issued = issued + 1, updated_at = pg_catalog.now()
       where singleton and issued < 100
      returning issued into v_rank;
      new.first_rank := v_rank;   -- NULL quand les 100 places sont prises
    end if;
    return new;
  end if;

  if new.first_rank is distinct from old.first_rank
     and coalesce(auth.role(), '') in ('anon', 'authenticated') then
    raise exception 'profile_first_rank_read_only' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.nia_profiles_first_rank() from public, anon, authenticated;

drop trigger if exists profiles_90_first_rank on public.profiles;
create trigger profiles_90_first_rank
  before insert or update on public.profiles
  for each row execute function public.nia_profiles_first_rank();

-- ===========================================================================
-- 4. Rattrapage des comptes existants (premier passage uniquement)
-- ===========================================================================
do $$
declare
  v_n integer;
begin
  if exists (select 1 from public.nia_first_badge_counter) then
    raise notice '023 : compteur déjà présent, rattrapage ignoré';
    return;
  end if;

  -- Verrou de table : aucune inscription ne se glisse pendant le rattrapage.
  lock table public.profiles in share row exclusive mode;

  with ranked as (
    select p.id,
           row_number() over (order by u.created_at, p.created_at, p.id) as rn
      from public.profiles p
      join auth.users u on u.id = p.id
     where p.first_rank is null
       and public.nia_first_badge_eligible(p.id)
       and not exists (select 1 from public.moderators m where m.user_id = p.id)
  )
  update public.profiles p
     set first_rank = r.rn
    from ranked r
   where p.id = r.id and r.rn <= 100;
  get diagnostics v_n = row_count;

  insert into public.nia_first_badge_counter (singleton, issued) values (true, v_n);
  raise notice '023 : % compte(s) existant(s) reçoivent le badge First', v_n;
end $$;

-- ===========================================================================
-- Rollback (à exécuter à la main si besoin) :
-- drop trigger if exists profiles_90_first_rank on public.profiles;
-- drop function if exists public.nia_profiles_first_rank();
-- drop function if exists public.nia_first_badge_eligible(uuid);
-- drop table if exists public.nia_first_badge_counter;
-- alter table public.profiles drop column if exists first_rank;
