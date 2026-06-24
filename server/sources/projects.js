const fs = require('fs');
const config = require('../config');

function getProjectsSnapshot() {
  try {
    const raw = fs.readFileSync(config.PROJECTS_SNAPSHOT, 'utf8');
    const data = JSON.parse(raw);
    return { ...data, fromSnapshot: true, snapshotReadAt: new Date().toISOString() };
  } catch (_) {
    return { items: [], fromSnapshot: true, stale: true, scannedAt: null, error: 'No snapshot. Open the desktop app on Windows to generate one.' };
  }
}

module.exports = { getProjectsSnapshot };
