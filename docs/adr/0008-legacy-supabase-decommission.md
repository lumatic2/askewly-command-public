# ADR 0008 - Legacy Supabase 표면 완전 삭제 (M74)

- Status: accepted
- Date: 2026-07-10
- Owner decision: 완전 삭제 (archive/ 격리 대신; git history + 이 ADR이 기록을 보존)

## Context

2026-07-10 Objective 재정의로 Askewly Command는 "개인용 Google 생태계 기반 대시보드"가 됐다. H3(google-workspace-rebuild)에서 데이터 층(M70-M71), 위젯(M72, `widget/`), 모바일(M73, `mobile-v2/`)이 전부 Google Workspace 기반으로 재작성됐고, Supabase 프로젝트는 M69 마이그레이션(103 Tasks + 4 Calendar events, private ledger) 이후 paused 상태다. Supabase 시대 코드는 실행 불능(half-dead) 상태로 repo에 남아 있었다.

## Decision

Supabase-era 표면을 repo에서 완전 삭제한다:

- **Legacy 위젯**: 루트 `main.js`, `preload.js`, `renderer/`, `main/`(sources: cloud-auth, cloud-schedule-source, calendar-source, projects-source)
- **Legacy 모바일**: `mobile/` (Expo + Supabase Auth), 루트 `babel.config.js`, `scripts/generate-mobile-icons.py`
- **Supabase 스키마/클라이언트**: `supabase/`(migrations), `scripts/lib/askewly-cloud.js`, `@supabase/supabase-js` 의존성
- **Shared contracts**: `shared/` (사용처가 legacy 표면과 Supabase-era verifier뿐)
- **Supabase-era scripts**: seed/export/audit/verify 계열 27개 (`seed-project-context`, `export-cloud-schedule-for-cron`, `export-supabase-for-google-workspace`, `verify-desktop-*`, `verify-supabase-*`, `verify-rls-isolation`, `verify-daily-rollover`, `verify-shared-task-contract`, `verify-mobile-shared-contract`, `verify-project-*`, `verify-command-*`, `verify-cross-device-sync`, `verify-agent-command-intake`, capture-preview 3종, `test-schedule-interactions` 등)
- **Legacy 위젯 부속 인프라**: heartbeat watchdog(`watchdog.ps1`, `install-watchdog.ps1`, `run-watchdog-hidden.vbs` — 위젯 v2는 heartbeat를 쓰지 않고 스케줄러 task도 미설치), `server/`(cloudflared tunnel 잔재, untracked), 부팅 체인의 `ensure-vault-mount.ps1` 호출 블록
- **CLI Supabase 경로**: `askewly auth *`, `askewly projects seed` 명령 및 Supabase REST CRUD (changeset `20260710-cli-google-only`, S1)

유지하는 것:

- M65-M69 마이그레이션의 **offline** 도구(`google-workspace-migration-dry-run/import`, `migrate-deadlines-to-calendar` + verifier) — Supabase 클라이언트 의존이 없고 마이그레이션 감사 추적의 일부
- `data/google-workspace-migration/` private ledger (gitignored, 로컬 보존)
- Supabase 프로젝트 자체는 **paused 보존** — 삭제하지 않음(과거 데이터 원본). 단 코드 재연동 금지
- ADR 0001~0006 등 Supabase 시대 기록 문서 — record는 동결 보존(수정 금지)

## Consequences

- repo의 실행 코드 표면 = `widget/` + `mobile-v2/` + `scripts/`(Google-only) + `web/` 뿐. "half-dead 코드 0" 상태로 H3 legacy hygiene 기준 충족.
- M4 OpenClaw cron이 쓰던 `npm run export:cloud-schedule`는 제거됨 — cron이 일정 컨텍스트를 다시 필요로 하면 Google 데이터 기반으로 재설계해야 한다.
- 과거 코드가 필요하면 git history(`git log --diff-filter=D`)와 BACKLOG/evidence 문서로 추적한다.
