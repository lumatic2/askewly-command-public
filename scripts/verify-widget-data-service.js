#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const dataService = require('../widget/data-service');

// ---- fake gws combining calendar + tasks + sheets-catalog surfaces -------
const state = {
  lists: [],
  tasks: new Map(),
  nextList: 1,
  nextTask: 1,
  events: [],
  files: [],
  spreadsheets: new Map(),
  nextSpreadsheet: 1
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function flagValue(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? JSON.parse(args[index + 1]) : undefined;
}

function sheetNameFromRange(range) {
  return String(range).split('!')[0];
}

function startRowFromRange(range) {
  const cellPart = String(range).split('!')[1] || 'A1';
  const match = /^[A-Z]+(\d+)/.exec(cellPart);
  return match ? Number(match[1]) : 1;
}

let calendarCallArgs = null;

function fakeGws(args) {
  const [api, resource, method] = args;

  if (api === 'calendar' && resource === 'events' && method === 'list') {
    calendarCallArgs = flagValue(args, '--params');
    return { items: clone(state.events) };
  }

  if (api === 'calendar' && resource === 'events' && method === 'patch') {
    const params = flagValue(args, '--params');
    const body = flagValue(args, '--json');
    const event = state.events.find((candidate) => candidate.id === params.eventId);
    if (!event) throw new Error(`missing event ${params.eventId}`);
    if (body.summary !== undefined) event.summary = body.summary;
    if (body.location !== undefined) event.location = body.location;
    if (body.description !== undefined) event.description = body.description;
    if (body.start) event.start = body.start;
    if (body.end) event.end = body.end;
    return clone(event);
  }

  if (api === 'calendar' && resource === 'events' && method === 'delete') {
    const params = flagValue(args, '--params');
    const index = state.events.findIndex((candidate) => candidate.id === params.eventId);
    if (index >= 0) state.events.splice(index, 1);
    return {};
  }

  if (api === 'tasks') {
    if (resource === 'tasklists' && method === 'list') return { items: clone(state.lists) };
    if (resource === 'tasklists' && method === 'insert') {
      const body = flagValue(args, '--json');
      const list = { id: `list-${state.nextList++}`, title: body.title };
      state.lists.push(list);
      state.tasks.set(list.id, []);
      return clone(list);
    }
    if (resource === 'tasks' && method === 'insert') {
      const params = flagValue(args, '--params');
      const body = flagValue(args, '--json');
      const task = { id: `task-${state.nextTask++}`, ...body, updated: new Date().toISOString() };
      state.tasks.get(params.tasklist).push(task);
      return clone(task);
    }
    if (resource === 'tasks' && method === 'list') {
      const params = flagValue(args, '--params');
      const tasks = state.tasks.get(params.tasklist) || [];
      return {
        items: clone(tasks.filter((task) => params.showCompleted || task.status !== 'completed').slice(0, params.maxResults || 100))
      };
    }
    if (resource === 'tasks' && method === 'patch') {
      const params = flagValue(args, '--params');
      const body = flagValue(args, '--json');
      const tasks = state.tasks.get(params.tasklist) || [];
      const task = tasks.find((candidate) => candidate.id === params.task);
      if (!task) throw new Error(`missing task ${params.task}`);
      Object.assign(task, body, { updated: new Date().toISOString() });
      return clone(task);
    }
    if (resource === 'tasks' && method === 'delete') {
      const params = flagValue(args, '--params');
      const tasks = state.tasks.get(params.tasklist) || [];
      const index = tasks.findIndex((candidate) => candidate.id === params.task);
      if (index >= 0) tasks.splice(index, 1);
      return {};
    }
  }

  if (api === 'drive' && resource === 'files' && method === 'list') {
    const params = flagValue(args, '--params');
    const match = /name = '([^']+)'/.exec(params.q);
    const wantedName = match ? match[1] : null;
    return { files: clone(state.files.filter((file) => !wantedName || file.name === wantedName)) };
  }

  if (api === 'sheets' && resource === 'spreadsheets') {
    if (method === 'create') {
      const body = flagValue(args, '--json');
      const spreadsheetId = `spreadsheet-${state.nextSpreadsheet++}`;
      const sheets = (body.sheets || []).map((sheet) => ({ properties: { title: sheet.properties.title } }));
      state.spreadsheets.set(spreadsheetId, { properties: body.properties, sheets, values: {} });
      state.files.push({ id: spreadsheetId, name: body.properties.title });
      return { spreadsheetId, properties: body.properties, sheets };
    }
    if (method === 'get') {
      const params = flagValue(args, '--params');
      const sheet = state.spreadsheets.get(params.spreadsheetId);
      if (!sheet) throw new Error(`missing spreadsheet ${params.spreadsheetId}`);
      return { spreadsheetId: params.spreadsheetId, properties: sheet.properties, sheets: clone(sheet.sheets) };
    }
    if (method === 'batchUpdate') {
      const params = flagValue(args, '--params');
      const body = flagValue(args, '--json');
      const sheet = state.spreadsheets.get(params.spreadsheetId);
      if (!sheet) throw new Error(`missing spreadsheet ${params.spreadsheetId}`);
      for (const request of body.requests || []) {
        if (request.addSheet) sheet.sheets.push({ properties: { title: request.addSheet.properties.title } });
      }
      return {};
    }
  }

  if (args[0] === 'sheets' && args[1] === 'spreadsheets' && args[2] === 'values') {
    const valuesMethod = args[3];
    if (valuesMethod === 'get') {
      const params = flagValue(args, '--params');
      const sheet = state.spreadsheets.get(params.spreadsheetId);
      if (!sheet) throw new Error(`missing spreadsheet ${params.spreadsheetId}`);
      const sheetName = sheetNameFromRange(params.range);
      return { values: clone(sheet.values[sheetName] || []) };
    }
    if (valuesMethod === 'update') {
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
    if (valuesMethod === 'append') {
      const params = flagValue(args, '--params');
      const body = flagValue(args, '--json');
      const sheet = state.spreadsheets.get(params.spreadsheetId);
      if (!sheet) throw new Error(`missing spreadsheet ${params.spreadsheetId}`);
      const sheetName = sheetNameFromRange(params.range);
      sheet.values[sheetName] = sheet.values[sheetName] || [];
      for (const row of body.values) sheet.values[sheetName].push(row);
      return {};
    }
  }

  throw new Error(`unexpected gws args: ${args.join(' ')}`);
}

