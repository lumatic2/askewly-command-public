# Askewly Command Widget v2 — Design (M72)

> 2026-07-10 owner 확정. 새 위젯(`widget/`)의 디자인 SSOT. 루트 `DESIGN.md`는 legacy/웹 표면용 — 이 파일과 무관.

## 방향

우측 세로 모니터에 상시 떠 있는 **오늘 중심 단일 컬럼** companion. 화려한 대시보드가 아니라 "오늘 실행할 것"을 조용히 계속 보여주는 표면. 정보는 위→아래 우선순위: 오늘 일정(Calendar) → Today 할일 → 임박 Deadlines → 핀 프로젝트(최소).

## 확정 결정 (owner, 2026-07-10)

- 레이아웃: 오늘 중심 단일 컬럼 (탭/카드 그리드 아님)
- 상호작용: **풀 CRUD** — 추가·완료·미루기·제목/상세/마감 편집·섹션 이동·프로젝트 라벨
- Projects: 최소 표시 (핀 프로젝트 컴팩트 목록 + 할일의 project 라벨)
- 테마: **다크 고정**
- 포인트 컬러: **앰버**
- 타이포: **Pretendard(로컬 번들) + 컴팩트 밀도**

## 토큰

```css
:root {
  /* surface */
  --bg: #0c0d10;          /* 위젯 배경 */
  --bg-raised: #14161b;   /* 카드/입력/호버 */
  --border: #23262d;      /* hairline 경계 */

  /* text */
  --text: #e8eaed;
  --text-dim: #9aa0a8;    /* 보조(시간·라벨·메타) */
  --text-faint: #5c6370;  /* 완료·placeholder */

  /* accent (amber) */
  --accent: #f5a524;      /* 지금/진행/포커스 */
  --accent-soft: rgba(245, 165, 36, 0.14);

  /* semantic */
  --danger: #f0524f;      /* D-day 임박(D-1 이하)·에러 */
  --ok: #4cc38a;          /* 완료 체크 */

  /* type */
  --font: 'Pretendard', 'Segoe UI', sans-serif;
  --fs-section: 11px;     /* 섹션 라벨(대문자, letter-spacing 0.08em) */
  --fs-body: 13px;        /* 항목 본문 */
  --fs-meta: 11px;        /* 시간·D-day·project 라벨 */
  --lh: 1.35;             /* 컴팩트 */

  /* space */
  --gap-item: 6px;
  --gap-section: 14px;
  --pad-x: 12px;
  --radius: 6px;
}
```

## 규칙

- 완료 항목: `--text-faint` + 취소선, 섹션 하단으로.
- D-day: D-1 이하 `--danger`, D-3 이하 `--accent`, 그 외 `--text-dim`.
- 현재 시각 근접 일정(±30분): 좌측 `--accent` 바 + `--accent-soft` 배경.
- 상호작용은 인라인: 항목 클릭=완료 토글, 우측 hover 액션(미루기·편집), 상단 quick-add 입력 1개. 모달 최소화.
- Optimistic UI: 조작 즉시 반영 후 백그라운드 sync, 실패 시 롤백+토스트 (owner 선호).
- 아이콘: inline SVG(lucide 스타일, `stroke: currentColor`), CSS 도형 아이콘 금지.
- 애니메이션: 완료 토글·항목 진입 120ms ease-out 정도만. 상시 표시 표면에서 시선 끌기 금지.

## 2026-07-10 폴리싱 (owner 요청)

M72 완료 이후 owner가 요청한 4가지 유지보수 폴리싱. milestone 상태는 변경하지 않고 changeset으로 기록.

- **헤더 드래그 이동**: `#header`에 `-webkit-app-region: drag`. 헤더 내부 상호작용 요소(`.header-controls`의 설정/끄기 버튼)는 `-webkit-app-region: no-drag`로 예외 처리. quick-add는 헤더 밖(TODAY 섹션)이라 영향 없음. 창은 계속 `resizable: true`.
- **헤더 우측 컨트롤**: 인라인 SVG 아이콘 버튼 2개(설정=gear, 끄기=x), 14-15px, `--text-dim` 기본 → hover 시 `--text` + `--bg-raised` 배경. 끄기는 IPC `widget:quit` → main.js `app.quit()`. `widget:quit`, `widget:set-always-on-top`을 `main.js`/`preload.js` 화이트리스트에 추가.
- **설정 팝오버**: gear 클릭으로 토글되는 절대 위치 팝오버(`--bg-raised`, border, radius, shadow), 바깥 클릭·Esc로 닫힘.
  - **글자 크기**: 4단계 세그먼트 버튼(작게 0.85 / 기본 1.0 / 크게 1.15 / 더 크게 1.3). `document.body.style.zoom`으로 전체 px 토큰을 함께 스케일. `localStorage['widget.uiScale']`에 저장, 부팅 시 복원.
  - **항상 위**: 토글 스위치 → IPC `widget:set-always-on-top`(boolean) → `mainWindow.setAlwaysOnTop(v)`. `localStorage['widget.alwaysOnTop']`에 저장(기본 true), 부팅 시 IPC로 재적용.
