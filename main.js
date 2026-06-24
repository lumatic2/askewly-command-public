const { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, screen, shell, globalShortcut, powerMonitor } = require('electron');
const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  addCloudScheduleItem,
  deleteCloudScheduleItem,
  isCloudScheduleEnabled,
  loadCloudScheduleState,
  moveCloudScheduleItem,
  reorderCloudScheduleItem,
  restoreCloudArchivedItem,
  updateCloudScheduleItem,
  updateCloudScheduleItemGraph,
  updateCloudScheduleItemText
} = require('./main/sources/cloud-schedule-source');
const {
  refreshDesktopCloudSession,
  signOutDesktopCloud,
  startDesktopOAuth
} = require('./main/sources/cloud-auth');

const execFileAsync = promisify(execFile);

// transparent + frameless + alwaysOnTop 창은 Windows 에서 GPU 합성 프로세스가
// 크래시하면 마지막 프레임을 박제한 채 멈춘다(휠·클릭·갱신 死). GPU 합성을 끄면
// 이 freeze 의 대부분이 사라진다. 위젯은 무거운 애니메이션이 없어 체감 손해 없음.
// 반드시 app ready 이전에 호출.
app.disableHardwareAcceleration();

const APP_NAME = 'Askewly Command';
const CHATGPT_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';
const MIN_WIDTH = 720;
const MIN_HEIGHT = 620;
const CLOUD_REFRESH_INTERVAL_MS = 5000;
const DEFAULT_SETTINGS = {
  width: 960,
  height: 740,
  x: 40,
  y: 40,
  alwaysOnTop: true,
  openOnStartup: true,
  refreshIntervalMs: 60000,
  appearance: {
    theme: 'dark',
    fontFamily: 'Segoe UI',
    fontSize: 13
  }
};

const DEFAULT_DASHBOARD_CONFIG = {
  github: {
    owner: 'Mod41529',
    columns: {
      now: ['askewly-command', 'portfolio-site', 'agent-cli-demo'],
      next: ['tax-agent', 'content-automation', 'openclaw-voice'],
      blocked: ['auction-analyzer', 'agent-orchestration']
    }
  },
  today: {
    cachePath: '',
    syncScript: '',
    autoSyncOnRefresh: true,
    mount: {
      enabled: true,
      driveLetter: 'V:',
      basePath: 'V:\\30-projects\\schedule',
      rcloneConfigPath: '',
      remoteName: 'm4vault',
      remoteRoot: '/Users/<user>/vault'
    },
    remote: {
      enabled: true,
      host: 'user@m4',
      baseDir: '~/vault/30-projects/schedule'
    },
    paths: {
      schedule: '',
      backlog: '',
      recurring: ''
    },
    snapshot: {
      focus: '의료 AI 설명회 참석 + 원가회계 적용 정리',
      today: ['글쓰기 — 서평 또는 주제 에세이 1편'],
      deadlines: ['의료 AI 설명회 참석 `04-02`'],
      recurring: ['목요일 글쓰기 루틴', '주간 시스템 정리', '리뷰 인박스 점검'],
      quickNotes: ['BizSim 홈화면/UI 마무리', '원가회계 세무사 연락 + Notion 필드 추가', '클로드 코드 강의 준비'],
      statusSummary: '당일 마감 1건, 목요일 루틴 진행일'
    },
    cloud: {
      enabled: false,
      supabaseUrl: '',
      anonKey: '',
      accessToken: ''
    }
  }
};

loadLocalEnv();

let mainWindow = null;
let tray = null;
let refreshTimer = null;
let snapshotTimer = null;
let autoSyncTimer = null;
let heartbeatTimer = null;
let autoSyncInFlight = false;
const pushQueue = new Set();
let pushDebounceTimer = null;
let pushInFlight = false;
let pushFailureStreak = 0;
const MAX_PUSH_FAILURE_STREAK = 5;
let executableCache = null;
let lastWidgetState = null;
let installedFontFamiliesCache = { timestamp: 0, values: [] };
let sessionLabelCache = { timestamp: 0, value: 'Recent session', pending: null };
let todayWatchers = [];
let todayWatcherSignature = '';
let todayRefreshDebounceTimer = null;
let todayRefreshInFlight = null;
let lastMutationRefreshAt = 0;
let usageCache = {
  planType: 'CODEX',
  primary: { usedPercent: 0, resetAfterSeconds: null },
  secondary: { usedPercent: 0, resetAfterSeconds: null },
  timestamp: 0,
  pending: null
};
let githubCache = null;
let appDataMigrationChecked = false;

const APP_DATA_DIR_NAME = 'askewly-command';
const LEGACY_APP_DATA_DIR_NAME = 'workspace-pulse-dashboard';
const MIGRATION_PREFER_LEGACY_FILES = [
  'dashboard-config.json',
  'settings.json',
  'cloud-auth-storage.json',
  'today-cache.json'
];

function getCodexHome() {
  const envRoot = (process.env.CODEX_HOME || '').trim();
  return envRoot ? envRoot : path.join(process.env.USERPROFILE || app.getPath('home'), '.codex');
}

function getProjectsRoot() {
  return path.join(process.env.USERPROFILE || app.getPath('home'), 'projects');
}

function getAppDataDir() {
  const roamingRoot = process.env.APPDATA || path.join(process.env.USERPROFILE || app.getPath('home'), 'AppData', 'Roaming');
  const dir = path.join(roamingRoot, APP_DATA_DIR_NAME, 'widget');
  migrateLegacyAppData(roamingRoot, dir);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function migrateLegacyAppData(roamingRoot, targetDir) {
  if (appDataMigrationChecked) {
    appDataMigrationChecked = true;
    return;
  }

  const legacyDir = path.join(roamingRoot, LEGACY_APP_DATA_DIR_NAME, 'widget');
  if (!fs.existsSync(legacyDir)) {
    appDataMigrationChecked = true;
    return;
  }

  try {
    fs.mkdirSync(path.dirname(targetDir), { recursive: true });
    copyMissingRecursive(legacyDir, targetDir);
    promoteNewerLegacyFiles(legacyDir, targetDir);
    fs.writeFileSync(
      path.join(targetDir, 'migration.json'),
      JSON.stringify({
        from: legacyDir,
        to: targetDir,
        migratedAt: new Date().toISOString(),
        note: 'Legacy Workspace Pulse settings were copied during the Askewly Command migration. The legacy directory is intentionally preserved.'
      }, null, 2)
    );
  } catch (error) {
    console.error('Failed to migrate legacy app data:', error);
  } finally {
    appDataMigrationChecked = true;
  }
}

function promoteNewerLegacyFiles(legacyDir, targetDir) {
  for (const fileName of MIGRATION_PREFER_LEGACY_FILES) {
    const legacyPath = path.join(legacyDir, fileName);
    const targetPath = path.join(targetDir, fileName);
    if (!fs.existsSync(legacyPath)) {
      continue;
    }
    if (!fs.existsSync(targetPath)) {
      fs.copyFileSync(legacyPath, targetPath);
      continue;
    }
    const legacyStat = fs.statSync(legacyPath);
    const targetStat = fs.statSync(targetPath);
    if (legacyStat.mtimeMs <= targetStat.mtimeMs) {
      continue;
    }
    const backupPath = `${targetPath}.pre-askewly-command-migration`;
    if (!fs.existsSync(backupPath)) {
      fs.copyFileSync(targetPath, backupPath);
    }
    fs.copyFileSync(legacyPath, targetPath);
  }
}

function copyMissingRecursive(sourceDir, targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copyMissingRecursive(sourcePath, targetPath);
      continue;
    }
    if (!entry.isFile() || fs.existsSync(targetPath)) {
      continue;
    }
    fs.copyFileSync(sourcePath, targetPath);
  }
}

function getSettingsPath() {
  return path.join(getAppDataDir(), 'settings.json');
}

function getDashboardConfigPath() {
  return path.join(getAppDataDir(), 'dashboard-config.json');
}

function getCloudAuthStoragePath() {
  return path.join(getAppDataDir(), 'cloud-auth-storage.json');
}

function getTodayCachePath() {
  return path.join(getAppDataDir(), 'today-cache.json');
}

function getLocalScheduleDir() {
  const dir = path.join(getAppDataDir(), 'schedule');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const LOCAL_SCHEDULE_FILE_NAMES = {
  today: 'SCHEDULE.md',
  deadline: 'SCHEDULE.md',
  recurring: 'RECURRING.md',
  backlog: 'BACKLOG.md'
};

const LOCAL_ARCHIVE_FILE_NAMES = {
  today: 'SCHEDULE_ARCHIVE.md',
  deadline: 'SCHEDULE_ARCHIVE.md',
  recurring: 'RECURRING_ARCHIVE.md',
  backlog: 'BACKLOG_ARCHIVE.md'
};

function getLocalScheduleFile(sourceKey) {
  const name = LOCAL_SCHEDULE_FILE_NAMES[sourceKey];
  return name ? path.join(getLocalScheduleDir(), name) : '';
}

function getLocalArchiveFileByKey(sourceKey) {
  const name = LOCAL_ARCHIVE_FILE_NAMES[sourceKey];
  return name ? path.join(getLocalScheduleDir(), name) : '';
}

function getRemoteScheduleDir(todayConfig) {
  const baseDir = String(todayConfig?.remote?.baseDir || DEFAULT_DASHBOARD_CONFIG.today.remote.baseDir).trim().replace(/\/$/, '');
  return baseDir;
}

function getSshHost(todayConfig) {
  return todayConfig?.remote?.host || DEFAULT_DASHBOARD_CONFIG.today.remote.host;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadLocalEnv() {
  const envPath = path.join(__dirname, '.env.local');
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex <= 0) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function findExistingPath(candidates) {
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || null;
}

function getExecutablePaths() {
  if (executableCache) {
    return executableCache;
  }

  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const localAppData = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || app.getPath('home'), 'AppData', 'Local');

  const ghPath = findExistingPath([
    path.join(programFiles, 'GitHub CLI', 'gh.exe'),
    path.join(localAppData, 'GitHub CLI', 'gh.exe'),
    'gh'
  ]);

  const gitPath = findExistingPath([
    path.join(programFiles, 'Git', 'cmd', 'git.exe'),
    path.join(programFiles, 'Git', 'bin', 'git.exe'),
    'git'
  ]);

  executableCache = { gh: ghPath || 'gh', git: gitPath || 'git' };
  return executableCache;
}

function ensureJsonFile(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(fallback, null, 2), 'utf8');
    return clone(fallback);
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return clone(fallback);
  }
}

function loadSettings() {
  const raw = ensureJsonFile(getSettingsPath(), DEFAULT_SETTINGS);
  const merged = {
    ...DEFAULT_SETTINGS,
    ...raw,
    appearance: {
      ...DEFAULT_SETTINGS.appearance,
      ...(raw?.appearance || {})
    }
  };
  merged.width = Math.max(MIN_WIDTH, Number(merged.width || DEFAULT_SETTINGS.width));
  merged.height = Math.max(MIN_HEIGHT, Number(merged.height || DEFAULT_SETTINGS.height));
  const theme = String(merged.appearance?.theme || DEFAULT_SETTINGS.appearance.theme);
  merged.appearance.theme = ['light', 'dark', 'system'].includes(theme) ? theme : DEFAULT_SETTINGS.appearance.theme;
  const legacyFontFamilyMap = {
    segoe: 'Segoe UI',
    notoSansKr: 'Noto Sans KR',
    bahnschrift: 'Bahnschrift',
    calibri: 'Calibri',
    georgia: 'Georgia',
    monospace: 'Cascadia Mono',
    inter: 'Inter',
    pretendard: 'Pretendard',
    ibmPlexSans: 'IBM Plex Sans'
  };
  const rawFontFamily = String(merged.appearance?.fontFamily || DEFAULT_SETTINGS.appearance.fontFamily).trim();
  const normalizedFontFamily = legacyFontFamilyMap[rawFontFamily] || rawFontFamily;
  merged.appearance.fontFamily = normalizedFontFamily || DEFAULT_SETTINGS.appearance.fontFamily;
  const fontSize = Number(merged.appearance?.fontSize || DEFAULT_SETTINGS.appearance.fontSize);
  merged.appearance.fontSize = Number.isFinite(fontSize)
    ? Math.min(18, Math.max(10, Math.round(fontSize)))
    : DEFAULT_SETTINGS.appearance.fontSize;
  return merged;
}

const DEFAULT_FONT_FAMILIES = [
  'Segoe UI',
  'Noto Sans KR',
  'Bahnschrift',
  'Calibri',
  'Georgia',
  'Cascadia Mono'
];

