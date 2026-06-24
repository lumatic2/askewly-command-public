'use strict';

const fs = require('fs');
const path = require('path');

const migrationPath = path.join(__dirname, '..', 'supabase', 'migrations', '20260621180000_cloud_workspace_baseline.sql');
const backfillPath = path.join(__dirname, '..', 'supabase', 'migrations', '20260621204000_backfill_existing_auth_users.sql');
const grantPath = path.join(__dirname, '..', 'supabase', 'migrations', '20260621211500_grant_authenticated_app_access.sql');
const triggerFixPath = path.join(__dirname, '..', 'supabase', 'migrations', '20260621223500_fix_handle_new_user_metadata_column.sql');
const triggerVariableFixPath = path.join(__dirname, '..', 'supabase', 'migrations', '20260621224500_fix_handle_new_user_workspace_variable.sql');
const projectsPath = path.join(__dirname, '..', 'supabase', 'migrations', '20260622074000_projects_and_task_links.sql');
const milestonesPath = path.join(__dirname, '..', 'supabase', 'migrations', '20260622102000_project_milestones.sql');
const linksPath = path.join(__dirname, '..', 'supabase', 'migrations', '20260622110000_project_links.sql');
const taskStatusExtensionPath = path.join(__dirname, '..', 'supabase', 'migrations', '20260623050000_extend_task_status_board_states.sql');
const sql = fs.readFileSync(migrationPath, 'utf8');
const backfillSql = fs.readFileSync(backfillPath, 'utf8');
const grantSql = fs.readFileSync(grantPath, 'utf8');
const triggerFixSql = fs.readFileSync(triggerFixPath, 'utf8');
const triggerVariableFixSql = fs.readFileSync(triggerVariableFixPath, 'utf8');
const projectsSql = fs.readFileSync(projectsPath, 'utf8');
const milestonesSql = fs.readFileSync(milestonesPath, 'utf8');
const linksSql = fs.readFileSync(linksPath, 'utf8');
const taskStatusExtensionSql = fs.readFileSync(taskStatusExtensionPath, 'utf8');

const requiredSnippets = [
  'create table if not exists public.profiles',
  'create table if not exists public.workspaces',
  'create table if not exists public.workspace_members',
  'create table if not exists public.task_sources',
  'create table if not exists public.tasks',
  'alter table public.profiles enable row level security',
  'alter table public.workspaces enable row level security',
  'alter table public.workspace_members enable row level security',
  'alter table public.task_sources enable row level security',
  'alter table public.tasks enable row level security',
  'create trigger on_auth_user_created_workspace_pulse',
  'create policy "tasks_insert_member"',
  'create policy "tasks_update_member"',
  '(select auth.uid())',
  'unique (workspace_id, key)',
  'constraint tasks_source_workspace_fk'
];

const missing = requiredSnippets.filter((snippet) => !sql.includes(snippet));
const policyCount = (sql.match(/create policy /g) || []).length;
const secretPattern = /(eyJ[A-Za-z0-9_-]{20,}|service_role|SUPABASE_SERVICE_ROLE_KEY|client_secret\s*=)/i;

if (missing.length > 0) {
  console.error(`schema verify failed: missing ${missing.join(', ')}`);
  process.exit(1);
}

if (policyCount !== 19) {
  console.error(`schema verify failed: expected 19 policies, found ${policyCount}`);
  process.exit(1);
}

if (secretPattern.test(sql)) {
  console.error('schema verify failed: possible secret found in migration');
  process.exit(1);
}

const backfillRequiredSnippets = [
  'from auth.users',
  'insert into public.profiles',
  'insert into public.workspaces',
  'insert into public.workspace_members',
  'insert into public.task_sources',
  'on conflict (workspace_id, key) do nothing'
];
const missingBackfill = backfillRequiredSnippets.filter((snippet) => !backfillSql.includes(snippet));

if (missingBackfill.length > 0) {
  console.error(`schema verify failed: missing backfill ${missingBackfill.join(', ')}`);
  process.exit(1);
}

if (secretPattern.test(backfillSql)) {
  console.error('schema verify failed: possible secret found in backfill migration');
  process.exit(1);
}

const grantRequiredSnippets = [
  'grant usage on schema public to authenticated',
  'grant select, insert, update, delete on table public.workspaces to authenticated',
  'grant select, insert, update, delete on table public.task_sources to authenticated',
  'grant select, insert, update, delete on table public.tasks to authenticated',
  'grant usage, select on all sequences in schema public to authenticated'
];
const missingGrants = grantRequiredSnippets.filter((snippet) => !grantSql.includes(snippet));

if (missingGrants.length > 0) {
  console.error(`schema verify failed: missing grants ${missingGrants.join(', ')}`);
  process.exit(1);
}

if (secretPattern.test(grantSql)) {
  console.error('schema verify failed: possible secret found in grant migration');
  process.exit(1);
}

const triggerFixRequiredSnippets = [
  'create or replace function public.handle_new_user()',
  "new.raw_app_meta_data ->> 'provider'",
  "'email'",
  'insert into public.task_sources'
];
const missingTriggerFix = triggerFixRequiredSnippets.filter((snippet) => !triggerFixSql.includes(snippet));

if (missingTriggerFix.length > 0) {
  console.error(`schema verify failed: missing trigger fix ${missingTriggerFix.join(', ')}`);
  process.exit(1);
}

if (triggerFixSql.includes('new.app_metadata')) {
  console.error('schema verify failed: trigger fix still references new.app_metadata');
  process.exit(1);
}

if (secretPattern.test(triggerFixSql)) {
  console.error('schema verify failed: possible secret found in trigger fix migration');
  process.exit(1);
}

