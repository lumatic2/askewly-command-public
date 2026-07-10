/**
 * DEV-only mock data provider — same shapes as the real Google data layer
 * (TaskRow / CalendarEvent / CatalogProject), used ONLY when
 * `EXPO_PUBLIC_MOCK_DATA=1` so the 4 tabs can be screenshot-QA'd before
 * Google OAuth propagation finishes. Never imports auth; index.ts decides
 * whether to call this instead of the network based on the env flag alone.
 */
import type { TaskRow } from "./tasks";
import type { CalendarEvent } from "./calendar";
import type { CatalogProject } from "./sheets";
import { kstDayBoundsIso } from "./calendar";

function todayAt(hh: number, mm: number): string {
  const { dateStr } = kstDayBoundsIso();
  return `${dateStr}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00+09:00`;
}

export function mockTodayEvents(): CalendarEvent[] {
  const { dateStr } = kstDayBoundsIso();
  return [
    {
      id: "mock-ev-allday",
      summary: "분기 회고 (종일)",
      start: dateStr,
      end: dateStr,
      allDay: true,
      location: null,
      description: null,
      htmlLink: null,
    },
    {
      id: "mock-ev-ongoing",
      summary: "포트폴리오 스냅샷 갱신 (3일 진행)",
      start: `${dateStr}T00:00:00+09:00`,
      end: todayAt(23, 59),
      allDay: false,
      location: null,
      description: "여러 날짜에 걸친 진행 중 이벤트",
      htmlLink: null,
    },
    {
      id: "mock-ev-1",
      summary: "팀 스탠드업",
      start: todayAt(9, 30),
      end: todayAt(9, 45),
      allDay: false,
      location: null,
      description: null,
      htmlLink: null,
    },
    {
      id: "mock-ev-now",
      summary: "디자인 리뷰 (지금)",
      start: todayAt(new Date().getHours(), Math.max(0, new Date().getMinutes() - 5)),
      end: todayAt(new Date().getHours(), Math.min(59, new Date().getMinutes() + 25)),
      allDay: false,
      location: "회의실 A",
      description: "±30분 앰버 하이라이트 확인용",
      htmlLink: null,
    },
    {
      id: "mock-ev-2",
      summary: "고객 콜",
      start: todayAt(15, 0),
      end: todayAt(15, 30),
      allDay: false,
      location: null,
      description: null,
      htmlLink: null,
    },
  ];
}

export function mockTodayTasks(): TaskRow[] {
  return [
    {
      id: "mock-t-1",
      title: "M73 S3 스크린샷 QA 정리",
      detail: "",
      status: "doing",
      due_at: null,
      scheduled_for: null,
      section: "today",
      project_name: "Askewly Command",
      tasklist_id: "mock-today",
      tasklist_title: "Askewly Today",
      updated_at: null,
    },
    {
      id: "mock-t-2",
      title: "OAuth 콘솔 client ID 상태 확인",
      detail: "",
      status: "todo",
      due_at: null,
      scheduled_for: null,
      section: "today",
      project_name: "Askewly Command",
      tasklist_id: "mock-today",
      tasklist_title: "Askewly Today",
      updated_at: null,
    },
    {
      id: "mock-t-3",
      title: "어제 로그 리뷰",
      detail: "",
      status: "todo",
      due_at: null,
      scheduled_for: null,
      section: "today",
      project_name: null,
      tasklist_id: "mock-today",
      tasklist_title: "Askewly Today",
      updated_at: null,
    },
  ];
}

export function mockBacklog(): TaskRow[] {
  return [
    {
      id: "mock-b-1",
      title: "레거시 mobile/ 제거 여부 검토",
      detail: "",
      status: "todo",
      due_at: null,
      scheduled_for: null,
      section: "backlog",
      project_name: null,
      tasklist_id: "mock-backlog",
      tasklist_title: "Askewly Backlog",
      updated_at: null,
    },
    {
      id: "mock-b-2",
      title: "Google Sheets project catalog 스키마 정리",
      detail: "",
      status: "doing",
      due_at: null,
      scheduled_for: null,
      section: "backlog",
      project_name: "Askewly Command",
      tasklist_id: "mock-backlog",
      tasklist_title: "Askewly Backlog",
      updated_at: null,
    },
    {
      id: "mock-b-3",
      title: "위젯 애니메이션 다듬기",
      detail: "",
      status: "todo",
      due_at: null,
      scheduled_for: null,
      section: "backlog",
      project_name: null,
      tasklist_id: "mock-backlog",
      tasklist_title: "Askewly Backlog",
      updated_at: null,
    },
    {
      id: "mock-b-4",
      title: "Expo Go 테스트 노트 정리",
      detail: "",
      status: "todo",
      due_at: null,
      scheduled_for: null,
      section: "backlog",
      project_name: null,
      tasklist_id: "mock-backlog",
      tasklist_title: "Askewly Backlog",
      updated_at: null,
    },
  ];
}

export function mockProjects(): CatalogProject[] {
  return [
    {
      supabase_id: "1",
      name: "Askewly Command",
      status: "active",
      sort_order: "-1000001",
      created_at: "2026-01-01T00:00:00.000Z",
    },
    {
      supabase_id: "2",
      name: "Google Workspace 이관",
      status: "active",
      sort_order: "-1000002",
      created_at: "2026-02-01T00:00:00.000Z",
    },
    {
      supabase_id: "3",
      name: "포트폴리오",
      status: "active",
      sort_order: "1700000000",
      created_at: "2026-03-01T00:00:00.000Z",
    },
    {
      supabase_id: "4",
      name: "잡무",
      status: "active",
      sort_order: "1700000100",
      created_at: "2026-04-01T00:00:00.000Z",
    },
  ];
}

/** A handful of extra chip-worthy events on other days this month, for the 달력 grid. */
export function mockMonthEvents(yearMonth: string): CalendarEvent[] {
  const [year, month] = yearMonth.split("-").map(Number);
  const day = (d: number) => `${yearMonth}-${String(d).padStart(2, "0")}`;
  const chipDay = (d: number, n: number): CalendarEvent[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `mock-month-${d}-${i}`,
      summary: `일정 ${d}-${i + 1}`,
      start: day(d),
      end: day(d),
      allDay: true,
      location: null,
      description: null,
      htmlLink: null,
    }));
  return [
    ...mockTodayEvents(),
    ...chipDay(3, 1),
    ...chipDay(10, 4),
    ...chipDay(18, 2),
    ...chipDay(24, 3),
  ].filter((e) => {
    const d = new Date(`${e.start}T00:00:00+09:00`);
    return d.getUTCFullYear() === year && d.getUTCMonth() + 1 === month;
  });
}
