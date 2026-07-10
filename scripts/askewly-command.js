'use strict';

const googleTasks = require('./lib/google-workspace-tasks');
const googleCatalog = require('./lib/google-workspace-catalog');

const VALID_SECTIONS = new Set(['today', 'deadlines', 'backlog']);
const VALID_STATUSES = new Set(['todo', 'doing', 'done', 'held', 'delayed', 'archived']);
const VALID_PROJECT_STATUSES = new Set(['active', 'paused', 'archived']);

const REMOVED_COMMANDS = new Map([
  ['auth', 'Supabase desktop auth was decommissioned (M74, 2026-07-10). Google auth uses the gws token cache; no CLI auth step is needed.'],
  ['projects seed', 'Supabase-only `projects seed` was removed (M74, 2026-07-10). Manage the catalog with projects create/update on the Google Sheets backend.']
]);

function usage() {
  return [
    'Usage:',
    '  node scripts/askewly-command.js projects list [--status active|paused|archived|all] [--pinned] [--json]',
    '  node scripts/askewly-command.js projects show (--name NAME|--id ID) [--json]',
    '  node scripts/askewly-command.js projects create --name NAME [--description TEXT] [--github-url URL] [--objective TEXT] [--horizon TEXT] [--roadmap-note TEXT] [--pinned] [--json]',
    '  node scripts/askewly-command.js projects update (--name NAME|--id ID) [--new-name NAME] [--description TEXT] [--github-url URL] [--objective TEXT] [--horizon TEXT] [--roadmap-note TEXT] [--status active|paused|archived] [--json]',
    '  node scripts/askewly-command.js projects pin|unpin|archive (--name NAME|--id ID) [--json]',
    '  node scripts/askewly-command.js tasks add --title TITLE [--section today|deadlines|backlog] [--detail TEXT] [--project NAME] [--status STATUS] [--due DATE] [--json]',
    '  node scripts/askewly-command.js tasks list [--section today|deadlines|backlog] [--status STATUS|active|all] [--project NAME] [--limit N] [--json]',
    '  node scripts/askewly-command.js tasks search --query TEXT [--section today|deadlines|backlog] [--status STATUS|active|all] [--project NAME] [--limit N] [--json]',
    '  node scripts/askewly-command.js tasks recent [--limit N] [--json]',
    '  node scripts/askewly-command.js tasks update --id ID [--title TITLE] [--detail TEXT] [--project NAME|--no-project] [--due DATE|--clear-due] [--json]',
    '  node scripts/askewly-command.js tasks move --id ID --section today|deadlines|backlog [--due DATE] [--scheduled-for YYYY-MM-DD] [--json]',
    '  node scripts/askewly-command.js tasks status --id ID --status todo|doing|done|held|delayed|archived [--json]',
    '',
    'Backend: Google Workspace only (Tasks + Calendar + Sheets catalog). Supabase paths were removed in M74.',
    'Natural language belongs to the agent. This CLI accepts explicit validated command payloads only.'
  ].join('\n');
}

function parseFlags(argv) {
  const flags = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) {
      flags._.push(value);
      continue;
    }
    const key = value.slice(2);
    if (key === 'json' || key === 'no-project' || key === 'clear-due' || key === 'help' || key === 'pinned') {
      flags[key] = true;
      continue;
    }
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) throw new Error(`Missing value for --${key}`);
    flags[key] = next;
    index += 1;
  }
  return flags;
}

function requireFlag(flags, name) {
  const value = flags[name];
  if (value === undefined || value === '') throw new Error(`--${name} is required`);
  return String(value);
}

function assertSection(section) {
  if (!VALID_SECTIONS.has(section)) throw new Error(`Invalid section: ${section}`);
  return section;
}

function assertStatus(status) {
  if (!VALID_STATUSES.has(status)) throw new Error(`Invalid status: ${status}`);
  return status;
}

function assertProjectStatus(status) {
  if (!VALID_PROJECT_STATUSES.has(status)) throw new Error(`Invalid project status: ${status}`);
  return status;
}

function requireTaskId(flags) {
  const id = requireFlag(flags, 'id').trim();
  if (!id) throw new Error('Task id is required');
  return id;
}

