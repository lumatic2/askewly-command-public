/**
 * MOCK DATA — S1 scaffold only.
 *
 * This entire module is a placeholder. It will be REPLACED in M73 step S3
 * (Tasks/Calendar/Sheets data layer) with real Google Workspace REST calls.
 * Do not build product logic against these shapes assuming they are final —
 * they exist only to render the 4 tabs for the S1 emulator smoke test.
 */

export type MockEvent = {
  id: string;
  title: string;
  startLabel: string; // pre-formatted "HH:mm" for the scaffold, real formatting lands in S3
  endLabel: string;
  isNow: boolean;
};

export type MockTask = {
  id: string;
  title: string;
  done?: boolean;
  projectLabel?: string;
};

export type MockDeadline = {
  id: string;
  title: string;
  daysLeft: number; // D-day, e.g. 0 = today, 1 = tomorrow
  projectLabel?: string;
};

export type MockProject = {
  id: string;
  name: string;
  pinned: boolean;
  taskCount: number;
};

export const mockTodayEvents: MockEvent[] = [
  { id: "ev-1", title: "팀 스탠드업", startLabel: "09:30", endLabel: "09:45", isNow: false },
  { id: "ev-2", title: "디자인 리뷰", startLabel: "11:00", endLabel: "12:00", isNow: true },
  { id: "ev-3", title: "고객 콜", startLabel: "15:00", endLabel: "15:30", isNow: false },
];

export const mockTodayTasks: MockTask[] = [
  { id: "t-1", title: "M73 스캐폴드 QA 스크린샷 정리", done: false, projectLabel: "Askewly Command" },
  { id: "t-2", title: "OAuth 콘솔 client ID 상태 확인", done: false, projectLabel: "Askewly Command" },
  { id: "t-3", title: "어제 로그 리뷰", done: true },
];

export const mockDeadlines: MockDeadline[] = [
  { id: "d-1", title: "M73 S2 착수 보고", daysLeft: 0, projectLabel: "Askewly Command" },
  { id: "d-2", title: "분기 회고 초안", daysLeft: 1 },
  { id: "d-3", title: "세무 신고 자료 취합", daysLeft: 3 },
  { id: "d-4", title: "포트폴리오 스냅샷 갱신", daysLeft: 9 },
];

export const mockBacklog: MockTask[] = [
  { id: "b-1", title: "레거시 mobile/ 제거 여부 검토" },
  { id: "b-2", title: "Google Sheets project catalog 스키마 정리", projectLabel: "Askewly Command" },
  { id: "b-3", title: "위젯 애니메이션 다듬기" },
  { id: "b-4", title: "Expo Go 테스트 노트 정리" },
];

export const mockProjects: MockProject[] = [
  { id: "p-1", name: "Askewly Command", pinned: true, taskCount: 12 },
  { id: "p-2", name: "Google Workspace 이관", pinned: true, taskCount: 4 },
  { id: "p-3", name: "포트폴리오", pinned: false, taskCount: 6 },
  { id: "p-4", name: "잡무", pinned: false, taskCount: 2 },
];
