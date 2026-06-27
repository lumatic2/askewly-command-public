const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DEFAULT_WIDGET_DIR = path.join(process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming'), 'askewly-command', 'widget');
const DEFAULT_CONFIG_PATH = path.join(DEFAULT_WIDGET_DIR, 'dashboard-config.json');
const DEFAULT_CACHE_PATH = path.join(DEFAULT_WIDGET_DIR, 'today-cache.json');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

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

function sleep(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // busy wait is acceptable here because this script is short-lived
  }
}

function readTextWithRetry(filePath, retries = 2) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return fs.readFileSync(filePath, 'utf8');
    } catch (error) {
      lastError = error;
      const message = String(error?.message || error || '');
      const retryable = message.includes('EIO') || message.includes('i/o error') || message.includes('EBUSY') || message.includes('EPERM');
      if (!retryable || attempt === retries) {
        throw error;
      }
      sleep([250, 700, 1400][attempt] || 500);
    }
  }
  throw lastError;
}

function readText(filePath) {
  return readTextWithRetry(filePath);
}

function readRemoteText(host, remotePath) {
  return execFileSync('ssh', [host, `cat ${remotePath} 2>/dev/null`], {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 4
  });
}

function taskStatusRank(status) {
  if (status === 'in_progress') return 0;
  if (status === 'pending') return 1;
  return 2;
}

function priorityRank(priority) {
  if (priority === '높') return 0;
  if (priority === '중') return 1;
  if (priority === '낮') return 2;
  return 3;
}