function getCachedFontFamilies() {
  if (installedFontFamiliesCache.values.length > 0) {
    return installedFontFamiliesCache.values;
  }
  return DEFAULT_FONT_FAMILIES;
}

function getSettingsPayload() {
  return {
    ...loadSettings(),
    availableFonts: getCachedFontFamilies()
  };
}

function saveSettings(settings) {
  fs.writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2), 'utf8');
}

function loadDashboardConfig() {
  const raw = ensureJsonFile(getDashboardConfigPath(), DEFAULT_DASHBOARD_CONFIG);
  return {
    github: {
      owner: raw.github?.owner || DEFAULT_DASHBOARD_CONFIG.github.owner,
      columns: {
        now: raw.github?.columns?.now || DEFAULT_DASHBOARD_CONFIG.github.columns.now,
        next: raw.github?.columns?.next || DEFAULT_DASHBOARD_CONFIG.github.columns.next,
        blocked: raw.github?.columns?.blocked || DEFAULT_DASHBOARD_CONFIG.github.columns.blocked
      }
    },
    today: {
      cachePath: raw.today?.cachePath || getTodayCachePath(),
      syncScript: raw.today?.syncScript || path.join(__dirname, 'scripts', 'sync-today-cache.js'),
      autoSyncOnRefresh: raw.today?.autoSyncOnRefresh !== false,
      mount: {
        enabled: raw.today?.mount?.enabled !== false,
        driveLetter: raw.today?.mount?.driveLetter || DEFAULT_DASHBOARD_CONFIG.today.mount.driveLetter,
        basePath: raw.today?.mount?.basePath || DEFAULT_DASHBOARD_CONFIG.today.mount.basePath,
        rcloneConfigPath: raw.today?.mount?.rcloneConfigPath || path.join(getAppDataDir(), 'rclone.conf'),
        remoteName: raw.today?.mount?.remoteName || DEFAULT_DASHBOARD_CONFIG.today.mount.remoteName,
        remoteRoot: raw.today?.mount?.remoteRoot || DEFAULT_DASHBOARD_CONFIG.today.mount.remoteRoot
      },
      remote: {
        enabled: raw.today?.remote?.enabled !== false,
        host: raw.today?.remote?.host || DEFAULT_DASHBOARD_CONFIG.today.remote.host,
        baseDir: raw.today?.remote?.baseDir || DEFAULT_DASHBOARD_CONFIG.today.remote.baseDir
      },
      paths: {
        schedule: raw.today?.paths?.schedule || '',
        backlog: raw.today?.paths?.backlog || '',
        recurring: raw.today?.paths?.recurring || ''
      },
      snapshot: raw.today?.snapshot || clone(DEFAULT_DASHBOARD_CONFIG.today.snapshot),
      cloud: {
        enabled: raw.today?.cloud?.enabled === true,
        supabaseUrl: raw.today?.cloud?.supabaseUrl || process.env.SUPABASE_URL || '',
        anonKey: raw.today?.cloud?.anonKey || process.env.SUPABASE_ANON_KEY || '',
        accessToken: raw.today?.cloud?.accessToken || getCommandEnv('SUPABASE_ACCESS_TOKEN') || '',
        userEmail: raw.today?.cloud?.userEmail || '',
        expiresAt: raw.today?.cloud?.expiresAt || null
      }
    },
    notion: {
      workspaces: Array.isArray(raw.notion?.workspaces) ? raw.notion.workspaces : [],
      activeWorkspaceId: raw.notion?.activeWorkspaceId || ''
    }
  };
}

function saveDashboardConfig(next) {
  fs.writeFileSync(getDashboardConfigPath(), JSON.stringify(next, null, 2), 'utf8');
}

function updateNotionWorkspaces(patch) {
  const raw = ensureJsonFile(getDashboardConfigPath(), DEFAULT_DASHBOARD_CONFIG);
  raw.notion = raw.notion || { workspaces: [], activeWorkspaceId: '' };
  if (patch.workspaces) raw.notion.workspaces = patch.workspaces;
  if (patch.activeWorkspaceId !== undefined) raw.notion.activeWorkspaceId = patch.activeWorkspaceId;
  saveDashboardConfig(raw);
  return raw.notion;
}

function clampBounds(bounds, settings) {
  const display = screen.getDisplayNearestPoint({ x: settings.x, y: settings.y });
  const workArea = display.workArea;
  const width = settings.width;
  const height = settings.height;
  const x = Math.min(Math.max(bounds.x, workArea.x), workArea.x + workArea.width - width);
  const y = Math.min(Math.max(bounds.y, workArea.y), workArea.y + workArea.height - height);
  return { x, y };
}

function getRightmostDisplay() {
  const displays = screen.getAllDisplays();
  return displays.reduce((selected, current) => {
    if (!selected) return current;
    return current.workArea.x > selected.workArea.x ? current : selected;
  }, null);
}

function getLeftmostDisplay() {
  const displays = screen.getAllDisplays();
  return displays.reduce((selected, current) => {
    if (!selected) return current;
    return current.workArea.x < selected.workArea.x ? current : selected;
  }, null);
}

function getPrimaryDisplay() {
  return screen.getPrimaryDisplay();
}

function moveWindowToDisplay(targetDisplay) {
  if (!mainWindow || mainWindow.isDestroyed() || !targetDisplay) {
    return;
  }

  const current = loadSettings();
  const nextWidth = Math.min(Math.max(MIN_WIDTH, current.width), targetDisplay.workArea.width);
  const nextHeight = Math.min(Math.max(MIN_HEIGHT, current.height), targetDisplay.workArea.height);
  const nextX = targetDisplay.workArea.x + Math.max(24, targetDisplay.workArea.width - nextWidth - 32);
  const nextY = targetDisplay.workArea.y + 24;

  mainWindow.setBounds({ x: nextX, y: nextY, width: nextWidth, height: nextHeight });
  saveSettings({
    ...current,
    x: nextX,
    y: nextY,
    width: nextWidth,
    height: nextHeight
  });
  mainWindow.show();
  mainWindow.focus();
}

function centerWindowOnDisplay(targetDisplay) {
  if (!mainWindow || mainWindow.isDestroyed() || !targetDisplay) {
    return;
  }

  const current = loadSettings();
  const nextWidth = Math.min(Math.max(MIN_WIDTH, current.width), targetDisplay.workArea.width);
  const nextHeight = Math.min(Math.max(MIN_HEIGHT, current.height), targetDisplay.workArea.height);
  const nextX = targetDisplay.workArea.x + Math.round((targetDisplay.workArea.width - nextWidth) / 2);
  const nextY = targetDisplay.workArea.y + Math.round((targetDisplay.workArea.height - nextHeight) / 2);

  mainWindow.setBounds({ x: nextX, y: nextY, width: nextWidth, height: nextHeight });
  saveSettings({
    ...current,
    x: nextX,
    y: nextY,
    width: nextWidth,
    height: nextHeight
  });
  mainWindow.show();
  mainWindow.focus();
}

function resetWindowToPrimary() {
  centerWindowOnDisplay(getPrimaryDisplay());
}

function persistWindowBounds() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const current = loadSettings();
  const bounds = mainWindow.getBounds();
  saveSettings({
    ...current,
    x: bounds.x,
    y: bounds.y,
    width: Math.max(MIN_WIDTH, bounds.width),
    height: Math.max(MIN_HEIGHT, bounds.height)
  });
}

function parseWindow(windowPayload) {
  if (!windowPayload) {
    return { usedPercent: 0, resetAfterSeconds: null };
  }

  return {
    usedPercent: Number(windowPayload.used_percent || 0),
    resetAfterSeconds: windowPayload.reset_after_seconds ?? null
  };
}

function loadAuthPayload() {
  const authPath = path.join(getCodexHome(), 'auth.json');
  if (!fs.existsSync(authPath)) {
    throw new Error(`Codex auth file not found: ${authPath}`);
  }
  return JSON.parse(fs.readFileSync(authPath, 'utf8'));
}

async function fetchUsage() {
  const authPayload = loadAuthPayload();
  const tokens = authPayload.tokens || {};
  const accessToken = tokens.access_token || authPayload.OPENAI_API_KEY;
  if (!accessToken) {
    throw new Error('Codex access token is missing from auth.json');
  }

  const headers = {
    Accept: 'application/json',
    Authorization: `Bearer ${accessToken}`,
    'User-Agent': 'AskewlyCommand/0.1.0'
  };

  if (tokens.account_id) {
    headers['ChatGPT-Account-Id'] = tokens.account_id;
  }

  // timeout 없는 fetch 는 네트워크 stall 시 refreshState 를 무한 hang 시킨다.
  // 10s AbortController 로 끊어 상태 갱신 루프가 막히지 않게 한다.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  let response;
  try {
    response = await fetch(CHATGPT_USAGE_URL, { headers, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error('Codex login is expired. Please login again.');
  }
  if (!response.ok) {
    throw new Error(`Usage request failed: ${response.status}`);
  }

  const payload = await response.json();
  return {
    planType: String(payload.plan_type || 'unknown').toUpperCase(),
    primary: parseWindow(payload.rate_limit?.primary_window),
    secondary: parseWindow(payload.rate_limit?.secondary_window)
  };
}

function getSessionLabel() {
  return sessionLabelCache.value;
}

function getCommandEnv(name) {
  return process.env[`ASKEWLY_COMMAND_${name}`] || process.env[`WORKSPACE_PULSE_${name}`] || '';
}

async function runCommand(command, args, options = {}) {
  const result = await execFileAsync(command, args, {
    windowsHide: true,
    timeout: options.timeout ?? 15000,
    maxBuffer: 1024 * 1024 * 4
  });
  return result.stdout.trim();
}

async function withRetry(task, options = {}) {
  const retries = options.retries ?? 2;
  const delays = options.delays ?? [300, 800, 1500];
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      const message = String(error?.message || error || '');
      const retryable = message.includes('EIO') || message.includes('i/o error') || message.includes('EBUSY') || message.includes('EPERM') || message.includes('ETIMEDOUT') || message.includes('ECONNRESET') || message.includes('Connection reset') || message.includes('ENOTCONN');
      if (!retryable || attempt === retries) {
        throw error;
      }
      await sleep(delays[attempt] ?? delays[delays.length - 1] ?? 500);
    }
  }

  throw lastError;
}

function escapeShellDoubleQuoted(value) {
  return String(value).replace(/(["\\$`])/g, '\\$1');
}

function parseRelativeDate(input) {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    return 'unknown';
  }
  const diffMs = Date.now() - date.getTime();
  const diffHours = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60)));
  if (diffHours < 1) {
    return 'just now';
  }
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) {
    return `${diffDays}d ago`;
  }
  return date.toISOString().slice(0, 10);
}

