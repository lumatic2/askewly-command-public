/**
 * Offline, network-free sanity check for the Google data layer (M73 S3).
 *
 * Run with `npx tsx src/google/__checks__/verify-google-client.ts` (or
 * `npm run verify:google-client`). Only imports `client.ts`, `tasks.ts`,
 * `calendar.ts`, `sheets.ts`, and `cache.ts` — all pure (no expo/react-native
 * imports) — so this runs under plain Node. It deliberately does NOT import
 * `index.ts` or `../auth/googleAuth`: those pull in expo-secure-store, which
 * transitively requires react-native and fails to transform under plain tsx
 * (confirmed while building this check) — see `google/cache.ts`'s docstring
 * for why the TTL cache was split out as its own pure module for exactly
 * this reason.
 *
 * Asserts:
 *  1. googleFetchJson attaches `Authorization: Bearer <token>`.
 *  2. On a 401, it calls getToken(true) once and retries exactly once more.
 *  3. Tasks row mapping: metadata block, "Due at:" importer fallback,
 *     pre-2000 due sanitization, and 'doing' status all map correctly.
 *  4. KST day-bounds and month-bounds produce the expected timeMin/timeMax,
 *     and listTodayEvents/listMonthEvents send them as query params.
 *  5. Sheets: header-row mapping from a raw values grid, and the
 *     non-archived-by-default filter + sort_order/created_at ordering.
 *  6. TtlCache: a second get() within the TTL window doesn't refetch (cache
 *     hit), and a failed refetch falls back to the last good value with
 *     `stale: true`.
 */
import { googleFetchJson, GoogleApiError, type GoogleClientOptions } from "../client";
import {
  rowFromGoogleTask,
  findTaskListByTitle,
  listActiveTasksForList,
  buildTaskBody,
  addTask,
  updateTask,
  toggleTask,
  setDoing,
  moveTask,
  type TaskRow,
} from "../tasks";
import {
  kstDayBoundsIso,
  kstMonthBoundsIso,
  listTodayEvents,
  listMonthEvents,
  isAllDayOrOngoing,
  isEventNearNow,
} from "../calendar";
import { readProjectsSheet, sortAndFilterProjects, findCatalogSpreadsheetId, isPinned } from "../sheets";
import { TtlCache } from "../cache";

let failures = 0;

function assert(condition: unknown, message: string): void {
  if (!condition) {
    failures += 1;
    console.error(`FAIL: ${message}`);
  } else {
    console.log(`ok - ${message}`);
  }
}

type FakeCall = { url: string; init: RequestInit };

function fakeFetchSequence(responses: Array<{ status: number; body: unknown }>) {
  const calls: FakeCall[] = [];
  let i = 0;
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const step = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return {
      ok: step.status >= 200 && step.status < 300,
      status: step.status,
      statusText: String(step.status),
      json: async () => step.body,
      text: async () => JSON.stringify(step.body),
    } as Response;
  }) as typeof fetch;
  return { impl, calls };
}

