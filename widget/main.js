'use strict';

const { app, BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { ServiceBridge } = require('./service-bridge');

// Every gws call is a spawnSync subprocess (calendar list, 3x task list,
// Drive/Sheets catalog lookups) — running data-service.js in-process here
// used to block the main process event loop for the whole snapshot/CRUD
// round trip, freezing all window input. The bridge runs it on a
// worker_thread instead.
const serviceBridge = new ServiceBridge();

// User-adjusted window bounds persist across restarts (owner feedback: the
// startup defaults were too tall/narrow — resize once, keep it forever).
const WINDOW_STATE_PATH = path.join(__dirname, '.cache', 'window.json');

function loadSavedBounds() {
  try {
    const saved = JSON.parse(fs.readFileSync(WINDOW_STATE_PATH, 'utf8'));
    if (![saved.x, saved.y, saved.width, saved.height].every(Number.isFinite)) return null;
    if (saved.width < 320 || saved.height < 240) return null;
    // Only restore bounds that are still visible on a connected display.
    const visible = screen.getAllDisplays().some((d) =>
      saved.x < d.bounds.x + d.bounds.width && saved.x + saved.width > d.bounds.x &&
      saved.y < d.bounds.y + d.bounds.height && saved.y + saved.height > d.bounds.y);
    return visible ? saved : null;
  } catch {
    return null;
  }
}

let saveBoundsTimer = null;
function scheduleSaveBounds() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  clearTimeout(saveBoundsTimer);
  saveBoundsTimer = setTimeout(() => {
    try {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      fs.mkdirSync(path.dirname(WINDOW_STATE_PATH), { recursive: true });
      fs.writeFileSync(WINDOW_STATE_PATH, JSON.stringify(mainWindow.getBounds()));
    } catch {
      /* best effort */
    }
  }, 500);
}

const IPC_WHITELIST = new Set([
  'widget:snapshot',
  'widget:task-add',
  'widget:task-toggle',
  'widget:task-defer',
  'widget:task-update',
  'widget:event-update',
  'widget:event-delete',
  'widget:events-range',
  'widget:quit',
  'widget:set-always-on-top'
]);

const WINDOW_WIDTH = 500;
const WINDOW_MARGIN = 24;
// Owner feedback: full display height was too long — default to ~62%.
const WINDOW_HEIGHT_RATIO = 0.62;

let mainWindow = null;

// Widget v2 must never run two instances (same as legacy main.js) — the
// second launch just focuses the first window instead of opening a duplicate.
const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

function findPortraitDisplay() {
  const displays = screen.getAllDisplays();
  return displays.find((display) => display.bounds.height > display.bounds.width) || null;
}

function computeWindowBounds() {
  const saved = loadSavedBounds();
  if (saved) return saved;

  const portrait = findPortraitDisplay();
  if (portrait) {
    const { bounds } = portrait;
    return {
      x: bounds.x + Math.max(WINDOW_MARGIN, Math.round((bounds.width - WINDOW_WIDTH) / 2)),
      y: bounds.y + WINDOW_MARGIN,
      width: WINDOW_WIDTH,
      height: Math.max(480, Math.round(bounds.height * WINDOW_HEIGHT_RATIO))
    };
  }

  // Fallback: right edge of the primary display.
  const primary = screen.getPrimaryDisplay();
  const { workArea } = primary;
  return {
    x: workArea.x + workArea.width - WINDOW_WIDTH - WINDOW_MARGIN,
    y: workArea.y + WINDOW_MARGIN,
    width: WINDOW_WIDTH,
    height: Math.max(480, Math.round(workArea.height * WINDOW_HEIGHT_RATIO))
  };
}

function createWindow() {
  const bounds = computeWindowBounds();
  mainWindow = new BrowserWindow({
    ...bounds,
    frame: false,
    // The always-visible right-monitor widget must stay above normal windows
    // (matches legacy behavior; without this it silently sinks behind them).
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    hasShadow: true,
    // Dark background avoids a white flash before the renderer paints.
    backgroundColor: '#0c0d10',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
    // Windows re-adds a taskbar button when a skip-taskbar window is shown
    // with focus — reassert after show (owner feedback: taskbar entry showed).
    mainWindow.setSkipTaskbar(true);
  });

  mainWindow.on('moved', scheduleSaveBounds);
  mainWindow.on('resized', scheduleSaveBounds);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Env-guarded QA hook: WIDGET_CAPTURE_PATH=<path> captures a PNG of the
  // renderer a few seconds after load (enough time for the async snapshot
  // fetch to resolve and paint), writes it, then quits. No-op unless set.
  if (process.env.WIDGET_CONSOLE_LOG_PATH) {
    mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
      require('fs').appendFileSync(process.env.WIDGET_CONSOLE_LOG_PATH, `[${level}] ${message} (${sourceId}:${line})\n`);
    });
  }

  const capturePath = process.env.WIDGET_CAPTURE_PATH;
  if (capturePath) {
    mainWindow.webContents.on('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const image = await mainWindow.webContents.capturePage();
          require('fs').writeFileSync(capturePath, image.toPNG());
        } finally {
          app.quit();
        }
      }, 3000);
    });
  }
}

ipcMain.handle('widget:snapshot', async () => serviceBridge.call('snapshot'));

ipcMain.handle('widget:task-add', async (_event, payload) => serviceBridge.call('taskAdd', payload || {}));
ipcMain.handle('widget:task-toggle', async (_event, payload) => serviceBridge.call('taskToggle', payload || {}));
ipcMain.handle('widget:task-defer', async (_event, payload) => serviceBridge.call('taskDefer', payload || {}));
ipcMain.handle('widget:task-update', async (_event, payload) => serviceBridge.call('taskUpdate', payload || {}));
ipcMain.handle('widget:event-update', async (_event, payload) => serviceBridge.call('eventUpdate', payload || {}));
ipcMain.handle('widget:event-delete', async (_event, payload) => serviceBridge.call('eventDelete', payload || {}));
ipcMain.handle('widget:events-range', async (_event, payload) => serviceBridge.call('eventsRange', payload || {}));

ipcMain.handle('widget:quit', async () => {
  app.quit();
});
ipcMain.handle('widget:set-always-on-top', async (_event, value) => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setAlwaysOnTop(!!value);
  return !!value;
});

app.whenReady().then(() => {
  createWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});

module.exports = { IPC_WHITELIST, computeWindowBounds, findPortraitDisplay };
