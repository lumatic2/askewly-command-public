const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const SSH_TIMEOUT = 20000;

async function sshExec(host, command) {
  const { stdout } = await execFileAsync(
    'ssh',
    ['-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=5', host, command],
    { timeout: SSH_TIMEOUT, windowsHide: true, maxBuffer: 1024 * 1024 * 8 }
  );
  return stdout;
}

function parseJsonSafe(text, fallback) {
  if (!text || !text.trim()) return fallback;
  try {
    return JSON.parse(text);
  } catch (_) {
    return fallback;
  }
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

async function runCronJob(host, id) {
  if (!id || typeof id !== 'string') throw new Error('invalid id');
  const safeId = id.replace(/[^a-zA-Z0-9-]/g, '');
  if (!safeId) throw new Error('invalid id');
  // Fire the run but don't wait for full completion — use short timeout.
  const cmd = `PATH=$HOME/.nvm/versions/node/v24.14.0/bin:$PATH openclaw cron run ${safeId} --timeout 10000 2>&1`;
  try {
    const out = await sshExec(host, cmd);
    return { ok: true, output: out.slice(0, 2000) };
  } catch (error) {
    return { ok: false, error: String(error.message || error) };
  }
}

async function fetchCron(host) {
  try {
    const out = await sshExec(
      host,
      'PATH=$HOME/.nvm/versions/node/v24.14.0/bin:$PATH openclaw cron list --json 2>/dev/null'
    );
    const parsed = parseJsonSafe(out, null);
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

async function fetchRecent(host) {
  const paths = [
    '$HOME/projects/content-automation/output',
    '$HOME/projects/content-automation/outputs',
    '$HOME/projects/content-automation/generated'
  ];
  const cmd = paths.map((p) => `ls -lt --time-style=full-iso "${p}" 2>/dev/null | head -n 20`).join(' ; ');
  try {
    const out = await sshExec(host, cmd);
    const lines = out.split('\n').map((l) => l.trim()).filter(Boolean);
    const items = [];
    for (const line of lines) {
      if (line.startsWith('total ')) continue;
      const m = line.match(/\S+\s+\d+\s+\S+\s+\S+\s+\d+\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}(?:\.\d+)?)\s+[+-]\d{4}\s+(.+)$/);
      if (!m) continue;
      const iso = new Date(m[1].replace(' ', 'T')).toISOString();
      items.push({ title: m[2], createdAt: iso });
    }
    return items.slice(0, 15);
  } catch (_) {
    return [];
  }
}

async function fetchQueue(host) {
  try {
    const out = await sshExec(
      host,
      'PATH=$HOME/.nvm/versions/node/v24.14.0/bin:$PATH openclaw queue list --json 2>/dev/null'
    );
    const parsed = parseJsonSafe(out, null);
    if (Array.isArray(parsed)) return parsed.slice(0, 15).map((e) => ({
      title: e.name || e.id || '?',
      stage: e.stage || e.state || '',
      status: e.status || '',
      queuedAt: msToIso(e.queuedAtMs) || e.queuedAt || null
    }));
    if (parsed && Array.isArray(parsed.entries)) return parsed.entries.slice(0, 15);
  } catch (_) {}
  return [];
}

async function getContentState(config) {
  const host = config?.today?.remote?.host || 'user@m4';
  const [cronResult, recent, queue] = await Promise.all([
    fetchCron(host),
    fetchRecent(host).catch(() => []),
    fetchQueue(host).catch(() => [])
  ]);
  const cron = Array.isArray(cronResult) ? cronResult : [];
  const error = !Array.isArray(cronResult) && cronResult?.error ? cronResult.error : null;
  return { cron, recent, queue, fetchedAt: new Date().toISOString(), host, error };
}

module.exports = { getContentState, runCronJob };

