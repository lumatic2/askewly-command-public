const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '..');
const outputPath = path.join(projectRoot, 'docs', 'artifacts', 'desktop-review-loop-m48.png');

function previewState() {
  return {
    generatedAt: new Date().toISOString(),
    today: {
      source: 'cloud',
      snapshot: { focus: 'Personal review and planning loop' },
      today: [],
      deadlines: [],
      backlog: [],
      recurring: [],
      archived: [],
      projects: [],
      milestones: [],
      commandOverview: {
        counts: {
          doingTasks: 1,
          linkedTasks: 5,
          unlinkedTasks: 1,
          contentCandidates: 2,
          projectLinks: 3,
          obsidianLinks: 1
        },
        doingTasks: [{ title: 'M48 mobile review alignment', projectName: 'Askewly Command' }],
        todayProjects: [{ name: 'Askewly Command', northStar: 'Daily review loop' }],
        upcomingMilestones: [{ title: 'M48', status: 'active' }],
        obsidianLinks: [{ title: 'Daily planning note', target: 'obsidian://open?vault=askewly&file=Daily' }],
        contentCandidates: [{ title: 'Review loop evidence note', projectName: 'Askewly Command' }],
        unlinkedTasks: [{ title: 'Unlinked planning cleanup', sourceKey: 'today' }],
        review: {
          start: [
            {
              id: 'start-next',
              label: 'Next',
              title: 'M48 mobile review alignment',
              detail: 'today · Askewly Command',
              actionLabel: 'Open Schedule',
              target: 'schedule',
              sourceKey: 'today'
            },
            {
              id: 'start-due',
              label: 'Due soon',
              title: 'Review loop evidence capture',
              detail: 'deadline · Askewly Command · todo',
              actionLabel: 'Review due item',
              target: 'schedule',
              sourceKey: 'deadline'
            },
            {
              id: 'start-blockers',
              label: 'Held / delayed',
              title: 'Delayed handoff cleanup',
              detail: 'Decide whether to resume, keep held, or defer.',
              actionLabel: 'Open board',
              target: 'schedule',
              sourceKey: 'backlog'
            }
          ],
          close: [
            {
              id: 'close-current',
              label: 'Current work',
              title: 'M48 mobile review alignment',
              detail: 'Complete, hold, or delay before ending the day.',
              actionLabel: 'Review current',
              target: 'schedule',
              sourceKey: 'today'
            },
            {
              id: 'close-done',
              label: 'Completed / carry-over',
              title: '1 doing · 1 delayed',
              detail: 'Clear what should remain active tomorrow.',
              actionLabel: 'Review board',
              target: 'schedule',
              sourceKey: 'today'
            },
            {
              id: 'close-links',
              label: 'Context links',
              title: 'Unlinked planning cleanup',
              detail: 'Attach project or milestone context while it is fresh.',
              actionLabel: 'Open Projects',
              target: 'projects',
              sourceKey: 'today'
            }
          ]
        }
      }
    }
  };
}

async function main() {
  await app.whenReady();
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  ipcMain.handle('widget:get-initial-state', async () => previewState());
  ipcMain.handle('widget:get-settings', async () => ({
    appearance: { theme: 'dark', fontFamily: 'Segoe UI', fontSize: 13 },
    availableFonts: ['Segoe UI']
  }));
  ipcMain.handle('widget:get-cloud-auth-status', async () => ({ configured: true, enabled: true, signedIn: true, userEmail: 'preview@askewly.local' }));
  ipcMain.handle('widget:get-window-bounds', async () => ({ x: 0, y: 0, width: 1220, height: 900 }));
  ipcMain.handle('widget:refresh', async () => previewState());
  ipcMain.handle('widget:update-settings', async (_event, payload) => ({
    appearance: payload.appearance,
    availableFonts: ['Segoe UI']
  }));

  const win = new BrowserWindow({
    width: 1220,
    height: 900,
    show: false,
    frame: false,
    transparent: false,
    backgroundColor: '#171717',
    webPreferences: { preload: path.join(projectRoot, 'preload.js') }
  });

  await win.loadFile(path.join(projectRoot, 'renderer', 'index.html'));
  await win.webContents.executeJavaScript(`
    localStorage.setItem('askewly-command-active-tab-v1', 'command');
    if (typeof setActiveTab === 'function') setActiveTab('command');
  `);
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const image = await win.capturePage();
  fs.writeFileSync(outputPath, image.toPNG());
  console.log(outputPath);

  await win.close();
  app.quit();
}

main().catch((error) => {
  console.error(error);
  app.exit(1);
});
