#!/usr/bin/env node
'use strict';

const assert = require('assert');
const catalog = require('./lib/google-workspace-catalog');

const state = {
  files: [],
  spreadsheets: new Map(),
  nextFile: 1,
  nextSpreadsheet: 1
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function flagValue(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? JSON.parse(args[index + 1]) : undefined;
}

function pathTokens(args) {
  const flagIndex = args.findIndex((token) => token.startsWith('--'));
  return args.slice(0, flagIndex < 0 ? args.length : flagIndex);
}

function sheetNameFromRange(range) {
  return String(range).split('!')[0];
}

function startRowFromRange(range) {
  const cellPart = String(range).split('!')[1] || 'A1';
  const match = /^[A-Z]+(\d+)/.exec(cellPart);
  return match ? Number(match[1]) : 1;
}

function fakeGws(args) {
  const tokens = pathTokens(args);
  const key = tokens.join('.');

  if (key === 'drive.files.list') {
    const params = flagValue(args, '--params');
    const match = /name = '([^']+)'/.exec(params.q);
    const wantedName = match ? match[1] : null;
    const files = state.files.filter((file) => !wantedName || file.name === wantedName);
    return { files: clone(files) };
  }

  if (key === 'sheets.spreadsheets.create') {
    const body = flagValue(args, '--json');
    const spreadsheetId = `spreadsheet-${state.nextSpreadsheet++}`;
    const sheets = (body.sheets || []).map((sheet) => ({ properties: { title: sheet.properties.title } }));
    state.spreadsheets.set(spreadsheetId, {
      properties: { title: body.properties.title },
      sheets,
      values: {}
    });
    state.files.push({ id: spreadsheetId, name: body.properties.title });
    return { spreadsheetId, properties: body.properties, sheets };
  }

  if (key === 'sheets.spreadsheets.get') {
    const params = flagValue(args, '--params');
    const sheet = state.spreadsheets.get(params.spreadsheetId);
    if (!sheet) throw new Error(`missing spreadsheet ${params.spreadsheetId}`);
    return { spreadsheetId: params.spreadsheetId, properties: sheet.properties, sheets: clone(sheet.sheets) };
  }

  if (key === 'sheets.spreadsheets.batchUpdate') {
    const params = flagValue(args, '--params');
    const body = flagValue(args, '--json');
    const sheet = state.spreadsheets.get(params.spreadsheetId);
    if (!sheet) throw new Error(`missing spreadsheet ${params.spreadsheetId}`);
    for (const request of body.requests || []) {
      if (request.addSheet) sheet.sheets.push({ properties: { title: request.addSheet.properties.title } });
    }
    return {};
  }

  if (key === 'sheets.spreadsheets.values.get') {
    const params = flagValue(args, '--params');
    const sheet = state.spreadsheets.get(params.spreadsheetId);
    if (!sheet) throw new Error(`missing spreadsheet ${params.spreadsheetId}`);
    const sheetName = sheetNameFromRange(params.range);
    return { values: clone(sheet.values[sheetName] || []) };
  }

  if (key === 'sheets.spreadsheets.values.update') {
    const params = flagValue(args, '--params');
    const body = flagValue(args, '--json');
    const sheet = state.spreadsheets.get(params.spreadsheetId);
    if (!sheet) throw new Error(`missing spreadsheet ${params.spreadsheetId}`);
    const sheetName = sheetNameFromRange(params.range);
    const startRow = startRowFromRange(params.range);
    sheet.values[sheetName] = sheet.values[sheetName] || [];
    body.values.forEach((row, offset) => {
      sheet.values[sheetName][startRow - 1 + offset] = row;
    });
    return {};
  }

  if (key === 'sheets.spreadsheets.values.append') {
    const params = flagValue(args, '--params');
    const body = flagValue(args, '--json');
    const sheet = state.spreadsheets.get(params.spreadsheetId);
    if (!sheet) throw new Error(`missing spreadsheet ${params.spreadsheetId}`);
    const sheetName = sheetNameFromRange(params.range);
    sheet.values[sheetName] = sheet.values[sheetName] || [];
    for (const row of body.values) sheet.values[sheetName].push(row);
    return {};
  }

  throw new Error(`unexpected gws args: ${args.join(' ')}`);
}

