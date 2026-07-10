'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const SECTION_LISTS = {
  today: 'Askewly Today',
  deadlines: 'Askewly Deadlines',
  backlog: 'Askewly Backlog'
};

const LIST_SECTIONS = Object.fromEntries(Object.entries(SECTION_LISTS).map(([key, value]) => [value, key]));
const ASKEWLY_META_START = '--- Askewly metadata ---';

function gwsCommand() {
  if (process.env.GWS_BIN) return process.env.GWS_BIN;
  if (process.platform === 'win32' && process.env.APPDATA) {
    const installedExe = path.join(process.env.APPDATA, 'npm', 'node_modules', '@googleworkspace', 'cli', 'bin', 'gws.exe');
    if (fs.existsSync(installedExe)) return installedExe;
  }
  return 'gws';
}

function runGws(args) {
  const result = spawnSync(gwsCommand(), args, { encoding: 'utf8' });
  const stdout = String(result.stdout || '').trim();
  const stderr = String(result.stderr || '').trim();
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(stdout || stderr || `gws exited ${result.status}`);
  return stdout ? JSON.parse(stdout) : {};
}

function kstDateString(date = new Date()) {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function kstLocalToIso(localDateTime) {
  const parsed = new Date(`${localDateTime}+09:00`);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid KST datetime: ${localDateTime}`);
  return parsed.toISOString();
}

function parseDueAt(value) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('--due requires a date or datetime');
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return kstLocalToIso(`${raw}T23:59:00`);
  const withTime = raw.replace(' ', 'T');
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(withTime)) return kstLocalToIso(`${withTime}:00`);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(withTime)) return kstLocalToIso(withTime);
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid --due value: ${value}`);
  return parsed.toISOString();
}

