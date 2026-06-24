'use strict';

const fs = require('fs');
const path = require('path');
const { TASK_SOURCE_KEYS } = require('../shared/tasks');
const {
  buildDuplicateKey,
  loadLegacyActiveSchedule
} = require('../shared/legacy-schedule');

const DEFAULT_OUT = path.join(__dirname, '..', 'docs', 'artifacts', 'm8-import-plan.json');

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

function loadLocalEnv() {
  const envPath = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex <= 0) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function createClient() {
  const url = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const anonKey = String(process.env.SUPABASE_ANON_KEY || '').trim();
  const accessToken = String(getCommandEnv('SUPABASE_ACCESS_TOKEN') || '').trim();
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const bearer = accessToken || serviceRoleKey;
  if (!url || !anonKey || !bearer) {
    throw new Error('Missing SUPABASE_URL, SUPABASE_ANON_KEY, and either ASKEWLY_COMMAND_SUPABASE_ACCESS_TOKEN or SUPABASE_SERVICE_ROLE_KEY');
  }

  async function request(restPath, options = {}) {
    const response = await fetch(`${url}/rest/v1/${restPath}`, {
      method: options.method || 'GET',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${bearer}`,
        'Content-Type': 'application/json',
        Prefer: options.prefer || 'return=representation',
        ...(options.headers || {})
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Supabase REST ${response.status}: ${detail || response.statusText}`);
    }
    if (response.status === 204) return null;
    return response.json();
  }

  return { authMode: accessToken ? 'user-token' : 'service-role', request };
}

function hasCloudEnv() {
  return Boolean(
    String(process.env.SUPABASE_URL || '').trim()
    && String(process.env.SUPABASE_ANON_KEY || '').trim()
    && (
      String(getCommandEnv('SUPABASE_ACCESS_TOKEN') || '').trim()
      || String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
    )
  );
}

function hasUserToken() {
  return Boolean(String(getCommandEnv('SUPABASE_ACCESS_TOKEN') || '').trim());
}

function getCommandEnv(name) {
  return process.env[`ASKEWLY_COMMAND_${name}`] || process.env[`WORKSPACE_PULSE_${name}`] || '';
}

function hasExplicitTarget(args) {
  return Boolean(args['workspace-id'] || args['profile-email']);
}

function buildWorkspaceQuery(client, args) {
  if (args['workspace-id']) {
    return `workspaces?select=id,name,owner_id&owner_id=not.is.null&id=eq.${encodeURIComponent(args['workspace-id'])}&limit=1`;
  }
  if (client.authMode === 'service-role') {
    throw new Error('service-role import requires --workspace-id or --profile-email to choose the target workspace');
  }
  return 'workspaces?select=id,name,owner_id&order=created_at.asc&limit=1';
}

async function loadCloudContext(client, args = {}) {
  let workspaceQuery = buildWorkspaceQuery(client, args);
  if (args['profile-email']) {
    const profiles = await client.request(`profiles?select=id,email&email=eq.${encodeURIComponent(args['profile-email'])}&limit=1`);
    const profile = profiles && profiles[0];
    if (!profile) throw new Error(`No profile found for --profile-email ${args['profile-email']}`);
    workspaceQuery = `workspaces?select=id,name,owner_id&owner_id=eq.${encodeURIComponent(profile.id)}&limit=1`;
  }
  const workspaces = await client.request(workspaceQuery);
  const workspace = workspaces && workspaces[0];
  if (!workspace) throw new Error('No cloud workspace found for current token');

  const sources = await client.request(
    `task_sources?select=id,key,kind,label,sort_order&workspace_id=eq.${workspace.id}&order=sort_order.asc`
  );
  const sourceByKey = new Map(sources.map((source) => [source.key, source]));
  for (const key of [TASK_SOURCE_KEYS.TODAY, TASK_SOURCE_KEYS.DEADLINES, TASK_SOURCE_KEYS.BACKLOG]) {
    if (!sourceByKey.has(key)) throw new Error(`Missing cloud task source: ${key}`);
  }

  const existing = await client.request(
    `tasks?select=id,source_id,title,status,due_at,scheduled_for,archived_at&workspace_id=eq.${workspace.id}&order=created_at.asc`
  );
  const sourceKeyById = new Map(sources.map((source) => [source.id, source.key]));
  const duplicateKeys = new Map();
  for (const task of existing) {
    const sourceKey = sourceKeyById.get(task.source_id);
    if (!sourceKey) continue;
    const dateValue = task.due_at || task.scheduled_for || '';
    const key = buildDuplicateKey(sourceKey, task.title, dateValue);
    if (!duplicateKeys.has(key)) duplicateKeys.set(key, []);
    duplicateKeys.get(key).push(task.id);
  }

  return { workspace, sources, sourceByKey, existing, duplicateKeys };
}

