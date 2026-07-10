#!/usr/bin/env node
'use strict';

// Live E2E for widget v2 S3 CRUD wiring. Drives widget/data-service.js's CRUD
// wrappers directly (not the renderer UI) against the real `gws` CLI /
// Google Tasks backend, using ONE disposable temp task that is always
// deleted at the end — this must never touch a real user task.
//
// Flow: add -> verify -> toggle done -> verify -> toggle back -> verify ->
// defer to backlog -> verify moved -> update title -> verify -> delete ->
// verify gone. Cleanup is attempted even if an earlier step throws.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const dataService = require('../widget/data-service');
const { listTasks } = require('../scripts/lib/google-workspace-tasks');

const TEMP_TITLE = 'M72 S3 E2E Temp';

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

function deleteGoogleTask(tasklistId, taskId) {
  runGws(['tasks', 'tasks', 'delete', '--params', JSON.stringify({ tasklist: tasklistId, task: taskId }), '--format', 'json']);
}

function assert(condition, message) {
  if (!condition) throw new Error(`assertion failed: ${message}`);
}

async function main() {
  let currentId = null;
  let currentTasklistId = null;
  let cleanedUp = false;

  try {
    // ---- 1. add -------------------------------------------------------------
    const added = dataService.taskAdd({ section: 'today', title: TEMP_TITLE, detail: 'widget S3 e2e fixture' }, runGws);
    currentId = added.id;
    currentTasklistId = added.tasklist_id;
    assert(added.title === TEMP_TITLE, 'added title matches');
    assert(added.status === 'todo', 'added status is todo');
    console.log(`add: ok (id=${added.id})`);

    const afterAdd = listTasks({ section: 'today', query: TEMP_TITLE }, runGws);
    assert(afterAdd.some((row) => row.id === added.id), 'temp task visible in Today list after add');
    console.log(`verify add: ok (found in today, count=${afterAdd.length})`);

    // ---- 2. toggle done -------------------------------------------------------
    const toggledDone = dataService.taskToggle({ id: currentId, status: 'done' }, runGws);
    assert(toggledDone.status === 'done', 'toggled to done');
    const afterDone = listTasks({ section: 'today', status: 'all', query: TEMP_TITLE }, runGws);
    const doneRow = afterDone.find((row) => row.id === currentId);
    assert(doneRow && doneRow.status === 'done', 'verify: status done via listTasks');
    console.log('toggle done: ok');

    // ---- 3. toggle back to todo ------------------------------------------------
    const toggledTodo = dataService.taskToggle({ id: currentId, status: 'todo' }, runGws);
    assert(toggledTodo.status === 'todo', 'toggled back to todo');
    const afterTodo = listTasks({ section: 'today', query: TEMP_TITLE }, runGws);
    assert(afterTodo.some((row) => row.id === currentId && row.status === 'todo'), 'verify: status todo via listTasks');
    console.log('toggle back to todo: ok');

    // ---- 4. defer to backlog ----------------------------------------------------
    const deferred = dataService.taskDefer({ id: currentId, section: 'backlog' }, runGws);
    assert(deferred.section === 'backlog', 'deferred row reports backlog section');
    const stillInToday = listTasks({ section: 'today', query: TEMP_TITLE }, runGws);
    assert(!stillInToday.some((row) => row.id === currentId), 'old id gone from Today after defer');
    currentId = deferred.id;
    currentTasklistId = deferred.tasklist_id;
    const inBacklog = listTasks({ section: 'backlog', query: TEMP_TITLE }, runGws);
    assert(inBacklog.some((row) => row.id === currentId), 'new id present in Backlog after defer');
    console.log(`defer to backlog: ok (new id=${currentId})`);

    // ---- 5. update title suffix -------------------------------------------------
    const editedTitle = `${TEMP_TITLE} (edited)`;
    const updated = dataService.taskUpdate({ id: currentId, title: editedTitle }, runGws);
    assert(updated.title === editedTitle, 'update returned new title');
    currentTasklistId = updated.tasklist_id;
    const afterUpdate = listTasks({ section: 'backlog', query: 'edited' }, runGws);
    assert(afterUpdate.some((row) => row.id === currentId && row.title === editedTitle), 'verify: title updated via listTasks');
    console.log(`update title: ok (title="${editedTitle}")`);

    // ---- 6. delete + verify gone --------------------------------------------------
    deleteGoogleTask(currentTasklistId, currentId);
    cleanedUp = true;
    const afterDelete = listTasks({ section: 'backlog', status: 'all', query: 'E2E Temp' }, runGws);
    assert(!afterDelete.some((row) => row.id === currentId), 'temp task absent after delete');
    console.log('delete + verify gone: ok');

    console.log('\nwidget crud-e2e verify ok: add/toggle/toggle-back/defer/update/delete all confirmed via listTasks; temp task cleaned up');
  } catch (error) {
    console.error('widget crud-e2e verify FAILED:', error && error.message ? error.message : error);
    process.exitCode = 1;
  } finally {
    if (!cleanedUp && currentId && currentTasklistId) {
      try {
        deleteGoogleTask(currentTasklistId, currentId);
        console.log(`cleanup: deleted leftover temp task (id=${currentId})`);
      } catch (cleanupError) {
        console.error(`cleanup: FAILED to delete leftover temp task (id=${currentId}, tasklist=${currentTasklistId}):`, cleanupError.message || cleanupError);
        process.exitCode = 1;
      }
    }
  }
}

main();
