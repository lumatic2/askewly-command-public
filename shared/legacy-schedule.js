'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  LEGACY_STATUSES,
  TASK_SOURCE_KEYS,
  TASK_STATUSES,
  toCloudSourceKey,
  toCloudStatus
} = require('./tasks');

const DEFAULT_WIDGET_DIR = path.join(
  process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming'),
  'askewly-command',
  'widget'
);
const DEFAULT_CONFIG_PATH = path.join(DEFAULT_WIDGET_DIR, 'dashboard-config.json');

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function resolveConfiguredPath(filePath, baseDir) {
  if (!filePath) return '';
  return path.isAbsolute(filePath) ? filePath : path.resolve(baseDir, filePath);
}

function parseTaskLine(line) {
  const match = String(line || '').trim().match(/^- \[([ x/~])\]\s*(?:\[([^\]]*)\]\s*)?(.*)$/);
  if (!match) return null;

  const statusToken = match[1];
  const priority = (match[2] || '-').trim();
  const rawText = (match[3] || '').trim();
  const tags = rawText.match(/#[^\s#`]+/g) || [];
  const cleanedText = rawText.replace(/\s*#[^\s#`]+/g, '').trim();

  return {
    status: statusToken === '/' ? LEGACY_STATUSES.IN_PROGRESS
      : statusToken === 'x' ? LEGACY_STATUSES.COMPLETED
        : statusToken === '~' ? LEGACY_STATUSES.CANCELLED
          : LEGACY_STATUSES.PENDING,
    priority: ['높', '중', '낮', '-'].includes(priority) ? priority : '-',
    text: cleanedText,
    rawText,
    tags
  };
}

function parseMarkdownSectionsFromText(text, sourcePath = '') {
  const lines = String(text || '').split(/\r?\n/);
  const items = [];
  let h2 = '';
  let h3 = '';

  lines.forEach((line, lineIndex) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('## ')) {
      h2 = trimmed.slice(3).trim();
      h3 = '';
      return;
    }
    if (trimmed.startsWith('### ')) {
      h3 = trimmed.slice(4).trim();
      return;
    }
    const parsed = parseTaskLine(line);
    if (!parsed) return;
    items.push({ h2, h3, lineIndex, sourcePath, ...parsed });
  });

  return items;
}

function parseMarkdownSections(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  return parseMarkdownSectionsFromText(fs.readFileSync(filePath, 'utf8'), filePath);
}

function readRemoteText(host, remotePath) {
  return execFileSync('ssh', [host, `cat ${remotePath} 2>/dev/null`], {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 4
  });
}

function parseRemoteMarkdownSections(host, remotePath) {
  try {
    return parseMarkdownSectionsFromText(readRemoteText(host, remotePath), `${host}:${remotePath}`);
  } catch {
    return [];
  }
}

function isActiveTask(item) {
  return item.status !== LEGACY_STATUSES.COMPLETED && item.status !== LEGACY_STATUSES.CANCELLED;
}

function isTodaySection(item) {
  const heading = `${item.h2 || ''} ${item.h3 || ''}`;
  return heading.includes('오늘') || heading.toLowerCase().includes('today');
}

function isDeadlineSection(item) {
  const heading = `${item.h2 || ''} ${item.h3 || ''}`;
  return heading.includes('마감') || heading.toLowerCase().includes('deadline');
}