async function main() {
  // 1. Authorization header.
  {
    const { impl, calls } = fakeFetchSequence([{ status: 200, body: { ok: true } }]);
    const tokenCalls: Array<boolean | undefined> = [];
    const opts: GoogleClientOptions = {
      fetchFn: impl,
      getToken: async (forceRefresh) => {
        tokenCalls.push(forceRefresh);
        return "fake-token";
      },
    };
    await googleFetchJson("https://example.invalid/x", { method: "GET" }, opts);
    assert(calls.length === 1, "googleFetchJson makes exactly one call on success");
    assert(
      (calls[0].init.headers as Record<string, string>).Authorization === "Bearer fake-token",
      "googleFetchJson attaches Authorization: Bearer <token>",
    );
    assert(tokenCalls[0] === false, "first getToken call is not a forced refresh");
  }

  // 2. 401 -> one forced-refresh retry.
  {
    const { impl, calls } = fakeFetchSequence([
      { status: 401, body: { error: "invalid_token" } },
      { status: 200, body: { ok: true } },
    ]);
    const tokenCalls: Array<boolean | undefined> = [];
    const opts: GoogleClientOptions = {
      fetchFn: impl,
      getToken: async (forceRefresh) => {
        tokenCalls.push(forceRefresh);
        return forceRefresh ? "refreshed-token" : "stale-token";
      },
    };
    const result = await googleFetchJson<{ ok: boolean }>("https://example.invalid/y", { method: "GET" }, opts);
    assert(calls.length === 2, "a 401 triggers exactly one retry (2 total fetch calls)");
    assert(tokenCalls.length === 2 && tokenCalls[0] === false && tokenCalls[1] === true, "retry calls getToken(true)");
    assert(
      (calls[1].init.headers as Record<string, string>).Authorization === "Bearer refreshed-token",
      "retry uses the refreshed token",
    );
    assert(result.ok === true, "retry returns the successful response body");
  }

  // 2b. Non-401 failure throws GoogleApiError without retrying.
  {
    const { impl, calls } = fakeFetchSequence([{ status: 500, body: { error: "boom" } }]);
    const opts: GoogleClientOptions = { fetchFn: impl, getToken: async () => "t" };
    let threw: unknown = null;
    try {
      await googleFetchJson("https://example.invalid/z", { method: "GET" }, opts);
    } catch (err) {
      threw = err;
    }
    assert(threw instanceof GoogleApiError && threw.status === 500, "a 500 throws GoogleApiError with the status");
    assert(calls.length === 1, "a non-401 failure does not retry");
  }

  // 2c. Signed out (no token at all).
  {
    const opts: GoogleClientOptions = { fetchFn: (async () => { throw new Error("should not be called"); }) as typeof fetch, getToken: async () => null };
    let threw: unknown = null;
    try {
      await googleFetchJson("https://example.invalid/w", { method: "GET" }, opts);
    } catch (err) {
      threw = err;
    }
    assert(threw instanceof GoogleApiError, "no token at all throws GoogleApiError without ever calling fetch");
  }

  // 3. Tasks row mapping.
  {
    const tasklist = { id: "list-1", title: "Askewly Today" };
    const withMetadata = {
      id: "t-1",
      title: "메타데이터 태스크",
      status: "needsAction",
      notes: [
        "some detail text",
        "",
        "--- Askewly metadata ---",
        "section: today",
        "status: doing",
        "project: Askewly Command",
        "scheduled_for: 2026-07-10",
        "due_at: 2026-07-11T00:00:00.000Z",
      ].join("\n"),
    };
    const row = rowFromGoogleTask(withMetadata, tasklist);
    assert(row.detail === "some detail text", "metadata row strips the metadata block, keeping the detail body");
    assert(row.status === "doing", "metadata row reads status: doing");
    assert(row.project_name === "Askewly Command", "metadata row reads the project");
    assert(row.due_at === "2026-07-11T00:00:00.000Z", "metadata row reads due_at from the metadata block");
    assert(row.section === "today", "metadata row reads section from the metadata block");

    const importerRow = rowFromGoogleTask(
      { id: "t-2", title: "importer 태스크", status: "needsAction", notes: "Due at: 2026-08-01T00:00:00.000Z\nsome note" },
      tasklist,
    );
    assert(importerRow.due_at === "2026-08-01T00:00:00.000Z", "row falls back to the M69 importer 'Due at:' line");
    assert(importerRow.status === "todo", "row with no metadata and needsAction status defaults to todo");

    const staleDueRow = rowFromGoogleTask(
      { id: "t-3", title: "epoch-zero due", status: "needsAction", due: "1970-01-01T00:00:00.000Z" },
      tasklist,
    );
    assert(staleDueRow.due_at === null, "pre-2000 due dates are sanitized to null");

    const completedRow = rowFromGoogleTask({ id: "t-4", title: "done task", status: "completed" }, tasklist);
    assert(completedRow.status === "done", "Google status completed maps to 'done' when no metadata status is present");

    const backlogTasklist = { id: "list-2", title: "Askewly Backlog" };
    const noMetaRow = rowFromGoogleTask({ id: "t-5", title: "no meta", status: "needsAction" }, backlogTasklist);
    assert(noMetaRow.section === "backlog", "row without a metadata section falls back to the tasklist-title mapping");
  }

  // 3b. findTaskListByTitle + listActiveTasksForList wiring.
  {
    const { impl, calls } = fakeFetchSequence([
      { status: 200, body: { items: [{ id: "list-1", title: "Askewly Today" }, { id: "list-2", title: "Askewly Backlog" }] } },
    ]);
    const opts: GoogleClientOptions = { fetchFn: impl, getToken: async () => "t" };
    const found = await findTaskListByTitle("Askewly Backlog", opts);
    assert(found?.id === "list-2", "findTaskListByTitle finds the list by exact title match");
    assert(calls[0].url.includes("tasks.googleapis.com/tasks/v1/users/@me/lists"), "tasklists lookup hits the Tasks API tasklists endpoint");
  }
  {
    const { impl, calls } = fakeFetchSequence([{ status: 200, body: { items: [{ id: "tk-1", title: "task 1", status: "needsAction" }] } }]);
    const opts: GoogleClientOptions = { fetchFn: impl, getToken: async () => "t" };
    const rows = await listActiveTasksForList({ id: "list-1", title: "Askewly Today" }, opts);
    assert(rows.length === 1 && rows[0].id === "tk-1", "listActiveTasksForList maps the tasks response into rows");
    assert(calls[0].url.includes("showCompleted=false"), "active task listing requests showCompleted=false");
  }

  // 4. KST day + month bounds, and that the fetch calls carry them.
  {
    const bounds = kstDayBoundsIso(new Date("2026-07-10T12:00:00Z"));
    assert(bounds.dateStr === "2026-07-10", "kstDayBoundsIso computes the KST date string");
    assert(bounds.timeMin === "2026-07-10T00:00:00+09:00", "kstDayBoundsIso timeMin is midnight KST");
    assert(bounds.timeMax === "2026-07-10T23:59:59+09:00", "kstDayBoundsIso timeMax is end-of-day KST");

    const monthBounds = kstMonthBoundsIso("2026-02");
    assert(monthBounds.timeMin === "2026-02-01T00:00:00+09:00", "kstMonthBoundsIso timeMin is the 1st of the month");
    assert(monthBounds.timeMax === "2026-02-28T23:59:59+09:00", "kstMonthBoundsIso timeMax is the last day of a non-leap February");

    const leapBounds = kstMonthBoundsIso("2028-02");
    assert(leapBounds.timeMax === "2028-02-29T23:59:59+09:00", "kstMonthBoundsIso handles a leap February");
  }
  {
    const { impl, calls } = fakeFetchSequence([{ status: 200, body: { items: [] } }]);
    const opts: GoogleClientOptions = { fetchFn: impl, getToken: async () => "t" };
    await listTodayEvents(opts);
    const url = new URL(calls[0].url);
    assert(url.pathname.includes("/calendars/primary/events"), "listTodayEvents hits the primary calendar events endpoint");
    assert(url.searchParams.get("singleEvents") === "true", "listTodayEvents requests singleEvents=true");
    assert(url.searchParams.get("timeMin")?.endsWith("+09:00"), "listTodayEvents sends a KST-offset timeMin");
  }
  {
    const { impl, calls } = fakeFetchSequence([{ status: 200, body: { items: [] } }]);
    const opts: GoogleClientOptions = { fetchFn: impl, getToken: async () => "t" };
    await listMonthEvents("2026-07", opts);
    const url = new URL(calls[0].url);
    assert(url.searchParams.get("timeMin") === "2026-07-01T00:00:00+09:00", "listMonthEvents sends the month's first-day timeMin");
    assert(url.searchParams.get("timeMax") === "2026-07-31T23:59:59+09:00", "listMonthEvents sends the month's last-day timeMax");
  }

  // 4b. all-day/ongoing + ±30min helpers.
  {
    const allDay = { id: "e1", summary: "s", start: "2026-07-10", end: "2026-07-10", allDay: true, location: null, description: null, htmlLink: null };
    assert(isAllDayOrOngoing(allDay, "2026-07-10"), "an all-day event is always allDayOrOngoing on its date");
    const ongoing = { id: "e2", summary: "s", start: "2026-07-08T00:00:00+09:00", end: "2026-07-12T00:00:00+09:00", allDay: false, location: null, description: null, htmlLink: null };
    assert(isAllDayOrOngoing(ongoing, "2026-07-10"), "a multi-day timed event spanning today is ongoing");
    const notOngoing = { id: "e3", summary: "s", start: "2026-07-01T09:00:00+09:00", end: "2026-07-01T10:00:00+09:00", allDay: false, location: null, description: null, htmlLink: null };
    assert(!isAllDayOrOngoing(notOngoing, "2026-07-10"), "a single-day past event is not ongoing today");

    const near = { id: "e4", summary: "s", start: "2026-07-10T10:00:00+09:00", end: "2026-07-10T10:20:00+09:00", allDay: false, location: null, description: null, htmlLink: null };
    assert(isEventNearNow(near, new Date("2026-07-10T01:10:00Z")), "an event starting in 20 minutes is within the ±30min window"); // 01:10 UTC = 10:10 KST
    assert(!isEventNearNow(near, new Date("2026-07-10T02:00:00Z")), "an event more than 30 minutes away is outside the window"); // 02:00 UTC = 11:00 KST
  }

  // 5. Sheets header mapping + filter/sort.
  {
    const { impl, calls } = fakeFetchSequence([{ status: 200, body: { files: [{ id: "sheet-1", name: "Askewly Command Catalog" }] } }]);
    const opts: GoogleClientOptions = { fetchFn: impl, getToken: async () => "t" };
    const id = await findCatalogSpreadsheetId(opts);
    assert(id === "sheet-1", "findCatalogSpreadsheetId returns the matching Drive file id");
    assert(calls[0].url.includes("Askewly+Command+Catalog") || calls[0].url.includes("Askewly%20Command%20Catalog"), "spreadsheet lookup queries Drive by the catalog title");
  }
  {
    const values = [
      ["supabase_id", "name", "status", "sort_order", "created_at"],
      ["1", "Askewly Command", "active", "-5", "2026-01-01T00:00:00.000Z"],
      ["2", "Archived Thing", "archived", "10", "2026-01-02T00:00:00.000Z"],
      ["", "", "", "", ""],
    ];
    const { impl } = fakeFetchSequence([{ status: 200, body: { values } }]);
    const opts: GoogleClientOptions = { fetchFn: impl, getToken: async () => "t" };
    const rows = await readProjectsSheet("sheet-1", opts);
    assert(rows.length === 2, "readProjectsSheet skips the blank trailing row");
    assert(rows[0].name === "Askewly Command", "readProjectsSheet maps columns by header name");

    const filtered = sortAndFilterProjects(rows);
    assert(filtered.length === 1 && filtered[0].name === "Askewly Command", "sortAndFilterProjects excludes archived rows by default");
    assert(isPinned(rows[0]), "a negative sort_order marks a project as pinned");
    assert(!isPinned(rows[1]), "a positive sort_order is not pinned");

    const all = sortAndFilterProjects(rows, { status: "all" });
    assert(all.length === 2, "status: 'all' includes archived rows");
  }

  // 6. TtlCache: hit within TTL, miss after TTL, stale fallback on error.
  {
    const cache = new TtlCache(1000);
    let calls = 0;
    let now = 0;
    const fetcher = async () => {
      calls += 1;
      return `value-${calls}`;
    };
    const first = await cache.get("k", fetcher, () => now);
    assert(first.data === "value-1" && first.stale === false, "first get() fetches and caches");
    now = 500;
    const second = await cache.get("k", fetcher, () => now);
    assert(second.data === "value-1" && calls === 1, "a get() within the TTL window is a cache hit (no refetch)");
    now = 2000;
    const third = await cache.get("k", fetcher, () => now);
    assert(third.data === "value-2" && calls === 2, "a get() past the TTL window refetches");

    const failingFetcher = async () => {
      throw new Error("network down");
    };
    now = 3500;
    const fourth = await cache.get("k", failingFetcher, () => now);
    assert(fourth.data === "value-2" && fourth.stale === true, "a failed refetch falls back to the last good value, marked stale");

    const emptyCache = new TtlCache(1000);
    let threw = false;
    try {
      await emptyCache.get("k", failingFetcher);
    } catch {
      threw = true;
    }
    assert(threw, "a failed fetch with no prior cached value throws (nothing to fall back to)");
  }

  // 7. Write ops (M73 S4): payload shapes, metadata block, googleStatus mapping, move=insert+delete order.
  {
    // 7a. buildTaskBody: 'today' section with explicit dates.
    const bodyToday = buildTaskBody(
      { title: "Test", detail: "d", project: "P", status: "doing", scheduledFor: "2026-07-10" },
      "today",
    );
    assert(bodyToday.notes.includes("section: today"), "buildTaskBody(today) notes include section: today");
    assert(bodyToday.notes.includes("status: doing"), "buildTaskBody(today) notes include status: doing");
    assert(bodyToday.notes.includes("project: P"), "buildTaskBody(today) notes include the project line");
    assert(
      bodyToday.notes.includes("scheduled_for: 2026-07-10"),
      "buildTaskBody(today) notes include the scheduled_for line",
    );
    assert(bodyToday.status === "needsAction", "buildTaskBody maps status 'doing' to Google status needsAction");
    assert(
      bodyToday.due === "2026-07-10T00:00:00.000Z",
      "buildTaskBody(today) sets .due from the scheduled_for date",
    );

    // 7a-cont. buildTaskBody: 'backlog' section has no due, and status 'done' maps to completed.
    const bodyBacklog = buildTaskBody({ title: "B", status: "done" }, "backlog");
    assert(bodyBacklog.due === undefined, "buildTaskBody(backlog) sets no .due (backlog tasks aren't dated)");
    assert(bodyBacklog.status === "completed", "buildTaskBody maps status 'done' to Google status completed");
    assert(
      !bodyBacklog.notes.includes("project:") && !bodyBacklog.notes.includes("scheduled_for:"),
      "buildTaskBody omits absent metadata lines (no project/scheduled_for)",
    );

    // 7b. addTask: finds the existing tasklist, then POSTs the task insert.
    {
      const { impl, calls } = fakeFetchSequence([
        { status: 200, body: { items: [{ id: "list-today", title: "Askewly Today" }] } },
        { status: 200, body: { id: "new-task", title: "새 할 일", status: "needsAction" } },
      ]);
      const opts: GoogleClientOptions = { fetchFn: impl, getToken: async () => "t" };
      const row = await addTask("today", { title: "새 할 일" }, opts);
      assert(row.id === "new-task", "addTask returns the created row");
      assert(calls[0].init.method === undefined || calls[0].init.method === "GET", "addTask first looks up the tasklist (GET)");
      assert(calls[1].init.method === "POST", "addTask inserts the new task via POST");
      assert(
        calls[1].url.includes("/lists/list-today/tasks"),
        "addTask posts to the resolved tasklist's /tasks endpoint",
      );
    }

    // 7c. updateTask: PATCHes the specific task in its current tasklist.
    {
      const { impl, calls } = fakeFetchSequence([
        { status: 200, body: { id: "t-1", title: "수정됨", status: "needsAction" } },
      ]);
      const opts: GoogleClientOptions = { fetchFn: impl, getToken: async () => "t" };
      const row: TaskRow = {
        id: "t-1",
        title: "원래 제목",
        detail: "",
        status: "todo",
        due_at: null,
        scheduled_for: null,
        section: "backlog",
        project_name: null,
        tasklist_id: "list-backlog",
        tasklist_title: "Askewly Backlog",
        updated_at: null,
      };
      await updateTask(row, { title: "수정됨" }, opts);
      assert(calls[0].init.method === "PATCH", "updateTask sends a PATCH");
      assert(
        calls[0].url.includes("/lists/list-backlog/tasks/t-1"),
        "updateTask targets the task's own tasklist and id",
      );
    }

    // 7d. toggleTask / setDoing: PATCH body is only { notes, status }, with the correct googleStatus mapping.
    {
      const row: TaskRow = {
        id: "t-2",
        title: "체크할 일",
        detail: "",
        status: "todo",
        due_at: null,
        scheduled_for: null,
        section: "today",
        project_name: null,
        tasklist_id: "list-today",
        tasklist_title: "Askewly Today",
        updated_at: null,
      };
      const { impl, calls } = fakeFetchSequence([
        { status: 200, body: { id: "t-2", title: "체크할 일", status: "completed" } },
      ]);
      const opts: GoogleClientOptions = { fetchFn: impl, getToken: async () => "t" };
      await toggleTask(row, opts);
      const sentBody = JSON.parse(String(calls[0].init.body));
      assert(
        Object.keys(sentBody).sort().join(",") === "notes,status",
        "toggleTask's PATCH body has exactly { notes, status }",
      );
      assert(sentBody.status === "completed", "toggleTask('todo'->'done') maps to Google status completed");
      assert(sentBody.notes.includes("status: done"), "toggleTask's metadata block records status: done");
    }
    {
      const row: TaskRow = {
        id: "t-3",
        title: "진행할 일",
        detail: "",
        status: "todo",
        due_at: null,
        scheduled_for: null,
        section: "today",
        project_name: null,
        tasklist_id: "list-today",
        tasklist_title: "Askewly Today",
        updated_at: null,
      };
      const { impl, calls } = fakeFetchSequence([
        { status: 200, body: { id: "t-3", title: "진행할 일", status: "needsAction" } },
      ]);
      const opts: GoogleClientOptions = { fetchFn: impl, getToken: async () => "t" };
      await setDoing(row, opts);
      const sentBody = JSON.parse(String(calls[0].init.body));
      assert(sentBody.status === "needsAction", "setDoing keeps the Google status needsAction ('doing' isn't a Google status)");
      assert(sentBody.notes.includes("status: doing"), "setDoing's metadata block records status: doing");
    }

    // 7e. moveTask: inserts into the target list, then deletes the source — in that order.
    {
      const row: TaskRow = {
        id: "t-4",
        title: "이동할 일",
        detail: "",
        status: "todo",
        due_at: null,
        scheduled_for: null,
        section: "today",
        project_name: null,
        tasklist_id: "list-today",
        tasklist_title: "Askewly Today",
        updated_at: null,
      };
      const { impl, calls } = fakeFetchSequence([
        { status: 200, body: { items: [{ id: "list-backlog", title: "Askewly Backlog" }] } },
        { status: 200, body: { id: "t-4-new", title: "이동할 일", status: "needsAction" } },
        { status: 204, body: {} },
      ]);
      const opts: GoogleClientOptions = { fetchFn: impl, getToken: async () => "t" };
      const moved = await moveTask(row, "backlog", opts);
      assert(moved.id === "t-4-new" && moved.tasklist_id === "list-backlog", "moveTask returns the row created in the target list");
      assert(calls[1].init.method === "POST" && calls[1].url.includes("/lists/list-backlog/tasks"), "moveTask's 2nd call inserts into the target tasklist");
      assert(
        calls[2].init.method === "DELETE" && calls[2].url.includes("/lists/list-today/tasks/t-4"),
        "moveTask's 3rd call deletes the source task",
      );
      assert(calls.length === 3, "moveTask makes exactly 3 calls: lookup, insert, delete (insert strictly before delete)");
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll Google data-layer checks passed.");
}

main().catch((err) => {
  console.error("verify-google-client crashed:", err);
  process.exit(1);
});
