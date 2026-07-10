/**
 * Google Tasks data layer. Row-mapping semantics are ported 1:1 from
 * `scripts/lib/google-workspace-tasks.js#rowFromGoogleTask` — same metadata
 * block contract ('--- Askewly metadata ---'), same M69-importer 'Due at:'
 * fallback, same sanitizeDue (drop pre-2000 dates), same 'doing' status.
 *
 * The mobile app only ever *reads* here (no writes in M73 S3) — the 3
 * Google Tasks lists (Askewly Today / Askewly Deadlines / Askewly Backlog)
 * stay the SOT. 'deadlines' is kept in SECTION_LISTS for parity with the
 * CLI/importer contract even though the mobile UI has no 마감 tab — timed
 * deadlines now live as Calendar all-day events (see calendar.ts).
 */
import { googleGet, googlePost, googlePatch, googleDelete, type GoogleClientOptions } from "./client";

export const SECTION_LISTS = {
  today: "Askewly Today",
  deadlines: "Askewly Deadlines",
  backlog: "Askewly Backlog",
} as const;

export type Section = keyof typeof SECTION_LISTS;

const LIST_SECTIONS: Record<string, Section> = Object.fromEntries(
  Object.entries(SECTION_LISTS).map(([key, value]) => [value, key as Section]),
);

const ASKEWLY_META_START = "--- Askewly metadata ---";

export type TaskRow = {
  id: string;
  title: string;
  detail: string;
  status: string;
  due_at: string | null;
  scheduled_for: string | null;
  section: Section | null;
  project_name: string | null;
  tasklist_id: string;
  tasklist_title: string;
  updated_at: string | null;
};

export type GoogleTaskListItem = { id: string; title: string };

export type GoogleTaskItem = {
  id: string;
  title: string;
  notes?: string;
  status?: string;
  due?: string;
  updated?: string;
};

function parseMetadata(notes = ""): Record<string, string> {
  const text = String(notes || "");
  const index = text.indexOf(ASKEWLY_META_START);
  if (index < 0) return {};
  const meta: Record<string, string> = {};
  for (const line of text.slice(index + ASKEWLY_META_START.length).split(/\r?\n/)) {
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (match) meta[match[1].trim()] = match[2].trim();
  }
  return meta;
}

function stripMetadata(notes = ""): string {
  return String(notes || "").split(ASKEWLY_META_START)[0].trim();
}

// M69 importer wrote human-readable "Due at: <iso>" lines instead of the
// M68 metadata block; fall back to that, then to Google's native due field.
function importerDueAt(notes = ""): string | null {
  const match = String(notes || "").match(/^Due at:\s*(\S+)/m);
  return match ? match[1] : null;
}

// Some M69-imported rows carry an epoch-zero Google due (source row had no
// real due date) — treat anything before 2000 as absent.
function sanitizeDue(value?: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.getUTCFullYear() < 2000) return null;
  return value;
}

export function rowFromGoogleTask(task: GoogleTaskItem, tasklist: GoogleTaskListItem): TaskRow {
  const meta = parseMetadata(task.notes);
  const section = (meta.section as Section) || LIST_SECTIONS[tasklist.title] || null;
  const status = meta.status || (task.status === "completed" ? "done" : "todo");
  return {
    id: task.id,
    title: task.title,
    detail: stripMetadata(task.notes),
    status,
    due_at: sanitizeDue(meta.due_at || importerDueAt(task.notes) || task.due),
    scheduled_for: meta.scheduled_for || null,
    section,
    project_name: meta.project || null,
    tasklist_id: tasklist.id,
    tasklist_title: tasklist.title,
    updated_at: task.updated || null,
  };
}

export async function findTaskListByTitle(
  title: string,
  opts: GoogleClientOptions,
): Promise<GoogleTaskListItem | null> {
  const res = await googleGet<{ items?: GoogleTaskListItem[] }>(
    "https://tasks.googleapis.com/tasks/v1/users/@me/lists",
    opts,
  );
  return (res.items || []).find((item) => item.title === title) || null;
}

export async function listActiveTasksForList(
  tasklist: GoogleTaskListItem,
  opts: GoogleClientOptions,
): Promise<TaskRow[]> {
  const params = new URLSearchParams({
    maxResults: "100",
    showCompleted: "false",
    showHidden: "false",
  });
  const res = await googleGet<{ items?: GoogleTaskItem[] }>(
    `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(tasklist.id)}/tasks?${params.toString()}`,
    opts,
  );
  return (res.items || []).map((task) => rowFromGoogleTask(task, tasklist));
}

