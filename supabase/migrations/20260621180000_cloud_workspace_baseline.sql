-- Askewly Command cloud mode baseline.
-- Creates personal workspaces, task sources, tasks, and RLS policies.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  avatar_url text,
  provider text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspaces (
  id bigint generated always as identity primary key,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspaces_name_not_blank check (length(btrim(name)) > 0)
);

create table if not exists public.workspace_members (
  workspace_id bigint not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member',
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id),
  constraint workspace_members_role_check check (role in ('owner', 'member'))
);

create table if not exists public.task_sources (
  id bigint generated always as identity primary key,
  workspace_id bigint not null references public.workspaces(id) on delete cascade,
  key text not null,
  kind text not null,
  label text not null,
  config jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_sources_key_not_blank check (length(btrim(key)) > 0),
  constraint task_sources_label_not_blank check (length(btrim(label)) > 0),
  constraint task_sources_kind_check check (kind in ('today', 'deadline', 'backlog', 'external')),
  constraint task_sources_config_object check (jsonb_typeof(config) = 'object'),
  unique (id, workspace_id),
  unique (workspace_id, key)
);

create table if not exists public.tasks (
  id bigint generated always as identity primary key,
  workspace_id bigint not null references public.workspaces(id) on delete cascade,
  source_id bigint not null references public.task_sources(id) on delete restrict,
  title text not null,
  detail text,
  status text not null default 'todo',
  due_at timestamptz,
  scheduled_for date,
  sort_order integer not null default 0,
  archived_at timestamptz,
  created_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  updated_by uuid default auth.uid() references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tasks_source_workspace_fk foreign key (source_id, workspace_id)
    references public.task_sources(id, workspace_id) on delete restrict,
  constraint tasks_title_not_blank check (length(btrim(title)) > 0),
  constraint tasks_status_check check (status in ('todo', 'doing', 'done', 'archived')),
  constraint tasks_archive_consistency check ((status = 'archived') = (archived_at is not null))
);

create index if not exists profiles_email_idx on public.profiles (email);
create index if not exists workspaces_owner_id_idx on public.workspaces (owner_id);
create index if not exists workspace_members_user_id_idx on public.workspace_members (user_id);
create index if not exists task_sources_workspace_id_sort_idx on public.task_sources (workspace_id, sort_order, id);
create index if not exists tasks_workspace_source_sort_idx on public.tasks (workspace_id, source_id, status, sort_order, id);
create index if not exists tasks_workspace_due_idx on public.tasks (workspace_id, due_at) where due_at is not null;
create index if not exists tasks_workspace_scheduled_idx on public.tasks (workspace_id, scheduled_for) where scheduled_for is not null;
create index if not exists tasks_created_by_idx on public.tasks (created_by);
create index if not exists tasks_updated_by_idx on public.tasks (updated_by);