function parseGitStatus(stdout) {
  const lines = stdout.split(/\r?\n/).filter(Boolean);
  const summary = { branch: null, dirtyCount: 0, ahead: 0, behind: 0 };
  if (lines.length === 0) {
    return summary;
  }

  const branchLine = lines[0];
  const branchMatch = branchLine.match(/^## ([^.\s]+)(?:\.\.\.[^\s]+)?(?: \[(.+)\])?/);
  if (branchMatch) {
    summary.branch = branchMatch[1];
    const counts = branchMatch[2] || '';
    const aheadMatch = counts.match(/ahead (\d+)/);
    const behindMatch = counts.match(/behind (\d+)/);
    summary.ahead = aheadMatch ? Number(aheadMatch[1]) : 0;
    summary.behind = behindMatch ? Number(behindMatch[1]) : 0;
  }
  summary.dirtyCount = Math.max(0, lines.length - 1);
  return summary;
}

async function loadLocalRepoStatus(repoName) {
  const executables = getExecutablePaths();
  const repoPath = path.join(getProjectsRoot(), repoName);
  if (!fs.existsSync(path.join(repoPath, '.git'))) {
    return { exists: false, path: repoPath, branch: null, dirtyCount: 0, ahead: 0, behind: 0 };
  }

  try {
    const stdout = await runCommand(executables.git, ['-C', repoPath, 'status', '--short', '--branch'], { timeout: 8000 });
    return { exists: true, path: repoPath, ...parseGitStatus(stdout) };
  } catch {
    return { exists: true, path: repoPath, branch: null, dirtyCount: 0, ahead: 0, behind: 0 };
  }
}

async function fetchGitHubRepoCatalog(owner) {
  const executables = getExecutablePaths();
  const stdout = await runCommand(executables.gh, ['repo', 'list', owner, '--limit', '100', '--json', 'name,description,isPrivate,updatedAt,url']);
  const payload = JSON.parse(stdout);
  return new Map(payload.map((repo) => [repo.name, repo]));
}

async function buildGitHubColumnItems(repoNames, repoMap) {
  const items = await Promise.all(repoNames.map(async (repoName) => {
    const repo = repoMap.get(repoName) || {
      name: repoName,
      description: 'Repo not found in current owner listing.',
      isPrivate: false,
      updatedAt: null,
      url: ''
    };
    const local = await loadLocalRepoStatus(repo.name);
    return {
      name: repo.name,
      description: repo.description || 'No description',
      isPrivate: Boolean(repo.isPrivate),
      updatedAt: repo.updatedAt,
      updatedLabel: repo.updatedAt ? parseRelativeDate(repo.updatedAt) : 'unknown',
      url: repo.url || '',
      local
    };
  }));
  return items;
}

async function buildGitHubBoard(config) {
  try {
    const repoMap = await fetchGitHubRepoCatalog(config.owner);
    return {
      owner: config.owner,
      status: 'live',
      columns: {
        now: await buildGitHubColumnItems(config.columns.now, repoMap),
        next: await buildGitHubColumnItems(config.columns.next, repoMap),
        blocked: await buildGitHubColumnItems(config.columns.blocked, repoMap)
      }
    };
  } catch (error) {
    return {
      owner: config.owner,
      status: 'offline',
      error: error instanceof Error ? error.message : String(error),
      columns: { now: [], next: [], blocked: [] }
    };
  }
}

function getGithubSnapshot(config) {
  if (githubCache) {
    return githubCache;
  }
  return {
    owner: config.owner,
    status: 'deferred',
    columns: { now: [], next: [], blocked: [] }
  };
}

function getUsageSnapshot() {
  return {
    planType: usageCache.planType,
    primary: usageCache.primary,
    secondary: usageCache.secondary
  };
}

function resolvePath(value) {
  if (!value) return '';
  return path.isAbsolute(value) ? value : path.resolve(value);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseTaskLine(line) {
  const match = line.trim().match(/^- \[([ x/~])\]\s*(?:\[([^\]]*)\]\s*)?(.*?)\s*(#[^\s#`]+)?\s*$/);
  if (!match) {
    const recurringMatch = line.trim().match(/^-\s*([^|]+)\|\s*(.*?)\s*(#[^\s#`]+)?\s*$/);
    if (!recurringMatch) return null;
    const cadence = String(recurringMatch[1] || '').trim();
    const rawText = String(recurringMatch[2] || '').trim();
    const category = (recurringMatch[3] || '').trim();
    return {
      status: 'pending',
      priority: '-',
      text: cadence ? `${cadence} | ${rawText}` : rawText,
      category
    };
  }

  const statusRaw = match[1];
  const priority = (match[2] || '-').trim();
  let text = (match[3] || '').trim();
  const category = (match[4] || '').trim();

  if (category && text.endsWith(category)) {
    text = text.slice(0, -category.length).trim();
  }

  return {
    status: statusRaw === 'x'
      ? 'completed'
      : statusRaw === '/'
        ? 'in_progress'
        : statusRaw === '~'
          ? 'cancelled'
          : 'pending',
    priority: ['높', '중', '낮', '-'].includes(priority) ? priority : '-',
    text,
    category
  };
}

function parseTaskFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return [];

  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  const items = [];
  let section = '';

  lines.forEach((line, lineIndex) => {
    const stripped = line.trim();
    if (stripped.startsWith('## ')) {
      section = stripped.slice(3).trim();
      return;
    }
    const parsed = parseTaskLine(line);
    if (!parsed) return;
    items.push({ section, lineIndex, ...parsed });
  });

  return items;
}

function formatDeadlineLabel(text) {
  const explicit = String(text || '').match(/`(\d{2}-\d{2})(?:[^`]*)`/);
  const monthDay = explicit ? explicit[1] : null;
  if (!monthDay) return text;

  const now = new Date();
  const currentYear = now.getFullYear();
  const due = new Date(`${currentYear}-${monthDay}`);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.ceil((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  let badge = '⚪';
  if (diffDays <= 3) badge = '🔴';
  else if (diffDays <= 7) badge = '🟡';
  const dLabel = diffDays >= 0 ? `D-${diffDays}` : `D+${Math.abs(diffDays)}`;
  return `${badge} ${dLabel} ${String(text).replace(/`[^`]+`/g, '').trim()}`;
}

function makeTodayItem(item, sourceKey, options = {}) {
  return {
    id: `${sourceKey}:${item.lineIndex}`,
    text: options.label || item.text,
    rawText: item.text,
    status: item.status,
    priority: item.priority,
    sourceKey,
    section: item.section,
    lineIndex: item.lineIndex
  };
}

function normalizeTodayItems(items, sourceKey) {
  return (items || []).map((item, index) => {
    if (typeof item === 'string') {
      return {
        id: `${sourceKey}:snapshot:${index}`,
        text: item,
        rawText: item,
        status: 'pending',
        priority: '-',
        sourceKey,
        section: '',
        lineIndex: null
      };
    }
    return item;
  });
}

function loadArchivedItemsFromPaths(paths) {
  const scheduleArchivePath = resolvePath(paths.scheduleArchive);
  const recurringArchivePath = resolvePath(paths.recurringArchive);
  const backlogArchivePath = resolvePath(paths.backlogArchive);

  const scheduleArchiveItems = parseTaskFile(scheduleArchivePath).map((item) => {
    const sourceKey = inferSourceFromScheduleSection(item.section);
    return {
      ...makeTodayItem(item, sourceKey),
      archived: true
    };
  });
  const recurringArchiveItems = parseTaskFile(recurringArchivePath).map((item) => ({
    ...makeTodayItem(item, 'recurring'),
    archived: true
  }));
  const backlogArchiveItems = parseTaskFile(backlogArchivePath).map((item) => ({
    ...makeTodayItem(item, 'backlog'),
    archived: true
  }));

  return [...scheduleArchiveItems, ...recurringArchiveItems, ...backlogArchiveItems]
    .sort((a, b) => String(a.text || '').localeCompare(String(b.text || ''), 'ko'));
}

function pickRecurringItems(items) {
  if (items.length === 0) return [];

  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'Asia/Seoul' }).format(new Date());
  const weekdayShort = weekday.slice(0, 3).toLowerCase();
  const weekdayKoMap = {
    Monday: ['월', '월요일'],
    Tuesday: ['화', '화요일'],
    Wednesday: ['수', '수요일'],
    Thursday: ['목', '목요일'],
    Friday: ['금', '금요일'],
    Saturday: ['토', '토요일'],
    Sunday: ['일', '일요일']
  };
  const koTerms = weekdayKoMap[weekday] || [];
  const activeItems = items.filter((item) => item.status !== 'completed' && item.status !== 'cancelled');
  const matchesWeekday = (item) => {
    const haystack = `${item.section || ''} ${item.text}`.toLowerCase();
    return haystack.includes(weekday.toLowerCase()) || haystack.includes(weekdayShort) || koTerms.some((term) => haystack.includes(term));
  };
  const matching = activeItems.filter(matchesWeekday);
  const generic = activeItems.filter((item) => !matchesWeekday(item));

  return [...matching, ...generic].slice(0, 4).map((item) => item.text);
}

function buildTodayFromSnapshot(snapshot) {
  return {
    source: 'snapshot',
    today: normalizeTodayItems(snapshot.today || [], 'today'),
    deadlines: normalizeTodayItems(snapshot.deadlines || [], 'deadline'),
    recurring: normalizeTodayItems(snapshot.recurring || [], 'recurring'),
    backlog: normalizeTodayItems(snapshot.backlog || snapshot.quickNotes || [], 'backlog'),
    archived: [],
    statusSummary: snapshot.statusSummary || 'No status summary'
  };
}

function normalizeTodayData(raw, fallbackSnapshot) {
  if (!raw || typeof raw !== 'object') {
    return buildTodayFromSnapshot(fallbackSnapshot);
  }

  return {
    source: raw.source || 'cache',
    today: normalizeTodayItems(Array.isArray(raw.today) ? raw.today : fallbackSnapshot.today || [], 'today'),
    deadlines: normalizeTodayItems(Array.isArray(raw.deadlines) ? raw.deadlines : fallbackSnapshot.deadlines || [], 'deadline'),
    recurring: normalizeTodayItems(Array.isArray(raw.recurring) ? raw.recurring : fallbackSnapshot.recurring || [], 'recurring'),
    backlog: normalizeTodayItems(Array.isArray(raw.backlog) ? raw.backlog : Array.isArray(raw.quickNotes) ? raw.quickNotes : fallbackSnapshot.backlog || fallbackSnapshot.quickNotes || [], 'backlog'),
    archived: normalizeTodayItems(Array.isArray(raw.archived) ? raw.archived : [], 'archive').map((item) => ({
      ...item,
      sourceKey: canonicalSourceKey(item.sourceKey),
      archived: true
    })),
    statusSummary: raw.statusSummary || fallbackSnapshot.statusSummary || 'No status summary'
  };
}

function buildTodayFromFiles(paths, snapshot) {
  const scheduleItems = parseTaskFile(resolvePath(paths.schedule));
  const backlogItems = parseTaskFile(resolvePath(paths.backlog));
  const recurringItems = parseTaskFile(resolvePath(paths.recurring));

  if (scheduleItems.length === 0 && backlogItems.length === 0 && recurringItems.length === 0) {
    return buildTodayFromSnapshot(snapshot);
  }

  const todayItems = scheduleItems
    .filter((item) => (item.section || '').includes('오늘') || (item.section || '').toLowerCase().includes('today'))
    .filter((item) => item.status !== 'cancelled')
    .map((item) => makeTodayItem(item, 'today'));

  const deadlineItems = [...scheduleItems, ...backlogItems]
    .filter((item) => (item.section || '').includes('마감') || (item.section || '').toLowerCase().includes('deadline'))
    .filter((item) => item.status !== 'cancelled')
    .map((item) => makeTodayItem(item, 'deadline', { label: formatDeadlineLabel(item.text) }));

  const recurring = pickRecurringItems(recurringItems);
  const backlog = backlogItems
    .filter((item) => item.status !== 'cancelled')
    .map((item) => makeTodayItem(item, 'backlog'));

  return {
    source: 'files',
    today: todayItems,
    deadlines: deadlineItems,
    recurring: recurring.length > 0
      ? recurring.map((text) => {
          const sourceItem = recurringItems.find((item) => item.text === text);
          return sourceItem ? makeTodayItem(sourceItem, 'recurring') : normalizeTodayItems([text], 'recurring')[0];
        })
      : [],
    backlog,
    archived: loadArchivedItemsFromPaths({
      scheduleArchive: getTodayArchiveFile({ paths }, 'today'),
      recurringArchive: getTodayArchiveFile({ paths }, 'recurring'),
      backlogArchive: getTodayArchiveFile({ paths }, 'backlog')
    }),
    statusSummary: `${todayItems.length} today · ${deadlineItems.length} deadline · ${recurring.length} recurring`
  };
}

function resolveLivePaths() {
  return {
    schedule: getLocalScheduleFile('today'),
    backlog: getLocalScheduleFile('backlog'),
    recurring: getLocalScheduleFile('recurring'),
    scheduleArchive: getLocalArchiveFileByKey('today'),
    recurringArchive: getLocalArchiveFileByKey('recurring'),
    backlogArchive: getLocalArchiveFileByKey('backlog')
  };
}

function buildTodayState(todayConfig) {
  const live = resolveLivePaths();
  const today = buildTodayFromFiles(live, todayConfig.snapshot);
  const archiveItems = loadArchivedItemsFromPaths({
    scheduleArchive: live.scheduleArchive,
    recurringArchive: live.recurringArchive,
    backlogArchive: live.backlogArchive
  });
  if (today.source === 'snapshot' && lastWidgetState?.today && lastWidgetState.today.source !== 'snapshot') {
    return lastWidgetState.today;
  }
  return { ...today, archived: archiveItems.length > 0 ? archiveItems : today.archived || [] };
}

async function buildTodayStateForConfig(todayConfig) {
  if (isCloudScheduleEnabled(todayConfig?.cloud)) {
    const cloud = await resolveDesktopCloudConfig(todayConfig.cloud);
    return loadCloudScheduleState(cloud);
  }
  return buildTodayState(todayConfig);
}

async function resolveDesktopCloudConfig(cloudConfig = {}) {
  const next = { ...cloudConfig };
  const session = await refreshDesktopCloudSession(next, getCloudAuthStoragePath()).catch((error) => {
    if (next.accessToken) return null;
    throw error;
  });
  if (session?.access_token) {
    next.accessToken = session.access_token;
    persistCloudSession(session);
  }
  return next;
}

function persistCloudSession(session) {
  if (!session?.access_token) return;
  const raw = ensureJsonFile(getDashboardConfigPath(), DEFAULT_DASHBOARD_CONFIG);
  raw.today = raw.today || {};
  raw.today.cloud = raw.today.cloud || {};
  raw.today.cloud.enabled = true;
  raw.today.cloud.supabaseUrl = raw.today.cloud.supabaseUrl || process.env.SUPABASE_URL || '';
  raw.today.cloud.anonKey = raw.today.cloud.anonKey || process.env.SUPABASE_ANON_KEY || '';
  raw.today.cloud.accessToken = session.access_token;
  raw.today.cloud.userEmail = session.user?.email || raw.today.cloud.userEmail || '';
  raw.today.cloud.expiresAt = session.expires_at || null;
  saveDashboardConfig(raw);
}

function clearCloudSessionConfig() {
  const raw = ensureJsonFile(getDashboardConfigPath(), DEFAULT_DASHBOARD_CONFIG);
  raw.today = raw.today || {};
  raw.today.cloud = raw.today.cloud || {};
  raw.today.cloud.accessToken = '';
  raw.today.cloud.userEmail = '';
  raw.today.cloud.expiresAt = null;
  saveDashboardConfig(raw);
}

function getCloudStatus() {
  const config = loadDashboardConfig();
  const cloud = config.today?.cloud || {};
  return {
    enabled: Boolean(cloud.enabled),
    configured: Boolean(cloud.supabaseUrl && cloud.anonKey),
    signedIn: Boolean(cloud.accessToken),
    userEmail: cloud.userEmail || '',
    expiresAt: cloud.expiresAt || null
  };
}

function getTodaySourceFile(_todayConfig, sourceKey) {
  return getLocalScheduleFile(canonicalSourceKey(sourceKey));
}

function getTodayArchiveFile(_todayConfig, sourceKey) {
  return getLocalArchiveFileByKey(canonicalSourceKey(sourceKey));
}

function collectTodayWatchTargets() {
  const dirPath = getLocalScheduleDir();
  const fileNames = new Set();
  ['today', 'recurring', 'backlog'].forEach((sourceKey) => {
    const source = getLocalScheduleFile(sourceKey);
    const archive = getLocalArchiveFileByKey(sourceKey);
    if (source) fileNames.add(path.basename(source));
    if (archive) fileNames.add(path.basename(archive));
  });
  return [{ dirPath, fileNames: [...fileNames].sort() }];
}

function clearTodayWatchers() {
  todayWatchers.forEach((watcher) => {
    try {
      watcher.close();
    } catch {
      // ignore watcher close failures during teardown
    }
  });
  todayWatchers = [];
  todayWatcherSignature = '';
}

function scheduleTodayWatchedRefresh() {
  if (todayRefreshDebounceTimer) {
    clearTimeout(todayRefreshDebounceTimer);
  }
  todayRefreshDebounceTimer = setTimeout(() => {
    todayRefreshDebounceTimer = null;
    // Skip watcher-triggered refresh if a mutation already refreshed recently
    if (Date.now() - lastMutationRefreshAt < 5000) return;
    refreshTodayOnlyState().catch(() => {});
  }, 3000);
}

function ensureTodayWatchers(_todayConfig) {
  if (isCloudScheduleEnabled(_todayConfig?.cloud)) {
    clearTodayWatchers();
    return;
  }

  const targets = collectTodayWatchTargets();
  const signature = JSON.stringify(targets);
  if (signature === todayWatcherSignature) {
    return;
  }

  clearTodayWatchers();
  todayWatcherSignature = signature;

  targets.forEach(({ dirPath, fileNames }) => {
    const watchedNames = new Set(fileNames.map((name) => name.toLowerCase()));
    try {
      const watcher = fs.watch(dirPath, (_eventType, filename) => {
        if (!filename) {
          scheduleTodayWatchedRefresh();
          return;
        }
        const changedName = String(filename).trim().toLowerCase();
        if (!changedName || watchedNames.has(changedName)) {
          scheduleTodayWatchedRefresh();
        }
      });
      todayWatchers.push(watcher);
    } catch {
      // Keep the dashboard functional even if a watch target cannot be attached.
    }
  });
}

async function openGithubTarget(target) {
  const localPath = target?.local?.exists ? target.local.path : '';
  if (localPath && fs.existsSync(localPath)) {
    await shell.openPath(localPath);
    return;
  }

  if (target?.url) {
    await shell.openExternal(target.url);
  }
}

function reorderTaskInFile(filePath, fromLineIndex, insertBeforeLineIndex, fromRawText) {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(`Source file not found: ${filePath}`);
  }
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  const from = resolveTaskLineIndexByText(lines, fromLineIndex, fromRawText);
  if (from === -1) return;
  let insertBefore = Number(insertBeforeLineIndex);
  if (from === insertBefore) return;
  const [removed] = lines.splice(from, 1);
  if (insertBefore > from) insertBefore -= 1;
  if (insertBefore < 0) insertBefore = 0;
  if (insertBefore > lines.length) insertBefore = lines.length;
  lines.splice(insertBefore, 0, removed);
  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
}

function resolveTaskLineIndexByText(lines, lineIndex, rawText) {
  const target = String(rawText || '').trim();
  const index = Number(lineIndex);
  if (target && index >= 0 && index < lines.length) {
    const parsed = parseTaskLine(lines[index]);
    if (parsed && parsed.text.trim() === target) return index;
  }
  if (target) {
    for (let offset = 1; offset <= 10; offset++) {
      for (const candidate of [index - offset, index + offset]) {
        if (candidate < 0 || candidate >= lines.length) continue;
        const parsed = parseTaskLine(lines[candidate]);
        if (parsed && parsed.text.trim() === target) return candidate;
      }
    }
  }
  return resolveTaskLineIndex(lines, lineIndex);
}

function updateTaskTextInFile(filePath, lineIndex, newText) {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(`Source file not found: ${filePath}`);
  }
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  const index = resolveTaskLineIndex(lines, lineIndex);
  if (index === -1) {
    throw new Error('Target task line not found');
  }
  const currentLine = lines[index];
  const text = String(newText || '').trim();
  if (!text) throw new Error('New text cannot be empty');
  const nextLine = currentLine.replace(
    /^(\s*-\s*\[[ x/~]\](?:\s*\[[^\]]*\])?\s*)(.+?)(\s+#[^\s#`]+)?\s*$/,
    (_m, prefix, _old, category) => `${prefix}${text}${category || ''}`
  );
  lines[index] = nextLine !== currentLine ? nextLine : currentLine;
  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
}

