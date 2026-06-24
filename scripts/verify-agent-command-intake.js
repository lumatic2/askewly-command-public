'use strict';

const { execFileSync } = require('child_process');
const path = require('path');
const { getCloudConfig, getTaskSource, loadWorkspaceContext, request } = require('./lib/askewly-cloud');
const { loadSeed, seedProjects } = require('./seed-project-context');

const ROOT = path.join(__dirname, '..');
const SEED_PATH = path.join(ROOT, 'data', 'project-context-seed.json');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function runNode(args) {
  return execFileSync(process.execPath, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

async function verifyDryRun() {
  const seed = loadSeed(SEED_PATH);
  assert(seed.length >= 10, 'Expected at least 10 project seed candidates');
  for (const project of seed) {
    assert(project.name, 'Seed project name is required');
    assert(project.description, `Seed description is required for ${project.name}`);
    assert(Object.keys(project).every((key) => ['name', 'description', 'github_url'].includes(key)), `Unexpected seed field on ${project.name}`);
  }

  const help = runNode(['scripts/askewly-command.js', '--help']);
  assert(help.includes('projects list'), 'CLI help missing projects list');
  assert(help.includes('tasks add'), 'CLI help missing tasks add');
  assert(help.includes('tasks list'), 'CLI help missing tasks list');
  assert(help.includes('tasks search'), 'CLI help missing tasks search');
  assert(help.includes('tasks recent'), 'CLI help missing tasks recent');

  const dryRun = await seedProjects({ dryRun: true, file: SEED_PATH });
  assert(dryRun.dryRun === true, 'Seed dry-run did not report dryRun');
  assert(dryRun.unchanged === seed.length, 'Seed dry-run candidate count mismatch');
  console.log(`agent intake dry-run ok: ${seed.length} seed candidates`);
}

async function verifyLiveIfAvailable() {
  let cloudConfig = null;
  try {
    cloudConfig = await getCloudConfig();
  } catch (error) {
    console.log(`agent intake live skipped: ${error.message}`);
    return { skipped: true, reason: error.message };
  }

  const { workspace, profile } = await loadWorkspaceContext(cloudConfig);
  await seedProjects({ dryRun: false, file: SEED_PATH });

  const projects = await request(
    cloudConfig,
    `projects?select=id,name,status&workspace_id=eq.${workspace.id}&status=neq.archived`
  );
  const names = new Set((projects || []).map((project) => project.name));
  for (const requiredName of ['Askewly Command', 'custom-skills', 'toolshelf']) {
    assert(names.has(requiredName), `Live projects missing ${requiredName}`);
  }

  const askewlyProject = (projects || []).find((project) => project.name === 'Askewly Command');
  assert(askewlyProject?.id, 'Askewly Command project missing id');
  const backlog = await getTaskSource(cloudConfig, workspace.id, 'backlog');
  const created = await request(cloudConfig, 'tasks', {
    method: 'POST',
    body: {
      workspace_id: workspace.id,
      source_id: backlog.id,
      project_id: askewlyProject.id,
      title: `M51 verifier ${Date.now()}`,
      detail: 'temporary agent command intake verifier task',
      status: 'todo',
      sort_order: Math.floor(Date.now() / 1000),
      created_by: profile.id,
      updated_by: profile.id
    }
  });
  const task = created?.[0];
  assert(task?.id, 'Verifier task insert failed');
  assert(task.project_id === askewlyProject.id, 'Verifier task did not link to seeded project');

  await request(cloudConfig, `tasks?id=eq.${task.id}&workspace_id=eq.${workspace.id}`, {
    method: 'PATCH',
    prefer: 'return=minimal',
    body: {
      status: 'archived',
      archived_at: new Date().toISOString(),
      updated_by: profile.id
    }
  });
  console.log(`agent intake live ok: project_count=${projects.length} verifier_task=${task.id}`);

  const dueOutput = runNode([
    'scripts/askewly-command.js',
    'tasks',
    'add',
    '--title',
    `M51 due verifier ${Date.now()}`,
    '--section',
    'deadlines',
    '--project',
    'Askewly Command',
    '--due',
    '2026-06-25 18:00',
    '--json'
  ]);
  const dueTask = JSON.parse(dueOutput);
  assert(dueTask.due_at === '2026-06-25T09:00:00+00:00' || dueTask.due_at === '2026-06-25T09:00:00.000Z', 'CLI due datetime did not normalize to expected UTC time');
  const listOutput = runNode([
    'scripts/askewly-command.js',
    'tasks',
    'list',
    '--section',
    'deadlines',
    '--project',
    'Askewly Command',
    '--limit',
    '10',
    '--json'
  ]);
  const listedTasks = JSON.parse(listOutput);
  assert(Array.isArray(listedTasks), 'CLI list did not return an array');
  assert(listedTasks.some((candidate) => candidate.id === dueTask.id && candidate.section === 'deadlines' && candidate.project_name === 'Askewly Command'), 'CLI list did not include due verifier task');

  const searchOutput = runNode([
    'scripts/askewly-command.js',
    'tasks',
    'search',
    '--query',
    String(dueTask.title).slice(0, 16),
    '--limit',
    '10',
    '--json'
  ]);
  const searchedTasks = JSON.parse(searchOutput);
  assert(searchedTasks.some((candidate) => candidate.id === dueTask.id), 'CLI search did not find due verifier task');

  const recentOutput = runNode([
    'scripts/askewly-command.js',
    'tasks',
    'recent',
    '--limit',
    '10',
    '--json'
  ]);
  const recentTasks = JSON.parse(recentOutput);
  assert(recentTasks.some((candidate) => candidate.id === dueTask.id), 'CLI recent did not include due verifier task');

  await request(cloudConfig, `tasks?id=eq.${dueTask.id}&workspace_id=eq.${workspace.id}`, {
    method: 'PATCH',
    prefer: 'return=minimal',
    body: {
      status: 'archived',
      archived_at: new Date().toISOString(),
      updated_by: profile.id
    }
  });
  console.log(`agent intake due ok: due_task=${dueTask.id} due_at=${dueTask.due_at}`);
  return { skipped: false, projectCount: projects.length, taskId: task.id, dueTaskId: dueTask.id };
}

async function main() {
  await verifyDryRun();
  await verifyLiveIfAvailable();
}

main().catch((error) => {
  console.error(`FAIL agent command intake: ${error.message}`);
  process.exit(1);
});
