'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { refreshDesktopCloudSession } = require('../main/sources/cloud-auth');
const {
  PROJECT_LINK_KINDS,
  canOpenProjectLinkOnDesktop,
  canOpenProjectLinkOnMobile,
  normalizeProjectLinkTarget
} = require('../shared/project-links');

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

async function main() {
  assert.strictEqual(normalizeProjectLinkTarget(PROJECT_LINK_KINDS.GITHUB, 'github.com/lumatic2/askewly-command'), 'https://github.com/lumatic2/askewly-command');
  assert.strictEqual(normalizeProjectLinkTarget(PROJECT_LINK_KINDS.URL, 'https://askewly.com'), 'https://askewly.com');
  assert.strictEqual(canOpenProjectLinkOnMobile(PROJECT_LINK_KINDS.FILE), false);
  assert.strictEqual(canOpenProjectLinkOnDesktop(PROJECT_LINK_KINDS.FILE), true);

  const cloudConfig = await getCloudConfig();
  const workspace = (await request(cloudConfig, 'workspaces?select=id,name&order=created_at.asc&limit=1'))?.[0];
  assert(workspace, 'No workspace found');
  const profile = (await request(cloudConfig, 'profiles?select=id&limit=1'))?.[0];
  assert(profile, 'No profile found');

  const suffix = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const projectName = `M21 verifier ${suffix}`;
  let project = null;
  let milestone = null;
  let link = null;

  try {
    project = (await request(cloudConfig, 'projects', {
      method: 'POST',
      body: {
        workspace_id: workspace.id,
        name: projectName,
        status: 'active',
        sort_order: Math.floor(Date.now() / 1000),
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
        status: 'active',
        sort_order: Math.floor(Date.now() / 1000),
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
        title: `${projectName} obsidian note`,
        kind: PROJECT_LINK_KINDS.OBSIDIAN,
        target: 'obsidian://open?vault=askewly&file=30-Projects%2FAskewly%20Command',
        sort_order: Math.floor(Date.now() / 1000),
        created_by: profile.id,
        updated_by: profile.id
      }
    }))?.[0];
    assert(link?.id, 'Project link insert failed');
    assert.strictEqual(link.project_id, project.id, 'Project link did not link to project');
    assert.strictEqual(link.project_milestone_id, milestone.id, 'Project link did not link to milestone');

    const updated = (await request(cloudConfig, `project_links?id=eq.${link.id}`, {
      method: 'PATCH',
      body: {
        kind: PROJECT_LINK_KINDS.GITHUB,
        target: 'github.com/lumatic2/askewly-command',
        updated_by: profile.id
      }
    }))?.[0];
    assert.strictEqual(updated?.kind, PROJECT_LINK_KINDS.GITHUB, 'Project link kind update failed');
    assert.strictEqual(updated?.target, 'github.com/lumatic2/askewly-command', 'Project link target update failed');

    console.log('project link layer ok');
    console.log(`project id: ${project.id}`);
    console.log(`milestone id: ${milestone.id}`);
    console.log(`link id: ${link.id}`);
  } finally {
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
  console.error(`FAIL project link layer: ${error.message}`);
  process.exit(1);
});