function normalizeNullableText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

function printResult(value, json) {
  if (json) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  if (Array.isArray(value)) {
    for (const row of value) console.log(formatRow(row));
    return;
  }
  console.log(formatRow(value));
}

function formatRow(row) {
  if (!row || typeof row !== 'object') return String(row);
  if (row.title) {
    const meta = [
      row.section || null,
      row.status || null,
      row.project_name ? `project=${row.project_name}` : null,
      row.due_at ? `due=${formatDateForRow(row.due_at)}` : null,
      row.scheduled_for ? `scheduled=${row.scheduled_for}` : null
    ].filter(Boolean).join(' · ');
    return `${row.id}: ${row.title}${meta ? ` [${meta}]` : ''}`;
  }
  if (row.name) {
    const meta = [
      row.status || null,
      isProjectPinned(row) ? 'pinned' : null,
      row.current_horizon ? `horizon=${row.current_horizon}` : null
    ].filter(Boolean).join(' · ');
    return `${row.id}: ${isProjectPinned(row) ? '* ' : ''}${row.name}${meta ? ` [${meta}]` : ''}${row.github_url ? ` <${row.github_url}>` : ''}`;
  }
  return JSON.stringify(row);
}

function formatDateForRow(value) {
  return String(value || '').replace(/\.\d{3}Z$/, 'Z');
}

function isProjectPinned(project) {
  return Number(project?.sort_order || 0) < 0;
}

function parseLimit(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('--limit must be an integer between 1 and 100');
  return limit;
}

function validateGoogleTaskPayload(action, flags) {
  if (flags.section !== undefined) assertSection(flags.section);
  if (flags.status !== undefined && !['active', 'all'].includes(String(flags.status))) assertStatus(flags.status);
  if (flags.limit !== undefined) parseLimit(flags.limit, 20);
  if (flags.due !== undefined || flags['due-at'] !== undefined) parseDueAt(flags.due || flags['due-at']);
  if (flags['scheduled-for'] !== undefined) parseScheduleDate(flags['scheduled-for']);
  if (action === 'add') {
    const title = requireFlag(flags, 'title').trim();
    if (!title) throw new Error('Task title is required');
  }
  if (action === 'search') {
    const query = requireFlag(flags, 'query').trim();
    if (!query) throw new Error('--query is required');
  }
  if (['update', 'move', 'status'].includes(action)) requireTaskId(flags);
  if (action === 'move') assertSection(requireFlag(flags, 'section'));
  if (action === 'status') assertStatus(requireFlag(flags, 'status'));
}

function runGoogleTaskCommand(action, flags) {
  validateGoogleTaskPayload(action, flags);
  if (action === 'add') return googleTasks.addTask(flags);
  if (action === 'list') return googleTasks.listTasks(flags);
  if (action === 'search') return googleTasks.listTasks(flags);
  if (action === 'recent') return googleTasks.listTasks({ ...flags, status: flags.status || 'active' });
  if (action === 'update') return googleTasks.updateTask(flags);
  if (action === 'move') return googleTasks.moveTask(flags);
  if (action === 'status') return googleTasks.setTaskStatus(flags);
  throw new Error(`Unknown command: tasks ${action}`);
}

function validateGoogleProjectSelector(flags) {
  if (flags.id !== undefined && flags.id !== null && String(flags.id).trim() !== '') return;
  requireFlag(flags, 'name');
}

function validateGoogleProjectPayload(action, flags) {
  if (flags.status && flags.status !== 'all') assertProjectStatus(flags.status);
  if (['show', 'update', 'pin', 'unpin', 'archive'].includes(action)) validateGoogleProjectSelector(flags);
  if (action === 'create') requireFlag(flags, 'name');
  if (action === 'update' && flags.status) assertProjectStatus(flags.status);
}

function projectObjectiveFlag(flags) {
  return flags.objective !== undefined ? flags.objective : flags['north-star'];
}

