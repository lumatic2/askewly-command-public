const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { buildDryRun } = require('./google-workspace-migration-dry-run');
const { importDryRun, taskBody, eventBody, toTaskDue } = require('./google-workspace-migration-import');

const fixture = {
  project_ref: 'pmksklcqwoybxndvdnxl',
  workspace_id: 1,
  task_sources: [
    { id: 10, key: 'today', kind: 'today', label: 'Today' },
    { id: 11, key: 'deadlines', kind: 'deadline', label: 'Deadlines' }
  ],
  tasks: [
    { id: 201, source_id: 10, title: 'Importer task', detail: 'Task notes', status: 'todo', scheduled_for: '2026-07-09' },
    { id: 202, source_id: 11, title: 'Importer event', detail: 'Event notes', status: 'todo', due_at: '2026-07-11T06:00:00.000Z' },
    { id: 203, source_id: 10, title: 'Archived', detail: '', status: 'archived', archived_at: '2026-07-01T00:00:00.000Z' }
  ]
};

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'askewly-gws-importer-'));
const dryRun = buildDryRun(fixture, { inputFile: 'fixture.json', exportedAt: '2026-07-09T00:00:00.000Z' });
const dryRunPath = path.join(tmpDir, 'dry-run.json');
const ledgerPath = path.join(tmpDir, 'ledger.json');
const outputPath = path.join(tmpDir, 'import-report.json');
fs.writeFileSync(dryRunPath, JSON.stringify(dryRun, null, 2));

assert.strictEqual(toTaskDue('2026-07-11'), '2026-07-11T00:00:00.000Z');
assert.strictEqual(taskBody({ title: 'Task', notes: 'Notes', due: '2026-07-11' }).due, '2026-07-11T00:00:00.000Z');
assert.strictEqual(eventBody({ summary: 'Event', start: {}, end: {} }, 'askewly:tasks:1').extendedProperties.private.askewlyTargetKey, 'askewly:tasks:1');

const report = importDryRun(dryRun, { ledger: ledgerPath, live: false, calendarId: 'primary' });
assert.strictEqual(report.mode, 'dry-run');
assert.strictEqual(report.counts.planned, 2);
assert.strictEqual(report.counts.skipped >= 1, true);
assert.strictEqual(report.counts.errors, 0);

const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
assert.strictEqual(ledger.entries.length, 2);
assert.strictEqual(ledger.entries.every((entry) => entry.status === 'planned' && entry.dry_run === true), true);

const second = importDryRun(dryRun, { ledger: ledgerPath, live: false, calendarId: 'primary' });
assert.strictEqual(second.counts.planned, 2, 'planned entries should not count as live-created idempotency skips');

const liveLedger = {
  entries: [
    {
      source_table: 'tasks',
      source_id: '201',
      source_hash: dryRun.records.find((record) => record.target_key === 'askewly:tasks:201').source_hash,
      target_type: 'google_task',
      target_key: 'askewly:tasks:201',
      target_id: 'existing-task-id',
      container_id: 'existing-list-id',
      status: 'created',
      dry_run: false
    }
  ]
};
const liveLedgerPath = path.join(tmpDir, 'live-ledger.json');
fs.writeFileSync(liveLedgerPath, JSON.stringify(liveLedger, null, 2));
const skipReport = importDryRun(dryRun, { ledger: liveLedgerPath, live: false, calendarId: 'primary' });
assert.strictEqual(skipReport.results.find((item) => item.target_key === 'askewly:tasks:201').action, 'skip');

execFileSync(process.execPath, [
  path.join(__dirname, 'google-workspace-migration-import.js'),
  '--input', dryRunPath,
  '--ledger', path.join(tmpDir, 'cli-ledger.json'),
  '--output', outputPath,
  '--pretty'
], { stdio: 'pipe' });
const cliReport = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
assert.strictEqual(cliReport.mode, 'dry-run');
assert.strictEqual(cliReport.counts.planned, 2);

console.log('google workspace importer verify ok: dry-run import, ledger writes, idempotent skip, and CLI output');
