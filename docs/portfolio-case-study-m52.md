# Askewly Command Portfolio Case Study

## One-line Positioning

Askewly Command is an agent-native personal command center that connects a Windows desktop widget, an Expo mobile app, and AI coding sessions to the same task and project graph.

한국어 한 줄 설명:

> 어스큐리 커맨드는 데스크톱 위젯, 모바일 앱, AI 코딩 세션이 같은 일정·프로젝트 그래프를 조작하는 개인용 커맨드 센터입니다.

## Problem

Personal work context is scattered across calendars, GitHub repositories, local project folders, vault notes, and AI coding sessions. A normal todo app can store tasks, but it does not solve the operational problem: when an agent session, a desktop workspace, and a mobile review loop all need to refer to the same current work state, each surface usually becomes its own stale copy.

Askewly Command treats the schedule and project graph as a shared command surface instead of a standalone list.

## What I Built

- A persistent Electron desktop widget for schedule, command overview, status board, and connected project context.
- An Expo React Native mobile app for Today, deadlines, backlog, focus review, task status changes, and project linking.
- A Supabase Auth/Postgres cloud model so desktop and mobile read and write the same task workspace.
- A local `askewly` CLI so Codex and Claude Code sessions can safely create, move, update, and complete tasks through a verified command contract.
- A public landing page for the product surface while keeping private task APIs disabled on the public path.

## Product Shape

Askewly Command is not positioned as a general calendar replacement. It is a companion surface for holding onto today's executable work across devices and agent sessions.

The current workflow is:

1. Use the desktop widget while working at the PC.
2. Use the mobile app to review Today, deadlines, backlog, and linked project context.
3. Let an AI coding session translate natural language into explicit `askewly` CLI commands.
4. Keep all surfaces synced through the same Supabase workspace.

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

Context sources such as GitHub, Google Calendar, Notion, and the private vault remain adjacent systems. The active schedule source of truth is Supabase. Legacy M4/vault schedule sync is kept as a fallback/import path, not the primary write path.

## Agent-native Command Contract

The CLI is intentionally not a natural-language parser. The agent handles interpretation; the CLI accepts explicit validated payloads.

Example:

```powershell
askewly tasks add --title "마감 보고" --section deadlines --due "2026-06-25 18:00"
askewly tasks update --id 431 --project "Askewly Command"
askewly tasks move --id 431 --section backlog
askewly tasks status --id 431 --status done
```

This keeps the trusted boundary small:

- Natural language stays in the agent layer.
- Command shape, project lookup, section selection, status values, and due dates are validated by the CLI.
- Supabase is accessed through the same authenticated app contract instead of ad hoc SQL.

## Why This Is Portfolio-relevant

This project demonstrates more than a CRUD interface:

- Multi-surface product architecture: Electron desktop, Expo mobile, public web, and local CLI.
- Data ownership and migration judgment: Supabase is the cloud SoT while legacy M4/vault paths are retained but demoted.
- Agent integration as product design: AI sessions can act on the user's operating system through a narrow command contract.
- Practical UX iteration: mobile Today, focus review, schedule panels, project linking, and status board were refined through real device QA.
- Verification discipline: each milestone carries an evidence document and focused smoke/verifier commands.

## Demo Path

The short demo should show the same task moving through three surfaces:

1. Open the desktop widget and show Today / Command context.
2. Open the mobile app and show the same Today / Focus review item.
3. Run an agent-style CLI command:

   ```powershell
   askewly tasks add --title "포트폴리오 데모 마감" --section deadlines --due "2026-06-25 18:00"
   ```

4. Refresh the mobile or desktop surface and show the created deadline.
5. Link the task to `Askewly Command` or move it to backlog.
6. Complete or archive the demo task.

## Evidence

- M48 review loop: `docs/personal-review-planning-loop-m48.md`
- M49 public landing: `docs/public-landing-page-redesign-m49.md`
- M50 legacy surface consolidation: `docs/legacy-surface-consolidation-m50.md`
- M51 agent command intake and project seed: `docs/agent-command-intake-project-seed-m51.md`
- Agent CLI entrypoint: `scripts/askewly-command.js`
- Global CLI installer: `scripts/install-askewly-cli.ps1`

## Current Boundaries

- It is a personal command center first, not a team collaboration product.
- Store distribution is not claimed as complete.
- Public unauthenticated task/project APIs are intentionally not exposed.
- Private user data is not used in portfolio materials.
- The CLI currently belongs inside this repository because it depends on the app's session, workspace, and task/project contracts.

## Next Polish for a Portfolio Demo

- Capture a clean 30-60 second video showing desktop, mobile, and CLI sync.
- Add `askewly tasks list/search/recent` for a stronger terminal demo.
- Continue mobile UI polish around Today, schedule sheet, project linking, and review surfaces.
- Prepare a sanitized seeded workspace for repeatable demos.
