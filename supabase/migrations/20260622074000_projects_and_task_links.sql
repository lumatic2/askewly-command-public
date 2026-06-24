-- Add workspace projects and optional task -> project links.
-- Schedule sources remain the task source of truth; projects are task context.

create table if not exists public.projects (
  id bigint generated always as identity primary key,
  workspace_id bigint not null references public.workspaces(id) on delete cascade,
  name text not null,
  north_star text,
  description text,
  status text not null default 'active',
  github_url text,
  current_horizon text,
  roadmap_note text,
  sort_order integer not null default 0,
  archived_at timestamptz,
  created_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  updated_by uuid default auth.uid() references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint projects_name_not_blank check (length(btrim(name)) > 0),
  constraint projects_status_check check (status in ('active', 'paused', 'archived')),
  constraint projects_archive_consistency check ((status = 'archived') = (archived_at is not null)),
  unique (id, workspace_id)
);

alter table public.tasks
  add column if not exists project_id bigint references public.projects(id) on delete set null;

create index if not exists projects_workspace_sort_idx on public.projects (workspace_id, sort_order, id);
create index if not exists projects_workspace_status_idx on public.projects (workspace_id, status, sort_order, id);
create index if not exists projects_created_by_idx on public.projects (created_by);
create index if not exists projects_updated_by_idx on public.projects (updated_by);
create index if not exists tasks_workspace_project_idx on public.tasks (workspace_id, project_id, source_id, status, sort_order, id)
  where project_id is not null;

create or replace function public.ensure_task_project_same_workspace()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.project_id is not null and not exists (
    select 1
    from public.projects p
    where p.id = new.project_id
      and p.workspace_id = new.workspace_id
      and p.status <> 'archived'
  ) then
    raise exception 'task project_id must reference an active project in the same workspace';
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_project_workspace_guard on public.tasks;
create trigger tasks_project_workspace_guard
before insert or update of workspace_id, project_id on public.tasks
for each row execute function public.ensure_task_project_same_workspace();

drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at
before update on public.projects
for each row execute function public.set_updated_at();

alter table public.projects enable row level security;

drop policy if exists "projects_select_member" on public.projects;
create policy "projects_select_member" on public.projects
for select to authenticated
using ((select public.is_workspace_member(workspace_id)));

drop policy if exists "projects_insert_member" on public.projects;
create policy "projects_insert_member" on public.projects
for insert to authenticated
with check (
  (select public.is_workspace_member(workspace_id))
  and created_by = (select auth.uid())
  and (updated_by is null or updated_by = (select auth.uid()))
);

drop policy if exists "projects_update_member" on public.projects;
create policy "projects_update_member" on public.projects
for update to authenticated
using ((select public.is_workspace_member(workspace_id)))
with check (
  (select public.is_workspace_member(workspace_id))
  and (updated_by is null or updated_by = (select auth.uid()))
);

drop policy if exists "projects_delete_owner" on public.projects;
create policy "projects_delete_owner" on public.projects
for delete to authenticated
using ((select public.is_workspace_owner(workspace_id)));

grant select, insert, update, delete on table public.projects to authenticated;
grant execute on function public.ensure_task_project_same_workspace() to authenticated;
