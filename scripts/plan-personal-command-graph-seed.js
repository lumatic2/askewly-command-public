'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const AUDIT_PATH = path.join(process.cwd(), 'docs', 'artifacts', 'm27-source-audit.json');
const PLAN_PATH = path.join(process.cwd(), 'docs', 'artifacts', 'm27-seed-plan.json');

const PROJECT_BLUEPRINTS = [
  {
    key: 'askewly-command',
    name: 'Askewly Command',
    localProject: 'workspace-pulse-dashboard',
    north_star: '모바일 앱과 PC 위젯에서 같은 작업 허브를 계정 기반으로 쓴다.',
    description: 'Workspace Pulse / Askewly Command cloud schedule, project graph, and command tower product.',
    current_horizon: 'Personal command graph bootstrap',
    roadmap_note: 'M27: seed projects, milestones, links, and task relations into the existing Supabase graph.',
    milestones: [
      { key: 'm27-personal-graph', title: 'M27 Personal command graph', status: 'active' }
    ],
    linkHints: ['30-Projects/schedule/SCHEDULE.md', '30-Projects/schedule/BACKLOG.md']
  },
  {
    key: 'askewly-company-blog',
    name: 'Askewly Company / Blog',
    localProject: 'Askwely-company',
    north_star: 'askewly.com과 콘텐츠 운영을 제품 맥락으로 연결한다.',
    description: 'Askewly company site, blog CMS, publishing backlog, and recurring writing operations.',
    current_horizon: 'Content publishing queue',
    roadmap_note: 'Connect blog/content tasks and relevant Obsidian planning notes.',
    milestones: [
      { key: 'blog-publishing', title: 'Blog publishing queue', status: 'active' }
    ],
    linkHints: ['30-Projects/brunch/', '30-Projects/book-topics/'],
    taskClassifier: isBlogTask
  },
  {
    key: 'creative-video-lab',
    name: 'Creative Video Lab',
    localProject: 'portfolio-site',
    north_star: '영상/모션/ComfyUI 실험을 반복 가능한 콘텐츠 작업으로 만든다.',
    description: 'Motion, Remotion, ComfyUI, short-form video, and visual content experiments.',
    current_horizon: 'Video experiment queue',
    roadmap_note: 'Connect video-generation tasks so Content tab has project context.',
    milestones: [
      { key: 'video-experiments', title: 'Video experiment queue', status: 'active' }
    ],
    taskClassifier: isVideoTask
  },
  {
    key: 'career-pipeline',
    name: 'Career Pipeline',
    localProject: 'cover-letter',
    north_star: '채용 탐색과 지원서 작성 흐름을 지속 가능한 pipeline으로 운영한다.',
    description: 'Company-first hiring scan, application drafting, pipeline tracker, and JD review.',
    current_horizon: 'Company-first application operations',
    roadmap_note: 'Seed as a project now; task links can be added after non-content task classification.',
    milestones: [
      { key: 'application-ops', title: 'Application operations', status: 'active' }
    ]
  },
  {
    key: 'contest-pipeline',
    name: 'Contest Pipeline',
    localProject: 'ai-contest',
    north_star: '공모전 슬롯을 공식 요강과 로컬 raw asset 기반으로 운영한다.',
    description: 'Contest shortlist, slot setup, proposal grounding, and evidence handoff.',
    current_horizon: 'Contest slot execution',
    roadmap_note: 'Seed as a project now; future maintenance loop should link contest schedule tasks.',
    milestones: [
      { key: 'contest-slots', title: 'Contest slot execution', status: 'active' }
    ]
  },
  {
    key: 'custom-skills-tooling',
    name: 'Custom Skills & Tooling',
    localProject: 'custom-skills',
    north_star: '반복 작업을 로컬 Codex/Claude skill로 안정적으로 배포한다.',
    description: 'Canonical custom skill source, setup/deploy path, acceptance checks, and runtime hardening.',
    current_horizon: 'Skill maintenance loop',
    roadmap_note: 'Seed as a project now; M28 can add recurring skill maintenance tasks.',
    milestones: [
      { key: 'skill-maintenance', title: 'Skill maintenance loop', status: 'active' }
    ]
  },
  {
    key: 'toolshelf-research',
    name: 'Toolshelf Research',
    localProject: 'toolshelf',
    north_star: '도구와 레퍼런스를 실제로 다시 찾고 쓸 수 있는 shelf로 유지한다.',
    description: 'Tool cards, manifest curation, recall workflows, and research shortlist hygiene.',
    current_horizon: 'Shelf curation hygiene',
    roadmap_note: 'Seed as a project now; future maintenance loop can link curation tasks.',
    milestones: [
      { key: 'shelf-curation', title: 'Shelf curation hygiene', status: 'active' }
    ]
  }
];

