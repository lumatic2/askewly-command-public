#!/usr/bin/env node
'use strict';

// Offline verifier for widget v2 S3 optimistic UI state transitions.
//
// No jsdom is vendored in this repo (see CLAUDE.md: no new npm deps), so this
// verifies the pure, DOM-free state-transition functions in
// widget/renderer/state.js — the same functions app.js calls before/after
// every window.widget.invoke() round trip. Each scenario below mirrors one
// app.js control-flow branch (optimistic apply -> await -> commit, or
// optimistic apply -> await -> rollback) using a fake invoke() Promise, so a
// regression in the reducer logic itself (not the DOM rendering) is caught
// here even without a browser.

const assert = require('assert');
const WidgetState = require('../widget/renderer/state.js');

function baseTasks() {
  return {
    today: [
      { id: 'g-1', title: 'Existing today task', status: 'todo', due_at: null, project_name: null },
      { id: 'g-2', title: 'Second today task', status: 'todo', due_at: null, project_name: null }
    ],
    deadlines: [
      { id: 'g-3', title: 'Existing deadline', status: 'todo', due_at: '2026-07-15T00:00:00.000Z', project_name: null }
    ],
    backlog: []
  };
}

// A fake window.widget.invoke: resolves with `result` or rejects with
// `error`, exactly like the real IPC bridge's Promise contract.
function fakeInvoke({ result, error }) {
  return () => (error ? Promise.reject(error) : Promise.resolve(result));
}

async function scenarioQuickAddSuccess() {
  const tasks = baseTasks();
  const tempId = 'temp-1';
  const tempTask = { id: tempId, title: 'New task', status: 'todo', due_at: null, project_name: null, _pending: true };

  let working = WidgetState.addTaskOptimistic(tasks, 'today', tempTask);
  assert.strictEqual(working.today.length, 3, 'optimistic add inserts a row immediately');
  assert.strictEqual(working.today[0].id, tempId, 'temp row is inserted at the top');
  assert.strictEqual(working.today[0]._pending, true, 'temp row is flagged pending for the "is-pending" style');

  const invoke = fakeInvoke({ result: { id: 'g-99', title: 'New task', status: 'todo', due_at: null, project_name: null } });
  const created = await invoke();
  working = WidgetState.replaceTask(working, 'today', tempId, created);

  assert.strictEqual(working.today.length, 3, 'row count unchanged after commit');
  assert.strictEqual(working.today[0].id, 'g-99', 'temp id replaced by server id');
  assert.ok(!working.today[0]._pending, 'server row is not pending');
  assert.strictEqual(tasks.today.length, 2, 'original tasks object was never mutated');
}

async function scenarioQuickAddRollback() {
  const tasks = baseTasks();
  const tempId = 'temp-2';
  const tempTask = { id: tempId, title: 'Will fail', status: 'todo', due_at: null, project_name: null, _pending: true };

  let working = WidgetState.addTaskOptimistic(tasks, 'today', tempTask);
  assert.strictEqual(working.today.length, 3);

  const invoke = fakeInvoke({ error: new Error('network down') });
  let failed = false;
  try {
    await invoke();
  } catch (error) {
    failed = true;
    working = WidgetState.removeTask(working, 'today', tempId);
  }

  assert.ok(failed, 'invoke rejected as expected');
  assert.deepStrictEqual(working, tasks, 'rollback restores the exact pre-optimistic state');
}

async function scenarioToggleSuccess() {
  const tasks = baseTasks();
  let working = WidgetState.setTaskStatusLocal(tasks, 'today', 'g-1', 'done');
  assert.strictEqual(working.today[0].status, 'done', 'optimistic toggle flips status immediately');

  const invoke = fakeInvoke({ result: { id: 'g-1', status: 'done' } });
  await invoke();
  assert.strictEqual(working.today[0].status, 'done', 'status remains done after server confirms');
  assert.strictEqual(tasks.today[0].status, 'todo', 'original tasks object untouched');
}