/** Finds the Askewly tasklist for `section` and returns its active (non-done) tasks. Returns [] if the list doesn't exist yet. */
export async function listTasksForSection(
  section: Section,
  opts: GoogleClientOptions,
): Promise<TaskRow[]> {
  const tasklist = await findTaskListByTitle(SECTION_LISTS[section], opts);
  if (!tasklist) return [];
  return listActiveTasksForList(tasklist, opts);
}

/** 'doing' rows first (for the Today checklist's amber-first ordering), then stable by title. */
export function sortDoingFirst(rows: TaskRow[]): TaskRow[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const aDoing = a.row.status === "doing" ? 0 : 1;
      const bDoing = b.row.status === "doing" ? 0 : 1;
      if (aDoing !== bDoing) return aDoing - bDoing;
      return a.index - b.index;
    })
    .map(({ row }) => row);
}

// ---------------------------------------------------------------------------
// Write ops. Everything below is ported 1:1 from
// `scripts/lib/google-workspace-tasks.js` (taskBody / googleStatus / metadata
// contract) but calls the Tasks REST API directly instead of shelling out to
// the `gws` CLI (this module has no Node `child_process` access).
// ---------------------------------------------------------------------------

const TASKS_BASE = "https://tasks.googleapis.com/tasks/v1";

export type TaskWriteInput = {
  title?: string;
  detail?: string;
  project?: string | null;
  status?: string; // 'todo' | 'doing' | 'done' | 'archived'
  dueAt?: string | null; // ISO string, or null to clear
  scheduledFor?: string | null; // 'YYYY-MM-DD'
};

// Local copy of calendar.ts's kstDayBoundsIso date math (kept import-free of
// calendar.ts to avoid a circular/unrelated dependency for one date string).
function kstDateString(date: Date = new Date()): string {
  const kstNow = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return kstNow.toISOString().slice(0, 10);
}

function googleStatus(status?: string): "completed" | "needsAction" {
  return status === "done" || status === "archived" ? "completed" : "needsAction";
}

function metadataBlock(values: {
  section: Section;
  status: string;
  project?: string | null;
  scheduled_for?: string | null;
  due_at?: string | null;
}): string {
  const lines = [
    ASKEWLY_META_START,
    `section: ${values.section}`,
    `status: ${values.status}`,
    values.project ? `project: ${values.project}` : null,
    values.scheduled_for ? `scheduled_for: ${values.scheduled_for}` : null,
    values.due_at ? `due_at: ${values.due_at}` : null,
  ].filter((line): line is string => Boolean(line));
  return lines.join("\n");
}

function notesWithMetadata(
  detail: string | undefined,
  values: Parameters<typeof metadataBlock>[0],
): string {
  const body = String(detail || "").trim();
  return [body, metadataBlock(values)].filter(Boolean).join("\n\n");
}