function failingGws() {
  throw new Error('simulated gws network failure');
}

// Seed one pinned + one unpinned project directly into the fake catalog
// backing store via the real catalog lib (through fakeGws), so getSnapshot's
// listPinnedProjects() filter is exercised against real listProjects() logic.
const googleCatalog = require('../scripts/lib/google-workspace-catalog');
const { spreadsheetId } = googleCatalog.ensureSpreadsheet(fakeGws);
googleCatalog.appendRows(spreadsheetId, 'projects', [
  { supabase_id: 1, name: 'Pinned Project', status: 'active', sort_order: -1000001, created_at: '2026-01-01T00:00:00.000Z' },
  { supabase_id: 2, name: 'Unpinned Project', status: 'active', sort_order: 5, created_at: '2026-01-02T00:00:00.000Z' }
], fakeGws);

// Seed one calendar event.
state.events.push({
  id: 'evt-1',
  summary: 'Standup',
  start: { dateTime: '2026-07-10T09:00:00+09:00' },
  end: { dateTime: '2026-07-10T09:30:00+09:00' },
  htmlLink: 'https://calendar.google.com/event?eid=evt-1'
});

// ---- 1. snapshot shape: all keys present --------------------------------
const snapshot = dataService.getSnapshot(fakeGws);
assert.ok(snapshot.date, 'snapshot.date present');
assert.ok(Array.isArray(snapshot.events), 'snapshot.events is an array');
assert.ok(snapshot.tasks && typeof snapshot.tasks === 'object', 'snapshot.tasks present');
assert.ok(Array.isArray(snapshot.tasks.today), 'snapshot.tasks.today is an array');
assert.ok(Array.isArray(snapshot.tasks.backlog), 'snapshot.tasks.backlog is an array');
assert.ok(!('deadlines' in snapshot.tasks), 'snapshot no longer fetches the deadlines section (round 3: DEADLINES removed from the widget UI)');
assert.ok(Array.isArray(snapshot.pinnedProjects), 'snapshot.pinnedProjects is an array');
assert.ok(Array.isArray(snapshot.projects), 'snapshot.projects is an array');
assert.ok(snapshot.fetchedAt, 'snapshot.fetchedAt present');
assert.strictEqual(snapshot.events.length, 1);
assert.strictEqual(snapshot.events[0].summary, 'Standup');