function parseTaskLine(line) {
  const match = line.trim().match(/^- \[([ x/~])\]\s*(?:\[([^\]]*)\]\s*)?(.*)$/);
  if (!match) {
    const recurringMatch = line.trim().match(/^-\s*([^|]+)\|\s*(.*?)\s*(#[^\s#`]+)?\s*$/);
    if (!recurringMatch) return null;
    const cadence = String(recurringMatch[1] || '').trim();
    const rawText = String(recurringMatch[2] || '').trim();
    const tags = rawText.match(/#[^\s#`]+/g) || [];
    const cleanedText = rawText.replace(/\s*#[^\s#`]+/g, '').trim();
    return {
      status: 'pending',
      priority: '-',
      text: cadence ? `${cadence} | ${cleanedText}` : cleanedText,
      tags
    };
  }

  const statusToken = match[1];
  const priority = (match[2] || '-').trim();
  const rawText = (match[3] || '').trim();
  const tags = rawText.match(/#[^\s#`]+/g) || [];
  const cleanedText = rawText.replace(/\s*#[^\s#`]+/g, '').trim();

  return {
    status: statusToken === '/' ? 'in_progress' : statusToken === 'x' ? 'completed' : statusToken === '~' ? 'cancelled' : 'pending',
    priority: ['높', '중', '낮', '-'].includes(priority) ? priority : '-',
    text: cleanedText,
    tags
  };
}

function parseMarkdownSectionsFromText(text) {
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
    items.push({ h2, h3, lineIndex, ...parsed });
  });

  return items;
}

function parseMarkdownSections(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  return parseMarkdownSectionsFromText(readText(filePath));
}

function makePayloadItem(item, sourceKey, text = item.text) {
  return {
    id: `${sourceKey}:${item.lineIndex}`,
    text,
    rawText: item.text,
    status: item.status,
    priority: item.priority,
    sourceKey,
    section: item.h2,
    lineIndex: item.lineIndex
  };
}

function inferScheduleSource(h2) {
  const heading = String(h2 || '').toLowerCase();
  return heading.includes('deadline') || String(h2 || '').includes('마감') ? 'deadline' : 'today';
}

function buildArchivedItems(scheduleArchiveItems, recurringArchiveItems, backlogArchiveItems) {
  const scheduleMapped = scheduleArchiveItems.map((item) => makePayloadItem(item, inferScheduleSource(item.h2)));
  const recurringMapped = recurringArchiveItems.map((item) => makePayloadItem(item, 'recurring'));
  const backlogMapped = backlogArchiveItems.map((item) => makePayloadItem(item, 'backlog'));
  return [...scheduleMapped, ...recurringMapped, ...backlogMapped]
    .map((item) => ({ ...item, archived: true }))
    .sort((left, right) => String(left.text || '').localeCompare(String(right.text || ''), 'ko'));
}

function formatDeadlineLabel(text) {
  const explicit = text.match(/`(\d{2}-\d{2})(?:[^`]*)`/);
  const monthDay = explicit ? explicit[1] : null;
  if (!monthDay) return text;

  const now = new Date();
  const currentYear = now.getFullYear();
  const due = new Date(`${currentYear}-${monthDay}`);
  const diffDays = Math.ceil((due.getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / (1000 * 60 * 60 * 24));
  let badge = '⚪';
  if (diffDays <= 3) badge = '🔴';
  else if (diffDays <= 7) badge = '🟡';
  const dLabel = diffDays >= 0 ? `D-${diffDays}` : `D+${Math.abs(diffDays)}`;
  return `${badge} ${dLabel} ${text.replace(/`[^`]+`/g, '').trim()}`;
}

function weekdayLabel(now = new Date()) {
  return new Intl.DateTimeFormat('ko-KR', { weekday: 'long', timeZone: 'Asia/Seoul' }).format(now);
}

function pickRecurring(items) {
  const weekday = weekdayLabel();
  const token = weekday.replace('요일', '');
  const activeItems = items.filter((item) => item.status !== 'completed' && item.status !== 'cancelled');
  const matchesWeekday = (item) => `${item.h2} ${item.h3} ${item.text}`.includes(token) || `${item.h2} ${item.h3} ${item.text}`.includes(weekday);
  const matchingItems = activeItems.filter(matchesWeekday);
  const genericItems = activeItems.filter((item) => !matchesWeekday(item));
  return [...matchingItems, ...genericItems]
    .map((item) => item.text)
    .slice(0, 4);
}

function pickBacklogRecommendations(items) {
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'Asia/Seoul' }).format(new Date());
  const preferWork = !['Sat', 'Sun'].includes(weekday);
  const preferredTags = preferWork ? ['#개발', '#회사'] : ['#라이프', '#크리에이티브'];

  return items
    .filter((item) => item.status !== 'completed' && item.status !== 'cancelled')
    .filter((item) => !String(item.h2 || '').includes('아이디어 풀'))
    .sort((left, right) => {
      const leftPreferred = left.tags.some((tag) => preferredTags.includes(tag)) ? 0 : 1;
      const rightPreferred = right.tags.some((tag) => preferredTags.includes(tag)) ? 0 : 1;
      if (leftPreferred !== rightPreferred) return leftPreferred - rightPreferred;
      const priorityDiff = priorityRank(left.priority) - priorityRank(right.priority);
      if (priorityDiff !== 0) return priorityDiff;
      return taskStatusRank(left.status) - taskStatusRank(right.status);
    })
    .slice(0, 3)
    .map((item) => {
      const reason = item.tags.some((tag) => preferredTags.includes(tag))
        ? '현재 요일 기준 우선 카테고리와 맞음'
        : `백로그 상단 + 우선순위 ${item.priority || '-'}`;
      return `[추천] ${item.text} — ${reason}`;
    });
}

function pickSomeday(backlogItems, somedayItems) {
  const source = somedayItems.length > 0 ? somedayItems : backlogItems.filter((item) => String(item.h2 || '').includes('아이디어 풀'));
  const seen = new Set();
  const picks = [];

  for (const item of source) {
    const category = item.h3 || item.h2 || 'Someday';
    if (seen.has(category)) continue;
    seen.add(category);
    picks.push(`[Someday] ${category} — ${item.text}`);
    if (picks.length === 3) break;
  }

  return picks;
}

function buildPayload(scheduleItems, backlogItems, recurringItems, somedayItems, archivedItems = []) {
  const todayItems = scheduleItems
    .filter((item) => String(item.h2 || '').includes('오늘'))
    .filter((item) => item.status !== 'completed' && item.status !== 'cancelled')
    .map((item) => makePayloadItem(item, 'today'))
    .slice(0, 5);

  const deadlineItems = scheduleItems
    .filter((item) => String(item.h2 || '').includes('마감'))
    .filter((item) => item.status !== 'completed' && item.status !== 'cancelled')
    .map((item) => makePayloadItem(item, 'deadline', formatDeadlineLabel(item.text)))
    .slice(0, 5);

  const recurring = pickRecurring(recurringItems)
    .map((text) => {
      const sourceItem = recurringItems.find((item) => item.text === text);
      return sourceItem ? makePayloadItem(sourceItem, 'recurring') : makePayloadItem({ text, status: 'pending', priority: '-', h2: '매주', lineIndex: -1 }, 'recurring');
    });
  const recommended = pickBacklogRecommendations(backlogItems);
  const someday = pickSomeday(backlogItems, somedayItems);
  const backlogItemsPayload = backlogItems
    .filter((item) => item.status !== 'completed' && item.status !== 'cancelled')
    .slice(0, 24)
    .map((item) => makePayloadItem(item, 'backlog'));

  return {
    source: 'vault-sync',
    today: todayItems,
    deadlines: deadlineItems,
    recurring,
    backlog: backlogItemsPayload.length > 0 ? backlogItemsPayload : [...recommended, ...someday],
    archived: archivedItems,
    statusSummary: `오늘 ${todayItems.length}건, 마감 ${deadlineItems.length}건, 반복 ${recurring.length}건, 추천 ${recommended.length}건`,
    generatedAt: new Date().toISOString()
  };
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const configPath = path.resolve(args.config || DEFAULT_CONFIG_PATH);
  const config = readJson(configPath, {});
  const todayConfig = config.today || {};
  const remoteConfig = todayConfig.remote || {};
  const mountConfig = todayConfig.mount || {};

  const sourceBase = args['vault-root']
    ? path.resolve(args['vault-root'])
    : path.dirname(configPath);

  const mountedBase = mountConfig.enabled ? resolveConfiguredPath(mountConfig.basePath, sourceBase) : '';
  const mountedSchedulePath = mountedBase ? path.join(mountedBase, 'SCHEDULE.md') : '';
  const mountedBacklogPath = mountedBase ? path.join(mountedBase, 'BACKLOG.md') : '';
  const mountedRecurringPath = mountedBase ? path.join(mountedBase, 'RECURRING.md') : '';
  const mountedScheduleArchivePath = mountedBase ? path.join(mountedBase, 'SCHEDULE_ARCHIVE.md') : '';
  const mountedBacklogArchivePath = mountedBase ? path.join(mountedBase, 'BACKLOG_ARCHIVE.md') : '';
  const mountedRecurringArchivePath = mountedBase ? path.join(mountedBase, 'RECURRING_ARCHIVE.md') : '';
  const schedulePath = resolveConfiguredPath(args.schedule || todayConfig.paths?.schedule || mountedSchedulePath, sourceBase);
  const backlogPath = resolveConfiguredPath(args.backlog || todayConfig.paths?.backlog || mountedBacklogPath, sourceBase);
  const recurringPath = resolveConfiguredPath(args.recurring || todayConfig.paths?.recurring || mountedRecurringPath, sourceBase);
  const scheduleArchivePath = resolveConfiguredPath(args['schedule-archive'] || todayConfig.paths?.scheduleArchive || mountedScheduleArchivePath, sourceBase);
  const backlogArchivePath = resolveConfiguredPath(args['backlog-archive'] || todayConfig.paths?.backlogArchive || mountedBacklogArchivePath, sourceBase);
  const recurringArchivePath = resolveConfiguredPath(args['recurring-archive'] || todayConfig.paths?.recurringArchive || mountedRecurringArchivePath, sourceBase);
  const somedayPath = resolveConfiguredPath(args.someday || todayConfig.paths?.someday, sourceBase);
  const cachePath = path.resolve(args['cache-path'] || todayConfig.cachePath || DEFAULT_CACHE_PATH);

  if (!schedulePath && !remoteConfig.enabled) {
    throw new Error('today.paths.schedule and today.paths.backlog must be configured, or pass --schedule/--backlog.');
  }

  let scheduleItems;
  let backlogItems;
  let recurringItems;
  let somedayItems;
  let scheduleArchiveItems;
  let backlogArchiveItems;
  let recurringArchiveItems;

  if (schedulePath && fs.existsSync(schedulePath) && backlogPath && fs.existsSync(backlogPath) && recurringPath && fs.existsSync(recurringPath)) {
    scheduleItems = parseMarkdownSections(schedulePath);
    backlogItems = parseMarkdownSections(backlogPath);
    recurringItems = parseMarkdownSections(recurringPath);
    somedayItems = somedayPath && fs.existsSync(somedayPath) ? parseMarkdownSections(somedayPath) : [];
    scheduleArchiveItems = parseMarkdownSections(scheduleArchivePath);
    backlogArchiveItems = parseMarkdownSections(backlogArchivePath);
    recurringArchiveItems = parseMarkdownSections(recurringArchivePath);
  } else if (remoteConfig.enabled) {
    const baseDir = remoteConfig.baseDir || '~/path/to/schedule';
    const host = remoteConfig.host || 'user@m4';
    scheduleItems = parseMarkdownSectionsFromText(readRemoteText(host, `${baseDir}/SCHEDULE.md`));
    backlogItems = parseMarkdownSectionsFromText(readRemoteText(host, `${baseDir}/BACKLOG.md`));
    recurringItems = parseMarkdownSectionsFromText(readRemoteText(host, `${baseDir}/RECURRING.md`));
    try {
      scheduleArchiveItems = parseMarkdownSectionsFromText(readRemoteText(host, `${baseDir}/SCHEDULE_ARCHIVE.md`));
    } catch {
      scheduleArchiveItems = [];
    }
    try {
      backlogArchiveItems = parseMarkdownSectionsFromText(readRemoteText(host, `${baseDir}/BACKLOG_ARCHIVE.md`));
    } catch {
      backlogArchiveItems = [];
    }
    try {
      recurringArchiveItems = parseMarkdownSectionsFromText(readRemoteText(host, `${baseDir}/RECURRING_ARCHIVE.md`));
    } catch {
      recurringArchiveItems = [];
    }
    try {
      somedayItems = parseMarkdownSectionsFromText(readRemoteText(host, `${baseDir}/SOMEDAY.md`));
    } catch {
      somedayItems = [];
    }
  } else {
    scheduleItems = parseMarkdownSections(schedulePath);
    backlogItems = parseMarkdownSections(backlogPath);
    recurringItems = parseMarkdownSections(recurringPath);
    somedayItems = parseMarkdownSections(somedayPath);
    scheduleArchiveItems = parseMarkdownSections(scheduleArchivePath);
    backlogArchiveItems = parseMarkdownSections(backlogArchivePath);
    recurringArchiveItems = parseMarkdownSections(recurringArchivePath);
  }

  const archivedItems = buildArchivedItems(scheduleArchiveItems, recurringArchiveItems, backlogArchiveItems);
  const payload = buildPayload(scheduleItems, backlogItems, recurringItems, somedayItems, archivedItems);
  ensureDir(cachePath);
  fs.writeFileSync(cachePath, JSON.stringify(payload, null, 2), 'utf8');

  process.stdout.write(`${cachePath}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}

