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
    and exists (
      select 1
      from public.bvlog_workspaces
      where id = workspace_id
    )
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
