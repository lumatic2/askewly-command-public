-- Avoid PL/pgSQL ambiguity between the workspace_id variable and table columns.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_workspace_id bigint;
  full_name text;
  avatar text;
  first_provider text;
begin
  full_name := coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name');
  avatar := coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture');
  first_provider := coalesce(new.raw_app_meta_data ->> 'provider', 'email');

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
  returning id into new_workspace_id;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (new_workspace_id, new.id, 'owner')
  on conflict (workspace_id, user_id) do nothing;

  insert into public.task_sources (workspace_id, key, kind, label, sort_order)
  values
    (new_workspace_id, 'today', 'today', 'Today', 10),
    (new_workspace_id, 'deadlines', 'deadline', 'Deadlines', 20),
    (new_workspace_id, 'backlog', 'backlog', 'Backlog', 30)
  on conflict (workspace_id, key) do nothing;

  return new;
end;
$$;
