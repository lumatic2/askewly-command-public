// M4-compatible calendar source — uses gws +agenda helper (raw calendarList API not available on M4 gws)
const { execFile } = require('child_process');
const { promisify } = require('util');
const os = require('os');

const execFileAsync = promisify(execFile);
const CACHE_TTL_MS = 5 * 60 * 1000;
const NVM_NODE = `${os.homedir()}/.nvm/versions/node/v24.14.0/bin`;
const cache = new Map();

function buildEnv() {
  return { ...process.env, PATH: `${NVM_NODE}:${process.env.PATH || '/usr/local/bin:/usr/bin:/bin'}` };
}

function parseStart(isoString) {
  if (!isoString) return { dateKey: '', allDay: false };
  const dateKey = isoString.slice(0, 10);
  const allDay = /^\d{4}-\d{2}-\d{2}$/.test(isoString);
  return { dateKey, allDay };
}

function timeLabel(isoString, allDay) {
  if (allDay) return '종일';
  const m = (isoString || '').match(/T(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : '';
}

async function fetchAgenda(days) {
  const { stdout, stderr } = await execFileAsync(
    'gws', ['calendar', '+agenda', `--days`, String(days), '--format', 'json'],
    { timeout: 30000, maxBuffer: 1024 * 1024 * 4, encoding: 'utf8', env: buildEnv() }
  ).catch((err) => { return { stdout: err.stdout || '', stderr: err.stderr || '' }; });

  // Strip Python deprecation warnings (printed to stdout on macOS system Python)
  const clean = (stdout || '').replace(/^.*?(FutureWarning|NotOpenSSLWarning|warnings\.warn)[^\n]*\n/gm, '').trim();
  let items = [];
  try { items = JSON.parse(clean); } catch (_) { return []; }
  if (!Array.isArray(items)) return [];

  return items.map((ev) => {
    const { dateKey, allDay } = parseStart(ev.start);
    return {
      id: ev.id || '',
      calendarId: 'default',
      calendarName: 'Google Calendar',
      calendarColor: '#4285f4',
      writable: false,
      summary: ev.summary || '(제목 없음)',
      description: ev.description || '',
      location: ev.location || '',
      start: ev.start || '',
      startRaw: { dateTime: ev.start },
      endRaw: null,
      htmlLink: '',
      dateKey,
      allDay,
      timeLabel: timeLabel(ev.start, allDay),
      recurring: false,
      recurringEventId: ''
    };
  }).filter((e) => e.dateKey).sort((a, b) => {
    if (a.dateKey !== b.dateKey) return a.dateKey < b.dateKey ? -1 : 1;
    if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
    return (a.start || '').localeCompare(b.start || '');
  });
}

async function getCalendarState({ range = 'week', force = false } = {}) {
  const key = range === 'month' ? 'month' : 'week';
  const days = key === 'month' ? 30 : 7;
  const cached = cache.get(key);
  if (!force && cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.data;
  try {
    const events = await fetchAgenda(days);
    const data = {
      range: key, events,
      calendars: [{ id: 'default', summary: 'Google Calendar', primary: true, accessRole: 'reader', backgroundColor: '#4285f4', timeZone: 'Asia/Seoul' }],
      fetchedAt: new Date().toISOString()
    };
    cache.set(key, { fetchedAt: Date.now(), data });
    return data;
  } catch (error) {
    return { range: key, events: [], calendars: [], error: String(error?.message || error) };
  }
}

module.exports = { getCalendarState };
