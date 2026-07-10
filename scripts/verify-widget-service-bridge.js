#!/usr/bin/env node
'use strict';

// Exercises widget/service-bridge.js + widget/gws-worker.js in plain Node (no
// Electron needed): a real worker_thread round-trips a snapshot fetch and one
// CRUD op against a fake gws, and a single-flight assertion confirms two
// concurrent snapshot calls only run the underlying gws call chain once.
//
// The fake gws is injected via GWS_WORKER_TEST_HOOK: gws-worker.js requires
// that module (if set) before loading data-service.js, letting it monkeypatch
// child_process.spawnSync ahead of any spawnSync call. The hook also appends
// one line per calendar.events.list call to GWS_WORKER_TEST_CALL_LOG so this
// script can count how many times the underlying fetch actually ran.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const hookPath = path.join(os.tmpdir(), `askewly-gws-worker-test-hook-${process.pid}.js`);
const callLogPath = path.join(os.tmpdir(), `askewly-gws-worker-test-calls-${process.pid}.log`);

const hookSource = `
'use strict';
const fs = require('fs');
const cp = require('child_process');

const callLogPath = ${JSON.stringify(callLogPath)};
const state = {
  lists: [],
  tasks: new Map(),
  nextList: 1,
  nextTask: 1,
  events: [{
    id: 'evt-1',
    summary: 'Standup',
    start: { dateTime: '2026-07-10T09:00:00+09:00' },
    end: { dateTime: '2026-07-10T09:30:00+09:00' }
  }],
  files: [],
  spreadsheets: new Map(),
  nextSpreadsheet: 1
};

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function flagValue(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? JSON.parse(args[index + 1]) : undefined;
}

function fakeDispatch(args) {
  const [api, resource, method] = args;

  if (api === 'calendar' && resource === 'events' && method === 'list') {
    fs.appendFileSync(callLogPath, 'calendar.events.list\\n');
    return { items: clone(state.events) };
  }

  if (api === 'tasks') {
    if (resource === 'tasklists' && method === 'list') return { items: clone(state.lists) };
    if (resource === 'tasklists' && method === 'insert') {
      const body = flagValue(args, '--json');
      const list = { id: 'list-' + state.nextList++, title: body.title };
      state.lists.push(list);
      state.tasks.set(list.id, []);
      return clone(list);
    }
    if (resource === 'tasks' && method === 'insert') {
      const params = flagValue(args, '--params');
      const body = flagValue(args, '--json');
      const task = Object.assign({ id: 'task-' + state.nextTask++ }, body, { updated: new Date().toISOString() });
      state.tasks.get(params.tasklist).push(task);
      return clone(task);
    }
    if (resource === 'tasks' && method === 'list') {
      const params = flagValue(args, '--params');
      const tasks = state.tasks.get(params.tasklist) || [];
      return { items: clone(tasks.filter((t) => params.showCompleted || t.status !== 'completed').slice(0, params.maxResults || 100)) };
    }
    if (resource === 'tasks' && method === 'patch') {
      const params = flagValue(args, '--params');
      const body = flagValue(args, '--json');
      const tasks = state.tasks.get(params.tasklist) || [];
      const task = tasks.find((t) => t.id === params.task);
      if (!task) throw new Error('missing task ' + params.task);
      Object.assign(task, body, { updated: new Date().toISOString() });
      return clone(task);
    }
  }

  if (api === 'drive' && resource === 'files' && method === 'list') {
    return { files: clone(state.files) };
  }

  if (api === 'sheets' && resource === 'spreadsheets') {
    if (method === 'create') {
      const body = flagValue(args, '--json');
      const spreadsheetId = 'spreadsheet-' + state.nextSpreadsheet++;
      const sheets = (body.sheets || []).map((s) => ({ properties: { title: s.properties.title } }));
      state.spreadsheets.set(spreadsheetId, { properties: body.properties, sheets, values: {} });
      state.files.push({ id: spreadsheetId, name: body.properties.title });
      return { spreadsheetId, properties: body.properties, sheets };
    }
    if (method === 'get') {
      const params = flagValue(args, '--params');
      const sheet = state.spreadsheets.get(params.spreadsheetId);
      return { spreadsheetId: params.spreadsheetId, properties: sheet.properties, sheets: clone(sheet.sheets) };
    }
    if (method === 'batchUpdate') return {};
  }

  if (args[0] === 'sheets' && args[1] === 'spreadsheets' && args[2] === 'values') {
    const valuesMethod = args[3];
    const params = flagValue(args, '--params');
    const sheet = state.spreadsheets.get(params.spreadsheetId);
    const sheetName = String(params.range).split('!')[0];
    if (valuesMethod === 'get') return { values: clone(sheet.values[sheetName] || []) };
    if (valuesMethod === 'update' || valuesMethod === 'append') {
      const body = flagValue(args, '--json');
      sheet.values[sheetName] = sheet.values[sheetName] || [];
      for (const row of body.values) sheet.values[sheetName].push(row);
      return {};
    }
  }

  throw new Error('unexpected fake gws args: ' + args.join(' '));
}

cp.spawnSync = function fakeSpawnSync(_command, args) {
  try {
    const result = fakeDispatch(args);
    return { stdout: JSON.stringify(result), stderr: '', status: 0, error: null };
  } catch (error) {
    return { stdout: '', stderr: String(error && error.message || error), status: 1, error: null };
  }
};
`;

fs.writeFileSync(hookPath, hookSource, 'utf8');
fs.writeFileSync(callLogPath, '', 'utf8');

process.env.GWS_WORKER_TEST_HOOK = hookPath;

async function main() {
  const { ServiceBridge } = require('../widget/service-bridge');
  const bridge = new ServiceBridge();

  try {
    // ---- 1. snapshot round-trip through a real worker thread --------------
    const snapshot = await bridge.call('snapshot');
    assert.ok(snapshot.date, 'snapshot.date present');
    assert.strictEqual(snapshot.events.length, 1);
    assert.strictEqual(snapshot.events[0].summary, 'Standup');
    assert.ok(Array.isArray(snapshot.tasks.today), 'snapshot.tasks.today is an array');

    // ---- 2. one CRUD op round-trip -----------------------------------------
    const added = await bridge.call('taskAdd', { title: 'Bridge fixture task', section: 'today' });
    assert.strictEqual(added.title, 'Bridge fixture task');
    assert.strictEqual(added.section, 'today');

    // ---- 3. single-flight: two concurrent snapshot calls, one fetch -------
    fs.writeFileSync(callLogPath, '', 'utf8'); // reset counter after step 1's fetch
    const [first, second] = await Promise.all([bridge.call('snapshot'), bridge.call('snapshot')]);
    assert.deepStrictEqual(first, second, 'concurrent snapshot calls resolve to the same result');
    const callCount = fs.readFileSync(callLogPath, 'utf8').split('\n').filter((line) => line.trim() === 'calendar.events.list').length;
    assert.strictEqual(callCount, 1, `expected exactly one underlying calendar.events.list call for two concurrent snapshot calls, got ${callCount}`);

    console.log('widget service-bridge verify ok: worker round-trip (snapshot+CRUD)/single-flight');
  } finally {
    await bridge.terminate();
    fs.rmSync(hookPath, { force: true });
    fs.rmSync(callLogPath, { force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