function buildPlan(legacy, cloud) {
  const bySource = {
    today: legacy.today.length,
    deadlines: legacy.deadlines.length,
    backlog: legacy.backlog.length
  };
  const planned = [];
  const skippedDuplicates = [];
  const seenInPlan = new Map();

  for (const candidate of legacy.candidates) {
    const duplicateIds = cloud.duplicateKeys.get(candidate.duplicateKey) || [];
    const duplicateInPlan = seenInPlan.has(candidate.duplicateKey);
    if (duplicateIds.length > 0 || duplicateInPlan) {
      skippedDuplicates.push({
        sourceKey: candidate.sourceKey,
        title: candidate.title,
        duplicateKey: candidate.duplicateKey,
        existingTaskIds: duplicateIds,
        duplicateInPlan
      });
      continue;
    }
    seenInPlan.set(candidate.duplicateKey, candidate);
    planned.push(candidate);
  }

  return {
    generatedAt: new Date().toISOString(),
    mode: 'dry-run',
    legacy: {
      sourceMode: legacy.sourceMode,
      configPath: legacy.paths.configPath,
      schedulePath: legacy.paths.schedule,
      backlogPath: legacy.paths.backlog,
      importedScope: 'active Today/Deadlines/Backlog only; existing archive and recurring items excluded',
      counts: bySource
    },
    cloud: {
      workspaceId: cloud.workspace.id,
      workspaceName: cloud.workspace.name,
      authMode: cloud.authMode,
      existingTaskCount: cloud.existing.length,
      duplicateCheckSkipped: Boolean(cloud.duplicateCheckSkipped)
    },
    summary: {
      candidates: legacy.candidates.length,
      plannedInserts: planned.length,
      skippedDuplicates: skippedDuplicates.length
    },
    planned,
    skippedDuplicates
  };
}

async function applyPlan(client, cloud, plan) {
  const rows = plan.planned.map((candidate) => {
    const source = cloud.sourceByKey.get(candidate.sourceKey);
    return {
      workspace_id: cloud.workspace.id,
      source_id: source.id,
      title: candidate.title,
      detail: JSON.stringify({
        importedFrom: 'legacy-markdown',
        sourcePath: candidate.legacy.sourcePath,
        lineIndex: candidate.legacy.lineIndex,
        section: candidate.legacy.section,
        subsection: candidate.legacy.subsection,
        priority: candidate.legacy.priority
      }),
      status: candidate.status,
      due_at: candidate.dueAt,
      scheduled_for: candidate.scheduledFor,
      sort_order: candidate.sortOrder,
      created_by: cloud.workspace.owner_id,
      updated_by: cloud.workspace.owner_id
    };
  });

  if (rows.length === 0) return [];
  return client.request('tasks', { method: 'POST', body: rows });
}

function printSummary(plan) {
  console.log(`legacy source: ${plan.legacy.sourceMode}`);
  console.log(`workspace: ${plan.cloud.workspaceName} (${plan.cloud.workspaceId})`);
  console.log(`candidates: ${plan.summary.candidates}`);
  console.log(`planned inserts: ${plan.summary.plannedInserts}`);
  console.log(`skipped duplicates: ${plan.summary.skippedDuplicates}`);
}

async function main() {
  loadLocalEnv();
  const args = parseArgs(process.argv.slice(2));
  const apply = args.apply === true;
  const outPath = path.resolve(args.out || DEFAULT_OUT);
  const legacy = loadLegacyActiveSchedule({
    configPath: args.config,
    schedule: args.schedule,
    backlog: args.backlog,
    vaultRoot: args['vault-root']
  });
  if (apply && !hasCloudEnv()) {
    throw new Error('--apply requires SUPABASE_URL, SUPABASE_ANON_KEY, and a user token or service role key');
  }
  if (apply && !hasUserToken() && !hasExplicitTarget(args)) {
    throw new Error('--apply with service role requires --workspace-id or --profile-email');
  }
  const canUseCloud = hasCloudEnv() && (hasUserToken() || hasExplicitTarget(args));
  const client = canUseCloud ? createClient() : null;
  const cloud = client
    ? await loadCloudContext(client, args)
    : {
      workspace: { id: null, name: 'unavailable', owner_id: null },
      sources: [],
      sourceByKey: new Map(),
      existing: [],
      duplicateKeys: new Map(),
      authMode: 'offline',
      duplicateCheckSkipped: true
    };
  cloud.authMode = cloud.authMode || client?.authMode || 'unknown';
  const plan = buildPlan(legacy, cloud);

  if (apply) {
    const inserted = await applyPlan(client, cloud, plan);
    plan.mode = 'apply';
    plan.applied = {
      insertedTaskCount: inserted.length,
      insertedTaskIds: inserted.map((task) => task.id)
    };
  }

  ensureDir(outPath);
  fs.writeFileSync(outPath, JSON.stringify(plan, null, 2), 'utf8');
  printSummary(plan);
  if (apply) {
    console.log(`inserted: ${plan.applied.insertedTaskCount}`);
  } else {
    console.log('dry-run only; pass --apply to insert planned tasks');
  }
  console.log(`wrote ${outPath}`);
}

main().catch((error) => {
  console.error(`FAIL legacy schedule import: ${error.message}`);
  process.exit(1);
});
