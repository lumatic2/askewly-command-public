'use strict';

const fs = require('fs');
const path = require('path');
const { refreshDesktopCloudSession } = require('../main/sources/cloud-auth');
const { TASK_SOURCE_KEYS, TASK_STATUSES } = require('../shared/tasks');

const TEST_SORT_BASE = -2000000000;

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
  assert(cloud.supabaseUrl, 'Desktop cloud mode is missing Supabase URL');
  assert(cloud.anonKey, 'Desktop cloud mode is missing Supabase anon key');
  const session = await refreshDesktopCloudSession(cloud, storagePath);
  assert(session?.access_token, 'Desktop cloud session is missing');
  return {
    supabaseUrl: cloud.supabaseUrl,
    anonKey: cloud.anonKey,
    accessToken: session.access_token
  };
}

function kstDateString(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return formatter.format(date);
}

function addDays(dateString, delta) {
  const date = new Date(`${dateString}T00:00:00+09:00`);
  date.setUTCDate(date.getUTCDate() + delta);
  return kstDateString(date);
}

function createClient(config) {
  const url = String(config.supabaseUrl || '').replace(/\/$/, '');
  async function request(pathname, options = {}) {
    const response = await fetch(`${url}/rest/v1/${pathname}`, {
      method: options.method || 'GET',
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${config.accessToken}`,
        'Content-Type': 'application/json',
        Prefer: options.prefer || 'return=representation',
        ...(options.headers || {})
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    if (!response.ok) {
      throw new Error(`Supabase REST ${response.status}: ${await response.text()}`);
    }
    if (response.status === 204) return null;
    return response.json();
  }
  return { request };
}

async function loadWorkspaceContext(client) {
  const workspaces = await client.request('workspaces?select=id,name&order=created_at.asc&limit=1');
  const workspace = workspaces && workspaces[0];
  assert(workspace, 'No cloud workspace found');
  const sources = await client.request(
    `task_sources?select=id,key,label&workspace_id=eq.${workspace.id}&order=sort_order.asc`
  );
  const todaySource = sources.find((source) => source.key === TASK_SOURCE_KEYS.TODAY);
  const backlogSource = sources.find((source) => source.key === TASK_SOURCE_KEYS.BACKLOG);
  assert(todaySource, 'No Today source found');
  assert(backlogSource, 'No Backlog source found');
  const profiles = await client.request('profiles?select=id&limit=1');
  const profile = profiles && profiles[0];
  assert(profile, 'No profile found for cloud session');
  return { workspace, todaySource, backlogSource, userId: profile.id };
}

async function planRollover(client, context, today) {
  const tasks = await client.request(
    [
      'tasks?select=id,title,status,source_id,scheduled_for,archived_at,sort_order',
      `workspace_id=eq.${context.workspace.id}`,
      `source_id=eq.${context.todaySource.id}`,
      'status=in.(todo,doing,held,delayed,done)',
      `scheduled_for=lt.${today}`,
      'order=scheduled_for.asc',
      'order=sort_order.asc'
    ].join('&')
  );

  const rollForward = tasks.filter((task) => (
    task.status === TASK_STATUSES.TODO
    || task.status === TASK_STATUSES.DOING
    || task.status === TASK_STATUSES.HELD
    || task.status === TASK_STATUSES.DELAYED
  ));
  const archiveDone = tasks.filter((task) => task.status === TASK_STATUSES.DONE);
  return { rollForward, archiveDone };
}

async function applyRollover(client, context, plan, today) {
  const updatedAt = new Date().toISOString();
  for (const task of plan.rollForward) {
    await client.request(`tasks?id=eq.${task.id}&workspace_id=eq.${context.workspace.id}`, {
      method: 'PATCH',
      body: {
        scheduled_for: today,
        due_at: null,
        updated_by: context.userId
      },
      prefer: 'return=minimal'
    });
  }
  for (const task of plan.archiveDone) {
    await client.request(`tasks?id=eq.${task.id}&workspace_id=eq.${context.workspace.id}`, {
      method: 'PATCH',
      body: {
        status: TASK_STATUSES.ARCHIVED,
        archived_at: updatedAt,
        updated_by: context.userId
      },
      prefer: 'return=minimal'
    });
  }
}

async function createSmokeTask(client, context, source, title, status, scheduledFor, sortOrder) {
  const rows = await client.request('tasks', {
    method: 'POST',
    body: {
      workspace_id: context.workspace.id,
      source_id: source.id,
      title,
      status,
      scheduled_for: scheduledFor,
      due_at: null,
      sort_order: sortOrder,
      created_by: context.userId,
      updated_by: context.userId
    }
  });
  return rows[0];
}

async function loadTask(client, context, id) {
  const rows = await client.request(
    `tasks?select=id,title,status,source_id,scheduled_for,archived_at&workspace_id=eq.${context.workspace.id}&id=eq.${id}&limit=1`
  );
  return rows[0];
}

async function cleanupSmokeTasks(client, context, taskIds) {
  for (const id of taskIds.filter(Boolean)) {
    await client.request(`tasks?id=eq.${id}&workspace_id=eq.${context.workspace.id}`, {
      method: 'PATCH',
      body: {
        status: TASK_STATUSES.ARCHIVED,
        archived_at: new Date().toISOString(),
        updated_by: context.userId
      },
      prefer: 'return=minimal'
    }).catch(() => {});
  }
}

async function runSmoke(client, context, today) {
  const yesterday = addDays(today, -1);
  const suffix = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const created = [];
  try {
    created.push(await createSmokeTask(client, context, context.todaySource, `M15 rollover todo ${suffix}`, TASK_STATUSES.TODO, yesterday, TEST_SORT_BASE));
    created.push(await createSmokeTask(client, context, context.todaySource, `M15 rollover doing ${suffix}`, TASK_STATUSES.DOING, yesterday, TEST_SORT_BASE + 1));
    created.push(await createSmokeTask(client, context, context.todaySource, `M15 rollover done ${suffix}`, TASK_STATUSES.DONE, yesterday, TEST_SORT_BASE + 2));
    created.push(await createSmokeTask(client, context, context.todaySource, `M15 rollover held ${suffix}`, TASK_STATUSES.HELD, yesterday, TEST_SORT_BASE + 3));
    created.push(await createSmokeTask(client, context, context.todaySource, `M15 rollover delayed ${suffix}`, TASK_STATUSES.DELAYED, yesterday, TEST_SORT_BASE + 4));
    created.push(await createSmokeTask(client, context, context.backlogSource, `M15 rollover backlog ${suffix}`, TASK_STATUSES.TODO, null, TEST_SORT_BASE + 5));

    const before = await planRollover(client, context, today);
    await applyRollover(client, context, before, today);

    const [todoTask, doingTask, doneTask, heldTask, delayedTask, backlogTask] = await Promise.all(
      created.map((task) => loadTask(client, context, task.id))
    );
    assert(todoTask.status === TASK_STATUSES.TODO && todoTask.scheduled_for === today, 'Old todo Today task did not roll forward');
    assert(doingTask.status === TASK_STATUSES.DOING && doingTask.scheduled_for === today, 'Old doing Today task did not roll forward');
    assert(doneTask.status === TASK_STATUSES.ARCHIVED && doneTask.archived_at, 'Old done Today task did not archive');
    assert(heldTask.status === TASK_STATUSES.HELD && heldTask.scheduled_for === today, 'Old held Today task did not roll forward');
    assert(delayedTask.status === TASK_STATUSES.DELAYED && delayedTask.scheduled_for === today, 'Old delayed Today task did not roll forward');
    assert(backlogTask.status === TASK_STATUSES.TODO && backlogTask.source_id === context.backlogSource.id, 'Backlog task was changed by Today rollover');
    console.log('smoke ok: old todo/doing/held/delayed rolled forward, old done archived, backlog ignored');
  } finally {
    await cleanupSmokeTasks(client, context, created.map((task) => task && task.id));
  }
}

async function main() {
  loadLocalEnv();
  const args = new Set(process.argv.slice(2));
  const apply = args.has('--apply');
  const smoke = args.has('--smoke');
  const today = getCommandEnv('TODAY_DATE') || kstDateString();
  const config = await getConfig();
  const client = createClient(config);
  const context = await loadWorkspaceContext(client);

  if (smoke) {
    await runSmoke(client, context, today);
    return;
  }

  const plan = await planRollover(client, context, today);
  console.log(`daily rollover date: ${today}`);
  console.log(`workspace: ${context.workspace.id} (${context.workspace.name})`);
  console.log(`roll forward: ${plan.rollForward.length}`);
  console.log(`archive done: ${plan.archiveDone.length}`);
  for (const task of [...plan.rollForward, ...plan.archiveDone].slice(0, 20)) {
    console.log(`- ${task.id} [${task.status}] ${task.scheduled_for} ${task.title}`);
  }

  if (apply) {
    await applyRollover(client, context, plan, today);
    console.log('daily rollover applied');
  } else {
    console.log('dry run only; pass --apply to update existing tasks or --smoke for an isolated real update test');
  }
}

main().catch((error) => {
  console.error(`FAIL daily rollover: ${error.message}`);
  process.exit(1);
});
