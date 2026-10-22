-- BVlog shared workspace schema
-- Run this once in Supabase SQL Editor before connecting the app.

create table if not exists public.bvlog_workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  roster jsonb not null default '[]'::jsonb,
  games jsonb not null default '[]'::jsonb,
  deleted_game_ids jsonb not null default '[]'::jsonb,
  created_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now()
);

-- Safe migration for workspaces created before deletion sync was added.
alter table public.bvlog_workspaces
  add column if not exists deleted_game_ids jsonb not null default '[]'::jsonb;

create table if not exists public.bvlog_workspace_members (
  workspace_id uuid not null references public.bvlog_workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'coach' check (role in ('owner', 'coach')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

alter table public.bvlog_workspaces enable row level security;
alter table public.bvlog_workspace_members enable row level security;

create or replace function public.is_bvlog_workspace_member(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.bvlog_workspace_members
    where workspace_id = target_workspace_id
      and user_id = auth.uid()
  );
$$;

-- A new user is not a workspace member yet, so the membership insert policy
-- cannot rely on the normal RLS-protected workspace select policy to confirm
-- that the shared workspace exists. This restricted security-definer helper
-- performs only that existence check without exposing workspace contents.
create or replace function public.bvlog_workspace_exists(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.bvlog_workspaces
    where id = target_workspace_id
  );
$$;

revoke all on function public.bvlog_workspace_exists(uuid) from public;
grant execute on function public.bvlog_workspace_exists(uuid) to authenticated;

drop policy if exists "BVlog members can read workspaces" on public.bvlog_workspaces;
create policy "BVlog members can read workspaces"
  on public.bvlog_workspaces for select
  using (created_by = auth.uid() or public.is_bvlog_workspace_member(id));

drop policy if exists "BVlog users can create workspaces" on public.bvlog_workspaces;
create policy "BVlog users can create workspaces"
  on public.bvlog_workspaces for insert
  with check (created_by = auth.uid());

drop policy if exists "BVlog members can update workspaces" on public.bvlog_workspaces;
create policy "BVlog members can update workspaces"
  on public.bvlog_workspaces for update
  using (public.is_bvlog_workspace_member(id))
  with check (public.is_bvlog_workspace_member(id));

drop policy if exists "BVlog members can read memberships" on public.bvlog_workspace_members;
create policy "BVlog members can read memberships"
  on public.bvlog_workspace_members for select
  using (user_id = auth.uid() or public.is_bvlog_workspace_member(workspace_id));

drop policy if exists "BVlog users can join workspaces" on public.bvlog_workspace_members;
drop policy if exists "BVlog signed-in users can join workspaces" on public.bvlog_workspace_members;
create policy "BVlog signed-in users can join workspaces"
  on public.bvlog_workspace_members for insert
  with check (
    user_id = auth.uid()
    and public.bvlog_workspace_exists(workspace_id)
  );

-- Enable realtime so every connected device can notice a merged workspace row.
-- The guard makes this safe to run if the table is already in the publication.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'bvlog_workspaces'
  ) then
    alter publication supabase_realtime add table public.bvlog_workspaces;
  end if;
end
$$;

-- Store each game as its own row instead of repeatedly rewriting the entire
-- workspace games JSON array. The legacy `bvlog_workspaces.games` column is
-- retained so existing data can be migrated safely and older deployments can
-- still be rolled back if needed.
create table if not exists public.bvlog_workspace_games (
  workspace_id uuid not null references public.bvlog_workspaces(id) on delete cascade,
  game_id text not null,
  game jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, game_id)
);

create index if not exists bvlog_workspace_games_updated_at_idx
  on public.bvlog_workspace_games (workspace_id, updated_at);

create table if not exists public.bvlog_workspace_game_deletions (
  workspace_id uuid not null references public.bvlog_workspaces(id) on delete cascade,
  game_id text not null,
  deleted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, game_id)
);

