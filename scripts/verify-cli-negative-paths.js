'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const checks = [
  {
    name: 'invalid section',
    args: ['scripts/askewly-command.js', 'tasks', 'add', '--title', 'bad section smoke', '--section', 'someday', '--json'],
    message: 'Invalid section: someday'
  },
  {
    name: 'invalid status',
    args: ['scripts/askewly-command.js', 'tasks', 'status', '--id', '1', '--status', 'maybe', '--json'],
    message: 'Invalid status: maybe'
  },
  {
    name: 'missing title',
    args: ['scripts/askewly-command.js', 'tasks', 'add', '--section', 'today', '--json'],
    message: '--title is required'
  },
  {
    name: 'invalid limit',
    args: ['scripts/askewly-command.js', 'tasks', 'list', '--limit', '500', '--json'],
    message: '--limit must be an integer between 1 and 100'
  },
  {
    name: 'unknown command',
    args: ['scripts/askewly-command.js', 'tasks', 'frobnicate', '--json'],
    message: 'Unknown command: tasks frobnicate'
  }
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

for (const check of checks) {
  const result = spawnSync(process.execPath, check.args, {
    cwd: ROOT,
    encoding: 'utf8'
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  assert(result.status === 1, `${check.name}: expected exit 1, got ${result.status}\n${output}`);
  assert(output.includes(check.message), `${check.name}: missing message "${check.message}"\n${output}`);
  assert(!output.includes('Assertion failed'), `${check.name}: process assertion leaked\n${output}`);
  console.log(`${check.name}: ok`);
}

console.log('cli negative paths ok');