function normalizeTitle(value) {
  return String(value || '')
    .replace(/`[^`]*`/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function extractMonthDayDate(text, now = new Date()) {
  const match = String(text || '').match(/`(\d{2})-(\d{2})(?:[^`]*)`/);
  if (!match) return null;
  const year = now.getFullYear();
  const month = Number(match[1]);
  const day = Number(match[2]);
  if (!month || !day) return null;
  const date = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function kstDateString(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function makeCandidate(item, sourceKey, sortOrder, now = new Date()) {
  const cloudKey = toCloudSourceKey(sourceKey);
  const dueAt = cloudKey === TASK_SOURCE_KEYS.DEADLINES ? extractMonthDayDate(item.text, now) : null;
  const scheduledFor = cloudKey === TASK_SOURCE_KEYS.TODAY ? kstDateString(now) : null;

  return {
    sourceKey: cloudKey,
    legacySourceKey: sourceKey,
    title: item.text,
    status: toCloudStatus(item.status === LEGACY_STATUSES.IN_PROGRESS ? LEGACY_STATUSES.IN_PROGRESS : LEGACY_STATUSES.PENDING),
    dueAt,
    scheduledFor,
    sortOrder,
    duplicateKey: buildDuplicateKey(cloudKey, item.text, dueAt || scheduledFor || ''),
    legacy: {
      sourcePath: item.sourcePath,
      lineIndex: item.lineIndex,
      section: item.h2,
      subsection: item.h3,
      priority: item.priority
    }
  };
}

function buildDuplicateKey(sourceKey, title, dateValue = '') {
  return `${toCloudSourceKey(sourceKey)}|${normalizeTitle(title)}|${String(dateValue || '').slice(0, 10)}`;
}

function resolveLegacyPaths(options = {}) {
  const configPath = path.resolve(options.configPath || DEFAULT_CONFIG_PATH);
  const config = readJson(configPath, {});
  const todayConfig = config.today || {};
  const sourceBase = options.vaultRoot ? path.resolve(options.vaultRoot) : path.dirname(configPath);
  const mountConfig = todayConfig.mount || {};
  const mountedBase = mountConfig.enabled ? resolveConfiguredPath(mountConfig.basePath, sourceBase) : '';

  return {
    configPath,
    remote: todayConfig.remote || {},
    schedule: resolveConfiguredPath(options.schedule || todayConfig.paths?.schedule || (mountedBase ? path.join(mountedBase, 'SCHEDULE.md') : ''), sourceBase),
    backlog: resolveConfiguredPath(options.backlog || todayConfig.paths?.backlog || (mountedBase ? path.join(mountedBase, 'BACKLOG.md') : ''), sourceBase)
  };
}

function loadLegacyActiveSchedule(options = {}) {
  const paths = resolveLegacyPaths(options);
  let scheduleItems = [];
  let backlogItems = [];
  let sourceMode = 'files';

  if (paths.schedule && fs.existsSync(paths.schedule)) {
    scheduleItems = parseMarkdownSections(paths.schedule);
  }
  if (paths.backlog && fs.existsSync(paths.backlog)) {
    backlogItems = parseMarkdownSections(paths.backlog);
  }

  if (scheduleItems.length === 0 && backlogItems.length === 0 && paths.remote?.enabled) {
    const host = paths.remote.host || 'user@m4';
    const baseDir = paths.remote.baseDir || '~/vault/30-projects/schedule';
    scheduleItems = parseRemoteMarkdownSections(host, `${baseDir}/SCHEDULE.md`);
    backlogItems = parseRemoteMarkdownSections(host, `${baseDir}/BACKLOG.md`);
    sourceMode = 'remote';
  }

  const now = options.now || new Date();
  const today = scheduleItems
    .filter(isTodaySection)
    .filter(isActiveTask)
    .map((item, index) => makeCandidate(item, 'today', (index + 1) * 10, now));
  const deadlines = scheduleItems
    .filter(isDeadlineSection)
    .filter(isActiveTask)
    .map((item, index) => makeCandidate(item, 'deadline', (index + 1) * 10, now));
  const backlog = backlogItems
    .filter(isActiveTask)
    .map((item, index) => makeCandidate(item, 'backlog', (index + 1) * 10, now));

  return {
    sourceMode,
    paths,
    today,
    deadlines,
    backlog,
    candidates: [...today, ...deadlines, ...backlog]
  };
}

module.exports = {
  DEFAULT_CONFIG_PATH,
  buildDuplicateKey,
  loadLegacyActiveSchedule,
  normalizeTitle,
  parseMarkdownSectionsFromText,
  parseTaskLine
};

