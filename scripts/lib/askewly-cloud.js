'use strict';

const fs = require('fs');
const path = require('path');
const { refreshDesktopCloudSession } = require('../../main/sources/cloud-auth');

function getAppDataDir() {
  const roamingRoot = process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming');
  return path.join(roamingRoot, 'askewly-command', 'widget');
}

function normalizeBaseUrl(value) {
  return String(value || '').replace(/\/$/, '');
}

async function getCloudConfig() {
  const envUrl = normalizeBaseUrl(process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL);
  const envAnonKey = String(process.env.SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '').trim();
  const envToken = String(process.env.ASKEWLY_COMMAND_ACCESS_TOKEN || process.env.WORKSPACE_PULSE_ACCESS_TOKEN || '').trim();
  if (envUrl && envAnonKey && envToken) {
    return { supabaseUrl: envUrl, anonKey: envAnonKey, accessToken: envToken };
  }

  const appData = getAppDataDir();
  const configPath = path.join(appData, 'dashboard-config.json');
  const storagePath = path.join(appData, 'cloud-auth-storage.json');
  const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const session = await refreshDesktopCloudSession(raw.today.cloud, storagePath);
  if (!session?.access_token) throw new Error('No desktop cloud session found. Sign in with the desktop widget first.');
  return { ...raw.today.cloud, accessToken: session.access_token };
}

async function request(cloudConfig, restPath, options = {}) {
  const url = normalizeBaseUrl(cloudConfig.supabaseUrl);
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
  if (!response.ok) {
    throw new Error(`Supabase REST ${response.status}: ${await response.text()}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

async function loadWorkspaceContext(cloudConfig) {
  const workspaces = await request(cloudConfig, 'workspaces?select=id,name&order=created_at.asc&limit=1');
  const workspace = workspaces?.[0];
  if (!workspace?.id) throw new Error('No workspace found');

  const profiles = await request(cloudConfig, 'profiles?select=id&limit=1');
  const profile = profiles?.[0];
  if (!profile?.id) throw new Error('No profile found');

  return { workspace, profile };
}

async function getTaskSource(cloudConfig, workspaceId, key) {
  const sources = await request(
    cloudConfig,
    `task_sources?select=id,key,kind,label&workspace_id=eq.${workspaceId}&key=eq.${encodeURIComponent(key)}&limit=1`
  );
  const source = sources?.[0];
  if (!source?.id) throw new Error(`No task source found for ${key}`);
  return source;
}

function normalizeNullableText(value) {
  const normalized = String(value || '').trim();
  return normalized ? normalized : null;
}

function normalizeName(value) {
  return String(value || '').trim().toLowerCase();
}

module.exports = {
  getCloudConfig,
  getTaskSource,
  loadWorkspaceContext,
  normalizeName,
  normalizeNullableText,
  request
};
