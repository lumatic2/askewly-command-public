#!/usr/bin/env node
'use strict';

// Offline verifier for `askewly-command.js projects list/show` routing to the
// Google Sheets catalog backend (M70 step S3).
//
// A real `gws` spawn-based fake could not be used here: Node hardens
// spawnSync against directly invoking .bat/.cmd files without shell:true
// (CVE-2024-27980), and scripts/lib/google-workspace-catalog.js's runGws()
// calls spawnSync without shell:true. So this verifier stubs the catalog
// module in the require cache with an in-memory fixture and drives the real
// CLI routing code (askewly-command.js's run()) against it. The one command
// that never touches the catalog module at all -- `projects create` on the
// Google backend, which fails fast with the M71 message -- is verified with
// a real child_process spawn of the CLI for an actual process-level smoke.

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const CLI_PATH = path.join(__dirname, 'askewly-command.js');
const CATALOG_PATH = require.resolve('./lib/google-workspace-catalog');
const CLI_MODULE_PATH = require.resolve('./askewly-command');

const FIXTURE_PROJECTS = [
  { supabase_id: 101, name: 'Askewly Command', status: 'active', sort_order: -5, created_at: '2026-01-01T00:00:00.000Z' },
  { supabase_id: 102, name: 'Side Quest', status: 'paused', sort_order: 2, created_at: '2026-01-02T00:00:00.000Z' },
  { supabase_id: 103, name: 'Old Project', status: 'archived', sort_order: 3, created_at: '2026-01-03T00:00:00.000Z' }
];
const FIXTURE_MILESTONES = [
  { supabase_id: 201, project_id: 101, title: 'Ship v1', status: 'done' }
];
const FIXTURE_LINKS = [
  { supabase_id: 301, project_id: 101, kind: 'github', title: 'repo', target: 'https://example.com/repo' }
];

function buildFakeCatalog() {
  // Mutable per-test-run copy so create/update/pin/unpin/archive can be exercised
  // like a real backing sheet without touching the FIXTURE_* constants.
  const rows = FIXTURE_PROJECTS.map((row) => ({ ...row }));
  let nextLocalId = 1;

  function locate({ name, id } = {}) {
    let row = null;
    if (id !== undefined && id !== null && id !== '') {
      row = rows.find((candidate) => String(candidate.supabase_id) === String(id)) || null;
    } else if (name) {
      row = rows.find((candidate) => candidate.name.toLowerCase() === String(name).toLowerCase()) || null;
    }
    if (!row) throw new Error(`Project not found: ${name || id}`);
    return row;
  }

  return {
    listProjects(filters = {}) {
      const status = filters.status ? String(filters.status) : null;
      return rows
        .filter((row) => (status === 'all' ? true : status ? row.status === status : row.status !== 'archived'))
        .filter((row) => !filters.name || row.name.toLowerCase() === String(filters.name).toLowerCase())
        .slice()
        .sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at));
    },
    showProject({ name, id } = {}) {
      let project = null;
      if (id !== undefined && id !== null && id !== '') {
        project = rows.find((row) => String(row.supabase_id) === String(id)) || null;
      } else if (name) {
        project = rows.find((row) => row.name.toLowerCase() === String(name).toLowerCase()) || null;
      }
      if (!project) throw new Error(`Project not found: ${name || id}`);
      return {
        project,
        milestones: FIXTURE_MILESTONES.filter((row) => row.project_id === project.supabase_id),
        links: FIXTURE_LINKS.filter((row) => row.project_id === project.supabase_id)
      };
    },
    createProject(fields = {}) {
      const name = String(fields.name || '').trim();
      const existing = rows.find((row) => row.name.toLowerCase() === name.toLowerCase());
      if (existing) return existing;
      const nowIso = new Date().toISOString();
      const project = {
        supabase_id: `local-${nextLocalId++}`,
        name,
        status: 'active',
        sort_order: fields.pinned ? -1 : 999,
        created_at: nowIso,
        updated_at: nowIso,
        description: fields.description || '',
        github_url: fields.github_url || '',
        north_star: fields.north_star || '',
        current_horizon: fields.current_horizon || '',
        roadmap_note: fields.roadmap_note || ''
      };
      rows.push(project);
      return project;
    },
    updateProject(selector, patch) {
      const project = locate(selector);
      Object.assign(project, patch, { updated_at: new Date().toISOString() });
      return project;
    },
    setProjectPinned(selector, pinned) {
      const project = locate(selector);
      project.sort_order = pinned ? -1 : 999;
      project.updated_at = new Date().toISOString();
      return project;
    },
    archiveProject(selector) {
      const project = locate(selector);
      project.status = 'archived';
      project.archived_at = new Date().toISOString();
      project.updated_at = project.archived_at;
      return project;
    }
  };
}

async function withStubbedCli(fn) {
  const previousCatalogEntry = require.cache[CATALOG_PATH];
  require.cache[CATALOG_PATH] = {
    id: CATALOG_PATH,
    filename: CATALOG_PATH,
    loaded: true,
    exports: buildFakeCatalog()
  };
  delete require.cache[CLI_MODULE_PATH];
  const cli = require('./askewly-command');
  try {
    await fn(cli);
  } finally {
    delete require.cache[CLI_MODULE_PATH];
    if (previousCatalogEntry) require.cache[CATALOG_PATH] = previousCatalogEntry;
    else delete require.cache[CATALOG_PATH];
  }
}

