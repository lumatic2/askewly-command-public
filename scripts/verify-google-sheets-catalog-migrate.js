const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { mapRow, mapExportData, migrate, readExportFile } = require('./google-sheets-catalog-migrate');
const { SHEET_HEADERS } = require('./lib/google-workspace-catalog');

// --- fixture data (synthetic, not from real export) ---

const fixtureExport = {
  source: 'test-fixture',
  exported_at: '2026-07-10T00:00:00.000Z',
  task_sources: [],
  tasks: [],
  projects: [
    {
      id: 1,
      workspace_id: 1,
      name: 'Fixture Project',
      north_star: 'ship it',
      description: 'a test project',
      github_url: null,
      status: 'active',
      current_horizon: 'h1',
      roadmap_note: null,
      sort_order: 0,
      archived_at: null,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-02T00:00:00.000Z'
    },
    {
      id: 2,
      workspace_id: 1,
      name: 'Second Project',
      north_star: null,
      description: null,
      github_url: null,
      status: 'paused',
      current_horizon: null,
      roadmap_note: null,
      sort_order: 1,
      archived_at: null,
      created_at: '2026-01-03T00:00:00.000Z',
      updated_at: '2026-01-04T00:00:00.000Z'
    }
  ],
  project_milestones: [
    {
      id: 10,
      workspace_id: 1,
      project_id: 1,
      title: 'Fixture Milestone',
      status: 'done',
      target_date: null,
      sort_order: 0,
      archived_at: null,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-02T00:00:00.000Z'
    }
  ],
  project_links: [
    {
      id: 100,
      workspace_id: 1,
      project_id: 1,
      project_milestone_id: null,
      kind: 'doc',
      title: 'Fixture Link',
      target: 'https://example.com',
      sort_order: 0,
      archived_at: null,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-02T00:00:00.000Z'
    }
  ]
};

// --- 1. mapping correctness ---

const mappedProjectRow = mapRow('projects', fixtureExport.projects[0]);
assert.deepStrictEqual(Object.keys(mappedProjectRow), SHEET_HEADERS.projects, 'projects field order must match SHEET_HEADERS');
assert.strictEqual(mappedProjectRow.supabase_id, 1, 'id should be renamed to supabase_id');
assert.strictEqual('workspace_id' in mappedProjectRow, false, 'workspace_id must be dropped');

const mappedProjectRow2 = mapRow('projects', fixtureExport.projects[1]);
assert.strictEqual(mappedProjectRow2.north_star, null, 'null passes through mapRow; appendRows converts to empty string at write time');
assert.strictEqual(mappedProjectRow2.description, null, 'null passes through mapRow; appendRows converts to empty string at write time');

const mappedMilestoneRow = mapRow('milestones', fixtureExport.project_milestones[0]);
assert.deepStrictEqual(Object.keys(mappedMilestoneRow), SHEET_HEADERS.milestones);
assert.strictEqual(mappedMilestoneRow.supabase_id, 10);

const mappedLinkRow = mapRow('links', fixtureExport.project_links[0]);
assert.deepStrictEqual(Object.keys(mappedLinkRow), SHEET_HEADERS.links);
assert.strictEqual(mappedLinkRow.supabase_id, 100);
assert.strictEqual(mappedLinkRow.project_milestone_id, null, 'null project_milestone_id passes through mapRow');

const bySheet = mapExportData(fixtureExport);
assert.strictEqual(bySheet.projects.length, 2);
assert.strictEqual(bySheet.milestones.length, 1);
assert.strictEqual(bySheet.links.length, 1);

console.log('mapping correctness ok');

// --- 2. dry-run makes no gws calls ---

let gwsCallCount = 0;
const explodingGws = () => {
  gwsCallCount += 1;
  throw new Error('gws should not be called during dry-run');
};

