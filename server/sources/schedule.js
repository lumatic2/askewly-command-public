const fs = require('fs');
const path = require('path');
const config = require('../config');

// ── File paths ─────────────────────────────────────────────────────────────

const FILE_NAMES = {
  today: 'SCHEDULE.md',
  deadline: 'SCHEDULE.md',
  recurring: 'RECURRING.md',
  backlog: 'BACKLOG.md'
};
const ARCHIVE_NAMES = {
  today: 'SCHEDULE_ARCHIVE.md',
  deadline: 'SCHEDULE_ARCHIVE.md',
  recurring: 'RECURRING_ARCHIVE.md',
  backlog: 'BACKLOG_ARCHIVE.md'
};

function legacyScheduleDisabledState() {
  return {
    source: 'legacy-disabled',
    today: [],
    deadlines: [],
    recurring: [],
    backlog: [],
    archived: [],
    statusSummary: 'Legacy M4 markdown schedule is disabled. Supabase is the schedule source of truth.',
    generatedAt: new Date().toISOString()
  };
}

function assertLegacyScheduleEnabled() {
  if (!config.LEGACY_SCHEDULE_ENABLED) {
    throw new Error('Legacy M4 markdown schedule API is disabled. Use Supabase schedule SoT instead.');
  }
}

function canonicalSourceKey(sourceKey) {
  return sourceKey === 'deadlines' ? 'deadline' : sourceKey;
}
function getScheduleFile(sourceKey) {
  const name = FILE_NAMES[sourceKey];
  return name ? path.join(config.SCHEDULE_DIR, name) : '';
}
function getArchiveFile(sourceKey) {
  const name = ARCHIVE_NAMES[sourceKey];
  return name ? path.join(config.SCHEDULE_DIR, name) : '';
}

// ── Parsing ────────────────────────────────────────────────────────────────

