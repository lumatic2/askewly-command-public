const { app, BrowserWindow } = require('electron');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const projectRoot = path.join(__dirname, '..');
const originalAppData = process.env.APPDATA;
const testAppDataRoot = path.join(os.tmpdir(), 'askewly-command-schedule-test-appdata');
process.env.APPDATA = testAppDataRoot;
const widgetDir = path.join(process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming'), 'askewly-command', 'widget');
const configPath = path.join(widgetDir, 'dashboard-config.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function run(command, args) {
  return execFileSync(command, args, {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: 'pipe',
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 4
  });
}

function findFirstTodayLineIndex(scheduleContent) {
  const lines = scheduleContent.split(/\r?\n/);
  let inToday = false;
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (trimmed.startsWith('## ')) {
      inToday = trimmed.includes('오늘') || trimmed.toLowerCase().includes('today');
      continue;
    }
    if (inToday && /^- \[[ x/~]\]/.test(trimmed)) {
      return index;
    }
  }
  return -1;
}

function findLineIndexByText(content, text) {
  const lines = content.split(/\r?\n/);
  return lines.findIndex((line) => line.includes(text));
}

function jsString(value) {
  return JSON.stringify(value);
}

function runSync() {
  run('node', [path.join(projectRoot, 'scripts', 'sync-today-cache.js')]);
}

function readRemote(host, remotePath) {
  return run('ssh', [host, `cat ${remotePath}`]);
}

