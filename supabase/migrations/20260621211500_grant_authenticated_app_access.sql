-- Allow authenticated mobile clients to reach the app tables.
-- RLS policies still decide which rows each user can read or mutate.

grant usage on schema public to authenticated;

grant select, insert, update, delete on table public.profiles to authenticated;
grant select, insert, update, delete on table public.workspaces to authenticated;
grant select, insert, update, delete on table public.workspace_members to authenticated;
grant select, insert, update, delete on table public.task_sources to authenticated;
grant select, insert, update, delete on table public.tasks to authenticated;

grant usage, select on all sequences in schema public to authenticated;
