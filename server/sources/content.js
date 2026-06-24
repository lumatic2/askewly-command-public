const { execFile } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const os = require('os');

const execFileAsync = promisify(execFile);
const NVM_NODE = `${os.homedir()}/.nvm/versions/node/v24.14.0/bin`;

function buildEnv() {
  return { ...process.env, PATH: `${NVM_NODE}:${process.env.PATH || '/usr/local/bin:/usr/bin:/bin'}` };
}

function parseJsonSafe(text, fallback) {
  if (!text || !text.trim()) return fallback;
  try { return JSON.parse(text); } catch (_) { return fallback; }
}

function msToIso(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return null;
  try { return new Date(ms).toISOString(); } catch (_) { return null; }
}

function normalizeJob(j) {
  const schedule = j?.schedule || {};
  const state = j?.state || {};
  const delivery = j?.delivery || {};
  const payload = j?.payload || {};
  return {
    id: j.id,
    name: j.name || j.id || 'unknown',
    enabled: j.enabled !== false,
    schedule: schedule.expr || schedule.kind || '',
    tz: schedule.tz || '',
    target: j.sessionTarget || '',
    wakeMode: j.wakeMode || '',
    deliveryChannel: delivery.channel || '',
    accountId: delivery.accountId || '',
    deliveryTo: delivery.to || '',
    deliveryMode: delivery.mode || '',
    description: j.description || '',
    lastRunAt: msToIso(state.lastRunAtMs),
    nextRunAt: msToIso(state.nextRunAtMs),
    lastStatus: state.lastStatus || state.lastRunStatus || '',
    lastDurationMs: state.lastDurationMs || null,
    consecutiveErrors: state.consecutiveErrors || 0,
    deliveryStatus: state.lastDeliveryStatus || '',
    payloadKind: payload.kind || '',
    payloadMessage: payload.message || payload.text || '',
    payloadTimeoutSeconds: payload.timeoutSeconds || null
  };
}

async function fetchCron() {
  try {
    const { stdout } = await execFileAsync('openclaw', ['cron', 'list', '--json'], {
      timeout: 20000, env: buildEnv(), maxBuffer: 1024 * 1024 * 8
    });
    const parsed = parseJsonSafe(stdout, null);
    const jobs = Array.isArray(parsed) ? parsed : (parsed?.jobs || []);
    const normalized = jobs.map(normalizeJob);
    normalized.sort((a, b) => {
      const ta = a.nextRunAt ? new Date(a.nextRunAt).getTime() : Infinity;
      const tb = b.nextRunAt ? new Date(b.nextRunAt).getTime() : Infinity;
      return ta - tb;
    });
    return normalized;
  } catch (error) {
    return { error: String(error.message || error) };
  }
}

async function fetchRecent() {
  const dirs = [
    path.join(os.homedir(), 'projects/content-automation/output'),
    path.join(os.homedir(), 'projects/content-automation/outputs'),
    path.join(os.homedir(), 'projects/content-automation/generated')
  ];
  const items = [];
  for (const dir of dirs) {
    try {
      const { stdout } = await execFileAsync('ls', ['-lt', '--time-style=full-iso', dir], {
        timeout: 5000, env: buildEnv()
      });
      for (const line of stdout.split('\n')) {
        if (!line.trim() || line.startsWith('total ')) continue;
        const m = line.match(/\S+\s+\d+\s+\S+\s+\S+\s+\d+\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}(?:\.\d+)?)\s+[+-]\d{4}\s+(.+)$/);
        if (m) items.push({ title: m[2], createdAt: new Date(m[1].replace(' ', 'T')).toISOString() });
      }
    } catch (_) {}
  }
  return items.slice(0, 15);
}

async function fetchQueue() {
  try {
    const { stdout } = await execFileAsync('openclaw', ['queue', 'list', '--json'], {
      timeout: 20000, env: buildEnv(), maxBuffer: 1024 * 1024 * 8
    });
    const parsed = parseJsonSafe(stdout, null);
    if (Array.isArray(parsed)) return parsed.slice(0, 15).map((e) => ({
      title: e.name || e.id || '?', stage: e.stage || e.state || '', status: e.status || '',
      queuedAt: msToIso(e.queuedAtMs) || e.queuedAt || null
    }));
    if (parsed && Array.isArray(parsed.entries)) return parsed.entries.slice(0, 15);
  } catch (_) {}
  return [];
}

async function getContentState() {
  const [cronResult, recent, queue] = await Promise.all([
    fetchCron(),
    fetchRecent().catch(() => []),
    fetchQueue().catch(() => [])
  ]);
  const cron = Array.isArray(cronResult) ? cronResult : [];
  const error = !Array.isArray(cronResult) && cronResult?.error ? cronResult.error : null;
  return { cron, recent, queue, fetchedAt: new Date().toISOString(), error };
}

module.exports = { getContentState };