function statusToken(status) {
  if (status === 'in_progress') return '/';
  if (status === 'completed') return 'x';
  if (status === 'cancelled') return '~';
  return ' ';
}

function canonicalSourceKey(sourceKey) {
  return sourceKey === 'deadlines' ? 'deadline' : sourceKey;
}

function getSectionMatchersForTarget(targetKey) {
  if (targetKey === 'today') return ['오늘', 'Today'];
  if (targetKey === 'deadline') return ['마감', 'Deadline'];
  if (targetKey === 'recurring') return ['매주', 'Recurring'];
  if (targetKey === 'backlog') return ['백로그', 'Backlog'];
  return [];
}

function getInsertSectionMatchers(targetKey, requestedSection) {
  const section = String(requestedSection || '').trim();
  if (section) return [section];
  return getSectionMatchersForTarget(targetKey);
}

function getArchiveSectionMatchers(sourceKey) {
  if (sourceKey === 'today') return ['오늘', 'Today'];
  if (sourceKey === 'deadline') return ['마감', 'Deadline'];
  if (sourceKey === 'recurring') return ['반복', 'Recurring'];
  if (sourceKey === 'backlog') return ['백로그', 'Backlog'];
  return [];
}

function inferSourceFromScheduleSection(section) {
  const value = String(section || '').toLowerCase();
  return value.includes('deadline') || String(section || '').includes('마감') ? 'deadline' : 'today';
}

function formatTaskLine(task, targetKey, options = {}) {
  const status = options.status || task.status || 'pending';
  const token = statusToken(status);
  let priority = task.priority || '-';
  if (targetKey === 'backlog' && priority === '-') {
    priority = '중';
  }
  if (targetKey === 'deadline' && !priority) {
    priority = '-';
  }

  const includePriority = targetKey === 'backlog' || targetKey === 'deadline' || (priority && priority !== '-');
  const priorityChunk = includePriority ? ` [${priority || '-'}]` : '';
  const text = String(task.text || '').trim();
  const category = String(task.category || '').trim();
  return `- [${token}]${priorityChunk} ${text}${category ? ` ${category}` : ''}`.trim();
}

function resolveTaskLineIndex(lines, lineIndex) {
  const index = Number(lineIndex);
  if (index >= 0 && index < lines.length && parseTaskLine(lines[index])) {
    return index;
  }
  // lineIndex is stale — search nearby (±5 lines) for the nearest task line
  for (let offset = 1; offset <= 5; offset++) {
    for (const candidate of [index - offset, index + offset]) {
      if (candidate >= 0 && candidate < lines.length && parseTaskLine(lines[candidate])) {
        return candidate;
      }
    }
  }
  return -1;
}

function removeTaskLineFromFile(filePath, lineIndex) {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(`Source file not found: ${filePath}`);
  }
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  const index = resolveTaskLineIndex(lines, lineIndex);
  if (index === -1) {
    throw new Error('Target task line not found');
  }
  const parsed = parseTaskLine(lines[index]);
  lines.splice(index, 1);
  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
  return parsed;
}

function deleteTaskLineFromFile(filePath, lineIndex) {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(`Source file not found: ${filePath}`);
  }
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  const index = resolveTaskLineIndex(lines, lineIndex);
  if (index === -1) {
    throw new Error('Target task line not found');
  }
  lines.splice(index, 1);
  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
}

function updateTaskStatusInFile(filePath, lineIndex, nextStatus) {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(`Source file not found: ${filePath}`);
  }

  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  const index = resolveTaskLineIndex(lines, lineIndex);
  if (index === -1) {
    throw new Error('Target task line not found');
  }
  const currentLine = lines[index];

  let nextLine = currentLine.replace(/^(\s*-\s*\[)[ x/~](\])/, `$1${statusToken(nextStatus)}$2`);
  if (nextLine === currentLine) {
    // Recurring format has no checkbox (e.g. "- 목요일 | 글쓰기") — prepend one
    nextLine = currentLine.replace(/^(\s*-\s*)(?!\[)/, `$1[${statusToken(nextStatus)}] `);
  }
  if (nextLine === currentLine) {
    throw new Error('Unable to update task status');
  }

  lines[index] = nextLine;
  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
}

function insertTaskIntoSection(filePath, sectionMatchers, line, options = {}) {
  if (!filePath) {
    throw new Error('Source file path is required');
  }
  const prepend = options.prepend === true;
  const createAtTop = options.createAtTop === true;
  if (!fs.existsSync(filePath)) {
    const heading = sectionMatchers[0] || 'Tasks';
    fs.writeFileSync(filePath, `## ${heading}\n\n${line}\n`, 'utf8');
    return;
  }

  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  let headingIndex = -1;

  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (!trimmed.startsWith('## ')) continue;
    const heading = trimmed.slice(3).trim();
    if (sectionMatchers.some((matcher) => heading.includes(matcher))) {
      headingIndex = index;
      break;
    }
  }

  if (headingIndex === -1) {
    if (createAtTop) {
      const firstHeadingIndex = lines.findIndex((raw) => raw.trim().startsWith('## '));
      const insertAt = firstHeadingIndex >= 0 ? firstHeadingIndex : lines.length;
      lines.splice(insertAt, 0, '', `## ${sectionMatchers[0]}`, '', line);
      fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
      return;
    }
    lines.push('', `## ${sectionMatchers[0]}`, line);
    fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
    return;
  }

  let insertAt = headingIndex + 1;
  while (insertAt < lines.length && lines[insertAt].trim() === '') {
    insertAt += 1;
  }

  if (prepend) {
    lines.splice(insertAt, 0, line);
    fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
    return;
  }

  while (insertAt < lines.length && !lines[insertAt].trim().startsWith('## ')) {
    insertAt += 1;
  }

  lines.splice(insertAt, 0, line);
  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
}

function insertTaskNearLine(filePath, lineIndex, line, position, sectionMatchers) {
  if (!filePath || !fs.existsSync(filePath) || !Number.isFinite(Number(lineIndex))) {
    insertTaskIntoSection(filePath, sectionMatchers, line, { prepend: true, createAtTop: true });
    return;
  }

  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  const targetIndex = resolveTaskLineIndex(lines, Number(lineIndex));
  if (targetIndex === -1) {
    insertTaskIntoSection(filePath, sectionMatchers, line, { prepend: true, createAtTop: true });
    return;
  }

  lines.splice(position === 'below' ? targetIndex + 1 : targetIndex, 0, line);
  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
}

