'use strict';

// Bridges Electron main-process ipcMain handlers to gws-worker.js, which runs
// data-service.js's spawnSync-based Google Workspace calls off the main
// thread. Root cause of the "click and it freezes" bug: every ipcMain handler
// used to call widget/data-service.js directly, and its spawnSync calls (one
// per gws subprocess — calendar list, 3x task list, Drive/Sheets catalog
// lookups) blocked the main process event loop, so all window input (clicks,
// wheel, resize) froze for the duration of each snapshot/CRUD round trip.

const path = require('path');
const { Worker } = require('worker_threads');

const WORKER_PATH = path.join(__dirname, 'gws-worker.js');
const MAX_AUTO_RESTARTS = 1;

class ServiceBridge {
  constructor() {
    this.pending = new Map();
    this.nextId = 1;
    this.restartCount = 0;
    this.fatalError = null;
    this.worker = null;
    this._spawn();
  }

  _spawn() {
    const worker = new Worker(WORKER_PATH);
    worker.on('message', (message) => this._handleMessage(message));
    worker.on('error', (error) => this._handleWorkerDeath(error));
    worker.on('exit', (code) => {
      if (code !== 0) this._handleWorkerDeath(new Error(`gws-worker exited with code ${code}`));
    });
    this.worker = worker;
  }

  _handleMessage(message) {
    const { id, ok, result, error } = message || {};
    const entry = this.pending.get(id);
    if (!entry) return;
    this.pending.delete(id);
    if (ok) entry.resolve(result);
    else entry.reject(new Error(error || 'gws-worker op failed'));
  }

  // A dead worker can't recover in-flight requests — whatever spawnSync chain
  // it was mid-way through is gone with the thread. Reject those callers so
  // they retry instead of hanging forever; restart the worker once so the
  // *next* call still works. A second death gives up and surfaces the error
  // to every future call too (better than silently retrying forever).
  _handleWorkerDeath(error) {
    const inFlight = Array.from(this.pending.values());
    this.pending.clear();
    try {
      this.worker.removeAllListeners();
    } catch {
      // best-effort
    }
    if (this.restartCount < MAX_AUTO_RESTARTS) {
      this.restartCount += 1;
      this._spawn();
    } else {
      this.fatalError = error;
    }
    for (const entry of inFlight) entry.reject(error);
  }

  call(op, payload) {
    if (this.fatalError) return Promise.reject(this.fatalError);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, op, payload });
    });
  }

  async terminate() {
    if (this.worker) await this.worker.terminate();
  }
}

module.exports = { ServiceBridge };
