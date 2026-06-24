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
  assert(fs.existsSync(configPath), `Missing desktop config: ${configPath}`);
  assert(fs.existsSync(storagePath), `Missing desktop auth storage: ${storagePath}`);
  const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const session = await refreshDesktopCloudSession(raw.today.cloud, storagePath);
  assert(session?.access_token, 'No desktop cloud access token');
  return { ...raw.today.cloud, accessToken: session.access_token };
}

function nowSortOrder(offset = 0) {
  return -Math.floor(Date.now() / 1000) + offset;
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
  const projectName = `M44 desktop graph ${suffix}`;
  let project = null;
  let milestone = null;
  let link = null;
  let contentTask = null;
  let unlinkedTask = null;

  try {
    project = (await request(cloudConfig, 'projects', {
      method: 'POST',
      body: {
        workspace_id: workspace.id,
        name: projectName,
        north_star: 'Verify desktop command graph parity',
        status: 'active',
        current_horizon: 'Desktop command graph parity',
        roadmap_note: 'temporary verifier project',
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
        description: 'temporary desktop parity milestone',
        status: 'active',
        target_date: '2026-12-31',
        sort_order: nowSortOrder(1),
        created_by: profile.id,
        updated_by: profile.id
      }
    }))?.[0];
    assert(milestone?.id, 'Milestone insert failed');

    link = (await request(cloudConfig, 'project_links', {
      method: 'POST',
      body: {
        workspace_id: workspace.id,
        project_id: project.id,
        project_milestone_id: milestone.id,
        title: `${projectName} Obsidian note`,
        kind: 'obsidian',
        target: 'obsidian://open?vault=askewly&file=30-Projects%2FDesktop%20Command%20Graph',
        sort_order: nowSortOrder(2),
        created_by: profile.id,
        updated_by: profile.id
      }
    }))?.[0];
    assert(link?.id, 'Project link insert failed');

    contentTask = (await request(cloudConfig, 'tasks?select=id,project_id,project_milestone_id,title,detail,status,projects(name),project_milestones(title)', {
      method: 'POST',
      body: {
        workspace_id: workspace.id,
        source_id: backlog.id,
        project_id: project.id,
        project_milestone_id: milestone.id,
        title: `${projectName} content draft`,
        detail: '원고 작성 desktop parity verifier',
        status: 'todo',
        sort_order: nowSortOrder(3),
        created_by: profile.id,
        updated_by: profile.id
      }
    }))?.[0];
    assert(contentTask?.id, 'Content task insert failed');

    unlinkedTask = (await request(cloudConfig, 'tasks?select=id,project_id,title,status', {
      method: 'POST',
      body: {
        workspace_id: workspace.id,
        source_id: backlog.id,
        title: `${projectName} unlinked review`,
        status: 'todo',
        sort_order: nowSortOrder(4),
        created_by: profile.id,
        updated_by: profile.id
      }
    }))?.[0];
    assert(unlinkedTask?.id, 'Unlinked task insert failed');

    const state = await loadCloudScheduleState(cloudConfig);
    const mappedContentTask = state.backlog.find((candidate) => Number(candidate.lineIndex) === contentTask.id);
    assert(mappedContentTask, 'Desktop state did not include content task');
    assert.strictEqual(mappedContentTask.projectId, project.id, 'Desktop state lost projectId');
    assert.strictEqual(mappedContentTask.projectMilestoneId, milestone.id, 'Desktop state lost projectMilestoneId');
    assert.strictEqual(mappedContentTask.projectName, projectName, 'Desktop state lost projectName');
    assert.strictEqual(mappedContentTask.projectMilestoneName, milestone.title, 'Desktop state lost projectMilestoneName');
    assert.strictEqual(mappedContentTask.detail, '원고 작성 desktop parity verifier', 'Desktop state lost task detail');
    const mappedUnlinkedTask = state.backlog.find((candidate) => Number(candidate.lineIndex) === unlinkedTask.id);
    assert(mappedUnlinkedTask, 'Desktop state did not include unlinked task');
    assert(!mappedUnlinkedTask.projectId, 'Desktop state unexpectedly linked unlinked task');

    const overview = state.commandOverview;
    assert(overview?.counts, 'Desktop commandOverview missing');
    assert(overview.counts.linkedTasks >= 1, 'commandOverview linked task count missing');
    assert(overview.counts.unlinkedTasks >= 1, 'commandOverview unlinked task count missing');
    assert(overview.counts.contentCandidates >= 1, 'commandOverview content candidate count missing');
    assert(overview.counts.projectLinks >= 1, 'commandOverview project link count missing');
    assert(overview.counts.obsidianLinks >= 1, 'commandOverview obsidian link count missing');
    assert(
      overview.contentCandidates.some((candidate) => Number(candidate.lineIndex) === contentTask.id),
      'commandOverview did not surface content candidate sample'
    );
    assert(
      overview.projectLinks.some((candidate) => Number(candidate.id) === link.id && candidate.kind === 'obsidian'),
      'commandOverview did not surface project link sample'
    );

    console.log('desktop command graph parity ok');
    console.log(`project id: ${project.id}`);
    console.log(`milestone id: ${milestone.id}`);
    console.log(`link id: ${link.id}`);
    console.log(`content task id: ${contentTask.id}`);
    console.log(`unlinked task id: ${unlinkedTask.id}`);
  } finally {
    const archivedAt = new Date().toISOString();
    for (const task of [contentTask, unlinkedTask]) {
      if (!task?.id) continue;
      await request(cloudConfig, `tasks?id=eq.${task.id}`, {
        method: 'PATCH',
        prefer: 'return=minimal',
        body: { status: 'archived', archived_at: archivedAt, updated_by: profile.id }
      }).catch(() => {});
    }
    if (link?.id) {
      await request(cloudConfig, `project_links?id=eq.${link.id}`, {
        method: 'PATCH',
        prefer: 'return=minimal',
        body: { archived_at: archivedAt, updated_by: profile.id }
      }).catch(() => {});
    }
    if (milestone?.id) {
      await request(cloudConfig, `project_milestones?id=eq.${milestone.id}`, {
        method: 'PATCH',
        prefer: 'return=minimal',
        body: { status: 'archived', archived_at: archivedAt, updated_by: profile.id }
      }).catch(() => {});
    }
    if (project?.id) {
      await request(cloudConfig, `projects?id=eq.${project.id}`, {
        method: 'PATCH',
        prefer: 'return=minimal',
        body: { status: 'archived', archived_at: archivedAt, updated_by: profile.id }
      }).catch(() => {});
    }
  }
}

main().catch((error) => {
  console.error(`FAIL desktop command graph parity: ${error.message}`);
  process.exit(1);
});
