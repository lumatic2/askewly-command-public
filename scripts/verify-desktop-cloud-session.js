'use strict';

const fs = require('fs');
const path = require('path');
const { refreshDesktopCloudSession } = require('../main/sources/cloud-auth');
const { loadCloudScheduleState } = require('../main/sources/cloud-schedule-source');

function getAppDataDir() {
  const roamingRoot = process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming');
  return path.join(roamingRoot, 'askewly-command', 'widget');
}

async function main() {
  const appData = getAppDataDir();
  const configPath = path.join(appData, 'dashboard-config.json');
  const storagePath = path.join(appData, 'cloud-auth-storage.json');
  if (!fs.existsSync(configPath)) throw new Error(`Missing dashboard config: ${configPath}`);
  if (!fs.existsSync(storagePath)) throw new Error(`Missing desktop cloud auth storage: ${storagePath}`);

  const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const cloud = raw.today?.cloud || {};
  if (!cloud.enabled) throw new Error('Desktop cloud mode is not enabled');
  if (!cloud.supabaseUrl || !cloud.anonKey) throw new Error('Desktop cloud mode is missing Supabase URL or anon key');

  const session = await refreshDesktopCloudSession(cloud, storagePath);
  if (!session?.access_token) throw new Error('Desktop cloud session is missing');

  const state = await loadCloudScheduleState({ ...cloud, accessToken: session.access_token });
  const counts = {
    today: state.today.length,
    deadlines: state.deadlines.length,
    backlog: state.backlog.length,
    archived: state.archived.length
  };
  const activeCount = counts.today + counts.deadlines + counts.backlog;
  if (activeCount < 1) throw new Error('Desktop cloud session loaded zero active tasks');

  console.log(`desktop cloud session ok: ${session.user?.email || 'unknown user'}`);
  console.log(`workspace: ${state.workspace?.name || 'unknown'} (${state.workspace?.id || 'unknown'})`);
  console.log(`counts: today=${counts.today} deadlines=${counts.deadlines} backlog=${counts.backlog} archived=${counts.archived}`);
}

main().catch((error) => {
  console.error(`FAIL desktop cloud session: ${error.message}`);
  process.exit(1);
});
