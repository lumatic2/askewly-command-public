const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const os = require('os');

const execFileAsync = promisify(execFile);
const PROJECTS_ROOT = path.join(os.homedir(), 'projects');
const META_FILE = path.join(PROJECTS_ROOT, '.proj-meta.json');
const EXEC_TIMEOUT = 5000;

const CATEGORY_ORDER = ['AI', 'Web', 'MCP', 'Bot', 'Game', 'Tool', 'Infra', 'Etc'];

async function git(args, cwd) {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd, timeout: EXEC_TIMEOUT, windowsHide: true });
    return stdout;
  } catch (_) {
    return '';
  }
}

function loadMeta() {
  try {
    const raw = fs.readFileSync(META_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (_) {
    return {};
  }
}

function saveMeta(meta) {
  fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2), 'utf8');
}

function parseRoadmap(filePath) {
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    const lines = text.split(/\r?\n/);
    const items = [];
    let currentSection = '';
    const headingRe = /^(#{1,6})\s+(.+?)\s*$/;
    const itemRe = /^\s*[-*]\s+\[([ xX~/])\]\s*(.*)$/;
    for (const line of lines) {
      const h = line.match(headingRe);
      if (h) { currentSection = h[2].trim(); continue; }
      const it = line.match(itemRe);
      if (it) {
        const mark = it[1];
        const done = mark === 'x' || mark === 'X';
        items.push({ text: it[2].trim(), done, section: currentSection });
      }
    }
    if (items.length === 0) return null;
    const done = items.filter((i) => i.done).length;
    const total = items.length;
    return { done, total, percent: Math.round((done / total) * 100), items };
  } catch (_) {
    return null;
  }
}

function readLastOpened(dir) {
  try {
    const marker = path.join(dir, '.claude', '.last-opened');
    const st = fs.statSync(marker);
    return st.mtime.toISOString();
  } catch (_) {
    return null;
  }
}

async function getWorktrees(projDir, wtMeta) {
  const out = await git(['worktree', 'list', '--porcelain'], projDir);
  if (!out) return [];
  const lines = out.split(/\r?\n/);
  const entries = [];
  let cur = null;
  for (const line of lines) {
    if (line.startsWith('worktree ')) {
      cur = { path: line.slice('worktree '.length).trim() };
    } else if (line.startsWith('branch ') && cur) {
      cur.branch = line.slice('branch refs/heads/'.length).trim();
    } else if (line === '' && cur) {
      entries.push(cur);
      cur = null;
    }
  }
  if (cur) entries.push(cur);

  const normProj = path.resolve(projDir).toLowerCase();
  const worktrees = [];
  for (const e of entries) {
    if (!e.path) continue;
    const normE = path.resolve(e.path).toLowerCase();
    if (normE === normProj) continue;
    const name = path.basename(e.path);
    const porcelain = await git(['status', '--porcelain'], e.path);
    const dirty = porcelain ? porcelain.split('\n').filter((l) => l.trim().length > 0).length : 0;
    const desc = wtMeta?.[name]?.desc || '';
    worktrees.push({ name, branch: e.branch || '', path: e.path, dirty, desc });
  }
  return worktrees;
}

async function inspectProject(name, meta) {
  const dir = path.join(PROJECTS_ROOT, name);
  let stat;
  try { stat = fs.statSync(dir); } catch { return null; }
  if (!stat.isDirectory()) return null;
  const hasGit = fs.existsSync(path.join(dir, '.git'));

  let dirty = 0;
  let ahead = 0;
  let behind = 0;
  let lastCommitAt = null;
  let branch = '';
  let worktrees = [];

  const projMeta = meta[name] || {};
  const wtMeta = projMeta.wt || {};

  if (hasGit) {
    const porcelain = await git(['status', '--porcelain'], dir);
    dirty = porcelain ? porcelain.split('\n').filter((l) => l.trim().length > 0).length : 0;

    branch = (await git(['rev-parse', '--abbrev-ref', 'HEAD'], dir)).trim();

    const counts = (await git(['rev-list', '--left-right', '--count', '@{u}...HEAD'], dir)).trim();
    if (counts) {
      const parts = counts.split(/\s+/).map((n) => Number(n));
      if (parts.length === 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) {
        behind = parts[0];
        ahead = parts[1];
      }
    }

    const commitIso = (await git(['log', '-1', '--format=%cI'], dir)).trim();
    if (commitIso) lastCommitAt = commitIso;

    worktrees = await getWorktrees(dir, wtMeta);
  } else {
    try { lastCommitAt = stat.mtime.toISOString(); } catch (_) {}
  }

  const roadmapPath = path.join(dir, 'ROADMAP.md');
  const roadmap = fs.existsSync(roadmapPath) ? parseRoadmap(roadmapPath) : null;
  const lastOpenedAt = readLastOpened(dir);

  return {
    name,
    path: dir,
    hasGit,
    branch,
    dirty,
    ahead,
    behind,
    lastCommitAt,
    lastOpenedAt,
    sortKey: lastOpenedAt || lastCommitAt || (stat.mtime?.toISOString?.() ?? null),
    cat: projMeta.cat || '',
    desc: projMeta.desc || '',
    pin: projMeta.pin === true,
    archive: projMeta.archive === true,
    worktrees,
    roadmapPath: roadmap ? roadmapPath : null,
    roadmapDone: roadmap?.done ?? null,
    roadmapTotal: roadmap?.total ?? null,
    roadmapPercent: roadmap?.percent ?? null,
    roadmapItems: roadmap?.items ?? null
  };
}

async function getProjectsState() {
  const meta = loadMeta();
  let entries = [];
  try {
    entries = fs.readdirSync(PROJECTS_ROOT, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => e.name);
  } catch (error) {
    return { items: [], scannedAt: new Date().toISOString(), error: `projects 폴더 접근 실패: ${error.message}` };
  }

  const results = await Promise.all(entries.map((name) => inspectProject(name, meta).catch(() => null)));
  const items = results.filter(Boolean).sort((a, b) => {
    const ta = a.sortKey ? new Date(a.sortKey).getTime() : 0;
    const tb = b.sortKey ? new Date(b.sortKey).getTime() : 0;
    return tb - ta;
  });

  return { items, scannedAt: new Date().toISOString(), root: PROJECTS_ROOT, categoryOrder: CATEGORY_ORDER };
}

function updateProjectMeta(name, patch) {
  if (!name || typeof name !== 'string') throw new Error('invalid name');
  const meta = loadMeta();
  const cur = meta[name] || { cat: '', desc: '' };
  if (patch.cat !== undefined) cur.cat = patch.cat;
  if (patch.desc !== undefined) cur.desc = patch.desc;
  if (patch.pin !== undefined) cur.pin = patch.pin === true;
  if (patch.archive !== undefined) cur.archive = patch.archive === true;
  if (cur.pin && cur.archive) cur.archive = false;
  meta[name] = cur;
  saveMeta(meta);
  return { ok: true, meta: cur };
}

module.exports = { getProjectsState, updateProjectMeta, PROJECTS_ROOT, CATEGORY_ORDER };