function archiveTaskInFiles(sourceFilePath, archiveFilePath, sourceKey, lineIndex) {
  const source = canonicalSourceKey(sourceKey);
  const task = removeTaskLineFromFile(sourceFilePath, Number(lineIndex));
  const archivedLine = formatTaskLine(task, source, { status: 'completed' });
  const sectionMatchers = getArchiveSectionMatchers(source);
  if (sectionMatchers.length === 0) {
    throw new Error('Unknown schedule source');
  }
  insertTaskIntoSection(archiveFilePath, sectionMatchers, archivedLine);
}

function restoreTaskFromArchiveFiles(archiveFilePath, targetFilePath, sourceKey, lineIndex) {
  const source = canonicalSourceKey(sourceKey);
  const task = removeTaskLineFromFile(archiveFilePath, Number(lineIndex));
  const restoredLine = formatTaskLine(task, source, { status: 'pending' });
  const sectionMatchers = getSectionMatchersForTarget(source);
  if (sectionMatchers.length === 0) {
    throw new Error('Unknown schedule source');
  }
  insertTaskIntoSection(targetFilePath, sectionMatchers, restoredLine);
}

function moveTaskInFiles(sourceFilePath, lineIndex, targetFilePath, sourceKey, targetKey, options = {}) {
  const source = canonicalSourceKey(sourceKey);
  const target = canonicalSourceKey(targetKey);
  if (source === target) {
    return;
  }
  const task = removeTaskLineFromFile(sourceFilePath, Number(lineIndex));
  const movedLine = formatTaskLine(task, target, { status: task.status === 'completed' ? 'pending' : task.status });
  const sectionMatchers = getSectionMatchersForTarget(target);
  if (sectionMatchers.length === 0) {
    throw new Error('Unknown schedule target');
  }
  const targetLineIndex = Number(options.targetLineIndex);
  if (Number.isFinite(targetLineIndex)) {
    const adjustedTargetLineIndex = sourceFilePath === targetFilePath && targetLineIndex > Number(lineIndex)
      ? targetLineIndex - 1
      : targetLineIndex;
    insertTaskNearLine(targetFilePath, adjustedTargetLineIndex, movedLine, options.position, sectionMatchers);
    return;
  }
  insertTaskIntoSection(targetFilePath, sectionMatchers, movedLine, { prepend: true, createAtTop: true });
}

async function buildWidgetState() {
  const config = loadDashboardConfig();

  const usage = getUsageSnapshot();
  const github = getGithubSnapshot(config.github);
  const today = await buildTodayStateForConfig(config.today);
  return { ...usage, generatedAt: new Date().toISOString(), sessionLabel: getSessionLabel(), github, today };
}

async function buildWidgetStateSafe() {
  try {
    return await buildWidgetState();
  } catch (error) {
    return buildOfflineState(error instanceof Error ? error.message : String(error));
  }
}

function buildOfflineState(message) {
  return {
    planType: 'CODEX',
    primary: { usedPercent: 0, resetAfterSeconds: null },
    secondary: { usedPercent: 0, resetAfterSeconds: null },
    generatedAt: new Date().toISOString(),
    sessionLabel: 'Offline',
    github: {
      owner: DEFAULT_DASHBOARD_CONFIG.github.owner,
      status: 'offline',
      columns: { now: [], next: [], blocked: [] }
    },
    today: buildTodayFromSnapshot(DEFAULT_DASHBOARD_CONFIG.today.snapshot),
    error: message
  };
}

function sendSyncStatus(status) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('widget-sync-status', { status });
  }
}

// One-line append log for sync activity. Helps diagnose silent push/pull
// stalls (the 2026-05-13 incident: pushQueue stuck → autoSync skipped pulls
// for 1.5 days with no on-disk trace).
function logSync(level, msg) {
  try {
    const line = `${new Date().toISOString()} [${level}] ${msg}\n`;
    fs.appendFileSync(path.join(getAppDataDir(), 'sync.log'), line, 'utf8');
  } catch {
    // best-effort
  }
}

// 외부 watchdog 이 읽는 생존 신호. 이벤트 루프가 살아있어야만 30s 간격 콜백이
// 돌아 이 파일이 갱신된다. 루프가 멈추면(OS suspend·동기 블록) 파일이 정지하고
// watchdog 이 그걸 보고 재기동한다. in-process 복구가 못 잡는 freeze 의 안전망.
function writeHeartbeat() {
  try {
    fs.writeFileSync(path.join(getAppDataDir(), 'heartbeat'), new Date().toISOString(), 'utf8');
  } catch {
    // best-effort
  }
}

function sendState(state) {
  // Never let a snapshot fallback overwrite a previously known real state.
  // buildOfflineState / file-read errors can produce source:'snapshot' and if that
  // lands in lastWidgetState it permanently disables all subsequent guards.
  if (state.today?.source === 'snapshot'
      && lastWidgetState?.today
      && lastWidgetState.today.source !== 'snapshot') {
    state = { ...state, today: lastWidgetState.today };
  }
  lastWidgetState = state;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('widget-state', state);
  }
  if (tray) {
    if (state.error) {
      tray.setToolTip(`${APP_NAME}\n${state.error}`);
    } else {
      tray.setToolTip(`${APP_NAME}\n5H ${Math.round(state.primary.usedPercent)}% | WEEK ${Math.round(state.secondary.usedPercent)}%`);
    }
  }
}

let refreshStateInFlight = false;
async function refreshState() {
  // 이전 refreshState 가 아직 안 끝났는데 setInterval(60s) 이 또 부르면
  // hung 한 fetch/IO 가 중첩 누적된다. 한 번에 하나만 돌게 가드.
  if (refreshStateInFlight) return;
  refreshStateInFlight = true;
  try {
    ensureTodayWatchers(loadDashboardConfig().today);
    sendState(await buildWidgetStateSafe());
  } finally {
    refreshStateInFlight = false;
  }
}

function getRefreshIntervalMs() {
  const config = loadDashboardConfig();
  if (isCloudScheduleEnabled(config.today?.cloud)) {
    return CLOUD_REFRESH_INTERVAL_MS;
  }
  return loadSettings().refreshIntervalMs;
}

async function forceRefresh() {
  sendSyncStatus('syncing');
  try {
    const state = await buildWidgetStateSafe();
    sendState(state);
    sendSyncStatus('ok');
  } catch {
    sendSyncStatus('error');
  }
}

function refreshTodayAfterMutation() {
  lastMutationRefreshAt = Date.now();
  try {
    const config = loadDashboardConfig();
    const today = buildTodayState(config.today);
    const base = lastWidgetState || buildOfflineState('partial state');
    const nextState = { ...base, today, generatedAt: new Date().toISOString() };
    lastWidgetState = nextState;
    return nextState;
  } catch {
    return null;
  }
}

async function refreshTodayAfterMutationAsync() {
  lastMutationRefreshAt = Date.now();
  const config = loadDashboardConfig();
  const today = await buildTodayStateForConfig(config.today);
  const base = lastWidgetState || buildOfflineState('partial state');
  const nextState = { ...base, today, generatedAt: new Date().toISOString() };
  lastWidgetState = nextState;
  return nextState;
}

async function refreshTodayOnlyState() {
  if (todayRefreshInFlight) {
    return todayRefreshInFlight;
  }
  const run = (async () => {
    sendSyncStatus('syncing');
    try {
      const config = loadDashboardConfig();
      ensureTodayWatchers(config.today);
      const today = await buildTodayStateForConfig(config.today);
      const base = lastWidgetState || buildOfflineState('partial state');
      const nextState = {
        ...base,
        today,
        generatedAt: new Date().toISOString()
      };
      sendState(nextState);
      sendSyncStatus('ok');
      return nextState;
    } catch (error) {
      sendSyncStatus('error');
      throw error;
    }
  })();
  todayRefreshInFlight = run.finally(() => {
    todayRefreshInFlight = null;
  });
  return run;
}

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'icon.ico');
  const icon = fs.existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath)
    : nativeImage.createFromDataURL(`data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==`);
  tray = new Tray(icon);
  const menu = Menu.buildFromTemplate([
    { label: 'Show Dashboard', click: () => mainWindow && mainWindow.show() },
    { label: 'Show On Primary Monitor', click: () => centerWindowOnDisplay(getPrimaryDisplay()) },
    { label: 'Move To Right Monitor', click: () => moveWindowToDisplay(getRightmostDisplay()) },
    { label: 'Move To Left Monitor', click: () => moveWindowToDisplay(getLeftmostDisplay()) },
    { label: 'Reset Position', click: () => resetWindowToPrimary() },
    { label: 'Hide Dashboard', click: () => mainWindow && mainWindow.hide() },
    { type: 'separator' },
    { label: 'Open Settings Folder', click: () => shell.openPath(getAppDataDir()) },
    { label: 'Restart', click: () => { app.relaunch(); app.quit(); } },
    { label: 'Quit', click: () => app.quit() }
  ]);
  tray.setContextMenu(menu);
  tray.setToolTip(APP_NAME);
  tray.on('double-click', () => mainWindow && mainWindow.show());
}

