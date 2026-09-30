-- NIA — 018 : filtre de mots (sprint Sécurité S3)
-- À exécuter APRÈS 017 dans Supabase Dashboard → SQL Editor, en une fois.
-- Aucune Edge Function à déployer, aucun secret : Postgres pur.
-- Idempotent : peut être rejoué sans effet de bord (IF NOT EXISTS, DROP … IF
-- EXISTS puis CREATE, CREATE OR REPLACE, ON CONFLICT DO NOTHING). Vérification
-- ensuite : supabase/tests/018_verify_after_apply.sql (chaque ligne ok = true).
--
-- Ce que ça change :
--  1. moderation_terms : liste des termes. Lecture et écriture réservées aux
--     modérateurs (017) et à service_role ; l'app ne peut jamais la lire.
--     Chaque terme est normalisé à l'écriture (trigger).
--  2. keyword_flags : trace de chaque contenu retenu (texte d'origine),
--     lisible par les modérateurs seulement.
--  3. Normalisation avant comparaison : minuscules, accents (NFKD), ligatures
--     (œ, æ, ß), lettres africaines (ɛ, ɔ, ŋ, ɓ, ɗ, ƙ, ƴ), homoglyphes
--     cyrilliques, caractères invisibles, leetspeak (0→o 1→i 3→e 4→a 5→s 7→t
--     @→a $→s €→e), lettres répétées (3 fois ou plus = 1 ou 2), séparateurs
--     dans un mot (« c o n n a r d », « p.d », « con-nard »), pluriels en -s.
--     Comparaison par MOT ENTIER ou par expression (jamais une sous-chaîne,
--     sauf quelques termes marqués « substring », sans ambiguïté) : « conseil »,
--     « Niger », « députée », « computer » ne déclenchent rien.
--  4. Deux actions, décidées par le fondateur :
--       mask → insultes : le mot est remplacé par « c****** » dans le texte
--              enregistré ; le contenu est publié.
--       hold → racisme, négrophobie, homophobie, sexuel (+ pédocriminalité et
--              menaces) : le contenu est enregistré mais reste invisible pour
--              les autres jusqu'à la décision d'un modérateur ; il apparaît
--              dans moderation_queue (source = 'keyword_filter').
--  5. Où (triggers, côté serveur : un ancien APK ne peut pas contourner) :
--       comments.body                    → mask / hold (moderation_state 017)
--       videos.caption, hashtags, alt_text, location_text
--                                        → mask / hold (moderation_state 017,
--                                          moderation_reason 'auto:keywords')
--       live_streams.title, description  → mask / hold (moderation_state 017)
--       profiles.username                → tout terme = refus (text_refused) ;
--                                          à l'inscription (handle_new_user),
--                                          pseudo remplacé par createur_xxxxxxxx
--       profiles.display_name, bio       → mask / hold : la nouvelle valeur
--                                          reste EN ATTENTE (l'ancienne reste
--                                          affichée) jusqu'à la décision
--       live_comments.body (chat live, n'existe pas encore : 019/L3 appelle
--         nia_kw_attach_live_chat())     → mask / hold (hidden_at)
--     Seules les écritures de l'app (rôle authenticated) sont filtrées ; le
--     SQL Editor, service_role et les RPC de modération passent.
--  6. Notifications NIA (017, nia_notify) à l'auteur : contenu retenu
--     (code held_keywords ; aucune pour la pédocriminalité), validé (approved)
--     ou retiré (removed).
--  7. RPC : nia_check_text(texte, champ) → ok | masked | held | refused, pour
--     l'avertissement avant envoi (ne révèle ni les termes ni les catégories) ;
--     mod_resolve_keyword_flag(id, 'approve' | 'reject', note) pour les
--     modérateurs (même contexte que les mod_* de 017).
--  8. Récidive : vue moderation_keyword_offenders (3 contenus retenus ou plus
--     en 7 jours) et mention dans moderation_queue. Pas de sanction
--     automatique (voir la PR).
--  9. Liste de départ (section 9) : FR / EN, courte, par catégorie. Les termes
--     ambigus sont présents mais désactivés (enabled = false) pour relecture.
--
-- Compatibilité : l'APK actuel continue de fonctionner. Un commentaire ou une
-- légende retenus sont enregistrés normalement et restent visibles par leur
-- auteur (la bannière « masqué » de 017 s'affiche) ; un texte masqué revient
-- déjà masqué. Seule nouveauté visible pour un ancien APK : une modification de
-- nom affiché / bio retenue ne s'applique pas tout de suite (notification NIA),
-- et un pseudo refusé renvoie une erreur générique.

-- ===========================================================================
-- 1. Tables
-- ===========================================================================
create table if not exists public.moderation_terms (
  id bigint generated always as identity primary key,
  term text not null,
  lang text not null default '*',
  category text not null,
  action text not null,
  match_mode text not null default 'word',
  enabled boolean not null default true,
  note text,
  -- Calculés par le trigger moderation_terms_normalize (ne pas écrire à la main)
  word_count integer not null default 1,
  phrase_key text not null default '',
  phrase_runs integer[] not null default '{}',
  compact_key text not null default '',
  compact_runs integer[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint moderation_terms_category_check check (category in (
    'insultes_harcelement', 'nudite_sexuel', 'negrophobie', 'racisme_haine',
    'homophobie', 'pedocriminalite', 'menace_danger')),
  constraint moderation_terms_action_check check (action in ('mask', 'hold')),
  constraint moderation_terms_match_check check (match_mode in ('word', 'substring')),
  constraint moderation_terms_term_check check (term ~ '^[a-z]+( [a-z]+){0,5}$'
    and char_length(pg_catalog.replace(term, ' ', '')) between 2 and 60),
  constraint moderation_terms_lang_check check (lang ~ '^(\*|[a-z]{2,3})$')
);
create unique index if not exists moderation_terms_term_uidx on public.moderation_terms (term);
create index if not exists moderation_terms_compact_idx on public.moderation_terms (compact_key) where enabled;
create index if not exists moderation_terms_phrase_idx on public.moderation_terms (phrase_key) where enabled;
alter table public.moderation_terms enable row level security;
revoke all on table public.moderation_terms from public, anon, authenticated;
-- Gestion depuis une future app modérateur : droits de table, mais RLS
-- réservée aux modérateurs (un utilisateur ordinaire ne voit aucune ligne).
grant select, insert, update, delete on table public.moderation_terms to authenticated;
drop policy if exists "moderation_terms_mod_all" on public.moderation_terms;
create policy "moderation_terms_mod_all" on public.moderation_terms
  for all to authenticated
  using (public.nia_is_moderator())
  with check (public.nia_is_moderator());

-- Une ligne par contenu retenu (ou pseudo remplacé à l'inscription, journal).
-- Pas de clé étrangère (comme reports.target_owner_id, moderation_file_holds) :
-- la trace survit à la suppression du contenu ou du compte.
create table if not exists public.keyword_flags (
  id uuid primary key default gen_random_uuid(),
  target_type text not null,
  target_id uuid not null,
  field text not null,
  author_id uuid,
  action text not null default 'hold',
  category text not null,
  categories text[] not null,
  priority smallint not null,
  original jsonb not null,
  pending_text text,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid,
  review_note text,
  constraint keyword_flags_target_type_check
    check (target_type in ('video', 'comment', 'live', 'live_comment', 'user')),
  constraint keyword_flags_action_check check (action in ('hold', 'refuse')),
  constraint keyword_flags_status_check
    check (status in ('open', 'approved', 'rejected', 'superseded', 'logged'))
);
create index if not exists keyword_flags_queue_idx on public.keyword_flags (priority, created_at)
  where status = 'open';
create index if not exists keyword_flags_target_idx on public.keyword_flags (target_type, target_id);
create index if not exists keyword_flags_author_idx on public.keyword_flags (author_id, created_at desc);
alter table public.keyword_flags enable row level security;
revoke all on table public.keyword_flags from public, anon, authenticated;
grant select on table public.keyword_flags to authenticated;
drop policy if exists "keyword_flags_select_mod" on public.keyword_flags;
create policy "keyword_flags_select_mod" on public.keyword_flags
  for select to authenticated
  using (public.nia_is_moderator());
-- Aucune policy d'écriture : triggers SECURITY DEFINER et mod_resolve_keyword_flag.

-- ===========================================================================
-- 2. Normalisation
-- ===========================================================================
-- Un caractère (ou une chaîne) replié : minuscules, sans accents, ligatures
-- développées, lettres africaines et homoglyphes cyrilliques ramenés au latin,
-- caractères invisibles supprimés (renvoie '' pour eux).
create or replace function public.nia_kw_fold(p text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select pg_catalog.translate(
    pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(
      pg_catalog.regexp_replace(
        pg_catalog.lower(pg_catalog.normalize(p, 'NFKD')),
        '[\u0300-\u036f\u200b-\u200f\u00ad\u034f\u2060\ufeff]', '', 'g'),
      'ß', 'ss'), 'œ', 'oe'), 'æ', 'ae'),
    'ɛɔŋɓɗƙƴłøđıаеорсухіјѕᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘʀꜱᴛᴜᴠᴡʏᴢ',
    'eonbdkylodiaeopcyxijsabcdefghijklmnoprstuvwyz');
$$;

-- Leetspeak, seulement dans un mot qui contient au moins une lettre (« 2024 »
-- et « 93 » restent des nombres).
create or replace function public.nia_kw_leet(p text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select case when p ~ '[a-z]' then pg_catalog.translate(p, '013457@$€', 'oieastase') else p end;
$$;

-- Clé de comparaison : une lettre par série de lettres identiques, et la
-- longueur de chaque série (« connnard » → conard + {1,1,3,1,1,1}).
create or replace function public.nia_kw_key(p text, out key text, out runs integer[])
language sql
immutable
strict
set search_path = ''
as $$
  select coalesce(pg_catalog.string_agg(m.a[2], '' order by m.o), ''),
         coalesce(pg_catalog.array_agg(pg_catalog.char_length(m.a[1]) order by m.o), '{}')
    from pg_catalog.regexp_matches(p, '((.)\2*)', 'g') with ordinality as m(a, o);
$$;

-- Séries compatibles : même longueur, ou répétition insistante (3 fois ou
-- plus) qui vaut pour 1 ou 2. « fuuuuck » = fuck, « niggggger » = nigger,
-- mais « niger » (le pays) ≠ nigger et « fuuck » ≠ fuck.
create or replace function public.nia_kw_runs_ok(p_text_runs integer[], p_term_runs integer[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(pg_catalog.array_length(p_text_runs, 1), 0) = coalesce(pg_catalog.array_length(p_term_runs, 1), 0)
     and coalesce((select pg_catalog.bool_and(p_text_runs[i] = p_term_runs[i]
                                              or (p_text_runs[i] >= 3 and p_text_runs[i] >= p_term_runs[i]))
                     from pg_catalog.generate_subscripts(p_text_runs, 1) as i), true);
$$;

-- Pluriel : « connards » → connard, « bitches » → bitch (mot de 4 lettres ou plus).
create or replace function public.nia_kw_singular(p text, p_es boolean default false)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select case
    when p_es and pg_catalog.char_length(p) >= 5 and p like '%es' then pg_catalog.left(p, -2)
    when not p_es and pg_catalog.char_length(p) >= 4 and p like '%s' then pg_catalog.left(p, -1)
    else p end;
$$;

-- Forme canonique d'un terme saisi par un modérateur : « Enculé » → encule,
-- « Sale-Noir » → sale noir, « k1ll » → kill.
create or replace function public.nia_kw_normalize_term(p text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select pg_catalog.btrim(pg_catalog.regexp_replace(
    pg_catalog.regexp_replace(public.nia_kw_leet(public.nia_kw_fold(p)), '[^a-z]+', ' ', 'g'), ' +', ' ', 'g'));
$$;

create or replace function public.nia_kw_terms_normalize()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  k record;
begin
  new.term := public.nia_kw_normalize_term(new.term);
  if new.term = '' then
    raise exception 'term_empty' using errcode = '22023';
  end if;
  if new.action is null then
    new.action := case when new.category = 'insultes_harcelement' then 'mask' else 'hold' end;
  end if;
  new.word_count := pg_catalog.array_length(pg_catalog.string_to_array(new.term, ' '), 1);
  select * into k from public.nia_kw_key(new.term);
  new.phrase_key := k.key; new.phrase_runs := k.runs;
  select * into k from public.nia_kw_key(pg_catalog.replace(new.term, ' ', ''));
  new.compact_key := k.key; new.compact_runs := k.runs;
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;
drop trigger if exists moderation_terms_normalize on public.moderation_terms;
create trigger moderation_terms_normalize
  before insert or update on public.moderation_terms
  for each row execute function public.nia_kw_terms_normalize();

-- ===========================================================================
-- 3. Analyse d'un texte
-- ===========================================================================
-- action : none | mask | hold (la plus sévère l'emporte) ; category : la plus
-- prioritaire (nia_report_priority de 017) ; masked : le texte d'origine avec
-- les insultes masquées (même si l'action finale est hold).
create or replace function public.nia_kw_analyze(p_text text)
returns table (action text, category text, categories text[], masked text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_maxw integer;
begin
  if p_text is null or pg_catalog.btrim(p_text) = '' then
    return query select 'none'::text, null::text, '{}'::text[], p_text;
    return;
  end if;
  -- Garde-fou : un texte démesuré n'est pas analysé (coût), il est retenu.
  if pg_catalog.char_length(p_text) > 8000 then
    return query select 'hold'::text, 'spam'::text, array['spam']::text[], p_text;
    return;
  end if;
  select coalesce(max(t.word_count), 1) into v_maxw from public.moderation_terms t where t.enabled;

  -- NB : les étapes par caractère / par mot sont écrites en ligne (fonctions
  -- natives) plutôt qu'en appelant les petites fonctions nia_kw_* : une
  -- fonction avec SET search_path n'est jamais « inlinée » et coûte un
  -- changement de configuration à chaque appel.
  return query
  with ch as (
    -- k : w = lettre / chiffre / @ $ €, s = espace, p = ponctuation, x = invisible
    select x.i, x.c, x.f,
           case when x.f = '' then 'x'
                when x.f ~ '^[a-z0-9@$€]+$' then 'w'
                when x.f ~ '^[[:space:]]+$' then 's'
                else 'p' end as k
      from (select t.c, t.i::integer as i,
                   case when pg_catalog.ascii(t.c) < 128 then pg_catalog.lower(t.c)
                        else public.nia_kw_fold(t.c) end as f
              from pg_catalog.regexp_split_to_table(p_text, '') with ordinality as t(c, i)) x
  ),
  ch2 as (
    select ch.*,
           sum(case when ch.k in ('s', 'p') then 1 else 0 end) over (order by ch.i) as g,
           sum(case when ch.k = 's' then 1 else 0 end) over (order by ch.i) as sp
      from ch where ch.k <> 'x'
  ),
  tok0 as (
    select pg_catalog.string_agg(ch2.f, '' order by ch2.i) as raw,
           min(ch2.i) as s, max(ch2.i) as e, max(ch2.sp) as sp
      from ch2 where ch2.k = 'w'
     group by ch2.g
  ),
  tok1 as (
    select tok0.*,
           (row_number() over (order by tok0.s))::integer as n,
           coalesce(tok0.sp > lag(tok0.sp) over (order by tok0.s), true) as space_before,
           -- forme « expression » : sans @ de mention, leetspeak si le mot a une lettre
           case when pg_catalog.ltrim(tok0.raw, '@') ~ '[a-z]'
                then pg_catalog.translate(pg_catalog.ltrim(tok0.raw, '@'), '013457@$€', 'oieastase')
                else pg_catalog.ltrim(tok0.raw, '@') end as pv
      from tok0
  ),
  tok2 as (
    select tok1.*,
           sum(case when tok1.space_before then 1 else 0 end) over (order by tok1.n) as chunk,
           case when pg_catalog.char_length(tok1.pv) >= 4 and tok1.pv like '%s'
                then pg_catalog.left(tok1.pv, -1) else tok1.pv end as sg
      from tok1
  ),
  base0 as (
    -- a. le mot tel quel
    select t.raw as r, t.s, t.e from tok2 t
    union all
    -- b. sans « @ » de mention ni chiffres collés au début / à la fin (connard93)
    select pg_catalog.regexp_replace(t.raw, '^[@0-9]+|[0-9]+$', '', 'g'), t.s, t.e
      from tok2 t where t.raw ~ '^[@0-9]|[0-9]$'
    union all
    -- c. lettres isolées recollées : « c o n n a r d », « p.d »
    select pg_catalog.string_agg(z.raw, '' order by z.n), min(z.s), max(z.e)
      from (select t.*, t.n - row_number() over (order by t.n) as isl
              from tok2 t where pg_catalog.char_length(t.raw) = 1) z
     group by z.isl having count(*) >= 2
    union all
    -- d. morceaux collés par une ponctuation : « con-nard », « sale_noir »
    select pg_catalog.string_agg(t.raw, '' order by t.n), min(t.s), max(t.e)
      from tok2 t group by t.chunk having count(*) >= 2
  ),
  base as (
    select case when b.r ~ '[a-z]' then pg_catalog.translate(b.r, '013457@$€', 'oieastase') else b.r end as v,
           b.s, b.e
      from base0 b where b.r <> ''
  ),
  fw as (
    -- premiers mots des expressions (pour ne générer que les fenêtres utiles)
    select distinct pg_catalog.split_part(mt.phrase_key, ' ', 1) as k
      from public.moderation_terms mt where mt.enabled and mt.word_count > 1
  ),
  cand as (
    select 'w'::text as kind, v.v, b.s, b.e, 1 as nw
      from base b
      cross join lateral (values
        (b.v),
        (case when pg_catalog.char_length(b.v) >= 4 and b.v like '%s' then pg_catalog.left(b.v, -1) end),
        (case when pg_catalog.char_length(b.v) >= 5 and b.v like '%es' then pg_catalog.left(b.v, -2) end)) as v(v)
     where v.v is not null
    union
    -- e. expressions de 2 à v_maxw mots (+ pluriels : tous les mots, ou le dernier)
    select 'p', v.v, w.s, w.e, w.nw
      from (select a.ss[gn.n] as s, a.es[gn.n + gs.w - 1] as e, gs.w as nw,
                   pg_catalog.array_to_string(a.pvs[gn.n:gn.n + gs.w - 1], ' ') as v1,
                   pg_catalog.array_to_string(a.sgs[gn.n:gn.n + gs.w - 1], ' ') as v2,
                   pg_catalog.array_to_string(a.pvs[gn.n:gn.n + gs.w - 2] || a.sgs[gn.n + gs.w - 1], ' ') as v3
              from (select pg_catalog.array_agg(t.pv order by t.n) as pvs,
                           pg_catalog.array_agg(t.sg order by t.n) as sgs,
                           pg_catalog.array_agg(t.s order by t.n) as ss,
                           pg_catalog.array_agg(t.e order by t.n) as es,
                           count(*)::integer as cnt
                      from tok2 t) a
              cross join lateral pg_catalog.generate_series(1, a.cnt) as gn(n)
              cross join lateral pg_catalog.generate_series(2, v_maxw) as gs(w)
             where gn.n + gs.w - 1 <= a.cnt
               and (pg_catalog.regexp_replace(a.pvs[gn.n], '(.)\1+', '\1', 'g') in (select fw.k from fw)
                    or pg_catalog.regexp_replace(a.sgs[gn.n], '(.)\1+', '\1', 'g') in (select fw.k from fw))) w
      cross join lateral (values (w.v1), (w.v2), (w.v3)) as v(v)
  ),
  ck as (
    select c.kind, c.v, c.s, c.e, c.nw, pg_catalog.regexp_replace(c.v, '(.)\1+', '\1', 'g') as dk
      from cand c
  ),
  hit0 as (
    select ck.v, ck.s, ck.e, mt.category, mt.action, mt.compact_runs as tr, true as check_runs
      from ck join public.moderation_terms mt
        on mt.enabled and ck.kind = 'w' and mt.compact_key = ck.dk
    union all
    select ck.v, ck.s, ck.e, mt.category, mt.action, null, false
      from ck join public.moderation_terms mt
        on mt.enabled and ck.kind = 'w' and mt.match_mode = 'substring'
       and pg_catalog.strpos(ck.dk, mt.compact_key) > 0
    union all
    select ck.v, ck.s, ck.e, mt.category, mt.action, mt.phrase_runs, true
      from ck join public.moderation_terms mt
        on mt.enabled and ck.kind = 'p' and mt.word_count = ck.nw and mt.phrase_key = ck.dk
  ),
  hit as (
    -- séries de lettres : seulement pour les candidats retenus (peu nombreux)
    select distinct h.s, h.e, h.category, h.action
      from hit0 h
     where not h.check_runs
        or public.nia_kw_runs_ok((select k.runs from public.nia_kw_key(h.v) k), h.tr)
  ),
  cats as (
    -- Catégorie principale : d'abord celles qui retiennent le contenu.
    select h.category as c, public.nia_report_priority(h.category) as pr,
           pg_catalog.bool_or(h.action = 'hold') as held
      from hit h group by h.category
  )
  select
    case when exists (select 1 from hit where hit.action = 'hold') then 'hold'
         when exists (select 1 from hit) then 'mask'
         else 'none' end,
    (select cats.c from cats order by cats.held desc, cats.pr, cats.c limit 1),
    coalesce((select pg_catalog.array_agg(cats.c order by cats.held desc, cats.pr, cats.c) from cats), '{}'::text[]),
    case when not exists (select 1 from hit where hit.action = 'mask') then p_text
         else (select pg_catalog.string_agg(
                        case when ch.k = 'w' and exists (select 1 from hit h
                                                           where h.action = 'mask' and ch.i > h.s and ch.i <= h.e)
                             then '*' else ch.c end, '' order by ch.i)
                 from ch) end;
end;
$$;

-- ===========================================================================
-- 4. Vérification avant envoi (app) : verdict seul, jamais les termes
-- ===========================================================================
-- p_field : comment | caption | bio | display_name | username | live_title | …
-- Renvoie ok | masked (des mots seront masqués) | held (vérification avant
-- publication) | refused (pseudo refusé).
create or replace function public.nia_check_text(p_text text, p_field text default 'comment')
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r record;
begin
  if p_text is null or pg_catalog.btrim(p_text) = '' then
    return 'ok';
  end if;
  select * into r from public.nia_kw_analyze(pg_catalog.left(p_text, 5000));
  if r.action = 'none' then
    return 'ok';
  end if;
  if p_field = 'username' then
    return 'refused';
  end if;
  return case r.action when 'hold' then 'held' else 'masked' end;
end;
$$;

-- ===========================================================================
-- 5. Traces et notifications
-- ===========================================================================
-- Écriture filtrée = requête de l'app (authenticated) de premier niveau, hors
-- RPC de modération (nia.mod_trusted, 017).
create or replace function public.nia_kw_app_write()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(auth.role(), '') = 'authenticated'
     and pg_catalog.pg_trigger_depth() <= 1
     and coalesce(pg_catalog.current_setting('nia.mod_trusted', true), '') <> 'on';
$$;

-- Analyse plusieurs champs d'une ligne (to_jsonb(new)) ; seuls les champs
-- nouveaux ou modifiés sont examinés. Les tableaux (hashtags) sont examinés
-- élément par élément. patch = valeurs masquées à réécrire dans la ligne.
create or replace function public.nia_kw_scan_fields(p_new jsonb, p_old jsonb, p_fields text[],
  out patch jsonb, out hold boolean, out category text, out categories text[],
  out original jsonb, out fields text[])
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  f text;
  v jsonb;
  el text;
  r record;
  v_arr jsonb;
  v_changed boolean;
  v_hold_field boolean;
  v_best integer := 1000;
begin
  patch := '{}'; hold := false; category := null; categories := '{}'; original := '{}'; fields := '{}';
  foreach f in array p_fields loop
    v := p_new -> f;
    if v is null or pg_catalog.jsonb_typeof(v) = 'null' then continue; end if;
    if p_old is not null and (p_old -> f) is not distinct from v then continue; end if;
    v_hold_field := false;
    if pg_catalog.jsonb_typeof(v) = 'array' then
      v_arr := '[]'; v_changed := false;
      for el in select pg_catalog.jsonb_array_elements_text(v) loop
        select * into r from public.nia_kw_analyze(el);
        if r.action <> 'none' then
          if r.masked is distinct from el then v_changed := true; end if;
          if r.action = 'hold' then v_hold_field := true; end if;
          categories := categories || r.categories;
          if (case when r.action = 'hold' then 0 else 100 end) + public.nia_report_priority(r.category) < v_best then
            v_best := (case when r.action = 'hold' then 0 else 100 end) + public.nia_report_priority(r.category);
            category := r.category;
          end if;
        end if;
        v_arr := v_arr || pg_catalog.to_jsonb(coalesce(r.masked, el));
      end loop;
      if v_changed then patch := patch || pg_catalog.jsonb_build_object(f, v_arr); end if;
    elsif pg_catalog.jsonb_typeof(v) = 'string' then
      select * into r from public.nia_kw_analyze(v #>> '{}');
      if r.action <> 'none' then
        if r.masked is distinct from (v #>> '{}') then
          patch := patch || pg_catalog.jsonb_build_object(f, r.masked);
        end if;
        if r.action = 'hold' then v_hold_field := true; end if;
        categories := categories || r.categories;
        if (case when r.action = 'hold' then 0 else 100 end) + public.nia_report_priority(r.category) < v_best then
          v_best := (case when r.action = 'hold' then 0 else 100 end) + public.nia_report_priority(r.category);
          category := r.category;
        end if;
      end if;
    end if;
    if v_hold_field then
      hold := true;
      original := original || pg_catalog.jsonb_build_object(f, v);
      fields := fields || f;
    end if;
  end loop;
  categories := array(select d.c from (select distinct u.c from pg_catalog.unnest(categories) as u(c)) d
                       order by d.c is distinct from category, public.nia_report_priority(d.c), d.c);
end;
$$;

-- Enregistre un contenu retenu (+ notification NIA à l'auteur, sauf
-- pédocriminalité : ne pas alerter un suspect, comme 017 pour les P0 ; sauf
-- chat live, trop fréquent).
create or replace function public.nia_kw_record(
  p_type text, p_id uuid, p_field text, p_author uuid, p_category text,
  p_categories text[], p_original jsonb, p_pending text, p_action text,
  p_status text, p_video uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_type = 'user' and p_status = 'open' then
    -- Une nouvelle valeur en attente remplace la précédente pour ce champ.
    update public.keyword_flags k set status = 'superseded', reviewed_at = pg_catalog.now()
     where k.target_type = 'user' and k.target_id = p_id and k.field = p_field and k.status = 'open';
  end if;
  insert into public.keyword_flags (target_type, target_id, field, author_id, action, category,
                                    categories, priority, original, pending_text, status)
  values (p_type, p_id, p_field, p_author, p_action, coalesce(p_category, 'injustice_autre'),
          coalesce(p_categories, '{}'), public.nia_report_priority(p_category), p_original,
          p_pending, p_status);
  if p_status = 'open' and p_category is distinct from 'pedocriminalite' and p_type <> 'live_comment' then
    perform public.nia_notify(p_author, 'moderation_notice', p_video,
      case when p_type = 'user'
           then 'Ta modification de profil est en cours de vérification : elle sera visible après validation par la modération NIA.'
           else 'Ton contenu est en cours de vérification : il sera visible par les autres après validation par la modération NIA.'
      end,
      pg_catalog.jsonb_build_object('code', 'held_keywords', 'category', p_category,
        'target_type', p_type, 'field', p_field));
  end if;
end;
$$;

-- Vidéo retenue pour pédocriminalité : fichiers mis à l'abri tout de suite
-- (même file que 017, Edge Function moderation-hold déjà déployée).
create or replace function public.nia_kw_hold_video_files(p_video uuid, p_owner uuid,
  p_storage text, p_cover text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_paths text[];
begin
  select coalesce(pg_catalog.array_agg(distinct p), '{}') into v_paths
    from pg_catalog.unnest(array[p_storage, p_cover]) as p
   where p is not null and p like p_owner::text || '/%';
  insert into public.moderation_file_holds as h (video_id, owner_id, paths, desired, actual)
  values (p_video, p_owner, v_paths, 'held', 'public')
  on conflict (video_id) do update
     set desired = 'held',
         paths = case when h.actual = 'public' then excluded.paths else h.paths end,
         attempts = case when h.actual = 'public' then 0 else h.attempts end,
         not_before = pg_catalog.now(),
         updated_at = pg_catalog.now();
end;
$$;

-- ===========================================================================
-- 6. Triggers (les gardes de 017 passent avant : 05 / 10 < 30)
-- ===========================================================================
create or replace function public.nia_comments_keyword_filter()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  x record;
begin
  if not public.nia_kw_app_write() then return new; end if;
  select * into x from public.nia_kw_scan_fields(pg_catalog.to_jsonb(new),
    case when tg_op = 'UPDATE' then pg_catalog.to_jsonb(old) end, array['body']);
  if x.patch <> '{}'::jsonb then
    new := pg_catalog.jsonb_populate_record(new, x.patch);
  end if;
  if x.hold then
    if tg_op = 'INSERT' or old.moderation_state = 'visible' then
      new.moderation_state := 'held';
    end if;
    perform public.nia_kw_record('comment', new.id, 'body', new.user_id, x.category, x.categories,
      x.original, null, 'hold', 'open', new.video_id);
  end if;
  return new;
end;
$$;
drop trigger if exists comments_30_keyword_filter on public.comments;
create trigger comments_30_keyword_filter
  before insert or update of body on public.comments
  for each row execute function public.nia_comments_keyword_filter();

create or replace function public.nia_videos_keyword_filter()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  x record;
begin
  if not public.nia_kw_app_write() then return new; end if;
  select * into x from public.nia_kw_scan_fields(pg_catalog.to_jsonb(new),
    case when tg_op = 'UPDATE' then pg_catalog.to_jsonb(old) end,
    array['caption', 'hashtags', 'alt_text', 'location_text']);
  if x.patch <> '{}'::jsonb then
    new := pg_catalog.jsonb_populate_record(new, x.patch);
  end if;
  if x.hold then
    if tg_op = 'INSERT' or old.moderation_state = 'visible' then
      new.moderation_state := 'held';
      new.moderation_reason := 'auto:keywords';
    end if;
    perform public.nia_kw_record('video', new.id, pg_catalog.array_to_string(x.fields, ','),
      new.user_id, x.category, x.categories, x.original, null, 'hold', 'open', null);
    if x.category = 'pedocriminalite' and new.repost_of is null then
      perform public.nia_kw_hold_video_files(new.id, new.user_id, new.storage_path, new.cover_path);
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists videos_30_keyword_filter on public.videos;
create trigger videos_30_keyword_filter
  before insert or update of caption, hashtags, alt_text, location_text on public.videos
  for each row execute function public.nia_videos_keyword_filter();

create or replace function public.nia_live_streams_keyword_filter()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  x record;
begin
  if not public.nia_kw_app_write() then return new; end if;
  select * into x from public.nia_kw_scan_fields(pg_catalog.to_jsonb(new),
    case when tg_op = 'UPDATE' then pg_catalog.to_jsonb(old) end, array['title', 'description']);
  if x.patch <> '{}'::jsonb then
    new := pg_catalog.jsonb_populate_record(new, x.patch);
  end if;
  if x.hold then
    if tg_op = 'INSERT' or old.moderation_state = 'visible' then
      new.moderation_state := 'held';
    end if;
    perform public.nia_kw_record('live', new.id, pg_catalog.array_to_string(x.fields, ','),
      new.user_id, x.category, x.categories, x.original, null, 'hold', 'open', null);
  end if;
  return new;
end;
$$;
drop trigger if exists live_streams_30_keyword_filter on public.live_streams;
create trigger live_streams_30_keyword_filter
  before insert or update of title, description on public.live_streams
  for each row execute function public.nia_live_streams_keyword_filter();

-- Profils. App : pseudo refusé ; nom affiché / bio masqués ou mis en attente.
-- Inscription (handle_new_user, trigger sur auth.users : pas de rôle
-- authenticated, profondeur > 1) : pseudo remplacé plutôt que refusé, sinon
-- l'inscription entière (e-mail, Google, Snapchat) échouerait.
create or replace function public.nia_profiles_keyword_filter()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  f text;
  v_new text;
  v_old text;
  v_app boolean := public.nia_kw_app_write();
  v_signup boolean := tg_op = 'INSERT' and coalesce(auth.role(), '') <> 'authenticated'
                      and pg_catalog.pg_trigger_depth() > 1;
begin
  if not (v_app or v_signup) then return new; end if;

  if new.username is not null and (tg_op = 'INSERT' or new.username is distinct from old.username) then
    select * into r from public.nia_kw_analyze(new.username);
    if r.action <> 'none' then
      if v_app then
        raise exception 'text_refused' using errcode = '22023', detail = 'username';
      end if;
      perform public.nia_kw_record('user', new.id, 'username', new.id, r.category, r.categories,
        pg_catalog.jsonb_build_object('username', new.username), null, 'refuse', 'logged', null);
      new.username := 'createur_' || pg_catalog.left(pg_catalog.md5(new.id::text), 8);
    end if;
  end if;

  foreach f in array array['display_name', 'bio'] loop
    v_new := pg_catalog.to_jsonb(new) ->> f;
    v_old := case when tg_op = 'UPDATE' then pg_catalog.to_jsonb(old) ->> f end;
    if v_new is null or (tg_op = 'UPDATE' and v_new is not distinct from v_old) then
      continue;
    end if;
    select * into r from public.nia_kw_analyze(v_new);
    if r.action = 'hold' then
      -- En attente : l'ancienne valeur reste affichée.
      new := pg_catalog.jsonb_populate_record(new, pg_catalog.jsonb_build_object(f,
        case when tg_op = 'UPDATE' then v_old when f = 'bio' then '' end));
      perform public.nia_kw_record('user', new.id, f, new.id, r.category, r.categories,
        pg_catalog.jsonb_build_object(f, v_new), r.masked, 'hold', 'open', null);
    else
      if r.action = 'mask' then
        new := pg_catalog.jsonb_populate_record(new, pg_catalog.jsonb_build_object(f, r.masked));
      end if;
      if tg_op = 'UPDATE' then
        -- Nouvelle valeur acceptée : une ancienne valeur en attente n'a plus lieu d'être.
        update public.keyword_flags k set status = 'superseded', reviewed_at = pg_catalog.now()
         where k.target_type = 'user' and k.target_id = new.id and k.field = f and k.status = 'open';
      end if;
    end if;
  end loop;
  return new;
end;
$$;
drop trigger if exists profiles_30_keyword_filter on public.profiles;
create trigger profiles_30_keyword_filter
  before insert or update of username, display_name, bio on public.profiles
  for each row execute function public.nia_profiles_keyword_filter();

-- Chat live (table créée par la future migration live 019 / L3).
create or replace function public.nia_live_comments_keyword_filter()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  x record;
begin
  if not public.nia_kw_app_write() then return new; end if;
  select * into x from public.nia_kw_scan_fields(pg_catalog.to_jsonb(new),
    case when tg_op = 'UPDATE' then pg_catalog.to_jsonb(old) end, array['body']);
  if x.patch <> '{}'::jsonb then
    new := pg_catalog.jsonb_populate_record(new, x.patch);
  end if;
  if x.hold then
    new := pg_catalog.jsonb_populate_record(new, pg_catalog.jsonb_build_object('hidden_at', pg_catalog.now()));
    perform public.nia_kw_record('live_comment', new.id, 'body',
      (pg_catalog.to_jsonb(new) ->> 'user_id')::uuid, x.category, x.categories, x.original,
      null, 'hold', 'open', null);
  end if;
  return new;
end;
$$;

-- À rappeler par 019 après la création de live_comments :
--   select public.nia_kw_attach_live_chat();
-- Nom sans numéro : les triggers BEFORE s'exécutent par ordre alphabétique et
-- celui-ci doit passer APRÈS « live_comments_before_insert » du brouillon live
-- (qui remet hidden_at à NULL).
create or replace function public.nia_kw_attach_live_chat()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rel regclass := pg_catalog.to_regclass('public.live_comments');
begin
  if v_rel is null then
    return false;
  end if;
  if (select count(*) from pg_catalog.pg_attribute a
       where a.attrelid = v_rel and not a.attisdropped
         and a.attname in ('id', 'body', 'user_id', 'hidden_at')) < 4 then
    return false;
  end if;
  execute 'drop trigger if exists live_comments_keyword_filter on public.live_comments';
  execute 'create trigger live_comments_keyword_filter
             before insert or update of body on public.live_comments
             for each row execute function public.nia_live_comments_keyword_filter()';
  return true;
end;
$$;
do $$ begin perform public.nia_kw_attach_live_chat(); end $$;

-- ===========================================================================
-- 7. Décision d'un modérateur
-- ===========================================================================
-- p_decision : approve (le contenu devient visible / la valeur de profil en
-- attente s'applique) ou reject (contenu retiré / valeur abandonnée).
-- Comme mod_resolve_report : toutes les traces ouvertes sur la même cible sont
-- closes ensemble (pour un profil : le même champ).
create or replace function public.mod_resolve_keyword_flag(
  p_flag_id uuid, p_decision text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  f public.keyword_flags%rowtype;
  v_status text;
  v_state text;
  v_changed boolean := false;
  v_n integer := 0;
begin
  if not public.nia_mod_context() then
    raise exception 'not_moderator' using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('approve', 'reject') then
    raise exception 'bad_decision' using errcode = '22023';
  end if;
  select * into f from public.keyword_flags where id = p_flag_id for update;
  if not found then
    raise exception 'flag_not_found' using errcode = 'P0002';
  end if;
  if f.status <> 'open' then
    raise exception 'flag_already_resolved' using errcode = '22023';
  end if;
  v_status := case p_decision when 'approve' then 'approved' else 'rejected' end;

  if f.target_type = 'user' then
    if p_decision = 'approve' and f.field in ('display_name', 'bio') then
      perform pg_catalog.set_config('nia.mod_trusted', 'on', true);
      if f.field = 'bio' then
        update public.profiles set bio = f.pending_text where id = f.target_id;
      else
        update public.profiles set display_name = f.pending_text where id = f.target_id;
      end if;
      get diagnostics v_n = row_count;
      perform pg_catalog.set_config('nia.mod_trusted', '', true);
      v_changed := v_n > 0;
    end if;
    update public.keyword_flags k
       set status = v_status, reviewed_at = pg_catalog.now(),
           reviewed_by = case when public.nia_is_moderator() then auth.uid() end,
           review_note = pg_catalog.left(p_note, 1000)
     where k.target_type = 'user' and k.target_id = f.target_id and k.field = f.field and k.status = 'open';
  else
    v_state := case f.target_type
      when 'video' then (select v.moderation_state from public.videos v where v.id = f.target_id)
      when 'comment' then (select c.moderation_state from public.comments c where c.id = f.target_id)
      when 'live' then (select l.moderation_state from public.live_streams l where l.id = f.target_id)
      else null end;
    if f.target_type = 'live_comment' and pg_catalog.to_regclass('public.live_comments') is not null then
      execute 'select case when hidden_at is null then ''visible'' else ''held'' end from public.live_comments where id = $1'
         into v_state using f.target_id;
    end if;
    if p_decision = 'approve' then
      -- Un contenu aussi signalé (signalement ouvert) reste masqué : la
      -- décision sur les signalements passe par mod_resolve_report.
      if v_state = 'held' and not exists (
           select 1 from public.reports r
            where r.target_type = f.target_type and r.target_id = f.target_id
              and r.status in ('open', 'in_review', 'escalated')) then
        v_changed := public.nia_apply_moderation_state(f.target_type, f.target_id, 'visible', 'keywords:approved');
      end if;
    elsif v_state is not null and v_state <> 'removed' then
      v_changed := public.nia_apply_moderation_state(f.target_type, f.target_id, 'removed',
        'keywords:' || f.category);
      if f.target_type = 'video' then
        update public.moderation_file_holds h
           set purge_after = pg_catalog.now()
             + case when f.category = 'pedocriminalite' then interval '180 days' else interval '90 days' end,
               updated_at = pg_catalog.now()
         where h.video_id = f.target_id;
      end if;
    end if;
    update public.keyword_flags k
       set status = v_status, reviewed_at = pg_catalog.now(),
           reviewed_by = case when public.nia_is_moderator() then auth.uid() end,
           review_note = pg_catalog.left(p_note, 1000)
     where k.target_type = f.target_type and k.target_id = f.target_id and k.status = 'open';
  end if;

  if f.author_id is not null and f.target_type <> 'live_comment' then
    if p_decision = 'approve' and v_changed then
      perform public.nia_notify(f.author_id, 'moderation_notice',
        case when f.target_type = 'video' then f.target_id end,
        'Ton contenu a été validé par la modération NIA : il est maintenant visible.',
        pg_catalog.jsonb_build_object('code', 'approved', 'category', f.category,
          'target_type', f.target_type, 'field', f.field));
    elsif p_decision = 'reject' then
      perform public.nia_notify(f.author_id, 'moderation_notice', null,
        'Un de vos contenus a été retiré pour non-respect des règles (motif : '
          || public.nia_report_category_label_fr(f.category) || '). Contestation : niaapp@outlook.com.',
        pg_catalog.jsonb_build_object('code', 'removed', 'resolution', 'content_removed',
          'category', f.category, 'target_type', f.target_type, 'field', f.field));
    end if;
  end if;
end;
$$;

-- ===========================================================================
-- 8. Files de modération (Dashboard)
-- ===========================================================================
-- moderation_queue (017) : mêmes colonnes, dans le même ordre, + « source »
-- en dernier ('report' | 'keyword_filter'). Pour une ligne keyword_filter,
-- id = keyword_flags.id → mod_resolve_keyword_flag(id, 'approve' | 'reject').
create or replace view public.moderation_queue
with (security_invoker = true) as
  select q.id, q.priority, q.category, q.target_type, q.target_id, q.target_owner_id,
         q.target_owner_username, q.status, q.legal_status, q.legal_ref, q.auto_hidden,
         q.evidence_count, q.details, q.target_snapshot, q.created_at, q.reports_on_target, q.source
    from (
      select r.id, r.priority, r.category, r.target_type, r.target_id, r.target_owner_id,
             p.username as target_owner_username,
             r.status, r.legal_status, r.legal_ref, r.auto_hidden, r.evidence_count, r.details,
             r.target_snapshot, r.created_at,
             count(*) over (partition by r.target_type, r.target_id) as reports_on_target,
             'report'::text as source
        from public.reports r
        left join public.profiles p on p.id = r.target_owner_id
       where r.status in ('open', 'in_review', 'escalated')
      union all
      select k.id, k.priority, k.category, k.target_type, k.target_id, k.author_id,
             p.username,
             'open'::text,
             case when k.category = 'pedocriminalite' then 'to_report' else 'none' end,
             null::text, true, 0::smallint,
             'Filtre de mots (' || k.field || ') : '
               || pg_catalog.array_to_string(k.categories, ', ')
               || case when o.n >= 3 then ' — récidive : ' || o.n || ' contenus retenus en 7 jours' else '' end,
             pg_catalog.jsonb_build_object('source', 'keyword_filter', 'field', k.field,
               'original', k.original, 'pending_text', k.pending_text,
               'categories', k.categories, 'author_holds_7d', o.n),
             k.created_at, 0::bigint, 'keyword_filter'::text
        from public.keyword_flags k
        left join public.profiles p on p.id = k.author_id
        left join lateral (select count(*) as n from public.keyword_flags k2
                            where k2.author_id = k.author_id and k2.action = 'hold'
                              and k2.created_at > pg_catalog.now() - interval '7 days') o on true
       where k.status = 'open'
    ) q
   order by q.priority, q.created_at;
revoke all on public.moderation_queue from anon;

-- Récidive : auteurs avec 3 contenus retenus ou plus en 7 jours (lecture
-- modérateurs ; suspension éventuelle à la main : mod_suspend_user de 017).
create or replace view public.moderation_keyword_offenders
with (security_invoker = true) as
  select k.author_id, p.username,
         count(*) filter (where k.created_at > pg_catalog.now() - interval '7 days') as holds_7d,
         count(*) filter (where k.status = 'open') as open_holds,
         count(*) filter (where k.status = 'rejected') as rejected_total,
         max(k.created_at) as last_at
    from public.keyword_flags k
    left join public.profiles p on p.id = k.author_id
   where k.author_id is not null and k.action = 'hold'
   group by k.author_id, p.username
  having count(*) filter (where k.created_at > pg_catalog.now() - interval '7 days') >= 3
   order by 3 desc, last_at desc;
revoke all on public.moderation_keyword_offenders from anon;

-- ===========================================================================
-- 9. Droits
-- ===========================================================================
revoke all on function public.nia_kw_fold(text) from public, anon, authenticated;
revoke all on function public.nia_kw_leet(text) from public, anon, authenticated;
revoke all on function public.nia_kw_key(text) from public, anon, authenticated;
revoke all on function public.nia_kw_runs_ok(integer[], integer[]) from public, anon, authenticated;
revoke all on function public.nia_kw_singular(text, boolean) from public, anon, authenticated;
revoke all on function public.nia_kw_normalize_term(text) from public, anon, authenticated;
revoke all on function public.nia_kw_terms_normalize() from public, anon, authenticated;
revoke all on function public.nia_kw_analyze(text) from public, anon, authenticated;
revoke all on function public.nia_kw_scan_fields(jsonb, jsonb, text[]) from public, anon, authenticated;
revoke all on function public.nia_kw_record(text, uuid, text, uuid, text, text[], jsonb, text, text, text, uuid)
  from public, anon, authenticated;
revoke all on function public.nia_kw_hold_video_files(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.nia_kw_attach_live_chat() from public, anon, authenticated;
revoke all on function public.nia_comments_keyword_filter() from public, anon, authenticated;
revoke all on function public.nia_videos_keyword_filter() from public, anon, authenticated;
revoke all on function public.nia_live_streams_keyword_filter() from public, anon, authenticated;
revoke all on function public.nia_profiles_keyword_filter() from public, anon, authenticated;
revoke all on function public.nia_live_comments_keyword_filter() from public, anon, authenticated;
-- nia_kw_app_write : SECURITY INVOKER, appelée par les triggers.
revoke all on function public.nia_kw_app_write() from public, anon;
grant execute on function public.nia_kw_app_write() to authenticated, service_role;
revoke all on function public.nia_check_text(text, text) from public;
grant execute on function public.nia_check_text(text, text) to anon, authenticated, service_role;
revoke all on function public.mod_resolve_keyword_flag(uuid, text, text) from public, anon;
grant execute on function public.mod_resolve_keyword_flag(uuid, text, text) to authenticated, service_role;

-- ===========================================================================
-- 10. Liste de départ (à relire par le fondateur)
-- ===========================================================================
-- Volontairement COURTE : français et anglais seulement, termes repris du
-- brouillon du plan. ON CONFLICT DO NOTHING : rejouer 018 n'écrase jamais une
-- modification faite ensuite (terme désactivé, action changée…).
-- Termes en langues africaines (wolof, lingala, bambara, swahili, haoussa,
-- yoruba…) : à fournir par des locuteurs natifs, rien n'est inventé ici.
-- Exclus : « negro » (= noir en espagnol / portugais), « xxx » (bisous),
-- « con » (trop ambigu), « pédo » (accusation à ne pas masquer : relève du
-- signalement P0).
-- enabled = false : terme ambigu ou réapproprié, à activer seulement après
-- relecture (voir note).
insert into public.moderation_terms (term, lang, category, action, match_mode, enabled, note)
select t.term, t.lang, t.category, t.action, t.match_mode, t.enabled, t.note
  from (values
    -- insultes / harcèlement : MASQUÉES (le contenu est publié)
    ('connard', 'fr', 'insultes_harcelement', 'mask', 'word', true, null),
    ('connasse', 'fr', 'insultes_harcelement', 'mask', 'word', true, null),
    ('conasse', 'fr', 'insultes_harcelement', 'mask', 'word', true, null),
    ('salope', 'fr', 'insultes_harcelement', 'mask', 'word', true, null),
    ('salopard', 'fr', 'insultes_harcelement', 'mask', 'word', true, null),
    ('enculé', 'fr', 'insultes_harcelement', 'mask', 'word', true, null),
    ('enculée', 'fr', 'insultes_harcelement', 'mask', 'word', true, null),
    ('bâtard', 'fr', 'insultes_harcelement', 'mask', 'word', true, 'aussi « pain bâtard », « chien bâtard » : masquage sans conséquence'),
    ('bâtarde', 'fr', 'insultes_harcelement', 'mask', 'word', true, null),
    ('fdp', 'fr', 'insultes_harcelement', 'mask', 'word', true, null),
    ('ntm', 'fr', 'insultes_harcelement', 'mask', 'word', true, null),
    ('pute', 'fr', 'insultes_harcelement', 'mask', 'word', true, null),
    ('fils de pute', 'fr', 'insultes_harcelement', 'mask', 'word', true, null),
    ('fuck', 'en', 'insultes_harcelement', 'mask', 'word', true, null),
    ('fucker', 'en', 'insultes_harcelement', 'mask', 'word', true, null),
    ('motherfucker', 'en', 'insultes_harcelement', 'mask', 'word', true, null),
    ('bitch', 'en', 'insultes_harcelement', 'mask', 'word', true, null),
    ('asshole', 'en', 'insultes_harcelement', 'mask', 'word', true, null),
    ('cunt', 'en', 'insultes_harcelement', 'mask', 'word', true, null),
    -- nudité / contenu sexuel : EN ATTENTE
    ('porno', '*', 'nudite_sexuel', 'hold', 'word', true, null),
    ('porn', '*', 'nudite_sexuel', 'hold', 'word', true, '« food porn » en deux mots sera retenu'),
    ('nudes', '*', 'nudite_sexuel', 'hold', 'word', true, null),
    ('nude', '*', 'nudite_sexuel', 'hold', 'word', false, 'couleur « nude » (maquillage, mode) : trop de faux positifs'),
    ('onlyfans', '*', 'nudite_sexuel', 'hold', 'word', true, null),
    -- négrophobie : EN ATTENTE
    ('nègre', 'fr', 'negrophobie', 'hold', 'word', true, 'Négritude (Césaire, Senghor) : les citations seront validées à la main'),
    ('négresse', 'fr', 'negrophobie', 'hold', 'word', true, null),
    ('bamboula', 'fr', 'negrophobie', 'hold', 'word', true, 'aussi une danse / un tambour : à relire'),
    ('macaque', 'fr', 'negrophobie', 'hold', 'word', true, 'aussi l''animal'),
    ('sale noir', 'fr', 'negrophobie', 'hold', 'word', true, null),
    ('sale singe', 'fr', 'negrophobie', 'hold', 'word', true, null),
    ('banania', 'fr', 'negrophobie', 'hold', 'word', false, 'aussi la marque : trop ambigu seul'),
    ('nigger', 'en', 'negrophobie', 'hold', 'word', true, null),
    ('nigga', 'en', 'negrophobie', 'hold', 'word', false, 'usage réapproprié courant dans la diaspora (rap) : décision du fondateur'),
    -- racisme / haine : EN ATTENTE
    ('bougnoule', 'fr', 'racisme_haine', 'hold', 'word', true, null),
    ('bicot', 'fr', 'racisme_haine', 'hold', 'word', true, null),
    ('youpin', 'fr', 'racisme_haine', 'hold', 'word', true, null),
    ('youtre', 'fr', 'racisme_haine', 'hold', 'word', true, null),
    ('chinetoque', 'fr', 'racisme_haine', 'hold', 'word', true, null),
    ('sale arabe', 'fr', 'racisme_haine', 'hold', 'word', true, null),
    ('sale juif', 'fr', 'racisme_haine', 'hold', 'word', true, null),
    ('sale blanc', 'fr', 'racisme_haine', 'hold', 'word', true, null),
    -- propos homophobes : EN ATTENTE
    ('pédé', 'fr', 'homophobie', 'hold', 'word', true, null),
    ('pd', 'fr', 'homophobie', 'hold', 'word', true, 'aussi « P.D. » (initiales) : rare'),
    ('tarlouze', 'fr', 'homophobie', 'hold', 'word', true, null),
    ('tafiole', 'fr', 'homophobie', 'hold', 'word', true, null),
    ('tapette', 'fr', 'homophobie', 'hold', 'word', true, 'aussi « tapette à mouches » : à relire'),
    ('gouine', 'fr', 'homophobie', 'hold', 'word', true, 'parfois réapproprié : à relire'),
    ('sale gay', 'fr', 'homophobie', 'hold', 'word', true, null),
    ('sale lesbienne', 'fr', 'homophobie', 'hold', 'word', true, null),
    ('faggot', 'en', 'homophobie', 'hold', 'word', true, null),
    ('fag', 'en', 'homophobie', 'hold', 'word', false, 'aussi « cigarette » en anglais britannique'),
    ('dyke', 'en', 'homophobie', 'hold', 'word', false, 'réapproprié (« dyke march ») : décision du fondateur'),
    -- pédocriminalité : EN ATTENTE, priorité P0 (pas de notification à l'auteur)
    ('pthc', '*', 'pedocriminalite', 'hold', 'word', true, null),
    ('childporn', 'en', 'pedocriminalite', 'hold', 'substring', true, null),
    ('child porn', 'en', 'pedocriminalite', 'hold', 'word', true, null),
    ('pédoporno', 'fr', 'pedocriminalite', 'hold', 'substring', true, null),
    ('jailbait', 'en', 'pedocriminalite', 'hold', 'word', true, null),
    -- menaces : EN ATTENTE, priorité P1
    ('je vais te tuer', 'fr', 'menace_danger', 'hold', 'word', true, 'aussi par plaisanterie : à relire'),
    ('je vais te buter', 'fr', 'menace_danger', 'hold', 'word', true, null),
    ('suicide toi', 'fr', 'menace_danger', 'hold', 'word', true, null),
    ('i will kill you', 'en', 'menace_danger', 'hold', 'word', true, null),
    ('kill yourself', 'en', 'menace_danger', 'hold', 'word', true, null),
    ('kys', 'en', 'menace_danger', 'hold', 'word', true, null)
  ) as t(term, lang, category, action, match_mode, enabled, note)
on conflict (term) do nothing;

-- ===========================================================================
-- ROLLBACK (à la main, dans l'ordre) — résumé
-- ===========================================================================
-- ⚠ D'abord traiter les contenus retenus (sinon ils restent masqués) :
--   select public.mod_resolve_keyword_flag(id, 'approve') from public.keyword_flags where status = 'open';
-- drop view if exists public.moderation_keyword_offenders;
-- moderation_queue : réexécuter la section 9 de 017 après
--   drop view public.moderation_queue;   (la colonne « source » ne peut pas être retirée par REPLACE)
-- drop trigger if exists live_comments_keyword_filter on public.live_comments;
-- drop trigger if exists profiles_30_keyword_filter on public.profiles;
-- drop trigger if exists live_streams_30_keyword_filter on public.live_streams;
-- drop trigger if exists videos_30_keyword_filter on public.videos;
-- drop trigger if exists comments_30_keyword_filter on public.comments;
-- drop function if exists public.mod_resolve_keyword_flag(uuid, text, text),
--   public.nia_check_text(text, text), public.nia_kw_attach_live_chat(),
--   public.nia_live_comments_keyword_filter(), public.nia_profiles_keyword_filter(),
--   public.nia_live_streams_keyword_filter(), public.nia_videos_keyword_filter(),
--   public.nia_comments_keyword_filter(), public.nia_kw_hold_video_files(uuid, uuid, text, text),
--   public.nia_kw_record(text, uuid, text, uuid, text, text[], jsonb, text, text, text, uuid),
--   public.nia_kw_scan_fields(jsonb, jsonb, text[]), public.nia_kw_app_write(),
--   public.nia_kw_analyze(text);
-- drop table if exists public.keyword_flags;   -- ⚠ traces des contenus retenus
-- drop table if exists public.moderation_terms;
-- drop function if exists public.nia_kw_terms_normalize(), public.nia_kw_normalize_term(text),
--   public.nia_kw_singular(text, boolean), public.nia_kw_runs_ok(integer[], integer[]),
--   public.nia_kw_key(text), public.nia_kw_leet(text), public.nia_kw_fold(text);
