'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Narrow whitelist — the renderer can never invoke an arbitrary IPC channel.
const CHANNEL_WHITELIST = new Set([
  'widget:snapshot',
  'widget:task-add',
  'widget:task-toggle',
  'widget:task-defer',
  'widget:task-update',
  'widget:event-update',
  'widget:event-delete',
  'widget:events-range',
  'widget:quit',
  'widget:set-always-on-top'
]);

contextBridge.exposeInMainWorld('widget', {
  getSnapshot: () => ipcRenderer.invoke('widget:snapshot'),
  invoke: (channel, payload) => {
    if (!CHANNEL_WHITELIST.has(channel)) {
      return Promise.reject(new Error(`widget: channel not allowed: ${channel}`));
    }
    return ipcRenderer.invoke(channel, payload);
  },
  // Env-guarded QA hook (harmless in normal use): lets a launch script force
  // the renderer's initial nav-rail view for screenshot capture, e.g.
  // `WIDGET_INITIAL_VIEW=backlog`. Undefined/empty when unset.
  initialView: process.env.WIDGET_INITIAL_VIEW || null
});