async function scenarioToggleRollback() {
  const tasks = baseTasks();
  let working = WidgetState.setTaskStatusLocal(tasks, 'today', 'g-1', 'done');

  const invoke = fakeInvoke({ error: new Error('server rejected') });
  try {
    await invoke();
    assert.fail('expected rejection');
  } catch {
    working = WidgetState.setTaskStatusLocal(working, 'today', 'g-1', 'todo');
  }

  assert.deepStrictEqual(working, tasks, 'rollback restores original status');
}

async function scenarioDeferSuccess() {
  const tasks = baseTasks();
  const location = WidgetState.findTaskLocation(tasks, 'g-2');
  assert.ok(location, 'findTaskLocation finds the task');
  assert.strictEqual(location.section, 'today');
  assert.strictEqual(location.index, 1);

  let working = WidgetState.removeTask(tasks, 'today', 'g-2');
  assert.strictEqual(working.today.length, 1, 'defer optimistically removes the row from Today');

  const invoke = fakeInvoke({ result: { id: 'g-2', section: 'backlog' } });
  await invoke();
  assert.strictEqual(working.today.length, 1, 'row stays removed after server confirms the move');
  assert.strictEqual(tasks.today.length, 2, 'original tasks object untouched');
}

async function scenarioDeferRollback() {
  const tasks = baseTasks();
  const location = WidgetState.findTaskLocation(tasks, 'g-2');
  let working = WidgetState.removeTask(tasks, 'today', 'g-2');

  const invoke = fakeInvoke({ error: new Error('move failed') });
  try {
    await invoke();
    assert.fail('expected rejection');
  } catch {
    working = WidgetState.insertTaskAt(working, 'today', location.index, location.task);
  }

  assert.deepStrictEqual(working, tasks, 'rollback re-inserts the row at its original index');
}

async function scenarioEditSuccess() {
  const tasks = baseTasks();
  const location = WidgetState.findTaskLocation(tasks, 'g-1');
  const previousTask = location.task;

  let working = WidgetState.updateTaskLocal(tasks, 'today', 'g-1', { title: 'Edited title', detail: 'note' });
  assert.strictEqual(working.today[0].title, 'Edited title', 'optimistic edit applies immediately');

  const invoke = fakeInvoke({ result: { id: 'g-1', title: 'Edited title', detail: 'note', status: 'todo', due_at: null, project_name: null } });
  const updated = await invoke();
  working = WidgetState.updateTaskLocal(working, 'today', 'g-1', updated);

  assert.strictEqual(working.today[0].title, 'Edited title');
  assert.strictEqual(tasks.today[0].title, previousTask.title, 'original tasks object untouched');
}

async function scenarioEditRollback() {
  const tasks = baseTasks();
  const location = WidgetState.findTaskLocation(tasks, 'g-1');
  const previousTask = location.task;

  let working = WidgetState.updateTaskLocal(tasks, 'today', 'g-1', { title: 'Will be reverted' });

  const invoke = fakeInvoke({ error: new Error('update rejected') });
  try {
    await invoke();
    assert.fail('expected rejection');
  } catch {
    working = WidgetState.updateTaskLocal(working, 'today', 'g-1', previousTask);
  }

  assert.deepStrictEqual(working, tasks, 'rollback restores original title/detail');
}

async function main() {
  await scenarioQuickAddSuccess();
  await scenarioQuickAddRollback();
  await scenarioToggleSuccess();
  await scenarioToggleRollback();
  await scenarioDeferSuccess();
  await scenarioDeferRollback();
  await scenarioEditSuccess();
  await scenarioEditRollback();
  console.log('widget crud-ui verify ok: optimistic add/toggle/defer/edit apply + rollback transitions (state.js)');
}

main().catch((error) => {
  console.error('widget crud-ui verify FAILED:', error);
  process.exitCode = 1;
});
