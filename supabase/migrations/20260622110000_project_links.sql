-- Add project links for Obsidian/GitHub/URL/local file metadata.
-- Link targets are launch shortcuts only; note/file bodies are not stored.

create table if not exists public.project_links (
  id bigint generated always as identity primary key,
  workspace_id bigint not null,
  project_id bigint not null,
  project_milestone_id bigint references public.project_milestones(id) on delete set null,
  title text not null,
  kind text not null,
  target text not null,
  sort_order integer not null default 0,
  archived_at timestamptz,
  created_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  updated_by uuid default auth.uid() references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_links_project_workspace_fk
    foreign key (project_id, workspace_id)
    references public.projects(id, workspace_id)
    on delete cascade,
  constraint project_links_title_not_blank check (length(btrim(title)) > 0),
  constraint project_links_target_not_blank check (length(btrim(target)) > 0),
  constraint project_links_kind_check check (kind in ('obsidian', 'github', 'url', 'file'))
);

create index if not exists project_links_project_sort_idx
  on public.project_links (workspace_id, project_id, sort_order, id)
  where archived_at is null;
create index if not exists project_links_milestone_idx
  on public.project_links (workspace_id, project_milestone_id, sort_order, id)
  where project_milestone_id is not null and archived_at is null;
create index if not exists project_links_created_by_idx on public.project_links (created_by);
create index if not exists project_links_updated_by_idx on public.project_links (updated_by);

create or replace function public.ensure_project_link_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.projects p
    where p.id = new.project_id
      and p.workspace_id = new.workspace_id
      and p.status <> 'archived'
  ) then
    raise exception 'project_links.project_id must reference an active project in the same workspace';
  end if;

  if new.project_milestone_id is not null and not exists (
    select 1
    from public.project_milestones pm
    where pm.id = new.project_milestone_id
      and pm.workspace_id = new.workspace_id
      and pm.project_id = new.project_id
      and pm.status <> 'archived'
  ) then
    raise exception 'project_links.project_milestone_id must reference an active milestone in the same project';
  end if;

  return new;
end;
$$;

drop trigger if exists project_links_scope_guard on public.project_links;
create trigger project_links_scope_guard
before insert or update of workspace_id, project_id, project_milestone_id on public.project_links
for each row execute function public.ensure_project_link_scope();

drop trigger if exists project_links_set_updated_at on public.project_links;
create trigger project_links_set_updated_at
before update on public.project_links
for each row execute function public.set_updated_at();

alter table public.project_links enable row level security;

drop policy if exists "project_links_select_member" on public.project_links;
create policy "project_links_select_member" on public.project_links
for select to authenticated
using ((select public.is_workspace_member(workspace_id)));

drop policy if exists "project_links_insert_member" on public.project_links;
create policy "project_links_insert_member" on public.project_links
for insert to authenticated
with check (
  (select public.is_workspace_member(workspace_id))
  and created_by = (select auth.uid())
  and (updated_by is null or updated_by = (select auth.uid()))
);

drop policy if exists "project_links_update_member" on public.project_links;
create policy "project_links_update_member" on public.project_links
for update to authenticated
using ((select public.is_workspace_member(workspace_id)))
with check (
  (select public.is_workspace_member(workspace_id))
  and (updated_by is null or updated_by = (select auth.uid()))
);

drop policy if exists "project_links_delete_owner" on public.project_links;
create policy "project_links_delete_owner" on public.project_links
for delete to authenticated
using ((select public.is_workspace_owner(workspace_id)));

grant select, insert, update, delete on table public.project_links to authenticated;
grant execute on function public.ensure_project_link_scope() to authenticated;
