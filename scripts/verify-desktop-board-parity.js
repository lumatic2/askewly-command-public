'use strict';

const fs = require('fs');
const path = require('path');
const { refreshDesktopCloudSession } = require('../main/sources/cloud-auth');
const {
  deleteCloudScheduleItem,
  loadCloudScheduleState,
  updateCloudScheduleItem
} = require('../main/sources/cloud-schedule-source');

function loadLocalEnv() {
  const envPath = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex <= 0) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function getCommandEnv(name) {
  return process.env[`ASKEWLY_COMMAND_${name}`] || process.env[`WORKSPACE_PULSE_${name}`] || '';
}

function getAppDataDir() {
  const roamingRoot = process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming');
  return path.join(roamingRoot, 'askewly-command', 'widget');
}

async function getConfig() {
  const accessToken = getCommandEnv('SUPABASE_ACCESS_TOKEN');
  if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY && accessToken) {
    return {
      enabled: true,
      supabaseUrl: process.env.SUPABASE_URL,
      anonKey: process.env.SUPABASE_ANON_KEY,
      accessToken
    };
  }

  const appData = getAppDataDir();
  const configPath = path.join(appData, 'dashboard-config.json');
  const storagePath = path.join(appData, 'cloud-auth-storage.json');
  assert(fs.existsSync(configPath), `Missing dashboard config: ${configPath}`);
  assert(fs.existsSync(storagePath), `Missing desktop cloud auth storage: ${storagePath}`);

  const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const cloud = raw.today?.cloud || {};
  assert(cloud.enabled, 'Desktop cloud mode is not enabled');
  const session = await refreshDesktopCloudSession(cloud, storagePath);
  assert(session?.access_token, 'Desktop cloud session is missing');
  return {
    enabled: true,
    supabaseUrl: cloud.supabaseUrl,
    anonKey: cloud.anonKey,
    accessToken: session.access_token
  };
}

function createClient(config = {}) {
  const url = String(config.supabaseUrl || process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const anonKey = String(config.anonKey || process.env.SUPABASE_ANON_KEY || '').trim();
  const accessToken = String(config.accessToken || getCommandEnv('SUPABASE_ACCESS_TOKEN')).trim();
  assert(url && anonKey && accessToken, 'Supabase cloud config is incomplete');

  async function request(pathname, options = {}) {
    const response = await fetch(`${url}/rest/v1/${pathname}`, {
      method: options.method || 'GET',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Prefer: options.prefer || 'return=representation'
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    if (!response.ok) throw new Error(`Supabase REST ${response.status}: ${await response.text()}`);
    if (response.status === 204) return null;
    return response.json();
  }

  return { request };
}

async function getUserId(client) {
  const profiles = await client.request('profiles?select=id&limit=1');
  const profile = profiles?.[0];
  assert(profile?.id, 'No profile found for cloud session');
  return profile.id;
}

async function getWorkspaceAndTodaySource(client) {
  const workspaces = await client.request('workspaces?select=id,name&order=created_at.asc&limit=1');
  const workspace = workspaces?.[0];
  assert(workspace?.id, 'No cloud workspace found');
  const sources = await client.request(`task_sources?select=id,key,label&workspace_id=eq.${workspace.id}&key=eq.today&limit=1`);
  const source = sources?.[0];
  assert(source?.id, 'No Today source found');
  return { workspace, source };
}

async function insertSmokeTask(client, context, userId, title, status, sortOrder) {
  const rows = await client.request('tasks', {
    method: 'POST',
    body: {
      workspace_id: context.workspace.id,
      source_id: context.source.id,
      title,
      status,
      sort_order: sortOrder,
      scheduled_for: kstDateString(),
      due_at: null,
      created_by: userId,
      updated_by: userId
    }
  });
  return rows?.[0];
}

function kstDateString(date = new Date()) {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function findActiveTask(state, title) {
  return [...state.today, ...state.deadlines, ...state.backlog].find((task) => task.text === title);
}

function findArchivedTask(state, title) {
  return state.archived.find((task) => task.text === title);
}

async function cleanup(config, tasks) {
  for (const task of tasks) {
    if (!task?.id) continue;
    await deleteCloudScheduleItem(config, {
      sourceKey: 'today',
      lineIndex: task.id
    }).catch(() => {});
  }
}

async function main() {
  loadLocalEnv();
  const config = await getConfig();
  const client = createClient(config);
  const context = await getWorkspaceAndTodaySource(client);
  const userId = await getUserId(client);
  const suffix = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const titles = {
    doing: `M37 parity doing ${suffix}`,
    todo: `M37 parity todo ${suffix}`,
    done: `M37 parity done ${suffix}`,
    held: `M47 parity held ${suffix}`,
    delayed: `M47 parity delayed ${suffix}`,
    archive: `M37 parity archive ${suffix}`
  };
  const created = [];

  try {
    created.push(await insertSmokeTask(client, context, userId, titles.todo, 'todo', 2000));
    created.push(await insertSmokeTask(client, context, userId, titles.doing, 'doing', 1000));
    created.push(await insertSmokeTask(client, context, userId, titles.done, 'done', 3000));
    created.push(await insertSmokeTask(client, context, userId, titles.held, 'held', 3500));
    created.push(await insertSmokeTask(client, context, userId, titles.delayed, 'delayed', 3600));
    created.push(await insertSmokeTask(client, context, userId, titles.archive, 'todo', 4000));

    let state = await loadCloudScheduleState(config);
    const doing = findActiveTask(state, titles.doing);
    const todo = findActiveTask(state, titles.todo);
    const done = findActiveTask(state, titles.done);
    const held = findActiveTask(state, titles.held);
    const delayed = findActiveTask(state, titles.delayed);
    assert(doing?.status === 'in_progress' && doing.cloudStatus === 'doing', 'doing did not map to in_progress with cloudStatus doing');
    assert(todo?.status === 'pending' && todo.cloudStatus === 'todo', 'todo did not map to pending with cloudStatus todo');
    assert(done?.status === 'completed' && done.cloudStatus === 'done', 'done did not map to completed with cloudStatus done');
    assert(held?.status === 'pending' && held.cloudStatus === 'held', 'held did not map to pending with cloudStatus held');
    assert(delayed?.status === 'pending' && delayed.cloudStatus === 'delayed', 'delayed did not map to pending with cloudStatus delayed');
    assert(doing.sortOrder === 1000 && todo.sortOrder === 2000 && done.sortOrder === 3000, 'sortOrder metadata was not exposed');
    const todayTitles = state.today.map((task) => task.text);
    assert(todayTitles.indexOf(titles.doing) < todayTitles.indexOf(titles.todo), 'desktop today order did not preserve sort_order');

    const archiveTask = findActiveTask(state, titles.archive);
    assert(archiveTask, 'archive smoke task missing before archive');
    state = await updateCloudScheduleItem(config, {
      sourceKey: 'today',
      lineIndex: archiveTask.lineIndex,
      nextStatus: 'archived'
    });
    assert(!findActiveTask(state, titles.archive), 'archived task still appears in active desktop state');
    const archived = findArchivedTask(state, titles.archive);
    assert(archived?.archived && archived.cloudStatus === 'archived', 'archived task missing from desktop archive state');
    console.log('desktop board parity ok');
    console.log('status mapping: todo/pending, doing/in_progress, done/completed, held/pending, delayed/pending, archived/cancelled');
    console.log('sort_order metadata: ok');
    console.log('archive visibility: ok');
  } finally {
    await cleanup(config, created);
  }
}

main().catch((error) => {
  console.error(`FAIL desktop board parity: ${error.message}`);
  process.exit(1);
});