- **좌측 네비게이션 레일**: 40px 고정 아이콘 레일(`--bg-raised` 배경, `--border` 우측 경계), 전체 높이. 3개 뷰 전환(오늘=sun / 백로그=inbox / 프로젝트=folder), 활성 아이콘은 앰버 + 좌측 인디케이터 바. 마지막 뷰는 `localStorage['widget.view']`에 저장. 콘텐츠 영역은 420px 창에서 레일 40px을 뺀 ~380px — 오버플로 없이 확인됨.
  - **오늘 뷰**: 기존 today-first 컬럼(일정/TODAY/DEADLINES/핀 프로젝트) 그대로.
  - **백로그 뷰**: TaskRow와 동일한 어포던스(체크박스 토글·편집) + quick-add(백로그 대상) + "오늘로" 이동 액션(defer-tomorrow/backlog 대신).
  - **프로젝트 뷰**: 읽기 전용. 핀 프로젝트를 📌 앰버 강조로 먼저, 이후 비-archived 프로젝트를 이름+status로 나열. 데이터는 snapshot의 신규 `projects` 필드(catalog `listProjects()` 비-archived, 정렬됨).

## 2026-07-10 폴리싱 round 2 (owner 요청, M72 maintenance)

milestone 상태는 여전히 변경하지 않음. changeset: `changesets/20260710-widget-polish-round2/`.

- **호버 지터 수정**: `.row-actions`(task/deadline)와 신규 `.event-row-actions`가 `display:none ↔ flex` 토글 때문에 row 높이가 늘었다 줄었다 하던 게 원인. 항상 flex로 DOM에 존재시키고 `opacity: 0 ↔ 1` + `pointer-events: none ↔ auto`만 hover/focus-within에서 바꾸도록 변경 — 호버 시 paint(배경색·opacity)만 바뀌고 레이아웃은 절대 변하지 않는다. 정적 fixture(실제 style.css + 샘플 row 마크업)를 헤드리스 브라우저로 열어 hover 전/후 `getBoundingClientRect()`를 비교해 완전히 동일함을 확인했다(row/`.task-title`/`.event-title` 모두 픽셀 단위로 불변).
- **레일 라벨**: 아이콘 아래 `.rail-label`(오늘/백로그/프로젝트, `--fs-meta`, 비활성 dim/활성 앰버 — 색은 `.rail-btn`에서 상속) 추가. 레일 폭 40px → 60px, `.rail-btn` 40→52px(세로 flex-column). 500px 기본 창에서 콘텐츠 컬럼은 380px → 440px로 줄지만 오버플로 없음(코드 리뷰 + fixture 지오메트리 확인, 실측 스크린샷은 owner의 위젯 인스턴스가 이미 실행 중이라 생략).
- **일정 편집/삭제**: 일정(Calendar) 행에 hover 액션(편집·삭제) 추가 — task/deadline과 동일한 opacity 리저브 패턴이라 지터 없음.
  - 편집: 인라인 폼(제목 + 시작/종료 HH:mm). 종일/진행중(멀티데이 ) 일정은 시간 필드 없이 제목만.
  - 삭제: 첫 클릭 시 아이콘이 3초짜리 `삭제?` 확인 버튼으로 바뀌고(`.action-btn.is-confirm-delete`), 그 안에 다시 클릭해야 실제 삭제.
  - `widget/data-service.js`: `eventUpdate({ id, summary, startIso, endIso })` → `gws calendar events patch`, `eventDelete({ id })` → `gws calendar events delete`. calendarId는 `primary` 고정, `sendUpdates:'none'`. 시간은 렌더러가 오늘 날짜 + HH:mm으로 조립한 `+09:00` RFC3339 문자열을 그대로 `dateTime`에 넣는다(재파싱 없음). 제목만 바꿀 때는 `start`/`end`를 body에서 생략.
  - IPC: `widget:event-update`, `widget:event-delete`를 `main.js` 핸들러 + `preload.js` 화이트리스트에 추가.
  - 렌더러: optimistic 반영 + 실패 시 롤백 + 토스트(기존 task 패턴과 동일한 모양, 다만 이벤트는 `state.js`의 순수 리듀서 대상이 아니라 `app.js`에서 직접 배열 스냅샷 교체로 처리).