function parseTaskLine(line) {
  const match = line.trim().match(/^- \[([ x/~])\]\s*(?:\[([^\]]*)\]\s*)?(.*?)\s*(#[^\s#`]+)?\s*$/);
  if (!match) {
    const recurringMatch = line.trim().match(/^-\s*([^|]+)\|\s*(.*?)\s*(#[^\s#`]+)?\s*$/);
    if (!recurringMatch) return null;
    const cadence = String(recurringMatch[1] || '').trim();
    const rawText = String(recurringMatch[2] || '').trim();
    const category = (recurringMatch[3] || '').trim();
    return { status: 'pending', priority: '-', text: cadence ? `${cadence} | ${rawText}` : rawText, category };
  }
  const statusRaw = match[1];
  const priority = (match[2] || '-').trim();
  let text = (match[3] || '').trim();
  const category = (match[4] || '').trim();
  if (category && text.endsWith(category)) text = text.slice(0, -category.length).trim();
  return {
    status: statusRaw === 'x' ? 'completed' : statusRaw === '/' ? 'in_progress' : statusRaw === '~' ? 'cancelled' : 'pending',
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
    if (stripped.startsWith('## ')) { section = stripped.slice(3).trim(); return; }
    const parsed = parseTaskLine(line);
    if (!parsed) return;
    items.push({ section, lineIndex, ...parsed });
  });
  return items;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function statusToken(status) {
  if (status === 'in_progress') return '/';
  if (status === 'completed') return 'x';
  if (status === 'cancelled') return '~';
  return ' ';
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
  if (targetKey === 'backlog' && priority === '-') priority = '중';
  if (targetKey === 'deadline' && !priority) priority = '-';
  const includePriority = targetKey === 'backlog' || targetKey === 'deadline' || (priority && priority !== '-');
  const priorityChunk = includePriority ? ` [${priority || '-'}]` : '';
  const text = String(task.text || '').trim();
  const category = String(task.category || '').trim();
  return `- [${token}]${priorityChunk} ${text}${category ? ` ${category}` : ''}`.trim();
}

function resolveTaskLineIndex(lines, lineIndex) {
  const index = Number(lineIndex);
  if (index >= 0 && index < lines.length && parseTaskLine(lines[index])) return index;
  for (let offset = 1; offset <= 5; offset++) {
    for (const candidate of [index - offset, index + offset]) {
      if (candidate >= 0 && candidate < lines.length && parseTaskLine(lines[candidate])) return candidate;
    }
  }
  return -1;
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

// ── File mutators ──────────────────────────────────────────────────────────

function removeTaskLineFromFile(filePath, lineIndex) {
  if (!filePath || !fs.existsSync(filePath)) throw new Error(`Source file not found: ${filePath}`);
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  const index = resolveTaskLineIndex(lines, lineIndex);
  if (index === -1) throw new Error('Target task line not found');
  const parsed = parseTaskLine(lines[index]);
  lines.splice(index, 1);
  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
  return parsed;
}

function deleteTaskLineFromFile(filePath, lineIndex) {
  if (!filePath || !fs.existsSync(filePath)) throw new Error(`Source file not found: ${filePath}`);
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  const index = resolveTaskLineIndex(lines, lineIndex);
  if (index === -1) throw new Error('Target task line not found');
  lines.splice(index, 1);
  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
}

function updateTaskStatusInFile(filePath, lineIndex, nextStatus) {
  if (!filePath || !fs.existsSync(filePath)) throw new Error(`Source file not found: ${filePath}`);
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  const index = resolveTaskLineIndex(lines, lineIndex);
  if (index === -1) throw new Error('Target task line not found');
  const currentLine = lines[index];
  let nextLine = currentLine.replace(/^(\s*-\s*\[)[ x/~](\])/, `$1${statusToken(nextStatus)}$2`);
  if (nextLine === currentLine) {
    nextLine = currentLine.replace(/^(\s*-\s*)(?!\[)/, `$1[${statusToken(nextStatus)}] `);
  }
  if (nextLine === currentLine) throw new Error('Unable to update task status');
  lines[index] = nextLine;
  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
}

function updateTaskTextInFile(filePath, lineIndex, newText) {
  if (!filePath || !fs.existsSync(filePath)) throw new Error(`Source file not found: ${filePath}`);
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  const index = resolveTaskLineIndex(lines, lineIndex);
  if (index === -1) throw new Error('Target task line not found');
  const text = String(newText || '').trim();
  if (!text) throw new Error('New text cannot be empty');
  const currentLine = lines[index];
  const nextLine = currentLine.replace(
    /^(\s*-\s*\[[ x/~]\](?:\s*\[[^\]]*\])?\s*)(.+?)(\s+#[^\s#`]+)?\s*$/,
    (_m, prefix, _old, category) => `${prefix}${text}${category || ''}`
  );
  lines[index] = nextLine !== currentLine ? nextLine : currentLine;
  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
}

function reorderTaskInFile(filePath, fromLineIndex, insertBeforeLineIndex, fromRawText) {
  if (!filePath || !fs.existsSync(filePath)) throw new Error(`Source file not found: ${filePath}`);
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

function insertTaskIntoSection(filePath, sectionMatchers, line, options = {}) {
  if (!filePath) throw new Error('Source file path is required');
  const prepend = options.prepend === true;
  const createAtTop = options.createAtTop === true;
  if (!fs.existsSync(filePath)) {
    const heading = sectionMatchers[0] || 'Tasks';
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `## ${heading}\n\n${line}\n`, 'utf8');
    return;
  }
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  let headingIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed.startsWith('## ')) continue;
    const heading = trimmed.slice(3).trim();
    if (sectionMatchers.some((matcher) => heading.includes(matcher))) { headingIndex = i; break; }
  }
  if (headingIndex === -1) {
    if (createAtTop) {
      const firstHeadingIndex = lines.findIndex((raw) => raw.trim().startsWith('## '));
      const insertAt = firstHeadingIndex >= 0 ? firstHeadingIndex : lines.length;
      lines.splice(insertAt, 0, '', `## ${sectionMatchers[0]}`, '', line);
    } else {
      lines.push('', `## ${sectionMatchers[0]}`, line);
    }
    fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
    return;
  }
  let insertAt = headingIndex + 1;
  while (insertAt < lines.length && lines[insertAt].trim() === '') insertAt += 1;
  if (prepend) {
    lines.splice(insertAt, 0, line);
  } else {
    while (insertAt < lines.length && !lines[insertAt].trim().startsWith('## ')) insertAt += 1;
    lines.splice(insertAt, 0, line);
  }
  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
}

// ── Read API ───────────────────────────────────────────────────────────────

function formatDeadlineLabel(text) {
  const explicit = String(text || '').match(/`(\d{2}-\d{2})(?:[^`]*)`/);
  const monthDay = explicit ? explicit[1] : null;
  if (!monthDay) return text;
  const now = new Date();
  const due = new Date(`${now.getFullYear()}-${monthDay}`);
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

function pickRecurringItems(items) {
  if (items.length === 0) return [];
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'Asia/Seoul' }).format(new Date());
  const weekdayShort = weekday.slice(0, 3).toLowerCase();
  const weekdayKoMap = {
    Monday: ['월', '월요일'], Tuesday: ['화', '화요일'], Wednesday: ['수', '수요일'],
    Thursday: ['목', '목요일'], Friday: ['금', '금요일'], Saturday: ['토', '토요일'], Sunday: ['일', '일요일']
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

function loadArchivedItems() {
  const today = parseTaskFile(getArchiveFile('today')).map((item) => ({ ...makeTodayItem(item, inferSourceFromScheduleSection(item.section)), archived: true }));
  const recurring = parseTaskFile(getArchiveFile('recurring')).map((item) => ({ ...makeTodayItem(item, 'recurring'), archived: true }));
  const backlog = parseTaskFile(getArchiveFile('backlog')).map((item) => ({ ...makeTodayItem(item, 'backlog'), archived: true }));
  return [...today, ...recurring, ...backlog].sort((a, b) => String(a.text || '').localeCompare(String(b.text || ''), 'ko'));
}

function getScheduleState() {
  if (!config.LEGACY_SCHEDULE_ENABLED) {
    return legacyScheduleDisabledState();
  }

  const scheduleItems = parseTaskFile(getScheduleFile('today'));
  const backlogItems = parseTaskFile(getScheduleFile('backlog'));
  const recurringItems = parseTaskFile(getScheduleFile('recurring'));

  const todayItems = scheduleItems
    .filter((item) => (item.section || '').includes('오늘') || (item.section || '').toLowerCase().includes('today'))
    .filter((item) => item.status !== 'completed' && item.status !== 'cancelled')
    .map((item) => makeTodayItem(item, 'today'));

  const deadlineItems = [...scheduleItems, ...backlogItems]
    .filter((item) => (item.section || '').includes('마감') || (item.section || '').toLowerCase().includes('deadline'))
    .filter((item) => item.status !== 'completed' && item.status !== 'cancelled')
    .map((item) => makeTodayItem(item, 'deadline', { label: formatDeadlineLabel(item.text) }));

  const recurringPicked = pickRecurringItems(recurringItems);
  const backlog = backlogItems
    .filter((item) => item.status !== 'completed' && item.status !== 'cancelled')
    .map((item) => makeTodayItem(item, 'backlog'));

  return {
    source: 'files',
    today: todayItems,
    deadlines: deadlineItems,
    recurring: recurringPicked.length > 0
      ? recurringPicked.map((text) => {
          const sourceItem = recurringItems.find((item) => item.text === text);
          return sourceItem ? makeTodayItem(sourceItem, 'recurring') : { id: `recurring:${text}`, text, rawText: text, status: 'pending', priority: '-', sourceKey: 'recurring', section: '', lineIndex: null };
        })
      : [],
    backlog,
    archived: loadArchivedItems(),
    statusSummary: `${todayItems.length} today · ${deadlineItems.length} deadline · ${recurringPicked.length} recurring`,
    generatedAt: new Date().toISOString()
  };
}

// ── Write API (called from server.js routes) ───────────────────────────────

function addItem({ target, text, section }) {
  assertLegacyScheduleEnabled();
  const key = canonicalSourceKey(target);
  const trimmedText = String(text || '').trim();
  if (!trimmedText) throw new Error('Task text is required');
  const sectionMatchers = getInsertSectionMatchers(key, section);
  const createAtTop = key === 'backlog' && String(sectionMatchers[0] || '').trim() === '백로그';

  if (key === 'today') {
    insertTaskIntoSection(getScheduleFile('today'), sectionMatchers, `- [ ] ${trimmedText}`, { prepend: true });
  } else if (key === 'deadline') {
    insertTaskIntoSection(getScheduleFile('today'), sectionMatchers, `- [ ] [-] ${trimmedText}`, { prepend: true });
  } else if (key === 'recurring') {
    insertTaskIntoSection(getScheduleFile('recurring'), sectionMatchers, `- 매주 | ${trimmedText}`, { prepend: true });
  } else if (key === 'backlog') {
    insertTaskIntoSection(getScheduleFile('backlog'), sectionMatchers, `- [ ] [중] ${trimmedText}`, { prepend: true, createAtTop });
  } else {
    throw new Error('Unknown schedule target');
  }
}

function updateItemStatus({ sourceKey, lineIndex, nextStatus }) {
  assertLegacyScheduleEnabled();
  const key = canonicalSourceKey(sourceKey);
  const filePath = getScheduleFile(key);
  if (!filePath) throw new Error('Unknown schedule source');
  if (nextStatus === 'completed') {
    const archivePath = getArchiveFile(key);
    const task = removeTaskLineFromFile(filePath, Number(lineIndex));
    const archivedLine = formatTaskLine(task, key, { status: 'completed' });
    const sectionMatchers = getArchiveSectionMatchers(key);
    if (sectionMatchers.length === 0) throw new Error('Unknown schedule source');
    insertTaskIntoSection(archivePath, sectionMatchers, archivedLine);
  } else {
    updateTaskStatusInFile(filePath, Number(lineIndex), nextStatus || 'pending');
  }
}

function updateItemText({ sourceKey, lineIndex, newText }) {
  assertLegacyScheduleEnabled();
  const key = canonicalSourceKey(sourceKey);
  const filePath = getScheduleFile(key);
  if (!filePath) throw new Error('Unknown schedule source');
  updateTaskTextInFile(filePath, Number(lineIndex), newText);
}

function deleteItem({ sourceKey, lineIndex, archived }) {
  assertLegacyScheduleEnabled();
  const key = canonicalSourceKey(sourceKey);
  const filePath = archived ? getArchiveFile(key) : getScheduleFile(key);
  if (!filePath) throw new Error('Unknown schedule source');
  deleteTaskLineFromFile(filePath, Number(lineIndex));
}

function moveItem({ sourceKey, lineIndex, targetKey }) {
  assertLegacyScheduleEnabled();
  const source = canonicalSourceKey(sourceKey);
  const target = canonicalSourceKey(targetKey);
  if (!source || !target || source === target) return;
  const sourcePath = getScheduleFile(source);
  const targetPath = getScheduleFile(target);
  if (!sourcePath || !targetPath) throw new Error('Unknown schedule source');
  const task = removeTaskLineFromFile(sourcePath, Number(lineIndex));
  const movedLine = formatTaskLine(task, target, { status: task.status === 'completed' ? 'pending' : task.status });
  const sectionMatchers = getSectionMatchersForTarget(target);
  if (sectionMatchers.length === 0) throw new Error('Unknown schedule target');
  insertTaskIntoSection(targetPath, sectionMatchers, movedLine, { prepend: true, createAtTop: true });
}

function reorderItem({ sourceKey, fromLineIndex, insertBeforeLineIndex, fromRawText }) {
  assertLegacyScheduleEnabled();
  const key = canonicalSourceKey(sourceKey);
  const filePath = getScheduleFile(key);
  if (!filePath) throw new Error('Unknown schedule source');
  reorderTaskInFile(filePath, Number(fromLineIndex), Number(insertBeforeLineIndex), fromRawText);
}

function restoreArchivedItem({ sourceKey, lineIndex }) {
  assertLegacyScheduleEnabled();
  const key = canonicalSourceKey(sourceKey);
  const targetPath = getScheduleFile(key);
  const archivePath = getArchiveFile(key);
  if (!targetPath || !archivePath) throw new Error('Unknown schedule source');
  const task = removeTaskLineFromFile(archivePath, Number(lineIndex));
  const restoredLine = formatTaskLine(task, key, { status: 'pending' });
  const sectionMatchers = getSectionMatchersForTarget(key);
  if (sectionMatchers.length === 0) throw new Error('Unknown schedule source');
  insertTaskIntoSection(targetPath, sectionMatchers, restoredLine);
}

module.exports = {
  getScheduleState,
  addItem, updateItemStatus, updateItemText, deleteItem,
  moveItem, reorderItem, restoreArchivedItem
};
