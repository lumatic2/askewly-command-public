# Cloud Mode Schema Baseline

Askewly Command cloud mode uses Supabase Auth plus Postgres RLS. Google and
Kakao login create an auth user; the database trigger creates the first
personal workspace and default task sources.

## Tables

- `profiles`: one row per `auth.users` user.
- `workspaces`: owner-scoped workspaces. The MVP creates one `Personal`
  workspace per new user.
- `workspace_members`: workspace membership and role (`owner`, `member`).
- `task_sources`: logical sections for `today`, `deadlines`, and `backlog`.
- `tasks`: user tasks tied to a workspace and source.

The cloud contract intentionally keeps `task_sources.key = 'deadlines'` while
`task_sources.kind = 'deadline'`. The existing desktop widget still uses the
legacy singular `deadline` source key. `shared/tasks.js` owns that translation.

## RLS Model

RLS is enabled on every user-data table. Policies use authenticated users only.
Authenticated clients are granted schema/table access in
`20260621211500_grant_authenticated_app_access.sql`; RLS remains responsible
for row-level isolation. Without these grants, PostgREST fails before policy
evaluation with `permission denied for table workspaces`.

- `profiles`: users can read, insert, and update their own profile.
- `workspaces`: members can read; owners can insert, update, and delete.
- `workspace_members`: members can read membership; owners can manage members.
- `task_sources`: members can read, insert, and update; owners can delete.
- `tasks`: members can read, insert, update, and delete tasks in their workspace.

The helper functions `public.is_workspace_member()` and
`public.is_workspace_owner()` wrap membership checks. Policies wrap
`auth.uid()` as `(select auth.uid())` to match Supabase RLS performance
guidance.

## New User Bootstrap

`public.handle_new_user()` runs after insert on `auth.users` and creates:

- a `profiles` row from OAuth metadata,
- a `Personal` workspace,
- an owner membership row,
- default task sources: `today`, `deadlines`, `backlog`.

Existing Auth users are covered by
`20260621204000_backfill_existing_auth_users.sql`. This migration is idempotent
and creates any missing profile, personal workspace, owner membership, and
default task sources for users that signed in before the trigger existed.

## Verification

Local static verification:

```powershell
node scripts\verify-supabase-schema.js
node --check shared\tasks.js
```

Live database verification:

```powershell
npx supabase db push --yes
npx supabase migration list
npx supabase db query --linked --output json "select (select count(*) from auth.users) as auth_users, (select count(*) from public.profiles) as profiles, (select count(*) from public.workspaces) as workspaces, (select count(*) from public.workspace_members) as members, (select count(*) from public.task_sources) as sources;"
```

Current remote verification for the `dashboard` project:

- `20260621180000`, `20260621204000`, and `20260621211500` are applied remotely.
- `auth_users=1`, `profiles=1`, `workspaces=1`, `members=1`, `sources=3`.
- Android native Refresh loads the `Personal` workspace and the three default
  sections after the grant migration.

Next live checks:

- Google login creates profile/workspace/default sources.
- Kakao login creates profile/workspace/default sources, including users without
  email.
- Authenticated users cannot read or mutate another workspace's rows.
- A workspace member can create/update tasks in their workspace.
- A workspace owner can manage members and delete task sources.
