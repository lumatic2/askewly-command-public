# ADR 0006: Agent Command Intake Uses Local Authenticated CLI

## Status

Accepted, 2026-06-24.

## Context

Askewly Command is moving from manual mobile/desktop task entry toward agent-assisted command entry. The user wants Codex and Claude Code sessions to accept natural language such as "add this to Today" and then create or update Schedule/Project records.

The product already stores personal task and project data in Supabase with workspace ownership. A public unauthenticated API would make this surface harder to secure and would require more production infrastructure before the personal workflow is validated.

## Decision

Create an agent-facing local CLI/API contract first.

- Natural language interpretation happens in Codex/Claude Code.
- The agent converts intent into explicit command payloads.
- A local `askewly` command validates the payload and writes through application-level Supabase contracts.
- Project seed/import is idempotent by project name inside one workspace.
- Initial project seed fields are limited to `name`, `description`, and `github_url`.
- Task commands support create, move, update/status, and project attachment.

## Consequences

- The first integration is usable from local agent sessions without new paid services or external deployment.
- Supabase credentials remain local environment values and are not committed.
- Public HTTP API design is deferred until the local command contract proves useful.
- Verification can run with dry-run fixtures and optional live Supabase smoke when credentials are present.

## Non-Goals

- No public task mutation endpoint in this milestone.
- No autonomous agent scheduler.
- No storage of raw agent chat transcripts by default.
