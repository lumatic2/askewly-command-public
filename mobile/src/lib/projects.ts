import {
  CloudProject,
  CloudProjectLink,
  CloudProjectLinkKind,
  CloudProjectLinkPatch,
  CloudProjectMilestone,
  CloudProjectMilestonePatch,
  CloudProjectPatch
} from '../domain/projects';
import { TaskSection } from '../domain/tasks';
import { supabase } from './supabase';
import { createTask } from './tasks';

type WorkspaceRow = {
  id: number;
  name: string;
};

export type LoadProjectsResult = {
  workspace: WorkspaceRow | null;
  projects: CloudProject[];
  milestones: CloudProjectMilestone[];
  links: CloudProjectLink[];
};

const PROJECT_SELECT = 'id,workspace_id,name,north_star,description,status,github_url,current_horizon,roadmap_note,sort_order,archived_at,created_at';
const MILESTONE_SELECT = 'id,workspace_id,project_id,title,description,status,target_date,sort_order,archived_at,created_at';
const LINK_SELECT = 'id,workspace_id,project_id,project_milestone_id,title,kind,target,sort_order,archived_at,created_at';

export async function loadProjects(): Promise<LoadProjectsResult> {
  const { data: workspaces, error: workspaceError } = await supabase
    .from('workspaces')
    .select('id,name')
    .order('created_at', { ascending: true })
    .limit(1);

  if (workspaceError) throw workspaceError;
  const workspace = (workspaces?.[0] as WorkspaceRow | undefined) || null;
  if (!workspace) return { workspace: null, projects: [], milestones: [], links: [] };

  const { data, error } = await supabase
    .from('projects')
    .select(PROJECT_SELECT)
    .eq('workspace_id', workspace.id)
    .neq('status', 'archived')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) throw error;
  const projects = (data || []) as CloudProject[];
  const projectIds = projects.map((project) => project.id);
  const milestoneResult = projectIds.length > 0
    ? await supabase
      .from('project_milestones')
      .select(MILESTONE_SELECT)
      .eq('workspace_id', workspace.id)
      .in('project_id', projectIds)
      .neq('status', 'archived')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })
    : { data: [], error: null };

  if (milestoneResult.error) throw milestoneResult.error;
  const linkResult = projectIds.length > 0
    ? await supabase
      .from('project_links')
      .select(LINK_SELECT)
      .eq('workspace_id', workspace.id)
      .in('project_id', projectIds)
      .is('archived_at', null)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })
    : { data: [], error: null };

  if (linkResult.error) throw linkResult.error;
  return {
    workspace,
    projects,
    milestones: (milestoneResult.data || []) as CloudProjectMilestone[],
    links: (linkResult.data || []) as CloudProjectLink[]
  };
}

export async function createProject(workspaceId: number, name: string): Promise<CloudProject> {
  const normalizedName = name.trim();
  if (!normalizedName) throw new Error('Project name is required');
  const userId = await getUserId();
  const { data, error } = await supabase
    .from('projects')
    .insert({
      workspace_id: workspaceId,
      name: normalizedName,
      status: 'active',
      sort_order: Math.floor(Date.now() / 1000),
      created_by: userId,
      updated_by: userId
    })
    .select(PROJECT_SELECT)
    .single();

  if (error) throw error;
  return data as CloudProject;
}

export async function updateProject(project: CloudProject, patch: CloudProjectPatch): Promise<CloudProject> {
  const userId = await getUserId();
  const nextPatch = normalizeProjectPatch(patch);
  if (nextPatch.name !== undefined && !nextPatch.name) throw new Error('Project name is required');
  if (nextPatch.status === 'archived') {
    nextPatch.archived_at = new Date().toISOString();
  } else if (nextPatch.status) {
    nextPatch.archived_at = null;
  }

  const { data, error } = await supabase
    .from('projects')
    .update({
      ...nextPatch,
      updated_by: userId
    })
    .eq('id', project.id)
    .eq('workspace_id', project.workspace_id)
    .select(PROJECT_SELECT)
    .single();

  if (error) throw error;
  return data as CloudProject;
}

export async function archiveProject(project: CloudProject): Promise<CloudProject> {
  return updateProject(project, { status: 'archived' });
}

export async function createProjectMilestone(project: CloudProject, title: string): Promise<CloudProjectMilestone> {
  const normalizedTitle = title.trim();
  if (!normalizedTitle) throw new Error('Milestone title is required');
  const userId = await getUserId();
  const { data, error } = await supabase
    .from('project_milestones')
    .insert({
      workspace_id: project.workspace_id,
      project_id: project.id,
      title: normalizedTitle,
      status: 'planned',
      sort_order: Math.floor(Date.now() / 1000),
      created_by: userId,
      updated_by: userId
    })
    .select(MILESTONE_SELECT)
    .single();

  if (error) throw error;
  return data as CloudProjectMilestone;
}

