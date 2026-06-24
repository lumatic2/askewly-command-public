'use strict';

const {
  getCloudConfig,
  getTaskSource,
  loadWorkspaceContext,
  normalizeName,
  normalizeNullableText,
  request
} = require('./lib/askewly-cloud');
const { seedProjects } = require('./seed-project-context');

const VALID_SECTIONS = new Set(['today', 'deadlines', 'backlog']);
const VALID_STATUSES = new Set(['todo', 'doing', 'done', 'held', 'delayed', 'archived']);

function usage() {
  return [
    'Usage:',
    '  node scripts/askewly-command.js projects list [--json]',
    '  node scripts/askewly-command.js projects create --name NAME [--description TEXT] [--github-url URL] [--json]',
    '  node scripts/askewly-command.js projects seed [--dry-run|--live] [--file path]',
    '  node scripts/askewly-command.js tasks add --title TITLE [--section today|deadlines|backlog] [--detail TEXT] [--project NAME] [--status STATUS] [--due DATE] [--json]',
    '  node scripts/askewly-command.js tasks list [--section today|deadlines|backlog] [--status STATUS|active|all] [--project NAME] [--limit N] [--json]',
    '  node scripts/askewly-command.js tasks search --query TEXT [--section today|deadlines|backlog] [--status STATUS|active|all] [--project NAME] [--limit N] [--json]',
    '  node scripts/askewly-command.js tasks recent [--limit N] [--json]',
    '  node scripts/askewly-command.js tasks update --id ID [--title TITLE] [--detail TEXT] [--project NAME|--no-project] [--due DATE|--clear-due] [--json]',
    '  node scripts/askewly-command.js tasks move --id ID --section today|deadlines|backlog [--due DATE] [--scheduled-for YYYY-MM-DD] [--json]',
    '  node scripts/askewly-command.js tasks status --id ID --status todo|doing|done|held|delayed|archived [--json]',
    '',
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
    if (key === 'json' || key === 'dry-run' || key === 'live' || key === 'no-project' || key === 'clear-due' || key === 'help') {
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

function parseId(value, label) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new Error(`${label} must be a positive integer`);
  return id;
}

function assertSection(section) {
  if (!VALID_SECTIONS.has(section)) throw new Error(`Invalid section: ${section}`);
  return section;
}

function assertStatus(status) {
  if (!VALID_STATUSES.has(status)) throw new Error(`Invalid status: ${status}`);
  return status;
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
  if (row.name) return `${row.id}: ${row.name}${row.github_url ? ` <${row.github_url}>` : ''}`;
  return JSON.stringify(row);
}

function formatDateForRow(value) {
  return String(value || '').replace(/\.\d{3}Z$/, 'Z');
}

async function commandContext() {
  const cloudConfig = await getCloudConfig();
  const { workspace, profile } = await loadWorkspaceContext(cloudConfig);
  return { cloudConfig, workspace, profile };
}

async function listProjects(context) {
  return request(
    context.cloudConfig,
    `projects?select=id,name,description,github_url,status&workspace_id=eq.${context.workspace.id}&status=neq.archived&order=sort_order.asc&order=created_at.asc`
  );
}

async function findProjectByName(context, name) {
  if (!name) return null;
  const projects = await listProjects(context);
  const project = (projects || []).find((candidate) => normalizeName(candidate.name) === normalizeName(name));
  if (!project) throw new Error(`Project not found: ${name}`);
  return project;
}

async function createProject(context, flags) {
  const name = requireFlag(flags, 'name').trim();
  if (!name) throw new Error('Project name is required');
  const existing = (await listProjects(context)).find((project) => normalizeName(project.name) === normalizeName(name));
  if (existing) return existing;
  const created = await request(context.cloudConfig, 'projects', {
    method: 'POST',
    body: {
      workspace_id: context.workspace.id,
      name,
      description: normalizeNullableText(flags.description),
      github_url: normalizeNullableText(flags['github-url']),
      status: 'active',
      sort_order: Math.floor(Date.now() / 1000),
      created_by: context.profile.id,
      updated_by: context.profile.id
    }
  });
  return created?.[0];
}

async function getTask(context, id) {
  const tasks = await request(
    context.cloudConfig,
    `tasks?select=id,workspace_id,source_id,project_id,project_milestone_id,title,detail,status,due_at,scheduled_for,sort_order&workspace_id=eq.${context.workspace.id}&id=eq.${id}&limit=1`
  );
  const task = tasks?.[0];
  if (!task?.id) throw new Error(`Task not found: ${id}`);
  return task;
}

async function loadTaskSources(context) {
  const sources = await request(
    context.cloudConfig,
    `task_sources?select=id,key,kind,label&workspace_id=eq.${context.workspace.id}`
  );
  return sources || [];
}

async function listTasks(context, flags = {}) {
  const sources = await loadTaskSources(context);
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const sourceByKey = new Map(sources.map((source) => [source.key, source]));
  const section = flags.section ? assertSection(flags.section) : null;
  const project = await findProjectByName(context, flags.project);
  const limit = parseLimit(flags.limit, 20);
  const status = normalizeStatusFilter(flags.status || 'active');
  const searchQuery = flags.query !== undefined ? requireFlag(flags, 'query').trim() : null;

  let restPath = 'tasks?select=id,source_id,project_id,title,detail,status,due_at,scheduled_for,sort_order,created_at,updated_at,archived_at';
  restPath += `&workspace_id=eq.${context.workspace.id}`;
  if (section) restPath += `&source_id=eq.${sourceByKey.get(section)?.id || -1}`;
  if (project) restPath += `&project_id=eq.${project.id}`;
  if (status.mode === 'status') restPath += `&status=eq.${encodeURIComponent(status.value)}`;
  if (status.mode === 'active') restPath += '&status=neq.archived';
  if (searchQuery) {
    const escaped = escapeIlikeValue(searchQuery);
    restPath += `&or=(title.ilike.*${escaped}*,detail.ilike.*${escaped}*)`;
  }
  restPath += flags._order || '&order=source_id.asc&order=sort_order.asc&order=created_at.asc';
  restPath += `&limit=${limit}`;

  const tasks = await request(context.cloudConfig, restPath);
  return enrichTasks(context, tasks || [], sourceById);
}

async function recentTasks(context, flags = {}) {
  return listTasks(context, {
    ...flags,
    status: flags.status || 'active',
    _order: '&order=updated_at.desc&order=created_at.desc'
  });
}

async function enrichTasks(context, tasks, sourceById) {
  const projectIds = [...new Set(tasks.map((task) => task.project_id).filter(Boolean))];
  const projectById = new Map();
  if (projectIds.length) {
    const projects = await request(
      context.cloudConfig,
      `projects?select=id,name&workspace_id=eq.${context.workspace.id}&id=in.(${projectIds.join(',')})`
    );
    for (const project of projects || []) projectById.set(project.id, project);
  }
  return tasks.map((task) => ({
    ...task,
    section: sourceById.get(task.source_id)?.key || null,
    project_name: projectById.get(task.project_id)?.name || null
  }));
}

function parseLimit(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('--limit must be an integer between 1 and 100');
  return limit;
}

function normalizeStatusFilter(value) {
  const raw = String(value || 'active').trim();
  if (raw === 'all') return { mode: 'all' };
  if (raw === 'active') return { mode: 'active' };
  return { mode: 'status', value: assertStatus(raw) };
}

function escapeIlikeValue(value) {
  return encodeURIComponent(String(value).replace(/[%*]/g, ''));
}

async function nextSortOrder(context, sourceId) {
  const rows = await request(
    context.cloudConfig,
    `tasks?select=sort_order&workspace_id=eq.${context.workspace.id}&source_id=eq.${sourceId}&status=neq.archived&order=sort_order.desc&limit=1`
  );
  return Number(rows?.[0]?.sort_order || 0) + 10;
}

async function addTask(context, flags) {
  const title = requireFlag(flags, 'title').trim();
  if (!title) throw new Error('Task title is required');
  const section = assertSection(flags.section || 'today');
  const status = assertStatus(flags.status || 'todo');
  const source = await getTaskSource(context.cloudConfig, context.workspace.id, section);
  const project = await findProjectByName(context, flags.project);
  const created = await request(context.cloudConfig, 'tasks', {
    method: 'POST',
    body: {
      workspace_id: context.workspace.id,
      source_id: source.id,
      project_id: project?.id ?? null,
      title,
      detail: normalizeNullableText(flags.detail),
      status,
      sort_order: await nextSortOrder(context, source.id),
      created_by: context.profile.id,
      updated_by: context.profile.id,
      ...sectionDateFields(section, flags)
    }
  });
  return created?.[0];
}

async function updateTask(context, flags) {
  const id = parseId(requireFlag(flags, 'id'), 'Task id');
  await getTask(context, id);
  const patch = {};
  if (flags.title !== undefined) patch.title = requireFlag(flags, 'title').trim();
  if (flags.detail !== undefined) patch.detail = normalizeNullableText(flags.detail);
  if (flags['clear-due']) {
    patch.due_at = null;
  } else if (flags.due !== undefined || flags['due-at'] !== undefined) {
    patch.due_at = parseDueAt(flags.due || flags['due-at']);
  }
  if (flags['no-project']) {
    patch.project_id = null;
  } else if (flags.project !== undefined) {
    const project = await findProjectByName(context, flags.project);
    patch.project_id = project?.id ?? null;
  }
  if (Object.keys(patch).length === 0) throw new Error('No task update fields provided');
  const updated = await request(context.cloudConfig, `tasks?id=eq.${id}&workspace_id=eq.${context.workspace.id}`, {
    method: 'PATCH',
    body: {
      ...patch,
      updated_by: context.profile.id
    }
  });
  return updated?.[0];
}

async function moveTask(context, flags) {
  const id = parseId(requireFlag(flags, 'id'), 'Task id');
  const section = assertSection(requireFlag(flags, 'section'));
  await getTask(context, id);
  const source = await getTaskSource(context.cloudConfig, context.workspace.id, section);
  const updated = await request(context.cloudConfig, `tasks?id=eq.${id}&workspace_id=eq.${context.workspace.id}`, {
    method: 'PATCH',
    body: {
      source_id: source.id,
      sort_order: await nextSortOrder(context, source.id),
      updated_by: context.profile.id,
      ...sectionDateFields(section, flags)
    }
  });
  return updated?.[0];
}

async function setTaskStatus(context, flags) {
  const id = parseId(requireFlag(flags, 'id'), 'Task id');
  const status = assertStatus(requireFlag(flags, 'status'));
  await getTask(context, id);
  const updated = await request(context.cloudConfig, `tasks?id=eq.${id}&workspace_id=eq.${context.workspace.id}`, {
    method: 'PATCH',
    body: {
      status,
      archived_at: status === 'archived' ? new Date().toISOString() : undefined,
      updated_by: context.profile.id
    }
  });
  return updated?.[0];
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

function kstDateString(date = new Date()) {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
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

async function run(argv) {
  const [domain, action, ...rest] = argv;
  const flags = parseFlags(rest);
  if (!domain || flags.help || domain === '--help' || domain === '-h') {
    console.log(usage());
    return;
  }
  if (domain === 'projects' && action === 'seed') {
    await seedProjects({
      dryRun: flags.live ? false : true,
      file: flags.file
    });
    return;
  }

  const context = await commandContext();
  if (domain === 'projects' && action === 'list') {
    printResult(await listProjects(context), flags.json);
    return;
  }
  if (domain === 'projects' && action === 'create') {
    printResult(await createProject(context, flags), flags.json);
    return;
  }
  if (domain === 'tasks' && action === 'add') {
    printResult(await addTask(context, flags), flags.json);
    return;
  }
  if (domain === 'tasks' && action === 'list') {
    printResult(await listTasks(context, flags), flags.json);
    return;
  }
  if (domain === 'tasks' && action === 'search') {
    if (!flags.query) throw new Error('--query is required');
    printResult(await listTasks(context, flags), flags.json);
    return;
  }
  if (domain === 'tasks' && action === 'recent') {
    printResult(await recentTasks(context, flags), flags.json);
    return;
  }
  if (domain === 'tasks' && action === 'update') {
    printResult(await updateTask(context, flags), flags.json);
    return;
  }
  if (domain === 'tasks' && action === 'move') {
    printResult(await moveTask(context, flags), flags.json);
    return;
  }
  if (domain === 'tasks' && action === 'status') {
    printResult(await setTaskStatus(context, flags), flags.json);
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