// 1. ensureSpreadsheet creates when missing.
const first = catalog.ensureSpreadsheet(fakeGws);
assert.strictEqual(first.created, true);
assert.ok(first.spreadsheetId);
assert.strictEqual(state.files.length, 1);
assert.strictEqual(state.files[0].name, catalog.CATALOG_SPREADSHEET_TITLE);
for (const sheetName of Object.keys(catalog.SHEET_HEADERS)) {
  const stored = state.spreadsheets.get(first.spreadsheetId).values[sheetName];
  assert.deepStrictEqual(stored[0], catalog.SHEET_HEADERS[sheetName]);
}

// 2. ensureSpreadsheet reuses when present (idempotent, no duplicate sheets/headers).
const second = catalog.ensureSpreadsheet(fakeGws);
assert.strictEqual(second.spreadsheetId, first.spreadsheetId);
assert.strictEqual(second.created, false);
assert.strictEqual(state.files.length, 1);
assert.strictEqual(state.spreadsheets.get(first.spreadsheetId).sheets.length, 3);

// 3 & 4. appendRows column order + readRows header mapping.
catalog.appendRows(first.spreadsheetId, 'projects', [
  {
    name: 'Askewly Command',
    supabase_id: 101,
    status: 'active',
    sort_order: 1,
    created_at: '2026-01-01T00:00:00.000Z'
  },
  {
    supabase_id: 102,
    status: 'paused',
    name: 'Side Quest',
    sort_order: 2,
    created_at: '2026-01-02T00:00:00.000Z'
  },
  {
    supabase_id: 103,
    name: 'Old Project',
    status: 'archived',
    sort_order: 3,
    created_at: '2026-01-03T00:00:00.000Z'
  }
], fakeGws);

const rawProjectRows = state.spreadsheets.get(first.spreadsheetId).values.projects.slice(1);
assert.strictEqual(rawProjectRows[0][catalog.SHEET_HEADERS.projects.indexOf('supabase_id')], 101);
assert.strictEqual(rawProjectRows[0][catalog.SHEET_HEADERS.projects.indexOf('name')], 'Askewly Command');

const projectRows = catalog.readRows(first.spreadsheetId, 'projects', fakeGws);
assert.strictEqual(projectRows.length, 3);
assert.strictEqual(projectRows[0].name, 'Askewly Command');
assert.strictEqual(String(projectRows[0].supabase_id), '101');

catalog.appendRows(first.spreadsheetId, 'milestones', [
  { supabase_id: 201, project_id: 101, title: 'Ship v1', status: 'done' },
  { supabase_id: 202, project_id: 102, title: 'Kickoff', status: 'todo' }
], fakeGws);
catalog.appendRows(first.spreadsheetId, 'links', [
  { supabase_id: 301, project_id: 101, kind: 'github', title: 'repo', target: 'https://example.com/repo' }
], fakeGws);

// 5. listProjects status filtering + case-insensitive name matching.
const activeDefault = catalog.listProjects({}, fakeGws);
assert.strictEqual(activeDefault.length, 2);
assert.ok(activeDefault.every((row) => row.status !== 'archived'));

const allStatuses = catalog.listProjects({ status: 'all' }, fakeGws);
assert.strictEqual(allStatuses.length, 3);

const pausedOnly = catalog.listProjects({ status: 'paused' }, fakeGws);
assert.strictEqual(pausedOnly.length, 1);
assert.strictEqual(pausedOnly[0].name, 'Side Quest');

const nameMatch = catalog.listProjects({ name: 'askewly command' }, fakeGws);
assert.strictEqual(nameMatch.length, 1);
assert.strictEqual(String(nameMatch[0].supabase_id), '101');

// 6. showProject joins milestones/links.
const shownByName = catalog.showProject({ name: 'Askewly Command' }, fakeGws);
assert.strictEqual(String(shownByName.project.supabase_id), '101');
assert.strictEqual(shownByName.milestones.length, 1);
assert.strictEqual(shownByName.milestones[0].title, 'Ship v1');
assert.strictEqual(shownByName.links.length, 1);
assert.strictEqual(shownByName.links[0].title, 'repo');

