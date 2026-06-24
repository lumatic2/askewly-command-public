const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('workspacePulse', {
  getInitialState: () => ipcRenderer.invoke('widget:get-initial-state'),
  getSettings: () => ipcRenderer.invoke('widget:get-settings'),
  updateSettings: (payload) => ipcRenderer.invoke('widget:update-settings', payload),
  getCloudAuthStatus: () => ipcRenderer.invoke('widget:get-cloud-auth-status'),
  signInCloud: (payload) => ipcRenderer.invoke('widget:sign-in-cloud', payload),
  signOutCloud: () => ipcRenderer.invoke('widget:sign-out-cloud'),
  getWindowBounds: () => ipcRenderer.invoke('widget:get-window-bounds'),
  updateScheduleItem: (payload) => ipcRenderer.invoke('widget:update-schedule-item', payload),
  addScheduleItem: (payload) => ipcRenderer.invoke('widget:add-schedule-item', payload),
  restoreArchivedItem: (payload) => ipcRenderer.invoke('widget:restore-archived-item', payload),
  deleteScheduleItem: (payload) => ipcRenderer.invoke('widget:delete-schedule-item', payload),
  moveScheduleItem: (payload) => ipcRenderer.invoke('widget:move-schedule-item', payload),
  reorderScheduleItem: (payload) => ipcRenderer.invoke('widget:reorder-schedule-item', payload),
  updateScheduleItemText: (payload) => ipcRenderer.invoke('widget:update-schedule-item-text', payload),
  updateScheduleItemGraph: (payload) => ipcRenderer.invoke('widget:update-schedule-item-graph', payload),
  openScheduleSource: (payload) => ipcRenderer.invoke('widget:open-schedule-source', payload),
  openGithubTarget: (payload) => ipcRenderer.invoke('widget:open-github-target', payload),
  onState: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('widget-state', listener);
    return () => ipcRenderer.removeListener('widget-state', listener);
  },
  onSyncStatus: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('widget-sync-status', listener);
    return () => ipcRenderer.removeListener('widget-sync-status', listener);
  },
  resizeWindow: (payload) => ipcRenderer.send('widget:resize-window', payload),
  hide: () => ipcRenderer.send('widget:hide'),
  refresh: () => ipcRenderer.invoke('widget:refresh'),
  syncPushVault: (payload) => ipcRenderer.invoke('widget:sync-push-vault', payload),
  syncPullVault: () => ipcRenderer.invoke('widget:sync-pull-vault'),
  getSyncStatus: () => ipcRenderer.invoke('widget:get-sync-status'),
  getContentState: () => ipcRenderer.invoke('widget:get-content-state'),
  getProjectsState: () => ipcRenderer.invoke('widget:get-projects-state'),
  getVaultState: () => ipcRenderer.invoke('widget:get-vault-state'),
  openVaultNote: (payload) => ipcRenderer.invoke('widget:open-vault-note', payload),
  readVaultNote: (payload) => ipcRenderer.invoke('widget:read-vault-note', payload),
  getNotionState: () => ipcRenderer.invoke('widget:get-notion-state'),
  getNotionChildren: (payload) => ipcRenderer.invoke('widget:get-notion-children', payload),
  openNotionPage: (payload) => ipcRenderer.invoke('widget:open-notion-page', payload),
  notionWorkspaceAction: (payload) => ipcRenderer.invoke('widget:notion-workspace-action', payload),
  openProjectAction: (payload) => ipcRenderer.invoke('widget:open-project-action', payload),
  updateProjectMeta: (payload) => ipcRenderer.invoke('widget:update-project-meta', payload),
  runCronJob: (payload) => ipcRenderer.invoke('widget:run-cron-job', payload),
  getCalendarState: (payload) => ipcRenderer.invoke('widget:get-calendar-state', payload),
  openCalendarDay: (payload) => ipcRenderer.invoke('widget:open-calendar-day', payload),
  openCalendarEvent: (payload) => ipcRenderer.invoke('widget:open-calendar-event', payload),
  addCalendarEvent: (payload) => ipcRenderer.invoke('widget:add-calendar-event', payload),
  updateCalendarEvent: (payload) => ipcRenderer.invoke('widget:update-calendar-event', payload),
  deleteCalendarEvent: (payload) => ipcRenderer.invoke('widget:delete-calendar-event', payload),
  getTodayLog: () => ipcRenderer.invoke('widget:get-today-log'),
  appendTodayLog: (payload) => ipcRenderer.invoke('widget:append-today-log', payload),
  openTodayLog: () => ipcRenderer.invoke('widget:open-today-log'),
  deleteTodayLogLine: (payload) => ipcRenderer.invoke('widget:delete-today-log-line', payload),
  editTodayLogLine: (payload) => ipcRenderer.invoke('widget:edit-today-log-line', payload),
  close: () => ipcRenderer.send('widget:close')
});
