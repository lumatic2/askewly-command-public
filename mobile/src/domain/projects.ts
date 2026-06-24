export type CloudProjectStatus = 'active' | 'paused' | 'archived';
export type CloudProjectMilestoneStatus = 'planned' | 'active' | 'done' | 'archived';

export type CloudProject = {
  id: number;
  workspace_id: number;
  name: string;
  north_star: string | null;
  description: string | null;
  status: CloudProjectStatus;
  github_url: string | null;
  current_horizon: string | null;
  roadmap_note: string | null;
  sort_order: number;
  archived_at: string | null;
};

export type CloudProjectPatch = {
  name?: string;
  north_star?: string | null;
  description?: string | null;
  status?: CloudProjectStatus;
  github_url?: string | null;
  current_horizon?: string | null;
  roadmap_note?: string | null;
  sort_order?: number;
  archived_at?: string | null;
};

export type CloudProjectMilestone = {
  id: number;
  workspace_id: number;
  project_id: number;
  title: string;
  description: string | null;
  status: CloudProjectMilestoneStatus;
  target_date: string | null;
  sort_order: number;
  archived_at: string | null;
};

export type CloudProjectMilestonePatch = {
  title?: string;
  description?: string | null;
  status?: CloudProjectMilestoneStatus;
  target_date?: string | null;
  sort_order?: number;
  archived_at?: string | null;
};

export type CloudProjectLinkKind = 'obsidian' | 'github' | 'url' | 'file';

export type CloudProjectLink = {
  id: number;
  workspace_id: number;
  project_id: number;
  project_milestone_id: number | null;
  title: string;
  kind: CloudProjectLinkKind;
  target: string;
  sort_order: number;
  archived_at: string | null;
};

export type CloudProjectLinkPatch = {
  title?: string;
  kind?: CloudProjectLinkKind;
  target?: string;
  project_milestone_id?: number | null;
  sort_order?: number;
  archived_at?: string | null;
};