const dryRunResult = migrate(fixtureExport, { live: false, gws: explodingGws });
assert.strictEqual(gwsCallCount, 0, 'dry-run must not invoke gws');
assert.strictEqual(dryRunResult.mode, 'dry-run');
assert.strictEqual(dryRunResult.counts.planned, 4, '2 projects + 1 milestone + 1 link = 4');
assert.strictEqual(dryRunResult.counts.errors, 0);
assert.strictEqual(dryRunResult.per_sheet.projects.planned, 2);
assert.strictEqual(dryRunResult.per_sheet.milestones.planned, 1);
assert.strictEqual(dryRunResult.per_sheet.links.planned, 1);
assert.deepStrictEqual(dryRunResult.per_sheet.projects.supabase_ids, [1, 2]);

console.log('dry-run no-gws-call ok');

// --- 3. live path: fake in-memory gws, idempotent skip on rerun ---

function makeFakeGws() {
  const spreadsheetId = 'fake-spreadsheet-id';
  const sheets = {
    projects: [SHEET_HEADERS.projects.slice()],
    milestones: [SHEET_HEADERS.milestones.slice()],
    links: [SHEET_HEADERS.links.slice()]
  };
  let callCount = 0;

  const gws = (args) => {
    callCount += 1;
    const [group, resource, action] = args;

    if (group === 'drive' && resource === 'files' && action === 'list') {
      return { files: [{ id: spreadsheetId, name: 'Askewly Command Catalog' }] };
    }
    if (group === 'sheets' && resource === 'spreadsheets' && action === 'get') {
      return { sheets: Object.keys(sheets).map((title) => ({ properties: { title } })) };
    }
    if (group === 'sheets' && resource === 'spreadsheets' && action === 'values') {
      const sub = args[3];
      const paramsArg = JSON.parse(args[args.indexOf('--params') + 1]);
      const sheetName = paramsArg.range.split('!')[0];
      if (sub === 'get') {
        return { values: sheets[sheetName] };
      }
      if (sub === 'append') {
        const jsonArg = JSON.parse(args[args.indexOf('--json') + 1]);
        sheets[sheetName].push(...jsonArg.values);
        return { updates: { updatedRows: jsonArg.values.length } };
      }
    }
    throw new Error(`fake gws: unhandled call ${JSON.stringify(args)}`);
  };

  gws.getCallCount = () => callCount;
  gws.getSheets = () => sheets;
  return gws;
}

const fakeGws = makeFakeGws();
const firstLive = migrate(fixtureExport, { live: true, gws: fakeGws });
assert.strictEqual(firstLive.mode, 'live');
assert.strictEqual(firstLive.counts.created, 4);
assert.strictEqual(firstLive.counts.skipped, 0);
assert.strictEqual(firstLive.per_sheet.projects.created, 2);
assert.strictEqual(firstLive.per_sheet.milestones.created, 1);
assert.strictEqual(firstLive.per_sheet.links.created, 1);

console.log('live first-run created ok');

const secondLive = migrate(fixtureExport, { live: true, gws: fakeGws });
assert.strictEqual(secondLive.counts.created, 0, 'rerun must create 0 new rows (idempotent)');
assert.strictEqual(secondLive.counts.skipped, 4, 'rerun must skip all 4 previously-created rows');

console.log('live idempotent rerun ok (created 0 on rerun)');

// --- 4. failure paths ---

assert.throws(() => readExportFile(path.join(os.tmpdir(), 'does-not-exist-askewly-catalog.json')), /File not found/);

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'askewly-sheets-catalog-verify-'));
const badJsonPath = path.join(tmpDir, 'bad.json');
fs.writeFileSync(badJsonPath, '{ not valid json');
assert.throws(() => readExportFile(badJsonPath), /Malformed JSON/);

const missingKeysPath = path.join(tmpDir, 'missing-keys.json');
fs.writeFileSync(missingKeysPath, JSON.stringify({ source: 'x', exported_at: 'x' }));
assert.throws(() => readExportFile(missingKeysPath), /missing expected array key/);

console.log('failure paths ok');

console.log('google sheets catalog migrate verify ok: mapping, dry-run no-gws-call, live idempotent skip, and failure paths');
