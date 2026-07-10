const assert = require('assert');

const {
  migrateDeadlines,
  buildEventPayload,
  kstDateFromIso,
  addDaysToDateString
} = require('./migrate-deadlines-to-calendar');

const META_START = '--- Askewly metadata ---';

function notesFor(detail, meta) {
  const lines = [META_START, `section: deadlines`, `status: ${meta.status || 'todo'}`];
  if (meta.due_at) lines.push(`due_at: ${meta.due_at}`);
  return [detail, lines.join('\n')].filter(Boolean).join('\n\n');
}

function makeTask(overrides = {}) {
  return {
    id: overrides.id || 'task-1',
    title: overrides.title || 'Fixture deadline',
    notes: notesFor(overrides.detail !== undefined ? overrides.detail : 'Some detail body', {
      status: overrides.status || 'todo',
      due_at: overrides.due_at
    }),
    status: 'needsAction',
    due: overrides.taskDue,
    updated: '2026-07-01T00:00:00.000Z',
    ...overrides.taskFields
  };
}

// --- fake gws builder ---
// Simulates: tasks.tasklists.list, tasks.tasks.list, calendar.events.list,
// calendar.events.insert, tasks.tasks.delete
function makeFakeGws({ tasks = [], calendarSupportsPrivateExtendedProperty = true } = {}) {
  const tasklistId = 'tasklist-deadlines';
  const state = {
    tasks: tasks.slice(),
    events: [],
    nextEventId: 1,
    calls: [],
    deletedTaskIds: []
  };

  const gws = (args) => {
    state.calls.push(args);
    const [group, resource, action] = args;

    if (group === 'tasks' && resource === 'tasklists' && action === 'list') {
      return { items: [{ id: tasklistId, title: 'Askewly Deadlines' }] };
    }

    if (group === 'tasks' && resource === 'tasks' && action === 'list') {
      return { items: state.tasks.filter((task) => !state.deletedTaskIds.includes(task.id)) };
    }

    if (group === 'tasks' && resource === 'tasks' && action === 'delete') {
      const paramsArg = JSON.parse(args[args.indexOf('--params') + 1]);
      state.deletedTaskIds.push(paramsArg.task);
      return {};
    }

    if (group === 'calendar' && resource === 'events' && action === 'list') {
      const paramsArg = JSON.parse(args[args.indexOf('--params') + 1]);
      if (paramsArg.privateExtendedProperty) {
        if (!calendarSupportsPrivateExtendedProperty) {
          throw new Error('privateExtendedProperty not supported (simulated)');
        }
        const [, wantedId] = String(paramsArg.privateExtendedProperty[0]).split('=');
        const matches = state.events.filter((event) => event.extendedProperties?.private?.askewlyTaskId === wantedId);
        return { items: matches };
      }
      // window/text-match fallback query (no property filter)
      return { items: state.events.slice() };
    }

    if (group === 'calendar' && resource === 'events' && action === 'insert') {
      const jsonArg = JSON.parse(args[args.indexOf('--json') + 1]);
      const event = { id: `event-${state.nextEventId++}`, ...jsonArg };
      state.events.push(event);
      return event;
    }

    throw new Error(`fake gws: unhandled call ${JSON.stringify(args)}`);
  };

  gws.state = state;
  return gws;
}

// --- 1. mapping: KST date, all-day shape, description footer, extendedProperties ---

{
  const row = {
    id: 'task-abc',
    title: 'Pay taxes',
    detail: 'File before deadline',
    due_at: '2026-07-15T14:59:00.000Z' // 23:59 KST on 2026-07-15
  };
  assert.strictEqual(kstDateFromIso(row.due_at), '2026-07-15', 'KST date should be 2026-07-15');
  const payload = buildEventPayload(row);
  assert.deepStrictEqual(payload.start, { date: '2026-07-15' }, 'all-day start.date shape');
  assert.deepStrictEqual(payload.end, { date: '2026-07-16' }, 'all-day end.date is exclusive next day');
  assert.strictEqual(payload.summary, 'Pay taxes');
  assert.ok(payload.description.includes('File before deadline'), 'description includes task detail');
  assert.ok(payload.description.includes('askewly-migrated-from-task: task-abc'), 'description includes traceability footer');
  assert.deepStrictEqual(payload.extendedProperties, { private: { askewlyTaskId: 'task-abc' } });

  // edge: KST date crossing midnight UTC boundary
  assert.strictEqual(kstDateFromIso('2026-07-14T15:30:00.000Z'), '2026-07-15', 'UTC 15:30 -> KST next day date');
  assert.strictEqual(addDaysToDateString('2026-07-15', 1), '2026-07-16');
  assert.strictEqual(addDaysToDateString('2026-07-15', -1), '2026-07-14');

  // edge: empty detail collapses to footer-only description
  const noDetailPayload = buildEventPayload({ id: 't2', title: 'No detail', detail: '', due_at: '2026-01-01T00:00:00.000Z' });
  assert.strictEqual(noDetailPayload.description, 'askewly-migrated-from-task: t2');

  console.log('mapping (KST date, all-day shape, footer, extendedProperties) ok');
}

// --- 2. no-due -> error classification ---

{
  const tasks = [makeTask({ id: 'no-due-1', due_at: undefined, taskDue: undefined })];
  const gws = makeFakeGws({ tasks });
  const result = migrateDeadlines({ gws, live: false });
  assert.strictEqual(result.counts.error, 1, 'task with no usable due date should be classified error');
  assert.strictEqual(result.counts.planned, 0);
  const errorItem = result.results.find((item) => item.taskId === 'no-due-1');
  assert.strictEqual(errorItem.classification, 'error');
  assert.ok(/no usable due date/.test(errorItem.reason));

  console.log('no-due error classification ok');
}

