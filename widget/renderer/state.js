'use strict';

// Pure, DOM-free task-list state transitions shared by the renderer (app.js,
// loaded as a classic <script> — no bundler) and the offline verifier
// (scripts/verify-widget-crud-ui.js, loaded via Node `require`). No side
// effects, no IPC — every function takes a tasks object `{ today, deadlines,
// backlog }` and returns a new one (arrays/objects are copied, never mutated
// in place) so optimistic-update + rollback tests can compare snapshots.

(function (root, factory) {
  const widgetState = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = widgetState;
  }
  if (root) {
    root.WidgetState = widgetState;
  }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null, function () {
  const SECTIONS = ['today', 'deadlines', 'backlog'];

  function cloneTasks(tasks) {
    const source = tasks || {};
    return {
      today: [...(source.today || [])],
      deadlines: [...(source.deadlines || [])],
      backlog: [...(source.backlog || [])]
    };
  }

  function findTaskLocation(tasks, id) {
    for (const section of SECTIONS) {
      const list = (tasks && tasks[section]) || [];
      const index = list.findIndex((task) => task.id === id);
      if (index >= 0) return { section, index, task: list[index] };
    }
    return null;
  }

  // ---- add ---------------------------------------------------------------

  function addTaskOptimistic(tasks, section, tempTask) {
    const next = cloneTasks(tasks);
    next[section] = [tempTask, ...next[section]];
    return next;
  }

  function replaceTask(tasks, section, tempId, serverTask) {
    const next = cloneTasks(tasks);
    next[section] = next[section].map((task) => (task.id === tempId ? serverTask : task));
    return next;
  }

  // ---- remove / rollback --------------------------------------------------

  function removeTask(tasks, section, id) {
    const next = cloneTasks(tasks);
    next[section] = next[section].filter((task) => task.id !== id);
    return next;
  }

  function insertTaskAt(tasks, section, index, task) {
    const next = cloneTasks(tasks);
    const list = next[section];
    const clampedIndex = Math.max(0, Math.min(index, list.length));
    list.splice(clampedIndex, 0, task);
    return next;
  }

  // ---- toggle --------------------------------------------------------------

  function setTaskStatusLocal(tasks, section, id, status) {
    const next = cloneTasks(tasks);
    next[section] = next[section].map((task) => (task.id === id ? { ...task, status } : task));
    return next;
  }

  // ---- edit ------------------------------------------------------------------

  function updateTaskLocal(tasks, section, id, fields) {
    const next = cloneTasks(tasks);
    next[section] = next[section].map((task) => (task.id === id ? { ...task, ...fields } : task));
    return next;
  }

  // ---- defer / move -----------------------------------------------------------

  function moveTaskLocal(tasks, fromSection, toSection, id, serverTask) {
    let next = removeTask(tasks, fromSection, id);
    if (serverTask) {
      next[toSection] = [serverTask, ...next[toSection]];
    }
    return next;
  }

  return {
    SECTIONS,
    cloneTasks,
    findTaskLocation,
    addTaskOptimistic,
    replaceTask,
    removeTask,
    insertTaskAt,
    setTaskStatusLocal,
    updateTaskLocal,
    moveTaskLocal
  };
});
