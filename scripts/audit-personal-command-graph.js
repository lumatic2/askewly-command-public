'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { refreshDesktopCloudSession } = require('../main/sources/cloud-auth');

const execFileAsync = promisify(execFile);

const PROJECTS_ROOT = path.join(os.homedir(), 'projects');
const VAULT_ROOT = process.env.VAULT_ROOT || path.join(os.homedir(), 'vault');
const ARTIFACT_PATH = path.join(process.cwd(), 'docs', 'artifacts', 'm27-source-audit.json');
const CONTENT_KEYWORDS = ['콘텐츠', 'content', 'blog', '블로그', 'youtube', '유튜브', '글쓰기', 'post', 'article', '영상'];
const PROJECT_PRIORITY_NAMES = [
  'workspace-pulse-dashboard',
  'Askwely-company',
  'cover-letter',
  'ai-contest',
  'custom-skills',
  'toolshelf'
];

function getAppDataDir() {
  const roamingRoot = process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming');
  return path.join(roamingRoot, 'askewly-command', 'widget');
}

async function getCloudConfig() {
  const appData = getAppDataDir();
  const configPath = path.join(appData, 'dashboard-config.json');
  const storagePath = path.join(appData, 'cloud-auth-storage.json');
  const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const session = await refreshDesktopCloudSession(raw.today.cloud, storagePath);
  if (!session) throw new Error('Desktop cloud session is not signed in');
  return { ...raw.today.cloud, accessToken: session.access_token };
}

async function request(cloudConfig, restPath) {
  const url = String(cloudConfig.supabaseUrl || '').replace(/\/$/, '');
  const response = await fetch(`${url}/rest/v1/${restPath}`, {
    headers: {
      apikey: cloudConfig.anonKey,
      Authorization: `Bearer ${cloudConfig.accessToken}`,
      'Content-Type': 'application/json'
    }
  });
  if (!response.ok) throw new Error(`Supabase REST ${response.status}: ${await response.text()}`);
  return response.json();
}

async function git(args, cwd) {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd, timeout: 5000, windowsHide: true });
    return stdout.trim();
  } catch (_) {
    return '';
  }
}

function readProjectMeta() {
  try {
    return JSON.parse(fs.readFileSync(path.join(PROJECTS_ROOT, '.proj-meta.json'), 'utf8'));
  } catch (_) {
    return {};
  }
}

async function inspectLocalProject(name, meta) {
  const dir = path.join(PROJECTS_ROOT, name);
  let stat;
  try {
    stat = await fsp.stat(dir);
  } catch (_) {
    return null;
  }
  if (!stat.isDirectory()) return null;

  const hasGit = fs.existsSync(path.join(dir, '.git'));
  const projectMeta = meta[name] || {};
  const roadmapPath = path.join(dir, 'ROADMAP.md');
  const hasRoadmap = fs.existsSync(roadmapPath);
  const branch = hasGit ? await git(['rev-parse', '--abbrev-ref', 'HEAD'], dir) : '';
  const dirtyText = hasGit ? await git(['status', '--porcelain'], dir) : '';
  const dirty = dirtyText ? dirtyText.split(/\r?\n/).filter(Boolean).length : 0;
  const lastCommitAt = hasGit ? await git(['log', '-1', '--format=%cI'], dir) : '';
  const priority = PROJECT_PRIORITY_NAMES.includes(name) || projectMeta.pin === true;

  return {
    name,
    path: dir,
    hasGit,
    branch,
    dirty,
    lastCommitAt: lastCommitAt || null,
    modifiedAt: stat.mtime.toISOString(),
    hasRoadmap,
    category: projectMeta.cat || '',
    description: projectMeta.desc || '',
    pinned: projectMeta.pin === true,
    archived: projectMeta.archive === true,
    priority
  };
}

