'use strict';

const TASK_SOURCE_KEYS = Object.freeze({
  TODAY: 'today',
  DEADLINES: 'deadlines',
  BACKLOG: 'backlog'
});

const TASK_SOURCE_KINDS = Object.freeze({
  TODAY: 'today',
  DEADLINE: 'deadline',
  BACKLOG: 'backlog',
  EXTERNAL: 'external'
});

const LEGACY_SOURCE_KEYS = Object.freeze({
  TODAY: 'today',
  DEADLINE: 'deadline',
  DEADLINES: 'deadlines',
  RECURRING: 'recurring',
  BACKLOG: 'backlog'
});

const TASK_STATUSES = Object.freeze({
  TODO: 'todo',
  DOING: 'doing',
  DONE: 'done',
  HELD: 'held',
  DELAYED: 'delayed',
  ARCHIVED: 'archived'
});

const PROJECT_STATUSES = Object.freeze({
  ACTIVE: 'active',
  PAUSED: 'paused',
  ARCHIVED: 'archived'
});

const PROJECT_MILESTONE_STATUSES = Object.freeze({
  PLANNED: 'planned',
  ACTIVE: 'active',
  DONE: 'done',
  ARCHIVED: 'archived'
});

const LEGACY_STATUSES = Object.freeze({
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled'
});

const LEGACY_TO_CLOUD_STATUS = Object.freeze({
  [LEGACY_STATUSES.PENDING]: TASK_STATUSES.TODO,
  [LEGACY_STATUSES.IN_PROGRESS]: TASK_STATUSES.DOING,
  [LEGACY_STATUSES.COMPLETED]: TASK_STATUSES.DONE,
  [LEGACY_STATUSES.CANCELLED]: TASK_STATUSES.ARCHIVED
});

const CLOUD_TO_LEGACY_STATUS = Object.freeze({
  [TASK_STATUSES.TODO]: LEGACY_STATUSES.PENDING,
  [TASK_STATUSES.DOING]: LEGACY_STATUSES.IN_PROGRESS,
  [TASK_STATUSES.DONE]: LEGACY_STATUSES.COMPLETED,
  [TASK_STATUSES.HELD]: LEGACY_STATUSES.PENDING,
  [TASK_STATUSES.DELAYED]: LEGACY_STATUSES.PENDING,
  [TASK_STATUSES.ARCHIVED]: LEGACY_STATUSES.CANCELLED
});

const LEGACY_TO_CLOUD_SOURCE_KEY = Object.freeze({
  [LEGACY_SOURCE_KEYS.TODAY]: TASK_SOURCE_KEYS.TODAY,
  [LEGACY_SOURCE_KEYS.DEADLINE]: TASK_SOURCE_KEYS.DEADLINES,
  [LEGACY_SOURCE_KEYS.DEADLINES]: TASK_SOURCE_KEYS.DEADLINES,
  [LEGACY_SOURCE_KEYS.BACKLOG]: TASK_SOURCE_KEYS.BACKLOG
});

const CLOUD_TO_LEGACY_SOURCE_KEY = Object.freeze({
  [TASK_SOURCE_KEYS.TODAY]: LEGACY_SOURCE_KEYS.TODAY,
  [TASK_SOURCE_KEYS.DEADLINES]: LEGACY_SOURCE_KEYS.DEADLINE,
  [TASK_SOURCE_KEYS.BACKLOG]: LEGACY_SOURCE_KEYS.BACKLOG
});

const DEFAULT_TASK_SOURCES = Object.freeze([
  Object.freeze({ key: TASK_SOURCE_KEYS.TODAY, kind: TASK_SOURCE_KINDS.TODAY, label: 'Today', sortOrder: 10 }),
  Object.freeze({ key: TASK_SOURCE_KEYS.DEADLINES, kind: TASK_SOURCE_KINDS.DEADLINE, label: 'Deadlines', sortOrder: 20 }),
  Object.freeze({ key: TASK_SOURCE_KEYS.BACKLOG, kind: TASK_SOURCE_KINDS.BACKLOG, label: 'Backlog', sortOrder: 30 })
]);

