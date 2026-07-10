#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function usage() {
  return [
    'Usage:',
    '  node scripts/google-workspace-migration-import.js --input dry-run.json --ledger ledger.json [--live] [--pretty]',
    '',
    'Imports M66 Google Workspace dry-run JSON into Google Tasks/Calendar.',
    'Default mode is local-only and non-mutating. Google writes require --live.'
  ].join('\n');
}

function parseArgs(argv) {
  const flags = {
    live: false,
    pretty: false,
    calendarId: 'primary'
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') flags.help = true;
    else if (arg === '--live') flags.live = true;
    else if (arg === '--pretty') flags.pretty = true;
    else if (arg === '--input' || arg === '-i') flags.input = argv[++i];
    else if (arg === '--ledger') flags.ledger = argv[++i];
    else if (arg === '--output' || arg === '-o') flags.output = argv[++i];
    else if (arg === '--calendar-id') flags.calendarId = argv[++i];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return flags;
}

function readJson(filePath, fallback = null) {
  if (!filePath) throw new Error('file path is required');
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value, pretty = true) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, pretty ? 2 : 0)}\n`);
}

function loadLedger(filePath) {
  if (!filePath) throw new Error('--ledger is required');
  const existing = readJson(filePath, { entries: [] });
  if (Array.isArray(existing)) return { entries: existing };
  if (!Array.isArray(existing.entries)) existing.entries = [];
  return existing;
}

function findLedgerEntry(ledger, targetKey) {
  return ledger.entries.find((entry) => entry.target_key === targetKey && entry.status === 'created');
}

function gwsCommand() {
  if (process.env.GWS_BIN) return process.env.GWS_BIN;
  if (process.platform === 'win32' && process.env.APPDATA) {
    const installedExe = path.join(process.env.APPDATA, 'npm', 'node_modules', '@googleworkspace', 'cli', 'bin', 'gws.exe');
    if (fs.existsSync(installedExe)) return installedExe;
  }
  return 'gws';
}

function gws(args) {
  const result = spawnSync(gwsCommand(), args, { encoding: 'utf8' });
  const stdout = String(result.stdout || '').trim();
  const stderr = String(result.stderr || '').trim();
  if (result.error) {
    throw new Error(result.error.message);
  }
  if (result.status !== 0) {
    const message = stdout || stderr || `gws exited ${result.status}`;
    const error = new Error(message);
    error.status = result.status;
    error.stdout = stdout;
    error.stderr = stderr;
    throw error;
  }
  return stdout ? JSON.parse(stdout) : {};
}

function toTaskDue(value) {
  if (!value) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T00:00:00.000Z`;
  return value;
}

function taskBody(payload) {
  const body = {
    title: payload.title,
    notes: payload.notes || '',
    status: payload.status || 'needsAction'
  };
  const due = toTaskDue(payload.due);
  if (due) body.due = due;
  return body;
}

function eventBody(payload, targetKey) {
  return {
    summary: payload.summary,
    description: payload.description || '',
    start: payload.start,
    end: payload.end,
    extendedProperties: {
      private: {
        askewlyTargetKey: targetKey
      }
    }
  };
}

function taskListTitle(record, options = {}) {
  const prefix = options.tasklistPrefix || '';
  return `${prefix}${record.payload.tasklist || 'Askewly Backlog'}`;
}

function listTaskLists() {
  const response = gws(['tasks', 'tasklists', 'list', '--format', 'json']);
  return response.items || response.taskLists || [];
}

function ensureTaskList(title, cache) {
  if (cache.has(title)) return cache.get(title);
  const existing = listTaskLists().find((item) => item.title === title);
  if (existing?.id) {
    cache.set(title, existing.id);
    return existing.id;
  }
  const created = gws(['tasks', 'tasklists', 'insert', '--json', JSON.stringify({ title }), '--format', 'json']);
  if (!created.id) throw new Error(`Google Tasks did not return id for task list: ${title}`);
  cache.set(title, created.id);
  return created.id;
}

function createGoogleTask(record, state, options) {
  const title = taskListTitle(record, options);
  const tasklistId = ensureTaskList(title, state.taskListCache);
  const created = gws([
    'tasks', 'tasks', 'insert',
    '--params', JSON.stringify({ tasklist: tasklistId }),
    '--json', JSON.stringify(taskBody(record.payload)),
    '--format', 'json'
  ]);
  if (!created.id) throw new Error(`Google Tasks did not return task id for ${record.target_key}`);
  return { target_id: created.id, container_id: tasklistId, container_title: title, response: created };
}

