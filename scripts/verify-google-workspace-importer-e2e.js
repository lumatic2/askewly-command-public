const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const { buildDryRun } = require('./google-workspace-migration-dry-run');

function gwsCommand() {
  if (process.env.GWS_BIN) return process.env.GWS_BIN;
  if (process.platform === 'win32' && process.env.APPDATA) {
    const installedExe = path.join(process.env.APPDATA, 'npm', 'node_modules', '@googleworkspace', 'cli', 'bin', 'gws.exe');
    if (fs.existsSync(installedExe)) return installedExe;
  }
  return 'gws';
}

function runGws(args, allowFailure = false) {
  const result = spawnSync(gwsCommand(), args, { encoding: 'utf8' });
  const stdout = String(result.stdout || '').trim();
  const stderr = String(result.stderr || '').trim();
  if (result.error && !allowFailure) {
    throw result.error;
  }
  if (result.status !== 0 && !allowFailure) {
    throw new Error(stdout || stderr || `gws exited ${result.status}`);
  }
  return { status: result.status, stdout, stderr, json: stdout ? JSON.parse(stdout) : null };
}

function cleanupFromLedger(ledgerPath) {
  if (!fs.existsSync(ledgerPath)) return;
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  const entries = [...(ledger.entries || [])].reverse();
  for (const entry of entries) {
    if (entry.status !== 'created') continue;
    if (entry.target_type === 'calendar_event' && entry.target_id) {
      runGws(['calendar', 'events', 'delete', '--params', JSON.stringify({ calendarId: entry.container_id || 'primary', eventId: entry.target_id, sendUpdates: 'none' }), '--format', 'json'], true);
    }
    if (entry.target_type === 'google_task' && entry.container_id && entry.target_id) {
      runGws(['tasks', 'tasks', 'delete', '--params', JSON.stringify({ tasklist: entry.container_id, task: entry.target_id }), '--format', 'json'], true);
      if (entry.container_title && entry.container_title.startsWith('Askewly E2E ')) {
        runGws(['tasks', 'tasklists', 'delete', '--params', JSON.stringify({ tasklist: entry.container_id }), '--format', 'json'], true);
      }
    }
  }
}

const suffix = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'askewly-gws-live-e2e-'));
const inputPath = path.join(tmpDir, 'dry-run.json');
const calendarOnlyInputPath = path.join(tmpDir, 'calendar-only-dry-run.json');
const calendarOnlyLedgerPath = path.join(tmpDir, 'calendar-only-ledger.json');
const calendarOnlyReportPath = path.join(tmpDir, 'calendar-only-report.json');
const ledgerPath = path.join(tmpDir, 'ledger.json');
const reportPath = path.join(tmpDir, 'report.json');

const fixture = {
  project_ref: 'pmksklcqwoybxndvdnxl',
  workspace_id: 1,
  task_sources: [
    { id: 10, key: 'today', kind: 'today', label: 'Today' },
    { id: 11, key: 'deadlines', kind: 'deadline', label: 'Deadlines' }
  ],
  tasks: [
    {
      id: 901,
      source_id: 10,
      title: `Askewly E2E task ${suffix}`,
      detail: 'Created by importer E2E and cleaned up automatically.',
      status: 'todo',
      scheduled_for: '2026-07-09'
    },
    {
      id: 902,
      source_id: 11,
      title: `Askewly E2E event ${suffix}`,
      detail: 'Created by importer E2E and cleaned up automatically.',
      status: 'todo',
      due_at: '2026-07-11T06:00:00.000Z'
    }
  ]
};

const dryRun = buildDryRun(fixture, { inputFile: 'fixture.json' });
fs.writeFileSync(inputPath, JSON.stringify(dryRun, null, 2));
fs.writeFileSync(calendarOnlyInputPath, JSON.stringify({
  ...dryRun,
  records: dryRun.records.filter((record) => record.target_type === 'calendar_event')
}, null, 2));

try {
  execFileSync(process.execPath, [
    path.join(__dirname, 'google-workspace-migration-import.js'),
    '--input', calendarOnlyInputPath,
    '--ledger', calendarOnlyLedgerPath,
    '--output', calendarOnlyReportPath,
    '--live',
    '--pretty'
  ], { stdio: 'pipe' });

  const calendarReport = JSON.parse(fs.readFileSync(calendarOnlyReportPath, 'utf8'));
  assert.strictEqual(calendarReport.mode, 'live');
  assert.strictEqual(calendarReport.counts.created, 1);
  assert.strictEqual(calendarReport.counts.errors, 0);
  const calendarLedger = JSON.parse(fs.readFileSync(calendarOnlyLedgerPath, 'utf8'));
  const calendarEvent = calendarLedger.entries.find((entry) => entry.target_type === 'calendar_event');
  assert(calendarEvent?.target_id && calendarEvent?.container_id);
  const calendarRead = runGws(['calendar', 'events', 'get', '--params', JSON.stringify({ calendarId: calendarEvent.container_id, eventId: calendarEvent.target_id }), '--format', 'json']);
  assert.strictEqual(calendarRead.json.summary, `Askewly E2E event ${suffix}`);

  const taskScopeProbe = runGws(['tasks', 'tasklists', 'list', '--format', 'json'], true);
  if (taskScopeProbe.status !== 0) {
    console.log(JSON.stringify({
      status: 'blocked',
      reason: 'google tasks scope missing',
      calendar_live_smoke: 'passed',
      command: 'gws tasks tasklists list --format json',
      detail: taskScopeProbe.stdout || taskScopeProbe.stderr
    }, null, 2));
    process.exitCode = 2;
    return;
  }

  execFileSync(process.execPath, [
    path.join(__dirname, 'google-workspace-migration-import.js'),
    '--input', inputPath,
    '--ledger', ledgerPath,
    '--output', reportPath,
    '--live',
    '--pretty'
  ], { stdio: 'pipe' });

  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  assert.strictEqual(report.mode, 'live');
  assert.strictEqual(report.counts.created, 2);
  assert.strictEqual(report.counts.errors, 0);

  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  const task = ledger.entries.find((entry) => entry.target_type === 'google_task');
  const event = ledger.entries.find((entry) => entry.target_type === 'calendar_event');
  assert(task?.target_id && task?.container_id);
  assert(event?.target_id && event?.container_id);

  const taskRead = runGws(['tasks', 'tasks', 'list', '--params', JSON.stringify({ tasklist: task.container_id }), '--format', 'json']);
  assert(JSON.stringify(taskRead.json).includes(`Askewly E2E task ${suffix}`));

  const eventRead = runGws(['calendar', 'events', 'get', '--params', JSON.stringify({ calendarId: event.container_id, eventId: event.target_id }), '--format', 'json']);
  assert.strictEqual(eventRead.json.summary, `Askewly E2E event ${suffix}`);

  console.log(JSON.stringify({
    status: 'passed',
    created: report.counts.created,
    task_id: task.target_id,
    event_id: event.target_id,
    cleanup: 'attempted'
  }, null, 2));
} finally {
  cleanupFromLedger(calendarOnlyLedgerPath);
  cleanupFromLedger(ledgerPath);
}
