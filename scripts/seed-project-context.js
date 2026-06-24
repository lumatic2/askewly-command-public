'use strict';

const fs = require('fs');
const path = require('path');
const {
  getCloudConfig,
  loadWorkspaceContext,
  normalizeName,
  normalizeNullableText,
  request
} = require('./lib/askewly-cloud');

const DEFAULT_SEED_PATH = path.join(__dirname, '..', 'data', 'project-context-seed.json');

function parseArgs(argv) {
  const args = { dryRun: true, file: DEFAULT_SEED_PATH };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--live') {
      args.dryRun = false;
    } else if (value === '--dry-run') {
      args.dryRun = true;
    } else if (value === '--file') {
      args.file = argv[index + 1];
      index += 1;
    } else if (value === '--help' || value === '-h') {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }
  return args;
}

function usage() {
  return [
    'Usage: node scripts/seed-project-context.js [--dry-run|--live] [--file path]',
    '',
    'Seeds curated project context into the signed-in workspace.',
    'Default mode is --dry-run.'
  ].join('\n');
}

function loadSeed(filePath) {
  const rows = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!Array.isArray(rows)) throw new Error('Seed file must contain an array');
  return rows.map((row, index) => {
    const name = String(row.name || '').trim();
    if (!name) throw new Error(`Seed row ${index + 1} is missing name`);
    return {
      name,
      description: normalizeNullableText(row.description),
      github_url: normalizeNullableText(row.github_url)
    };
  });
}

async function loadExistingProjects(cloudConfig, workspaceId) {
  const projects = await request(
    cloudConfig,
    `projects?select=id,workspace_id,name,description,github_url,status&workspace_id=eq.${workspaceId}&status=neq.archived`
  );
  const byName = new Map();
  for (const project of projects || []) {
    const key = normalizeName(project.name);
    if (!byName.has(key)) byName.set(key, project);
  }
  return byName;
}

function buildPatch(existing, candidate) {
  const patch = {};
  if ((existing.description || null) !== candidate.description) patch.description = candidate.description;
  if ((existing.github_url || null) !== candidate.github_url) patch.github_url = candidate.github_url;
  if (existing.status !== 'active') patch.status = 'active';
  return patch;
}

async function seedProjects({ dryRun, file }) {
  const candidates = loadSeed(file);
  if (dryRun) {
    console.log(`project seed dry-run: ${candidates.length} candidates`);
    for (const candidate of candidates) {
      console.log(`- ${candidate.name} | ${candidate.github_url || 'no github'} | ${candidate.description || ''}`);
    }
    return { inserted: 0, updated: 0, unchanged: candidates.length, dryRun: true };
  }

  const cloudConfig = await getCloudConfig();
  const { workspace, profile } = await loadWorkspaceContext(cloudConfig);
  const existingByName = await loadExistingProjects(cloudConfig, workspace.id);
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;

  for (const candidate of candidates) {
    const existing = existingByName.get(normalizeName(candidate.name));
    if (!existing) {
      const created = await request(cloudConfig, 'projects', {
        method: 'POST',
        body: {
          workspace_id: workspace.id,
          name: candidate.name,
          description: candidate.description,
          github_url: candidate.github_url,
          status: 'active',
          sort_order: Math.floor(Date.now() / 1000) + inserted,
          created_by: profile.id,
          updated_by: profile.id
        }
      });
      inserted += 1;
      existingByName.set(normalizeName(candidate.name), created?.[0]);
      console.log(`inserted project: ${candidate.name}`);
      continue;
    }

    const patch = buildPatch(existing, candidate);
    if (Object.keys(patch).length === 0) {
      unchanged += 1;
      console.log(`unchanged project: ${candidate.name}`);
      continue;
    }
    await request(cloudConfig, `projects?id=eq.${existing.id}&workspace_id=eq.${workspace.id}`, {
      method: 'PATCH',
      body: {
        ...patch,
        updated_by: profile.id
      }
    });
    updated += 1;
    console.log(`updated project: ${candidate.name}`);
  }

  console.log(`project seed live ok: inserted=${inserted} updated=${updated} unchanged=${unchanged}`);
  return { inserted, updated, unchanged, dryRun: false };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  await seedProjects(args);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`FAIL project seed: ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  loadSeed,
  seedProjects
};