async function captureJsonRun(cli, argv) {
  const logs = [];
  const originalLog = console.log;
  console.log = (message) => logs.push(message);
  try {
    await cli.run(argv);
  } finally {
    console.log = originalLog;
  }
  return JSON.parse(logs.join('\n'));
}

async function main() {
  process.env.ASKEWLY_COMMAND_TASK_BACKEND = 'google';

  await withStubbedCli(async (cli) => {
    // 1. list default excludes archived.
    const listDefault = await captureJsonRun(cli, ['projects', 'list', '--json']);
    assert.strictEqual(listDefault.length, 2);
    assert.ok(listDefault.every((project) => project.status !== 'archived'));

    // 2. --status all includes archived.
    const listAll = await captureJsonRun(cli, ['projects', 'list', '--status', 'all', '--json']);
    assert.strictEqual(listAll.length, 3);

    // 3. --pinned filters sort_order < 0.
    const pinned = await captureJsonRun(cli, ['projects', 'list', '--pinned', '--json']);
    assert.strictEqual(pinned.length, 1);
    assert.strictEqual(pinned[0].name, 'Askewly Command');

    // 4. show --name returns project + milestones + links.
    const shown = await captureJsonRun(cli, ['projects', 'show', '--name', 'Askewly Command', '--json']);
    assert.strictEqual(String(shown.project.supabase_id), '101');
    assert.strictEqual(shown.milestones.length, 1);
    assert.strictEqual(shown.milestones[0].title, 'Ship v1');
    assert.strictEqual(shown.links.length, 1);
    assert.strictEqual(shown.links[0].title, 'repo');

    // 5. show --id also resolves.
    const shownById = await captureJsonRun(cli, ['projects', 'show', '--id', '102', '--json']);
    assert.strictEqual(shownById.project.name, 'Side Quest');
    assert.strictEqual(shownById.milestones.length, 0);

    // 6. show nonexistent name -> rejects with a clear error.
    await assert.rejects(
      () => cli.run(['projects', 'show', '--name', 'Does Not Exist', '--json']),
      /Project not found: Does Not Exist/
    );

    // 7. create routes to the catalog and returns a local id.
    const createdProject = await captureJsonRun(cli, ['projects', 'create', '--name', 'Fresh Catalog Project', '--json']);
    assert.ok(String(createdProject.supabase_id).startsWith('local-'));
    assert.strictEqual(createdProject.status, 'active');

    // 8. update routes to the catalog and patches fields.
    const updatedProject = await captureJsonRun(cli, [
      'projects', 'update', '--name', 'Fresh Catalog Project', '--description', 'now with a description', '--json'
    ]);
    assert.strictEqual(updatedProject.description, 'now with a description');

    // 9. pin routes to the catalog and sets a negative sort_order.
    const pinnedProject = await captureJsonRun(cli, ['projects', 'pin', '--name', 'Fresh Catalog Project', '--json']);
    assert.ok(Number(pinnedProject.sort_order) < 0);

    // 10. unpin routes to the catalog and restores a non-negative sort_order.
    const unpinnedProject = await captureJsonRun(cli, ['projects', 'unpin', '--name', 'Fresh Catalog Project', '--json']);
    assert.ok(Number(unpinnedProject.sort_order) >= 0);

    // 11. archive routes to the catalog and sets status + archived_at.
    const archivedProject = await captureJsonRun(cli, ['projects', 'archive', '--name', 'Fresh Catalog Project', '--json']);
    assert.strictEqual(archivedProject.status, 'archived');
    assert.ok(archivedProject.archived_at);

    // 12. negative: update on a nonexistent project rejects with a clear error.
    await assert.rejects(
      () => cli.run(['projects', 'update', '--name', 'Ghost Project', '--description', 'x', '--json']),
      /Project not found: Ghost Project/
    );
  });

  // 13. `projects seed` is never routed to the Google backend, even when the
  // Google task backend env var is set -- it stays Supabase-only. This path
  // never touches the catalog module, so a real child process is safe here.
  const seeded = spawnSync(process.execPath, [CLI_PATH, 'projects', 'seed', '--dry-run'], {
    encoding: 'utf8',
    env: { ...process.env, ASKEWLY_COMMAND_TASK_BACKEND: 'google', ASKEWLY_COMMAND_CLOUD_DISABLED: '1' }
  });
  // Without real Supabase cloud config this will fail, but it must fail on the
  // Supabase code path (missing cloud config), never with the old M71 message.
  assert.ok(!/M71/.test(seeded.stderr || ''), `projects seed must not be routed to the Google backend, got: ${seeded.stderr}`);

  console.log('google sheets projects routing verify ok: list/show/create/update/pin/unpin/archive route to catalog backend, seed stays Supabase-only');
}

main().catch((error) => {
  console.error(`FAIL: ${error.message}`);
  process.exit(1);
});
