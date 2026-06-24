'use strict';

const assert = require('assert');
const { buildCommandOverview } = require('../shared/command-overview');

const overview = buildCommandOverview({
  todayTasks: [
    { id: 1, title: '오늘 프로젝트 작업', status: 'doing', project_id: 10, sourceKey: 'today' },
    { id: 2, title: '완료 작업', status: 'done', project_id: 11, sourceKey: 'today' },
    { id: 5, title: '다음 액션', status: 'todo', project_id: 10, sourceKey: 'today', sort_order: -1 }
  ],
  deadlineTasks: [
    { id: 3, title: '마감 작업', status: 'todo', project_id: 12, sourceKey: 'deadline', due_at: new Date().toISOString() }
  ],
  backlogTasks: [
    { id: 4, title: '보관 작업', status: 'archived', project_id: 10, sourceKey: 'backlog' },
    { id: 6, title: '지연 복구 작업', status: 'pending', cloudStatus: 'delayed', project_id: 10, sourceKey: 'backlog', sort_order: 2 },
    { id: 7, title: '프로젝트 미연결 작업', status: 'todo', sourceKey: 'backlog', sort_order: 3 }
  ],
  projects: [
    { id: 10, name: 'Askewly Command', north_star: 'Personal command tower' },
    { id: 12, name: '다른 프로젝트' }
  ],
  milestones: [
    { id: 20, project_id: 10, title: 'M22 overview', status: 'active', target_date: '2026-06-30', sort_order: 2 },
    { id: 21, project_id: 10, title: 'M23 later', status: 'planned', target_date: '2026-07-05', sort_order: 1 },
    { id: 22, project_id: 10, title: 'archived', status: 'archived', target_date: '2026-06-20', sort_order: 0 }
  ],
  links: [
    { id: 30, project_id: 10, title: 'Command note', kind: 'obsidian', target: 'obsidian://open?vault=askewly&file=Command', sort_order: 2 },
    { id: 31, project_id: 10, title: 'GitHub', kind: 'github', target: 'github.com/lumatic2/askewly-command', sort_order: 1 }
  ]
});

assert.strictEqual(overview.counts.activeTasks, 6);
assert.strictEqual(overview.counts.doingTasks, 1);
assert.strictEqual(overview.counts.todayProjects, 1);
assert.strictEqual(overview.counts.upcomingMilestones, 2);
assert.strictEqual(overview.counts.obsidianLinks, 1);
assert.strictEqual(overview.nextTask.title, '오늘 프로젝트 작업');
assert.strictEqual(overview.actions.canStartNextTask, false);
assert.strictEqual(overview.actions.canCompleteCurrentTask, true);
assert.strictEqual(overview.actions.canCreateNextAction, true);
assert.strictEqual(overview.actions.canOpenObsidian, true);
assert.strictEqual(overview.doingTasks[0].title, '오늘 프로젝트 작업');
assert.strictEqual(overview.todayProjects[0].name, 'Askewly Command');
assert.strictEqual(overview.upcomingMilestones[0].title, 'M22 overview');
assert.strictEqual(overview.obsidianLinks[0].target.startsWith('obsidian://'), true);
assert.strictEqual(Array.isArray(overview.review.start), true);
assert.strictEqual(Array.isArray(overview.review.close), true);
assert.strictEqual(overview.review.start.length, 3);
assert.strictEqual(overview.review.close.length, 3);
assert.strictEqual(overview.review.start.find((card) => card.id === 'start-due').title, '마감 작업');
assert.strictEqual(overview.review.start.find((card) => card.id === 'start-blockers').title, '지연 복구 작업');
assert.strictEqual(overview.review.close.find((card) => card.id === 'close-current').title, '오늘 프로젝트 작업');
assert.strictEqual(overview.review.close.find((card) => card.id === 'close-links').target, 'projects');

const nextOnly = buildCommandOverview({
  todayTasks: [
    { id: 10, title: '오늘 첫 todo', status: 'todo', sourceKey: 'today', sort_order: 2 }
  ]
});

assert.strictEqual(nextOnly.nextTask.title, '오늘 첫 todo');
assert.strictEqual(nextOnly.actions.canStartNextTask, true);
assert.strictEqual(nextOnly.actions.canCompleteCurrentTask, false);

console.log('command overview contract ok');
