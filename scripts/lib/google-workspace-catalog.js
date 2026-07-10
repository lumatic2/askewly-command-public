'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const CATALOG_SPREADSHEET_TITLE = 'Askewly Command Catalog';

const SHEET_HEADERS = {
  projects: [
    'supabase_id',
    'name',
    'north_star',
    'description',
    'github_url',
    'status',
    'current_horizon',
    'roadmap_note',
    'sort_order',
    'archived_at',
    'created_at',
    'updated_at'
  ],
  milestones: [
    'supabase_id',
    'project_id',
    'title',
    'status',
    'target_date',
    'sort_order',
    'archived_at',
    'created_at',
    'updated_at'
  ],
  links: [
    'supabase_id',
    'project_id',
    'project_milestone_id',
    'kind',
    'title',
    'target',
    'sort_order',
    'archived_at',
    'created_at',
    'updated_at'
  ]
};

const VALID_PROJECT_STATUSES = new Set(['active', 'paused', 'archived']);
const PROJECT_PIN_SORT_BASE = -1000000;

function gwsCommand() {
  if (process.env.GWS_BIN) return process.env.GWS_BIN;
  if (process.platform === 'win32' && process.env.APPDATA) {
    const installedExe = path.join(process.env.APPDATA, 'npm', 'node_modules', '@googleworkspace', 'cli', 'bin', 'gws.exe');
    if (fs.existsSync(installedExe)) return installedExe;
  }
  return 'gws';
}

function runGws(args) {
  const result = spawnSync(gwsCommand(), args, { encoding: 'utf8' });
  const stdout = String(result.stdout || '').trim();
  const stderr = String(result.stderr || '').trim();
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(stdout || stderr || `gws exited ${result.status}`);
  return stdout ? JSON.parse(stdout) : {};
}

function normalizeName(value) {
  return String(value || '').trim().toLowerCase();
}

function isRowEmpty(row) {
  return !row || row.every((cell) => String(cell ?? '').trim() === '');
}

