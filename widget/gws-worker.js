'use strict';

// Runs inside a worker_threads Worker (see service-bridge.js). data-service.js
// (and the scripts/lib/google-workspace-* libs it uses) call spawnSync — fine
// here, since blocking *this* thread's event loop never touches the Electron
// main process / renderer, unlike when data-service was required directly
// from ipcMain handlers in main.js.

const { parentPort } = require('worker_threads');

if (!parentPort) {
  throw new Error('gws-worker.js must be run inside a worker_threads Worker');
}

// Test-only hook: if GWS_WORKER_TEST_HOOK points at a module path, require it
// before loading data-service so it can monkeypatch child_process.spawnSync
// with a fake in-memory gws responder. No-op unless a test sets the env var
// (see scripts/verify-widget-service-bridge.js).
if (process.env.GWS_WORKER_TEST_HOOK) {
  require(process.env.GWS_WORKER_TEST_HOOK);
}

const dataService = require('./data-service');

// Snapshot single-flight: if a snapshot fetch is already in progress, later
// callers share the same in-flight promise instead of re-running the full
// calendar + tasks(x3) + catalog gws call chain. The setImmediate defer gives
// a back-to-back second 'message' event a chance to see snapshotInFlight
// already set before the (synchronous, blocking) data-service work starts.
let snapshotInFlight = null;
function handleSnapshot() {
  if (snapshotInFlight) return snapshotInFlight;
  snapshotInFlight = new Promise((resolve, reject) => {
    setImmediate(() => {
      try {
        resolve(dataService.getSnapshot());
      } catch (error) {
        reject(error);
      }
    });
  });
  snapshotInFlight.finally(() => {
    snapshotInFlight = null;
  });
  return snapshotInFlight;
}

const OPS = {
  snapshot: () => handleSnapshot(),
  taskAdd: (payload) => dataService.taskAdd(payload || {}),
  taskToggle: (payload) => dataService.taskToggle(payload || {}),
  taskDefer: (payload) => dataService.taskDefer(payload || {}),
  taskUpdate: (payload) => dataService.taskUpdate(payload || {}),
  eventUpdate: (payload) => dataService.eventUpdate(payload || {}),
  eventDelete: (payload) => dataService.eventDelete(payload || {}),
  eventsRange: (payload) => dataService.eventsRange(payload || {})
};

parentPort.on('message', async (message) => {
  const { id, op, payload } = message || {};
  const handler = OPS[op];
  if (!handler) {
    parentPort.postMessage({ id, ok: false, error: `gws-worker: unknown op "${op}"` });
    return;
  }
  try {
    const result = await handler(payload);
    parentPort.postMessage({ id, ok: true, result });
  } catch (error) {
    parentPort.postMessage({ id, ok: false, error: String(error?.message || error) });
  }
});
