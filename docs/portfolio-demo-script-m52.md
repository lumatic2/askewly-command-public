# Askewly Command Portfolio Demo Script

## Goal

Show that Askewly Command is a real personal command center where desktop, mobile, and AI-agent CLI actions share one schedule/project graph.

Target length: 3 minutes for a live walkthrough, 30-60 seconds for a recorded cut.

## Setup Checklist

- Desktop widget is running in cloud mode.
- Mobile app is installed and logged into the same workspace.
- `askewly --help` works from a normal shell.
- Demo workspace has the `Askewly Command` project seeded.
- No private calendar, email, vault, or personal task details are visible.

## Script

### 1. Frame the Problem

Say:

> My work context lives across code, notes, tasks, deadlines, and AI coding sessions. Askewly Command is my personal command center for keeping today's executable work in one synced graph.

Show:

- Desktop widget command/schedule surface.
- A small Today or Focus review view.

### 2. Show the Mobile Review Loop

Say:

> The mobile app is not a separate todo list. It reads the same Supabase workspace, so Today, deadlines, backlog, task status, and project links stay consistent with the desktop widget.

Show:

- Today card.
- Schedule panel or task detail sheet.
- Project linking surface if available.

### 3. Show Agent CLI Intake

Say:

> The interesting part is that AI coding sessions can also act on the same graph. Natural language stays with the agent, but the write path goes through a small validated CLI.

Run:

```powershell
askewly tasks add --title "포트폴리오 데모 마감" --section deadlines --due "2026-06-25 18:00" --project "Askewly Command"
```

Expected result:

- The command returns a created task.
- The due time is stored as the workspace deadline.
- The task is linked to the Askewly Command project.

### 4. Show Cross-surface Reflection

Say:

> Because the CLI uses the same app contract, the task appears in the same workspace instead of being a side-channel database write.

Show:

- Refresh desktop or mobile.
- Open Deadlines or the relevant schedule panel.
- Confirm the demo task appears.

### 5. Close the Loop

Run one cleanup command:

```powershell
askewly tasks status --id <demo-task-id> --status archived
```

Say:

> This is why I call it agent-native: the agent is not bolted onto the UI. It uses the same task and project contract as the product surfaces.

## Fallback Demo Without App Capture

If mobile capture is not ready, use terminal-only proof:

```powershell
askewly projects list
askewly tasks add --title "포트폴리오 데모 마감" --section deadlines --due "2026-06-25 18:00" --project "Askewly Command" --json
askewly tasks status --id <demo-task-id> --status archived --json
```

Then show the architecture diagram from `docs/portfolio-case-study-m52.md`.

## Do Not Show

- Personal email address, calendar details, vault note contents, or private task titles.
- Supabase service role keys, OAuth credentials, or `.env` values.
- Store distribution claims that have not been completed.
- Raw database writes as the normal agent path.