function createCalendarEvent(record, options) {
  const calendarId = record.payload.calendar || options.calendarId || 'primary';
  const created = gws([
    'calendar', 'events', 'insert',
    '--params', JSON.stringify({ calendarId, sendUpdates: 'none' }),
    '--json', JSON.stringify(eventBody(record.payload, record.target_key)),
    '--format', 'json'
  ]);
  if (!created.id) throw new Error(`Google Calendar did not return event id for ${record.target_key}`);
  return { target_id: created.id, container_id: calendarId, response: created };
}

function appendLedger(ledger, entry) {
  ledger.entries.push({
    ...entry,
    imported_at: new Date().toISOString()
  });
}

function processRecord(record, state, options) {
  if (!['google_task', 'calendar_event'].includes(record.target_type)) {
    return { target_key: record.target_key, action: 'skip', target_type: record.target_type, reason: 'non-importable target type' };
  }

  const prior = findLedgerEntry(state.ledger, record.target_key);
  if (prior) {
    if (prior.source_hash === record.source_hash) {
      return { target_key: record.target_key, action: 'skip', target_type: record.target_type, reason: 'ledger already contains matching created target', target_id: prior.target_id };
    }
    return { target_key: record.target_key, action: 'update_candidate', target_type: record.target_type, reason: 'source hash changed after prior import', target_id: prior.target_id };
  }

  if (!options.live) {
    appendLedger(state.ledger, {
      source_table: record.source_table,
      source_id: record.source_id,
      source_hash: record.source_hash,
      target_type: record.target_type,
      target_key: record.target_key,
      target_id: null,
      container_id: null,
      status: 'planned',
      dry_run: true
    });
    return { target_key: record.target_key, action: 'plan', target_type: record.target_type, reason: 'live flag not set' };
  }

  const created = record.target_type === 'google_task'
    ? createGoogleTask(record, state, options)
    : createCalendarEvent(record, options);

  appendLedger(state.ledger, {
    source_table: record.source_table,
    source_id: record.source_id,
    source_hash: record.source_hash,
    target_type: record.target_type,
    target_key: record.target_key,
    target_id: created.target_id,
    container_id: created.container_id,
    container_title: created.container_title || null,
    status: 'created',
    dry_run: false
  });

  return {
    target_key: record.target_key,
    action: 'create',
    target_type: record.target_type,
    target_id: created.target_id,
    container_id: created.container_id
  };
}

function importDryRun(dryRun, options) {
  const state = {
    ledger: loadLedger(options.ledger),
    taskListCache: new Map()
  };
  const results = [];
  const errors = [];

  for (const record of dryRun.records || []) {
    try {
      results.push(processRecord(record, state, options));
    } catch (error) {
      const failure = {
        target_key: record.target_key,
        target_type: record.target_type,
        action: 'error',
        reason: error.message
      };
      errors.push(failure);
      results.push(failure);
      break;
    }
  }

  writeJson(options.ledger, state.ledger, true);

  const counts = {
    planned: results.filter((item) => item.action === 'plan').length,
    created: results.filter((item) => item.action === 'create').length,
    skipped: results.filter((item) => item.action === 'skip').length,
    update_candidates: results.filter((item) => item.action === 'update_candidate').length,
    errors: errors.length
  };

  return {
    mode: options.live ? 'live' : 'dry-run',
    input_source: dryRun.source || null,
    ledger: options.ledger,
    counts,
    results,
    errors
  };
}

function main(argv = process.argv.slice(2)) {
  const flags = parseArgs(argv);
  if (flags.help) {
    console.log(usage());
    return 0;
  }
  if (!flags.input) throw new Error('--input is required');
  if (!flags.ledger) throw new Error('--ledger is required');
  const dryRun = readJson(flags.input);
  const report = importDryRun(dryRun, flags);
  const text = JSON.stringify(report, null, flags.pretty ? 2 : 0);
  if (flags.output) fs.writeFileSync(flags.output, `${text}\n`);
  else console.log(text);
  return report.errors.length ? 1 : 0;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`importer failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  importDryRun,
  taskBody,
  eventBody,
  toTaskDue
};