async function auditLocalProjects() {
  const meta = readProjectMeta();
  let entries = [];
  try {
    entries = (await fsp.readdir(PROJECTS_ROOT, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => entry.name);
  } catch (error) {
    return { root: PROJECTS_ROOT, error: String(error.message || error), count: 0, candidates: [] };
  }

  const inspected = (await Promise.all(entries.map((name) => inspectLocalProject(name, meta)))).filter(Boolean);
  const active = inspected.filter((project) => !project.archived);
  const candidates = active
    .sort((left, right) => {
      if (left.priority !== right.priority) return left.priority ? -1 : 1;
      const lt = new Date(left.lastCommitAt || left.modifiedAt).getTime();
      const rt = new Date(right.lastCommitAt || right.modifiedAt).getTime();
      return rt - lt;
    })
    .slice(0, 24);

  return {
    root: PROJECTS_ROOT,
    count: inspected.length,
    activeCount: active.length,
    pinnedCount: active.filter((project) => project.pinned).length,
    roadmapCount: active.filter((project) => project.hasRoadmap).length,
    candidates
  };
}

function extractTitle(text) {
  if (!text) return null;
  const fmMatch = text.match(/^---\s*\n([\s\S]*?)\n---/);
  if (fmMatch) {
    const title = fmMatch[1].match(/^title:\s*["']?(.+?)["']?\s*$/m);
    if (title) return title[1].trim();
  }
  const h1 = text.match(/^#\s+(.+)$/m);
  return h1 ? h1[1].trim() : null;
}

function toObsidianUri(relPath) {
  const normalized = relPath.split(path.sep).join('/');
  return `obsidian://open?vault=vault&file=${encodeURIComponent(normalized)}`;
}

async function walkVault(dirPath, rootPath, items, depth = 0) {
  if (depth > 5) return;
  let entries = [];
  try {
    entries = await fsp.readdir(dirPath, { withFileTypes: true });
  } catch (_) {
    return;
  }
  await Promise.all(entries.map(async (entry) => {
    if (entry.name.startsWith('.')) return;
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      await walkVault(fullPath, rootPath, items, depth + 1);
    } else if (entry.isFile() && (entry.name.endsWith('.md') || entry.name.endsWith('.canvas'))) {
      try {
        const stat = await fsp.stat(fullPath);
        const relPath = path.relative(rootPath, fullPath);
        let title = null;
        if (entry.name.endsWith('.md')) {
          const raw = await fsp.readFile(fullPath, 'utf8');
          title = extractTitle(raw.slice(0, 2000));
        }
        items.push({
          name: entry.name,
          title,
          relPath: relPath.split(path.sep).join('/'),
          modifiedAt: stat.mtime.toISOString(),
          size: stat.size,
          uri: toObsidianUri(relPath)
        });
      } catch (_) {}
    }
  }));
}

async function auditVault() {
  const folder = path.join(VAULT_ROOT, '30-Projects');
  const items = [];
  await walkVault(folder, VAULT_ROOT, items);
  items.sort((left, right) => new Date(right.modifiedAt).getTime() - new Date(left.modifiedAt).getTime());
  return {
    root: VAULT_ROOT,
    folder,
    count: items.length,
    candidates: items.slice(0, 40).map((item) => ({
      name: item.name,
      title: item.title,
      relPath: item.relPath,
      modifiedAt: item.modifiedAt,
      uri: item.uri
    }))
  };
}

function isContentWork(row) {
  const haystack = `${row.title || ''} ${row.detail || ''} ${row.projects?.name || ''}`.toLowerCase();
  return CONTENT_KEYWORDS.some((keyword) => haystack.includes(keyword));
}

async function auditSupabase() {
  const cloudConfig = await getCloudConfig();
  const workspace = (await request(cloudConfig, 'workspaces?select=id,name&order=created_at.asc&limit=1'))?.[0];
  if (!workspace) throw new Error('No workspace found');

  const projects = await request(
    cloudConfig,
    `projects?select=id,name,status,current_horizon,roadmap_note&workspace_id=eq.${workspace.id}&status=neq.archived&order=sort_order.asc`
  );
  const projectIds = projects.map((project) => project.id);
  const milestones = projectIds.length
    ? await request(
      cloudConfig,
      `project_milestones?select=id,project_id,title,status&workspace_id=eq.${workspace.id}&project_id=in.(${projectIds.join(',')})&status=neq.archived&order=sort_order.asc`
    )
    : [];
  const links = projectIds.length
    ? await request(
      cloudConfig,
      `project_links?select=id,project_id,project_milestone_id,title,kind,target,archived_at&workspace_id=eq.${workspace.id}&project_id=in.(${projectIds.join(',')})&archived_at=is.null&order=sort_order.asc`
    )
    : [];
  const tasks = await request(
    cloudConfig,
    `tasks?select=id,title,detail,status,source_id,project_id,project_milestone_id,projects(name)&workspace_id=eq.${workspace.id}&status=neq.archived&order=sort_order.asc`
  );
  const contentCandidates = tasks.filter(isContentWork);
  const linkedTasks = tasks.filter((task) => task.project_id);

  return {
    workspace: { id: workspace.id, name: workspace.name },
    counts: {
      projects: projects.length,
      milestones: milestones.length,
      links: links.length,
      obsidianLinks: links.filter((link) => link.kind === 'obsidian').length,
      activeTasks: tasks.length,
      linkedTasks: linkedTasks.length,
      contentCandidates: contentCandidates.length
    },
    projectSamples: projects.slice(0, 12).map((project) => ({
      name: project.name,
      status: project.status,
      horizon: project.current_horizon || ''
    })),
    contentCandidates: contentCandidates.slice(0, 30).map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      project: task.projects?.name || ''
    }))
  };
}

async function main() {
  const [localProjects, vault, supabase] = await Promise.all([
    auditLocalProjects(),
    auditVault(),
    auditSupabase()
  ]);

  const artifact = {
    generatedAt: new Date().toISOString(),
    mode: 'read-only',
    notes: [
      'No Supabase mutations were performed.',
      'Vault note bodies and secret values are intentionally excluded.'
    ],
    localProjects,
    vault,
    supabase
  };

  await fsp.mkdir(path.dirname(ARTIFACT_PATH), { recursive: true });
  await fsp.writeFile(ARTIFACT_PATH, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  console.log(`wrote ${ARTIFACT_PATH}`);
  console.log(JSON.stringify({
    localProjects: localProjects.count,
    vaultProjectNotes: vault.count,
    supabase: supabase.counts
  }, null, 2));
}

main().catch((error) => {
  console.error(`FAIL personal command graph audit: ${error.message || error}`);
  process.exit(1);
});
