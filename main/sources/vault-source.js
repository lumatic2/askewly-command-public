const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const { shell } = require('electron');

const VAULT_ROOT = process.env.VAULT_ROOT || path.join(os.homedir(), 'vault');
const VAULT_FOLDERS = [
  { key: 'inbox',     name: '05-Inbox',     label: '05-Inbox' },
  { key: 'resources', name: '10-Resources', label: '10-Resources' },
  { key: 'areas',     name: '20-Areas',     label: '20-Areas' },
  { key: 'projects',  name: '30-Projects',  label: '30-Projects' },
  { key: 'logs',      name: '40-Logs',      label: '40-Logs' },
  { key: 'archives',  name: '90-Archives',  label: '90-Archives' }
];

function extractTitle(text) {
  if (!text) return null;
  const fmMatch = text.match(/^---\s*\n([\s\S]*?)\n---/);
  if (fmMatch) {
    const tm = fmMatch[1].match(/^title:\s*["']?(.+?)["']?\s*$/m);
    if (tm) return tm[1].trim();
  }
  const h1Match = text.match(/^#\s+(.+)$/m);
  if (h1Match) return h1Match[1].trim();
  return null;
}

async function walkDir(rootPath, dirPath, items, depth, maxDepth) {
  if (depth > maxDepth) return;
  let entries;
  try { entries = await fsp.readdir(dirPath, { withFileTypes: true }); } catch (_) { return; }
  await Promise.all(entries.map(async (entry) => {
    if (entry.name.startsWith('.')) return;
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      await walkDir(rootPath, fullPath, items, depth + 1, maxDepth);
    } else if (entry.isFile() && (entry.name.endsWith('.md') || entry.name.endsWith('.canvas'))) {
      try {
        const stat = await fsp.stat(fullPath);
        items.push({
          path: fullPath,
          name: entry.name,
          relPath: path.relative(rootPath, fullPath).split(path.sep).join('/'),
          size: stat.size,
          modifiedAt: stat.mtime.toISOString(),
          modifiedMs: stat.mtimeMs
        });
      } catch (_) {}
    }
  }));
}

async function fetchFolder(folder, { limit = 800, titleLimit = 24 } = {}) {
  const folderPath = path.join(VAULT_ROOT, folder.name);
  try {
    const items = [];
    await walkDir(folderPath, folderPath, items, 0, 6);
    items.sort((a, b) => b.modifiedMs - a.modifiedMs);
    const topN = items.slice(0, Math.min(limit, items.length));
    const titledN = topN.slice(0, titleLimit);
    await Promise.all(titledN.map(async (item) => {
      try {
        const content = await fsp.readFile(item.path, 'utf8');
        item.title = extractTitle(content.slice(0, 2000));
      } catch (_) { item.title = null; }
    }));
    return { rootPath: folderPath, items: topN };
  } catch (error) {
    return { error: String(error.message || error), items: [] };
  }
}

async function getVaultState(_config) {
  const results = await Promise.all(
    VAULT_FOLDERS.map((f) => fetchFolder(f).then((r) => ({ folder: f, result: r })))
  );
  const state = {
    host: 'local',
    root: VAULT_ROOT,
    folders: {},
    fetchedAt: new Date().toISOString()
  };
  const errors = [];
  for (const { folder, result } of results) {
    state.folders[folder.key] = {
      label: folder.label,
      path: path.join(VAULT_ROOT, folder.name),
      rootPath: result.rootPath || null,
      items: result.items || []
    };
    if (result.error) errors.push(`${folder.label}: ${result.error}`);
  }
  if (errors.length) state.error = errors.join('; ');
  return state;
}

async function openVaultNote(_config, notePath) {
  if (!notePath) return { ok: false, error: 'invalid path' };
  const err = await shell.openPath(notePath);
  if (err) return { ok: false, error: err };
  return { ok: true };
}

async function readVaultNote(_config, notePath, { maxBytes = 524288 } = {}) {
  if (!notePath || typeof notePath !== 'string') return { ok: false, error: 'invalid path' };
  try {
    const stat = await fsp.stat(notePath);
    const totalBytes = stat.size;
    const fd = await fsp.open(notePath, 'r');
    try {
      const len = Math.min(totalBytes, maxBytes);
      const buf = Buffer.alloc(len);
      await fd.read(buf, 0, len, 0);
      const content = buf.toString('utf8');
      return { ok: true, content, totalBytes, truncated: totalBytes > maxBytes };
    } finally {
      await fd.close();
    }
  } catch (error) {
    return { ok: false, error: String(error.message || error) };
  }
}

module.exports = { getVaultState, openVaultNote, readVaultNote };
