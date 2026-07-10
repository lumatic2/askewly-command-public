#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const { ensureSpreadsheet, readRows, appendRows, SHEET_HEADERS } = require('./lib/google-workspace-catalog');

const EXPORT_TO_SHEET = {
  projects: 'projects',
  project_milestones: 'milestones',
  project_links: 'links'
};

const REQUIRED_EXPORT_KEYS = Object.keys(EXPORT_TO_SHEET);

function usage() {
  return [
    'Usage:',
    '  node scripts/google-sheets-catalog-migrate.js --file <export.json> [--live] [--pretty]',
    '',
    'Migrates Supabase project catalog export (projects, project_milestones, project_links)',
    'into the Google Sheets "Askewly Command Catalog" spreadsheet.',
    'Default mode is dry-run and makes no Google API calls. Use --live to write.'
  ].join('\n');
}

function parseArgs(argv) {
  const flags = { live: false, pretty: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') flags.help = true;
    else if (arg === '--live') flags.live = true;
    else if (arg === '--pretty') flags.pretty = true;
    else if (arg === '--file' || arg === '-f') flags.file = argv[++i];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return flags;
}

function readExportFile(filePath) {
  if (!filePath) throw new Error('--file is required');
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new Error(`Unable to read file: ${filePath} (${error.message})`);
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Malformed JSON in ${filePath}: ${error.message}`);
  }
  const missing = REQUIRED_EXPORT_KEYS.filter((key) => !Array.isArray(data[key]));
  if (missing.length) {
    throw new Error(`Export file missing expected array key(s): ${missing.join(', ')}`);
  }
  return data;
}

function mapRow(sheetName, row) {
  const headers = SHEET_HEADERS[sheetName];
  const mapped = {};
  for (const header of headers) {
    if (header === 'supabase_id') {
      mapped.supabase_id = row.id;
      continue;
    }
    if (header === 'workspace_id') continue;
    // Pass values through as-is (including null); appendRows() converts null/undefined to '' at write time.
    mapped[header] = row[header];
  }
  return mapped;
}

function mapExportData(exportData) {
  const bySheet = {};
  for (const [exportKey, sheetName] of Object.entries(EXPORT_TO_SHEET)) {
    bySheet[sheetName] = (exportData[exportKey] || []).map((row) => mapRow(sheetName, row));
  }
  return bySheet;
}

function migrate(exportData, options = {}) {
  const gws = options.gws;
  const bySheet = mapExportData(exportData);
  const sheetNames = Object.keys(bySheet);

  if (!options.live) {
    const perSheet = {};
    let totalPlanned = 0;
    for (const sheetName of sheetNames) {
      const rows = bySheet[sheetName];
      perSheet[sheetName] = {
        planned: rows.length,
        supabase_ids: rows.map((row) => row.supabase_id)
      };
      totalPlanned += rows.length;
    }
    return {
      mode: 'dry-run',
      spreadsheetId: null,
      counts: {
        planned: totalPlanned,
        skipped: 0,
        errors: 0
      },
      per_sheet: perSheet
    };
  }

  const { spreadsheetId } = ensureSpreadsheet(gws);
  const perSheet = {};
  const ledgerEntries = [];
  let totalCreated = 0;
  let totalSkipped = 0;

  for (const sheetName of sheetNames) {
    const rows = bySheet[sheetName];
    const existingRows = readRows(spreadsheetId, sheetName, gws);
    const existingIds = new Set(existingRows.map((row) => String(row.supabase_id)));

    const toCreate = [];
    const skippedIds = [];
    for (const row of rows) {
      if (existingIds.has(String(row.supabase_id))) {
        skippedIds.push(row.supabase_id);
      } else {
        toCreate.push(row);
      }
    }

    if (toCreate.length) appendRows(spreadsheetId, sheetName, toCreate, gws);

    for (const row of toCreate) {
      ledgerEntries.push({ supabase_id: row.supabase_id, sheet: sheetName, status: 'created' });
    }
    for (const id of skippedIds) {
      ledgerEntries.push({ supabase_id: id, sheet: sheetName, status: 'skipped' });
    }

    perSheet[sheetName] = {
      created: toCreate.length,
      skipped: skippedIds.length,
      supabase_ids_created: toCreate.map((row) => row.supabase_id),
      supabase_ids_skipped: skippedIds
    };
    totalCreated += toCreate.length;
    totalSkipped += skippedIds.length;
  }

  return {
    mode: 'live',
    spreadsheetId,
    counts: {
      created: totalCreated,
      skipped: totalSkipped,
      errors: 0
    },
    per_sheet: perSheet,
    ledger_entries: ledgerEntries
  };
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '-').slice(0, 19);
}

function ensureDataDir() {
  const dir = path.join(__dirname, '..', 'data', 'google-workspace-migration');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function main(argv = process.argv.slice(2)) {
  const flags = parseArgs(argv);
  if (flags.help) {
    console.log(usage());
    return 0;
  }
  const exportData = readExportFile(flags.file);
  const result = migrate(exportData, { live: flags.live });
  const dataDir = ensureDataDir();
  const ts = timestamp();

  if (!flags.live) {
    const reportPath = path.join(dataDir, `sheets-catalog-dryrun-${ts}.json`);
    writeJson(reportPath, {
      source_file: flags.file,
      generated_at: new Date().toISOString(),
      mode: 'dry-run',
      counts: result.counts,
      per_sheet: result.per_sheet
    });
    console.log(JSON.stringify({ mode: 'dry-run', counts: result.counts, report: reportPath }, null, flags.pretty ? 2 : 0));
    return result.counts.errors ? 1 : 0;
  }

  const ledgerPath = path.join(dataDir, `sheets-catalog-ledger-${ts}.json`);
  const reportPath = path.join(dataDir, `sheets-catalog-report-${ts}.json`);
  writeJson(ledgerPath, { spreadsheetId: result.spreadsheetId, entries: result.ledger_entries });
  writeJson(reportPath, {
    source_file: flags.file,
    generated_at: new Date().toISOString(),
    mode: 'live',
    spreadsheetId: result.spreadsheetId,
    counts: result.counts,
    per_sheet: result.per_sheet
  });
  console.log(JSON.stringify({ mode: 'live', counts: result.counts, ledger: ledgerPath, report: reportPath }, null, flags.pretty ? 2 : 0));
  return result.counts.errors ? 1 : 0;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`google-sheets-catalog-migrate failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  mapRow,
  mapExportData,
  migrate,
  readExportFile,
  EXPORT_TO_SHEET
};