const triggerVariableFixRequiredSnippets = [
  'new_workspace_id bigint',
  'returning id into new_workspace_id',
  'values (new_workspace_id, new.id',
  "(new_workspace_id, 'today'",
  "(new_workspace_id, 'deadlines'",
  "(new_workspace_id, 'backlog'"
];
const missingTriggerVariableFix = triggerVariableFixRequiredSnippets.filter((snippet) => !triggerVariableFixSql.includes(snippet));

if (missingTriggerVariableFix.length > 0) {
  console.error(`schema verify failed: missing trigger variable fix ${missingTriggerVariableFix.join(', ')}`);
  process.exit(1);
}

if (secretPattern.test(triggerVariableFixSql)) {
  console.error('schema verify failed: possible secret found in trigger variable fix migration');
  process.exit(1);
}

const projectsRequiredSnippets = [
  'create table if not exists public.projects',
  'alter table public.tasks',
  'add column if not exists project_id',
  'create or replace function public.ensure_task_project_same_workspace()',
  'tasks_project_workspace_guard',
  'alter table public.projects enable row level security',
  'create policy "projects_select_member"',
  'create policy "projects_insert_member"',
  'create policy "projects_update_member"',
  'create policy "projects_delete_owner"',
  'grant select, insert, update, delete on table public.projects to authenticated',
  "status in ('active', 'paused', 'archived')"
];
const missingProjects = projectsRequiredSnippets.filter((snippet) => !projectsSql.includes(snippet));
const projectPolicyCount = (projectsSql.match(/create policy /g) || []).length;

if (missingProjects.length > 0) {
  console.error(`schema verify failed: missing project migration ${missingProjects.join(', ')}`);
  process.exit(1);
}

if (projectPolicyCount !== 4) {
  console.error(`schema verify failed: expected 4 project policies, found ${projectPolicyCount}`);
  process.exit(1);
}

if (secretPattern.test(projectsSql)) {
  console.error('schema verify failed: possible secret found in project migration');
  process.exit(1);
}

const milestoneRequiredSnippets = [
  'create table if not exists public.project_milestones',
  'constraint project_milestones_project_workspace_fk',
  'alter table public.tasks',
  'add column if not exists project_milestone_id',
  'create or replace function public.ensure_task_project_same_workspace()',
  'project_milestone_id',
  'task project_id must match project_milestone project_id',
  'tasks_project_workspace_guard',
  'alter table public.project_milestones enable row level security',
  'create policy "project_milestones_select_member"',
  'create policy "project_milestones_insert_member"',
  'create policy "project_milestones_update_member"',
  'create policy "project_milestones_delete_owner"',
  'grant select, insert, update, delete on table public.project_milestones to authenticated',
  "status in ('planned', 'active', 'done', 'archived')"
];
const missingMilestones = milestoneRequiredSnippets.filter((snippet) => !milestonesSql.includes(snippet));
const milestonePolicyCount = (milestonesSql.match(/create policy /g) || []).length;

if (missingMilestones.length > 0) {
  console.error(`schema verify failed: missing milestone migration ${missingMilestones.join(', ')}`);
  process.exit(1);
}

if (milestonePolicyCount !== 4) {
  console.error(`schema verify failed: expected 4 milestone policies, found ${milestonePolicyCount}`);
  process.exit(1);
}

if (secretPattern.test(milestonesSql)) {
  console.error('schema verify failed: possible secret found in milestone migration');
  process.exit(1);
}

const linksRequiredSnippets = [
  'create table if not exists public.project_links',
  'constraint project_links_project_workspace_fk',
  'project_milestone_id bigint references public.project_milestones',
  'create or replace function public.ensure_project_link_scope()',
  'project_links_scope_guard',
  'alter table public.project_links enable row level security',
  'create policy "project_links_select_member"',
  'create policy "project_links_insert_member"',
  'create policy "project_links_update_member"',
  'create policy "project_links_delete_owner"',
  'grant select, insert, update, delete on table public.project_links to authenticated',
  "kind in ('obsidian', 'github', 'url', 'file')"
];
const missingLinks = linksRequiredSnippets.filter((snippet) => !linksSql.includes(snippet));
const linkPolicyCount = (linksSql.match(/create policy /g) || []).length;

if (missingLinks.length > 0) {
  console.error(`schema verify failed: missing project links migration ${missingLinks.join(', ')}`);
  process.exit(1);
}

if (linkPolicyCount !== 4) {
  console.error(`schema verify failed: expected 4 project link policies, found ${linkPolicyCount}`);
  process.exit(1);
}

if (secretPattern.test(linksSql)) {
  console.error('schema verify failed: possible secret found in project links migration');
  process.exit(1);
}

const taskStatusRequiredSnippets = [
  'drop constraint if exists tasks_status_check',
  "status in ('todo', 'doing', 'done', 'held', 'delayed', 'archived')"
];
const missingTaskStatus = taskStatusRequiredSnippets.filter((snippet) => !taskStatusExtensionSql.includes(snippet));

if (missingTaskStatus.length > 0) {
  console.error(`schema verify failed: missing task status extension ${missingTaskStatus.join(', ')}`);
  process.exit(1);
}

if (secretPattern.test(taskStatusExtensionSql)) {
  console.error('schema verify failed: possible secret found in task status extension migration');
  process.exit(1);
}

console.log(`schema verify ok: ${path.relative(process.cwd(), migrationPath)} tables=5 policies=${policyCount} backfill=1 grants=1 triggerFix=2 projectMigration=1 projectPolicies=${projectPolicyCount} milestoneMigration=1 milestonePolicies=${milestonePolicyCount} linkMigration=1 linkPolicies=${linkPolicyCount} taskStatusExtension=1`);
