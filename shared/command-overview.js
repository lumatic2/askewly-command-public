'use strict';

function buildCommandOverview(input = {}) {
  const todayTasks = normalizeArray(input.todayTasks || input.today);
  const deadlineTasks = normalizeArray(input.deadlineTasks || input.deadlines);
  const backlogTasks = normalizeArray(input.backlogTasks || input.backlog);
  const projects = normalizeArray(input.projects);
  const milestones = normalizeArray(input.milestones);
  const links = normalizeArray(input.links);
  const activeTasks = [...todayTasks, ...deadlineTasks, ...backlogTasks].filter((task) => !isArchived(task));
  const sortedActiveTasks = activeTasks.slice().sort(compareTasks);
  const doingTasks = sortedActiveTasks.filter((task) => getOperationalStatus(task) === 'doing' || getOperationalStatus(task) === 'in_progress');
  const linkedTasks = sortedActiveTasks.filter((task) => getProjectId(task));
  const unlinkedTasks = sortedActiveTasks.filter((task) => !getProjectId(task));
  const contentCandidates = sortedActiveTasks.filter(isContentTask);
  const heldTasks = sortedActiveTasks.filter((task) => getOperationalStatus(task) === 'held');
  const delayedTasks = sortedActiveTasks.filter((task) => getOperationalStatus(task) === 'delayed');
  const dueSoonTasks = sortedActiveTasks.filter(isDueSoonTask);
  const nextTask = doingTasks[0]
    || todayTasks.filter((task) => !isArchived(task)).sort(compareTasks).find((task) => getOperationalStatus(task) === 'todo')
    || deadlineTasks.filter((task) => !isArchived(task)).sort(compareTasks).find((task) => getOperationalStatus(task) === 'todo')
    || backlogTasks.filter((task) => !isArchived(task)).sort(compareTasks).find((task) => getOperationalStatus(task) === 'todo')
    || sortedActiveTasks[0]
    || null;
  const todayProjectIds = new Set(todayTasks.map((task) => Number(task.project_id || task.projectId)).filter(Number.isFinite));
  const todayProjects = projects.filter((project) => todayProjectIds.has(Number(project.id)));
  const upcomingMilestones = milestones
    .filter((milestone) => !isArchived(milestone))
    .filter((milestone) => ['active', 'planned'].includes(String(milestone.status || 'planned')))
    .sort(compareMilestones);
  const obsidianLinks = links
    .filter((link) => !isArchived(link))
    .filter((link) => String(link.kind || '').toLowerCase() === 'obsidian')
    .sort(compareSortOrder);
  const activeLinks = links
    .filter((link) => !isArchived(link))
    .sort(compareSortOrder);

  return {
    counts: {
      activeTasks: activeTasks.length,
      doingTasks: doingTasks.length,
      linkedTasks: linkedTasks.length,
      unlinkedTasks: unlinkedTasks.length,
      contentCandidates: contentCandidates.length,
      todayProjects: todayProjects.length,
      upcomingMilestones: upcomingMilestones.length,
      obsidianLinks: obsidianLinks.length,
      projectLinks: activeLinks.length
    },
    nextTask: nextTask ? mapTaskSummary(nextTask) : null,
    actions: {
      canStartNextTask: Boolean(nextTask && getOperationalStatus(nextTask) === 'todo'),
      canCompleteCurrentTask: Boolean(doingTasks[0]),
      canCreateNextAction: todayProjects.length > 0 || projects.length > 0,
      canOpenObsidian: obsidianLinks.length > 0
    },
    doingTasks: doingTasks.slice(0, 3).map(mapTaskSummary),
    unlinkedTasks: unlinkedTasks.slice(0, 3).map(mapTaskSummary),
    contentCandidates: contentCandidates.slice(0, 5).map(mapTaskSummary),
    todayProjects: todayProjects.slice(0, 3).map(mapProjectSummary),
    upcomingMilestones: upcomingMilestones.slice(0, 3).map(mapMilestoneSummary),
    obsidianLinks: obsidianLinks.slice(0, 3).map(mapLinkSummary),
    projectLinks: activeLinks.slice(0, 5).map(mapLinkSummary),
    review: buildReviewLoop({
      nextTask,
      doingTasks,
      heldTasks,
      delayedTasks,
      dueSoonTasks,
      unlinkedTasks,
      todayProjects,
      obsidianLinks
    })
  };
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function isArchived(value) {
  return Boolean(value?.archived_at || value?.archivedAt || String(value?.status || '') === 'archived');
}

function getStatus(task) {
  return String(task?.status || '').toLowerCase();
}

function getOperationalStatus(task) {
  return String(task?.cloudStatus || task?.cloud_status || task?.status || '').toLowerCase();
}

function getProjectId(task) {
  const value = task?.project_id ?? task?.projectId;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function isContentTask(task) {
  const haystack = `${task?.title || task?.text || ''} ${task?.detail || ''} ${task?.projectName || task?.project_name || task?.projects?.name || ''}`.toLowerCase();
  return CONTENT_KEYWORDS.some((keyword) => haystack.includes(keyword));
}

function compareSortOrder(left, right) {
  const leftOrder = Number(left?.sort_order ?? left?.sortOrder ?? 0);
  const rightOrder = Number(right?.sort_order ?? right?.sortOrder ?? 0);
  if (leftOrder !== rightOrder) return leftOrder - rightOrder;
  return String(left?.title || left?.name || '').localeCompare(String(right?.title || right?.name || ''), 'ko');
}

function compareTasks(left, right) {
  const statusDelta = taskStatusRank(left) - taskStatusRank(right);
  if (statusDelta !== 0) return statusDelta;
  return compareSortOrder(left, right);
}

function taskStatusRank(task) {
  const status = getOperationalStatus(task);
  if (status === 'doing' || status === 'in_progress') return 0;
  if (status === 'todo') return 1;
  if (status === 'done') return 2;
  if (status === 'held') return 3;
  if (status === 'delayed') return 4;
  return 3;
}

function isDueSoonTask(task) {
  const sourceKey = String(task?.sourceKey || task?.source_key || '').toLowerCase();
  const raw = task?.due_at || task?.dueAt || (sourceKey === 'deadline' || sourceKey === 'deadlines' ? (task?.scheduled_for || task?.scheduledFor || '') : '');
  if (!raw) return false;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  const dayDelta = Math.round((target.getTime() - today.getTime()) / 86400000);
  return dayDelta <= 2;
}

function compareMilestones(left, right) {
  const leftDate = String(left?.target_date || left?.targetDate || '');
  const rightDate = String(right?.target_date || right?.targetDate || '');
  if (leftDate && rightDate && leftDate !== rightDate) return leftDate.localeCompare(rightDate);
  if (leftDate !== rightDate) return leftDate ? -1 : 1;
  return compareSortOrder(left, right);
}

function mapTaskSummary(task) {
  return {
    id: task.id,
    lineIndex: task.lineIndex ?? task.line_index ?? null,
    title: String(task.title || task.text || '').trim(),
    detail: task.detail || '',
    sourceKey: task.sourceKey || task.source_key || '',
    projectId: task.project_id || task.projectId || null,
    projectMilestoneId: task.project_milestone_id || task.projectMilestoneId || null,
    projectName: task.projectName || task.project_name || task.projects?.name || '',
    projectMilestoneName: task.projectMilestoneName || task.project_milestone_name || task.project_milestones?.title || '',
    status: task.status || '',
    cloudStatus: task.cloudStatus || task.cloud_status || '',
    sortOrder: task.sort_order ?? task.sortOrder ?? 0
  };
}

function buildReviewLoop(input) {
  const start = [];
  const close = [];
  const nextTask = input.nextTask ? mapTaskSummary(input.nextTask) : null;
  const dueTask = input.dueSoonTasks?.[0] ? mapTaskSummary(input.dueSoonTasks[0]) : null;
  const delayedTask = input.delayedTasks?.[0] ? mapTaskSummary(input.delayedTasks[0]) : null;
  const heldTask = input.heldTasks?.[0] ? mapTaskSummary(input.heldTasks[0]) : null;
  const doingTask = input.doingTasks?.[0] ? mapTaskSummary(input.doingTasks[0]) : null;
  const unlinkedTask = input.unlinkedTasks?.[0] ? mapTaskSummary(input.unlinkedTasks[0]) : null;

  start.push(reviewCard(
    'start-next',
    'Next',
    nextTask?.title || 'No next task selected',
    nextTask ? [nextTask.sourceKey, nextTask.projectName].filter(Boolean).join(' · ') || 'Ready to start' : 'Add or promote a task in Schedule',
    'Open Schedule',
    'schedule',
    nextTask?.sourceKey || 'today'
  ));

  if (dueTask) {
    start.push(reviewCard(
      'start-due',
      'Due soon',
      dueTask.title,
      [dueTask.sourceKey, dueTask.projectName, dueTask.status].filter(Boolean).join(' · '),
      'Review due item',
      'schedule',
      dueTask.sourceKey || 'deadline'
    ));
  }

  start.push(reviewCard(
    'start-blockers',
    'Held / delayed',
    delayedTask?.title || heldTask?.title || 'No held or delayed task',
    delayedTask || heldTask ? 'Decide whether to resume, keep held, or defer.' : 'No recovery decision needed right now.',
    delayedTask || heldTask ? 'Open board' : 'No action',
    'schedule',
    delayedTask?.sourceKey || heldTask?.sourceKey || 'today'
  ));

  close.push(reviewCard(
    'close-current',
    'Current work',
    doingTask?.title || 'No active doing task',
    doingTask ? 'Complete, hold, or delay before ending the day.' : 'Nothing is marked as in progress.',
    doingTask ? 'Review current' : 'Open Schedule',
    'schedule',
    doingTask?.sourceKey || 'today'
  ));

  close.push(reviewCard(
    'close-done',
    'Completed / carry-over',
    `${input.doingTasks?.length || 0} doing · ${input.delayedTasks?.length || 0} delayed`,
    'Clear what should remain active tomorrow.',
    'Review board',
    'schedule',
    'today'
  ));

  close.push(reviewCard(
    'close-links',
    'Context links',
    unlinkedTask?.title || 'No unlinked task sample',
    unlinkedTask ? 'Attach project or milestone context while it is fresh.' : 'Task graph looks clean enough.',
    unlinkedTask ? 'Open Projects' : 'No action',
    unlinkedTask ? 'projects' : 'schedule',
    unlinkedTask?.sourceKey || 'today'
  ));

  return { start, close };
}

function reviewCard(id, label, title, detail, actionLabel, target, sourceKey) {
  return {
    id,
    label,
    title,
    detail,
    actionLabel,
    target,
    sourceKey
  };
}

function mapProjectSummary(project) {
  return {
    id: project.id,
    name: String(project.name || '').trim(),
    northStar: project.north_star || project.northStar || ''
  };
}

function mapMilestoneSummary(milestone) {
  return {
    id: milestone.id,
    projectId: milestone.project_id || milestone.projectId || null,
    title: String(milestone.title || '').trim(),
    status: milestone.status || 'planned',
    targetDate: milestone.target_date || milestone.targetDate || ''
  };
}

function mapLinkSummary(link) {
  return {
    id: link.id,
    projectId: link.project_id || link.projectId || null,
    projectMilestoneId: link.project_milestone_id || link.projectMilestoneId || null,
    title: String(link.title || '').trim(),
    kind: String(link.kind || '').trim(),
    target: String(link.target || '').trim()
  };
}

const CONTENT_KEYWORDS = [
  '콘텐츠',
  'content',
  'blog',
  '블로그',
  'youtube',
  '유튜브',
  '글쓰기',
  'post',
  'article',
  '영상',
  '원고',
  'draft',
  'write',
  'edit',
  'publish',
  '발행',
  '작성',
  '리서치'
];

module.exports = {
  buildCommandOverview
};
