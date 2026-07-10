# 0006 - Remove Legacy Vault Schedule Path

## Status

Accepted (2026-07-04). Supersedes [0002 - Distribution and PWA Retention](0002-distribution-and-pwa-retention.md) and the legacy-flag clauses of [0005 - Supabase Schedule Source of Truth](0005-supabase-schedule-sot.md).

## Context

ADR 0005 made Supabase the schedule source of truth but kept the legacy M4 vault
markdown path (local SCHEDULE.md/BACKLOG.md/RECURRING.md, rclone mount, SSH
push/pull, file watchers) as an opt-in fallback behind
`ASKEWLY_COMMAND_LEGACY_SCHEDULE_ENABLED`. In practice:

- The Electron widget never read that flag; the legacy path ran as the implicit
  `else` branch whenever cloud mode was not signed in.
- The M4 Express server (`server/`) had no remaining in-repo caller.
- The legacy PWA was already replaced in M49 by the public landing page in
  `web/`, which is an active surface, not legacy.
- Roughly 1,300 lines of `main.js` existed only for markdown parsing/writing,
  scp sync, seeding, and file watching, and duplicated task-line parsing existed
  in four places.

## Decision

Delete the legacy vault schedule path entirely instead of keeping it behind a flag:

- `main.js`: markdown parse/write functions, sync engine (push queue, auto
  pull/push, seeding, projects snapshot over SSH), file watchers, mount/remote/
  paths/snapshot config, and the legacy branches of all schedule IPC handlers.
  Schedule mutations now require a Supabase session and fail with explicit
  login guidance otherwise.
- `server/` (M4 Express + launchd plists + cloudflared config) removed.
- `shared/legacy-schedule.js`, `scripts/import-legacy-schedule-to-cloud.js`,
  `scripts/sync-today-cache.js`, `scripts/deploy-to-m4.ps1`,
  `scripts/ensure-vault-mount.ps1` removed, with their npm scripts.
- `ASKEWLY_COMMAND_LEGACY_SCHEDULE_ENABLED` removed from env/docs.
- `web/` is kept: it is the live public landing page. Its `sw.js`/`manifest.json`
  remain only as a service-worker killswitch for old PWA installs.
- Offline/pre-login widget state is an explicit empty `signed-out` state (the
  last successful cloud state is retained on transient errors); the hardcoded
  snapshot fallback is gone.

## Consequences

- Supabase is the only schedule read/write path on every surface (widget,
  mobile, `askewly` CLI). Without a session the schedule tab is empty and
  mutations are rejected.
- One-time legacy import is no longer possible from this repo; the migration
  already completed before removal.
- M4 no longer receives `projects-snapshot.json` or vault markdown pushes from
  the widget. M4 OpenClaw cron must use `npm run export:cloud-schedule`.
- `scripts/test-schedule-interactions.js` now verifies the signed-out contract
  and UI structure instead of markdown round-trips.