create or replace function public.is_workspace_member(target_workspace_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_workspace_member(bigint) from public;
grant execute on function public.is_workspace_member(bigint) to authenticated;

create or replace function public.is_workspace_owner(target_workspace_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspaces w
    where w.id = target_workspace_id
      and w.owner_id = (select auth.uid())
  );
$$;

revoke all on function public.is_workspace_owner(bigint) from public;
grant execute on function public.is_workspace_owner(bigint) to authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  workspace_id bigint;
  full_name text;
  avatar text;
  first_provider text;
begin
  full_name := coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name');
  avatar := coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture');
  first_provider := coalesce(new.app_metadata ->> 'provider', 'oauth');

  insert into public.profiles (id, email, display_name, avatar_url, provider)
  values (new.id, new.email, full_name, avatar, first_provider)
  on conflict (id) do update
    set email = excluded.email,
        display_name = coalesce(public.profiles.display_name, excluded.display_name),
        avatar_url = coalesce(public.profiles.avatar_url, excluded.avatar_url),
        provider = coalesce(public.profiles.provider, excluded.provider),
        updated_at = now();

  insert into public.workspaces (owner_id, name)
  values (new.id, 'Personal')
  returning id into workspace_id;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (workspace_id, new.id, 'owner')
  on conflict (workspace_id, user_id) do nothing;

  insert into public.task_sources (workspace_id, key, kind, label, sort_order)
  values
    (workspace_id, 'today', 'today', 'Today', 10),
    (workspace_id, 'deadlines', 'deadline', 'Deadlines', 20),
    (workspace_id, 'backlog', 'backlog', 'Backlog', 30)
  on conflict (workspace_id, key) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_workspace_pulse on auth.users;
create trigger on_auth_user_created_workspace_pulse
after insert on auth.users
for each row execute function public.handle_new_user();

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists workspaces_set_updated_at on public.workspaces;
create trigger workspaces_set_updated_at
before update on public.workspaces
for each row execute function public.set_updated_at();

drop trigger if exists task_sources_set_updated_at on public.task_sources;
create trigger task_sources_set_updated_at
before update on public.task_sources
for each row execute function public.set_updated_at();

drop trigger if exists tasks_set_updated_at on public.tasks;
create trigger tasks_set_updated_at
before update on public.tasks
for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.task_sources enable row level security;
alter table public.tasks enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
for select to authenticated
using ((select auth.uid()) = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
for insert to authenticated
with check ((select auth.uid()) = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
for update to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

drop policy if exists "workspaces_select_member" on public.workspaces;
create policy "workspaces_select_member" on public.workspaces
for select to authenticated
using ((select public.is_workspace_member(id)) or owner_id = (select auth.uid()));

drop policy if exists "workspaces_insert_owner" on public.workspaces;
create policy "workspaces_insert_owner" on public.workspaces
for insert to authenticated
with check ((select auth.uid()) = owner_id);

drop policy if exists "workspaces_update_owner" on public.workspaces;
create policy "workspaces_update_owner" on public.workspaces
for update to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

drop policy if exists "workspaces_delete_owner" on public.workspaces;
create policy "workspaces_delete_owner" on public.workspaces
for delete to authenticated
using ((select auth.uid()) = owner_id);

drop policy if exists "workspace_members_select_member" on public.workspace_members;
create policy "workspace_members_select_member" on public.workspace_members
for select to authenticated
using ((select public.is_workspace_member(workspace_id)) or (select auth.uid()) = user_id);

drop policy if exists "workspace_members_insert_owner" on public.workspace_members;
create policy "workspace_members_insert_owner" on public.workspace_members
for insert to authenticated
with check ((select public.is_workspace_owner(workspace_id)));

drop policy if exists "workspace_members_update_owner" on public.workspace_members;
create policy "workspace_members_update_owner" on public.workspace_members
for update to authenticated
using ((select public.is_workspace_owner(workspace_id)))
with check ((select public.is_workspace_owner(workspace_id)));

drop policy if exists "workspace_members_delete_owner" on public.workspace_members;
create policy "workspace_members_delete_owner" on public.workspace_members
for delete to authenticated
using ((select public.is_workspace_owner(workspace_id)));

drop policy if exists "task_sources_select_member" on public.task_sources;
create policy "task_sources_select_member" on public.task_sources
for select to authenticated
using ((select public.is_workspace_member(workspace_id)));

drop policy if exists "task_sources_insert_member" on public.task_sources;
create policy "task_sources_insert_member" on public.task_sources
for insert to authenticated
with check ((select public.is_workspace_member(workspace_id)));

drop policy if exists "task_sources_update_member" on public.task_sources;
create policy "task_sources_update_member" on public.task_sources
for update to authenticated
using ((select public.is_workspace_member(workspace_id)))
with check ((select public.is_workspace_member(workspace_id)));

drop policy if exists "task_sources_delete_owner" on public.task_sources;
create policy "task_sources_delete_owner" on public.task_sources
for delete to authenticated
using ((select public.is_workspace_owner(workspace_id)));

drop policy if exists "tasks_select_member" on public.tasks;
create policy "tasks_select_member" on public.tasks
for select to authenticated
using ((select public.is_workspace_member(workspace_id)));

drop policy if exists "tasks_insert_member" on public.tasks;
create policy "tasks_insert_member" on public.tasks
for insert to authenticated
with check (
  (select public.is_workspace_member(workspace_id))
  and created_by = (select auth.uid())
  and (updated_by is null or updated_by = (select auth.uid()))
);

drop policy if exists "tasks_update_member" on public.tasks;
create policy "tasks_update_member" on public.tasks
for update to authenticated
using ((select public.is_workspace_member(workspace_id)))
with check (
  (select public.is_workspace_member(workspace_id))
  and (updated_by is null or updated_by = (select auth.uid()))
);

drop policy if exists "tasks_delete_member" on public.tasks;
create policy "tasks_delete_member" on public.tasks
for delete to authenticated
using ((select public.is_workspace_member(workspace_id)));
