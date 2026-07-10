#!/usr/bin/env node
'use strict';

const assert = require('assert');
const googleTasks = require('./lib/google-workspace-tasks');

const state = {
  lists: [],
  tasks: new Map(),
  nextList: 1,
  nextTask: 1
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function fakeGws(args) {
  const [api, resource, method] = args;
  assert.strictEqual(api, 'tasks');
  if (resource === 'tasklists' && method === 'list') return { items: clone(state.lists) };
  if (resource === 'tasklists' && method === 'insert') {
    const body = JSON.parse(args[args.indexOf('--json') + 1]);
    const list = { id: `list-${state.nextList++}`, title: body.title };
    state.lists.push(list);
    state.tasks.set(list.id, []);
    return clone(list);
  }
  if (resource === 'tasks' && method === 'insert') {
    const params = JSON.parse(args[args.indexOf('--params') + 1]);
    const body = JSON.parse(args[args.indexOf('--json') + 1]);
    const task = { id: `task-${state.nextTask++}`, ...body, updated: new Date().toISOString() };
    state.tasks.get(params.tasklist).push(task);
    return clone(task);
  }
  if (resource === 'tasks' && method === 'list') {
    const params = JSON.parse(args[args.indexOf('--params') + 1]);
    const tasks = state.tasks.get(params.tasklist) || [];
    return {
      items: clone(tasks.filter((task) => params.showCompleted || task.status !== 'completed').slice(0, params.maxResults || 100))
    };
  }
  if (resource === 'tasks' && method === 'patch') {
    const params = JSON.parse(args[args.indexOf('--params') + 1]);
    const body = JSON.parse(args[args.indexOf('--json') + 1]);
    const tasks = state.tasks.get(params.tasklist) || [];
    const task = tasks.find((candidate) => candidate.id === params.task);
    if (!task) throw new Error(`missing task ${params.task}`);
    Object.assign(task, body, { updated: new Date().toISOString() });
    return clone(task);
  }
  if (resource === 'tasks' && method === 'delete') {
    const params = JSON.parse(args[args.indexOf('--params') + 1]);
    const tasks = state.tasks.get(params.tasklist) || [];
    const index = tasks.findIndex((candidate) => candidate.id === params.task);
    if (index >= 0) tasks.splice(index, 1);
    return {};
  }
  throw new Error(`unexpected gws args: ${args.join(' ')}`);
}

const created = googleTasks.addTask({
  title: 'Adapter fixture',
  section: 'today',
  detail: 'fixture detail',
  project: 'Askewly Command'
}, fakeGws);
assert.strictEqual(created.section, 'today');
assert.strictEqual(created.status, 'todo');
assert.strictEqual(created.project_name, 'Askewly Command');

const listed = googleTasks.listTasks({ section: 'today', query: 'fixture', limit: 10 }, fakeGws);
assert.strictEqual(listed.length, 1);
assert.strictEqual(listed[0].id, created.id);

const updated = googleTasks.updateTask({ id: created.id, title: 'Adapter fixture updated', detail: 'updated detail' }, fakeGws);
assert.strictEqual(updated.title, 'Adapter fixture updated');
assert.strictEqual(updated.detail, 'updated detail');

const moved = googleTasks.moveTask({ id: created.id, section: 'backlog' }, fakeGws);
assert.strictEqual(moved.section, 'backlog');
assert.notStrictEqual(moved.id, created.id);

const done = googleTasks.setTaskStatus({ id: moved.id, status: 'done' }, fakeGws);
assert.strictEqual(done.status, 'done');
assert.strictEqual(googleTasks.listTasks({ section: 'backlog', status: 'active' }, fakeGws).length, 0);
assert.strictEqual(googleTasks.listTasks({ section: 'backlog', status: 'done' }, fakeGws).length, 1);

console.log('google workspace command adapter verify ok: add/list/search/update/move/status');