function createWindow() {
  const settings = loadSettings();
  const bounds = clampBounds({ x: settings.x, y: settings.y }, settings);

  mainWindow = new BrowserWindow({
    width: settings.width,
    height: settings.height,
    x: bounds.x,
    y: bounds.y,
    frame: false,
    transparent: true,
    resizable: true,
    hasShadow: true,
    skipTaskbar: true,
    alwaysOnTop: settings.alwaysOnTop,
    backgroundColor: '#00000000',
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    webPreferences: { preload: path.join(__dirname, 'preload.js') }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // ── Crash/hang recovery ───────────────────────────────────────────────
  // transparent + GPU 합성 창은 Windows 에서 GPU/렌더러 프로세스가 죽으면
  // 마지막 프레임을 박제한 채 휠·클릭·갱신을 전부 흘린다("멈춘 화면").
  // 죽으면 다시 로드해서 살린다. reload 폭주는 30s 윈도 내 카운터로 차단.
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    logSync('error', `render-process-gone: ${details?.reason || 'unknown'}`);
    recoverWindow('render-process-gone');
  });
  mainWindow.webContents.on('unresponsive', () => {
    logSync('error', 'renderer unresponsive');
    recoverWindow('unresponsive');
  });
  mainWindow.webContents.on('did-finish-load', () => {
    // reload 후 마지막으로 알던 상태를 즉시 다시 그려 빈 화면을 막는다.
    if (lastWidgetState && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('widget-state', lastWidgetState);
    }
    refreshState();
  });

  mainWindow.on('close', (event) => {
    if (!app.isQuiting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('move', () => {
    persistWindowBounds();
  });
  mainWindow.on('resize', () => {
    persistWindowBounds();
  });
  mainWindow.on('show', () => refreshState());
}

let recoverCount = 0;
let recoverWindowStart = 0;
function recoverWindow(reason) {
  if (!mainWindow || mainWindow.isDestroyed() || app.isQuiting) return;
  const now = Date.now();
  if (now - recoverWindowStart > 30000) {
    recoverWindowStart = now;
    recoverCount = 0;
  }
  recoverCount += 1;
  // 30초 안에 3회 넘게 죽으면 reload 폭주 — 더는 시도하지 않고 로그만 남긴다.
  if (recoverCount > 3) {
    logSync('error', `recoverWindow giving up after ${recoverCount} attempts (${reason})`);
    return;
  }
  try {
    mainWindow.webContents.reload();
  } catch (error) {
    logSync('error', `recoverWindow reload failed: ${error?.message || error}`);
  }
}

// 모니터 sleep/wake·해상도 변경·시스템 resume 후, transparent+alwaysOnTop+frameless
// 창은 렌더러가 살아있어도 합성 surface 가 stale 로 떨어져 휠·클릭·repaint 가 전부
// 죽는다(crash 아님 → recoverWindow 핸들러가 못 잡음). hide→show 로 창을 OS 합성기·
// 입력 큐에 재부착하면 surface 가 되살아난다. 디스플레이 이벤트는 연달아 여러 번
// 발생하므로 디바운스로 한 번만 처리.
let windowNudgeTimer = null;
function scheduleWindowNudge(reason) {
  if (windowNudgeTimer) clearTimeout(windowNudgeTimer);
  windowNudgeTimer = setTimeout(() => {
    windowNudgeTimer = null;
    nudgeWindowRepaint(reason);
  }, 800);
}

function nudgeWindowRepaint(reason) {
  if (!mainWindow || mainWindow.isDestroyed() || app.isQuiting) return;
  if (!mainWindow.isVisible()) return; // 숨겨진(트레이) 상태면 다음 show 때 자연 복구
  logSync('info', `window nudge: ${reason}`);
  try {
    mainWindow.hide();
    mainWindow.show();
    if (loadSettings().alwaysOnTop) mainWindow.setAlwaysOnTop(true);
    mainWindow.webContents.invalidate();
  } catch (error) {
    logSync('error', `window nudge failed: ${error?.message || error}`);
  }
}

ipcMain.handle('widget:get-initial-state', async () => {
  return buildWidgetStateSafe();
});

ipcMain.handle('widget:refresh', async () => {
  await forceRefresh();
});

ipcMain.handle('widget:get-window-bounds', () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return null;
  }
  return mainWindow.getBounds();
});

ipcMain.handle('widget:get-settings', () => {
  return getSettingsPayload();
});

ipcMain.handle('widget:update-settings', (_event, payload) => {
  const current = loadSettings();
  const next = {
    ...current,
    appearance: {
      ...current.appearance,
      ...(payload?.appearance || {})
    }
  };
  saveSettings(next);
  return getSettingsPayload();
});

ipcMain.handle('widget:get-cloud-auth-status', () => {
  return getCloudStatus();
});

ipcMain.handle('widget:sign-in-cloud', async (_event, payload) => {
  const provider = payload?.provider === 'kakao' ? 'kakao' : 'google';
  const raw = ensureJsonFile(getDashboardConfigPath(), DEFAULT_DASHBOARD_CONFIG);
  raw.today = raw.today || {};
  raw.today.cloud = raw.today.cloud || {};
  raw.today.cloud.supabaseUrl = raw.today.cloud.supabaseUrl || process.env.SUPABASE_URL || '';
  raw.today.cloud.anonKey = raw.today.cloud.anonKey || process.env.SUPABASE_ANON_KEY || '';
  raw.today.cloud.enabled = true;
  saveDashboardConfig(raw);

  const config = loadDashboardConfig();
  const session = await startDesktopOAuth(config.today.cloud, {
    provider,
    storagePath: getCloudAuthStoragePath(),
    openExternal: (url) => shell.openExternal(url)
  });
  persistCloudSession(session);
  await forceRefresh();
  return getCloudStatus();
});

ipcMain.handle('widget:sign-out-cloud', async () => {
  const config = loadDashboardConfig();
  await signOutDesktopCloud(config.today?.cloud || {}, getCloudAuthStoragePath()).catch(() => {});
  clearCloudSessionConfig();
  await forceRefresh();
  return getCloudStatus();
});

ipcMain.on('widget:hide', () => {
  if (mainWindow) {
    mainWindow.hide();
  }
});

ipcMain.on('widget:resize-window', (_event, bounds) => {
  if (!mainWindow || mainWindow.isDestroyed() || !bounds) {
    return;
  }

  const nextBounds = {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.max(MIN_WIDTH, Math.round(bounds.width)),
    height: Math.max(MIN_HEIGHT, Math.round(bounds.height))
  };

  mainWindow.setBounds(nextBounds);
  persistWindowBounds();
});

ipcMain.handle('widget:update-schedule-item', async (_event, payload) => {
  const config = loadDashboardConfig();
  if (isCloudScheduleEnabled(config.today?.cloud)) {
    return updateCloudScheduleItem(await resolveDesktopCloudConfig(config.today.cloud), payload);
  }

  const sourceKey = canonicalSourceKey(payload?.sourceKey);
  const nextStatus = payload?.nextStatus || 'pending';
  const filePath = getLocalScheduleFile(sourceKey);
  if (!filePath) throw new Error('Unknown schedule source');

  updateTaskStatusInFile(filePath, Number(payload?.lineIndex), nextStatus);
  enqueueSchedulePush(filePath);

  return refreshTodayAfterMutation();
});

ipcMain.handle('widget:restore-archived-item', async (_event, payload) => {
  const config = loadDashboardConfig();
  if (isCloudScheduleEnabled(config.today?.cloud)) {
    return restoreCloudArchivedItem(await resolveDesktopCloudConfig(config.today.cloud), payload);
  }

  const sourceKey = canonicalSourceKey(payload?.sourceKey);
  const targetPath = getLocalScheduleFile(sourceKey);
  const archivePath = getLocalArchiveFileByKey(sourceKey);
  if (!targetPath || !archivePath) throw new Error('Unknown schedule source');
  restoreTaskFromArchiveFiles(archivePath, targetPath, sourceKey, Number(payload?.lineIndex));
  enqueueSchedulePush(targetPath);
  enqueueSchedulePush(archivePath);
  return refreshTodayAfterMutation();
});

ipcMain.handle('widget:delete-schedule-item', async (_event, payload) => {
  const config = loadDashboardConfig();
  if (isCloudScheduleEnabled(config.today?.cloud)) {
    return deleteCloudScheduleItem(await resolveDesktopCloudConfig(config.today.cloud), payload);
  }

  const sourceKey = canonicalSourceKey(payload?.sourceKey);
  const archived = Boolean(payload?.archived);
  const filePath = archived ? getLocalArchiveFileByKey(sourceKey) : getLocalScheduleFile(sourceKey);
  if (!filePath) throw new Error('Unknown schedule source');
  deleteTaskLineFromFile(filePath, Number(payload?.lineIndex));
  enqueueSchedulePush(filePath);
  return refreshTodayAfterMutation();
});

ipcMain.handle('widget:move-schedule-item', async (_event, payload) => {
  const config = loadDashboardConfig();
  if (isCloudScheduleEnabled(config.today?.cloud)) {
    return moveCloudScheduleItem(await resolveDesktopCloudConfig(config.today.cloud), payload);
  }

  const sourceKey = canonicalSourceKey(payload?.sourceKey);
  const targetKey = canonicalSourceKey(payload?.targetKey);
  if (!sourceKey || !targetKey || sourceKey === targetKey) {
    return refreshTodayAfterMutation();
  }
  const sourcePath = getLocalScheduleFile(sourceKey);
  const targetPath = getLocalScheduleFile(targetKey);
  if (!sourcePath || !targetPath) throw new Error('Unknown schedule source');
  moveTaskInFiles(sourcePath, Number(payload?.lineIndex), targetPath, sourceKey, targetKey, {
    targetLineIndex: payload?.targetLineIndex,
    position: payload?.position
  });
  enqueueSchedulePush(sourcePath);
  enqueueSchedulePush(targetPath);
  return refreshTodayAfterMutation();
});

ipcMain.handle('widget:reorder-schedule-item', async (_event, payload) => {
  const config = loadDashboardConfig();
  if (isCloudScheduleEnabled(config.today?.cloud)) {
    return reorderCloudScheduleItem(await resolveDesktopCloudConfig(config.today.cloud), payload);
  }

  const sourceKey = canonicalSourceKey(payload?.sourceKey);
  const fromLineIndex = Number(payload?.fromLineIndex);
  const insertBeforeLineIndex = Number(payload?.insertBeforeLineIndex);
  if (Number.isNaN(fromLineIndex) || Number.isNaN(insertBeforeLineIndex) || fromLineIndex === insertBeforeLineIndex) {
    return refreshTodayAfterMutation();
  }
  const filePath = getLocalScheduleFile(sourceKey);
  if (!filePath) throw new Error('Unknown schedule source');
  reorderTaskInFile(filePath, fromLineIndex, insertBeforeLineIndex, payload?.fromRawText);
  enqueueSchedulePush(filePath);
  return refreshTodayAfterMutation();
});

ipcMain.handle('widget:update-schedule-item-text', async (_event, payload) => {
  const config = loadDashboardConfig();
  if (isCloudScheduleEnabled(config.today?.cloud)) {
    return updateCloudScheduleItemText(await resolveDesktopCloudConfig(config.today.cloud), payload);
  }

  const sourceKey = canonicalSourceKey(payload?.sourceKey);
  const lineIndex = Number(payload?.lineIndex);
  const newText = String(payload?.newText || '').trim();
  if (!newText) throw new Error('New text required');
  const filePath = getLocalScheduleFile(sourceKey);
  if (!filePath) throw new Error('Unknown schedule source');
  updateTaskTextInFile(filePath, lineIndex, newText);
  enqueueSchedulePush(filePath);
  return refreshTodayAfterMutation();
});

ipcMain.handle('widget:update-schedule-item-graph', async (_event, payload) => {
  const config = loadDashboardConfig();
  if (isCloudScheduleEnabled(config.today?.cloud)) {
    return updateCloudScheduleItemGraph(await resolveDesktopCloudConfig(config.today.cloud), payload);
  }
  throw new Error('Task graph editing requires Supabase cloud mode');
});

ipcMain.handle('widget:add-schedule-item', async (_event, payload) => {
  const config = loadDashboardConfig();
  if (isCloudScheduleEnabled(config.today?.cloud)) {
    return addCloudScheduleItem(await resolveDesktopCloudConfig(config.today.cloud), payload);
  }

  const target = payload?.target || 'today';
  const text = String(payload?.text || '').trim();
  const sectionMatchers = getInsertSectionMatchers(target, payload?.section);
  const createAtTop = target === 'backlog' && String(sectionMatchers[0] || '').trim() === '백로그';
  if (!text) throw new Error('Task text is required');

  let touchedPath = '';
  if (target === 'today') {
    touchedPath = getLocalScheduleFile('today');
    insertTaskIntoSection(touchedPath, sectionMatchers, `- [ ] ${text}`, { prepend: true });
  } else if (target === 'deadline') {
    touchedPath = getLocalScheduleFile('today');
    insertTaskIntoSection(touchedPath, sectionMatchers, `- [ ] [-] ${text}`, { prepend: true });
  } else if (target === 'recurring') {
    touchedPath = getLocalScheduleFile('recurring');
    insertTaskIntoSection(touchedPath, sectionMatchers, `- 매주 | ${text}`, { prepend: true });
  } else if (target === 'backlog') {
    touchedPath = getLocalScheduleFile('backlog');
    insertTaskIntoSection(touchedPath, sectionMatchers, `- [ ] [중] ${text}`, { prepend: true, createAtTop });
  } else {
    throw new Error('Unknown schedule target');
  }

  enqueueSchedulePush(touchedPath);
  return refreshTodayAfterMutation();
});

ipcMain.handle('widget:open-schedule-source', async (_event, payload) => {
  const config = loadDashboardConfig();
  if (isCloudScheduleEnabled(config.today?.cloud)) {
    return false;
  }

  const filePath = getLocalScheduleFile(canonicalSourceKey(payload?.sourceKey));
  if (!filePath) throw new Error('Unknown schedule source');
  return shell.openPath(filePath);
});

ipcMain.handle('widget:open-github-target', async (_event, payload) => {
  await openGithubTarget(payload || {});
  return true;
});

const EMPTY_TEMPLATES = {
  'SCHEDULE.md': '## 오늘\n\n\n## 마감\n\n',
  'RECURRING.md': '## 반복\n\n',
  'BACKLOG.md': '## 백로그\n\n',
  'SCHEDULE_ARCHIVE.md': '## 오늘\n\n\n## 마감\n\n',
  'RECURRING_ARCHIVE.md': '## 반복\n\n',
  'BACKLOG_ARCHIVE.md': '## 백로그\n\n'
};

const UNSEEDED_MARKER = '.unseeded';

function isScheduleFileUsable(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return false;
  try {
    return fs.statSync(filePath).size > 0;
  } catch {
    return false;
  }
}

function isFileUnseededTemplate(filePath, name) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return content === EMPTY_TEMPLATES[name];
  } catch {
    return false;
  }
}

function configuredSeedPathFor(todayConfig, name) {
  const base = todayConfig?.paths || {};
  if (name === 'SCHEDULE.md') return resolvePath(base.schedule);
  if (name === 'RECURRING.md') return resolvePath(base.recurring);
  if (name === 'BACKLOG.md') return resolvePath(base.backlog);
  if (name === 'SCHEDULE_ARCHIVE.md') {
    const p = resolvePath(base.schedule);
    return p ? path.join(path.dirname(p), 'SCHEDULE_ARCHIVE.md') : '';
  }
  if (name === 'RECURRING_ARCHIVE.md') {
    const p = resolvePath(base.recurring);
    return p ? path.join(path.dirname(p), 'RECURRING_ARCHIVE.md') : '';
  }
  if (name === 'BACKLOG_ARCHIVE.md') {
    const p = resolvePath(base.backlog);
    return p ? path.join(path.dirname(p), 'BACKLOG_ARCHIVE.md') : '';
  }
  return '';
}

async function scpCopy(source, dest) {
  await execFileAsync('scp', ['-q', '-B', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=5', source, dest], {
    windowsHide: true,
    timeout: 30000,
    killSignal: 'SIGKILL',
    maxBuffer: 1024 * 1024 * 4
  });
}