/**
 * @typedef {'today'|'deadlines'|'backlog'} TaskSourceKey
 * @typedef {'today'|'deadline'|'backlog'|'external'} TaskSourceKind
 * @typedef {'todo'|'doing'|'done'|'held'|'delayed'|'archived'} TaskStatus
 * @typedef {'pending'|'in_progress'|'completed'|'cancelled'} LegacyTaskStatus
 * @typedef {'today'|'deadline'|'deadlines'|'recurring'|'backlog'} LegacySourceKey
 *
 * @typedef {Object} TaskSource
 * @property {number|string} id
 * @property {number|string} workspaceId
 * @property {TaskSourceKey|string} key
 * @property {TaskSourceKind} kind
 * @property {string} label
 * @property {number} sortOrder
 *
 * @typedef {Object} WorkspaceTask
 * @property {number|string} id
 * @property {number|string} workspaceId
 * @property {number|string} sourceId
 * @property {number|string|null=} projectId
 * @property {number|string|null=} projectMilestoneId
 * @property {string} title
 * @property {string=} detail
 * @property {TaskStatus} status
 * @property {string|null=} dueAt
 * @property {string|null=} scheduledFor
 * @property {number} sortOrder
 * @property {string|null=} archivedAt
 * @property {string} createdBy
 * @property {string|null=} updatedBy
 * @property {string} createdAt
 * @property {string} updatedAt
 */

function valuesOf(object) {
  return Object.keys(object).map((key) => object[key]);
}

function isTaskSourceKey(value) {
  return valuesOf(TASK_SOURCE_KEYS).includes(value);
}

function isTaskSourceKind(value) {
  return valuesOf(TASK_SOURCE_KINDS).includes(value);
}

function isTaskStatus(value) {
  return valuesOf(TASK_STATUSES).includes(value);
}

function isLegacySourceKey(value) {
  return valuesOf(LEGACY_SOURCE_KEYS).includes(value);
}

function isLegacyStatus(value) {
  return valuesOf(LEGACY_STATUSES).includes(value);
}

function toCloudStatus(value) {
  if (isTaskStatus(value)) return value;
  return LEGACY_TO_CLOUD_STATUS[value] || TASK_STATUSES.TODO;
}

function toLegacyStatus(value) {
  if (isLegacyStatus(value)) return value;
  return CLOUD_TO_LEGACY_STATUS[value] || LEGACY_STATUSES.PENDING;
}

function toCloudSourceKey(value) {
  if (isTaskSourceKey(value)) return value;
  return LEGACY_TO_CLOUD_SOURCE_KEY[value] || TASK_SOURCE_KEYS.TODAY;
}

function toLegacySourceKey(value) {
  if (isLegacySourceKey(value) && value !== LEGACY_SOURCE_KEYS.DEADLINES) return value;
  return CLOUD_TO_LEGACY_SOURCE_KEY[value] || LEGACY_SOURCE_KEYS.TODAY;
}

function taskSourceKindForKey(value) {
  const key = toCloudSourceKey(value);
  if (key === TASK_SOURCE_KEYS.DEADLINES) return TASK_SOURCE_KINDS.DEADLINE;
  if (key === TASK_SOURCE_KEYS.BACKLOG) return TASK_SOURCE_KINDS.BACKLOG;
  return TASK_SOURCE_KINDS.TODAY;
}

function normalizeTaskTitle(value) {
  return String(value || '').trim();
}

function buildTaskInsert(input) {
  const title = normalizeTaskTitle(input && (input.title || input.text || input.rawText));
  if (!title) throw new Error('Task title is required');

  return {
    workspace_id: input.workspaceId,
    source_id: input.sourceId,
    project_id: input.projectId || null,
    project_milestone_id: input.projectMilestoneId || null,
    title,
    detail: input.detail || null,
    status: toCloudStatus(input.status),
    due_at: input.dueAt || null,
    scheduled_for: input.scheduledFor || null,
    sort_order: Number.isFinite(Number(input.sortOrder)) ? Number(input.sortOrder) : 0
  };
}

module.exports = {
  TASK_SOURCE_KEYS,
  TASK_SOURCE_KINDS,
  LEGACY_SOURCE_KEYS,
  TASK_STATUSES,
  PROJECT_STATUSES,
  PROJECT_MILESTONE_STATUSES,
  LEGACY_STATUSES,
  LEGACY_TO_CLOUD_STATUS,
  CLOUD_TO_LEGACY_STATUS,
  LEGACY_TO_CLOUD_SOURCE_KEY,
  CLOUD_TO_LEGACY_SOURCE_KEY,
  DEFAULT_TASK_SOURCES,
  isTaskSourceKey,
  isTaskSourceKind,
  isTaskStatus,
  isLegacySourceKey,
  isLegacyStatus,
  toCloudStatus,
  toLegacyStatus,
  toCloudSourceKey,
  toLegacySourceKey,
  taskSourceKindForKey,
  normalizeTaskTitle,
  buildTaskInsert
};