-- Keep a separate mutation timestamp so a deletion made while a device is
-- offline is still found by incremental downloads when it is uploaded later.
alter table public.bvlog_workspace_game_deletions
  add column if not exists updated_at timestamptz not null default now();

create index if not exists bvlog_workspace_game_deletions_deleted_at_idx
  on public.bvlog_workspace_game_deletions (workspace_id, deleted_at);

create index if not exists bvlog_workspace_game_deletions_updated_at_idx
  on public.bvlog_workspace_game_deletions (workspace_id, updated_at);

alter table public.bvlog_workspace_games enable row level security;
alter table public.bvlog_workspace_game_deletions enable row level security;

drop policy if exists "BVlog members can manage workspace games" on public.bvlog_workspace_games;
create policy "BVlog members can manage workspace games"
  on public.bvlog_workspace_games for all
  using (public.is_bvlog_workspace_member(workspace_id))
  with check (public.is_bvlog_workspace_member(workspace_id));

drop policy if exists "BVlog members can manage game deletions" on public.bvlog_workspace_game_deletions;
create policy "BVlog members can manage game deletions"
  on public.bvlog_workspace_game_deletions for all
  using (public.is_bvlog_workspace_member(workspace_id))
  with check (public.is_bvlog_workspace_member(workspace_id));

-- Keep the lightweight workspace version marker current when a game row or
-- deletion tombstone changes. Clients can then detect remote game changes
-- without downloading all game payloads during the periodic check.
create or replace function public.touch_bvlog_workspace_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.bvlog_workspaces
  set updated_at = now()
  where id = case when TG_OP = 'DELETE' then OLD.workspace_id else NEW.workspace_id end;
  if TG_OP = 'DELETE' then
    return OLD;
  end if;
  return NEW;
end
$$;

drop trigger if exists bvlog_workspace_games_touch_parent on public.bvlog_workspace_games;
create trigger bvlog_workspace_games_touch_parent
  after insert or update or delete on public.bvlog_workspace_games
  for each row execute function public.touch_bvlog_workspace_updated_at();

drop trigger if exists bvlog_workspace_game_deletions_touch_parent on public.bvlog_workspace_game_deletions;
create trigger bvlog_workspace_game_deletions_touch_parent
  after insert or update or delete on public.bvlog_workspace_game_deletions
  for each row execute function public.touch_bvlog_workspace_updated_at();

-- One-time backfill for workspaces that already contain games in the legacy
-- JSON column. Re-running this statement is safe.
insert into public.bvlog_workspace_games (workspace_id, game_id, game, updated_at)
select w.id, item.game->>'id', item.game, w.updated_at
from public.bvlog_workspaces w
cross join lateral jsonb_array_elements(
  case when jsonb_typeof(w.games) = 'array' then w.games else '[]'::jsonb end
) as item(game)
where item.game->>'id' is not null
on conflict (workspace_id, game_id) do update
set game = excluded.game,
    updated_at = greatest(public.bvlog_workspace_games.updated_at, excluded.updated_at);

insert into public.bvlog_workspace_game_deletions (workspace_id, game_id, deleted_at, updated_at)
select w.id,
       coalesce(item.deleted_game->>'id', trim(both '"' from item.deleted_game::text)),
       w.updated_at,
       w.updated_at
from public.bvlog_workspaces w
cross join lateral jsonb_array_elements(
  case when jsonb_typeof(w.deleted_game_ids) = 'array' then w.deleted_game_ids else '[]'::jsonb end
) as item(deleted_game)
where coalesce(item.deleted_game->>'id', trim(both '"' from item.deleted_game::text)) <> ''
on conflict (workspace_id, game_id) do nothing;

-- Enable realtime for row-level game updates. The workspace table remains in
-- realtime for roster/workspace changes.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'bvlog_workspace_games'
  ) then
    alter publication supabase_realtime add table public.bvlog_workspace_games;
  end if;
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'bvlog_workspace_game_deletions'
  ) then
    alter publication supabase_realtime add table public.bvlog_workspace_game_deletions;
  end if;
end
$$;
