'use strict';

const assert = require('assert');
const {
  DEFAULT_TASK_SOURCES,
  TASK_SOURCE_KEYS,
  TASK_STATUSES,
  buildTaskInsert,
  toCloudSourceKey,
  toCloudStatus,
  toLegacySourceKey,
  toLegacyStatus
} = require('../shared/tasks');

assert.deepStrictEqual(
  DEFAULT_TASK_SOURCES.map((source) => source.key),
  [TASK_SOURCE_KEYS.TODAY, TASK_SOURCE_KEYS.DEADLINES, TASK_SOURCE_KEYS.BACKLOG]
);

assert.strictEqual(toCloudSourceKey('deadline'), TASK_SOURCE_KEYS.DEADLINES);
assert.strictEqual(toCloudSourceKey('deadlines'), TASK_SOURCE_KEYS.DEADLINES);
assert.strictEqual(toLegacySourceKey('deadlines'), 'deadline');
assert.strictEqual(toCloudStatus('completed'), TASK_STATUSES.DONE);
assert.strictEqual(toLegacyStatus('archived'), 'cancelled');
assert.strictEqual(toLegacyStatus('held'), 'pending');
assert.strictEqual(toLegacyStatus('delayed'), 'pending');

const insert = buildTaskInsert({
  workspaceId: 1,
  sourceId: 2,
  title: '  Write smoke test  ',
  status: 'in_progress',
  sortOrder: 30
});

assert.deepStrictEqual(insert, {
  workspace_id: 1,
  source_id: 2,
  project_id: null,
  project_milestone_id: null,
  title: 'Write smoke test',
  detail: null,
  status: TASK_STATUSES.DOING,
  due_at: null,
  scheduled_for: null,
  sort_order: 30
});

assert.throws(() => buildTaskInsert({ workspaceId: 1, sourceId: 2, title: '   ' }), /Task title is required/);

const projectInsert = buildTaskInsert({
  workspaceId: 1,
  sourceId: 2,
  projectId: 3,
  projectMilestoneId: 4,
  title: 'Project linked task'
});
assert.strictEqual(projectInsert.project_id, 3);
assert.strictEqual(projectInsert.project_milestone_id, 4);

console.log('shared task contract verify ok: default sources, legacy mapping, status mapping, project/milestone link, insert normalization');