function ensureLocalScheduleSeeded(todayConfig) {
  const localDir = getLocalScheduleDir();
  const mountBase = resolvePath(todayConfig?.mount?.basePath || DEFAULT_DASHBOARD_CONFIG.today.mount.basePath);
  const markerPath = path.join(localDir, UNSEEDED_MARKER);
  const unseededNames = [];

  for (const name of Object.keys(EMPTY_TEMPLATES)) {
    const localPath = path.join(localDir, name);
    if (isScheduleFileUsable(localPath) && !isFileUnseededTemplate(localPath, name)) continue;

    const configuredPath = configuredSeedPathFor(todayConfig, name);
    if (configuredPath && isScheduleFileUsable(configuredPath)) {
      try {
        fs.copyFileSync(configuredPath, localPath);
        continue;
      } catch {
        // fall through
      }
    }

    const mountedPath = mountBase ? path.join(mountBase, name) : '';
    if (mountedPath && isScheduleFileUsable(mountedPath)) {
      try {
        fs.copyFileSync(mountedPath, localPath);
        continue;
      } catch {
        // fall through
      }
    }

    // No real source available — write template but flag as unseeded so Push refuses.
    if (!fs.existsSync(localPath)) {
      fs.writeFileSync(localPath, EMPTY_TEMPLATES[name], 'utf8');
    }
    unseededNames.push(name);
  }

  if (unseededNames.length > 0) {
    fs.writeFileSync(markerPath, unseededNames.join('\n'), 'utf8');
  } else if (fs.existsSync(markerPath)) {
    try { fs.unlinkSync(markerPath); } catch { /* best-effort */ }
  }
}

function isScheduleUnseeded() {
  return fs.existsSync(path.join(getLocalScheduleDir(), UNSEEDED_MARKER));
}

function clearUnseededMarker() {
  const markerPath = path.join(getLocalScheduleDir(), UNSEEDED_MARKER);
  if (fs.existsSync(markerPath)) {
    try { fs.unlinkSync(markerPath); } catch { /* best-effort */ }
  }
}

async function syncScheduleWithVault(todayConfig, direction, options = {}) {
  const sshHost = getSshHost(todayConfig);
  const remoteDir = getRemoteScheduleDir(todayConfig);
  const localDir = getLocalScheduleDir();
  const backupDir = path.join(localDir, `.backup-${Date.now()}`);
  const fileNames = Object.keys(EMPTY_TEMPLATES);
  const failures = [];
  const skipped = [];

  if (direction === 'push' && isScheduleUnseeded() && !options.force) {
    throw new Error('로컬이 아직 vault에서 시딩되지 않았습니다. 먼저 Pull로 가져온 뒤 Push 하세요. (강제 Push는 force 옵션 필요)');
  }

  if (direction === 'pull') {
    fs.mkdirSync(backupDir, { recursive: true });
    for (const name of fileNames) {
      const localPath = path.join(localDir, name);
      if (fs.existsSync(localPath)) {
        try {
          fs.copyFileSync(localPath, path.join(backupDir, name));
        } catch {
          // best-effort backup
        }
      }
    }
  }

  for (const name of fileNames) {
    const localPath = path.join(localDir, name);
    const remotePath = `${sshHost}:${remoteDir}/${name}`;
    try {
      if (direction === 'push') {
        if (!isScheduleFileUsable(localPath)) { skipped.push({ name, reason: 'empty' }); continue; }
        if (!options.force && isFileUnseededTemplate(localPath, name)) {
          skipped.push({ name, reason: 'unseeded template' });
          continue;
        }
        await scpCopy(localPath, remotePath);
      } else {
        await scpCopy(remotePath, localPath);
      }
    } catch (error) {
      failures.push({ name, error: String(error?.message || error) });
    }
  }

  if (direction === 'pull') clearUnseededMarker();
  return { direction, backupDir: direction === 'pull' ? backupDir : null, failures, skipped };
}

ipcMain.handle('widget:sync-push-vault', async (_event, payload) => {
  sendSyncStatus('syncing');
  try {
    const config = loadDashboardConfig();
    if (isCloudScheduleEnabled(config.today?.cloud)) {
      throw new Error('Cloud schedule mode uses Supabase as the source of truth. Legacy vault push is disabled.');
    }
    const result = await syncScheduleWithVault(config.today, 'push', { force: Boolean(payload?.force) });
    sendSyncStatus(result.failures.length === 0 ? 'ok' : 'error');
    return result;
  } catch (error) {
    sendSyncStatus('error');
    throw error;
  }
});

ipcMain.handle('widget:get-sync-status', () => {
  const config = loadDashboardConfig();
  const cloudMode = isCloudScheduleEnabled(config.today?.cloud);
  return {
    cloudMode,
    legacyVaultEnabled: !cloudMode && Boolean(config.today?.remote?.enabled),
    unseeded: !cloudMode && isScheduleUnseeded()
  };
});

ipcMain.handle('widget:sync-pull-vault', async () => {
  sendSyncStatus('syncing');
  try {
    const config = loadDashboardConfig();
    if (isCloudScheduleEnabled(config.today?.cloud)) {
      throw new Error('Cloud schedule mode uses Supabase as the source of truth. Legacy vault pull is disabled.');
    }
    const result = await syncScheduleWithVault(config.today, 'pull');
    await forceRefresh();
    return result;
  } catch (error) {
    sendSyncStatus('error');
    throw error;
  }
});

const { getProjectsState, updateProjectMeta } = require('./main/sources/projects-source');
const { getContentState, runCronJob } = require('./main/sources/content-source');
const { getVaultState, openVaultNote, readVaultNote } = require('./main/sources/vault-source');
const { searchNotion, getNotionChildren } = require('./main/sources/notion-source');
const { getCalendarState, insertEvent, updateEvent, deleteEvent } = require('./main/sources/calendar-source');

ipcMain.handle('widget:get-projects-state', async () => {
  try {
    return await getProjectsState();
  } catch (error) {
    return { items: [], error: String(error.message || error) };
  }
});

// Per-edit debounced push: widget mutation enqueues touched files, a 1s debounce
// fires fire-and-forget scp so UI stays instant. autoSyncWithVault becomes
// pull-only (mobile edits flow down) and skips while local pushes are pending.
function enqueueSchedulePush(filePath) {
  if (!filePath) return;
  pushQueue.add(filePath);
  if (pushDebounceTimer) clearTimeout(pushDebounceTimer);
  pushDebounceTimer = setTimeout(() => { flushSchedulePushQueue().catch(() => {}); }, 1000);
}

async function flushSchedulePushQueue() {
  pushDebounceTimer = null;
  if (pushInFlight) return;
  if (pushQueue.size === 0) return;
  pushInFlight = true;
  try {
    const config = loadDashboardConfig();
    if (!config.today?.remote?.enabled || isScheduleUnseeded()) {
      pushQueue.clear();
      return;
    }
    const sshHost = getSshHost(config.today);
    const remoteDir = getRemoteScheduleDir(config.today);
    const files = Array.from(pushQueue);
    pushQueue.clear();
    sendSyncStatus('syncing');
    logSync('info', `push start: ${files.map(f => path.basename(f)).join(',')}`);
    let failed = false;
    const failedNames = [];
    let lastError = '';
    for (const filePath of files) {
      if (!isScheduleFileUsable(filePath)) continue;
      if (isFileUnseededTemplate(filePath, path.basename(filePath))) continue;
      try {
        await scpCopy(filePath, `${sshHost}:${remoteDir}/${path.basename(filePath)}`);
      } catch (error) {
        failed = true;
        failedNames.push(path.basename(filePath));
        lastError = String(error?.message || error).split('\n')[0].slice(0, 200);
        pushQueue.add(filePath); // re-queue for retry
      }
    }
    if (failed) {
      pushFailureStreak += 1;
      logSync('warn', `push failed (streak ${pushFailureStreak}/${MAX_PUSH_FAILURE_STREAK}): ${failedNames.join(',')} — ${lastError}`);
      if (pushFailureStreak >= MAX_PUSH_FAILURE_STREAK) {
        // Bail out: clearing the queue lets autoSync pull resume. Without this,
        // a permanent scp failure stalls pull indefinitely (2026-05-13 incident).
        logSync('error', `push streak limit reached — dropping ${pushQueue.size} queued file(s) and disabling retry until next edit`);
        pushQueue.clear();
        pushFailureStreak = 0;
      }
    } else {
      if (pushFailureStreak > 0) logSync('info', `push recovered after ${pushFailureStreak} failure(s)`);
      pushFailureStreak = 0;
      logSync('info', 'push ok');
    }
    sendSyncStatus(failed ? 'error' : 'ok');
  } finally {
    pushInFlight = false;
    if (pushQueue.size > 0 && !pushDebounceTimer) {
      pushDebounceTimer = setTimeout(() => { flushSchedulePushQueue().catch(() => {}); }, 5000);
    }
  }
}

async function autoSyncWithVault() {
  if (autoSyncInFlight) return;
  if (pushQueue.size > 0 || pushInFlight) {
    logSync('info', `pull skipped: pushQueue=${pushQueue.size} pushInFlight=${pushInFlight}`);
    return;
  }
  autoSyncInFlight = true;
  try {
    const config = loadDashboardConfig();
    if (!config.today?.remote?.enabled) return;
    sendSyncStatus('syncing');
    logSync('info', 'pull start');
    try {
      await Promise.race([
        (async () => {
          await syncScheduleWithVault(config.today, 'pull');
          await refreshState();
        })(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('pull timeout (60s)')), 60000))
      ]);
      sendSyncStatus('ok');
      logSync('info', 'pull ok');
    } catch (error) {
      sendSyncStatus('error');
      logSync('error', `pull failed: ${String(error?.message || error).split('\n')[0].slice(0, 200)}`);
    }
  } finally {
    autoSyncInFlight = false;
  }
}

async function pushProjectsSnapshot() {
  try {
    const config = loadDashboardConfig();
    const host = getSshHost(config.today);
    const state = await getProjectsState();
    const json = JSON.stringify(state);
    await new Promise((resolve, reject) => {
      const child = require('child_process').spawn(
        'ssh',
        ['-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=5', host, 'cat > ~/projects-snapshot.json'],
        { windowsHide: true }
      );
      child.stdin.write(json);
      child.stdin.end();
      child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ssh exit ${code}`))));
      child.on('error', reject);
    });
  } catch (_) {
    // Silently ignore — M4 may be offline or SSH unavailable
  }
}

ipcMain.handle('widget:get-content-state', async () => {
  try {
    const config = loadDashboardConfig();
    return await getContentState(config);
  } catch (error) {
    return { cron: [], recent: [], queue: [], error: String(error.message || error) };
  }
});

ipcMain.handle('widget:get-vault-state', async () => {
  try {
    const config = loadDashboardConfig();
    const syncStatus = isScheduleUnseeded() ? 'unseeded' : 'ok';
    const state = await getVaultState(config);
    return { ...state, syncStatus };
  } catch (error) {
    return { folders: {}, notion: [], error: String(error.message || error) };
  }
});

ipcMain.handle('widget:get-notion-state', async () => {
  try {
    const config = loadDashboardConfig();
    return await searchNotion(config, { pageSize: 100 });
  } catch (error) {
    return { items: [], workspaces: [], error: String(error.message || error) };
  }
});

ipcMain.handle('widget:get-calendar-state', async (_event, payload) => {
  try {
    return await getCalendarState({
      range: payload?.range || 'week',
      force: !!payload?.force
    });
  } catch (error) {
    return { range: payload?.range || 'week', events: [], error: String(error.message || error) };
  }
});

ipcMain.handle('widget:open-calendar-day', async (_event, payload) => {
  const dateKey = String(payload?.dateKey || '').match(/^\d{4}-\d{2}-\d{2}$/)?.[0];
  if (!dateKey) return false;
  const [y, m, d] = dateKey.split('-').map((s) => Number(s));
  await shell.openExternal(`https://calendar.google.com/calendar/u/0/r/day/${y}/${m}/${d}`);
  return true;
});

ipcMain.handle('widget:open-calendar-event', async (_event, payload) => {
  const link = String(payload?.htmlLink || '').trim();
  if (!link.startsWith('https://')) return false;
  await shell.openExternal(link);
  return true;
});

ipcMain.handle('widget:add-calendar-event', async (_event, payload) => {
  try {
    const result = await insertEvent(payload || {});
    return { ok: true, event: result };
  } catch (error) {
    return { ok: false, error: String(error.message || error) };
  }
});

ipcMain.handle('widget:update-calendar-event', async (_event, payload) => {
  try {
    const result = await updateEvent(payload || {});
    return { ok: true, event: result };
  } catch (error) {
    return { ok: false, error: String(error.message || error) };
  }
});

ipcMain.handle('widget:delete-calendar-event', async (_event, payload) => {
  try {
    await deleteEvent(payload || {});
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error.message || error) };
  }
});

