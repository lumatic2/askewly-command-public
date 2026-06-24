const os = require('os');
const path = require('path');

function getEnv(name) {
  return process.env[`ASKEWLY_COMMAND_${name}`] || process.env[`WORKSPACE_PULSE_${name}`] || '';
}

module.exports = {
  PORT: process.env.PORT || 3001,
  VAULT_ROOT: process.env.VAULT_ROOT || path.join(os.homedir(), 'vault'),
  SCHEDULE_DIR: process.env.SCHEDULE_DIR || path.join(os.homedir(), 'vault', '30-projects', 'schedule'),
  LEGACY_SCHEDULE_ENABLED: getEnv('LEGACY_SCHEDULE_ENABLED') === '1',
  PRIVATE_API_ENABLED: getEnv('PRIVATE_API_ENABLED') === '1',
  PROJECTS_SNAPSHOT: process.env.PROJECTS_SNAPSHOT || path.join(os.homedir(), 'projects-snapshot.json'),
  NOTION_TOKEN: process.env.NOTION_TOKEN || process.env.PERSONAL_NOTION_TOKEN || '',
  SSH_HOST: process.env.SSH_HOST || 'user@m4'
};

