'use strict';

// Google Workspace-backed data service for the widget v2 main process.
// Aggregates today's Calendar events + Google Tasks (3 sections) + pinned
// Google Sheets catalog projects into a single snapshot, with an in-memory
// + on-disk cache so a network/gws failure degrades to `{ stale: true }`
// instead of throwing.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { listTasks, addTask, setTaskStatus, moveTask, updateTask } = require('../scripts/lib/google-workspace-tasks');
const googleCatalog = require('../scripts/lib/google-workspace-catalog');

const CACHE_DIR = path.join(__dirname, '.cache');
const CACHE_FILE = path.join(CACHE_DIR, 'snapshot.json');

function gwsCommand() {
  if (process.env.GWS_BIN) return process.env.GWS_BIN;
  if (process.platform === 'win32' && process.env.APPDATA) {
    const installedExe = path.join(process.env.APPDATA, 'npm', 'node_modules', '@googleworkspace', 'cli', 'bin', 'gws.exe');
    if (fs.existsSync(installedExe)) return installedExe;
  }
  return 'gws';
}

function runGws(args) {
  const result = spawnSync(gwsCommand(), args, { encoding: 'utf8' });
  const stdout = String(result.stdout || '').trim();
  const stderr = String(result.stderr || '').trim();
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(stdout || stderr || `gws exited ${result.status}`);
  return stdout ? JSON.parse(stdout) : {};
}

// KST = UTC+9, no DST. Compute "today" (KST) as a date string, then bounds
// as RFC3339 timestamps with an explicit +09:00 offset (gws/Calendar requires
// a timezone offset on timeMin/timeMax).
function kstDayBoundsIso(date = new Date()) {
  const kstNow = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const dateStr = kstNow.toISOString().slice(0, 10);
  return {
    dateStr,
    timeMin: `${dateStr}T00:00:00+09:00`,
    timeMax: `${dateStr}T23:59:59+09:00`
  };
}

// Shared Calendar API event -> widget row mapping. Extended (round 3) to
// carry location/description so the renderer's detail panel and event edit
// form have real data instead of always-empty fields. Calendar name is
// deliberately not fetched here — it would need an extra calendarList.get
// call per event/list, and the detail panel treats an absent field as
// "omit quietly", so it is simply never populated.
function eventRow(event) {
  return {
    id: event.id,
    summary: event.summary || '(제목 없음)',
    start: event.start?.dateTime || event.start?.date || null,
    end: event.end?.dateTime || event.end?.date || null,
    allDay: !event.start?.dateTime,
    location: event.location || null,
    description: event.description || null,
    htmlLink: event.htmlLink || null
  };
}

function listTodayEvents(gws = runGws) {
  const { timeMin, timeMax } = kstDayBoundsIso();
  const params = {
    calendarId: 'primary',
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 50
  };
  const response = gws(['calendar', 'events', 'list', '--params', JSON.stringify(params), '--format', 'json']);
  return (response.items || []).map(eventRow);
}

// 달력 탭 (round 3): month-window event fetch for the calendar grid. Cached
// per "timeMinIso|timeMaxIso" key for 5 minutes so flipping back to a month
// already viewed this session doesn't re-hit gws. Keyed on the exact ISO
// bounds the renderer sends (one key per calendar month it requests).
const RANGE_CACHE_TTL_MS = 5 * 60 * 1000;
const rangeCache = new Map();

function listEventsInRange(timeMinIso, timeMaxIso, gws = runGws) {
  const params = {
    calendarId: 'primary',
    timeMin: timeMinIso,
    timeMax: timeMaxIso,
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 250
  };
  const response = gws(['calendar', 'events', 'list', '--params', JSON.stringify(params), '--format', 'json']);
  return (response.items || []).map(eventRow);
}

function eventsRange(flags = {}, gws = runGws) {
  const timeMinIso = flags.timeMinIso;
  const timeMaxIso = flags.timeMaxIso;
  if (!timeMinIso || !timeMaxIso) throw new Error('eventsRange requires timeMinIso and timeMaxIso');
  const key = `${timeMinIso}|${timeMaxIso}`;
  const cached = rangeCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < RANGE_CACHE_TTL_MS) {
    return { events: cached.events, cached: true };
  }
  const events = listEventsInRange(timeMinIso, timeMaxIso, gws);
  rangeCache.set(key, { events, fetchedAt: Date.now() });
  return { events, cached: false };
}

// Catalog spreadsheetId cache: googleCatalog.listProjects()/ensureSpreadsheet()
// costs a Drive files.list + spreadsheets.get + a header-row read per sheet
// (3 sheets) on *every* call — and buildSnapshot used to call listProjects()
// twice (once for pinned, once for the full list), doubling that cost. Cache
// the id after the first successful ensure and read rows directly, skipping
// ensureSpreadsheet entirely on the fast path. If a read fails (e.g. the
// cached id 404s because the sheet was deleted/recreated), drop the cache
// and re-ensure once.
let cachedCatalogSpreadsheetId = null;

