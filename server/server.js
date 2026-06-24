const express = require('express');
const path = require('path');
const fs = require('fs');
const config = require('./config');

const schedule = require('./sources/schedule');
const { getScheduleState } = schedule;
const { getVaultState, readVaultNote } = require('./sources/vault');
const { getContentState } = require('./sources/content');
const { getCalendarState } = require('./sources/calendar');
const { searchNotion, getNotionChildren } = require('./sources/notion');
const { getProjectsSnapshot } = require('./sources/projects');

const app = express();
app.use(express.json());

// Static public landing files (no cache during migration)
const WEB_ROOT = fs.existsSync(path.join(__dirname, 'web'))
  ? path.join(__dirname, 'web')
  : path.join(__dirname, '..', 'web');
const WEB_DIR = fs.existsSync(path.join(WEB_ROOT, 'dist'))
  ? path.join(WEB_ROOT, 'dist')
  : WEB_ROOT;
if (fs.existsSync(WEB_DIR)) {
  app.use(express.static(WEB_DIR, {
    setHeaders: (res) => {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    },
    etag: false
  }));
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    mode: config.PRIVATE_API_ENABLED ? 'private-api' : 'public-landing',
    privateApiEnabled: config.PRIVATE_API_ENABLED === true
  });
});

if (!config.PRIVATE_API_ENABLED) {
  app.use('/api', (_req, res) => {
    res.status(404).json({
      ok: false,
      error: 'Private dashboard APIs are disabled on the public landing domain.'
    });
  });
}

// ── Read-only API ──────────────────────────────────────────────────────────

app.get('/api/initial', async (_req, res) => {
  try { res.json(buildState()); } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

app.get('/api/content', async (_req, res) => {
  try {
    res.json(await getContentState());
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.get('/api/projects', (_req, res) => {
  res.json(getProjectsSnapshot());
});

app.get('/api/vault', async (_req, res) => {
  try {
    res.json(await getVaultState());
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.get('/api/vault/note', async (req, res) => {
  const notePath = req.query.path;
  if (!notePath) return res.status(400).json({ ok: false, error: 'path required' });
  res.json(await readVaultNote(decodeURIComponent(notePath)));
});

app.get('/api/notion', async (req, res) => {
  const notionConfig = loadNotionConfig();
  try {
    res.json(await searchNotion(notionConfig));
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.get('/api/notion/children', async (req, res) => {
  const notionConfig = loadNotionConfig();
  const { parentId, parentKind } = req.query;
  res.json(await getNotionChildren(notionConfig, { parentId, parentKind }));
});

app.get('/api/calendar', async (req, res) => {
  const range = req.query.range === 'month' ? 'month' : 'week';
  const force = req.query.force === '1';
  try {
    res.json(await getCalendarState({ range, force }));
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.get('/api/settings', (_req, res) => {
  res.json(loadSettings());
});

app.get('/api/sync/status', (_req, res) => {
  res.json({ status: 'idle' });
});

// ── Legacy schedule API ───────────────────────────────────────────────────
// Disabled by default after Supabase became the schedule SoT. Set
// ASKEWLY_COMMAND_LEGACY_SCHEDULE_ENABLED=1 only for the old personal
// M4/vault markdown workflow.

function buildState() {
  return {
    planType: 'CODEX',
    primary: { usedPercent: 0, resetAfterSeconds: null },
    secondary: { usedPercent: 0, resetAfterSeconds: null },
    generatedAt: new Date().toISOString(),
    sessionLabel: 'PWA',
    github: { owner: '', status: 'offline', columns: { now: [], next: [], blocked: [] } },
    today: getScheduleState()
  };
}

function wrap(fn) {
  return (req, res) => {
    try { fn(req.body || {}); res.json(buildState()); }
    catch (e) { res.status(400).json({ ok: false, error: String(e.message || e) }); }
  };
}

app.post('/api/schedule/item',     wrap(schedule.addItem));
app.patch('/api/schedule/status',  wrap(schedule.updateItemStatus));
app.patch('/api/schedule/text',    wrap(schedule.updateItemText));
app.delete('/api/schedule/item',   wrap(schedule.deleteItem));
app.post('/api/schedule/move',     wrap(schedule.moveItem));
app.post('/api/schedule/reorder',  wrap(schedule.reorderItem));
app.post('/api/schedule/restore',  wrap(schedule.restoreArchivedItem));

// ── Config helpers ─────────────────────────────────────────────────────────

const SETTINGS_PATH = path.join(require('os').homedir(), '.askewly-command-server-settings.json');
const NOTION_CONFIG_PATH = path.join(require('os').homedir(), '.askewly-command-notion-config.json');

function loadSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')); } catch (_) {
    return { appearance: { theme: 'dark', fontFamily: 'system-ui', fontSize: 13 }, availableFonts: [] };
  }
}

function loadNotionConfig() {
  try { return JSON.parse(fs.readFileSync(NOTION_CONFIG_PATH, 'utf8')); } catch (_) { return {}; }
}

// ── Start ──────────────────────────────────────────────────────────────────

app.listen(config.PORT, '0.0.0.0', () => {
  console.log(`Pulse server running on port ${config.PORT}`);
  console.log(`Vault root: ${config.VAULT_ROOT}`);
  console.log(`Schedule dir: ${config.SCHEDULE_DIR}`);
});
