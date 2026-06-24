# 아키텍처

## 디렉토리 구조

```
main/                 Electron main-process source modules
renderer/             Electron PC widget UI
web/                  Existing mobile PWA, kept as legacy/fallback surface
server/               Existing M4 Express API for legacy PWA/vault path
mobile/               Planned Expo React Native app
shared/               Planned shared TypeScript domain/client contracts
supabase/             Planned migrations, seed, and local config
docs/adr/             Product and architecture decisions
```

## 패턴

- Product mode is dual-path during migration:
  - `legacy mode`: Electron local cache + M4/vault/PWA sync.
  - `cloud mode`: Expo mobile app + Electron widget using Supabase Auth/DB.
- Keep task/domain contracts in shared TypeScript before duplicating logic across Electron and mobile.
- Treat Supabase as the source of truth only for cloud mode. Do not silently mirror personal vault data into cloud mode.

## 데이터 흐름

```
Mobile/Electron cloud UI -> Supabase Auth session -> Supabase Postgres tables guarded by RLS -> realtime or polling refresh -> UI
```

Agent command intake is local-first:

```
Codex/Claude Code natural language -> explicit command payload -> local askewly CLI -> Supabase app contract -> projects/tasks tables guarded by workspace ownership
```

The agent layer is responsible for natural-language interpretation only. The CLI validates command shape, resolves project names through workspace-scoped lookups, and performs idempotent project seed/import operations.

Legacy mode remains:

```
Electron widget -> local schedule cache -> debounced push/pull with M4 vault -> PWA fallback
```

## 외부 의존성

- Expo React Native: native mobile shell, OAuth deep links, EAS build/update path. ADR: `docs/adr/0001-expo-supabase-cloud-mode.md`
- Supabase Auth: Google/Kakao OAuth, session management, JWT identity. ADR: `docs/adr/0001-expo-supabase-cloud-mode.md`
- Supabase Postgres: task/workspace/source storage with RLS. ADR: `docs/adr/0001-expo-supabase-cloud-mode.md`
- Existing Electron: PC widget stays as the desktop surface.
- Existing M4/vault/Cloudflare path: retained for legacy personal workflow until cloud mode proves stable.

## 상태 관리

- Server state: Supabase tables, accessed through `@supabase/supabase-js` using user session.
- Client state: local UI state only, plus optimistic task interactions where rollback is possible.
- Auth state: Supabase session persisted by platform-appropriate storage. Native OAuth requires configured deep links and redirect allowlist.
- Tenant isolation: every cloud table with user data must include owner/workspace ownership and RLS policies before production use.
- Agent state: no long-lived session transcript is stored in the database by default. Agent commands write only normalized project/task records and optional task detail text.

## Daily Completion and Rollover

- Cloud task status values keep distinct meanings:
  - `todo`: not started.
  - `doing`: currently active.
  - `done`: completed but not yet archived.
  - `archived`: hidden from active task sections and available through archive/history surfaces.
- `scheduled_for` is the date anchor for the Today source. `due_at` remains the deadline timestamp for the Deadlines source.
- Rollover is an idempotent workspace-scoped operation:
  - Today tasks with `scheduled_for < today` and status `todo` or `doing` are updated to `scheduled_for = today`.
  - Today tasks with `scheduled_for < today` and status `done` are updated to `status = archived` with `archived_at` set.
  - Backlog and Deadlines are not moved by the Today rollover.
- PC and mobile completion actions must write the same cloud status. Archive is a separate operation or a rollover result.

## Initial Cloud Data Model

- `profiles`: user profile derived from Supabase auth user.
- `workspaces`: personal workspace per user for MVP.
- `workspace_members`: owner membership, future-proofed for sharing.
- `task_sources`: `today`, `deadline`, `backlog`, and future external source metadata.
- `tasks`: title, detail, status, due date, source, sort order, archived state.
- `projects`: lightweight project context with name, description, GitHub URL, status, and optional horizon/roadmap notes.
- `project_links`: optional supporting links when a project needs more than one URL. GitHub can live directly on `projects.github_url` for the simple seed path.

## Blocked Until Credentials

M2 and later implementation steps are blocked until the Supabase project and OAuth provider credentials exist. Secret values must not be committed.
