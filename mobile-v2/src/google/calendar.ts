/**
 * Google Calendar data layer. Event row shape + KST day-bounds math ported
 * 1:1 from `widget/data-service.js` (eventRow, kstDayBoundsIso) so the
 * mobile app, widget, and CLI agree on what "today" and "all-day" mean.
 */
import { googleGet, type GoogleClientOptions } from "./client";

export type CalendarEvent = {
  id: string;
  summary: string;
  start: string | null; // RFC3339 dateTime, or YYYY-MM-DD for all-day
  end: string | null;
  allDay: boolean;
  location: string | null;
  description: string | null;
  htmlLink: string | null;
};

type RawEvent = {
  id: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  location?: string;
  description?: string;
  htmlLink?: string;
};

export function eventRow(event: RawEvent): CalendarEvent {
  return {
    id: event.id,
    summary: event.summary || "(제목 없음)",
    start: event.start?.dateTime || event.start?.date || null,
    end: event.end?.dateTime || event.end?.date || null,
    allDay: !event.start?.dateTime,
    location: event.location || null,
    description: event.description || null,
    htmlLink: event.htmlLink || null,
  };
}

// KST = UTC+9, no DST.
export function kstDayBoundsIso(date: Date = new Date()): {
  dateStr: string;
  timeMin: string;
  timeMax: string;
} {
  const kstNow = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const dateStr = kstNow.toISOString().slice(0, 10);
  return {
    dateStr,
    timeMin: `${dateStr}T00:00:00+09:00`,
    timeMax: `${dateStr}T23:59:59+09:00`,
  };
}

/** KST calendar-month bounds for the 달력 grid. `yearMonth` is "YYYY-MM". */
export function kstMonthBoundsIso(yearMonth: string): { timeMin: string; timeMax: string } {
  const [year, month] = yearMonth.split("-").map(Number);
  if (!year || !month || month < 1 || month > 12) {
    throw new Error(`Invalid yearMonth: ${yearMonth} (expected "YYYY-MM")`);
  }
  const firstDay = `${yearMonth}-01`;
  // Date.UTC(year, month, 0) is day 0 of the 0-based month `month` (== next
  // calendar month, since `month` is already 1-based) — i.e. the last day
  // of the *current* month.
  const lastDayNum = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lastDay = `${yearMonth}-${String(lastDayNum).padStart(2, "0")}`;
  return {
    timeMin: `${firstDay}T00:00:00+09:00`,
    timeMax: `${lastDay}T23:59:59+09:00`,
  };
}

export async function listEventsInRange(
  timeMinIso: string,
  timeMaxIso: string,
  opts: GoogleClientOptions,
): Promise<CalendarEvent[]> {
  const params = new URLSearchParams({
    timeMin: timeMinIso,
    timeMax: timeMaxIso,
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "250",
  });
  const res = await googleGet<{ items?: RawEvent[] }>(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`,
    opts,
  );
  return (res.items || []).map(eventRow);
}

export async function listTodayEvents(opts: GoogleClientOptions): Promise<CalendarEvent[]> {
  const { timeMin, timeMax } = kstDayBoundsIso();
  return listEventsInRange(timeMin, timeMax, opts);
}

export async function listMonthEvents(
  yearMonth: string,
  opts: GoogleClientOptions,
): Promise<CalendarEvent[]> {
  const { timeMin, timeMax } = kstMonthBoundsIso(yearMonth);
  return listEventsInRange(timeMin, timeMax, opts);
}

/** All-day, or a timed event spanning multiple days that is already running on `dateStr` (KST "YYYY-MM-DD"). */
export function isAllDayOrOngoing(event: CalendarEvent, dateStr: string): boolean {
  if (event.allDay) return true;
  if (!event.start || !event.end) return false;
  const startDate = event.start.slice(0, 10);
  const endDate = event.end.slice(0, 10);
  return startDate < dateStr && endDate >= dateStr;
}

/** True if `now` falls within `windowMinutes` of the event's start or end (or during it) — drives the ±30분 앰버 하이라이트. */
export function isEventNearNow(
  event: CalendarEvent,
  now: Date = new Date(),
  windowMinutes = 30,
): boolean {
  if (event.allDay || !event.start || !event.end) return false;
  const start = new Date(event.start).getTime();
  const end = new Date(event.end).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return false;
  const windowMs = windowMinutes * 60 * 1000;
  const t = now.getTime();
  return t >= start - windowMs && t <= end + windowMs;
}
