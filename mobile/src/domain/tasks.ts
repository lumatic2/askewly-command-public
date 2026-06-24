export type CloudTaskSourceKey = 'today' | 'deadlines' | 'backlog';
export type CloudTaskStatus = 'todo' | 'doing' | 'done' | 'held' | 'delayed' | 'archived';

export type CloudTask = {
  id: number;
  workspace_id: number;
  source_id: number;
  project_id: number | null;
  project_milestone_id: number | null;
  title: string;
  detail: string | null;
  status: CloudTaskStatus;
  due_at: string | null;
  scheduled_for: string | null;
  sort_order: number;
};

export type CloudTaskSource = {
  id: number;
  workspace_id: number;
  key: CloudTaskSourceKey;
  kind: 'today' | 'deadline' | 'backlog' | 'external';
  label: string;
  sort_order: number;
};

export type TaskSection = {
  key: CloudTaskSourceKey;
  label: string;
  source: CloudTaskSource | null;
  tasks: CloudTask[];
};

export const DEFAULT_SECTION_ORDER: CloudTaskSourceKey[] = ['today', 'deadlines', 'backlog'];
