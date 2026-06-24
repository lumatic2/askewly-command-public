-- Add structured project milestones and optional task -> milestone links.
-- Schedule sources remain the task source of truth; milestones are project execution context.

create table if not exists public.project_milestones (
  id bigint generated always as identity primary key,
  workspace_id bigint not null,
  project_id bigint not null,
  title text not null,
  description text,
  status text not null default 'planned',
  target_date date,
  sort_order integer not null default 0,
  archived_at timestamptz,
  created_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  updated_by uuid default auth.uid() references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_milestones_project_workspace_fk
    foreign key (project_id, workspace_id)
    references public.projects(id, workspace_id)
    on delete cascade,
  constraint project_milestones_title_not_blank check (length(btrim(title)) > 0),
  constraint project_milestones_status_check check (status in ('planned', 'active', 'done', 'archived')),
  constraint project_milestones_archive_consistency check ((status = 'archived') = (archived_at is not null)),
  unique (id, workspace_id, project_id)
);

alter table public.tasks
  add column if not exists project_milestone_id bigint references public.project_milestones(id) on delete set null;

create index if not exists project_milestones_project_sort_idx
  on public.project_milestones (workspace_id, project_id, sort_order, id);
create index if not exists project_milestones_workspace_status_idx
  on public.project_milestones (workspace_id, status, sort_order, id);
create index if not exists project_milestones_created_by_idx on public.project_milestones (created_by);
create index if not exists project_milestones_updated_by_idx on public.project_milestones (updated_by);
create index if not exists tasks_workspace_project_milestone_idx
  on public.tasks (workspace_id, project_id, project_milestone_id, source_id, status, sort_order, id)
  where project_milestone_id is not null;

create or replace function public.ensure_task_project_same_workspace()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  milestone_project_id bigint;
begin
  if new.project_milestone_id is not null then
    select pm.project_id
      into milestone_project_id
    from public.project_milestones pm
    join public.projects p
      on p.id = pm.project_id
     and p.workspace_id = pm.workspace_id
    where pm.id = new.project_milestone_id
      and pm.workspace_id = new.workspace_id
      and pm.status <> 'archived'
      and p.status <> 'archived';

    if milestone_project_id is null then
      raise exception 'task project_milestone_id must reference an active milestone in the same workspace';
    end if;

    if new.project_id is null then
      new.project_id = milestone_project_id;
    elsif new.project_id <> milestone_project_id then
      raise exception 'task project_id must match project_milestone project_id';
    end if;
  end if;

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
before insert or update of workspace_id, project_id, project_milestone_id on public.tasks
for each row execute function public.ensure_task_project_same_workspace();

drop trigger if exists project_milestones_set_updated_at on public.project_milestones;
create trigger project_milestones_set_updated_at
before update on public.project_milestones
for each row execute function public.set_updated_at();

alter table public.project_milestones enable row level security;

drop policy if exists "project_milestones_select_member" on public.project_milestones;
create policy "project_milestones_select_member" on public.project_milestones
for select to authenticated
using ((select public.is_workspace_member(workspace_id)));

drop policy if exists "project_milestones_insert_member" on public.project_milestones;
create policy "project_milestones_insert_member" on public.project_milestones
for insert to authenticated
with check (
  (select public.is_workspace_member(workspace_id))
  and created_by = (select auth.uid())
  and (updated_by is null or updated_by = (select auth.uid()))
);

drop policy if exists "project_milestones_update_member" on public.project_milestones;
create policy "project_milestones_update_member" on public.project_milestones
for update to authenticated
using ((select public.is_workspace_member(workspace_id)))
with check (
  (select public.is_workspace_member(workspace_id))
  and (updated_by is null or updated_by = (select auth.uid()))
);

drop policy if exists "project_milestones_delete_owner" on public.project_milestones;
create policy "project_milestones_delete_owner" on public.project_milestones
for delete to authenticated
using ((select public.is_workspace_owner(workspace_id)));

grant select, insert, update, delete on table public.project_milestones to authenticated;
