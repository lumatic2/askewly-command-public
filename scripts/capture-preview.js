const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

async function main() {
  await app.whenReady();

  ipcMain.handle('widget:get-initial-state', async () => ({
    planType: 'CODEX',
    primary: { usedPercent: 12, resetAfterSeconds: 14820 },
    secondary: { usedPercent: 7, resetAfterSeconds: 55620 },
    generatedAt: new Date().toISOString(),
    sessionLabel: 'stitch-based dashboard implementation',
    github: {
      owner: 'Mod41529',
      status: 'live',
      columns: {
        now: [
          { name: 'askewly-command', description: 'Agent CLI polish and portfolio demo flow.', isPrivate: true, updatedLabel: '3h ago', local: { branch: 'master', dirtyCount: 3, ahead: 0, behind: 0 } },
          { name: 'portfolio-site', description: 'Business and media sections need final spacing and thumbnail cleanup.', isPrivate: true, updatedLabel: '8h ago', local: { branch: 'master', dirtyCount: 2, ahead: 0, behind: 0 } }
        ],
        next: [
          { name: 'tax-agent', description: 'Prompt execution and validation cleanup.', isPrivate: true, updatedLabel: '12h ago', local: { branch: 'master', dirtyCount: 2, ahead: 0, behind: 0 } },
          { name: 'content-automation', description: 'End-to-end upload flow and thumbnail generation check.', isPrivate: true, updatedLabel: '2d ago', local: { branch: 'master', dirtyCount: 0, ahead: 0, behind: 1 } }
        ],
        blocked: [
          { name: 'agent-orchestration', description: 'Project scope and guard flow need cleanup before next orchestration pass.', isPrivate: true, updatedLabel: '3d ago', local: { branch: 'master', dirtyCount: 1, ahead: 0, behind: 0 } }
        ]
      }
    },
    today: {
      source: 'vault-sync',
      focus: '원가회계 적용 계획 수립 및 구현 — 세무사 협의 + Notion 필드 추가',
      today: ['글쓰기 — 서평 또는 주제 에세이 1편 (반복)'],
      deadlines: ['🔴 D-1 의료 AI 설명회 참석', '⚪ D-8 AICOSS 전문가 특강 참석'],
      recurring: ['매주 목 | 글쓰기 — 서평 또는 주제 에세이 1편'],
      quickNotes: ['[추천] 클로드 코드 입문서 + 강의', '[추천] content-automation E2E 테스트', '[Someday] 개발 — 풋살 연습 앱'],
      statusSummary: '오늘 1건 · 마감 2건 · 반복 1건 · 추천 2건'
    }
  }));

  const outputDir = path.join(__dirname, '..', 'assets');
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, 'widget-screenshot.png');

  const win = new BrowserWindow({
    width: 1200,
    height: 740,
    show: false,
    frame: false,
    transparent: false,
    backgroundColor: '#0a0f15',
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js') }
  });

  await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
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

