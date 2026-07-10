const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { buildDryRun } = require('./google-workspace-migration-dry-run');

const fixture = {
  project_ref: 'pmksklcqwoybxndvdnxl',
  workspace_id: 1,
  task_sources: [
    { id: 10, key: 'today', kind: 'today', label: 'Today', sort_order: 1 },
    { id: 11, key: 'deadlines', kind: 'deadline', label: 'Deadlines', sort_order: 2 },
    { id: 12, key: 'backlog', kind: 'backlog', label: 'Backlog', sort_order: 3 }
  ],
  projects: [
    { id: 20, name: 'Askewly Command', status: 'active', current_horizon: 'Google Workspace Portability' }
  ],
  project_milestones: [
    { id: 30, project_id: 20, title: 'M66', status: 'active', target_date: '2026-07-09' }
  ],
  project_links: [
    { id: 40, project_id: 20, project_milestone_id: 30, kind: 'github', title: 'Repo', target: 'repo:askewly-command' }
  ],
  tasks: [
    {
      id: 101,
      source_id: 10,
      project_id: 20,
      project_milestone_id: 30,
      title: 'Today active task',
      detail: 'Preserve project context',
      status: 'todo',
      scheduled_for: '2026-07-09',
      due_at: null
    },
    {
      id: 102,
      source_id: 11,
      title: 'Date-only deadline',
      detail: '',
      status: 'todo',
      scheduled_for: null,
      due_at: '2026-07-11T14:59:00.000Z'
    },
    {
      id: 103,
      source_id: 11,
      title: 'Timed review call',
      detail: '',
      status: 'todo',
      scheduled_for: null,
      due_at: '2026-07-11T06:00:00.000Z'
    },
    {
      id: 104,
      source_id: 12,
      title: 'Archived backlog item',
      detail: '',
      status: 'archived',
      archived_at: '2026-07-01T00:00:00.000Z'
    },
    {
      id: 105,
      source_id: 10,
      title: '   ',
      detail: '',
      status: 'todo'
    },
    {
      id: 106,
      source_id: 12,
      title: 'Held research item',
      detail: '',
      status: 'held'
    }
  ]
};

function byTaskId(dryRun, id) {
  return dryRun.records.find((record) => record.source_table === 'tasks' && record.source_id === String(id));
}

const dryRun = buildDryRun(fixture, {
  inputFile: 'fixture.json',
  exportedAt: '2026-07-09T00:00:00.000Z'
});

assert.strictEqual(dryRun.source.project_ref, 'pmksklcqwoybxndvdnxl');
assert.strictEqual(dryRun.counts.tasks, 6);
assert.strictEqual(dryRun.counts.projects, 1);
assert.strictEqual(dryRun.counts.project_milestones, 1);
assert.strictEqual(dryRun.counts.project_links, 1);
assert.strictEqual(dryRun.counts.google_tasks, 3);
assert.strictEqual(dryRun.counts.calendar_events, 1);
assert.strictEqual(dryRun.counts.errors, 1);

assert.strictEqual(byTaskId(dryRun, 101).target_type, 'google_task');
assert.strictEqual(byTaskId(dryRun, 101).payload.tasklist, 'Askewly Today');
assert.match(byTaskId(dryRun, 101).payload.notes, /Project: Askewly Command/);
assert.match(byTaskId(dryRun, 101).payload.notes, /Milestone: M66/);

assert.strictEqual(byTaskId(dryRun, 102).target_type, 'google_task');
assert.strictEqual(byTaskId(dryRun, 102).payload.tasklist, 'Askewly Deadlines');
assert.strictEqual(byTaskId(dryRun, 102).payload.due, '2026-07-11');
assert.strictEqual(byTaskId(dryRun, 102).payload.calendar_candidate, true);

assert.strictEqual(byTaskId(dryRun, 103).target_type, 'calendar_event');
assert.strictEqual(byTaskId(dryRun, 103).payload.start.dateTime, '2026-07-11T06:00:00.000Z');
assert.strictEqual(byTaskId(dryRun, 104).target_type, 'ledger_only');
assert.strictEqual(byTaskId(dryRun, 105).target_type, 'error');
assert.strictEqual(byTaskId(dryRun, 106).target_type, 'google_task');
assert.strictEqual(byTaskId(dryRun, 106).payload.tasklist, 'Askewly Backlog');

assert.strictEqual(dryRun.records.some((record) => record.source_table === 'projects' && record.target_type === 'ledger_only'), true);
assert.strictEqual(dryRun.ledger.length, dryRun.records.length);
assert.strictEqual(dryRun.ledger.every((entry) => entry.dry_run === true), true);

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'askewly-gws-dry-run-'));
const inputPath = path.join(tmpDir, 'export.json');
const outputPath = path.join(tmpDir, 'dry-run.json');
fs.writeFileSync(inputPath, JSON.stringify(fixture, null, 2));
execFileSync(process.execPath, [
  path.join(__dirname, 'google-workspace-migration-dry-run.js'),
  '--input',
  inputPath,
  '--output',
  outputPath,
  '--pretty'
], { stdio: 'pipe' });

const cliOutput = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
assert.strictEqual(cliOutput.counts.google_tasks, 3);
assert.strictEqual(cliOutput.counts.calendar_events, 1);
assert.strictEqual(cliOutput.counts.errors, 1);

console.log('google workspace migration dry-run verify ok: classified tasks, calendar events, ledger-only rows, errors, and CLI output');