function projectsFromCatalog(gws, filters = {}) {
  const status = filters.status ? String(filters.status) : null;
  const readAndFilter = (spreadsheetId) => {
    const rows = googleCatalog.readRows(spreadsheetId, 'projects', gws);
    return rows
      .filter((row) => (status === 'all' ? true : status ? String(row.status || '') === status : String(row.status || '') !== 'archived'))
      .slice()
      .sort((a, b) => {
        const sortDiff = Number(a.sort_order || 0) - Number(b.sort_order || 0);
        if (sortDiff !== 0) return sortDiff;
        return String(a.created_at || '').localeCompare(String(b.created_at || ''));
      });
  };
  if (cachedCatalogSpreadsheetId) {
    try {
      return readAndFilter(cachedCatalogSpreadsheetId);
    } catch {
      cachedCatalogSpreadsheetId = null; // stale id — fall through to re-ensure below.
    }
  }
  const { spreadsheetId } = googleCatalog.ensureSpreadsheet(gws);
  cachedCatalogSpreadsheetId = spreadsheetId;
  return readAndFilter(spreadsheetId);
}

let lastGoodSnapshot = null;

function readCache() {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function writeCache(snapshot) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(snapshot, null, 2), 'utf8');
  } catch {
    // best-effort — cache is an optimization, not a requirement.
  }
}

function buildSnapshot(gws) {
  const { dateStr } = kstDayBoundsIso();
  const events = listTodayEvents(gws);
  // DEADLINES section removed from the widget UI (round 3) — deadline items
  // were migrated to Google Calendar and the list is now empty. The CLI
  // (`askewly tasks ...`) still supports the deadlines section untouched;
  // only this snapshot fetch is dropped.
  const tasks = {
    today: listTasks({ section: 'today', status: 'active' }, gws),
    backlog: listTasks({ section: 'backlog', status: 'active' }, gws)
  };
  // Single catalog fetch (was two full listProjects() calls — one for pinned,
  // one for everything). projectsFromCatalog() with no status filter already
  // excludes archived rows and returns them ordered (pinned sort_order first).
  const projects = projectsFromCatalog(gws, {});
  const pinnedProjects = projects.filter((row) => Number(row.sort_order) < 0);
  return {
    date: dateStr,
    events,
    tasks,
    pinnedProjects,
    projects,
    fetchedAt: new Date().toISOString()
  };
}

function getSnapshot(gws = runGws) {
  try {
    const snapshot = buildSnapshot(gws);
    lastGoodSnapshot = snapshot;
    writeCache(snapshot);
    return snapshot;
  } catch (error) {
    const cached = lastGoodSnapshot || readCache();
    if (cached) {
      return { ...cached, stale: true, error: String(error?.message || error) };
    }
    throw error;
  }
}

// Thin CRUD wrappers delegating to scripts/lib/google-workspace-tasks.js.
// S3 wires these into the renderer; wired here now so the IPC contract is
// stable and unit-verifiable offline.
function taskAdd(flags = {}, gws = runGws) {
  return addTask(flags, gws);
}

function taskToggle(flags = {}, gws = runGws) {
  const status = flags.status || 'done';
  return setTaskStatus({ id: flags.id, status }, gws);
}

function taskDefer(flags = {}, gws = runGws) {
  return moveTask(flags, gws);
}

function taskUpdateFn(flags = {}, gws = runGws) {
  return updateTask(flags, gws);
}

// Calendar event editing (S4 polish round 2, extended round 3 with
// location/description). Mirrors the runGws arg style used by
// scripts/lib/google-workspace-tasks.js: --params for the URL/query object,
// --json for the request body. Times arrive from the renderer as full
// RFC3339 strings with a literal +09:00 offset (built from a HH:mm input
// against the widget's "today" date) — passed straight through as Calendar
// API dateTime values, no re-parsing.
function eventUpdate(flags = {}, gws = runGws) {
  const calendarId = flags.calendarId || 'primary';
  const body = {};
  if (flags.summary !== undefined) body.summary = flags.summary;
  if (flags.location !== undefined) body.location = flags.location;
  if (flags.description !== undefined) body.description = flags.description;
  if (flags.startIso && flags.endIso) {
    body.start = { dateTime: flags.startIso };
    body.end = { dateTime: flags.endIso };
  }
  const updated = gws([
    'calendar', 'events', 'patch',
    '--params', JSON.stringify({ calendarId, eventId: flags.id, sendUpdates: 'none' }),
    '--json', JSON.stringify(body),
    '--format', 'json'
  ]);
  return eventRow(updated);
}

function eventDelete(flags = {}, gws = runGws) {
  const calendarId = flags.calendarId || 'primary';
  gws([
    'calendar', 'events', 'delete',
    '--params', JSON.stringify({ calendarId, eventId: flags.id, sendUpdates: 'none' }),
    '--format', 'json'
  ]);
  return { id: flags.id, deleted: true };
}

module.exports = {
  getSnapshot,
  taskAdd,
  taskToggle,
  taskDefer,
  taskUpdate: taskUpdateFn,
  eventUpdate,
  eventDelete,
  eventsRange,
  kstDayBoundsIso,
  listTodayEvents,
  projectsFromCatalog,
  buildSnapshot,
  CACHE_FILE
};
