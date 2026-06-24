'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { refreshDesktopCloudSession } = require('../main/sources/cloud-auth');
const { loadCloudScheduleState } = require('../main/sources/cloud-schedule-source');

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
  const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const session = await refreshDesktopCloudSession(raw.today.cloud, storagePath);
  return { ...raw.today.cloud, accessToken: session.access_token };
}

function nowSortOrder() {
  return Math.floor(Date.now() / 1000);
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
  const projectName = `M40 graph contract ${suffix}`;
  let project = null;
  let milestone = null;
  let link = null;
  let task = null;

  try {
    project = (await request(cloudConfig, 'projects', {
      method: 'POST',
      body: {
        workspace_id: workspace.id,
        name: projectName,
        north_star: 'Verify manual command graph contract',
        status: 'active',
        current_horizon: 'M40 verifier',
        roadmap_note: 'temporary command graph contract project',
        sort_order: nowSortOrder(),
        created_by: profile.id,
        updated_by: profile.id
      }
    }))?.[0];
    assert(project?.id, 'Project insert failed');

    milestone = (await request(cloudConfig, 'project_milestones', {
      method: 'POST',
      body: {
        workspace_id: workspace.id,
        project_id: project.id,
        title: `${projectName} milestone`,
        description: 'temporary command graph contract milestone',
        status: 'active',
        target_date: '2026-12-31',
        sort_order: nowSortOrder(),
        created_by: profile.id,
        updated_by: profile.id
      }
    }))?.[0];
    assert(milestone?.id, 'Milestone insert failed');
    assert.strictEqual(milestone.project_id, project.id, 'Milestone did not link to project');

    link = (await request(cloudConfig, 'project_links', {
      method: 'POST',
      body: {
        workspace_id: workspace.id,
        project_id: project.id,
        project_milestone_id: milestone.id,
        title: `${projectName} note`,
        kind: 'obsidian',
        target: 'obsidian://open?vault=askewly&file=30-Projects%2FCommand%20Graph',
        sort_order: nowSortOrder(),
        created_by: profile.id,
        updated_by: profile.id
      }
    }))?.[0];
    assert(link?.id, 'Project link insert failed');
    assert.strictEqual(link.project_id, project.id, 'Project link lost project_id');
    assert.strictEqual(link.project_milestone_id, milestone.id, 'Project link lost project_milestone_id');

    task = (await request(cloudConfig, 'tasks?select=id,project_id,project_milestone_id,title,projects(name),project_milestones(title)', {
      method: 'POST',
      body: {
        workspace_id: workspace.id,
        source_id: backlog.id,
        project_id: project.id,
        project_milestone_id: milestone.id,
        title: `${projectName} next action`,
        status: 'todo',
        sort_order: nowSortOrder(),
        created_by: profile.id,
        updated_by: profile.id
      }
    }))?.[0];
    assert(task?.id, 'Task insert failed');
    assert.strictEqual(task.project_id, project.id, 'Task lost project_id');
    assert.strictEqual(task.project_milestone_id, milestone.id, 'Task lost project_milestone_id');
    assert.strictEqual(task.projects?.name, projectName, 'Task project join missing');
    assert.strictEqual(task.project_milestones?.title, milestone.title, 'Task milestone join missing');

    const state = await loadCloudScheduleState(cloudConfig);
    const mappedTask = state.backlog.find((candidate) => Number(candidate.lineIndex) === task.id);
    assert(mappedTask, 'Desktop mapper did not surface linked backlog task');
    assert.strictEqual(mappedTask.projectId, project.id, 'Desktop mapper lost projectId');
    assert.strictEqual(mappedTask.projectMilestoneId, milestone.id, 'Desktop mapper lost projectMilestoneId');
    assert.strictEqual(mappedTask.projectName, projectName, 'Desktop mapper lost projectName');
    assert.strictEqual(mappedTask.projectMilestoneName, milestone.title, 'Desktop mapper lost projectMilestoneName');

    assert(state.commandOverview, 'Desktop command overview missing');
    assert(
      state.commandOverview.counts.activeTasks >= 1,
      'Desktop command overview did not compute active task counts'
    );

    const detached = (await request(cloudConfig, `tasks?id=eq.${task.id}`, {
      method: 'PATCH',
      body: {
        project_milestone_id: null,
        updated_by: profile.id
      }
    }))?.[0];
    assert.strictEqual(detached.project_milestone_id, null, 'Manual milestone detach failed');
    assert.strictEqual(detached.project_id, project.id, 'Manual milestone detach should preserve project_id');

    console.log('command graph contract ok');
    console.log(`project id: ${project.id}`);
    console.log(`milestone id: ${milestone.id}`);
    console.log(`link id: ${link.id}`);
    console.log(`task id: ${task.id}`);
    console.log('desktop mapper: projectId/projectMilestoneId/projectName/projectMilestoneName ok');
  } finally {
    if (task?.id) {
      await request(cloudConfig, `tasks?id=eq.${task.id}`, {
        method: 'PATCH',
        prefer: 'return=minimal',
        body: { status: 'archived', archived_at: new Date().toISOString(), updated_by: profile.id }
      }).catch(() => {});
    }
    if (link?.id) {
      await request(cloudConfig, `project_links?id=eq.${link.id}`, {
        method: 'PATCH',
        prefer: 'return=minimal',
        body: { archived_at: new Date().toISOString(), updated_by: profile.id }
      }).catch(() => {});
    }
    if (milestone?.id) {
      await request(cloudConfig, `project_milestones?id=eq.${milestone.id}`, {
        method: 'PATCH',
        prefer: 'return=minimal',
        body: { status: 'archived', archived_at: new Date().toISOString(), updated_by: profile.id }
      }).catch(() => {});
    }
    if (project?.id) {
      await request(cloudConfig, `projects?id=eq.${project.id}`, {
        method: 'PATCH',
        prefer: 'return=minimal',
        body: { status: 'archived', archived_at: new Date().toISOString(), updated_by: profile.id }
      }).catch(() => {});
    }
  }
}

main().catch((error) => {
  console.error(`FAIL command graph contract: ${error.message}`);
  process.exit(1);
});
