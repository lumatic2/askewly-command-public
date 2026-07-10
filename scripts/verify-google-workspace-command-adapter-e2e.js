#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

function gwsCommand() {
  if (process.env.GWS_BIN) return process.env.GWS_BIN;
  if (process.platform === 'win32' && process.env.APPDATA) {
    const installedExe = path.join(process.env.APPDATA, 'npm', 'node_modules', '@googleworkspace', 'cli', 'bin', 'gws.exe');
    if (fs.existsSync(installedExe)) return installedExe;
  }
  return 'gws';
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    env: {
      ...process.env,
      ASKEWLY_COMMAND_TASK_BACKEND: 'google'
    },
    ...options
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed\n${result.stdout}\n${result.stderr}`);
  }
  return String(result.stdout || '').trim();
}

function runJson(command, args, options) {
  const output = run(command, args, options);
  return output ? JSON.parse(output) : {};
}

function gws(args, allowFailure = false) {
  const result = spawnSync(gwsCommand(), args, { encoding: 'utf8' });
  if (result.status !== 0 && !allowFailure) {
    throw new Error(`gws ${args.join(' ')} failed\n${result.stdout}\n${result.stderr}`);
  }
  const output = String(result.stdout || '').trim();
  return output ? JSON.parse(output) : {};
}

function findTaskList(title) {
  const lists = gws(['tasks', 'tasklists', 'list', '--format', 'json']).items || [];
  return lists.find((item) => item.title === title);
}

function cleanup(row) {
  if (!row?.id || !row?.tasklist_id) return;
  gws(['tasks', 'tasks', 'delete', '--params', JSON.stringify({ tasklist: row.tasklist_id, task: row.id }), '--format', 'json'], true);
}

const title = `Askewly command adapter E2E ${Date.now()}`;
let current = null;

try {
  const node = process.execPath;
  const cli = path.join(__dirname, 'askewly-command.js');
  current = runJson(node, [cli, 'tasks', 'add', '--title', title, '--section', 'backlog', '--detail', 'temporary adapter smoke', '--json']);
  if (!current.id || current.section !== 'backlog') throw new Error('created task did not return expected backlog row');

  const listed = runJson(node, [cli, 'tasks', 'search', '--query', title, '--status', 'all', '--json']);
  if (!Array.isArray(listed) || !listed.find((row) => row.id === current.id)) throw new Error('search did not find created task');

  current = runJson(node, [cli, 'tasks', 'move', '--id', current.id, '--section', 'today', '--json']);
  if (current.section !== 'today') throw new Error('move did not return today section');

  current = runJson(node, [cli, 'tasks', 'status', '--id', current.id, '--status', 'done', '--json']);
  if (current.status !== 'done') throw new Error('status did not return done');

  const today = findTaskList('Askewly Today');
  if (!today?.id) throw new Error('Askewly Today list missing after E2E');

  console.log(JSON.stringify({
    status: 'passed',
    task_id: current.id,
    final_section: current.section,
    cleanup: 'attempted'
  }, null, 2));
} finally {
  cleanup(current);
}
