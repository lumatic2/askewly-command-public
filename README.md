# Askewly Command

> 데스크톱 위젯, Expo 모바일 앱, 에이전트용 CLI가 같은 Supabase 일정·프로젝트 그래프를 공유하는 개인용 커맨드 센터입니다.

## 포트폴리오 요약

Askewly Command는 작업 맥락이 캘린더, GitHub, 로컬 프로젝트, 메모, AI 코딩 세션에 흩어지는 문제를 다룹니다. 핵심은 단순 todo 앱이 아니라 **PC 위젯, 모바일 앱, AI 에이전트 세션이 같은 작업 상태를 보고 조작하는 구조**입니다.

- **케이스 스터디**: [`docs/portfolio-case-study-m52.md`](docs/portfolio-case-study-m52.md)
- **데모 스크립트**: [`docs/portfolio-demo-script-m52.md`](docs/portfolio-demo-script-m52.md)
- **핵심 차별점**: Codex/Claude Code가 자연어 요청을 검증된 `askewly` CLI 명령으로 바꿔 같은 task workspace를 업데이트합니다. 에이전트가 DB에 직접 쓰지 않고 앱 계약을 통과합니다.
- **현재 경계**: 개인용 command center가 우선입니다. 스토어 배포, 팀 공유, 결제, public task API는 의도적으로 제외했습니다.

## 무엇을 만들었나

작업과 프로젝트 컨텍스트는 Supabase workspace에 저장됩니다. Electron 데스크톱 위젯, Expo 모바일 앱, `askewly` CLI는 같은 애플리케이션 계약을 사용해 Today, Deadlines, Backlog, Project link를 읽고 씁니다.

이 repo는 공개 포트폴리오용 snapshot입니다. 원본 private repo의 히스토리, 개인 운영 로그, local QA 산출물은 포함하지 않았습니다.

## 구조

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

GitHub, Google Calendar, Notion, private vault adapter 같은 주변 소스는 작업 맥락을 보강하는 역할입니다. active schedule의 기본 write path는 Supabase이고, legacy markdown schedule은 import/fallback 용도입니다.

## 주요 표면

| 표면 | 역할 |
|---|---|
| Electron 데스크톱 위젯 | PC에서 항상 보이는 일정, command overview, status surface |
| Expo 모바일 앱 | Today, Deadlines, Backlog, Focus review, 상태 변경, 프로젝트 연결 |
| `askewly` CLI | Codex/Claude Code 세션에서 쓰는 로컬 command surface |
| Public web | private task API 없이 제품을 설명하는 landing page |

## 에이전트 CLI

Windows 전역 shim 설치:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-askewly-cli.ps1
```

사용 예:

```powershell
askewly projects list
askewly tasks recent --limit 5
askewly tasks list --section today --limit 10
askewly tasks search --query "포트폴리오" --limit 10
askewly tasks add --title "포트폴리오 데모 마감" --section deadlines --due "2026-06-25 18:00" --project "Askewly Command"
askewly tasks update --id 431 --due "2026-06-26"
askewly tasks move --id 431 --section backlog
askewly tasks status --id 431 --status done
```

`--due`는 `YYYY-MM-DD`, `YYYY-MM-DD HH:mm`, ISO datetime을 받습니다. 날짜만 넣으면 KST 23:59로 처리합니다.

## 실행

데스크톱 앱:

```powershell
npm install
npm start
```

모바일 앱:

```powershell
cd mobile
npm install
npm run typecheck
```

공개 준비 검증:

```powershell
npm run verify:public-readiness
```

## 더 보기

- [`docs/portfolio-case-study-m52.md`](docs/portfolio-case-study-m52.md) — 포트폴리오 케이스 스터디
- [`docs/portfolio-demo-script-m52.md`](docs/portfolio-demo-script-m52.md) — 짧은 데모 스크립트
- [`docs/PRD.md`](docs/PRD.md) — 제품 요구사항
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — 아키텍처 노트
- [`docs/onboarding.md`](docs/onboarding.md) — cloud mode 온보딩
- [`docs/credential-checklist.md`](docs/credential-checklist.md) — Supabase/OAuth/native credential 체크리스트