function writeRemote(host, remotePath, content) {
  const escaped = content.replace(/\\/g, '\\\\').replace(/"""/g, '\\"\\"\\"');
  const command = `python3 - <<'PY'\nfrom pathlib import Path\nPath(r"""${remotePath}""").expanduser().write_text(r"""${escaped}""", encoding="utf-8")\nPY`;
  run('ssh', [host, command]);
}

async function main() {
  fs.mkdirSync(widgetDir, { recursive: true });
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, JSON.stringify({ today: {} }, null, 2), 'utf8');
  }
  const originalScheduleMode = process.env.ASKEWLY_COMMAND_SCHEDULE_MODE;
  process.env.ASKEWLY_COMMAND_SCHEDULE_MODE = 'local';
  const originalConfig = fs.readFileSync(configPath, 'utf8');
  const config = JSON.parse(originalConfig);
  config.today = config.today || {};
  config.today.cloud = {
    ...(config.today.cloud || {}),
    enabled: false,
    supabaseUrl: '',
    anonKey: '',
    accessToken: ''
  };
  config.today.remote = {
    ...(config.today.remote || {}),
    enabled: false
  };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
  require(path.join(projectRoot, 'main.js'));
  const remoteEnabled = Boolean(config.today?.remote?.enabled);
  const remoteHost = config.today?.remote?.host;
  const remoteBaseDir = config.today?.remote?.baseDir;
  const localScheduleDir = path.join(widgetDir, 'schedule');
  fs.mkdirSync(localScheduleDir, { recursive: true });
  const schedulePath = remoteEnabled ? `${remoteBaseDir}/SCHEDULE.md` : path.join(localScheduleDir, 'SCHEDULE.md');
  const backlogPath = remoteEnabled ? `${remoteBaseDir}/BACKLOG.md` : path.join(localScheduleDir, 'BACKLOG.md');
  const scheduleArchivePath = remoteEnabled ? `${remoteBaseDir}/SCHEDULE_ARCHIVE.md` : path.join(localScheduleDir, 'SCHEDULE_ARCHIVE.md');
  const scheduleExisted = remoteEnabled || fs.existsSync(schedulePath);
  const backlogExisted = remoteEnabled || fs.existsSync(backlogPath);
  const scheduleArchiveExisted = remoteEnabled || fs.existsSync(scheduleArchivePath);
  const originalSchedule = remoteEnabled ? readRemote(remoteHost, schedulePath) : (scheduleExisted ? fs.readFileSync(schedulePath, 'utf8') : '');
  const originalBacklog = remoteEnabled ? readRemote(remoteHost, backlogPath) : (backlogExisted ? fs.readFileSync(backlogPath, 'utf8') : '');
  const originalScheduleArchive = remoteEnabled ? readRemote(remoteHost, scheduleArchivePath) : (scheduleArchiveExisted ? fs.readFileSync(scheduleArchivePath, 'utf8') : '');
  if (!remoteEnabled) {
    fs.writeFileSync(schedulePath, '## Today\n\n## Deadline\n', 'utf8');
    fs.writeFileSync(backlogPath, '## Backlog\n', 'utf8');
    fs.writeFileSync(scheduleArchivePath, '## Today\n\n## Deadline\n', 'utf8');
  }

  await app.whenReady();

  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(projectRoot, 'preload.js')
    }
  });

  try {
    await win.loadFile(path.join(projectRoot, 'renderer', 'index.html'));
    await new Promise((resolve) => setTimeout(resolve, 500));

    await win.webContents.executeJavaScript(`
      if (!document.querySelector('[data-tab="command"]')) {
        throw new Error('Command sidebar tab missing');
      }
      if (!document.querySelector('#panel-command #commandOverview')) {
        throw new Error('Command overview was not moved into Command tab');
      }
      if (document.querySelector('#panel-schedule #commandOverview')) {
        throw new Error('Schedule tab still owns command overview');
      }
      window.__commandScheduleSplitOk = true;
    `);

    const probeText = `__codex_interaction_test_today__:${Date.now()}`;
    const addResult = await win.webContents.executeJavaScript(`
      window.workspacePulse.addScheduleItem({
        target: 'today',
        text: ${JSON.stringify(probeText)}
      })
    `);

    const afterAddSchedule = remoteEnabled ? readRemote(remoteHost, schedulePath) : fs.readFileSync(schedulePath, 'utf8');
    const firstTodayLineIndex = findLineIndexByText(afterAddSchedule, probeText);
    if (firstTodayLineIndex < 0) {
      const resultSummary = addResult
        ? JSON.stringify({
          source: addResult.source,
          today: Array.isArray(addResult.today) ? addResult.today.length : null,
          firstToday: Array.isArray(addResult.today) ? addResult.today[0]?.text : null
        })
        : 'null';
      throw new Error(`Unable to insert unique today probe item; result=${resultSummary}; schedule=${afterAddSchedule.slice(0, 240)}`);
    }

    await win.webContents.executeJavaScript(`
      window.renderMutationResult(${jsString(addResult)});
      const todayText = document.querySelector('#todayItems')?.innerText || '';
      if (!todayText.includes(${jsString(probeText)})) {
        throw new Error('Renderer did not show added Today item');
      }
      if (!document.querySelector('#todayItems .list-item--interactive')) {
        throw new Error('Renderer Today list blanked after add confirmation');
      }
    `);

    const completeResult = await win.webContents.executeJavaScript(`
      window.workspacePulse.updateScheduleItem({
        sourceKey: 'today',
        lineIndex: ${Number(firstTodayLineIndex)},
        nextStatus: 'completed'
      })
    `);

    await win.webContents.executeJavaScript(`
      window.renderMutationResult(${jsString(completeResult)});
      const scheduleText = document.querySelector('#scheduleBody')?.innerText || '';
      if (!scheduleText.trim()) {
        throw new Error('Renderer schedule body blanked after complete confirmation');
      }
    `);

    const afterCompleteSchedule = remoteEnabled ? readRemote(remoteHost, schedulePath) : fs.readFileSync(schedulePath, 'utf8');
    const afterCompleteArchive = remoteEnabled ? readRemote(remoteHost, scheduleArchivePath) : fs.readFileSync(scheduleArchivePath, 'utf8');
    if (!afterCompleteSchedule.includes(`- [x] ${probeText}`) || afterCompleteArchive.includes(probeText)) {
      throw new Error('Complete action did not keep completed task in source markdown');
    }

    await win.webContents.executeJavaScript(`
      window.renderMutationResult(${jsString(completeResult)});
      const completedItems = Array.from(document.querySelectorAll('#todayItems .list-item--interactive'));
      const completedItem = completedItems.find((item) => (
        (item.dataset.rawText || '').includes(${jsString(probeText)}) || (item.innerText || '').includes(${jsString(probeText)})
      ));
      if (!completedItem || completedItem.dataset.status !== 'completed') {
        throw new Error('Renderer did not show completed Today item; items=' + completedItems.map((item) => (
          (item.dataset.status || '?') + ':' + (item.dataset.rawText || item.innerText || '').slice(0, 80)
        )).join('|'));
      }
      const completedButton = completedItem.querySelector('.status-checkbox');
      if (!completedButton || completedButton.dataset.status !== 'completed') {
        throw new Error('Status button did not show completed state');
      }
      if (completedItem.querySelector('[data-action="complete"]')) {
        throw new Error('Dedicated complete button should not be rendered');
      }
    `);

    await win.webContents.executeJavaScript(`
      window.workspacePulse.updateScheduleItem({
        sourceKey: 'today',
        lineIndex: ${Number(firstTodayLineIndex)},
        nextStatus: 'pending'
      })
    `);

    const afterRestoreSchedule = remoteEnabled ? readRemote(remoteHost, schedulePath) : fs.readFileSync(schedulePath, 'utf8');
    if (!afterRestoreSchedule.includes(`- [ ] ${probeText}`)) {
      throw new Error('Pending status did not restore source markdown checkbox');
    }

    const testText = '__codex_interaction_test__';
    await win.webContents.executeJavaScript(`
      window.workspacePulse.addScheduleItem({
        target: 'backlog',
        text: ${JSON.stringify(testText)}
      })
    `);

    const backlogContent = remoteEnabled ? readRemote(remoteHost, backlogPath) : fs.readFileSync(backlogPath, 'utf8');
    if (!backlogContent.includes(testText)) {
      throw new Error('Add action did not update backlog markdown');
    }

    console.log('interactive schedule test: ok');
  } finally {
    if (originalScheduleMode === undefined) delete process.env.ASKEWLY_COMMAND_SCHEDULE_MODE;
    else process.env.ASKEWLY_COMMAND_SCHEDULE_MODE = originalScheduleMode;
    fs.writeFileSync(configPath, originalConfig, 'utf8');
    if (remoteEnabled) {
      writeRemote(remoteHost, schedulePath, originalSchedule);
      writeRemote(remoteHost, backlogPath, originalBacklog);
      writeRemote(remoteHost, scheduleArchivePath, originalScheduleArchive);
    } else {
      if (scheduleExisted) fs.writeFileSync(schedulePath, originalSchedule, 'utf8');
      else fs.rmSync(schedulePath, { force: true });
      if (backlogExisted) fs.writeFileSync(backlogPath, originalBacklog, 'utf8');
      else fs.rmSync(backlogPath, { force: true });
      if (scheduleArchiveExisted) fs.writeFileSync(scheduleArchivePath, originalScheduleArchive, 'utf8');
      else fs.rmSync(scheduleArchivePath, { force: true });
    }
    if (process.env.APPDATA !== testAppDataRoot) runSync();
    if (originalAppData === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = originalAppData;
    await win.close();
    app.quit();
  }
}

main().catch((error) => {
  console.error(error);
  app.exit(1);
});
