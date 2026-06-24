#!/usr/bin/env node
'use strict';

const { TASK_SOURCE_KEYS } = require('../shared/tasks');

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

function requiredEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function getCommandEnv(name) {
  return process.env[`ASKEWLY_COMMAND_${name}`] || process.env[`WORKSPACE_PULSE_${name}`] || '';
}

function authHeaders() {
  const serviceRole = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const accessToken = String(getCommandEnv('SUPABASE_ACCESS_TOKEN') || '').trim();
  const anonKey = String(process.env.SUPABASE_ANON_KEY || '').trim();
  const key = serviceRole || anonKey;
  const bearer = serviceRole || accessToken;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY is required');
  if (!bearer) throw new Error('SUPABASE_SERVICE_ROLE_KEY or ASKEWLY_COMMAND_SUPABASE_ACCESS_TOKEN is required');
  return {
    apikey: key,
    Authorization: `Bearer ${bearer}`,
    'Content-Type': 'application/json'
  };
}

async function request(path) {
  const url = requiredEnv('SUPABASE_URL').replace(/\/$/, '');
  const response = await fetch(`${url}/rest/v1/${path}`, { headers: authHeaders() });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Supabase REST ${response.status}: ${detail || response.statusText}`);
  }
  return response.json();
}

async function resolveWorkspaceId(args) {
  if (args.workspace) return String(args.workspace);
  if (getCommandEnv('WORKSPACE_ID')) return String(getCommandEnv('WORKSPACE_ID'));

  const ownerEmail = args.email || getCommandEnv('USER_EMAIL');
  if (ownerEmail) {
    const profiles = await request(`profiles?select=id,email&email=eq.${encodeURIComponent(ownerEmail)}&limit=1`);
    const profile = profiles[0];
    if (!profile) throw new Error(`No profile found for ${ownerEmail}`);
    const workspaces = await request(`workspaces?select=id,name&owner_id=eq.${profile.id}&order=created_at.asc&limit=1`);
    if (!workspaces[0]) throw new Error(`No workspace found for ${ownerEmail}`);
    return String(workspaces[0].id);
  }

  const workspaces = await request('workspaces?select=id,name&order=created_at.asc&limit=1');
  if (!workspaces[0]) throw new Error('No workspace found');
  return String(workspaces[0].id);
}

function kstDateString(date = new Date()) {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function groupTasks(tasks, sources) {
  const byId = new Map(sources.map((source) => [source.id, source]));
  const groups = {
    today: [],
    deadlines: [],
    backlog: []
  };
  for (const task of tasks) {
    const source = byId.get(task.source_id);
    if (!source) continue;
    const item = {
      id: task.id,
      title: task.title,
      detail: task.detail || '',
      status: task.status,
      dueAt: task.due_at,
      scheduledFor: task.scheduled_for,
      sortOrder: task.sort_order
    };
    if (source.key === TASK_SOURCE_KEYS.TODAY) groups.today.push(item);
    else if (source.key === TASK_SOURCE_KEYS.DEADLINES) groups.deadlines.push(item);
    else if (source.key === TASK_SOURCE_KEYS.BACKLOG) groups.backlog.push(item);
  }
  return groups;
}

function statusLabel(status) {
  if (status === 'doing') return 'doing';
  if (status === 'done') return 'done';
  if (status === 'held') return 'held';
  if (status === 'delayed') return 'delayed';
  return 'todo';
}

function taskLine(task, options = {}) {
  const parts = [`- [${statusLabel(task.status)}] ${task.title}`];
  if (task.detail) parts.push(`  detail: ${task.detail}`);
  if (options.deadline && task.dueAt) parts.push(`  due: ${task.dueAt.slice(0, 10)}`);
  return parts.join('\n');
}

function renderMarkdown(payload) {
  const { groups, todayDate } = payload;
  return [
    `# Askewly Command Schedule (${todayDate} KST)`,
    '',
    '## Today',
    groups.today.length ? groups.today.map((task) => taskLine(task)).join('\n') : '- none',
    '',
    '## Deadlines',
    groups.deadlines.length ? groups.deadlines.map((task) => taskLine(task, { deadline: true })).join('\n') : '- none',
    '',
    '## Backlog',
    groups.backlog.length ? groups.backlog.map((task) => taskLine(task)).join('\n') : '- none',
    ''
  ].join('\n');
}

async function main() {
  const args = parseArgs(process.argv);
  const workspaceId = await resolveWorkspaceId(args);
  const sources = await request(
    `task_sources?select=id,key,label,sort_order&workspace_id=eq.${workspaceId}&order=sort_order.asc`
  );
  const tasks = await request(
    `tasks?select=id,source_id,title,detail,status,due_at,scheduled_for,sort_order,created_at&workspace_id=eq.${workspaceId}&status=neq.archived&order=sort_order.asc&order=created_at.asc`
  );
  const payload = {
    source: 'supabase',
    workspaceId,
    todayDate: kstDateString(),
    groups: groupTasks(tasks, sources)
  };
  if (args.format === 'json') {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    process.stdout.write(renderMarkdown(payload));
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
