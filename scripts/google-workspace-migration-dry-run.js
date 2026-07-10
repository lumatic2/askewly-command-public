#!/usr/bin/env node

const fs = require('fs');
const crypto = require('crypto');

const TABLE_ALIASES = {
  task_sources: ['task_sources', 'public.task_sources', 'public_task_sources'],
  tasks: ['tasks', 'public.tasks', 'public_tasks'],
  projects: ['projects', 'public.projects', 'public_projects'],
  project_milestones: ['project_milestones', 'public.project_milestones', 'public_project_milestones'],
  project_links: ['project_links', 'public.project_links', 'public_project_links']
};

const SECTION_TASKLISTS = {
  today: 'Askewly Today',
  deadlines: 'Askewly Deadlines',
  backlog: 'Askewly Backlog'
};

function usage() {
  return [
    'Usage:',
    '  node scripts/google-workspace-migration-dry-run.js --input export.json [--output dry-run.json] [--pretty]',
    '',
    'Reads a local Supabase export JSON file and emits a Google Workspace migration dry-run.',
    'No Supabase or Google API calls are performed.'
  ].join('\n');
}

function parseArgs(argv) {
  const flags = { pretty: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      flags.help = true;
    } else if (arg === '--pretty') {
      flags.pretty = true;
    } else if (arg === '--input' || arg === '-i') {
      flags.input = argv[++i];
    } else if (arg === '--output' || arg === '-o') {
      flags.output = argv[++i];
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return flags;
}

function readJson(filePath) {
  if (!filePath) throw new Error('--input is required');
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function pickTable(raw, table) {
  for (const key of TABLE_ALIASES[table]) {
    if (Array.isArray(raw?.[key])) return raw[key];
  }
  if (Array.isArray(raw?.tables?.[table])) return raw.tables[table];
  if (Array.isArray(raw?.public?.[table])) return raw.public[table];
  return [];
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function sourceHash(row) {
  return crypto.createHash('sha256').update(stableStringify(row)).digest('hex');
}

function idString(value) {
  if (value === null || value === undefined) return '';
  return String(value);
}

function isBlank(value) {
  return !String(value || '').trim();
}

function kstDateFromInstant(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function isDateOnlyKstDeadline(value) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return kst.getUTCHours() === 23
    && kst.getUTCMinutes() === 59
    && kst.getUTCSeconds() === 0;
}

function addMinutes(value, minutes) {
  const date = new Date(value);
  return new Date(date.getTime() + minutes * 60 * 1000).toISOString();
}

function makeKey(table, id) {
  return `askewly:${table}:${idString(id)}`;
}

function makeRecord({ table, row, operation = 'create', targetType, targetKey, payload, reason, warnings = [] }) {
  return {
    source_table: table,
    source_id: idString(row.id),
    source_hash: sourceHash(row),
    operation,
    target_type: targetType,
    target_key: targetKey,
    payload,
    reason,
    warnings,
    original: row
  };
}

function makeLedger(record, dryRun = true) {
  return {
    source_table: record.source_table,
    source_id: record.source_id,
    source_hash: record.source_hash,
    target_type: record.target_type,
    target_id: null,
    target_key: record.target_key,
    status: record.target_type === 'error' ? 'error' : 'planned',
    migrated_at: null,
    dry_run: dryRun
  };
}

function normalizeSourceMaps(taskSources) {
  const byId = new Map();
  const byKey = new Map();
  for (const source of taskSources) {
    if (source.id !== undefined && source.id !== null) byId.set(String(source.id), source);
    if (source.key) byKey.set(String(source.key), source);
  }
  return { byId, byKey };
}

function projectContext(row, projectsById, milestonesById) {
  const project = row.project_id ? projectsById.get(String(row.project_id)) || null : null;
  const milestone = row.project_milestone_id ? milestonesById.get(String(row.project_milestone_id)) || null : null;
  return { project, milestone };
}

function metadataLines({ table, row, source, project, milestone }) {
  return [
    `Askewly source: ${makeKey(table, row.id)}`,
    source?.key ? `Section: ${source.key}` : null,
    row.status ? `Original status: ${row.status}` : null,
    row.scheduled_for ? `Scheduled for: ${row.scheduled_for}` : null,
    row.due_at ? `Due at: ${row.due_at}` : null,
    project?.name ? `Project: ${project.name}` : null,
    milestone?.title ? `Milestone: ${milestone.title}` : null,
    row.detail ? '' : null,
    row.detail || null
  ].filter((line) => line !== null && line !== undefined).join('\n');
}

function classifyTask(row, context) {
  const { sourceById, projectsById, milestonesById } = context;
  const source = sourceById.get(String(row.source_id)) || null;
  const section = source?.key || row.section || null;
  const { project, milestone } = projectContext(row, projectsById, milestonesById);
  const targetKey = makeKey('tasks', row.id);
  const warnings = [];

  if (!row.id && row.id !== 0) {
    return makeRecord({
      table: 'tasks',
      row,
      operation: 'skip',
      targetType: 'error',
      targetKey: 'askewly:tasks:missing-id',
      payload: {},
      reason: 'task row is missing id',
      warnings: ['missing-id']
    });
  }

  if (isBlank(row.title)) {
    return makeRecord({
      table: 'tasks',
      row,
      operation: 'skip',
      targetType: 'error',
      targetKey,
      payload: {},
      reason: 'task title is blank',
      warnings: ['blank-title']
    });
  }

  if (!source && !section) warnings.push('missing-task-source');

  if (row.status === 'archived') {
    return makeRecord({
      table: 'tasks',
      row,
      operation: 'skip',
      targetType: 'ledger_only',
      targetKey,
      payload: { title: row.title, archived_at: row.archived_at || null },
      reason: 'archived task is preserved in ledger only',
      warnings
    });
  }

  if (row.status === 'done') {
    return makeRecord({
      table: 'tasks',
      row,
      operation: 'skip',
      targetType: 'ledger_only',
      targetKey,
      payload: { title: row.title, completed: true },
      reason: 'completed task defaults to ledger only to avoid clutter',
      warnings
    });
  }

  if (section === 'deadlines' && row.due_at && !isDateOnlyKstDeadline(row.due_at)) {
    return makeRecord({
      table: 'tasks',
      row,
      targetType: 'calendar_event',
      targetKey,
      payload: {
        calendar: 'primary',
        summary: row.title,
        description: metadataLines({ table: 'tasks', row, source, project, milestone }),
        start: { dateTime: row.due_at, timeZone: 'Asia/Seoul' },
        end: { dateTime: addMinutes(row.due_at, 30), timeZone: 'Asia/Seoul' }
      },
      reason: 'deadline has an explicit time and should be calendar-native',
      warnings
    });
  }

  const tasklist = SECTION_TASKLISTS[section] || 'Askewly Backlog';
  const due = row.scheduled_for || kstDateFromInstant(row.due_at) || null;
  const payload = {
    tasklist,
    title: row.title,
    notes: metadataLines({ table: 'tasks', row, source, project, milestone }),
    status: 'needsAction'
  };
  if (due) payload.due = due;
  if (section === 'deadlines' && row.due_at) payload.calendar_candidate = true;

  return makeRecord({
    table: 'tasks',
    row,
    targetType: 'google_task',
    targetKey,
    payload,
    reason: `${section || 'unknown'} active task`,
    warnings
  });
}

function ledgerOnlyRecord(table, row, reason) {
  return makeRecord({
    table,
    row,
    operation: 'skip',
    targetType: 'ledger_only',
    targetKey: makeKey(table, row.id),
    payload: row,
    reason,
    warnings: []
  });
}

function buildDryRun(raw, options = {}) {
  const taskSources = pickTable(raw, 'task_sources');
  const tasks = pickTable(raw, 'tasks');
  const projects = pickTable(raw, 'projects');
  const projectMilestones = pickTable(raw, 'project_milestones');
  const projectLinks = pickTable(raw, 'project_links');

  const sourceMaps = normalizeSourceMaps(taskSources);
  const projectsById = new Map(projects.map((project) => [String(project.id), project]));
  const milestonesById = new Map(projectMilestones.map((milestone) => [String(milestone.id), milestone]));

  const records = [
    ...taskSources.map((row) => ledgerOnlyRecord('task_sources', row, 'task source metadata is preserved in ledger')),
    ...projects.map((row) => ledgerOnlyRecord('projects', row, 'project metadata is preserved in ledger')),
    ...projectMilestones.map((row) => ledgerOnlyRecord('project_milestones', row, 'project milestone metadata is preserved in ledger')),
    ...projectLinks.map((row) => ledgerOnlyRecord('project_links', row, 'project link metadata is preserved in ledger')),
    ...tasks.map((row) => classifyTask(row, {
      sourceById: sourceMaps.byId,
      sourceByKey: sourceMaps.byKey,
      projectsById,
      milestonesById
    }))
  ];

  const errors = records.filter((record) => record.target_type === 'error').map((record) => ({
    source_table: record.source_table,
    source_id: record.source_id,
    target_key: record.target_key,
    reason: record.reason,
    warnings: record.warnings
  }));

  const counts = {
    tasks: tasks.length,
    projects: projects.length,
    project_milestones: projectMilestones.length,
    project_links: projectLinks.length,
    google_tasks: records.filter((record) => record.target_type === 'google_task').length,
    calendar_events: records.filter((record) => record.target_type === 'calendar_event').length,
    ledger_only: records.filter((record) => record.target_type === 'ledger_only').length,
    skipped: records.filter((record) => record.operation === 'skip').length,
    errors: errors.length
  };

  return {
    exported_at: options.exportedAt || new Date().toISOString(),
    source: {
      kind: 'supabase_export',
      project_ref: raw?.source?.project_ref || raw?.project_ref || null,
      workspace_id: raw?.source?.workspace_id || raw?.workspace_id || null,
      input_file: options.inputFile || null
    },
    counts,
    records,
    ledger: records.map((record) => makeLedger(record)),
    errors
  };
}

function main(argv = process.argv.slice(2)) {
  const flags = parseArgs(argv);
  if (flags.help) {
    console.log(usage());
    return 0;
  }
  const raw = readJson(flags.input);
  const dryRun = buildDryRun(raw, { inputFile: flags.input });
  const text = JSON.stringify(dryRun, null, flags.pretty ? 2 : 0);
  if (flags.output) {
    fs.writeFileSync(flags.output, `${text}\n`);
  } else {
    console.log(text);
  }
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`dry-run mapper failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  buildDryRun,
  classifyTask,
  pickTable,
  stableStringify
};
