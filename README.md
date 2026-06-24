# Askewly Command

> Personal command center. A desktop widget, Expo mobile app, and agent-facing CLI operate on the same Supabase task/project graph.

## Portfolio Snapshot

Askewly Command is an agent-native personal command center: a Windows desktop widget, Expo mobile app, public landing page, and local `askewly` CLI all operate on the same Supabase task/project graph.

- **Case study**: [`docs/portfolio-case-study-m52.md`](docs/portfolio-case-study-m52.md)
- **Demo script**: [`docs/portfolio-demo-script-m52.md`](docs/portfolio-demo-script-m52.md)
- **Strongest signal**: Codex/Claude Code can turn natural language into validated `askewly` CLI commands, so agent sessions update the same task workspace as the app instead of writing directly to the database.
- **Current boundary**: personal command center first; store distribution, team sharing, billing, and public task APIs are intentionally out of scope.

## What It Is

Askewly Command keeps scattered work context in one operational surface. Tasks and project context live in a Supabase workspace, while the desktop widget, mobile app, and `askewly` CLI all use the same application-level contract.

## Architecture

```text
Codex / Claude Code
        |
        v
  askewly local CLI
        |
        v
Supabase Auth + Postgres
        |
   +----+----+
   |         |
Electron   Expo Mobile
Desktop    App
```

Adjacent context sources such as GitHub, Google Calendar, Notion, and private vault adapters remain outside the public task API. Legacy markdown schedule paths are import/fallback only, not the primary write path.

## Main Surfaces

| Surface | Role |
|---|---|
| Electron desktop widget | Persistent command/schedule/status surface while working at a PC |
| Expo mobile app | Today, deadlines, backlog, focus review, status changes, and project linking |
| `askewly` CLI | Local command surface for agent sessions |
| Public web | Product landing page without private data APIs |

## Agent CLI

Install the global Windows shim:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-askewly-cli.ps1
```

Use it from any shell:

```powershell
askewly projects list
askewly tasks add --title "Portfolio demo deadline" --section deadlines --due "2026-06-25 18:00" --project "Askewly Command"
askewly tasks update --id 431 --due "2026-06-26"
askewly tasks move --id 431 --section backlog
askewly tasks status --id 431 --status done
```

`--due` accepts `YYYY-MM-DD`, `YYYY-MM-DD HH:mm`, and ISO datetimes. Date-only values are treated as KST 23:59.

## Quick Start

```powershell
npm install
npm start
```

For the mobile app:

```powershell
cd mobile
npm install
npm run typecheck
```

## Public Readiness

```powershell
npm run verify:public-readiness
```

This public repo is a sanitized portfolio snapshot. It intentionally omits private history, local QA artifacts, and personal operational logs from the original private repository.

## See Also

- [`docs/portfolio-case-study-m52.md`](docs/portfolio-case-study-m52.md) — portfolio case study
- [`docs/portfolio-demo-script-m52.md`](docs/portfolio-demo-script-m52.md) — short demo script
- [`docs/PRD.md`](docs/PRD.md) — product requirements
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — architecture notes
- [`docs/onboarding.md`](docs/onboarding.md) — cloud mode onboarding
- [`docs/credential-checklist.md`](docs/credential-checklist.md) — Supabase/OAuth/native credential checklist