function toTaskDue(value) {
  if (!value) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T00:00:00.000Z`;
  return value;
}

function parseScheduleDate(value) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) throw new Error('--scheduled-for must be YYYY-MM-DD');
  return normalized;
}

function metadataBlock(values) {
  const lines = [
    ASKEWLY_META_START,
    `section: ${values.section}`,
    `status: ${values.status}`,
    values.project ? `project: ${values.project}` : null,
    values.scheduled_for ? `scheduled_for: ${values.scheduled_for}` : null,
    values.due_at ? `due_at: ${values.due_at}` : null
  ].filter(Boolean);
  return lines.join('\n');
}

function stripMetadata(notes = '') {
  return String(notes || '').split(ASKEWLY_META_START)[0].trim();
}

function parseMetadata(notes = '') {
  const text = String(notes || '');
  const index = text.indexOf(ASKEWLY_META_START);
  if (index < 0) return {};
  const meta = {};
  for (const line of text.slice(index + ASKEWLY_META_START.length).split(/\r?\n/)) {
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (match) meta[match[1].trim()] = match[2].trim();
  }
  return meta;
}

function notesWithMetadata(detail, values) {
  const body = String(detail || '').trim();
  return [body, metadataBlock(values)].filter(Boolean).join('\n\n');
}

function googleStatus(status) {
  return status === 'done' || status === 'archived' ? 'completed' : 'needsAction';
}

function normalizeStatusFilter(value) {
  const raw = String(value || 'active').trim();
  if (raw === 'all') return { mode: 'all' };
  if (raw === 'active') return { mode: 'active' };
  return { mode: 'status', value: raw };
}

function sectionDateFields(section, flags = {}) {
  if (section === 'today') {
    return {
      scheduled_for: parseScheduleDate(flags['scheduled-for']) || kstDateString(),
      due_at: flags.due || flags['due-at'] ? parseDueAt(flags.due || flags['due-at']) : null
    };
  }
  if (section === 'deadlines') {
    return {
      scheduled_for: null,
      due_at: flags.due || flags['due-at'] ? parseDueAt(flags.due || flags['due-at']) : new Date().toISOString()
    };
  }
  return { scheduled_for: null, due_at: null };
}

function taskBody(flags, section, prior = {}) {
  const dates = sectionDateFields(section, flags);
  const status = flags.status || prior.status || 'todo';
  const detail = flags.detail !== undefined ? flags.detail : prior.detail || '';
  const due = section === 'deadlines' ? dates.due_at : dates.scheduled_for;
  const body = {
    title: flags.title || prior.title,
    notes: notesWithMetadata(detail, {
      section,
      status,
      project: flags.project || prior.project_name || null,
      scheduled_for: dates.scheduled_for || prior.scheduled_for || null,
      due_at: dates.due_at || prior.due_at || null
    }),
    status: googleStatus(status)
  };
  const taskDue = toTaskDue(due);
  if (taskDue) body.due = taskDue;
  return body;
}

function listTaskLists(gws = runGws) {
  const response = gws(['tasks', 'tasklists', 'list', '--format', 'json']);
  return response.items || [];
}

function ensureTaskList(section, gws = runGws) {
  const title = SECTION_LISTS[section];
  const existing = listTaskLists(gws).find((item) => item.title === title);
  if (existing?.id) return existing;
  return gws(['tasks', 'tasklists', 'insert', '--json', JSON.stringify({ title }), '--format', 'json']);
}

function listGoogleTasksInList(tasklist, options = {}, gws = runGws) {
  const params = {
    tasklist: tasklist.id,
    maxResults: Math.max(1, Math.min(Number(options.limit || 100), 100)),
    showCompleted: options.showCompleted === true,
    showHidden: options.showCompleted === true
  };
  const response = gws(['tasks', 'tasks', 'list', '--params', JSON.stringify(params), '--format', 'json']);
  return response.items || [];
}

// M69 importer wrote human-readable "Due at: <iso>" lines instead of the
// M68 metadata block; fall back to that, then to Google's native due field.
function importerDueAt(notes = '') {
  const match = String(notes || '').match(/^Due at:\s*(\S+)/m);
  return match ? match[1] : null;
}

// Some M69-imported rows carry an epoch-zero Google due (source row had no
// real due date) — treat anything before 2000 as absent.
function sanitizeDue(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.getUTCFullYear() < 2000) return null;
  return value;
}

function rowFromGoogleTask(task, tasklist) {
  const meta = parseMetadata(task.notes);
  const section = meta.section || LIST_SECTIONS[tasklist.title] || null;
  const status = meta.status || (task.status === 'completed' ? 'done' : 'todo');
  return {
    id: task.id,
    title: task.title,
    detail: stripMetadata(task.notes),
    status,
    due_at: sanitizeDue(meta.due_at || importerDueAt(task.notes) || task.due),
    scheduled_for: meta.scheduled_for || null,
    section,
    project_name: meta.project || null,
    tasklist_id: tasklist.id,
    tasklist_title: tasklist.title,
    updated_at: task.updated || null
  };
}

function matchesStatus(row, filter) {
  if (filter.mode === 'all') return true;
  if (filter.mode === 'active') return row.status !== 'done' && row.status !== 'archived';
  return row.status === filter.value;
}

function matchesQuery(row, query) {
  if (!query) return true;
  const needle = String(query).toLowerCase();
  return [row.title, row.detail, row.project_name].some((value) => String(value || '').toLowerCase().includes(needle));
}

function listTasks(flags = {}, gws = runGws) {
  const status = normalizeStatusFilter(flags.status || 'active');
  const sections = flags.section ? [flags.section] : Object.keys(SECTION_LISTS);
  const limit = Math.max(1, Math.min(Number(flags.limit || 20), 100));
  const rows = [];
  for (const section of sections) {
    const tasklist = ensureTaskList(section, gws);
    const tasks = listGoogleTasksInList(tasklist, { limit: 100, showCompleted: status.mode !== 'active' }, gws);
    rows.push(...tasks.map((task) => rowFromGoogleTask(task, tasklist)));
  }
  return rows
    .filter((row) => matchesStatus(row, status))
    .filter((row) => !flags.project || String(row.project_name || '').toLowerCase() === String(flags.project).toLowerCase())
    .filter((row) => matchesQuery(row, flags.query))
    .slice(0, limit);
}

function findTask(id, gws = runGws) {
  for (const section of Object.keys(SECTION_LISTS)) {
    const tasklist = ensureTaskList(section, gws);
    const tasks = listGoogleTasksInList(tasklist, { limit: 100, showCompleted: true }, gws);
    const task = tasks.find((candidate) => candidate.id === id);
    if (task) return { task, tasklist, row: rowFromGoogleTask(task, tasklist) };
  }
  throw new Error(`Task not found: ${id}`);
}

function addTask(flags, gws = runGws) {
  const section = flags.section || 'today';
  const tasklist = ensureTaskList(section, gws);
  const created = gws([
    'tasks', 'tasks', 'insert',
    '--params', JSON.stringify({ tasklist: tasklist.id }),
    '--json', JSON.stringify(taskBody(flags, section)),
    '--format', 'json'
  ]);
  return rowFromGoogleTask(created, tasklist);
}

function patchTask(id, tasklistId, body, gws = runGws) {
  return gws([
    'tasks', 'tasks', 'patch',
    '--params', JSON.stringify({ tasklist: tasklistId, task: id }),
    '--json', JSON.stringify(body),
    '--format', 'json'
  ]);
}

function updateTask(flags, gws = runGws) {
  const found = findTask(flags.id, gws);
  const body = {};
  if (flags.title !== undefined) body.title = flags.title;
  if (flags.detail !== undefined || flags.project !== undefined || flags.due !== undefined || flags['due-at'] !== undefined || flags['clear-due']) {
    const section = found.row.section || LIST_SECTIONS[found.tasklist.title] || 'backlog';
    const prior = {
      ...found.row,
      due_at: flags['clear-due'] ? null : found.row.due_at,
      detail: flags.detail !== undefined ? flags.detail : found.row.detail,
      project_name: flags['no-project'] ? null : flags.project || found.row.project_name
    };
    const nextFlags = {
      ...flags,
      title: flags.title || found.row.title,
      detail: prior.detail,
      project: prior.project_name || undefined
    };
    body.notes = taskBody(nextFlags, section, prior).notes;
    if (flags['clear-due']) body.due = null;
    else if (flags.due !== undefined || flags['due-at'] !== undefined) body.due = toTaskDue(parseDueAt(flags.due || flags['due-at']));
  }
  if (!Object.keys(body).length) throw new Error('No task update fields provided');
  const updated = patchTask(found.task.id, found.tasklist.id, body, gws);
  return rowFromGoogleTask(updated, found.tasklist);
}

function deleteTask(tasklistId, taskId, gws = runGws) {
  gws(['tasks', 'tasks', 'delete', '--params', JSON.stringify({ tasklist: tasklistId, task: taskId }), '--format', 'json']);
}

function moveTask(flags, gws = runGws) {
  const found = findTask(flags.id, gws);
  const section = flags.section;
  const targetList = ensureTaskList(section, gws);
  const body = taskBody({
    title: found.row.title,
    detail: found.row.detail,
    project: found.row.project_name || undefined,
    status: found.row.status,
    due: flags.due || flags['due-at'],
    'scheduled-for': flags['scheduled-for']
  }, section, found.row);
  const created = gws([
    'tasks', 'tasks', 'insert',
    '--params', JSON.stringify({ tasklist: targetList.id }),
    '--json', JSON.stringify(body),
    '--format', 'json'
  ]);
  deleteTask(found.tasklist.id, found.task.id, gws);
  return rowFromGoogleTask(created, targetList);
}

function setTaskStatus(flags, gws = runGws) {
  const found = findTask(flags.id, gws);
  const body = taskBody({
    title: found.row.title,
    detail: found.row.detail,
    project: found.row.project_name || undefined,
    status: flags.status
  }, found.row.section || 'backlog', found.row);
  const updated = patchTask(found.task.id, found.tasklist.id, {
    notes: body.notes,
    status: googleStatus(flags.status)
  }, gws);
  return rowFromGoogleTask(updated, found.tasklist);
}

module.exports = {
  SECTION_LISTS,
  addTask,
  listTasks,
  moveTask,
  setTaskStatus,
  updateTask,
  parseMetadata,
  rowFromGoogleTask,
  taskBody
};
