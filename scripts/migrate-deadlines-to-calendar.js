#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { listTasks } = require('./lib/google-workspace-tasks');

const FOOTER_PREFIX = 'askewly-migrated-from-task:';

function usage() {
  return [
    'Usage:',
    '  node scripts/migrate-deadlines-to-calendar.js [--live] [--calendar-id <id>] [--pretty]',
    '',
    'Migrates active "Askewly Deadlines" Google Tasks into all-day Google Calendar events',
    '(primary calendar by default). Default mode is dry-run and makes no gws write calls.',
    'Use --live to create events and delete the source tasks after each event is confirmed created.'
  ].join('\n');
}

function parseArgs(argv) {
  const flags = { live: false, pretty: false, calendarId: 'primary' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') flags.help = true;
    else if (arg === '--live') flags.live = true;
    else if (arg === '--pretty') flags.pretty = true;
    else if (arg === '--calendar-id') flags.calendarId = argv[++i];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return flags;
}

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

// KST = UTC+9. due_at is stored as an ISO instant; the calendar event is an
// all-day event on the KST calendar date of that instant.
function kstDateFromIso(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid due_at: ${iso}`);
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

function addDaysToDateString(dateStr, days) {
  const date = new Date(`${dateStr}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function buildEventPayload(row) {
  const dateStr = kstDateFromIso(row.due_at);
  const endDateStr = addDaysToDateString(dateStr, 1);
  const footer = `${FOOTER_PREFIX} ${row.id}`;
  const detail = String(row.detail || '').trim();
  const description = detail ? `${detail}\n\n${footer}` : footer;
  return {
    summary: row.title,
    description,
    start: { date: dateStr },
    end: { date: endDateStr },
    extendedProperties: { private: { askewlyTaskId: String(row.id) } }
  };
}

// Idempotency lookup: prefer Calendar's privateExtendedProperty query; if the
// gws/API call rejects that param (older gws build, scope issue, etc.) fall
// back to a text match on the traceability footer within the search window.
function findExistingEvent(calendarId, row, gws) {
  const dateStr = kstDateFromIso(row.due_at);
  const windowStart = addDaysToDateString(dateStr, -1);
  const windowEnd = addDaysToDateString(dateStr, 2);
  const baseParams = {
    calendarId,
    timeMin: `${windowStart}T00:00:00Z`,
    timeMax: `${windowEnd}T00:00:00Z`,
    singleEvents: true,
    maxResults: 50
  };

  try {
    const response = gws([
      'calendar', 'events', 'list',
      '--params', JSON.stringify({ ...baseParams, privateExtendedProperty: [`askewlyTaskId=${row.id}`] }),
      '--format', 'json'
    ]);
    const items = response.items || [];
    if (items.length) return items[0];
    return null;
  } catch (error) {
    // fall through to text-match fallback
  }

  const response = gws([
    'calendar', 'events', 'list',
    '--params', JSON.stringify(baseParams),
    '--format', 'json'
  ]);
  const items = response.items || [];
  const footer = `${FOOTER_PREFIX} ${row.id}`;
  return items.find((event) => String(event.description || '').includes(footer)) || null;
}

function processRow(row, options) {
  const { gws, calendarId, live } = options;

  if (!row.due_at) {
    return { taskId: row.id, title: row.title, classification: 'error', reason: 'no usable due date (due_at and task.due both absent/invalid)' };
  }

  const dueDateKst = kstDateFromIso(row.due_at);
  const existing = findExistingEvent(calendarId, row, gws);
  if (existing) {
    return { taskId: row.id, title: row.title, classification: 'skip', eventId: existing.id, due_date_kst: dueDateKst };
  }

  if (!live) {
    return { taskId: row.id, title: row.title, classification: 'planned', due_date_kst: dueDateKst };
  }

  const payload = buildEventPayload(row);
  let created;
  try {
    created = gws([
      'calendar', 'events', 'insert',
      '--params', JSON.stringify({ calendarId, sendUpdates: 'none' }),
      '--json', JSON.stringify(payload),
      '--format', 'json'
    ]);
  } catch (error) {
    return { taskId: row.id, title: row.title, classification: 'error', reason: `event create failed: ${error.message}` };
  }
  if (!created.id) {
    return { taskId: row.id, title: row.title, classification: 'error', reason: 'calendar did not return event id' };
  }

  // Only delete the source task once the event create above has succeeded.
  try {
    gws([
      'tasks', 'tasks', 'delete',
      '--params', JSON.stringify({ tasklist: row.tasklist_id, task: row.id }),
      '--format', 'json'
    ]);
    return { taskId: row.id, title: row.title, classification: 'created', eventId: created.id, due_date_kst: dueDateKst, taskDeleted: true };
  } catch (error) {
    return {
      taskId: row.id,
      title: row.title,
      classification: 'created',
      eventId: created.id,
      due_date_kst: dueDateKst,
      taskDeleted: false,
      reason: `event created but task delete failed: ${error.message}`
    };
  }
}

function migrateDeadlines(options = {}) {
  const gws = options.gws || runGws;
  const calendarId = options.calendarId || 'primary';
  const live = options.live === true;

  const rows = listTasks({ section: 'deadlines', status: 'active', limit: 100 }, gws);
  const results = rows.map((row) => processRow(row, { gws, calendarId, live }));

  const counts = { planned: 0, skip: 0, created: 0, error: 0 };
  for (const item of results) counts[item.classification] += 1;

  const ledgerEntries = results
    .filter((item) => item.classification === 'created' || item.classification === 'skip')
    .map((item) => ({
      taskId: item.taskId,
      eventId: item.eventId,
      status: item.classification === 'skip' ? 'skipped' : (item.taskDeleted ? 'deleted' : 'created')
    }));

  return {
    mode: live ? 'live' : 'dry-run',
    calendarId,
    counts,
    results,
    ledger_entries: ledgerEntries
  };
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '-').slice(0, 19);
}

function ensureDataDir() {
  const dir = path.join(__dirname, '..', 'data', 'google-workspace-migration');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function main(argv = process.argv.slice(2)) {
  const flags = parseArgs(argv);
  if (flags.help) {
    console.log(usage());
    return 0;
  }

  const result = migrateDeadlines({ live: flags.live, calendarId: flags.calendarId });
  const dataDir = ensureDataDir();
  const ts = timestamp();

  if (!flags.live) {
    const reportPath = path.join(dataDir, `deadlines-to-calendar-dryrun-${ts}.json`);
    writeJson(reportPath, {
      generated_at: new Date().toISOString(),
      mode: 'dry-run',
      calendarId: result.calendarId,
      counts: result.counts,
      results: result.results
    });
    console.log(JSON.stringify({ mode: 'dry-run', counts: result.counts, report: reportPath }, null, flags.pretty ? 2 : 0));
    return result.counts.error ? 1 : 0;
  }

  const ledgerPath = path.join(dataDir, `deadlines-to-calendar-ledger-${ts}.json`);
  const reportPath = path.join(dataDir, `deadlines-to-calendar-report-${ts}.json`);
  writeJson(ledgerPath, { calendarId: result.calendarId, entries: result.ledger_entries });
  writeJson(reportPath, {
    generated_at: new Date().toISOString(),
    mode: 'live',
    calendarId: result.calendarId,
    counts: result.counts,
    results: result.results
  });
  console.log(JSON.stringify({ mode: 'live', counts: result.counts, ledger: ledgerPath, report: reportPath }, null, flags.pretty ? 2 : 0));
  return result.counts.error ? 1 : 0;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`migrate-deadlines-to-calendar failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  migrateDeadlines,
  processRow,
  buildEventPayload,
  findExistingEvent,
  kstDateFromIso,
  addDaysToDateString
};
