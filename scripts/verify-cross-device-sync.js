'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { refreshDesktopCloudSession } = require('../main/sources/cloud-auth');
const {
  addCloudScheduleItem,
  deleteCloudScheduleItem,
  loadCloudScheduleState,
  moveCloudScheduleItem,
  updateCloudScheduleItem,
  updateCloudScheduleItemText
} = require('../main/sources/cloud-schedule-source');

const POLL_TIMEOUT_MS = 5000;
const POLL_INTERVAL_MS = 500;
const TEST_TASK_TOP_SORT_ORDER = -1000000000;
const VERIFY_MOBILE_UI = getCommandEnv('VERIFY_MOBILE_UI') === '1';

function getCommandEnv(name) {
  return process.env[`ASKEWLY_COMMAND_${name}`] || process.env[`WORKSPACE_PULSE_${name}`] || '';
}

function getAppDataDir() {
  const roamingRoot = process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming');
  return path.join(roamingRoot, 'askewly-command', 'widget');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function runAdb(args, options = {}) {
  return execFileSync('adb', args, {
    encoding: options.encoding || 'utf8',
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 8
  });
}

function ensureAndroidDevice() {
  const output = runAdb(['devices']);
  const devices = output.split(/\r?\n/).filter((line) => /\tdevice$/.test(line));
  assert(devices.length > 0, 'No Android device connected for mobile sync verification');
}

function launchMobileApp() {
  const metroUrl = getCommandEnv('METRO_URL') || 'http://localhost:8081';
  const devClientUrl = `askewlycommand://expo-development-client/?url=${encodeURIComponent(metroUrl)}`;
  runAdb(['reverse', 'tcp:8081', 'tcp:8081']);
  runAdb(['shell', 'am', 'force-stop', 'com.foodnoshow.mobile']);
  runAdb(['shell', 'am', 'force-stop', 'com.askewly.command']);
  runAdb(['shell', 'am', 'start', '-p', 'com.askewly.command', '-a', 'android.intent.action.VIEW', '-d', devClientUrl]);
}

function dumpMobileUi() {
  return runAdb(['exec-out', 'uiautomator', 'dump', '/dev/tty']);
}

function scrollMobileDown() {
  runAdb(['shell', 'input', 'swipe', '540', '2050', '540', '650', '250']);
}

function scrollMobileTop() {
  for (let index = 0; index < 3; index += 1) {
    runAdb(['shell', 'input', 'swipe', '540', '650', '540', '2050', '180']);
  }
}

async function waitForMobileText(text, timeoutMs = POLL_TIMEOUT_MS) {
  const startedAt = Date.now();
  let scrollAttempt = 0;
  while (Date.now() - startedAt <= timeoutMs) {
    const dump = dumpMobileUi();
    if (dump.includes(text)) {
      return Date.now() - startedAt;
    }
    if (scrollAttempt < 4) {
      scrollMobileDown();
      scrollAttempt += 1;
    }
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error(`Mobile UI did not show text within ${timeoutMs}ms: ${text}`);
}

async function waitForMobileTextGone(text, timeoutMs = POLL_TIMEOUT_MS) {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    const dump = dumpMobileUi();
    if (!dump.includes(text)) {
      return Date.now() - startedAt;
    }
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error(`Mobile UI still showed text after ${timeoutMs}ms: ${text}`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function findTask(state, title) {
  return [...state.today, ...state.deadlines, ...state.backlog, ...state.archived].find((task) => task.text === title);
}

async function patchTaskSortOrder(cloudConfig, taskId, sortOrder) {
  await patchTaskViaRest(cloudConfig, taskId, { sort_order: sortOrder }, 'Unable to patch test task sort order');
}

async function patchTaskViaRest(cloudConfig, taskId, body, errorPrefix = 'Unable to patch task') {
  const url = String(cloudConfig.supabaseUrl || '').replace(/\/$/, '');
  const response = await fetch(`${url}/rest/v1/tasks?id=eq.${taskId}`, {
    method: 'PATCH',
    headers: {
      apikey: cloudConfig.anonKey,
      Authorization: `Bearer ${cloudConfig.accessToken}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal'
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(`${errorPrefix}: ${response.status} ${await response.text()}`);
  }
}

async function main() {
  ensureAndroidDevice();
  if (VERIFY_MOBILE_UI) {
    launchMobileApp();
    await delay(2500);
  }

  const appData = getAppDataDir();
  const configPath = path.join(appData, 'dashboard-config.json');
  const storagePath = path.join(appData, 'cloud-auth-storage.json');
  const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const session = await refreshDesktopCloudSession(raw.today.cloud, storagePath);
  const cloudConfig = { ...raw.today.cloud, accessToken: session.access_token };

  const suffix = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const initialTitle = `M10 sync ${suffix}`;
  const editedTitle = `${initialTitle} edited`;
  const mobileEditedTitle = `${initialTitle} mobile edited`;
  let createdTask = null;

  try {
    scrollMobileTop();
    let state = await addCloudScheduleItem(cloudConfig, { target: 'today', text: initialTitle });
    let task = findTask(state, initialTitle);
    assert(task?.sourceKey === 'today', 'Created task not returned in desktop cloud Today state');
    createdTask = task;
    await patchTaskSortOrder(cloudConfig, task.lineIndex, TEST_TASK_TOP_SORT_ORDER);
    const createMobileMs = VERIFY_MOBILE_UI ? await waitForMobileText(initialTitle) : 0;

    state = await updateCloudScheduleItemText(cloudConfig, {
      sourceKey: task.sourceKey,
      lineIndex: task.lineIndex,
      newText: editedTitle
    });
    task = findTask(state, editedTitle);
    assert(task, 'Edited task not returned in desktop cloud state');
    createdTask = task;
    const editMobileMs = VERIFY_MOBILE_UI ? await waitForMobileText(editedTitle) : 0;

    state = await updateCloudScheduleItem(cloudConfig, {
      sourceKey: task.sourceKey,
      lineIndex: task.lineIndex,
      nextStatus: 'completed'
    });
    task = findTask(state, editedTitle);
    assert(task?.status === 'completed' && !task.archived, 'Desktop completion did not remain active as completed');
    createdTask = task;
    const completeMobileMs = VERIFY_MOBILE_UI ? await waitForMobileText('done') : 0;

    state = await updateCloudScheduleItem(cloudConfig, {
      sourceKey: task.sourceKey,
      lineIndex: task.lineIndex,
      nextStatus: 'in_progress'
    });
    task = findTask(state, editedTitle);
    assert(task?.status === 'in_progress', 'Desktop status update did not return in_progress');
    createdTask = task;
    const statusMobileMs = VERIFY_MOBILE_UI ? await waitForMobileText('doing') : 0;

    await patchTaskViaRest(cloudConfig, task.lineIndex, {
      title: mobileEditedTitle,
      status: 'todo'
    }, 'Unable to patch mobile-equivalent title/status');
    state = await loadCloudScheduleState(cloudConfig);
    task = findTask(state, mobileEditedTitle);
    assert(task, 'Mobile-equivalent edited task not returned in desktop cloud state');
    assert(task.status === 'pending', `Mobile-equivalent todo did not map to desktop pending: ${task.status}`);
    createdTask = task;
    const mobileEditDesktopOk = true;

    state = await moveCloudScheduleItem(cloudConfig, {
      sourceKey: task.sourceKey,
      targetKey: 'backlog',
      lineIndex: task.lineIndex
    });
    task = findTask(state, mobileEditedTitle);
    assert(task?.sourceKey === 'backlog', 'Moved task not returned in desktop cloud Backlog state');
    createdTask = task;

    state = await deleteCloudScheduleItem(cloudConfig, {
      sourceKey: task.sourceKey,
      lineIndex: task.lineIndex
    });
    task = findTask(state, mobileEditedTitle);
    assert(!task || task.archived, 'Archived task still returned as active in desktop cloud state');
    const archiveMobileMs = VERIFY_MOBILE_UI ? await waitForMobileTextGone(mobileEditedTitle) : 0;

    console.log('cross-device sync ok');
    console.log(`mobile UI mode: ${VERIFY_MOBILE_UI ? 'on' : 'off'}`);
    console.log(VERIFY_MOBILE_UI ? `create desktop->mobile: ${createMobileMs}ms` : 'create desktop->cloud state: ok');
    console.log(VERIFY_MOBILE_UI ? `edit desktop->mobile: ${editMobileMs}ms` : 'edit desktop->cloud state: ok');
    console.log(VERIFY_MOBILE_UI ? `complete desktop->mobile: ${completeMobileMs}ms` : 'complete desktop->cloud state: completed-active');
    console.log(VERIFY_MOBILE_UI ? `status desktop->mobile: ${statusMobileMs}ms` : 'status desktop->cloud state: ok');
    console.log(`edit/status mobile-equivalent->desktop: ${mobileEditDesktopOk ? 'ok' : 'failed'}`);
    console.log('move desktop state: backlog');
    console.log(VERIFY_MOBILE_UI ? `archive desktop->mobile gone: ${archiveMobileMs}ms` : 'archive desktop->cloud state: ok');
  } catch (error) {
    if (createdTask) {
      await deleteCloudScheduleItem(cloudConfig, {
        sourceKey: createdTask.sourceKey,
        lineIndex: createdTask.lineIndex
      }).catch(() => {});
    }
    throw error;
  }
}

main().catch((error) => {
  console.error(`FAIL cross-device sync: ${error.message}`);
  process.exit(1);
});
