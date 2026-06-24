'use strict';

const fs = require('fs');
const path = require('path');
const { refreshDesktopCloudSession } = require('../main/sources/cloud-auth');

function getAppDataDir() {
  const roamingRoot = process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming');
  return path.join(roamingRoot, 'askewly-command', 'widget');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
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
  if (!response.ok) {
    throw new Error(`Supabase REST ${response.status}: ${await response.text()}`);
  }
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

async function main() {
  const cloudConfig = await getCloudConfig();
  const workspaces = await request(cloudConfig, 'workspaces?select=id,name&order=created_at.asc&limit=1');
  const workspace = workspaces?.[0];
  assert(workspace, 'No workspace found');

  const profiles = await request(cloudConfig, 'profiles?select=id&limit=1');
  const profile = profiles?.[0];
  assert(profile, 'No profile found');

  const sources = await request(cloudConfig, `task_sources?select=id,key&workspace_id=eq.${workspace.id}&key=eq.backlog&limit=1`);
  const backlog = sources?.[0];
  assert(backlog, 'No backlog source found');

  const suffix = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const projectName = `M20 verifier ${suffix}`;
  let project = null;
  let milestone = null;
  let task = null;

  try {
    const projects = await request(cloudConfig, 'projects', {
      method: 'POST',
      body: {
        workspace_id: workspace.id,
        name: projectName,
        north_star: 'Verify structured roadmap',
        status: 'active',
        current_horizon: 'M20 verifier',
        roadmap_note: 'temporary roadmap smoke project',
        sort_order: Math.floor(Date.now() / 1000),
        created_by: profile.id,
        updated_by: profile.id
      }
    });
    project = projects?.[0];
    assert(project?.id, 'Project insert did not return id');

    const milestones = await request(cloudConfig, 'project_milestones', {
      method: 'POST',
      body: {
        workspace_id: workspace.id,
        project_id: project.id,
        title: `${projectName} milestone`,
        description: 'temporary smoke milestone',
        status: 'planned',
        target_date: '2026-12-31',
        sort_order: Math.floor(Date.now() / 1000),
        created_by: profile.id,
        updated_by: profile.id
      }
    });
    milestone = milestones?.[0];
    assert(milestone?.id, 'Milestone insert did not return id');
    assert(milestone.project_id === project.id, 'Milestone did not link to project');

    const updatedMilestones = await request(cloudConfig, `project_milestones?id=eq.${milestone.id}`, {
      method: 'PATCH',
      body: {
        status: 'active',
        description: 'verified milestone update',
        updated_by: profile.id
      }
    });
    milestone = updatedMilestones?.[0];
    assert(milestone?.status === 'active', 'Milestone status update failed');

    const tasks = await request(cloudConfig, 'tasks?select=id,project_id,project_milestone_id,title,projects(name),project_milestones(title)', {
      method: 'POST',
      body: {
        workspace_id: workspace.id,
        source_id: backlog.id,
        project_id: project.id,
        project_milestone_id: milestone.id,
        title: `${projectName} next action`,
        status: 'todo',
        sort_order: Math.floor(Date.now() / 1000),
        created_by: profile.id,
        updated_by: profile.id
      }
    });
    task = tasks?.[0];
    assert(task?.project_id === project.id, 'Task did not link to project');
    assert(task?.project_milestone_id === milestone.id, 'Task did not link to milestone');
    assert(task?.projects?.name === projectName, 'Joined project name was not returned');
    assert(task?.project_milestones?.title === milestone.title, 'Joined milestone title was not returned');

    const unlinkedTasks = await request(cloudConfig, `tasks?id=eq.${task.id}`, {
      method: 'PATCH',
      body: {
        project_milestone_id: null,
        updated_by: profile.id
      }
    });
    assert(unlinkedTasks?.[0]?.project_milestone_id === null, 'Task milestone unlink failed');

    console.log('project roadmap layer ok');
    console.log(`project id: ${project.id}`);
    console.log(`milestone id: ${milestone.id}`);
    console.log(`task id: ${task.id}`);
  } finally {
    if (task?.id) {
      await request(cloudConfig, `tasks?id=eq.${task.id}`, {
        method: 'PATCH',
        prefer: 'return=minimal',
        body: {
          status: 'archived',
          archived_at: new Date().toISOString(),
          updated_by: profile.id
        }
      }).catch(() => {});
    }
    if (milestone?.id) {
      await request(cloudConfig, `project_milestones?id=eq.${milestone.id}`, {
        method: 'PATCH',
        prefer: 'return=minimal',
        body: {
          status: 'archived',
          archived_at: new Date().toISOString(),
          updated_by: profile.id
        }
      }).catch(() => {});
    }
    if (project?.id) {
      await request(cloudConfig, `projects?id=eq.${project.id}`, {
        method: 'PATCH',
        prefer: 'return=minimal',
        body: {
          status: 'archived',
          archived_at: new Date().toISOString(),
          updated_by: profile.id
        }
      }).catch(() => {});
    }
  }
}

main().catch((error) => {
  console.error(`FAIL project roadmap layer: ${error.message}`);
  process.exit(1);
});
