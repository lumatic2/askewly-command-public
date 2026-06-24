import {
  CloudTask,
  CloudTaskSource,
  CloudTaskSourceKey,
  CloudTaskStatus,
  DEFAULT_SECTION_ORDER,
  TaskSection
} from '../domain/tasks';
import { supabase } from './supabase';

type WorkspaceRow = {
  id: number;
  name: string;
};

type LoadTaskSectionsResult = {
  workspace: WorkspaceRow | null;
  sections: TaskSection[];
};

type TaskPatch = {
  title?: string;
  detail?: string | null;
  status?: CloudTaskStatus;
  sort_order?: number;
  project_id?: number | null;
  project_milestone_id?: number | null;
};

type TaskCreateOptions = {
  project_id?: number | null;
  project_milestone_id?: number | null;
};

const TASK_SELECT = 'id,workspace_id,source_id,project_id,project_milestone_id,title,detail,status,due_at,scheduled_for,sort_order,created_at';

export async function loadTaskSections(): Promise<LoadTaskSectionsResult> {
  const { data: workspaces, error: workspaceError } = await supabase
    .from('workspaces')
    .select('id,name')
    .order('created_at', { ascending: true })
    .limit(1);

  if (workspaceError) throw workspaceError;
  const workspace = (workspaces?.[0] as WorkspaceRow | undefined) || null;
  if (!workspace) return { workspace: null, sections: [] };

  const { data: sources, error: sourcesError } = await supabase
    .from('task_sources')
    .select('id,workspace_id,key,kind,label,sort_order')
    .eq('workspace_id', workspace.id)
    .order('sort_order', { ascending: true });

  if (sourcesError) throw sourcesError;

  const sourceRows = (sources || []) as CloudTaskSource[];
  const todayDate = kstDateString();
  await rolloverTodayTasks(workspace.id, sourceRows, todayDate);
  const sourceIds = sourceRows.map((source) => source.id);
  const taskResult = sourceIds.length > 0
    ? await supabase
      .from('tasks')
      .select(TASK_SELECT)
      .eq('workspace_id', workspace.id)
      .in('source_id', sourceIds)
      .neq('status', 'archived')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })
    : { data: [], error: null };

  if (taskResult.error) throw taskResult.error;
  const taskRows = (taskResult.data || []) as CloudTask[];

  const sections = DEFAULT_SECTION_ORDER.map((key) => {
    const source = sourceRows.find((candidate) => candidate.key === key);
    return {
      key,
      label: source?.label || labelForKey(key),
      source: source || null,
      tasks: source ? taskRows
        .filter((task) => task.source_id === source.id)
        .filter((task) => key !== 'today' || task.scheduled_for === todayDate) : []
    };
  });

  return { workspace, sections };
}

export async function createTask(section: TaskSection, title: string, options: TaskCreateOptions = {}): Promise<CloudTask> {
  if (!section.source) throw new Error(`${section.label} source is not available`);
  const normalizedTitle = title.trim();
  if (!normalizedTitle) throw new Error('Task title is required');

  const userId = await getUserId();
  const { data, error } = await supabase
    .from('tasks')
    .insert({
      workspace_id: section.source.workspace_id,
      source_id: section.source.id,
      title: normalizedTitle,
      project_id: options.project_id ?? null,
      project_milestone_id: options.project_milestone_id ?? null,
      status: 'todo',
      sort_order: nextSortOrder(section.tasks),
      created_by: userId,
      updated_by: userId,
      ...sectionDateFields(section.key)
    })
      .select(TASK_SELECT)
    .single();

  if (error) throw error;
  return data as CloudTask;
}

export async function updateTask(task: CloudTask, patch: TaskPatch): Promise<CloudTask> {
  const userId = await getUserId();
  const nextPatch = {
    ...patch,
    title: patch.title === undefined ? undefined : patch.title.trim(),
    detail: patch.detail === undefined ? undefined : normalizeNullableText(patch.detail),
    updated_by: userId
  };

  if (nextPatch.title !== undefined && !nextPatch.title) throw new Error('Task title is required');

  const { data, error } = await supabase
    .from('tasks')
    .update(nextPatch)
    .eq('id', task.id)
    .eq('workspace_id', task.workspace_id)
    .select(TASK_SELECT)
    .single();

  if (error) throw error;
  return data as CloudTask;
}

export async function reorderTask(task: CloudTask, sortOrder: number): Promise<CloudTask> {
  return updateTask(task, { sort_order: sortOrder });
}

export async function moveTask(task: CloudTask, targetSection: TaskSection): Promise<CloudTask> {
  if (!targetSection.source) throw new Error(`${targetSection.label} source is not available`);
  const userId = await getUserId();
  const { data, error } = await supabase
    .from('tasks')
    .update({
      source_id: targetSection.source.id,
      sort_order: nextSortOrder(targetSection.tasks),
      updated_by: userId,
      ...sectionDateFields(targetSection.key)
    })
    .eq('id', task.id)
    .eq('workspace_id', task.workspace_id)
    .select(TASK_SELECT)
    .single();

  if (error) throw error;
  return data as CloudTask;
}

export async function archiveTask(task: CloudTask): Promise<void> {
  const userId = await getUserId();
  const { error } = await supabase
    .from('tasks')
    .update({
      status: 'archived',
      archived_at: new Date().toISOString(),
      updated_by: userId
    })
    .eq('id', task.id)
    .eq('workspace_id', task.workspace_id);

  if (error) throw error;
}

function labelForKey(key: TaskSection['key']) {
  if (key === 'deadlines') return 'Deadlines';
  if (key === 'backlog') return 'Backlog';
  return 'Today';
}

function nextSortOrder(tasks: CloudTask[]) {
  const maxSortOrder = tasks.reduce((max, task) => Math.max(max, task.sort_order), 0);
  return maxSortOrder + 10;
}

function sectionDateFields(key: CloudTaskSourceKey) {
  if (key === 'today') {
    return {
      scheduled_for: kstDateString(),
      due_at: null
    };
  }
  if (key === 'deadlines') {
    return {
      scheduled_for: null,
      due_at: new Date().toISOString()
    };
  }
  return {
    scheduled_for: null,
    due_at: null
  };
}

function normalizeNullableText(value: string | null | undefined) {
  if (value === null) return null;
  if (value === undefined) return undefined;
  const normalized = value.trim();
  return normalized ? normalized : null;
}

async function getUserId() {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error('Signed-in user is required');
  return data.user.id;
}

async function rolloverTodayTasks(workspaceId: number, sources: CloudTaskSource[], todayDate: string) {
  const todaySource = sources.find((source) => source.key === 'today');
  if (!todaySource) return;
  const userId = await getUserId();
  const unfinished = await supabase
    .from('tasks')
    .update({
      scheduled_for: todayDate,
      due_at: null,
      updated_by: userId
    })
    .eq('workspace_id', workspaceId)
    .eq('source_id', todaySource.id)
    .lt('scheduled_for', todayDate)
    .in('status', ['todo', 'doing', 'held', 'delayed']);

  if (unfinished.error) throw unfinished.error;

  const completed = await supabase
    .from('tasks')
    .update({
      status: 'archived',
      archived_at: new Date().toISOString(),
      updated_by: userId
    })
    .eq('workspace_id', workspaceId)
    .eq('source_id', todaySource.id)
    .lt('scheduled_for', todayDate)
    .eq('status', 'done');

  if (completed.error) throw completed.error;
}

function kstDateString(date = new Date()) {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
