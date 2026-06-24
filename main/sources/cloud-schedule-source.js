'use strict';

const {
  TASK_SOURCE_KEYS,
  TASK_STATUSES,
  toCloudSourceKey,
  toCloudStatus,
  toLegacySourceKey,
  toLegacyStatus
} = require('../../shared/tasks');
const { buildCommandOverview } = require('../../shared/command-overview');

function isCloudScheduleEnabled(config = {}) {
  return config.enabled === true || getEnv('SCHEDULE_MODE') === 'cloud';
}

function createClient(config = {}) {
  const url = String(config.supabaseUrl || process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const anonKey = String(config.anonKey || process.env.SUPABASE_ANON_KEY || '').trim();
  const accessToken = String(config.accessToken || getEnv('SUPABASE_ACCESS_TOKEN') || '').trim();

  if (!url || !anonKey) {
    throw new Error('Cloud schedule mode requires SUPABASE_URL and SUPABASE_ANON_KEY');
  }
  if (!accessToken) {
    throw new Error('Cloud schedule mode requires ASKEWLY_COMMAND_SUPABASE_ACCESS_TOKEN');
  }

  async function request(path, options = {}) {
    const response = await fetch(`${url}/rest/v1/${path}`, {
      method: options.method || 'GET',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Prefer: options.prefer || 'return=representation',
        ...(options.headers || {})
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Supabase REST ${response.status}: ${detail || response.statusText}`);
    }

    if (response.status === 204) return null;
    return response.json();
  }

  return { request };
}

function getEnv(name) {
  return process.env[`ASKEWLY_COMMAND_${name}`] || process.env[`WORKSPACE_PULSE_${name}`] || '';
}

async function loadCloudScheduleState(config = {}) {
  const client = createClient(config);
  const workspaces = await client.request('workspaces?select=id,name&order=created_at.asc&limit=1');
  const workspace = workspaces && workspaces[0];
  if (!workspace) return emptyState('cloud');

  const sources = await client.request(
    `task_sources?select=id,workspace_id,key,kind,label,sort_order&workspace_id=eq.${workspace.id}&order=sort_order.asc`
  );
  const todayDate = kstDateString();
  await rolloverCloudTodayTasks(client, workspace, sources, todayDate);
  const sourceIds = sources.map((source) => source.id);
  const tasks = sourceIds.length > 0
    ? await client.request(
      `tasks?select=id,workspace_id,source_id,project_id,project_milestone_id,title,detail,status,due_at,scheduled_for,sort_order,created_at,archived_at,projects(name),project_milestones(title)&workspace_id=eq.${workspace.id}&order=sort_order.asc&order=created_at.asc`
    )
    : [];
  const activeTasks = tasks.filter((task) => task.status !== TASK_STATUSES.ARCHIVED);
  const archivedTasks = tasks.filter((task) => task.status === TASK_STATUSES.ARCHIVED);
  const projects = await client.request(
    `projects?select=id,workspace_id,name,north_star,status,sort_order,archived_at&workspace_id=eq.${workspace.id}&archived_at=is.null&order=sort_order.asc&order=created_at.asc`
  );
  const milestones = await client.request(
    `project_milestones?select=id,workspace_id,project_id,title,status,target_date,sort_order,archived_at&workspace_id=eq.${workspace.id}&archived_at=is.null&order=sort_order.asc&order=created_at.asc`
  );
  const links = await client.request(
    `project_links?select=id,workspace_id,project_id,project_milestone_id,title,kind,target,sort_order,archived_at&workspace_id=eq.${workspace.id}&archived_at=is.null&order=sort_order.asc&order=created_at.asc`
  );

  return {
    source: 'cloud',
    workspace,
    projects: projects.map(mapProjectOption),
    milestones: milestones.map(mapMilestoneOption),
    today: mapTasks(activeTasks, sources, TASK_SOURCE_KEYS.TODAY, { todayDate }),
    deadlines: mapTasks(activeTasks, sources, TASK_SOURCE_KEYS.DEADLINES),
    recurring: [],
    backlog: mapTasks(activeTasks, sources, TASK_SOURCE_KEYS.BACKLOG),
    archived: mapArchivedTasks(archivedTasks, sources),
    commandOverview: buildCommandOverview({
      todayTasks: mapTasks(activeTasks, sources, TASK_SOURCE_KEYS.TODAY, { todayDate }),
      deadlineTasks: mapTasks(activeTasks, sources, TASK_SOURCE_KEYS.DEADLINES),
      backlogTasks: mapTasks(activeTasks, sources, TASK_SOURCE_KEYS.BACKLOG),
      projects,
      milestones,
      links
    }),
    statusSummary: `${activeTasks.length} active cloud task${activeTasks.length === 1 ? '' : 's'}`
  };
}

async function addCloudScheduleItem(config = {}, payload = {}) {
  const { client, workspace, source } = await resolveMutationTarget(config, payload.target || 'today');
  const title = String(payload.text || '').trim();
  if (!title) throw new Error('Task text is required');
  const userId = await getUserId(client);
  const body = {
    workspace_id: workspace.id,
    source_id: source.id,
    title,
    status: TASK_STATUSES.TODO,
    sort_order: nextSortOrder(),
    created_by: userId,
    updated_by: userId,
    ...dateFieldsForSource(source.key)
  };
  await client.request('tasks', { method: 'POST', body });
  return loadCloudScheduleState(config);
}

async function updateCloudScheduleItem(config = {}, payload = {}) {
  const client = createClient(config);
  const taskId = Number(payload.lineIndex);
  const nextStatus = toCloudStatus(payload.nextStatus || 'pending');
  const userId = await getUserId(client);
  const body = {
    status: nextStatus,
    updated_by: userId,
    archived_at: nextStatus === TASK_STATUSES.ARCHIVED ? new Date().toISOString() : null
  };
  await client.request(`tasks?id=eq.${taskId}`, { method: 'PATCH', body });
  return loadCloudScheduleState(config);
}

async function updateCloudScheduleItemText(config = {}, payload = {}) {
  const client = createClient(config);
  const taskId = Number(payload.lineIndex);
  const title = String(payload.newText || '').trim();
  if (!title) throw new Error('New text required');
  const userId = await getUserId(client);
  await client.request(`tasks?id=eq.${taskId}`, {
    method: 'PATCH',
    body: { title, updated_by: userId }
  });
  return loadCloudScheduleState(config);
}

async function updateCloudScheduleItemGraph(config = {}, payload = {}) {
  const client = createClient(config);
  const taskId = Number(payload.lineIndex);
  if (!Number.isFinite(taskId) || taskId <= 0) throw new Error('Valid task id required');

  const projectId = normalizeNullableId(payload.projectId);
  const milestoneId = normalizeNullableId(payload.projectMilestoneId);
  const taskRows = await client.request(`tasks?select=id,workspace_id&id=eq.${taskId}&limit=1`);
  const task = taskRows && taskRows[0];
  if (!task) throw new Error('Task not found');

  let project = null;
  if (projectId !== null) {
    const projectRows = await client.request(
      `projects?select=id,workspace_id,name&workspace_id=eq.${task.workspace_id}&id=eq.${projectId}&archived_at=is.null&limit=1`
    );
    project = projectRows && projectRows[0];
    if (!project) throw new Error('Project not found');
  }

  if (milestoneId !== null) {
    if (projectId === null) throw new Error('Milestone requires a project');
    const milestoneRows = await client.request(
      `project_milestones?select=id,workspace_id,project_id,title&workspace_id=eq.${task.workspace_id}&project_id=eq.${projectId}&id=eq.${milestoneId}&archived_at=is.null&limit=1`
    );
    const milestone = milestoneRows && milestoneRows[0];
    if (!milestone) throw new Error('Milestone does not belong to selected project');
  }

  const userId = await getUserId(client);
  await client.request(`tasks?id=eq.${taskId}`, {
    method: 'PATCH',
    body: {
      project_id: project ? project.id : null,
      project_milestone_id: milestoneId,
      updated_by: userId
    }
  });
  return loadCloudScheduleState(config);
}

async function deleteCloudScheduleItem(config = {}, payload = {}) {
  const client = createClient(config);
  const taskId = Number(payload.lineIndex);
  const userId = await getUserId(client);
  await client.request(`tasks?id=eq.${taskId}`, {
    method: 'PATCH',
    body: {
      status: TASK_STATUSES.ARCHIVED,
      archived_at: new Date().toISOString(),
      updated_by: userId
    }
  });
  return loadCloudScheduleState(config);
}

async function moveCloudScheduleItem(config = {}, payload = {}) {
  const { client, workspace, source } = await resolveMutationTarget(config, payload.targetKey);
  const taskId = Number(payload.lineIndex);
  const userId = await getUserId(client);
  const targetTaskId = Number(payload.targetLineIndex);
  const hasTargetPosition = Number.isFinite(targetTaskId);
  await client.request(`tasks?id=eq.${taskId}`, {
    method: 'PATCH',
    body: {
      source_id: source.id,
      sort_order: nextSortOrder(),
      updated_by: userId,
      ...dateFieldsForSource(source.key)
    }
  });

  if (hasTargetPosition) {
    await reorderCloudTaskInSource(client, workspace, source, taskId, targetTaskId, payload.position);
  }
  return loadCloudScheduleState(config);
}

async function reorderCloudScheduleItem(config = {}, payload = {}) {
  const { client, workspace, source } = await resolveMutationTarget(config, payload.sourceKey);
  const movingTaskId = Number(payload.fromLineIndex);
  const targetTaskId = Number(payload.targetLineIndex);
  await reorderCloudTaskInSource(client, workspace, source, movingTaskId, targetTaskId, payload.position);
  return loadCloudScheduleState(config);
}

async function reorderCloudTaskInSource(client, workspace, source, movingTaskId, targetTaskId, position) {
  if (!Number.isFinite(movingTaskId) || !Number.isFinite(targetTaskId) || movingTaskId === targetTaskId) {
    return;
  }

  const tasks = await client.request(
    `tasks?select=id,sort_order,created_at&workspace_id=eq.${workspace.id}&source_id=eq.${source.id}&status=neq.${TASK_STATUSES.ARCHIVED}&order=sort_order.asc&order=created_at.asc`
  );
  const ordered = Array.isArray(tasks) ? [...tasks] : [];
  const fromIndex = ordered.findIndex((task) => Number(task.id) === movingTaskId);
  const targetIndex = ordered.findIndex((task) => Number(task.id) === targetTaskId);
  if (fromIndex === -1 || targetIndex === -1) {
    return;
  }

  const [movingTask] = ordered.splice(fromIndex, 1);
  const adjustedTargetIndex = ordered.findIndex((task) => Number(task.id) === targetTaskId);
  const insertIndex = position === 'below' ? adjustedTargetIndex + 1 : adjustedTargetIndex;
  ordered.splice(Math.max(0, insertIndex), 0, movingTask);

  const userId = await getUserId(client);
  await Promise.all(ordered.map((task, index) => client.request(`tasks?id=eq.${task.id}`, {
    method: 'PATCH',
    body: {
      sort_order: (index + 1) * 1000,
      updated_by: userId
    },
    prefer: 'return=minimal'
  })));
}

async function restoreCloudArchivedItem(config = {}, payload = {}) {
  const client = createClient(config);
  const taskId = Number(payload.lineIndex);
  const userId = await getUserId(client);
  await client.request(`tasks?id=eq.${taskId}`, {
    method: 'PATCH',
    body: { status: TASK_STATUSES.TODO, archived_at: null, updated_by: userId }
  });
  return loadCloudScheduleState(config);
}

async function resolveMutationTarget(config, target) {
  const client = createClient(config);
  const workspaces = await client.request('workspaces?select=id,name&order=created_at.asc&limit=1');
  const workspace = workspaces && workspaces[0];
  if (!workspace) throw new Error('No cloud workspace found');
  const cloudKey = toCloudSourceKey(target);
  const sources = await client.request(
    `task_sources?select=id,workspace_id,key,kind,label,sort_order&workspace_id=eq.${workspace.id}&key=eq.${cloudKey}&limit=1`
  );
  const source = sources && sources[0];
  if (!source) throw new Error(`No cloud source found for ${cloudKey}`);
  return { client, workspace, source };
}

async function getUserId(client) {
  const users = await client.request('profiles?select=id&limit=1');
  const profile = users && users[0];
  if (!profile) throw new Error('No profile found for cloud session');
  return profile.id;
}

function mapTasks(tasks, sources, cloudKey, options = {}) {
  const source = sources.find((candidate) => candidate.key === cloudKey);
  if (!source) return [];
  const legacyKey = toLegacySourceKey(cloudKey);
  return tasks
    .filter((task) => task.source_id === source.id)
    .filter((task) => cloudKey !== TASK_SOURCE_KEYS.TODAY || !options.todayDate || task.scheduled_for === options.todayDate)
    .map((task) => mapTaskRecord(task, source, legacyKey));
}

function mapArchivedTasks(tasks, sources) {
  return tasks
    .map((task) => {
      const source = sources.find((candidate) => candidate.id === task.source_id);
      if (!source) return null;
      return mapTaskRecord(task, source, toLegacySourceKey(source.key), { archived: true });
    })
    .filter(Boolean)
    .sort((left, right) => String(right.archivedAt || '').localeCompare(String(left.archivedAt || '')));
}

function mapTaskRecord(task, source, legacyKey, options = {}) {
  const visibleDetail = getVisibleTaskDetail(task.detail);
  return {
    id: `cloud:${task.id}`,
    title: task.title,
    text: task.title,
    detail: visibleDetail,
    rawText: visibleDetail ? `${task.title} | ${visibleDetail}` : task.title,
    status: toLegacyStatus(task.status),
    cloudStatus: task.status,
    priority: '-',
    sourceKey: legacyKey,
    source_key: legacyKey,
    section: source.label,
    lineIndex: task.id,
    sortOrder: task.sort_order,
    dueAt: task.due_at,
    scheduledFor: task.scheduled_for,
    archivedAt: task.archived_at || null,
    projectId: task.project_id || null,
    projectMilestoneId: task.project_milestone_id || null,
    projectName: task.projects?.name || '',
    projectMilestoneName: task.project_milestones?.title || '',
    ...(options.archived ? { archived: true } : {})
  };
}

function getVisibleTaskDetail(rawDetail) {
  const detail = String(rawDetail || '').trim();
  if (!detail) return '';
  if (!detail.startsWith('{') && !detail.startsWith('[')) return detail;

  try {
    const parsed = JSON.parse(detail);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const keys = Object.keys(parsed);
      const metadataKeys = ['importedFrom', 'sourcePath', 'lineIndex', 'section', 'subsection', 'priority'];
      if (keys.some((key) => metadataKeys.includes(key))) return '';
    }
  } catch {
    return detail;
  }
  return detail;
}

function mapProjectOption(project) {
  return {
    id: project.id,
    name: project.name || '',
    northStar: project.north_star || '',
    status: project.status || ''
  };
}

function mapMilestoneOption(milestone) {
  return {
    id: milestone.id,
    projectId: milestone.project_id || null,
    title: milestone.title || '',
    status: milestone.status || '',
    targetDate: milestone.target_date || ''
  };
}

function normalizeNullableId(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return numeric;
}

function dateFieldsForSource(sourceKey) {
  if (sourceKey === TASK_SOURCE_KEYS.TODAY) {
    return { scheduled_for: new Date().toISOString().slice(0, 10), due_at: null };
  }
  if (sourceKey === TASK_SOURCE_KEYS.DEADLINES) {
    return { scheduled_for: null, due_at: new Date().toISOString() };
  }
  return { scheduled_for: null, due_at: null };
}

function nextSortOrder() {
  return Math.floor(Date.now() / 1000);
}

async function rolloverCloudTodayTasks(client, workspace, sources, todayDate) {
  const todaySource = sources.find((candidate) => candidate.key === TASK_SOURCE_KEYS.TODAY);
  if (!todaySource) return;
  const userId = await getUserId(client);
  await client.request(
    `tasks?workspace_id=eq.${workspace.id}&source_id=eq.${todaySource.id}&scheduled_for=lt.${todayDate}&status=in.(todo,doing,held,delayed)`,
    {
      method: 'PATCH',
      body: { scheduled_for: todayDate, due_at: null, updated_by: userId },
      prefer: 'return=minimal'
    }
  );
  await client.request(
    `tasks?workspace_id=eq.${workspace.id}&source_id=eq.${todaySource.id}&scheduled_for=lt.${todayDate}&status=eq.done`,
    {
      method: 'PATCH',
      body: { status: TASK_STATUSES.ARCHIVED, archived_at: new Date().toISOString(), updated_by: userId },
      prefer: 'return=minimal'
    }
  );
}

function kstDateString(date = new Date()) {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function emptyState(source) {
  return {
    source,
    today: [],
    deadlines: [],
    recurring: [],
    backlog: [],
    archived: [],
    statusSummary: 'No cloud tasks'
  };
}

module.exports = {
  addCloudScheduleItem,
  deleteCloudScheduleItem,
  isCloudScheduleEnabled,
  loadCloudScheduleState,
  moveCloudScheduleItem,
  reorderCloudScheduleItem,
  restoreCloudArchivedItem,
  updateCloudScheduleItem,
  updateCloudScheduleItemGraph,
  updateCloudScheduleItemText
};
