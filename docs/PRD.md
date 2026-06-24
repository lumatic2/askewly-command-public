# PRD

## 목표

Askewly Command를 개인용 로컬 위젯에서 계정 기반 작업 허브로 전환한다. 사용자는 모바일 앱과 PC 위젯에서 같은 Today, Deadlines, Backlog 상태를 보고 빠르게 갱신할 수 있어야 한다.

## 사용자

- 개인 생산성 사용자: 하루 작업, 마감, 백로그를 모바일과 PC에서 계속 갱신하는 사용자.
- 제3자 초기 사용자: 로컬 vault/M4 환경 없이 Google 또는 Kakao 로그인만으로 같은 대시보드 경험을 쓰고 싶은 사용자.

## 핵심 기능 (MVP)

1. Expo React Native 모바일 앱에서 Google/Kakao OAuth로 로그인한다.
2. Supabase cloud mode에서 Today, Deadlines, Backlog CRUD를 제공한다.
3. Electron PC 위젯은 기존 legacy local mode를 유지하면서 Supabase cloud mode를 선택할 수 있다.
4. Supabase RLS로 workspace/task/source 데이터가 사용자별로 격리된다.
5. 기존 PWA/M4/vault sync는 개인 legacy path로 보존하고 신규 사용자 onboarding path와 섞지 않는다.

## Project Context and Agent Intake

- Projects are first-class task context, not a heavyweight portfolio database.
- The initial project record only needs `name`, `description`, and `github_url`; richer fields remain optional editing metadata.
- Codex/Claude Code sessions may create or update Schedule/Projects through an authenticated local command interface.
- Agents must call the same application-level contracts used by the product or a thin verified wrapper around those contracts. They must not write arbitrary SQL into Supabase.
- Natural language stays outside the trusted boundary: the agent interprets "오늘 교수님 메일 추가해줘" into an explicit command payload, then the command layer validates section, project, status, and required identifiers.

## Daily Task Semantics

- PC 위젯과 모바일 앱의 완료 액션은 같은 의미를 가져야 한다.
- `done`은 사용자가 작업을 완료했다는 상태다. 완료 직후의 확인 가능성과 cross-device sync 검증을 위해 archive와 분리한다.
- `archived`는 active Today/Deadlines/Backlog 목록에서 빠진 보관 상태다. 사용자가 명시적으로 보관하거나 일 단위 rollover가 완료 task를 보관할 때 사용한다.
- Today는 `scheduled_for` 날짜 기준으로 표시한다. 기본 화면은 한국 시간 기준 오늘 날짜의 Today task를 보여준다.
- 과거 날짜의 Today task 중 `todo` 또는 `doing`은 오늘 Today로 자동 이월한다.
- 과거 날짜의 Today task 중 `done`은 완료 아카이브로 이동해 active Today에서 숨긴다.

## MVP 제외 사항

- 팀 협업/공유 권한: 1인 workspace의 auth/data contract가 안정된 뒤 추가한다.
- 결제/구독: 사용성 검증 전 수익화 표면을 만들지 않는다.
- 완전한 vault 동기화 대체: cloud mode가 검증되기 전 기존 M4/vault sync를 제거하지 않는다.
- App Store/TestFlight/Play Store 정식 배포 자동화: M3 smoke 이후 별도 milestone으로 둔다.
- Public unauthenticated task/project APIs: 개인 일정 변경은 local authenticated CLI 또는 signed user/server credentials만 허용한다.

## 성공 지표

- 신규 사용자가 OAuth 로그인 후 3분 안에 첫 backlog item을 추가한다.
- 모바일 앱과 PC 위젯 사이에서 task 생성/수정/완료가 5초 안에 반영된다.
- PC와 모바일에서 완료한 task가 같은 cloud status로 관찰된다.
- 과거 미완료 Today task는 rollover 후 오늘 Today에 남고, 과거 완료 Today task는 active Today에서 사라진다.
- legacy mode smoke와 cloud mode smoke가 같은 release에서 모두 통과한다.
- RLS 검증에서 다른 사용자의 workspace/task row를 읽거나 수정할 수 없다.

## Credential Blockers

실제 값은 문서나 git에 기록하지 않는다. 구현 단계에서는 `.env` 또는 secure secret store만 사용한다.

- Supabase project URL
- Supabase anon key
- Supabase service role key (migration/admin 작업 전용, 클라이언트 금지)
- Google OAuth web/iOS/Android client credentials
- Kakao REST API key and client secret
- Native deep link scheme and redirect URI allowlist