// ---- 2. calendar time-window params: KST day bounds ---------------------
const { dateStr, timeMin, timeMax } = dataService.kstDayBoundsIso();
assert.ok(calendarCallArgs, 'calendar.events.list was called');
assert.strictEqual(calendarCallArgs.calendarId, 'primary');
assert.strictEqual(calendarCallArgs.timeMin, timeMin);
assert.strictEqual(calendarCallArgs.timeMax, timeMax);
assert.strictEqual(calendarCallArgs.singleEvents, true);
assert.strictEqual(calendarCallArgs.orderBy, 'startTime');
assert.strictEqual(snapshot.date, dateStr);
assert.ok(/^\d{4}-\d{2}-\d{2}T00:00:00\+09:00$/.test(timeMin));
assert.ok(/^\d{4}-\d{2}-\d{2}T23:59:59\+09:00$/.test(timeMax));

// ---- 3. pinned filter -----------------------------------------------------
assert.strictEqual(snapshot.pinnedProjects.length, 1);
assert.strictEqual(snapshot.pinnedProjects[0].name, 'Pinned Project');
assert.ok(!snapshot.pinnedProjects.some((row) => row.name === 'Unpinned Project'));

// ---- 3b. projects catalog: non-archived, ordered (pinned sort_order first) ----
assert.strictEqual(snapshot.projects.length, 2, 'snapshot.projects includes both non-archived rows');
assert.strictEqual(snapshot.projects[0].name, 'Pinned Project', 'pinned project sorts first by sort_order');
assert.strictEqual(snapshot.projects[1].name, 'Unpinned Project');

// ---- 4. cache fallback: gws failure returns cached snapshot as stale ----
const staleSnapshot = dataService.getSnapshot(failingGws);
assert.strictEqual(staleSnapshot.stale, true);
assert.ok(staleSnapshot.error, 'stale snapshot carries the error message');
assert.strictEqual(staleSnapshot.date, snapshot.date);
assert.strictEqual(staleSnapshot.events.length, 1);

// Also verify the on-disk cache file survives a fresh module load (simulates
// a fresh process with no in-memory lastGoodSnapshot).
assert.ok(fs.existsSync(dataService.CACHE_FILE), 'cache file was written');
delete require.cache[require.resolve('../widget/data-service')];
const freshDataService = require('../widget/data-service');
const staleFromDisk = freshDataService.getSnapshot(failingGws);
assert.strictEqual(staleFromDisk.stale, true);
assert.strictEqual(staleFromDisk.date, snapshot.date);

// ---- 5. CRUD wrappers delegate with correct args -------------------------
const added = dataService.taskAdd({ title: 'Widget CRUD fixture', section: 'today', detail: 'fixture' }, fakeGws);
assert.strictEqual(added.title, 'Widget CRUD fixture');
assert.strictEqual(added.section, 'today');
assert.strictEqual(added.status, 'todo');

const toggled = dataService.taskToggle({ id: added.id }, fakeGws);
assert.strictEqual(toggled.status, 'done');

const untoggled = dataService.taskToggle({ id: added.id, status: 'todo' }, fakeGws);
assert.strictEqual(untoggled.status, 'todo');

const deferred = dataService.taskDefer({ id: added.id, section: 'backlog' }, fakeGws);
assert.strictEqual(deferred.section, 'backlog');
assert.notStrictEqual(deferred.id, added.id);

const edited = dataService.taskUpdate({ id: deferred.id, title: 'Widget CRUD fixture (edited)' }, fakeGws);
assert.strictEqual(edited.title, 'Widget CRUD fixture (edited)');

// ---- 6. calendar eventUpdate/eventDelete delegation ----------------------
const updatedEvent = dataService.eventUpdate({
  id: 'evt-1',
  summary: 'Standup (수정)',
  startIso: '2026-07-10T10:00:00+09:00',
  endIso: '2026-07-10T10:30:00+09:00'
}, fakeGws);
assert.strictEqual(updatedEvent.id, 'evt-1');
assert.strictEqual(updatedEvent.summary, 'Standup (수정)');
assert.strictEqual(updatedEvent.start, '2026-07-10T10:00:00+09:00');
assert.strictEqual(updatedEvent.end, '2026-07-10T10:30:00+09:00');

