-- =====================================================================
-- NosSoireesJeu — schéma Supabase (lot 1)
-- À exécuter une seule fois : Supabase > SQL Editor > New query > Run
-- Le script peut être relancé sans perte de données.
-- =====================================================================

-- ---------- Profils (un par compte) -----------------------------------
-- role = 'admin'  : gestionnaire (saisit, modifie, supprime)
-- role = 'viewer' : joueur (consultation seule)
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text,
  display_name text,
  role         text not null default 'viewer' check (role in ('admin','viewer')),
  player_id    uuid,
  created_at   timestamptz not null default now()
);

-- Le tout premier compte devient gestionnaire ; les suivants sont joueurs
-- (la fonction « invite » ajuste ensuite le rôle choisi par le gestionnaire).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, display_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email,'@',1)),
    case when exists (select 1 from public.profiles) then 'viewer' else 'admin' end
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- ---------- Fiches joueurs --------------------------------------------
create table if not exists public.players (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  color      text default '#2a78d6',
  archived   boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.profiles drop constraint if exists profiles_player_fk;
alter table public.profiles add constraint profiles_player_fk
  foreign key (player_id) references public.players(id) on delete set null;

-- ---------- Jeux et extensions ---------------------------------------
create table if not exists public.games (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,              -- nom affiché (modifiable)
  bgg_name      text,                       -- nom principal BGG
  bgg_id        integer,
  base_game_id  uuid references public.games(id) on delete cascade, -- rempli pour une extension
  year          integer,
  image_url     text,
  thumbnail_url text,
  types         text[] not null default '{}',
  categories    text[] not null default '{}',
  mechanics     text[] not null default '{}',
  designers     text[] not null default '{}',
  publisher     text,
  min_players   integer,
  max_players   integer,
  min_time      integer,
  max_time      integer,
  weight        numeric(3,2),
  status        text not null default 'owned' check (status in ('owned','elsewhere','lent')),
  lent_to       text,
  default_mode  text not null default 'competitive' check (default_mode in ('competitive','coop','teams','solo')),
  score_rule    text not null default 'high' check (score_rule in ('high','low','none')),
  notes         text,
  created_at    timestamptz not null default now()
);
create unique index if not exists games_bgg_id_uq on public.games(bgg_id) where bgg_id is not null;

-- ---------- Parties ---------------------------------------------------
create table if not exists public.plays (
  id           uuid primary key default gen_random_uuid(),
  game_id      uuid not null references public.games(id) on delete cascade,
  played_at    date not null default current_date,
  mode         text not null default 'competitive' check (mode in ('competitive','coop','teams','solo')),
  coop_result  text check (coop_result in ('win','loss')),
  is_learning  boolean not null default false,
  duration_min integer,
  location     text,
  notes        text,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.play_players (
  play_id   uuid not null references public.plays(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  score     numeric,
  rank      integer,
  team      text,
  is_winner boolean not null default false,
  primary key (play_id, player_id)
);

create table if not exists public.play_expansions (
  play_id uuid not null references public.plays(id) on delete cascade,
  game_id uuid not null references public.games(id) on delete cascade,
  primary key (play_id, game_id)
);

-- Historique : jamais modifié, jamais supprimé (pas de clé étrangère vers plays,
-- pour garder la trace des parties supprimées).
create table if not exists public.play_history (
  id         bigint generated always as identity primary key,
  play_id    uuid not null,
  action     text not null check (action in ('create','update','delete','restore')),
  actor      uuid references auth.users(id) on delete set null,
  at         timestamptz not null default now(),
  before     jsonb,
  after      jsonb
);

create index if not exists plays_game_idx   on public.plays(game_id);
create index if not exists plays_date_idx   on public.plays(played_at desc);
create index if not exists pp_player_idx    on public.play_players(player_id);
create index if not exists hist_play_idx    on public.play_history(play_id, at desc);

-- ---------- Écriture des parties (atomique + historique) ---------------
create or replace function public.play_snapshot(p_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'game_id', p.game_id, 'played_at', p.played_at, 'mode', p.mode,
    'coop_result', p.coop_result, 'is_learning', p.is_learning,
    'duration_min', p.duration_min, 'location', p.location, 'notes', p.notes,
    'players', coalesce((select jsonb_agg(jsonb_build_object(
        'player_id', pp.player_id, 'score', pp.score, 'rank', pp.rank,
        'team', pp.team, 'is_winner', pp.is_winner) order by pp.rank nulls last, pp.player_id)
      from public.play_players pp where pp.play_id = p.id), '[]'::jsonb),
    'expansions', coalesce((select jsonb_agg(pe.game_id order by pe.game_id)
      from public.play_expansions pe where pe.play_id = p.id), '[]'::jsonb))
  from public.plays p where p.id = p_id;
$$;

create or replace function public.save_play(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := nullif(p->>'id','')::uuid;
  v_before jsonb;
  v_after  jsonb;
  v_action text := 'create';
begin
  if not public.is_admin() then
    raise exception 'Action réservée aux gestionnaires';
  end if;
  if jsonb_array_length(coalesce(p->'players','[]'::jsonb)) = 0 then
    raise exception 'Une partie doit compter au moins un joueur';
  end if;

  if v_id is not null and exists (select 1 from public.plays where id = v_id) then
    v_action := 'update';
    v_before := public.play_snapshot(v_id);
    update public.plays set
      game_id      = (p->>'game_id')::uuid,
      played_at    = (p->>'played_at')::date,
      mode         = p->>'mode',
      coop_result  = nullif(p->>'coop_result',''),
      is_learning  = coalesce((p->>'is_learning')::boolean, false),
      duration_min = nullif(p->>'duration_min','')::integer,
      location     = nullif(p->>'location',''),
      notes        = nullif(p->>'notes',''),
      updated_at   = now()
    where id = v_id;
    delete from public.play_players    where play_id = v_id;
    delete from public.play_expansions where play_id = v_id;
  else
    insert into public.plays (id, game_id, played_at, mode, coop_result, is_learning,
                              duration_min, location, notes, created_by)
    values (coalesce(v_id, gen_random_uuid()), (p->>'game_id')::uuid, (p->>'played_at')::date,
            p->>'mode', nullif(p->>'coop_result',''), coalesce((p->>'is_learning')::boolean,false),
            nullif(p->>'duration_min','')::integer, nullif(p->>'location',''),
            nullif(p->>'notes',''), auth.uid())
    returning id into v_id;
  end if;

  insert into public.play_players (play_id, player_id, score, rank, team, is_winner)
  select v_id, (x->>'player_id')::uuid, nullif(x->>'score','')::numeric,
         nullif(x->>'rank','')::integer, nullif(x->>'team',''),
         coalesce((x->>'is_winner')::boolean, false)
  from jsonb_array_elements(p->'players') x;

  insert into public.play_expansions (play_id, game_id)
  select v_id, (e #>> '{}')::uuid
  from jsonb_array_elements(coalesce(p->'expansions','[]'::jsonb)) e;

  v_after := public.play_snapshot(v_id);
  if v_action = 'create' or v_before is distinct from v_after then
    insert into public.play_history (play_id, action, actor, before, after)
    values (v_id, v_action, auth.uid(), v_before, v_after);
  end if;
  return v_id;
end $$;

create or replace function public.delete_play(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_before jsonb;
begin
  if not public.is_admin() then
    raise exception 'Action réservée aux gestionnaires';
  end if;
  v_before := public.play_snapshot(p_id);
  if v_before is null then return; end if;
  insert into public.play_history (play_id, action, actor, before, after)
  values (p_id, 'delete', auth.uid(), v_before, null);
  delete from public.plays where id = p_id;
end $$;

create or replace function public.restore_play(p_history_id bigint)
returns uuid language plpgsql security definer set search_path = public as $$
declare h public.play_history; v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Action réservée aux gestionnaires';
  end if;
  select * into h from public.play_history where id = p_history_id and action = 'delete';
  if h.id is null then raise exception 'Suppression introuvable'; end if;
  if exists (select 1 from public.plays where id = h.play_id) then
    raise exception 'Cette partie existe déjà';
  end if;
  if not exists (select 1 from public.games where id = (h.before->>'game_id')::uuid) then
    raise exception 'Le jeu de cette partie a été supprimé';
  end if;
  v_id := public.save_play(h.before || jsonb_build_object('id', h.play_id));
  update public.play_history set action = 'restore'
  where id = (select max(id) from public.play_history where play_id = v_id and action = 'create');
  return v_id;
end $$;

create or replace function public.update_my_name(new_name text)
returns void language sql security definer set search_path = public as $$
  update public.profiles set display_name = left(trim(new_name), 60) where id = auth.uid();
$$;

-- Empêche de retirer le dernier gestionnaire.
create or replace function public.keep_one_admin()
returns trigger language plpgsql as $$
begin
  if old.role = 'admin' and new.role <> 'admin'
     and (select count(*) from public.profiles where role = 'admin') <= 1 then
    raise exception 'Il doit rester au moins un compte gestionnaire.';
  end if;
  return new;
end $$;

drop trigger if exists keep_one_admin on public.profiles;
create trigger keep_one_admin before update on public.profiles
  for each row execute function public.keep_one_admin();

-- ---------- Sécurité (Row Level Security) -----------------------------
alter table public.profiles        enable row level security;
alter table public.players         enable row level security;
alter table public.games           enable row level security;
alter table public.plays           enable row level security;
alter table public.play_players    enable row level security;
alter table public.play_expansions enable row level security;
alter table public.play_history    enable row level security;

-- Tout compte connecté lit ; seuls les gestionnaires écrivent jeux et joueurs.
do $$
declare t text;
begin
  foreach t in array array['players','games'] loop
    execute format('drop policy if exists "%1$s_read"  on public.%1$s', t);
    execute format('drop policy if exists "%1$s_write" on public.%1$s', t);
    execute format('create policy "%1$s_read"  on public.%1$s for select to authenticated using (true)', t);
    execute format('create policy "%1$s_write" on public.%1$s for all to authenticated using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
  -- Les parties ne s'écrivent que via save_play / delete_play (historique garanti).
  foreach t in array array['plays','play_players','play_expansions','play_history','profiles'] loop
    execute format('drop policy if exists "%1$s_read" on public.%1$s', t);
    execute format('create policy "%1$s_read" on public.%1$s for select to authenticated using (true)', t);
  end loop;
end $$;

drop policy if exists "profiles_admin_write" on public.profiles;
create policy "profiles_admin_write" on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Droits d'accès explicites (exigés pour les projets Supabase récents).
grant usage on schema public to authenticated;
grant select on all tables in schema public to authenticated;
grant insert, update, delete on public.players, public.games to authenticated;
grant update on public.profiles to authenticated;
revoke all on all tables in schema public from anon;
grant execute on function public.save_play(jsonb), public.delete_play(uuid),
  public.restore_play(bigint), public.update_my_name(text), public.is_admin()
  to authenticated;
revoke execute on function public.save_play(jsonb), public.delete_play(uuid),
  public.restore_play(bigint), public.update_my_name(text) from anon, public;