export async function updateProjectMilestone(
  milestone: CloudProjectMilestone,
  patch: CloudProjectMilestonePatch
): Promise<CloudProjectMilestone> {
  const userId = await getUserId();
  const nextPatch = normalizeMilestonePatch(patch);
  if (nextPatch.title !== undefined && !nextPatch.title) throw new Error('Milestone title is required');
  if (nextPatch.status === 'archived') {
    nextPatch.archived_at = new Date().toISOString();
  } else if (nextPatch.status) {
    nextPatch.archived_at = null;
  }

  const { data, error } = await supabase
    .from('project_milestones')
    .update({
      ...nextPatch,
      updated_by: userId
    })
    .eq('id', milestone.id)
    .eq('workspace_id', milestone.workspace_id)
    .select(MILESTONE_SELECT)
    .single();

  if (error) throw error;
  return data as CloudProjectMilestone;
}

export async function archiveProjectMilestone(milestone: CloudProjectMilestone): Promise<CloudProjectMilestone> {
  return updateProjectMilestone(milestone, { status: 'archived' });
}

export async function createProjectLink(
  project: CloudProject,
  input: {
    title: string;
    kind: CloudProjectLinkKind;
    target: string;
    project_milestone_id?: number | null;
  }
): Promise<CloudProjectLink> {
  const title = input.title.trim();
  const target = input.target.trim();
  if (!title) throw new Error('Link title is required');
  if (!target) throw new Error('Link target is required');
  const userId = await getUserId();
  const { data, error } = await supabase
    .from('project_links')
    .insert({
      workspace_id: project.workspace_id,
      project_id: project.id,
      project_milestone_id: input.project_milestone_id ?? null,
      title,
      kind: input.kind,
      target,
      sort_order: Math.floor(Date.now() / 1000),
      created_by: userId,
      updated_by: userId
    })
    .select(LINK_SELECT)
    .single();

  if (error) throw error;
  return data as CloudProjectLink;
}

export async function updateProjectLink(link: CloudProjectLink, patch: CloudProjectLinkPatch): Promise<CloudProjectLink> {
  const userId = await getUserId();
  const nextPatch = normalizeLinkPatch(patch);
  if (nextPatch.title !== undefined && !nextPatch.title) throw new Error('Link title is required');
  if (nextPatch.target !== undefined && !nextPatch.target) throw new Error('Link target is required');

  const { data, error } = await supabase
    .from('project_links')
    .update({
      ...nextPatch,
      updated_by: userId
    })
    .eq('id', link.id)
    .eq('workspace_id', link.workspace_id)
    .select(LINK_SELECT)
    .single();

  if (error) throw error;
  return data as CloudProjectLink;
}

export async function archiveProjectLink(link: CloudProjectLink): Promise<CloudProjectLink> {
  return updateProjectLink(link, { archived_at: new Date().toISOString() });
}

export async function createProjectTask(
  section: TaskSection,
  project: CloudProject,
  title: string,
  milestone?: CloudProjectMilestone | null
) {
  if (section.source?.workspace_id !== project.workspace_id) {
    throw new Error('Project and task section must belong to the same workspace');
  }
  if (milestone && (milestone.workspace_id !== project.workspace_id || milestone.project_id !== project.id)) {
    throw new Error('Milestone must belong to the selected project');
  }
  return createTask(section, title, {
    project_id: project.id,
    project_milestone_id: milestone?.id ?? null
  });
}

async function getUserId() {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error('Signed-in user is required');
  return data.user.id;
}

function normalizeProjectPatch(patch: CloudProjectPatch & { archived_at?: string | null }) {
  return {
    ...patch,
    name: patch.name === undefined ? undefined : patch.name.trim(),
    north_star: patch.north_star === undefined ? undefined : normalizeNullableText(patch.north_star),
    description: patch.description === undefined ? undefined : normalizeNullableText(patch.description),
    github_url: patch.github_url === undefined ? undefined : normalizeNullableText(patch.github_url),
    current_horizon: patch.current_horizon === undefined ? undefined : normalizeNullableText(patch.current_horizon),
    roadmap_note: patch.roadmap_note === undefined ? undefined : normalizeNullableText(patch.roadmap_note)
  };
}

function normalizeMilestonePatch(patch: CloudProjectMilestonePatch & { archived_at?: string | null }) {
  return {
    ...patch,
    title: patch.title === undefined ? undefined : patch.title.trim(),
    description: patch.description === undefined ? undefined : normalizeNullableText(patch.description),
    target_date: patch.target_date === undefined ? undefined : normalizeNullableText(patch.target_date)
  };
}

function normalizeLinkPatch(patch: CloudProjectLinkPatch & { archived_at?: string | null }) {
  return {
    ...patch,
    title: patch.title === undefined ? undefined : patch.title.trim(),
    target: patch.target === undefined ? undefined : patch.target.trim()
  };
}

function normalizeNullableText(value: string | null | undefined) {
  if (value === null) return null;
  if (value === undefined) return undefined;
  const normalized = value.trim();
  return normalized ? normalized : null;
}