function isBlogTask(task) {
  return /블로그|blog|post|article|글쓰기|인스타|유튜브/i.test(task.title || '');
}

function isVideoTask(task) {
  return /영상|video|comfyui|remotion|suno|타이포그래피|광고/i.test(task.title || '');
}

function findLocalProject(audit, name) {
  return (audit.localProjects?.candidates || []).find((project) => project.name === name) || null;
}

function findVaultLinks(audit, hints) {
  if (!Array.isArray(hints) || hints.length === 0) return [];
  const candidates = audit.vault?.candidates || [];
  return candidates
    .filter((note) => hints.some((hint) => note.relPath.startsWith(hint) || note.relPath === hint))
    .slice(0, 4)
    .map((note, index) => ({
      key: `vault-${index + 1}`,
      title: note.title || note.name,
      kind: 'obsidian',
      target: note.uri,
      source_rel_path: note.relPath
    }));
}

function buildProject(blueprint, audit, sortOrder) {
  const local = findLocalProject(audit, blueprint.localProject);
  const links = findVaultLinks(audit, blueprint.linkHints);
  if (local?.path) {
    links.push({
      key: 'local-folder',
      title: `${blueprint.localProject} folder`,
      kind: 'file',
      target: local.path,
      source_rel_path: null
    });
  }
  return {
    key: blueprint.key,
    match: { by: 'workspace_id + name', name: blueprint.name },
    fields: {
      name: blueprint.name,
      north_star: blueprint.north_star,
      description: blueprint.description,
      status: 'active',
      github_url: null,
      current_horizon: blueprint.current_horizon,
      roadmap_note: blueprint.roadmap_note,
      sort_order: sortOrder
    },
    source: {
      local_project: blueprint.localProject,
      local_path: local?.path || null,
      local_category: local?.category || '',
      has_roadmap: local?.hasRoadmap === true
    },
    milestones: blueprint.milestones.map((milestone, index) => ({
      ...milestone,
      match: { by: 'project + title', title: milestone.title },
      sort_order: sortOrder + index
    })),
    links: links.map((link, index) => ({
      ...link,
      match: { by: 'project + kind + target', kind: link.kind, target: link.target },
      sort_order: sortOrder + index
    })),
    task_links: []
  };
}

function assignTasks(projects, audit) {
  const assigned = new Set();
  const tasks = audit.supabase?.contentCandidates || [];
  for (const project of projects) {
    const blueprint = PROJECT_BLUEPRINTS.find((candidate) => candidate.key === project.key);
    if (!blueprint?.taskClassifier) continue;
    for (const task of tasks) {
      if (assigned.has(task.id)) continue;
      if (!blueprint.taskClassifier(task)) continue;
      project.task_links.push({
        task_id: task.id,
        title: task.title,
        status: task.status,
        milestone_key: project.milestones[0]?.key || null,
        match: { by: 'task id', id: task.id }
      });
      assigned.add(task.id);
    }
  }
}

async function main() {
  const audit = JSON.parse(await fsp.readFile(AUDIT_PATH, 'utf8'));
  const projects = PROJECT_BLUEPRINTS.map((blueprint, index) => buildProject(blueprint, audit, (index + 1) * 100));
  assignTasks(projects, audit);

  const totals = {
    projects: projects.length,
    milestones: projects.reduce((sum, project) => sum + project.milestones.length, 0),
    links: projects.reduce((sum, project) => sum + project.links.length, 0),
    obsidianLinks: projects.reduce((sum, project) => sum + project.links.filter((link) => link.kind === 'obsidian').length, 0),
    taskLinks: projects.reduce((sum, project) => sum + project.task_links.length, 0)
  };

  const plan = {
    version: 1,
    generatedAt: new Date().toISOString(),
    status: 'requires_review',
    approved: false,
    source_audit: 'docs/artifacts/m27-source-audit.json',
    idempotency: {
      projects: 'workspace_id + exact project name',
      milestones: 'project + exact milestone title',
      links: 'project + kind + exact target',
      task_links: 'task id update to planned project/milestone'
    },
    safety: [
      'No Supabase mutation should run unless approved is changed to true.',
      'No vault note body is included.',
      'File links are desktop-only metadata; mobile will not open them.'
    ],
    totals,
    projects
  };

  await fsp.writeFile(PLAN_PATH, `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
  console.log(`wrote ${PLAN_PATH}`);
  console.log(JSON.stringify(totals, null, 2));
}

main().catch((error) => {
  console.error(`FAIL personal command graph seed plan: ${error.message || error}`);
  process.exit(1);
});