function toTaskDue(value?: string | null): string | undefined {
  if (!value) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T00:00:00.000Z`;
  return value;
}

function sectionDateFields(
  section: Section,
  input: TaskWriteInput,
): { scheduled_for: string | null; due_at: string | null } {
  if (section === "today") {
    return {
      scheduled_for: input.scheduledFor || kstDateString(),
      due_at: input.dueAt ?? null,
    };
  }
  if (section === "deadlines") {
    return { scheduled_for: null, due_at: input.dueAt ?? new Date().toISOString() };
  }
  return { scheduled_for: null, due_at: null };
}

export type TaskBody = { title?: string; notes: string; status: "completed" | "needsAction"; due?: string };

/** Builds the Tasks API insert/patch body — title/notes(metadata)/status/due — for `section`, merging `input` over `prior` (an existing TaskRow, for updates). */
export function buildTaskBody(input: TaskWriteInput, section: Section, prior: Partial<TaskRow> = {}): TaskBody {
  const dates = sectionDateFields(section, input);
  const status = input.status || prior.status || "todo";
  const detail = input.detail !== undefined ? input.detail : prior.detail || "";
  const project = input.project !== undefined ? input.project : prior.project_name || null;
  const due = section === "deadlines" ? dates.due_at : dates.scheduled_for;

  const body: TaskBody = {
    title: input.title || prior.title,
    notes: notesWithMetadata(detail, {
      section,
      status,
      project,
      scheduled_for: dates.scheduled_for || prior.scheduled_for || null,
      due_at: dates.due_at || prior.due_at || null,
    }),
    status: googleStatus(status),
  };
  const taskDue = toTaskDue(due);
  if (taskDue) body.due = taskDue;
  return body;
}

/** Finds the Askewly tasklist for `section`, creating it if it doesn't exist yet (parity with the CLI's `ensureTaskList`). */
export async function ensureTaskList(section: Section, opts: GoogleClientOptions): Promise<GoogleTaskListItem> {
  const existing = await findTaskListByTitle(SECTION_LISTS[section], opts);
  if (existing) return existing;
  return googlePost<GoogleTaskListItem>(
    `${TASKS_BASE}/users/@me/lists`,
    { title: SECTION_LISTS[section] },
    opts,
  );
}

function tasklistRef(row: TaskRow): GoogleTaskListItem {
  return { id: row.tasklist_id, title: row.tasklist_title };
}

/** Inserts a new task into `section`'s tasklist with the Askewly metadata block. */
export async function addTask(
  section: Section,
  input: TaskWriteInput,
  opts: GoogleClientOptions,
): Promise<TaskRow> {
  const tasklist = await ensureTaskList(section, opts);
  const body = buildTaskBody(input, section);
  const created = await googlePost<GoogleTaskItem>(
    `${TASKS_BASE}/lists/${encodeURIComponent(tasklist.id)}/tasks`,
    body,
    opts,
  );
  return rowFromGoogleTask(created, tasklist);
}

/** Patches title/detail/project/due on an existing task, keeping it in its current section/tasklist. */
export async function updateTask(
  row: TaskRow,
  patch: TaskWriteInput,
  opts: GoogleClientOptions,
): Promise<TaskRow> {
  const section = row.section || "backlog";
  const body = buildTaskBody({ status: row.status, ...patch }, section, row);
  const updated = await googlePatch<GoogleTaskItem>(
    `${TASKS_BASE}/lists/${encodeURIComponent(row.tasklist_id)}/tasks/${encodeURIComponent(row.id)}`,
    body,
    opts,
  );
  return rowFromGoogleTask(updated, tasklistRef(row));
}

/** Patches only the Askewly `status` (metadata + Google `status` mapping), keeping everything else unchanged. */
export async function setTaskStatus(
  row: TaskRow,
  status: string,
  opts: GoogleClientOptions,
): Promise<TaskRow> {
  const section = row.section || "backlog";
  const body = buildTaskBody(
    { title: row.title, detail: row.detail, project: row.project_name, status },
    section,
    row,
  );
  const updated = await googlePatch<GoogleTaskItem>(
    `${TASKS_BASE}/lists/${encodeURIComponent(row.tasklist_id)}/tasks/${encodeURIComponent(row.id)}`,
    { notes: body.notes, status: googleStatus(status) },
    opts,
  );
  return rowFromGoogleTask(updated, tasklistRef(row));
}

/** Toggles between 'done' and 'todo' (checkbox tap). */
export function toggleTask(row: TaskRow, opts: GoogleClientOptions): Promise<TaskRow> {
  const next = row.status === "done" ? "todo" : "done";
  return setTaskStatus(row, next, opts);
}

/** Toggles between 'doing' and 'todo' (진행 action). */
export function setDoing(row: TaskRow, opts: GoogleClientOptions): Promise<TaskRow> {
  const next = row.status === "doing" ? "todo" : "doing";
  return setTaskStatus(row, next, opts);
}

/** Deletes a single task from its tasklist. */
export async function deleteTask(tasklistId: string, taskId: string, opts: GoogleClientOptions): Promise<void> {
  await googleDelete(
    `${TASKS_BASE}/lists/${encodeURIComponent(tasklistId)}/tasks/${encodeURIComponent(taskId)}`,
    opts,
  );
}

/** Moves a task to `targetSection`: inserts it into the target tasklist first, then deletes the source task (same order as the CLI's `moveTask`, so a failure between the two steps never loses data). */
export async function moveTask(
  row: TaskRow,
  targetSection: Section,
  opts: GoogleClientOptions,
): Promise<TaskRow> {
  const targetList = await ensureTaskList(targetSection, opts);
  const body = buildTaskBody(
    {
      title: row.title,
      detail: row.detail,
      project: row.project_name,
      status: row.status,
      dueAt: row.due_at,
      scheduledFor: row.scheduled_for,
    },
    targetSection,
    row,
  );
  const created = await googlePost<GoogleTaskItem>(
    `${TASKS_BASE}/lists/${encodeURIComponent(targetList.id)}/tasks`,
    body,
    opts,
  );
  await deleteTask(row.tasklist_id, row.id, opts);
  return rowFromGoogleTask(created, targetList);
}