function buildGoogleProjectPatch(flags) {
  const patch = {};
  if (flags['new-name'] !== undefined) {
    const nextName = String(flags['new-name']).trim();
    if (!nextName) throw new Error('--new-name cannot be empty');
    patch.name = nextName;
  }
  if (flags.description !== undefined) patch.description = normalizeNullableText(flags.description);
  if (flags['github-url'] !== undefined) patch.github_url = normalizeNullableText(flags['github-url']);
  if (projectObjectiveFlag(flags) !== undefined) patch.north_star = normalizeNullableText(projectObjectiveFlag(flags));
  if (flags.horizon !== undefined) patch.current_horizon = normalizeNullableText(flags.horizon);
  if (flags['roadmap-note'] !== undefined) patch.roadmap_note = normalizeNullableText(flags['roadmap-note']);
  if (flags.status !== undefined) {
    const status = assertProjectStatus(flags.status);
    patch.status = status;
    patch.archived_at = status === 'archived' ? new Date().toISOString() : null;
  }
  return patch;
}

function runGoogleProjectCommand(action, flags) {
  validateGoogleProjectPayload(action, flags);
  if (action === 'list') {
    const projects = googleCatalog.listProjects({ status: flags.status });
    return flags.pinned ? projects.filter((project) => Number(project.sort_order || 0) < 0) : projects;
  }
  if (action === 'show') {
    return googleCatalog.showProject({ name: flags.name, id: flags.id });
  }
  if (action === 'create') {
    return googleCatalog.createProject({
      name: requireFlag(flags, 'name').trim(),
      description: normalizeNullableText(flags.description),
      github_url: normalizeNullableText(flags['github-url']),
      north_star: normalizeNullableText(projectObjectiveFlag(flags)),
      current_horizon: normalizeNullableText(flags.horizon),
      roadmap_note: normalizeNullableText(flags['roadmap-note']),
      pinned: Boolean(flags.pinned)
    });
  }
  if (action === 'update') {
    const patch = buildGoogleProjectPatch(flags);
    if (Object.keys(patch).length === 0) throw new Error('No project fields to update');
    return googleCatalog.updateProject({ name: flags.name, id: flags.id }, patch);
  }
  if (action === 'pin') {
    return googleCatalog.setProjectPinned({ name: flags.name, id: flags.id }, true);
  }
  if (action === 'unpin') {
    return googleCatalog.setProjectPinned({ name: flags.name, id: flags.id }, false);
  }
  if (action === 'archive') {
    return googleCatalog.archiveProject({ name: flags.name, id: flags.id });
  }
  throw new Error(`Unknown command: projects ${action}`);
}

function parseScheduleDate(value) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error('--scheduled-for must be YYYY-MM-DD');
  }
  return normalized;
}

function parseDueAt(value) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('--due requires a date or datetime');
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return kstLocalToIso(`${raw}T23:59:00`);
  }
  const withTime = raw.replace(' ', 'T');
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(withTime)) {
    return kstLocalToIso(`${withTime}:00`);
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(withTime)) {
    return kstLocalToIso(withTime);
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid --due value: ${value}`);
  return parsed.toISOString();
}

function kstLocalToIso(localDateTime) {
  const parsed = new Date(`${localDateTime}+09:00`);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid KST datetime: ${localDateTime}`);
  return parsed.toISOString();
}

function removedCommandMessage(domain, action) {
  if (REMOVED_COMMANDS.has(domain)) return REMOVED_COMMANDS.get(domain);
  const key = [domain, action].filter(Boolean).join(' ');
  if (REMOVED_COMMANDS.has(key)) return REMOVED_COMMANDS.get(key);
  return null;
}

async function run(argv) {
  const [domain, action, ...rest] = argv;
  const removed = removedCommandMessage(domain, action);
  if (removed) throw new Error(removed);
  const flags = parseFlags(rest);
  if (!domain || flags.help || domain === '--help' || domain === '-h') {
    console.log(usage());
    return;
  }
  if (domain === 'tasks') {
    printResult(runGoogleTaskCommand(action, flags), flags.json);
    return;
  }
  if (domain === 'projects') {
    printResult(runGoogleProjectCommand(action, flags), flags.json);
    return;
  }
  throw new Error(`Unknown command: ${[domain, action].filter(Boolean).join(' ')}`);
}

if (require.main === module) {
  run(process.argv.slice(2)).catch((error) => {
    console.error(`FAIL askewly command: ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  run
};
