'use strict';

const fs = require('fs');
const path = require('path');
const { refreshDesktopCloudSession } = require('../main/sources/cloud-auth');
const {
  addCloudScheduleItem,
  deleteCloudScheduleItem,
  loadCloudScheduleState,
  moveCloudScheduleItem,
  reorderCloudScheduleItem,
  updateCloudScheduleItem,
  updateCloudScheduleItemText
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
  assert(cloud.supabaseUrl, 'Desktop cloud mode is missing Supabase URL');
  assert(cloud.anonKey, 'Desktop cloud mode is missing Supabase anon key');
  const session = await refreshDesktopCloudSession(cloud, storagePath);
  assert(session?.access_token, 'Desktop cloud session is missing');
  return {
    enabled: true,
    supabaseUrl: cloud.supabaseUrl,
    anonKey: cloud.anonKey,
    accessToken: session.access_token
  };
}

function findTask(state, title) {
  return [...state.today, ...state.deadlines, ...state.backlog, ...state.archived].find((task) => task.text === title);
}

function findSectionIndex(state, sourceKey, title) {
  const items = sourceKey === 'backlog' ? state.backlog : sourceKey === 'deadline' ? state.deadlines : state.today;
  return items.findIndex((task) => task.text === title);
}

async function main() {
  loadLocalEnv();
  const config = await getConfig();
  assert(config.supabaseUrl, 'Missing SUPABASE_URL');
  assert(config.anonKey, 'Missing SUPABASE_ANON_KEY');
  assert(config.accessToken, 'Missing Supabase access token');

  const suffix = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const initialTitle = `M5 desktop cloud smoke ${suffix}`;
  const editedTitle = `${initialTitle} edited`;
  const reorderPeerTitle = `${initialTitle} peer`;
  const backlogPeerTitle = `${initialTitle} backlog peer`;
  let createdTask = null;
  let createdPeerTask = null;
  let createdBacklogPeerTask = null;

  try {
    let state = await loadCloudScheduleState(config);
    assert(state.commandOverview?.counts, 'Cloud schedule state is missing command overview counts');
    assert(Array.isArray(state.commandOverview.doingTasks), 'Cloud command overview is missing doingTasks');
    assert(Array.isArray(state.commandOverview.todayProjects), 'Cloud command overview is missing todayProjects');
    assert(Array.isArray(state.commandOverview.upcomingMilestones), 'Cloud command overview is missing upcomingMilestones');
    assert(Array.isArray(state.commandOverview.obsidianLinks), 'Cloud command overview is missing obsidianLinks');
    console.log(`initial cloud tasks: ${state.today.length + state.deadlines.length + state.backlog.length}`);

    state = await addCloudScheduleItem(config, { target: 'today', text: initialTitle });
    let task = findTask(state, initialTitle);
    assert(task && task.sourceKey === 'today', 'Created cloud task was not returned in Today');
    createdTask = task;
    console.log(`created task id: ${task.lineIndex}`);

    state = await updateCloudScheduleItemText(config, {
      sourceKey: task.sourceKey,
      lineIndex: task.lineIndex,
      newText: editedTitle
    });
    task = findTask(state, editedTitle);
    assert(task, 'Edited cloud task title was not returned');
    createdTask = task;
    console.log('edited task title');

    state = await updateCloudScheduleItem(config, {
      sourceKey: task.sourceKey,
      lineIndex: task.lineIndex,
      nextStatus: 'completed'
    });
    task = findTask(state, editedTitle);
    assert(task && !task.archived, 'Completed cloud task was unexpectedly archived');
    assert(task.status === 'completed', `Completed cloud task did not map back to legacy completed: ${task?.status}`);
    createdTask = task;
    console.log('completed task without archiving');

    state = await addCloudScheduleItem(config, { target: 'today', text: reorderPeerTitle });
    let peerTask = findTask(state, reorderPeerTitle);
    task = findTask(state, editedTitle);
    assert(task && peerTask, 'Reorder smoke tasks were not returned');
    createdTask = task;
    createdPeerTask = peerTask;

    state = await reorderCloudScheduleItem(config, {
      sourceKey: 'today',
      fromLineIndex: task.lineIndex,
      targetLineIndex: peerTask.lineIndex,
      position: 'below'
    });
    const movedIndex = findSectionIndex(state, 'today', editedTitle);
    const peerIndex = findSectionIndex(state, 'today', reorderPeerTitle);
    assert(movedIndex > peerIndex, 'Cloud reorder did not persist below target');
    task = findTask(state, editedTitle);
    peerTask = findTask(state, reorderPeerTitle);
    createdTask = task;
    createdPeerTask = peerTask;
    console.log('reordered task below peer');

    state = await addCloudScheduleItem(config, { target: 'backlog', text: backlogPeerTitle });
    let backlogPeerTask = findTask(state, backlogPeerTitle);
    task = findTask(state, editedTitle);
    assert(task && backlogPeerTask, 'Cross-section move smoke tasks were not returned');
    createdBacklogPeerTask = backlogPeerTask;

    state = await moveCloudScheduleItem(config, {
      sourceKey: task.sourceKey,
      targetKey: 'backlog',
      lineIndex: task.lineIndex,
      targetLineIndex: backlogPeerTask.lineIndex,
      position: 'below'
    });
    task = findTask(state, editedTitle);
    assert(task && task.sourceKey === 'backlog', 'Moved cloud task was not returned in Backlog');
    const movedBacklogIndex = findSectionIndex(state, 'backlog', editedTitle);
    const peerBacklogIndex = findSectionIndex(state, 'backlog', backlogPeerTitle);
    assert(movedBacklogIndex > peerBacklogIndex, 'Cross-section move did not persist below target backlog item');
    createdTask = task;
    console.log('moved task below backlog peer');

    state = await deleteCloudScheduleItem(config, {
      sourceKey: task.sourceKey,
      lineIndex: task.lineIndex
    });
    task = findTask(state, editedTitle);
    assert(!task || task.archived, 'Archived cloud task still appears as active');
    createdTask = null;
    console.log('archived smoke task');

    if (createdPeerTask) {
      await deleteCloudScheduleItem(config, {
        sourceKey: createdPeerTask.sourceKey,
        lineIndex: createdPeerTask.lineIndex
      });
      createdPeerTask = null;
      console.log('archived reorder peer task');
    }
    if (createdBacklogPeerTask) {
      await deleteCloudScheduleItem(config, {
        sourceKey: createdBacklogPeerTask.sourceKey,
        lineIndex: createdBacklogPeerTask.lineIndex
      });
      createdBacklogPeerTask = null;
      console.log('archived backlog peer task');
    }
    console.log('PASS desktop cloud schedule smoke');
  } catch (error) {
    if (createdBacklogPeerTask) {
      await deleteCloudScheduleItem(config, {
        sourceKey: createdBacklogPeerTask.sourceKey,
        lineIndex: createdBacklogPeerTask.lineIndex
      }).catch(() => {});
    }
    if (createdPeerTask) {
      await deleteCloudScheduleItem(config, {
        sourceKey: createdPeerTask.sourceKey,
        lineIndex: createdPeerTask.lineIndex
      }).catch(() => {});
    }
    if (createdTask) {
      await deleteCloudScheduleItem(config, {
        sourceKey: createdTask.sourceKey,
        lineIndex: createdTask.lineIndex
      }).catch(() => {});
    }
    throw error;
  }
}

main().catch((error) => {
  console.error(`FAIL desktop cloud schedule smoke: ${error.message}`);
  process.exit(1);
});
