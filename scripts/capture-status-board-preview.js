const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '..');
const outputPath = path.join(projectRoot, 'docs', 'artifacts', 'desktop-wide-status-board-m47.png');

function task(id, title, status, sourceKey, extra = {}) {
  return {
    id,
    text: title,
    rawText: title,
    status: status === 'doing' ? 'in_progress' : status === 'done' ? 'completed' : 'pending',
    cloudStatus: status,
    priority: extra.priority || '-',
    sourceKey,
    section: extra.section || '',
    lineIndex: id,
    projectId: extra.projectId || null,
    projectMilestoneId: extra.projectMilestoneId || null,
    projectName: extra.projectName || '',
    projectMilestoneName: extra.projectMilestoneName || '',
    due_at: extra.dueAt || null,
    scheduled_for: extra.scheduledFor || '2026-06-23'
  };
}

function previewState() {
  return {
    generatedAt: new Date().toISOString(),
    today: {
      source: 'cloud',
      snapshot: { focus: 'Status board command hub implementation pass' },
      today: [
        task(4101, '헬스케어 앱', 'doing', 'today', { priority: '높음', projectName: 'Askewly Command', projectMilestoneName: 'M47' }),
        task(4102, 'M1 SSH 활성화 + 전체 기기 ProxyJump 설정', 'doing', 'today', { priority: '높음', projectName: 'Infra' }),
        task(4103, '키우기류 앱 유니티로 제작', 'doing', 'today', { priority: '중간' }),
        task(4104, '반려동물 허브 구체화', 'todo', 'today', { priority: '중간', dueAt: '2026-02-22T16:00:00+09:00' }),
        task(4105, '콜오브듀티 스타일 레벨 디자인', 'delayed', 'today', { priority: '낮음' })
      ],
      deadlines: [
        task(4201, '법인세 신고 준비', 'todo', 'deadline', { priority: '높음', dueAt: '2026-03-31T10:00:00+09:00' }),
        task(4202, '회사 데이터들이 노션과 구글 드라이브에 분산되어 있는데 찾는 방법 구하기', 'done', 'deadline', { priority: '높음', projectName: 'Ops' }),
        task(4203, '주총 소집 통지', 'done', 'deadline', { priority: '높음', dueAt: '2026-03-17T10:00:00+09:00' })
      ],
      backlog: [
        task(4301, '듀얼 모니터 장비 신청', 'delayed', 'backlog', { priority: '높음' }),
        task(4302, '썬글라스 하나 구매하기', 'delayed', 'backlog', { priority: '낮음' }),
        task(4303, '신규 item', 'held', 'backlog', { priority: '중간' })
      ],
      recurring: [],
      archived: [],
      projects: [{ id: 1, name: 'Askewly Command' }, { id: 2, name: 'Infra' }, { id: 3, name: 'Ops' }],
      milestones: [{ id: 11, projectId: 1, title: 'M47' }],
      commandOverview: {
        counts: {
          doingTasks: 3,
          linkedTasks: 4,
          unlinkedTasks: 6,
          contentCandidates: 0,
          projectLinks: 4,
          obsidianLinks: 0
        },
        doingTasks: [{ title: '헬스케어 앱', projectName: 'Askewly Command' }],
        todayProjects: [{ name: 'Askewly Command', northStar: 'Dark status board' }],
        upcomingMilestones: [{ title: 'M47', status: 'active' }],
        obsidianLinks: [],
        contentCandidates: [],
        unlinkedTasks: [{ title: '반려동물 허브 구체화', sourceKey: 'today' }]
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
  ipcMain.handle('widget:get-window-bounds', async () => ({ x: 0, y: 0, width: 1500, height: 920 }));
  ipcMain.handle('widget:refresh', async () => previewState());
  ipcMain.handle('widget:update-settings', async (_event, payload) => ({
    appearance: payload.appearance,
    availableFonts: ['Segoe UI']
  }));

  const win = new BrowserWindow({
    width: 1500,
    height: 920,
    show: false,
    frame: false,
    transparent: false,
    backgroundColor: '#171717',
    webPreferences: { preload: path.join(projectRoot, 'preload.js') }
  });

  await win.loadFile(path.join(projectRoot, 'renderer', 'index.html'));
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