ipcMain.handle('widget:get-notion-children', async (_event, payload) => {
  try {
    const config = loadDashboardConfig();
    return await getNotionChildren(config, { parentId: payload?.parentId, parentKind: payload?.parentKind });
  } catch (error) {
    return { items: [], error: String(error.message || error) };
  }
});

ipcMain.handle('widget:notion-workspace-action', async (_event, payload) => {
  try {
    const raw = ensureJsonFile(getDashboardConfigPath(), DEFAULT_DASHBOARD_CONFIG);
    raw.notion = raw.notion || { workspaces: [], activeWorkspaceId: '' };
    const list = Array.isArray(raw.notion.workspaces) ? raw.notion.workspaces : [];
    const action = payload?.action;
    if (action === 'add') {
      const token = String(payload.token || '').trim();
      const label = String(payload.label || '').trim() || 'workspace';
      if (!token) return { ok: false, error: '토큰 필요' };
      const id = `ws_${Date.now().toString(36)}`;
      list.push({ id, label, token });
      raw.notion.workspaces = list;
      if (!raw.notion.activeWorkspaceId) raw.notion.activeWorkspaceId = id;
    } else if (action === 'remove') {
      const id = payload.id;
      raw.notion.workspaces = list.filter((w) => w.id !== id);
      if (raw.notion.activeWorkspaceId === id) {
        raw.notion.activeWorkspaceId = raw.notion.workspaces[0]?.id || '';
      }
    } else if (action === 'rename') {
      const ws = list.find((w) => w.id === payload.id);
      if (ws && typeof payload.label === 'string') ws.label = payload.label.trim() || ws.label;
      raw.notion.workspaces = list;
    } else if (action === 'replace-token') {
      const ws = list.find((w) => w.id === payload.id);
      const token = String(payload.token || '').trim();
      if (ws && token) ws.token = token;
      raw.notion.workspaces = list;
    } else if (action === 'set-active') {
      raw.notion.activeWorkspaceId = payload.id || '';
    } else if (action === 'import-env') {
      const envToken = process.env.NOTION_TOKEN || process.env.PERSONAL_NOTION_TOKEN || '';
      if (!envToken) return { ok: false, error: 'NOTION_TOKEN 환경변수 없음' };
      const id = `ws_${Date.now().toString(36)}`;
      const label = String(payload.label || 'env 토큰').trim();
      list.push({ id, label, token: envToken });
      raw.notion.workspaces = list;
      if (!raw.notion.activeWorkspaceId) raw.notion.activeWorkspaceId = id;
    } else {
      return { ok: false, error: 'unknown action' };
    }
    saveDashboardConfig(raw);
    return {
      ok: true,
      workspaces: raw.notion.workspaces.map((w) => ({ id: w.id, label: w.label, hasToken: !!w.token })),
      activeWorkspaceId: raw.notion.activeWorkspaceId
    };
  } catch (error) {
    return { ok: false, error: String(error.message || error) };
  }
});

ipcMain.handle('widget:open-notion-page', async (_event, payload) => {
  const url = payload?.url;
  if (!url || typeof url !== 'string' || !/^https?:\/\//.test(url)) {
    return { ok: false, error: 'invalid url' };
  }
  await shell.openExternal(url);
  return { ok: true };
});

ipcMain.handle('widget:run-cron-job', async (_event, payload) => {
  try {
    const config = loadDashboardConfig();
    const host = config?.today?.remote?.host || 'user@m4';
    return await runCronJob(host, payload?.id);
  } catch (error) {
    return { ok: false, error: String(error.message || error) };
  }
});

ipcMain.handle('widget:update-project-meta', async (_event, payload) => {
  try {
    const name = payload?.name;
    const patch = payload?.patch || {};
    return updateProjectMeta(name, patch);
  } catch (error) {
    return { ok: false, error: String(error.message || error) };
  }
});

ipcMain.handle('widget:open-project-action', async (_event, payload) => {
  const projectPath = payload?.path;
  const action = payload?.action;
  if (!projectPath || typeof projectPath !== 'string') {
    return { ok: false, error: 'invalid path' };
  }
  if (!fs.existsSync(projectPath)) {
    return { ok: false, error: 'path not found' };
  }
  try {
    if (action === 'folder') {
      const err = await shell.openPath(projectPath);
      return err ? { ok: false, error: err } : { ok: true };
    }
    if (action === 'terminal') {
      const { spawn } = require('child_process');
      const child = spawn('wt.exe', ['-d', projectPath], {
        detached: true,
        stdio: 'ignore',
        windowsHide: false
      });
      child.unref();
      return { ok: true };
    }
    return { ok: false, error: 'unknown action' };
  } catch (error) {
    return { ok: false, error: String(error.message || error) };
  }
});

ipcMain.handle('widget:open-vault-note', async (_event, payload) => {
  try {
    const config = loadDashboardConfig();
    return await openVaultNote(config, payload?.path);
  } catch (error) {
    return { ok: false, error: String(error.message || error) };
  }
});

ipcMain.handle('widget:read-vault-note', async (_event, payload) => {
  try {
    const config = loadDashboardConfig();
    return await readVaultNote(config, payload?.path);
  } catch (error) {
    return { ok: false, error: String(error.message || error) };
  }
});

// ── Today Log ─────────────────────────────────────────────────
function todayLogPath() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const dateStr = `${y}-${m}-${day}`;
  const root = process.env.VAULT_ROOT || path.join(os.homedir(), 'vault');
  return { filePath: path.join(root, '40-Logs', `${dateStr}.md`), dateStr };
}

function ensureTodayLog(filePath, dateStr) {
  if (fs.existsSync(filePath)) return;
  const header = `---\ntype: log\ndate: ${dateStr}\nstatus: active\n---\n# ${dateStr}\n\n`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, header, 'utf8');
}

ipcMain.handle('widget:get-today-log', async () => {
  try {
    const { filePath, dateStr } = todayLogPath();
    let content = '';
    let exists = fs.existsSync(filePath);
    if (exists) content = fs.readFileSync(filePath, 'utf8');
    return { ok: true, dateStr, filePath, exists, content };
  } catch (error) {
    return { ok: false, error: String(error.message || error) };
  }
});

ipcMain.handle('widget:append-today-log', async (_event, payload) => {
  try {
    const text = String(payload?.text || '').trim();
    if (!text) return { ok: false, error: '빈 입력' };
    const { filePath, dateStr } = todayLogPath();
    ensureTodayLog(filePath, dateStr);
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const line = `- ${hh}:${mm} ${text}\n`;
    const current = fs.readFileSync(filePath, 'utf8');
    const sep = current.endsWith('\n') ? '' : '\n';
    fs.writeFileSync(filePath, current + sep + line, 'utf8');
    return { ok: true, filePath, line: line.trim() };
  } catch (error) {
    return { ok: false, error: String(error.message || error) };
  }
});

ipcMain.handle('widget:open-today-log', async () => {
  try {
    const { filePath, dateStr } = todayLogPath();
    ensureTodayLog(filePath, dateStr);
    const { spawn } = require('child_process');
    const child = spawn('notepad.exe', [filePath], { detached: true, stdio: 'ignore', windowsHide: false });
    child.unref();
    return { ok: true, via: 'notepad', filePath };
  } catch (error) {
    return { ok: false, error: String(error.message || error) };
  }
});

ipcMain.handle('widget:delete-today-log-line', async (_event, payload) => {
  try {
    const lineIndex = Number(payload?.lineIndex);
    if (!Number.isFinite(lineIndex)) return { ok: false, error: 'invalid lineIndex' };
    const { filePath } = todayLogPath();
    if (!fs.existsSync(filePath)) return { ok: false, error: 'file not found' };
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    if (lineIndex < 0 || lineIndex >= lines.length) return { ok: false, error: 'out of range' };
    lines.splice(lineIndex, 1);
    fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error.message || error) };
  }
});

ipcMain.handle('widget:edit-today-log-line', async (_event, payload) => {
  try {
    const lineIndex = Number(payload?.lineIndex);
    const newText = String(payload?.newText || '').trim();
    if (!Number.isFinite(lineIndex)) return { ok: false, error: 'invalid lineIndex' };
    if (!newText) return { ok: false, error: '빈 텍스트' };
    const { filePath } = todayLogPath();
    if (!fs.existsSync(filePath)) return { ok: false, error: 'file not found' };
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    if (lineIndex < 0 || lineIndex >= lines.length) return { ok: false, error: 'out of range' };
    const original = lines[lineIndex];
    // Preserve `- HH:MM ` prefix if present, replace only the text after it
    const m = original.match(/^(\s*-\s*\d{2}:\d{2}\s+)/);
    lines[lineIndex] = m ? `${m[1]}${newText}` : newText;
    fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error.message || error) };
  }
});

ipcMain.on('widget:close', () => {
  app.isQuiting = true;
  app.quit();
});

app.whenReady().then(async () => {
  const config = loadDashboardConfig();
  createWindow();
  createTray();
  globalShortcut.register('CommandOrControl+Alt+P', () => resetWindowToPrimary());
  globalShortcut.register('CommandOrControl+Alt+R', () => moveWindowToDisplay(getRightmostDisplay()));
  // Start the external-watchdog heartbeat before any refresh/sync work. If a
  // startup task stalls the main loop, watchdog can now observe it accurately.
  writeHeartbeat();
  heartbeatTimer = setInterval(writeHeartbeat, 30 * 1000);
  try {
    ensureLocalScheduleSeeded(config.today);
  } catch {
    // Seeding failures fall back to empty templates created by ensureLocalScheduleSeeded itself.
  }
  ensureTodayWatchers(config.today);
  setTimeout(() => { refreshState().catch(() => {}); }, 0);
  refreshTimer = setInterval(refreshState, getRefreshIntervalMs());
  if (!isCloudScheduleEnabled(config.today?.cloud)) {
    setTimeout(() => { pushProjectsSnapshot().catch(() => {}); }, 1000);
    snapshotTimer = setInterval(pushProjectsSnapshot, 60 * 60 * 1000);
    // Auto pull → push every 5 min so mobile edits flow into Windows local copy
    // and Windows local edits flow up to M4 without manual button presses.
    setTimeout(() => { autoSyncWithVault().catch(() => {}); }, 2000);
    autoSyncTimer = setInterval(autoSyncWithVault, 5 * 60 * 1000);
  }

  // 모니터 sleep/wake·해상도 변경·시스템 resume 시 창 surface 가 멈추는 freeze 복구.
  // (사용자 보고: "모니터 껐다 켜거나 오래 켜두면 휠·클릭 안 됨")
  // screen·powerMonitor 는 app 'ready' 이후에만 접근 가능 — whenReady 안에서 등록.
  screen.on('display-metrics-changed', () => scheduleWindowNudge('display-metrics-changed'));
  screen.on('display-added', () => scheduleWindowNudge('display-added'));
  screen.on('display-removed', () => scheduleWindowNudge('display-removed'));
  powerMonitor.on('resume', () => scheduleWindowNudge('power-resume'));
  powerMonitor.on('unlock-screen', () => scheduleWindowNudge('unlock-screen'));
});

// GPU 프로세스가 죽으면 transparent 창이 마지막 프레임을 박제한 채 멈춘다.
// 렌더러는 살아있어 reload 한 번으로 새 GPU 컨텍스트를 잡아 repaint 한다.
app.on('child-process-gone', (_event, details) => {
  if (details?.type === 'GPU' && details?.reason !== 'clean-exit') {
    logSync('error', `GPU process gone: ${details?.reason || 'unknown'}`);
    recoverWindow('gpu-process-gone');
  }
});

app.on('window-all-closed', (event) => {
  event.preventDefault();
});

app.on('before-quit', () => {
  app.isQuiting = true;
  globalShortcut.unregisterAll();
  if (refreshTimer) {
    clearInterval(refreshTimer);
  }
  if (snapshotTimer) {
    clearInterval(snapshotTimer);
  }
  if (autoSyncTimer) {
    clearInterval(autoSyncTimer);
  }
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
  }
  if (pushDebounceTimer) {
    clearTimeout(pushDebounceTimer);
    pushDebounceTimer = null;
  }
  if (pushQueue.size > 0 && !pushInFlight) {
    flushSchedulePushQueue().catch(() => {});
  }
  if (todayRefreshDebounceTimer) {
    clearTimeout(todayRefreshDebounceTimer);
  }
  clearTodayWatchers();
});