function findCatalogFile(gws) {
  const query = `name = '${CATALOG_SPREADSHEET_TITLE}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
  const response = gws([
    'drive', 'files', 'list',
    '--params', JSON.stringify({ q: query, fields: 'files(id,name)' }),
    '--format', 'json'
  ]);
  return (response.files || [])[0] || null;
}

function createCatalogSpreadsheet(gws) {
  const body = {
    properties: { title: CATALOG_SPREADSHEET_TITLE },
    sheets: Object.keys(SHEET_HEADERS).map((title) => ({ properties: { title } }))
  };
  return gws([
    'sheets', 'spreadsheets', 'create',
    '--json', JSON.stringify(body),
    '--format', 'json'
  ]);
}

function getSpreadsheet(spreadsheetId, gws) {
  return gws([
    'sheets', 'spreadsheets', 'get',
    '--params', JSON.stringify({ spreadsheetId }),
    '--format', 'json'
  ]);
}

function addMissingSheets(spreadsheetId, existingTitles, gws) {
  const missing = Object.keys(SHEET_HEADERS).filter((title) => !existingTitles.includes(title));
  if (!missing.length) return;
  const requests = missing.map((title) => ({ addSheet: { properties: { title } } }));
  gws([
    'sheets', 'spreadsheets', 'batchUpdate',
    '--params', JSON.stringify({ spreadsheetId }),
    '--json', JSON.stringify({ requests }),
    '--format', 'json'
  ]);
}

function readHeaderRow(spreadsheetId, sheetName, gws) {
  const response = gws([
    'sheets', 'spreadsheets', 'values', 'get',
    '--params', JSON.stringify({ spreadsheetId, range: `${sheetName}!1:1` }),
    '--format', 'json'
  ]);
  return (response.values || [])[0] || [];
}

function writeHeaderRow(spreadsheetId, sheetName, gws) {
  gws([
    'sheets', 'spreadsheets', 'values', 'update',
    '--params', JSON.stringify({ spreadsheetId, range: `${sheetName}!A1`, valueInputOption: 'RAW' }),
    '--json', JSON.stringify({ values: [SHEET_HEADERS[sheetName]] }),
    '--format', 'json'
  ]);
}

function ensureSpreadsheet(gws = runGws) {
  const existing = findCatalogFile(gws);
  const created = !existing;
  const spreadsheetId = existing ? existing.id : createCatalogSpreadsheet(gws).spreadsheetId;

  const meta = getSpreadsheet(spreadsheetId, gws);
  const existingTitles = (meta.sheets || []).map((sheet) => sheet.properties.title);
  addMissingSheets(spreadsheetId, existingTitles, gws);

  for (const sheetName of Object.keys(SHEET_HEADERS)) {
    const headerRow = readHeaderRow(spreadsheetId, sheetName, gws);
    if (isRowEmpty(headerRow)) writeHeaderRow(spreadsheetId, sheetName, gws);
  }

  return { spreadsheetId, created };
}

function readRows(spreadsheetId, sheetName, gws = runGws) {
  const response = gws([
    'sheets', 'spreadsheets', 'values', 'get',
    '--params', JSON.stringify({ spreadsheetId, range: `${sheetName}!A1:ZZ` }),
    '--format', 'json'
  ]);
  const values = response.values || [];
  const headers = values[0] || [];
  return values
    .slice(1)
    .filter((row) => !isRowEmpty(row))
    .map((row) => {
      const obj = {};
      headers.forEach((header, index) => {
        obj[header] = row[index] !== undefined ? row[index] : '';
      });
      return obj;
    });
}

// Windows CreateProcess caps the command line at ~32K chars, and each append row
// travels inside a single --json argument. Keep each append payload well under that.
const APPEND_PAYLOAD_CHAR_BUDGET = 12000;

function chunkValuesByPayloadSize(values) {
  const chunks = [];
  let current = [];
  let currentSize = 0;
  for (const row of values) {
    const rowSize = JSON.stringify(row).length + 1;
    if (current.length && currentSize + rowSize > APPEND_PAYLOAD_CHAR_BUDGET) {
      chunks.push(current);
      current = [];
      currentSize = 0;
    }
    current.push(row);
    currentSize += rowSize;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

function appendRows(spreadsheetId, sheetName, objects, gws = runGws) {
  const headers = SHEET_HEADERS[sheetName];
  if (!headers) throw new Error(`Unknown catalog sheet: ${sheetName}`);
  const values = objects.map((obj) => headers.map((header) => (obj[header] !== undefined && obj[header] !== null ? obj[header] : '')));
  let last = null;
  for (const chunk of chunkValuesByPayloadSize(values)) {
    last = gws([
      'sheets', 'spreadsheets', 'values', 'append',
      '--params', JSON.stringify({ spreadsheetId, range: `${sheetName}!A1`, valueInputOption: 'RAW' }),
      '--json', JSON.stringify({ values: chunk }),
      '--format', 'json'
    ]);
  }
  return last;
}

function matchesProjectStatus(row, status) {
  if (!status || status === 'all') return true;
  return String(row.status || '') === status;
}

function listProjects(filters = {}, gws = runGws) {
  const status = filters.status ? String(filters.status) : null;
  if (status && status !== 'all' && !VALID_PROJECT_STATUSES.has(status)) {
    throw new Error(`Invalid project status: ${status}`);
  }
  const { spreadsheetId } = ensureSpreadsheet(gws);
  const rows = readRows(spreadsheetId, 'projects', gws);
  return rows
    .filter((row) => (status === 'all' ? true : status ? matchesProjectStatus(row, status) : String(row.status || '') !== 'archived'))
    .filter((row) => !filters.name || normalizeName(row.name) === normalizeName(filters.name))
    .slice()
    .sort((a, b) => {
      const sortDiff = Number(a.sort_order || 0) - Number(b.sort_order || 0);
      if (sortDiff !== 0) return sortDiff;
      return String(a.created_at || '').localeCompare(String(b.created_at || ''));
    });
}

function showProject({ name, id } = {}, gws = runGws) {
  const { spreadsheetId } = ensureSpreadsheet(gws);
  const projects = readRows(spreadsheetId, 'projects', gws);
  let project = null;
  if (id !== undefined && id !== null && id !== '') {
    project = projects.find((row) => String(row.supabase_id) === String(id)) || null;
  } else if (name) {
    project = projects.find((row) => normalizeName(row.name) === normalizeName(name)) || null;
  }
  if (!project) throw new Error(`Project not found: ${name || id}`);

  const milestones = readRows(spreadsheetId, 'milestones', gws)
    .filter((row) => String(row.project_id) === String(project.supabase_id));
  const links = readRows(spreadsheetId, 'links', gws)
    .filter((row) => String(row.project_id) === String(project.supabase_id));

  return { project, milestones, links };
}

function writeProjectRow(spreadsheetId, rowIndex, project, gws) {
  const headers = SHEET_HEADERS.projects;
  const values = [headers.map((header) => (project[header] !== undefined && project[header] !== null ? project[header] : ''))];
  const rowNumber = rowIndex + 2; // +1 for header row, +1 because rowIndex is 0-based
  gws([
    'sheets', 'spreadsheets', 'values', 'update',
    '--params', JSON.stringify({ spreadsheetId, range: `projects!A${rowNumber}`, valueInputOption: 'RAW' }),
    '--json', JSON.stringify({ values }),
    '--format', 'json'
  ]);
}

function locateProjectRow(spreadsheetId, selector, gws) {
  const rows = readRows(spreadsheetId, 'projects', gws);
  let rowIndex = -1;
  if (selector.id !== undefined && selector.id !== null && String(selector.id).trim() !== '') {
    rowIndex = rows.findIndex((row) => String(row.supabase_id) === String(selector.id));
  } else if (selector.name) {
    rowIndex = rows.findIndex((row) => normalizeName(row.name) === normalizeName(selector.name));
  }
  if (rowIndex === -1) throw new Error(`Project not found: ${selector.name || selector.id}`);
  return { rowIndex, project: rows[rowIndex] };
}

function pinnedSortOrderForRow(project) {
  const numericId = Number(project?.supabase_id);
  if (Number.isFinite(numericId) && numericId > 0) return PROJECT_PIN_SORT_BASE + numericId;
  const created = project?.created_at ? Math.floor(new Date(project.created_at).getTime() / 1000) : NaN;
  return PROJECT_PIN_SORT_BASE - (Number.isFinite(created) && created > 0 ? created : Math.floor(Date.now() / 1000));
}

function unpinnedSortOrderForRow(project) {
  const created = project?.created_at ? Math.floor(new Date(project.created_at).getTime() / 1000) : NaN;
  return Number.isFinite(created) && created > 0 ? created : Math.floor(Date.now() / 1000);
}

function createProject(fields = {}, gws = runGws) {
  const name = String(fields.name || '').trim();
  if (!name) throw new Error('Project name is required');
  const { spreadsheetId } = ensureSpreadsheet(gws);
  const rows = readRows(spreadsheetId, 'projects', gws);
  const existing = rows.find((row) => normalizeName(row.name) === normalizeName(name));
  if (existing) return existing;

  const nowIso = new Date().toISOString();
  const nowSeconds = Math.floor(Date.now() / 1000);
  const sortOrder = fields.pinned ? PROJECT_PIN_SORT_BASE - nowSeconds : nowSeconds;
  const project = {
    supabase_id: `local-${Date.now()}`,
    name,
    north_star: fields.north_star ?? '',
    description: fields.description ?? '',
    github_url: fields.github_url ?? '',
    status: 'active',
    current_horizon: fields.current_horizon ?? '',
    roadmap_note: fields.roadmap_note ?? '',
    sort_order: sortOrder,
    archived_at: '',
    created_at: nowIso,
    updated_at: nowIso
  };
  appendRows(spreadsheetId, 'projects', [project], gws);
  return project;
}

function updateProject(selector = {}, patch = {}, gws = runGws) {
  if (patch.status !== undefined && !VALID_PROJECT_STATUSES.has(patch.status)) {
    throw new Error(`Invalid project status: ${patch.status}`);
  }
  const { spreadsheetId } = ensureSpreadsheet(gws);
  const { rowIndex, project } = locateProjectRow(spreadsheetId, selector, gws);
  const updated = { ...project, ...patch, updated_at: new Date().toISOString() };
  writeProjectRow(spreadsheetId, rowIndex, updated, gws);
  return updated;
}

function setProjectPinned(selector = {}, pinned, gws = runGws) {
  const { spreadsheetId } = ensureSpreadsheet(gws);
  const { rowIndex, project } = locateProjectRow(spreadsheetId, selector, gws);
  const sortOrder = pinned ? pinnedSortOrderForRow(project) : unpinnedSortOrderForRow(project);
  const updated = { ...project, sort_order: sortOrder, updated_at: new Date().toISOString() };
  writeProjectRow(spreadsheetId, rowIndex, updated, gws);
  return updated;
}

function archiveProject(selector = {}, gws = runGws) {
  const { spreadsheetId } = ensureSpreadsheet(gws);
  const { rowIndex, project } = locateProjectRow(spreadsheetId, selector, gws);
  const nowIso = new Date().toISOString();
  const updated = { ...project, status: 'archived', archived_at: nowIso, updated_at: nowIso };
  writeProjectRow(spreadsheetId, rowIndex, updated, gws);
  return updated;
}

module.exports = {
  CATALOG_SPREADSHEET_TITLE,
  SHEET_HEADERS,
  ensureSpreadsheet,
  readRows,
  appendRows,
  listProjects,
  showProject,
  createProject,
  updateProject,
  setProjectPinned,
  archiveProject
};