## 2026-07-10 폴리싱 round 3 (owner 요청, M72 maintenance)

milestone 상태는 여전히 변경하지 않음. changeset: `changesets/20260710-widget-ux-round3/`.

- **일정 상세보기**: 오늘 뷰의 일정 행을 클릭(편집/삭제 버튼 제외)하면 in-column expanding card가 행 바로 아래에 열린다(설정 팝오버와 별개의 절대위치 오버레이 대신, 500px 창 폭에 더 맞는 인라인 확장 방식 선택). 제목·날짜/시간(종일·진행중 표기 포함)·장소·메모를 보여주고, 값이 없는 필드는 조용히 생략한다. 캘린더 이름은 표시하지 않는다 — `gws calendar events list`가 기본으로 주는 payload에 없고, 추가하려면 이벤트/목록 호출마다 `calendarList.get` 한 번을 더 태워야 해서(비용 대비 이득이 낮음) 이번 라운드에서는 "부재 필드는 조용히 생략" 원칙을 그대로 적용해 없는 필드로 취급한다.
- **일정 편집 확장**: 인라인 편집 폼에 장소(텍스트) + 메모(textarea, 2행) 필드 추가. `widget/data-service.js#eventUpdate`가 `location`/`description`을 받아 `gws calendar events patch` body에 그대로 실어 보낸다(빈 문자열도 유효한 값이라 기존 값을 지울 수 있음). `listTodayEvents`/`eventsRange` 모두 공용 `eventRow()` 매핑을 거치며, 이 매핑이 `location`/`description`을 스냅샷에 실어 나른다.
- **DEADLINES 섹션 제거**: deadline 항목은 이미 Google Calendar로 이관되어 리스트가 비어 있었다. `widget/data-service.js#buildSnapshot`에서 `tasks.deadlines` 페치를 제거했고(CLI `askewly tasks ...`의 deadlines 섹션 자체는 그대로 유지), 렌더러의 DEADLINES 렌더링 경로(`renderDeadlines`/`renderDeadlineRow`/`ddayInfo`, D-day 배지 CSS, `#section-deadlines` 마크업)를 전부 제거했다. D-day 배지는 부활시키지 않는다 — 달력 탭이 미래 일정을 이미 커버한다.
- **"내일로" 버튼 제거**: Today 행에서 "내일로"(defer-tomorrow) 액션을 제거했다(Supabase 시절 `scheduled_for` 유예 개념의 잔재). "백로그로"는 유지. 백로그 뷰의 "오늘로"도 그대로 유지.
- **진행(doing) 상태**: task 3번째 상태 `doing`을 Askewly metadata block에만 저장한다(Google 쪽 `status`는 계속 `needsAction` — `googleStatus()`가 `done`/`archived`만 `completed`로 매핑해 이미 임의 상태 문자열을 받아들인다). 체크박스 클릭은 todo↔done 순환 그대로 유지, 새 hover 액션 "진행"이 todo↔doing을 토글한다. IPC는 새 op를 추가하지 않고 기존 `widget:task-toggle`(이미 `flags.status`를 그대로 받는 범용 채널)을 재사용한다 — `data-service.js#taskToggle`이 이미 `setTaskStatus({ id, status })`를 그대로 위임하고 있어서다. 렌더링: doing 행은 왼쪽 앰버 인디케이터 바 + 앰버 체크박스 링, 정렬은 doing이 todo보다 위(done은 계속 맨 아래) — `app.js#todayRank()`.
- **달력 탭**: nav rail 4번째 뷰(순서: 오늘/달력/백로그/프로젝트, 세로 스택 레일이라 폭 변화 없음). Google Calendar 스타일 7열 월간 그리드(KST), 셀마다 종일 일정 우선 + 최대 3개 제목 스니펫 + `+N` overflow, 오늘 앰버 강조, 이전/다음 달 화살표 + "오늘" 버튼. 데이터: 신규 op `eventsRange({ timeMinIso, timeMaxIso })`가 `widget/data-service.js`에서 월 키(`timeMinIso|timeMaxIso`)당 5분 캐시로 gws 호출을 줄인다 — `gws-worker.js` op map, `main.js` IPC 핸들러(`widget:events-range`), `preload.js` 화이트리스트에 각각 추가. 날짜 클릭 시 그리드 아래에 그 날의 일정 목록이 펼쳐지고(day detail), 각 행 클릭은 오늘 뷰와 동일한 `renderEventDetail()` 상세 카드를 재사용한다. 이번 라운드는 읽기 전용 — day detail 행에는 편집 폼을 붙이지 않았다(비용 대비 이번 스코프에 필수는 아니라 판단, 편집은 오늘 뷰에만 유지).