// --- 3. dry-run makes no write calls ---

{
  const tasks = [
    makeTask({ id: 'dry-1', due_at: '2026-08-01T14:59:00.000Z' }),
    makeTask({ id: 'dry-2', due_at: undefined, taskDue: undefined })
  ];
  const gws = makeFakeGws({ tasks });
  const result = migrateDeadlines({ gws, live: false });
  const writeCalls = gws.state.calls.filter(([, , action]) => action === 'insert' || action === 'delete');
  assert.strictEqual(writeCalls.length, 0, 'dry-run must not call insert or delete');
  assert.strictEqual(result.mode, 'dry-run');
  assert.strictEqual(result.counts.planned, 1);
  assert.strictEqual(result.counts.error, 1);

  console.log('dry-run no-write-call ok');
}

// --- 4. live path: creates event then deletes task; rerun is idempotent (skip, 0 created) ---

{
  const tasks = [makeTask({ id: 'live-1', due_at: '2026-09-10T14:59:00.000Z' })];
  const gws = makeFakeGws({ tasks });

  const firstLive = migrateDeadlines({ gws, live: true });
  assert.strictEqual(firstLive.counts.created, 1, 'first live run should create 1 event');
  assert.strictEqual(firstLive.counts.error, 0);
  assert.deepStrictEqual(gws.state.deletedTaskIds, ['live-1'], 'source task must be deleted after event create');
  assert.strictEqual(gws.state.events.length, 1);
  const ledgerEntry = firstLive.ledger_entries.find((entry) => entry.taskId === 'live-1');
  assert.strictEqual(ledgerEntry.status, 'deleted', 'ledger status should be deleted (event created + task deleted)');
  assert.ok(ledgerEntry.eventId);

  // Rerun: task list now empty (task was deleted), so nothing to do -> 0 created.
  const secondLive = migrateDeadlines({ gws, live: true });
  assert.strictEqual(secondLive.counts.created, 0, 'rerun must create 0 new events');
  assert.strictEqual(secondLive.results.length, 0, 'no remaining active deadline tasks after prior run deleted them');

  console.log('live create-then-delete + idempotent rerun ok (created 0 on rerun)');
}

// --- 5. idempotent skip even if the source task were NOT deleted (event already exists) ---

{
  const tasks = [makeTask({ id: 'skip-1', due_at: '2026-10-05T14:59:00.000Z' })];
  const gws = makeFakeGws({ tasks });

  const first = migrateDeadlines({ gws, live: true });
  assert.strictEqual(first.counts.created, 1);

  // Simulate a rerun where the task delete had failed upstream (task still
  // active in the tasklist) even though its event already exists -> must
  // classify skip, not duplicate-create.
  gws.state.deletedTaskIds = gws.state.deletedTaskIds.filter((id) => id !== 'skip-1');

  const insertCallsBefore = gws.state.calls.filter(([, , action]) => action === 'insert').length;
  const second = migrateDeadlines({ gws, live: true });
  const insertCallsAfter = gws.state.calls.filter(([, , action]) => action === 'insert').length;

  assert.strictEqual(insertCallsAfter, insertCallsBefore, 'no new insert call when event already exists for taskId');
  assert.strictEqual(second.counts.skip, 1, 'task with existing matching event should classify skip');
  assert.strictEqual(second.counts.created, 0);

  console.log('idempotent skip (existing event, no duplicate insert) ok');
}

// --- 6. live path: task delete only happens after event create succeeds (create failure -> no delete) ---

{
  const tasks = [makeTask({ id: 'fail-1', due_at: '2026-11-01T14:59:00.000Z' })];
  const gws = makeFakeGws({ tasks });
  const originalGws = gws;
  const failingGws = (args) => {
    const [group, resource, action] = args;
    if (group === 'calendar' && resource === 'events' && action === 'insert') {
      throw new Error('simulated calendar insert failure');
    }
    return originalGws(args);
  };

  const result = migrateDeadlines({ gws: failingGws, live: true });
  assert.strictEqual(result.counts.error, 1, 'insert failure should classify as error');
  assert.strictEqual(result.counts.created, 0);
  assert.deepStrictEqual(gws.state.deletedTaskIds, [], 'task must NOT be deleted when event create failed');

  console.log('event-create-failure blocks task-delete ok');
}

// --- 7. privateExtendedProperty unsupported -> falls back to text-match on footer ---

{
  const tasks = [makeTask({ id: 'fallback-1', due_at: '2026-12-01T14:59:00.000Z' })];
  const gws = makeFakeGws({ tasks, calendarSupportsPrivateExtendedProperty: false });

  const first = migrateDeadlines({ gws, live: true });
  assert.strictEqual(first.counts.created, 1);

  gws.state.deletedTaskIds = gws.state.deletedTaskIds.filter((id) => id !== 'fallback-1');

  const second = migrateDeadlines({ gws, live: true });
  assert.strictEqual(second.counts.skip, 1, 'text-match fallback should detect existing event via footer');
  assert.strictEqual(second.counts.created, 0);

  console.log('privateExtendedProperty-unsupported text-match fallback ok');
}

console.log('migrate-deadlines-to-calendar verify ok: mapping, no-due error, dry-run no-write-calls, live create+delete, idempotent skip, create-failure blocks delete, and text-match fallback');