const titleOnlyEvent = dataService.eventUpdate({ id: 'evt-1', summary: 'Standup (제목만)' }, fakeGws);
assert.strictEqual(titleOnlyEvent.summary, 'Standup (제목만)');
assert.strictEqual(titleOnlyEvent.start, '2026-07-10T10:00:00+09:00', 'title-only update leaves start/end untouched');
assert.strictEqual(titleOnlyEvent.end, '2026-07-10T10:30:00+09:00');

// ---- 6b. eventUpdate: location/description patch (round 3) --------------
const withDetails = dataService.eventUpdate({ id: 'evt-1', location: '회의실 A', description: '분기 리뷰 준비' }, fakeGws);
assert.strictEqual(withDetails.location, '회의실 A', 'eventUpdate patches location');
assert.strictEqual(withDetails.description, '분기 리뷰 준비', 'eventUpdate patches description');
assert.strictEqual(withDetails.summary, 'Standup (제목만)', 'summary untouched when only location/description are sent');

const clearedDetails = dataService.eventUpdate({ id: 'evt-1', location: '', description: '' }, fakeGws);
assert.strictEqual(clearedDetails.location, null, 'eventUpdate can clear location (eventRow normalizes empty string to null)');
assert.strictEqual(clearedDetails.description, null, 'eventUpdate can clear description (eventRow normalizes empty string to null)');

// ---- 6c. snapshot events carry location/description passthrough ---------
state.events.push({
  id: 'evt-2',
  summary: 'Detail fixture',
  start: { dateTime: '2026-07-10T11:00:00+09:00' },
  end: { dateTime: '2026-07-10T11:30:00+09:00' },
  location: '카페',
  description: '메모 본문'
});
const snapshotWithDetails = dataService.getSnapshot(fakeGws);
const detailEvent = snapshotWithDetails.events.find((event) => event.id === 'evt-2');
assert.ok(detailEvent, 'snapshot includes the newly seeded event');
assert.strictEqual(detailEvent.location, '카페', 'snapshot event carries location');
assert.strictEqual(detailEvent.description, '메모 본문', 'snapshot event carries description');
const noDetailEvent = snapshotWithDetails.events.find((event) => event.id === 'evt-1');
assert.strictEqual(noDetailEvent.location, null, 'cleared (empty-string) location normalizes to null via eventRow');

const deleteResult = dataService.eventDelete({ id: 'evt-1' }, fakeGws);
assert.strictEqual(deleteResult.deleted, true);
assert.strictEqual(state.events.length, 1, 'eventDelete removes only the targeted event from calendar state');

// ---- 7. eventsRange: params + 5-minute month cache -----------------------
let rangeCallCount = 0;
const countingGws = (args) => {
  if (args[0] === 'calendar' && args[1] === 'events' && args[2] === 'list') rangeCallCount += 1;
  return fakeGws(args);
};

const monthMin = '2026-07-01T00:00:00+09:00';
const monthMax = '2026-07-31T23:59:59+09:00';
const rangeResult = dataService.eventsRange({ timeMinIso: monthMin, timeMaxIso: monthMax }, countingGws);
assert.strictEqual(rangeCallCount, 1, 'first eventsRange call hits gws once');
assert.strictEqual(rangeResult.cached, false, 'first call is not served from cache');
assert.ok(Array.isArray(rangeResult.events), 'eventsRange returns an events array');
assert.ok(rangeResult.events.some((event) => event.id === 'evt-2'), 'eventsRange includes the seeded event within the month window');

const rangeResultAgain = dataService.eventsRange({ timeMinIso: monthMin, timeMaxIso: monthMax }, countingGws);
assert.strictEqual(rangeCallCount, 1, 'second eventsRange call for the same month key is served from cache (no extra gws call)');
assert.strictEqual(rangeResultAgain.cached, true, 'second call is marked cached');
assert.deepStrictEqual(rangeResultAgain.events, rangeResult.events, 'cached result matches the original fetch');

const differentMonthMin = '2026-08-01T00:00:00+09:00';
const differentMonthMax = '2026-08-31T23:59:59+09:00';
dataService.eventsRange({ timeMinIso: differentMonthMin, timeMaxIso: differentMonthMax }, countingGws);
assert.strictEqual(rangeCallCount, 2, 'a different month key is not served from the first month\'s cache');

assert.throws(() => dataService.eventsRange({}, countingGws), /timeMinIso/, 'eventsRange requires timeMinIso/timeMaxIso');

console.log('widget data-service verify ok: snapshot shape (no deadlines)/calendar params/pinned filter/cache fallback/CRUD delegation/event edit-delete+location-description delegation/eventsRange+month cache');
