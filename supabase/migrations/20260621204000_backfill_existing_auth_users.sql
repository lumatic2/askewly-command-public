-- Backfill users that existed before the cloud baseline trigger was installed.

insert into public.profiles (id, email, display_name, avatar_url, provider)
select
  users.id,
  users.email,
  coalesce(users.raw_user_meta_data ->> 'full_name', users.raw_user_meta_data ->> 'name'),
  coalesce(users.raw_user_meta_data ->> 'avatar_url', users.raw_user_meta_data ->> 'picture'),
  coalesce(users.raw_app_meta_data ->> 'provider', 'oauth')
from auth.users
on conflict (id) do update
  set email = excluded.email,
      display_name = coalesce(public.profiles.display_name, excluded.display_name),
      avatar_url = coalesce(public.profiles.avatar_url, excluded.avatar_url),
      provider = coalesce(public.profiles.provider, excluded.provider),
      updated_at = now();

insert into public.workspaces (owner_id, name)
select profiles.id, 'Personal'
from public.profiles
where not exists (
  select 1
  from public.workspaces
  where workspaces.owner_id = profiles.id
);

insert into public.workspace_members (workspace_id, user_id, role)
select workspaces.id, workspaces.owner_id, 'owner'
from public.workspaces
where not exists (
  select 1
  from public.workspace_members
  where workspace_members.workspace_id = workspaces.id
    and workspace_members.user_id = workspaces.owner_id
);

insert into public.task_sources (workspace_id, key, kind, label, sort_order)
select workspaces.id, defaults.key, defaults.kind, defaults.label, defaults.sort_order
from public.workspaces
cross join (
  values
    ('today', 'today', 'Today', 10),
    ('deadlines', 'deadline', 'Deadlines', 20),
    ('backlog', 'backlog', 'Backlog', 30)
) as defaults(key, kind, label, sort_order)
on conflict (workspace_id, key) do nothing;
