'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { refreshDesktopCloudSession } = require('../main/sources/cloud-auth');
const {
  loadCloudScheduleState,
  updateCloudScheduleItemGraph
} = require('../main/sources/cloud-schedule-source');

function getAppDataDir() {
  const roamingRoot = process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming');
  return path.join(roamingRoot, 'askewly-command', 'widget');
}

async function request(cloudConfig, restPath, options = {}) {
  const url = String(cloudConfig.supabaseUrl || '').replace(/\/$/, '');
  const response = await fetch(`${url}/rest/v1/${restPath}`, {
    method: options.method || 'GET',
    headers: {
      apikey: cloudConfig.anonKey,
      Authorization: `Bearer ${cloudConfig.accessToken}`,
      'Content-Type': 'application/json',
      Prefer: options.prefer || 'return=representation',
      ...(options.headers || {})
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  if (!response.ok) throw new Error(`Supabase REST ${response.status}: ${await response.text()}`);
  if (response.status === 204) return null;
  return response.json();
}

async function getCloudConfig() {
  const appData = getAppDataDir();
  const configPath = path.join(appData, 'dashboard-config.json');
  const storagePath = path.join(appData, 'cloud-auth-storage.json');
  assert(fs.existsSync(configPath), `Missing desktop config: ${configPath}`);
  assert(fs.existsSync(storagePath), `Missing desktop auth storage: ${storagePath}`);
  const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const session = await refreshDesktopCloudSession(raw.today.cloud, storagePath);
  assert(session?.access_token, 'No desktop cloud access token');
  return { ...raw.today.cloud, accessToken: session.access_token };
}

function sortOrder(offset = 0) {
  return -Math.floor(Date.now() / 1000) + offset;
}

async function insertProjectGraph(cloudConfig, workspace, profile, suffix, offset) {
  const projectName = `M45 desktop ops ${suffix} ${offset}`;
  const project = (await request(cloudConfig, 'projects', {
    method: 'POST',
    body: {
      workspace_id: workspace.id,
      name: projectName,
      north_star: 'Verify desktop graph operations',
      status: 'active',
      current_horizon: 'Desktop graph operations',
      roadmap_note: 'temporary verifier project',
      sort_order: sortOrder(offset),
      created_by: profile.id,
      updated_by: profile.id
    }
  }))?.[0];
  assert(project?.id, 'Project insert failed');

  const milestone = (await request(cloudConfig, 'project_milestones', {
    method: 'POST',
    body: {
      workspace_id: workspace.id,
      project_id: project.id,
      title: `${projectName} milestone`,
      description: 'temporary desktop operations milestone',
      status: 'active',
      target_date: '2026-12-31',
      sort_order: sortOrder(offset + 1),
      created_by: profile.id,
      updated_by: profile.id
    }
  }))?.[0];
  assert(milestone?.id, 'Milestone insert failed');
  return { project, milestone };
}

function findTask(state, taskId) {
  const all = [
    ...(state.today || []),
    ...(state.deadlines || []),
    ...(state.backlog || [])
  ];
  return all.find((candidate) => Number(candidate.lineIndex) === Number(taskId)) || null;
}

async function main() {
  const cloudConfig = await getCloudConfig();
  const workspace = (await request(cloudConfig, 'workspaces?select=id,name&order=created_at.asc&limit=1'))?.[0];
  assert(workspace, 'No workspace found');
  const profile = (await request(cloudConfig, 'profiles?select=id&limit=1'))?.[0];
  assert(profile, 'No profile found');
  const backlog = (await request(
    cloudConfig,
    `task_sources?select=id,key,label&workspace_id=eq.${workspace.id}&key=eq.backlog&limit=1`
  ))?.[0];
  assert(backlog, 'No backlog source found');

  const suffix = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const graphs = [];
  let task = null;

  try {
    graphs.push(await insertProjectGraph(cloudConfig, workspace, profile, suffix, 10));
    graphs.push(await insertProjectGraph(cloudConfig, workspace, profile, suffix, 20));

    task = (await request(cloudConfig, 'tasks?select=id,project_id,project_milestone_id,title,status', {
      method: 'POST',
      body: {
        workspace_id: workspace.id,
        source_id: backlog.id,
        title: `M45 desktop graph operation task ${suffix}`,
        status: 'todo',
        sort_order: sortOrder(30),
        created_by: profile.id,
        updated_by: profile.id
      }
    }))?.[0];
    assert(task?.id, 'Task insert failed');

    let state = await loadCloudScheduleState(cloudConfig);
    assert(state.projects.some((project) => project.id === graphs[0].project.id), 'Desktop state missing project options');
    assert(state.milestones.some((milestone) => milestone.id === graphs[0].milestone.id), 'Desktop state missing milestone options');

    state = await updateCloudScheduleItemGraph(cloudConfig, {
      lineIndex: task.id,
      projectId: graphs[0].project.id,
      projectMilestoneId: graphs[0].milestone.id
    });
    let mapped = findTask(state, task.id);
    assert(mapped, 'Updated task missing after attach');
    assert.strictEqual(mapped.projectId, graphs[0].project.id, 'Attach lost project');
    assert.strictEqual(mapped.projectMilestoneId, graphs[0].milestone.id, 'Attach lost milestone');
    assert.strictEqual(mapped.projectName, graphs[0].project.name, 'Attach lost project name');
    assert.strictEqual(mapped.projectMilestoneName, graphs[0].milestone.title, 'Attach lost milestone title');

    let rejected = false;
    try {
      await updateCloudScheduleItemGraph(cloudConfig, {
        lineIndex: task.id,
        projectId: graphs[0].project.id,
        projectMilestoneId: graphs[1].milestone.id
      });
    } catch (error) {
      rejected = /Milestone/.test(String(error.message || error));
    }
    assert(rejected, 'Mismatched project/milestone pair was not rejected');

    state = await updateCloudScheduleItemGraph(cloudConfig, {
      lineIndex: task.id,
      projectId: graphs[1].project.id,
      projectMilestoneId: graphs[1].milestone.id
    });
    mapped = findTask(state, task.id);
    assert.strictEqual(mapped.projectId, graphs[1].project.id, 'Change lost project');
    assert.strictEqual(mapped.projectMilestoneId, graphs[1].milestone.id, 'Change lost milestone');

    state = await updateCloudScheduleItemGraph(cloudConfig, {
      lineIndex: task.id,
      projectId: null,
      projectMilestoneId: null
    });
    mapped = findTask(state, task.id);
    assert.strictEqual(mapped.projectId, null, 'Clear did not remove project');
    assert.strictEqual(mapped.projectMilestoneId, null, 'Clear did not remove milestone');

    console.log('desktop command graph operations ok');
    console.log(`task id: ${task.id}`);
    console.log(`project ids: ${graphs.map((graph) => graph.project.id).join(', ')}`);
    console.log(`milestone ids: ${graphs.map((graph) => graph.milestone.id).join(', ')}`);
  } finally {
    const archivedAt = new Date().toISOString();
    if (task?.id) {
      await request(cloudConfig, `tasks?id=eq.${task.id}`, {
        method: 'PATCH',
        prefer: 'return=minimal',
        body: {
          status: 'archived',
          project_id: null,
          project_milestone_id: null,
          archived_at: archivedAt,
          updated_by: profile.id
        }
      }).catch(() => {});
    }
    for (const graph of graphs) {
      if (graph.milestone?.id) {
        await request(cloudConfig, `project_milestones?id=eq.${graph.milestone.id}`, {
          method: 'PATCH',
          prefer: 'return=minimal',
          body: { status: 'archived', archived_at: archivedAt, updated_by: profile.id }
        }).catch(() => {});
      }
      if (graph.project?.id) {
        await request(cloudConfig, `projects?id=eq.${graph.project.id}`, {
          method: 'PATCH',
          prefer: 'return=minimal',
          body: { status: 'archived', archived_at: archivedAt, updated_by: profile.id }
        }).catch(() => {});
      }
    }
  }
}

main().catch((error) => {
  console.error(`FAIL desktop command graph operations: ${error.message}`);
  process.exit(1);
});
