const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const config = require('../config');

const VAULT_FOLDERS = [
  { key: 'inbox',     path: '05-Inbox',     label: '05-Inbox' },
  { key: 'resources', path: '10-Resources', label: '10-Resources' },
  { key: 'areas',     path: '20-Areas',     label: '20-Areas' },
  { key: 'projects',  path: '30-Projects',  label: '30-Projects' },
  { key: 'logs',      path: '40-Logs',      label: '40-Logs' },
  { key: 'archives',  path: '90-Archives',  label: '90-Archives' }
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

async function fetchFolder(folderDef, { limit = 800, titleLimit = 24 } = {}) {
  const folderPath = path.join(config.VAULT_ROOT, folderDef.path);
  try {
    const items = [];
    await walkDir(folderPath, folderPath, items, 0, 6);
    items.sort((a, b) => b.modifiedMs - a.modifiedMs);
    const topN = items.slice(0, Math.min(limit, items.length));
    const titledN = topN.slice(0, titleLimit);
    await Promise.all(titledN.map(async (item) => {
      try {
        const content = await fs.readFile(item.path, 'utf8');
        item.title = extractTitle(content.slice(0, 2000));
      } catch (_) {
        item.title = null;
      }
    }));
    return { rootPath: folderPath, items: topN };
  } catch (error) {
    return { error: String(error.message || error), items: [] };
  }
}

async function walkDir(rootPath, dirPath, items, depth, maxDepth) {
  if (depth > maxDepth) return;
  let entries;
  try { entries = await fs.readdir(dirPath, { withFileTypes: true }); } catch (_) { return; }
  await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      await walkDir(rootPath, fullPath, items, depth + 1, maxDepth);
    } else if (entry.isFile() && (entry.name.endsWith('.md') || entry.name.endsWith('.canvas'))) {
      try {
        const stat = await fs.stat(fullPath);
        const relPath = path.relative(rootPath, fullPath);
        items.push({
          path: fullPath,
          name: entry.name,
          relPath,
          size: stat.size,
          modifiedAt: stat.mtime.toISOString(),
          modifiedMs: stat.mtimeMs,
          title: null
        });
      } catch (_) {}
    }
  }));
}

async function getVaultState() {
  const results = await Promise.all(
    VAULT_FOLDERS.map((f) => fetchFolder(f).then((r) => ({ folder: f, result: r })))
  );
  const state = { folders: {}, fetchedAt: new Date().toISOString() };
  const errors = [];
  for (const { folder, result } of results) {
    state.folders[folder.key] = {
      label: folder.label,
      path: path.join(config.VAULT_ROOT, folder.path),
      rootPath: result.rootPath || null,
      items: result.items || []
    };
    if (result.error) errors.push(`${folder.label}: ${result.error}`);
  }
  if (errors.length) state.error = errors.join('; ');
  return state;
}

async function readVaultNote(notePath, { maxBytes = 524288 } = {}) {
  if (!notePath || typeof notePath !== 'string') return { ok: false, error: 'invalid path' };
  const safePath = path.normalize(notePath);
  if (!safePath.startsWith(config.VAULT_ROOT)) return { ok: false, error: 'path outside vault' };
  try {
    const stat = await fs.stat(safePath);
    const totalBytes = stat.size;
    const truncated = totalBytes > maxBytes;
    const fd = await fs.open(safePath, 'r');
    const buf = Buffer.alloc(Math.min(totalBytes, maxBytes));
    await fd.read(buf, 0, buf.length, 0);
    await fd.close();
    const content = buf.toString('utf8');
    return { ok: true, content, totalBytes, truncated };
  } catch (error) {
    return { ok: false, error: String(error.message || error) };
  }
}

module.exports = { getVaultState, readVaultNote };
