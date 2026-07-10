/**
 * Google Sheets project catalog data layer (read-only in M73 S3). Ported
 * from `scripts/lib/google-workspace-catalog.js`: same spreadsheet title,
 * same `projects` sheet header order, same non-archived filter + sort_order
 * ordering (pinned rows carry a negative sort_order — see widget/data-service.js
 * `pinnedProjects = projects.filter(row => Number(row.sort_order) < 0)`).
 */
import { googleGet, type GoogleClientOptions } from "./client";

export const CATALOG_SPREADSHEET_TITLE = "Askewly Command Catalog";

export const PROJECTS_SHEET_HEADERS = [
  "supabase_id",
  "name",
  "north_star",
  "description",
  "github_url",
  "status",
  "current_horizon",
  "roadmap_note",
  "sort_order",
  "archived_at",
  "created_at",
  "updated_at",
] as const;

export type CatalogProject = Partial<Record<(typeof PROJECTS_SHEET_HEADERS)[number], string>> & {
  name: string;
};

export async function findCatalogSpreadsheetId(opts: GoogleClientOptions): Promise<string | null> {
  const q = `name = '${CATALOG_SPREADSHEET_TITLE}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
  const params = new URLSearchParams({ q, fields: "files(id,name)" });
  const res = await googleGet<{ files?: { id: string; name: string }[] }>(
    `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
    opts,
  );
  return res.files?.[0]?.id ?? null;
}

function isRowEmpty(row: string[]): boolean {
  return !row || row.every((cell) => String(cell ?? "").trim() === "");
}

export async function readProjectsSheet(
  spreadsheetId: string,
  opts: GoogleClientOptions,
): Promise<CatalogProject[]> {
  const range = encodeURIComponent("projects!A1:ZZ");
  const res = await googleGet<{ values?: string[][] }>(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}`,
    opts,
  );
  const values = res.values || [];
  const headers = values[0] || [];
  return values
    .slice(1)
    .filter((row) => !isRowEmpty(row))
    .map((row) => {
      const obj: Record<string, string> = {};
      headers.forEach((header, index) => {
        obj[header] = row[index] !== undefined ? row[index] : "";
      });
      return obj as CatalogProject;
    });
}

/** Non-archived-by-default filter + sort_order/created_at ordering, matching the catalog lib. */
export function sortAndFilterProjects(
  rows: CatalogProject[],
  filters: { status?: string } = {},
): CatalogProject[] {
  const status = filters.status;
  return rows
    .filter((row) =>
      status === "all" ? true : status ? String(row.status || "") === status : String(row.status || "") !== "archived",
    )
    .slice()
    .sort((a, b) => {
      const sortDiff = Number(a.sort_order || 0) - Number(b.sort_order || 0);
      if (sortDiff !== 0) return sortDiff;
      return String(a.created_at || "").localeCompare(String(b.created_at || ""));
    });
}

export function isPinned(row: CatalogProject): boolean {
  return Number(row.sort_order || 0) < 0;
}

/** Finds the catalog spreadsheet by title, reads the `projects` sheet, filters + sorts. Returns [] if the spreadsheet doesn't exist yet. */
export async function getCatalogProjects(
  opts: GoogleClientOptions,
  filters: { status?: string } = {},
): Promise<CatalogProject[]> {
  const spreadsheetId = await findCatalogSpreadsheetId(opts);
  if (!spreadsheetId) return [];
  const rows = await readProjectsSheet(spreadsheetId, opts);
  return sortAndFilterProjects(rows, filters);
}
