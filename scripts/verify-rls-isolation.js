'use strict';

const fs = require('fs');
const path = require('path');

function loadLocalEnv() {
  const envPath = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex <= 0) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

function getConfig() {
  const supabaseUrl = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const anonKey = String(process.env.SUPABASE_ANON_KEY || '');
  const accessToken = String(getCommandEnv('SUPABASE_ACCESS_TOKEN') || '');
  if (!supabaseUrl) throw new Error('Missing SUPABASE_URL');
  if (!anonKey) throw new Error('Missing SUPABASE_ANON_KEY');
  if (!accessToken) throw new Error('Missing ASKEWLY_COMMAND_SUPABASE_ACCESS_TOKEN');
  return { supabaseUrl, anonKey, accessToken };
}

function getCommandEnv(name) {
  return process.env[`ASKEWLY_COMMAND_${name}`] || process.env[`WORKSPACE_PULSE_${name}`] || '';
}

async function rest(config, token, route, options = {}) {
  const response = await fetch(`${config.supabaseUrl}/rest/v1/${route}`, {
    method: options.method || 'GET',
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: options.prefer || 'return=representation',
      ...(options.headers || {})
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return { ok: response.ok, status: response.status, data };
}

async function signUpTemporaryUser(config) {
  const suffix = Date.now();
  const response = await fetch(`${config.supabaseUrl}/auth/v1/signup`, {
    method: 'POST',
    headers: {
      apikey: config.anonKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      email: `workspace.pulse.rls.${suffix}@gmail.com`,
      password: `AskewlyCommandRls!${suffix}`
    })
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`Temporary signup failed: HTTP ${response.status}`);
  }
  return data.access_token || data.session?.access_token || '';
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function assertNoRows(result, label) {
  if (!result.ok) {
    console.log(`${label}: denied with HTTP ${result.status}`);
    return;
  }
  assert(Array.isArray(result.data), `${label}: expected array response`);
  assert(result.data.length === 0, `${label}: expected zero visible rows, got ${result.data.length}`);
  console.log(`${label}: zero visible rows`);
}

async function main() {
  loadLocalEnv();
  const config = getConfig();

  const own = await rest(config, config.accessToken, 'workspaces?select=id,name&order=created_at.asc&limit=1');
  assert(own.ok, `Own workspace read failed with HTTP ${own.status}`);
  assert(Array.isArray(own.data) && own.data.length === 1, 'Expected exactly one visible own workspace for RLS test');
  const workspace = own.data[0];
  console.log(`own workspace visible: ${workspace.id}`);

  const forbiddenWorkspaceId = String(getCommandEnv('FORBIDDEN_WORKSPACE_ID') || '').trim();
  if (forbiddenWorkspaceId) {
    const forbiddenRead = await rest(config, config.accessToken, `workspaces?select=id&id=eq.${forbiddenWorkspaceId}`);
    await assertNoRows(forbiddenRead, 'forbidden workspace read');

    const forbiddenUpdate = await rest(config, config.accessToken, `workspaces?id=eq.${forbiddenWorkspaceId}`, {
      method: 'PATCH',
      body: { name: 'Personal' }
    });
    await assertNoRows(forbiddenUpdate, 'forbidden workspace update');

    console.log('PASS RLS isolation smoke');
    return;
  }

  const anonymousRead = await rest(config, config.anonKey, `workspaces?select=id&id=eq.${workspace.id}`);
  await assertNoRows(anonymousRead, 'anonymous workspace read');

  const otherAccessToken = await signUpTemporaryUser(config);
  assert(otherAccessToken, 'Temporary signup succeeded but did not return an access token; email confirmation may be enabled');

  const otherRead = await rest(config, otherAccessToken, `workspaces?select=id&id=eq.${workspace.id}`);
  await assertNoRows(otherRead, 'other account workspace read');

  const otherUpdate = await rest(config, otherAccessToken, `workspaces?id=eq.${workspace.id}`, {
    method: 'PATCH',
    body: { name: workspace.name }
  });
  await assertNoRows(otherUpdate, 'other account workspace update');

  console.log('PASS RLS isolation smoke');
}

main().catch((error) => {
  console.error(`FAIL RLS isolation smoke: ${error.message}`);
  process.exit(1);
});
