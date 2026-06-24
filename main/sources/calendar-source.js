const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');

const execFileAsync = promisify(execFile);

const CACHE_TTL_MS = 5 * 60 * 1000;
const CALENDAR_LIST_TTL_MS = 30 * 60 * 1000;
const cache = new Map();
let calendarListCache = null;

// Pin Git Bash explicitly. If we let Node resolve `bash` via PATH, an
// auto-launched Electron may pick up WSL's bash.exe (WindowsApps shim) first,
// and WSL has no `node`/`gws` — the script dies with `exec: node: not found`.
let cachedBashPath = null;
function resolveGitBash() {
  if (cachedBashPath) return cachedBashPath;
  const candidates = [
    process.env.GIT_BASH_EXE,
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe'
  ].filter(Boolean);
  for (const p of candidates) {
    try { if (fs.existsSync(p)) { cachedBashPath = p; return p; } } catch (_) {}
  }
  cachedBashPath = 'bash';
  return cachedBashPath;
}

// On Windows, neither cmd.exe nor PowerShell preserves the inner `"` of
// `--params '{"k":"v"}'` cleanly when invoked from Node. Routing through
// Git Bash (bundled with Git for Windows) lets single-quoted JSON pass through
// unmangled because bash treats `'...'` literally.
async function runGws(args) {
  const opts = {
    timeout: 30000,
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 16,
    encoding: 'utf8'
  };
  if (process.platform === 'win32') {
    const bashQuote = (s) => {
      const v = String(s);
      if (/^[A-Za-z0-9_+./:@\-]+$/.test(v)) return v;
      return `'${v.replace(/'/g, `'\\''`)}'`;
    };
    const cmd = ['gws', ...args.map(bashQuote)].join(' ');
    const { stdout } = await execFileAsync(resolveGitBash(), ['-c', cmd], opts);
    return stdout;
  }
  const { stdout } = await execFileAsync('gws', args, opts);
  return stdout;
}

function extractJson(stdout) {
  if (!stdout) return null;
  const start = stdout.indexOf('{');
  if (start < 0) return null;
  try { return JSON.parse(stdout.slice(start)); } catch (_) { return null; }
}

async function listCalendars(force = false) {
  if (!force && calendarListCache && Date.now() - calendarListCache.fetchedAt < CALENDAR_LIST_TTL_MS) {
    return calendarListCache.list;
  }
  const stdout = await runGws(['calendar', 'calendarList', 'list', '--params', '{}', '--format', 'json']);
  const raw = extractJson(stdout);
  const items = Array.isArray(raw?.items) ? raw.items : [];
  const list = items.map((c) => ({
    id: c.id,
    summary: c.summary || c.id,
    primary: !!c.primary,
    accessRole: c.accessRole || 'reader',
    backgroundColor: c.backgroundColor || '',
    timeZone: c.timeZone || 'Asia/Seoul'
  }));
  calendarListCache = { fetchedAt: Date.now(), list };
  return list;
}

function isWritable(calendar) {
  return calendar.accessRole === 'owner' || calendar.accessRole === 'writer';
}

function parseStart(eventStart) {
  if (eventStart?.dateTime) {
    return { iso: eventStart.dateTime, dateKey: eventStart.dateTime.slice(0, 10), allDay: false };
  }
  if (eventStart?.date) {
    return { iso: `${eventStart.date}T00:00:00`, dateKey: eventStart.date, allDay: true };
  }
  return { iso: '', dateKey: '', allDay: false };
}

function timeLabel(startObj, endObj, allDay) {
  if (allDay) return '종일';
  const s = (startObj?.dateTime || '').match(/T(\d{2}):(\d{2})/);
  const e = (endObj?.dateTime || '').match(/T(\d{2}):(\d{2})/);
  if (!s) return '';
  const startStr = `${s[1]}:${s[2]}`;
  const endStr = e ? `${e[1]}:${e[2]}` : '';
  return endStr ? `${startStr}–${endStr}` : startStr;
}

function rangeBounds(rangeKey) {
  const days = rangeKey === 'month' ? 30 : 7;
  const min = new Date();
  min.setHours(0, 0, 0, 0);
  const max = new Date(min);
  max.setDate(max.getDate() + days);
  return { timeMin: min.toISOString(), timeMax: max.toISOString() };
}

async function fetchCalendarEvents(calendarId, timeMin, timeMax) {
  const params = JSON.stringify({
    calendarId,
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 250
  });
  const stdout = await runGws(['calendar', 'events', 'list', '--params', params, '--format', 'json']);
  const raw = extractJson(stdout);
  return Array.isArray(raw?.items) ? raw.items : [];
}

async function fetchCalendar(rangeKey) {
  const calendars = await listCalendars();
  const { timeMin, timeMax } = rangeBounds(rangeKey);
  const results = await Promise.all(calendars.map(async (cal) => {
    try {
      const items = await fetchCalendarEvents(cal.id, timeMin, timeMax);
      return items.map((ev) => ({ ev, cal }));
    } catch (_) {
      return [];
    }
  }));

  const events = results.flat().map(({ ev, cal }) => {
    const startInfo = parseStart(ev.start);
    if (!startInfo.dateKey) return null;
    return {
      id: ev.id,
      calendarId: cal.id,
      calendarName: cal.summary,
      calendarColor: cal.backgroundColor,
      writable: isWritable(cal),
      summary: ev.summary || '(제목 없음)',
      description: ev.description || '',
      location: ev.location || '',
      start: startInfo.iso,
      startRaw: ev.start,
      endRaw: ev.end,
      htmlLink: ev.htmlLink || '',
      dateKey: startInfo.dateKey,
      allDay: startInfo.allDay,
      timeLabel: timeLabel(ev.start, ev.end, startInfo.allDay),
      recurring: !!ev.recurringEventId,
      recurringEventId: ev.recurringEventId || ''
    };
  }).filter(Boolean).sort((a, b) => {
    if (a.dateKey !== b.dateKey) return a.dateKey < b.dateKey ? -1 : 1;
    if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
    return (a.start || '').localeCompare(b.start || '');
  });

  return {
    range: rangeKey,
    timeMin,
    timeMax,
    events,
    calendars,
    fetchedAt: new Date().toISOString()
  };
}

async function getCalendarState({ range = 'week', force = false } = {}) {
  const key = range === 'month' ? 'month' : 'week';
  const cached = cache.get(key);
  if (!force && cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.data;
  }
  try {
    const data = await fetchCalendar(key);
    cache.set(key, { fetchedAt: Date.now(), data });
    return data;
  } catch (error) {
    return { range: key, events: [], calendars: [], error: String(error?.message || error) };
  }
}

function invalidateCache() {
  cache.clear();
}

function buildTimeBody({ allDay, start, end, timeZone }) {
  if (allDay) {
    return { start: { date: start }, end: { date: end } };
  }
  const tz = timeZone || 'Asia/Seoul';
  return {
    start: { dateTime: start, timeZone: tz },
    end: { dateTime: end, timeZone: tz }
  };
}

async function insertEvent(payload) {
  const calendarId = String(payload?.calendarId || '').trim();
  const summary = String(payload?.summary || '').trim();
  if (!calendarId) throw new Error('calendarId required');
  if (!summary) throw new Error('summary required');
  const body = {
    summary,
    ...buildTimeBody({
      allDay: !!payload.allDay,
      start: payload.start,
      end: payload.end,
      timeZone: payload.timeZone
    })
  };
  if (payload.location) body.location = String(payload.location);
  if (payload.description) body.description = String(payload.description);
  const stdout = await runGws([
    'calendar', 'events', 'insert',
    '--params', JSON.stringify({ calendarId }),
    '--json', JSON.stringify(body),
    '--format', 'json'
  ]);
  invalidateCache();
  return extractJson(stdout);
}

async function updateEvent(payload) {
  const calendarId = String(payload?.calendarId || '').trim();
  const eventId = String(payload?.eventId || '').trim();
  if (!calendarId || !eventId) throw new Error('calendarId and eventId required');
  const body = {};
  if (payload.summary !== undefined) body.summary = String(payload.summary || '').trim();
  if (payload.location !== undefined) body.location = payload.location ? String(payload.location) : '';
  if (payload.description !== undefined) body.description = payload.description ? String(payload.description) : '';
  if (payload.start !== undefined && payload.end !== undefined) {
    Object.assign(body, buildTimeBody({
      allDay: !!payload.allDay,
      start: payload.start,
      end: payload.end,
      timeZone: payload.timeZone
    }));
  }
  const stdout = await runGws([
    'calendar', 'events', 'patch',
    '--params', JSON.stringify({ calendarId, eventId }),
    '--json', JSON.stringify(body),
    '--format', 'json'
  ]);
  invalidateCache();
  return extractJson(stdout);
}

async function deleteEvent(payload) {
  const calendarId = String(payload?.calendarId || '').trim();
  const eventId = String(payload?.eventId || '').trim();
  if (!calendarId || !eventId) throw new Error('calendarId and eventId required');
  await runGws(['calendar', 'events', 'delete', '--params', JSON.stringify({ calendarId, eventId }), '--format', 'json']);
  invalidateCache();
  return { ok: true };
}

module.exports = { getCalendarState, insertEvent, updateEvent, deleteEvent };
