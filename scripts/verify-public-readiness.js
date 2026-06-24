#!/usr/bin/env node

const { execFileSync } = require('child_process');
const fs = require('fs');

const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
  .split(/\r?\n/)
  .filter(Boolean);

const forbiddenPathPrefixes = [
  'docs/artifacts/apk-color-check/',
  'web/dist/'
];

const forbiddenExactPaths = new Set([
  '.env.local',
  'server/cloudflared-config.yml'
]);

const knownCloudflaredTunnelId = ['e22a5e7f', '6e65', '4904', '9d12', 'b3bab4b9697e'].join('-');

const forbiddenContent = [
  { name: 'personal email', pattern: /yusung8307@gmail\.com/i },
  { name: 'real cloudflared credentials path', pattern: /credentials-file:\s*\/Users\//i },
  { name: 'known cloudflared tunnel id', pattern: new RegExp(knownCloudflaredTunnelId, 'i') },
  { name: 'GitHub token', pattern: /(?:ghp_|github_pat_)[A-Za-z0-9_]+/ },
  { name: 'OpenAI-style API key', pattern: /sk-[A-Za-z0-9]{20,}/ },
  { name: 'JWT-like secret token', pattern: /eyJ[A-Za-z0-9_-]{40,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/ }
];

const binaryExtensions = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.ico',
  '.woff2',
  '.apk',
  '.aab'
]);

const failures = [];

for (const file of tracked) {
  const normalized = file.replace(/\\/g, '/');
  if (forbiddenExactPaths.has(normalized)) {
    failures.push(`forbidden tracked path: ${normalized}`);
  }
  if (forbiddenPathPrefixes.some((prefix) => normalized.startsWith(prefix))) {
    failures.push(`forbidden tracked path prefix: ${normalized}`);
  }

  const dotIndex = normalized.lastIndexOf('.');
  const ext = dotIndex === -1 ? '' : normalized.slice(dotIndex).toLowerCase();
  if (binaryExtensions.has(ext)) continue;
  if (!fs.existsSync(file)) continue;

  const text = fs.readFileSync(file, 'utf8');
  for (const rule of forbiddenContent) {
    if (rule.pattern.test(text)) {
      failures.push(`${rule.name}: ${normalized}`);
    }
  }
}

if (failures.length) {
  console.error('public readiness failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`public readiness ok: scanned ${tracked.length} tracked files`);
