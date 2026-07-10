/**
 * Public data-layer entry point for the 4 tabs. Wraps the Tasks/Calendar/Sheets
 * modules with an in-memory 5-minute cache + stale-fallback-on-error, and
 * (DEV-only) a mock-data bypass gated on `EXPO_PUBLIC_MOCK_DATA=1` so the UI
 * can be screenshot-QA'd while Google OAuth propagation is pending — the
 * mock path never touches auth, it just returns fixture data shaped like the
 * real rows.
 */
import { getValidAccessToken } from "../auth/googleAuth";
import type { GoogleClientOptions } from "./client";
import {
  listTasksForSection,
  sortDoingFirst,
  addTask as addTaskRaw,
  updateTask as updateTaskRaw,
  toggleTask as toggleTaskRaw,
  setDoing as setDoingRaw,
  moveTask as moveTaskRaw,
  type TaskRow,
  type Section,
  type TaskWriteInput,
} from "./tasks";
import { listTodayEvents, listMonthEvents, kstDayBoundsIso, type CalendarEvent } from "./calendar";
import { getCatalogProjects, type CatalogProject } from "./sheets";
import { TtlCache, type Fetched } from "./cache";
import * as mock from "./mockProvider";

const CACHE_TTL_MS = 5 * 60 * 1000;

const USE_MOCK_DATA = process.env.EXPO_PUBLIC_MOCK_DATA === "1";

export type TodaySnapshot = {
  dateStr: string;
  events: CalendarEvent[];
  tasks: TaskRow[];
};

export type { Fetched };

function defaultOpts(): GoogleClientOptions {
  return { getToken: (forceRefresh?: boolean) => getValidAccessToken(forceRefresh) };
}

const cache = new TtlCache(CACHE_TTL_MS);

/** Exposed for tests and for sign-out (stale data from a previous account must not leak). */
export function clearGoogleDataCache(): void {
  cache.clear();
}

function withCache<T>(key: string, fetcher: () => Promise<T>): Promise<Fetched<T>> {
  return cache.get(key, fetcher);
}

export async function getTodaySnapshot(opts: GoogleClientOptions = defaultOpts()): Promise<Fetched<TodaySnapshot>> {
  if (USE_MOCK_DATA) {
    const { dateStr } = kstDayBoundsIso();
    return { data: { dateStr, events: mock.mockTodayEvents(), tasks: sortDoingFirst(mock.mockTodayTasks()) }, stale: false };
  }
  return withCache("today", async () => {
    const [events, tasks] = await Promise.all([listTodayEvents(opts), listTasksForSection("today", opts)]);
    return { dateStr: kstDayBoundsIso().dateStr, events, tasks: sortDoingFirst(tasks) };
  });
}

export async function getMonthEvents(
  yearMonth: string,
  opts: GoogleClientOptions = defaultOpts(),
): Promise<Fetched<CalendarEvent[]>> {
  if (USE_MOCK_DATA) {
    return { data: mock.mockMonthEvents(yearMonth), stale: false };
  }
  return withCache(`month:${yearMonth}`, () => listMonthEvents(yearMonth, opts));
}

export async function getBacklog(opts: GoogleClientOptions = defaultOpts()): Promise<Fetched<TaskRow[]>> {
  if (USE_MOCK_DATA) {
    return { data: sortDoingFirst(mock.mockBacklog()), stale: false };
  }
  return withCache("backlog", async () => sortDoingFirst(await listTasksForSection("backlog", opts)));
}

export async function getProjects(opts: GoogleClientOptions = defaultOpts()): Promise<Fetched<CatalogProject[]>> {
  if (USE_MOCK_DATA) {
    return { data: mock.mockProjects(), stale: false };
  }
  return withCache("projects", () => getCatalogProjects(opts));
}

export type { TaskRow, CalendarEvent, CatalogProject, Section, TaskWriteInput };

// ---------------------------------------------------------------------------
// Write ops (M73 S4). Same "no-op cache" contract as the other mutations in
// this app: a write clears the whole in-memory cache so the next fetch (pull
// -to-refresh or tab focus) sees fresh server state. Optimistic UI + rollback
// lives in the screens/hooks that call these, not here.
// ---------------------------------------------------------------------------

export async function addTaskToSection(
  section: Section,
  input: TaskWriteInput,
  opts: GoogleClientOptions = defaultOpts(),
): Promise<TaskRow> {
  const row = await addTaskRaw(section, input, opts);
  cache.clear();
  return row;
}

export async function updateTaskFields(
  row: TaskRow,
  patch: TaskWriteInput,
  opts: GoogleClientOptions = defaultOpts(),
): Promise<TaskRow> {
  const updated = await updateTaskRaw(row, patch, opts);
  cache.clear();
  return updated;
}

export async function toggleTaskDone(
  row: TaskRow,
  opts: GoogleClientOptions = defaultOpts(),
): Promise<TaskRow> {
  const updated = await toggleTaskRaw(row, opts);
  cache.clear();
  return updated;
}

export async function toggleTaskDoing(
  row: TaskRow,
  opts: GoogleClientOptions = defaultOpts(),
): Promise<TaskRow> {
  const updated = await setDoingRaw(row, opts);
  cache.clear();
  return updated;
}

export async function moveTaskToSection(
  row: TaskRow,
  targetSection: Section,
  opts: GoogleClientOptions = defaultOpts(),
): Promise<TaskRow> {
  const moved = await moveTaskRaw(row, targetSection, opts);
  cache.clear();
  return moved;
}