const shownById = catalog.showProject({ id: 102 }, fakeGws);
assert.strictEqual(shownById.project.name, 'Side Quest');
assert.strictEqual(shownById.milestones.length, 1);
assert.strictEqual(shownById.links.length, 0);

// 7. failure path: showProject on nonexistent name throws a clear error.
assert.throws(() => catalog.showProject({ name: 'Does Not Exist' }, fakeGws), /Project not found: Does Not Exist/);

// 8. createProject appends a new row with a local id when the name is new.
const beforeCreateCount = state.spreadsheets.get(first.spreadsheetId).values.projects.length;
const created = catalog.createProject({ name: 'Brand New Project', description: 'fresh', pinned: false }, fakeGws);
assert.ok(String(created.supabase_id).startsWith('local-'));
assert.strictEqual(created.name, 'Brand New Project');
assert.strictEqual(created.status, 'active');
assert.strictEqual(created.description, 'fresh');
assert.ok(created.created_at);
assert.strictEqual(created.created_at, created.updated_at);
assert.strictEqual(state.spreadsheets.get(first.spreadsheetId).values.projects.length, beforeCreateCount + 1);

// 9. createProject is idempotent by normalized name (case-insensitive/trim) -- no new row.
const recreated = catalog.createProject({ name: '  brand new project  ' }, fakeGws);
assert.strictEqual(String(recreated.supabase_id), String(created.supabase_id));
assert.strictEqual(state.spreadsheets.get(first.spreadsheetId).values.projects.length, beforeCreateCount + 1);

// 10. createProject with --pinned gets a negative sort_order.
const createdPinned = catalog.createProject({ name: 'Pinned From Birth', pinned: true }, fakeGws);
assert.ok(Number(createdPinned.sort_order) < 0);

// 11. updateProject patches fields and bumps updated_at, locating by name.
const updated = catalog.updateProject({ name: 'Brand New Project' }, { description: 'updated desc', roadmap_note: 'note' }, fakeGws);
assert.strictEqual(updated.description, 'updated desc');
assert.strictEqual(updated.roadmap_note, 'note');
assert.strictEqual(updated.name, 'Brand New Project');
assert.ok(updated.updated_at);
assert.ok(new Date(updated.updated_at).getTime() >= new Date(created.created_at).getTime());

// 12. updateProject can locate by supabase_id and rename.
const renamed = catalog.updateProject({ id: created.supabase_id }, { name: 'Renamed Project' }, fakeGws);
assert.strictEqual(renamed.name, 'Renamed Project');
assert.strictEqual(catalog.showProject({ name: 'Renamed Project' }, fakeGws).project.description, 'updated desc');

// 13. updateProject on a nonexistent selector throws a clear error.
assert.throws(() => catalog.updateProject({ name: 'Ghost Project' }, { description: 'x' }, fakeGws), /Project not found: Ghost Project/);

// 14. setProjectPinned(true) sets a negative sort_order; (false) restores a positive one.
const pinned = catalog.setProjectPinned({ name: 'Renamed Project' }, true, fakeGws);
assert.ok(Number(pinned.sort_order) < 0);
const unpinned = catalog.setProjectPinned({ name: 'Renamed Project' }, false, fakeGws);
assert.ok(Number(unpinned.sort_order) >= 0);

// 15. archiveProject sets status=archived and archived_at, and is excluded from default listProjects.
const archived = catalog.archiveProject({ name: 'Renamed Project' }, fakeGws);
assert.strictEqual(archived.status, 'archived');
assert.ok(archived.archived_at);
const defaultAfterArchive = catalog.listProjects({}, fakeGws);
assert.ok(!defaultAfterArchive.some((row) => row.name === 'Renamed Project'));

// 16. archiveProject on a nonexistent selector throws a clear error.
assert.throws(() => catalog.archiveProject({ name: 'Ghost Project' }, fakeGws), /Project not found: Ghost Project/);

console.log('google sheets catalog verify ok: ensureSpreadsheet/readRows/appendRows/listProjects/showProject/createProject/updateProject/setProjectPinned/archiveProject');
