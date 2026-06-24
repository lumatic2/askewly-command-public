# ADR 0005: Supabase Schedule Source of Truth

## Status

Accepted, 2026-06-22

## Context

Askewly Command originally used M4 vault markdown files as the schedule source
of truth:

- `~/vault/30-projects/schedule/SCHEDULE.md`
- `~/vault/30-projects/schedule/BACKLOG.md`
- `~/vault/30-projects/schedule/*_ARCHIVE.md`

After the Expo mobile app and Electron cloud mode started reading and writing
Supabase, keeping automatic vault sync active caused stale writes, UI freezes,
and unclear ownership. M4 OpenClaw cron jobs also still had prompts/scripts that
read the markdown files directly.

## Decision

Supabase is the source of truth for active schedule data.

- Electron cloud mode reads/writes Supabase only.
- Expo mobile reads/writes Supabase only.
- M4 vault markdown schedule files are legacy import/fallback artifacts, not
  active schedule storage.
- M4/PWA markdown schedule writes are disabled by default and require
  `ASKEWLY_COMMAND_LEGACY_SCHEDULE_ENABLED=1`.
- Electron cloud mode hides and rejects legacy M4 vault Pull/Push.
- M4 OpenClaw cron jobs must read schedule context from Supabase, for example
  via `npm run export:cloud-schedule -- --format markdown`, not by reading
  `SCHEDULE.md` directly.

Vault itself remains useful for notes and knowledge browsing. This decision
only removes vault markdown as the active schedule store.

## Consequences

- Cross-device schedule behavior has one database source.
- The old PWA/M4 markdown path is no longer a supported primary mobile surface.
- Legacy markdown import remains available for migration/debugging.
- M4 cron job prompts need a one-time update to replace markdown reads with
  Supabase export output.
- Any future schedule automation should use Supabase REST/RPC or a dedicated
  service wrapper, not local markdown mutation.
