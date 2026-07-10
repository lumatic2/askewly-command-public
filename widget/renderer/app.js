'use strict';

// Askewly Command Widget v2 — renderer (S3: full CRUD + optimistic UI).
// Renders window.widget.getSnapshot() into the today-first single column and
// wires quick-add / complete-toggle / defer / inline-edit through
// window.widget.invoke(channel, payload). Pure state transitions (add,
// toggle, remove, update, move) live in state.js (window.WidgetState) so the
// offline verifier can exercise them without a DOM.

const KST_TZ = 'Asia/Seoul';
const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'];
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const CLOCK_TICK_MS = 60 * 1000;
const NOW_WINDOW_MS = 30 * 60 * 1000;
const TOAST_DISMISS_MS = 4000;

let latestSnapshot = null;
let editingTaskId = null;
let editingEventId = null;
let deleteConfirmEventId = null;
let deleteConfirmTimer = null;
let pendingOps = 0;
let toastTimer = null;
let detailEventId = null; // 오늘 뷰의 일정 상세보기 (in-column expanding card)

// ---- 달력 탭 (round 3): month-window state, independent of the snapshot ----
let calYear = null;
let calMonth = null; // 0-indexed
let calSelectedDate = null; // YYYY-MM-DD
let calDetailEventId = null;
let calMonthEvents = [];
let calLoading = false;

function isBusy() {
  return pendingOps > 0 || editingTaskId !== null || editingEventId !== null;
}

function errMsg(error) {
  return error && error.message ? error.message : String(error);
}

function kstDateStr(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: KST_TZ }).format(date);
}

function kstTimeStr(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: KST_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).format(date);
}

// Best-effort preview for the inline-edit due field: mirrors
// scripts/lib/google-workspace-tasks.js#parseDueAt closely enough for an
// optimistic display. The authoritative value always comes back from the
// widget:task-update response and replaces this guess.
function kstDateTimeLocalStr(value) {
  if (!value) return '';
  const dateOnly = typeof value === 'string' && value.endsWith('T00:00:00.000Z');
  const dateStr = kstDateStr(value);
  if (!dateStr) return '';
  if (dateOnly) return dateStr;
  const timeStr = kstTimeStr(value);
  return timeStr ? `${dateStr} ${timeStr}` : dateStr;
}

function parseDueInputClient(raw) {
  const value = String(raw || '').trim();
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T23:59:00+09:00`;
  const withTime = value.replace(' ', 'T');
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(withTime)) return `${withTime}:00+09:00`;
  return value;
}

function svgIcon(paths, extra = '') {
  return `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${paths}</svg>`;
}

const ICON_CHECKBOX_EMPTY = svgIcon('<rect x="3" y="3" width="18" height="18" rx="3"/>');
const ICON_CHECKBOX_DONE = svgIcon('<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 12l3 3 5-6"/>');
const ICON_EDIT = svgIcon('<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/>');
const ICON_DOING = svgIcon('<circle cx="12" cy="12" r="9"/><path d="M10 8l6 4-6 4V8z"/>');
const ICON_DEFER_BACKLOG = svgIcon('<path d="M21 8H3"/><path d="M21 8v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8"/><path d="M10 12h4"/>');
const ICON_MOVE_TODAY = svgIcon('<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>');
const ICON_TRASH = svgIcon('<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>');

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function emptyLine(text) {
  return `<div class="empty-line">${escapeHtml(text)}</div>`;
}

function sectionBodyId(section) {
  return `${section}-body`;
}

function renderSection(section) {
  if (section === 'today') renderToday(latestSnapshot);
  else if (section === 'backlog') renderBacklog(latestSnapshot);
}

// ---- toast ---------------------------------------------------------------

function showToast(message, isError) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.toggle('is-error', !!isError);
  el.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, TOAST_DISMISS_MS);
}

// ---- header ----------------------------------------------------------

function renderHeader(snapshot) {
  const dateLineEl = document.getElementById('date-line');
  const staleBadgeEl = document.getElementById('stale-badge');

  const dateStr = snapshot && snapshot.date;
  if (dateStr) {
    const [year, month, day] = dateStr.split('-').map(Number);
    const weekday = WEEKDAY_KO[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
    dateLineEl.textContent = `${month}/${day} (${weekday})`;
  } else {
    dateLineEl.textContent = '--';
  }

  staleBadgeEl.hidden = !(snapshot && snapshot.stale);
}

// ---- section 1: events ------------------------------------------------

// A timed event whose start date (KST) is before today is a multi-day event
// still in progress — pin it with the all-day group instead of showing a
// misleading start time from a previous day. Times for these can't be edited
// (no single "today" start/end), so the edit form falls back to title only.
function isOngoingEvent(event, todayStr) {
  return !event.allDay && todayStr && String(event.start || '').slice(0, 10) < todayStr;
}

function renderEventRowActions(event) {
  const isConfirming = deleteConfirmEventId === event.id;
  return `<div class="event-row-actions">` +
    `<button type="button" class="action-btn" data-action="edit-event" title="편집">${ICON_EDIT}</button>` +
    (isConfirming
      ? `<button type="button" class="action-btn is-confirm-delete" data-action="delete-event-confirm" title="삭제 확인">삭제?</button>`
      : `<button type="button" class="action-btn" data-action="delete-event" title="삭제">${ICON_TRASH}</button>`) +
    `</div>`;
}

function renderEventEditForm(event, todayStr) {
  const editableTime = !event.allDay && !isOngoingEvent(event, todayStr);
  const startTime = editableTime ? (kstTimeStr(event.start) || '') : '';
  const endTime = editableTime ? (kstTimeStr(event.end) || '') : '';
  return `<div class="event-row is-editing" data-id="${escapeHtml(event.id)}">` +
    `<div class="edit-form">` +
    `<input type="text" class="edit-title" value="${escapeHtml(event.summary || '')}" placeholder="제목" />` +
    (editableTime
      ? `<div class="edit-time-row">` +
        `<input type="text" class="edit-start" value="${escapeHtml(startTime)}" placeholder="시작 HH:mm" />` +
        `<input type="text" class="edit-end" value="${escapeHtml(endTime)}" placeholder="종료 HH:mm" />` +
        `</div>`
      : '') +
    `<input type="text" class="edit-location" value="${escapeHtml(event.location || '')}" placeholder="장소" />` +
    `<textarea class="edit-description" placeholder="메모" rows="2">${escapeHtml(event.description || '')}</textarea>` +
    `<div class="edit-actions">` +
    `<button type="button" class="edit-btn edit-btn-save" data-action="save-event">저장</button>` +
    `<button type="button" class="edit-btn edit-btn-cancel" data-action="cancel-event">취소</button>` +
    `</div>` +
    `</div>` +
    `</div>`;
}

// 일정 상세보기 (round 3): in-column expanding card shown below an event row
// when its id matches detailEventId/calDetailEventId. Fields whose value is
// absent (no location, no description, no calendar name — calendar name is
// never fetched, see data-service.js#eventRow) are omitted quietly rather
// than shown as empty.
function renderEventDetail(event) {
  const todayStr = latestSnapshot && latestSnapshot.date;
  const ongoing = isOngoingEvent(event, todayStr);
  const dateLabel = kstDateStr(event.start) || '';
  const timeLabel = event.allDay
    ? '종일'
    : ongoing
      ? '진행중'
      : `${kstTimeStr(event.start) || '--:--'} ~ ${kstTimeStr(event.end) || '--:--'}`;
  const rows = [
    `<div class="detail-row"><span class="detail-label">일시</span><span class="detail-value">${escapeHtml(dateLabel)} ${escapeHtml(timeLabel)}</span></div>`
  ];
  if (event.location) {
    rows.push(`<div class="detail-row"><span class="detail-label">장소</span><span class="detail-value">${escapeHtml(event.location)}</span></div>`);
  }
  if (event.description) {
    rows.push(`<div class="detail-row"><span class="detail-label">메모</span><span class="detail-value detail-desc">${escapeHtml(event.description)}</span></div>`);
  }
  return `<div class="event-detail">${rows.join('')}</div>`;
}

function renderEventRow(event, todayStr, now) {
  if (event.id === editingEventId) return renderEventEditForm(event, todayStr);
  const ongoing = isOngoingEvent(event, todayStr);
  const startMs = event.start ? new Date(event.start).getTime() : NaN;
  const isPast = !event.allDay && !ongoing && Number.isFinite(startMs) && startMs + NOW_WINDOW_MS < now && startMs < now;
  const isNow = !event.allDay && !ongoing && Number.isFinite(startMs) && Math.abs(startMs - now) <= NOW_WINDOW_MS;
  const classes = ['event-row'];
  if (isNow) classes.push('is-now');
  else if (isPast) classes.push('is-past');
  const time = event.allDay ? '종일' : ongoing ? '진행중' : (kstTimeStr(event.start) || '--:--');
  const isDetailOpen = event.id === detailEventId;
  return `<div class="event-item" data-id="${escapeHtml(event.id)}">` +
    `<div class="${classes.join(' ')}">` +
    `<span class="event-time">${escapeHtml(time)}</span>` +
    `<span class="event-title">${escapeHtml(event.summary || '(제목 없음)')}</span>` +
    `${renderEventRowActions(event)}` +
    `</div>` +
    (isDetailOpen ? renderEventDetail(event) : '') +
    `</div>`;
}

function renderEvents(snapshot) {
  const el = document.getElementById('events-body');
  const events = (snapshot && snapshot.events) || [];

  if (events.length === 0) {
    el.innerHTML = emptyLine('일정 없음');
    return;
  }

  const now = Date.now();
  const todayStr = snapshot && snapshot.date;
  const sorted = [...events].sort((a, b) => {
    const aTop = a.allDay || isOngoingEvent(a, todayStr);
    const bTop = b.allDay || isOngoingEvent(b, todayStr);
    if (aTop !== bTop) return aTop ? -1 : 1;
    return new Date(a.start || 0) - new Date(b.start || 0);
  });

  el.innerHTML = sorted.map((event) => renderEventRow(event, todayStr, now)).join('');
}

// ---- section 2: today checklist --------------------------------------

function renderRowActions(section) {
  if (section === 'today') {
    return `<div class="row-actions">` +
      `<button type="button" class="action-btn" data-action="toggle-doing" title="진행">${ICON_DOING}</button>` +
      `<button type="button" class="action-btn" data-action="defer-backlog" title="백로그로">${ICON_DEFER_BACKLOG}</button>` +
      `<button type="button" class="action-btn" data-action="edit" title="편집">${ICON_EDIT}</button>` +
      `</div>`;
  }
  if (section === 'backlog') {
    return `<div class="row-actions">` +
      `<button type="button" class="action-btn" data-action="move-today" title="오늘로">${ICON_MOVE_TODAY}</button>` +
      `<button type="button" class="action-btn" data-action="edit" title="편집">${ICON_EDIT}</button>` +
      `</div>`;
  }
  return '';
}

function renderEditForm(task, section) {
  const dueValue = kstDateTimeLocalStr(task.due_at);
  return `<div class="task-row is-editing" data-id="${escapeHtml(task.id)}" data-section="${section}">` +
    `<div class="edit-form">` +
    `<input type="text" class="edit-title" value="${escapeHtml(task.title)}" placeholder="제목" />` +
    `<input type="text" class="edit-detail" value="${escapeHtml(task.detail || '')}" placeholder="상세" />` +
    `<input type="text" class="edit-due" value="${escapeHtml(dueValue)}" placeholder="마감 (YYYY-MM-DD HH:mm)" />` +
    `<input type="text" class="edit-project" value="${escapeHtml(task.project_name || '')}" placeholder="프로젝트" />` +
    `<div class="edit-actions">` +
    `<button type="button" class="edit-btn edit-btn-save" data-action="save">저장</button>` +
    `<button type="button" class="edit-btn edit-btn-cancel" data-action="cancel">취소</button>` +
    `</div>` +
    `</div>` +
    `</div>`;
}

function renderTodayRow(task) {
  if (task.id === editingTaskId) return renderEditForm(task, 'today');
  const isDone = task.status === 'done';
  const isDoing = task.status === 'doing';
  // Google Tasks' native due field is date-only (always midnight UTC) —
  // rendering it as 09:00 KST is noise, so suppress date-only times.
  const dateOnlyDue = typeof task.due_at === 'string' && task.due_at.endsWith('T00:00:00.000Z');
  const dueTime = task.due_at && !dateOnlyDue ? kstTimeStr(task.due_at) : null;
  const metaParts = [];
  if (task.project_name) metaParts.push(`<span class="project-chip">${escapeHtml(task.project_name)}</span>`);
  if (dueTime) metaParts.push(`<span class="due-time">${escapeHtml(dueTime)}</span>`);
  const classes = ['task-row'];
  if (isDone) classes.push('is-done');
  if (isDoing) classes.push('is-doing');
  if (task._pending) classes.push('is-pending');
  return `<div class="${classes.join(' ')}" data-id="${escapeHtml(task.id)}" data-section="today">` +
    `<span class="task-checkbox" data-action="toggle">${isDone ? ICON_CHECKBOX_DONE : ICON_CHECKBOX_EMPTY}</span>` +
    `<span class="task-title">${escapeHtml(task.title)}</span>` +
    `<span class="task-meta">${metaParts.join('')}</span>` +
    `${renderRowActions('today')}` +
    `</div>`;
}

// 진행(doing) rows sort above plain todo rows; done stays at the bottom.
function todayRank(task) {
  if (task.status === 'done') return 2;
  if (task.status === 'doing') return 0;
  return 1;
}

function renderToday(snapshot) {
  const el = document.getElementById('today-body');
  const tasks = (snapshot && snapshot.tasks && snapshot.tasks.today) || [];

  if (tasks.length === 0) {
    el.innerHTML = emptyLine('할 일 없음');
    return;
  }

  const sorted = [...tasks].sort((a, b) => todayRank(a) - todayRank(b));

  el.innerHTML = sorted.map((task) => renderTodayRow(task)).join('');
}

// ---- backlog view -------------------------------------------------------

function renderBacklogRow(task) {
  if (task.id === editingTaskId) return renderEditForm(task, 'backlog');
  const isDone = task.status === 'done';
  const metaParts = [];
  if (task.project_name) metaParts.push(`<span class="project-chip">${escapeHtml(task.project_name)}</span>`);
  const classes = ['task-row'];
  if (isDone) classes.push('is-done');
  if (task._pending) classes.push('is-pending');
  return `<div class="${classes.join(' ')}" data-id="${escapeHtml(task.id)}" data-section="backlog">` +
    `<span class="task-checkbox" data-action="toggle">${isDone ? ICON_CHECKBOX_DONE : ICON_CHECKBOX_EMPTY}</span>` +
    `<span class="task-title">${escapeHtml(task.title)}</span>` +
    `<span class="task-meta">${metaParts.join('')}</span>` +
    `${renderRowActions('backlog')}` +
    `</div>`;
}

function renderBacklog(snapshot) {
  const el = document.getElementById('backlog-body');
  if (!el) return;
  const tasks = (snapshot && snapshot.tasks && snapshot.tasks.backlog) || [];

  if (tasks.length === 0) {
    el.innerHTML = emptyLine('백로그 없음');
    return;
  }

  const sorted = [...tasks].sort((a, b) => {
    const aDone = a.status === 'done' ? 1 : 0;
    const bDone = b.status === 'done' ? 1 : 0;
    return aDone - bDone;
  });

  el.innerHTML = sorted.map((task) => renderBacklogRow(task)).join('');
}

// ---- footer: pinned projects -------------------------------------------

function renderPinnedProjects(snapshot) {
  const section = document.getElementById('section-projects');
  const el = document.getElementById('projects-body');
  const projects = (snapshot && snapshot.pinnedProjects) || [];

  if (projects.length === 0) {
    section.hidden = true;
    return;
  }

  section.hidden = false;
  el.innerHTML = projects
    .map((project) => `<span class="project-pin-chip">${escapeHtml(project.name)}</span>`)
    .join('');
}

// ---- projects view (read-only catalog) ---------------------------------

function renderProjectsCatalog(snapshot) {
  const el = document.getElementById('projects-catalog-body');
  if (!el) return;
  const projects = (snapshot && snapshot.projects) || [];
  const pinned = (snapshot && snapshot.pinnedProjects) || [];

  if (projects.length === 0 && pinned.length === 0) {
    el.innerHTML = emptyLine('프로젝트 없음');
    return;
  }

  const pinnedIds = new Set(pinned.map((project) => String(project.supabase_id)));
  const rest = projects.filter((project) => !pinnedIds.has(String(project.supabase_id)));

  const pinnedHtml = pinned.map((project) => `<div class="project-row is-pinned">` +
    `<span class="project-pin-mark">📌</span>` +
    `<span class="project-name">${escapeHtml(project.name)}</span>` +
    `<span class="project-status">${escapeHtml(project.status || '')}</span>` +
    `</div>`);

  const restHtml = rest.map((project) => `<div class="project-row">` +
    `<span class="project-name">${escapeHtml(project.name)}</span>` +
    `<span class="project-status">${escapeHtml(project.status || '')}</span>` +
    `</div>`);

  el.innerHTML = [...pinnedHtml, ...restHtml].join('');
}

// ---- orchestration -------------------------------------------------------

function renderAll(snapshot) {
  renderHeader(snapshot);
  renderEvents(snapshot);
  renderToday(snapshot);
  renderPinnedProjects(snapshot);
  renderBacklog(snapshot);
  renderProjectsCatalog(snapshot);
}

async function refresh() {
  // Never let a periodic/focus refresh clobber an in-flight optimistic
  // mutation or an open inline-edit form — the mutation's own success/error
  // handler re-renders the affected section once it settles.
  if (isBusy()) return;
  try {
    const snapshot = await window.widget.getSnapshot();
    latestSnapshot = snapshot;
    renderAll(snapshot);
  } catch (error) {
    const el = document.getElementById('events-body');
    el.innerHTML = emptyLine(`불러오기 실패: ${errMsg(error)}`);
  }
}

function tick() {
  // Re-render current-time highlighting without refetching the snapshot.
  // Skip while an event edit form is open so typed input isn't clobbered.
  if (latestSnapshot && editingEventId === null) renderEvents(latestSnapshot);
}

// ---- quick add -------------------------------------------------------------

async function handleQuickAdd(section, title) {
  const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tempTask = {
    id: tempId,
    title,
    status: 'todo',
    due_at: null,
    project_name: null,
    section,
    _pending: true
  };
  latestSnapshot.tasks = WidgetState.addTaskOptimistic(latestSnapshot.tasks, section, tempTask);
  renderSection(section);

  pendingOps += 1;
  try {
    const created = await window.widget.invoke('widget:task-add', { section, title });
    latestSnapshot.tasks = WidgetState.replaceTask(latestSnapshot.tasks, section, tempId, created);
    renderSection(section);
  } catch (error) {
    latestSnapshot.tasks = WidgetState.removeTask(latestSnapshot.tasks, section, tempId);
    renderSection(section);
    showToast(`추가 실패: ${errMsg(error)}`, true);
  }
  pendingOps -= 1;
}

function setupQuickAdd(inputId, section) {
  const input = document.getElementById(inputId);
  if (!input) return;
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      input.value = '';
      input.blur();
      return;
    }
    if (event.key !== 'Enter') return;
    const title = input.value.trim();
    if (!title || !latestSnapshot) return;
    input.value = '';
    input.disabled = true;
    handleQuickAdd(section, title).finally(() => {
      input.disabled = false;
      input.focus();
    });
  });
}

// ---- toggle ----------------------------------------------------------------

async function handleToggle(section, id) {
  const location = WidgetState.findTaskLocation(latestSnapshot.tasks, id);
  if (!location || location.task._pending) return;
  const previousStatus = location.task.status;
  const nextStatus = previousStatus === 'done' ? 'todo' : 'done';

  latestSnapshot.tasks = WidgetState.setTaskStatusLocal(latestSnapshot.tasks, section, id, nextStatus);
  renderSection(section);

  pendingOps += 1;
  try {
    await window.widget.invoke('widget:task-toggle', { id, status: nextStatus });
  } catch (error) {
    latestSnapshot.tasks = WidgetState.setTaskStatusLocal(latestSnapshot.tasks, section, id, previousStatus);
    renderSection(section);
    showToast(`완료 처리 실패: ${errMsg(error)}`, true);
  }
  pendingOps -= 1;
}

// ---- defer -----------------------------------------------------------------

async function handleDefer(section, id, kind) {
  const location = WidgetState.findTaskLocation(latestSnapshot.tasks, id);
  if (!location || location.task._pending) return;
  const { index, task } = location;

  latestSnapshot.tasks = WidgetState.removeTask(latestSnapshot.tasks, section, id);
  renderSection(section);

  pendingOps += 1;
  let succeeded = false;
  try {
    let payload;
    if (section === 'today' && kind === 'backlog') {
      payload = { id, section: 'backlog' };
    } else if (section === 'backlog' && kind === 'today') {
      payload = { id, section: 'today' };
    } else {
      throw new Error(`unsupported defer: ${section}/${kind}`);
    }
    await window.widget.invoke('widget:task-defer', payload);
    succeeded = true;
  } catch (error) {
    latestSnapshot.tasks = WidgetState.insertTaskAt(latestSnapshot.tasks, section, index, task);
    renderSection(section);
    showToast(`미루기 실패: ${errMsg(error)}`, true);
  }
  pendingOps -= 1;

  if (succeeded && !isBusy()) refresh();
}

// ---- doing toggle ------------------------------------------------------------

// 진행(doing) status lives in the Askewly metadata block only — the Google
// side status stays needsAction (setTaskStatus/taskBody already accept any
// status string; googleStatus() only maps 'done'/'archived' to completed).
// Reuses the existing generic widget:task-toggle channel (it already accepts
// an arbitrary flags.status) instead of adding a new IPC op.
async function handleToggleDoing(section, id) {
  const location = WidgetState.findTaskLocation(latestSnapshot.tasks, id);
  if (!location || location.task._pending) return;
  const previousStatus = location.task.status;
  const nextStatus = previousStatus === 'doing' ? 'todo' : 'doing';

  latestSnapshot.tasks = WidgetState.setTaskStatusLocal(latestSnapshot.tasks, section, id, nextStatus);
  renderSection(section);

  pendingOps += 1;
  try {
    await window.widget.invoke('widget:task-toggle', { id, status: nextStatus });
  } catch (error) {
    latestSnapshot.tasks = WidgetState.setTaskStatusLocal(latestSnapshot.tasks, section, id, previousStatus);
    renderSection(section);
    showToast(`진행 상태 변경 실패: ${errMsg(error)}`, true);
  }
  pendingOps -= 1;
}

// ---- inline edit -------------------------------------------------------------

function openEdit(section, id) {
  editingTaskId = id;
  renderSection(section);
  const row = document.querySelector(`#${sectionBodyId(section)} [data-id="${CSS.escape(id)}"]`);
  const titleInput = row && row.querySelector('.edit-title');
  if (titleInput) titleInput.focus();
}

function closeEdit(section) {
  editingTaskId = null;
  renderSection(section);
}

async function handleSave(section, id) {
  const row = document.querySelector(`#${sectionBodyId(section)} [data-id="${CSS.escape(id)}"]`);
  if (!row) return;
  const titleInput = row.querySelector('.edit-title');
  const detailInput = row.querySelector('.edit-detail');
  const dueInput = row.querySelector('.edit-due');
  const projectInput = row.querySelector('.edit-project');

  const title = titleInput.value.trim();
  if (!title) {
    showToast('제목은 비울 수 없습니다', true);
    return;
  }
  const detail = detailInput.value.trim();
  const dueRaw = dueInput.value.trim();
  const projectRaw = projectInput.value.trim();

  const location = WidgetState.findTaskLocation(latestSnapshot.tasks, id);
  if (!location) return;
  const previousTask = location.task;

  const payload = { id, title, detail };
  if (dueRaw) payload.due = dueRaw;
  else if (previousTask.due_at) payload['clear-due'] = true;
  if (projectRaw) payload.project = projectRaw;
  else if (previousTask.project_name) payload['no-project'] = true;

  editingTaskId = null;
  latestSnapshot.tasks = WidgetState.updateTaskLocal(latestSnapshot.tasks, section, id, {
    title,
    detail,
    due_at: dueRaw ? parseDueInputClient(dueRaw) : null,
    project_name: projectRaw || null
  });
  renderSection(section);

  pendingOps += 1;
  try {
    const updated = await window.widget.invoke('widget:task-update', payload);
    latestSnapshot.tasks = WidgetState.updateTaskLocal(latestSnapshot.tasks, section, id, updated);
    renderSection(section);
  } catch (error) {
    latestSnapshot.tasks = WidgetState.updateTaskLocal(latestSnapshot.tasks, section, id, previousTask);
    renderSection(section);
    showToast(`수정 실패: ${errMsg(error)}`, true);
  }
  pendingOps -= 1;
}

// ---- calendar event edit / delete --------------------------------------

function openEventEdit(id) {
  editingEventId = id;
  renderEvents(latestSnapshot);
  const row = document.querySelector(`#events-body [data-id="${CSS.escape(id)}"]`);
  const titleInput = row && row.querySelector('.edit-title');
  if (titleInput) titleInput.focus();
}

function closeEventEdit() {
  editingEventId = null;
  renderEvents(latestSnapshot);
}

function replaceEvent(id, nextEvent) {
  const events = latestSnapshot.events || [];
  const index = events.findIndex((event) => event.id === id);
  if (index < 0) return;
  latestSnapshot.events = [...events.slice(0, index), nextEvent, ...events.slice(index + 1)];
}

async function handleEventSave(id) {
  const row = document.querySelector(`#events-body [data-id="${CSS.escape(id)}"]`);
  if (!row) return;
  const titleInput = row.querySelector('.edit-title');
  const startInput = row.querySelector('.edit-start');
  const endInput = row.querySelector('.edit-end');
  const locationInput = row.querySelector('.edit-location');
  const descriptionInput = row.querySelector('.edit-description');

  const title = titleInput.value.trim();
  if (!title) {
    showToast('제목은 비울 수 없습니다', true);
    return;
  }

  const events = latestSnapshot.events || [];
  const index = events.findIndex((event) => event.id === id);
  if (index < 0) return;
  const previousEvent = events[index];

  const location = locationInput ? locationInput.value.trim() : '';
  const description = descriptionInput ? descriptionInput.value.trim() : '';
  const payload = { id, summary: title, location, description };
  let nextStart = previousEvent.start;
  let nextEnd = previousEvent.end;
  if (startInput && endInput) {
    const startRaw = startInput.value.trim();
    const endRaw = endInput.value.trim();
    if (startRaw || endRaw) {
      if (!/^\d{2}:\d{2}$/.test(startRaw) || !/^\d{2}:\d{2}$/.test(endRaw)) {
        showToast('시간은 HH:mm 형식으로 입력하세요', true);
        return;
      }
      const todayStr = latestSnapshot.date;
      nextStart = `${todayStr}T${startRaw}:00+09:00`;
      nextEnd = `${todayStr}T${endRaw}:00+09:00`;
      payload.startIso = nextStart;
      payload.endIso = nextEnd;
    }
  }

  editingEventId = null;
  replaceEvent(id, { ...previousEvent, summary: title, start: nextStart, end: nextEnd, location: location || null, description: description || null });
  renderEvents(latestSnapshot);

  pendingOps += 1;
  try {
    const updated = await window.widget.invoke('widget:event-update', payload);
    replaceEvent(id, updated);
    renderEvents(latestSnapshot);
  } catch (error) {
    replaceEvent(id, previousEvent);
    renderEvents(latestSnapshot);
    showToast(`일정 수정 실패: ${errMsg(error)}`, true);
  }
  pendingOps -= 1;
}

function setDeleteConfirm(id) {
  deleteConfirmEventId = id;
  renderEvents(latestSnapshot);
  clearTimeout(deleteConfirmTimer);
  if (id !== null) {
    deleteConfirmTimer = setTimeout(() => {
      deleteConfirmEventId = null;
      renderEvents(latestSnapshot);
    }, 3000);
  }
}

async function handleEventDeleteConfirm(id) {
  clearTimeout(deleteConfirmTimer);
  deleteConfirmEventId = null;
  const events = latestSnapshot.events || [];
  const index = events.findIndex((event) => event.id === id);
  if (index < 0) return;
  const removedEvent = events[index];

  latestSnapshot.events = events.filter((event) => event.id !== id);
  renderEvents(latestSnapshot);

  pendingOps += 1;
  try {
    await window.widget.invoke('widget:event-delete', { id });
  } catch (error) {
    const list = latestSnapshot.events || [];
    latestSnapshot.events = [...list.slice(0, index), removedEvent, ...list.slice(index)];
    renderEvents(latestSnapshot);
    showToast(`일정 삭제 실패: ${errMsg(error)}`, true);
  }
  pendingOps -= 1;
}

function toggleEventDetail(id) {
  detailEventId = detailEventId === id ? null : id;
  renderEvents(latestSnapshot);
}

function attachEventHandlers(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;

  el.addEventListener('click', (event) => {
    const row = event.target.closest('[data-id]');
    if (!row) return;
    const id = row.dataset.id;
    const actionEl = event.target.closest('[data-action]');
    if (actionEl) {
      event.stopPropagation();
      const action = actionEl.dataset.action;
      if (action === 'edit-event') openEventEdit(id);
      else if (action === 'delete-event') setDeleteConfirm(id);
      else if (action === 'delete-event-confirm') handleEventDeleteConfirm(id);
      else if (action === 'save-event') handleEventSave(id);
      else if (action === 'cancel-event') closeEventEdit();
      return;
    }
    if (id === editingEventId) return; // editing form open — don't toggle detail
    toggleEventDetail(id);
  });

  el.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (event.target.closest('.is-editing')) closeEventEdit();
  });
}

// ---- event delegation -------------------------------------------------------

function attachSectionHandlers(containerId, section) {
  const el = document.getElementById(containerId);
  if (!el) return;

  el.addEventListener('click', (event) => {
    const row = event.target.closest('[data-id]');
    if (!row) return;
    const id = row.dataset.id;
    const actionEl = event.target.closest('[data-action]');

    if (actionEl) {
      event.stopPropagation();
      const action = actionEl.dataset.action;
      if (action === 'toggle') handleToggle(section, id);
      else if (action === 'toggle-doing') handleToggleDoing(section, id);
      else if (action === 'defer-backlog') handleDefer(section, id, 'backlog');
      else if (action === 'move-today') handleDefer(section, id, 'today');
      else if (action === 'edit') openEdit(section, id);
      else if (action === 'save') handleSave(section, id);
      else if (action === 'cancel') closeEdit(section);
      return;
    }

    if (row.classList.contains('is-editing')) return;
    handleToggle(section, id);
  });

  el.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (event.target.closest('.is-editing')) closeEdit(section);
  });
}

// ---- calendar tab (달력, round 3): month grid, read-only ------------------
// Independent of the snapshot — fetched on demand per visible month via
// widget:events-range (worker/data-service.js caches per month key for 5
// min server-side; this view just holds whatever month it last fetched).

function kstNowParts() {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return { year: kst.getUTCFullYear(), month: kst.getUTCMonth(), day: kst.getUTCDate() };
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function monthBoundsIso(year, month) {
  const first = `${year}-${pad2(month + 1)}-01`;
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const last = `${year}-${pad2(month + 1)}-${pad2(daysInMonth)}`;
  return {
    timeMinIso: `${first}T00:00:00+09:00`,
    timeMaxIso: `${last}T23:59:59+09:00`,
    daysInMonth
  };
}

function eventsForDate(dateStr) {
  return calMonthEvents
    .filter((event) => {
      if (event.allDay) {
        // Google all-day events: start is inclusive, end is exclusive
        // (the day after the last all-day day).
        return event.start <= dateStr && (!event.end || event.end > dateStr);
      }
      return kstDateStr(event.start) === dateStr;
    })
    .sort((a, b) => {
      const aAllDay = a.allDay ? 0 : 1;
      const bAllDay = b.allDay ? 0 : 1;
      if (aAllDay !== bAllDay) return aAllDay - bAllDay;
      return new Date(a.start || 0) - new Date(b.start || 0);
    });
}

async function loadCalendarMonth() {
  calLoading = true;
  renderCalendar();
  const { timeMinIso, timeMaxIso } = monthBoundsIso(calYear, calMonth);
  try {
    const result = await window.widget.invoke('widget:events-range', { timeMinIso, timeMaxIso });
    calMonthEvents = (result && result.events) || [];
  } catch (error) {
    calMonthEvents = [];
    showToast(`달력 불러오기 실패: ${errMsg(error)}`, true);
  }
  calLoading = false;
  renderCalendar();
}

function setCalendarMonth(year, month) {
  const normalized = new Date(Date.UTC(year, month, 1));
  calYear = normalized.getUTCFullYear();
  calMonth = normalized.getUTCMonth();
  calSelectedDate = null;
  calDetailEventId = null;
  loadCalendarMonth();
}

function goToCalendarToday() {
  const { year, month, day } = kstNowParts();
  setCalendarMonth(year, month);
  calSelectedDate = `${year}-${pad2(month + 1)}-${pad2(day)}`;
}

function renderCalendarGrid() {
  const { daysInMonth } = monthBoundsIso(calYear, calMonth);
  const firstWeekday = new Date(Date.UTC(calYear, calMonth, 1)).getUTCDay();
  const { year: todayYear, month: todayMonth, day: todayDay } = kstNowParts();
  const todayStr = `${todayYear}-${pad2(todayMonth + 1)}-${pad2(todayDay)}`;

  const cells = [];
  for (let i = 0; i < firstWeekday; i++) cells.push('<div class="cal-cell is-empty"></div>');
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${calYear}-${pad2(calMonth + 1)}-${pad2(day)}`;
    const dayEvents = eventsForDate(dateStr);
    const shown = dayEvents.slice(0, 3);
    const overflow = dayEvents.length - shown.length;
    const chips = shown.map((event) => `<div class="cal-event-chip">${escapeHtml(event.summary || '')}</div>`).join('');
    const overflowHtml = overflow > 0 ? `<div class="cal-event-overflow">+${overflow}</div>` : '';
    const classes = ['cal-cell'];
    if (dateStr === todayStr) classes.push('is-today');
    if (dateStr === calSelectedDate) classes.push('is-selected');
    cells.push(
      `<div class="${classes.join(' ')}" data-date="${dateStr}">` +
      `<span class="cal-day-num">${day}</span>` +
      `<div class="cal-day-events">${chips}${overflowHtml}</div>` +
      `</div>`
    );
  }
  return cells.join('');
}

function renderCalendarDayDetail(dateStr) {
  const dayEvents = eventsForDate(dateStr);
  const header = `<div class="cal-day-detail-header">${escapeHtml(dateStr)}</div>`;
  if (dayEvents.length === 0) return header + emptyLine('일정 없음');

  const rows = dayEvents.map((event) => {
    const time = event.allDay ? '종일' : (kstTimeStr(event.start) || '--:--');
    const isOpen = event.id === calDetailEventId;
    return `<div class="cal-day-event" data-id="${escapeHtml(event.id)}">` +
      `<div class="cal-day-event-row">` +
      `<span class="event-time">${escapeHtml(time)}</span>` +
      `<span class="event-title">${escapeHtml(event.summary || '(제목 없음)')}</span>` +
      `</div>` +
      (isOpen ? renderEventDetail(event) : '') +
      `</div>`;
  }).join('');
  return header + rows;
}

function renderCalendar() {
  const labelEl = document.getElementById('cal-month-label');
  const gridEl = document.getElementById('cal-grid');
  const detailEl = document.getElementById('cal-day-detail');
  if (!labelEl || !gridEl || !detailEl) return;
  labelEl.textContent = calYear !== null ? `${calYear}.${pad2(calMonth + 1)}` : '--';
  gridEl.innerHTML = calLoading ? emptyLine('불러오는 중…') : renderCalendarGrid();
  detailEl.innerHTML = calSelectedDate ? renderCalendarDayDetail(calSelectedDate) : '';
}

function setupCalendar() {
  const grid = document.getElementById('cal-grid');
  const prevBtn = document.getElementById('cal-prev');
  const nextBtn = document.getElementById('cal-next');
  const todayBtn = document.getElementById('cal-today-btn');
  const dayDetail = document.getElementById('cal-day-detail');

  if (grid) {
    grid.addEventListener('click', (event) => {
      const cell = event.target.closest('[data-date]');
      if (!cell) return;
      const dateStr = cell.dataset.date;
      calSelectedDate = calSelectedDate === dateStr ? null : dateStr;
      calDetailEventId = null;
      renderCalendar();
    });
  }
  if (prevBtn) prevBtn.addEventListener('click', () => setCalendarMonth(calYear, calMonth - 1));
  if (nextBtn) nextBtn.addEventListener('click', () => setCalendarMonth(calYear, calMonth + 1));
  if (todayBtn) todayBtn.addEventListener('click', () => goToCalendarToday());
  if (dayDetail) {
    dayDetail.addEventListener('click', (event) => {
      const row = event.target.closest('[data-id]');
      if (!row) return;
      const id = row.dataset.id;
      calDetailEventId = calDetailEventId === id ? null : id;
      renderCalendar();
    });
  }
}

// ---- nav rail: view switching ------------------------------------------

const VIEWS = ['today', 'calendar', 'backlog', 'projects'];
const VIEW_STORAGE_KEY = 'widget.view';

function setView(view) {
  if (!VIEWS.includes(view)) view = 'today';
  document.querySelectorAll('.view').forEach((el) => {
    el.hidden = el.id !== `view-${view}`;
  });
  document.querySelectorAll('.rail-btn').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.view === view);
  });
  try {
    localStorage.setItem(VIEW_STORAGE_KEY, view);
  } catch {
    // localStorage can throw under restrictive storage policies — view
    // switching still works for the session, it just won't persist.
  }
  if (view === 'calendar' && calYear === null) {
    const { year, month } = kstNowParts();
    setCalendarMonth(year, month);
  }
}

function setupRail() {
  document.querySelectorAll('.rail-btn').forEach((btn) => {
    btn.addEventListener('click', () => setView(btn.dataset.view));
  });
  const forced = window.widget && window.widget.initialView;
  let initial = forced;
  if (!initial) {
    try {
      initial = localStorage.getItem(VIEW_STORAGE_KEY);
    } catch {
      initial = null;
    }
  }
  setView(initial || 'today');
}

// ---- settings popover: font scale + always-on-top -----------------------

const SCALE_STORAGE_KEY = 'widget.uiScale';
const ALWAYS_ON_TOP_STORAGE_KEY = 'widget.alwaysOnTop';

function applyUiScale(scale) {
  document.body.style.zoom = scale;
  document.querySelectorAll('.scale-btn').forEach((btn) => {
    btn.classList.toggle('is-active', Number(btn.dataset.scale) === scale);
  });
}

function setUiScale(scale) {
  applyUiScale(scale);
  try {
    localStorage.setItem(SCALE_STORAGE_KEY, String(scale));
  } catch {
    // best-effort persistence only.
  }
}

function openSettingsPopover() {
  const popover = document.getElementById('settings-popover');
  if (popover) popover.hidden = false;
}

function closeSettingsPopover() {
  const popover = document.getElementById('settings-popover');
  if (popover) popover.hidden = true;
}

function setupSettings() {
  const gearBtn = document.getElementById('btn-settings');
  const quitBtn = document.getElementById('btn-quit');
  const popover = document.getElementById('settings-popover');
  const alwaysOnTopToggle = document.getElementById('always-on-top-toggle');

  let storedScale = 1;
  try {
    storedScale = Number(localStorage.getItem(SCALE_STORAGE_KEY)) || 1;
  } catch {
    storedScale = 1;
  }
  applyUiScale(storedScale);

  let storedAlwaysOnTop = true;
  try {
    const raw = localStorage.getItem(ALWAYS_ON_TOP_STORAGE_KEY);
    storedAlwaysOnTop = raw === null ? true : raw === 'true';
  } catch {
    storedAlwaysOnTop = true;
  }
  if (alwaysOnTopToggle) alwaysOnTopToggle.checked = storedAlwaysOnTop;
  window.widget.invoke('widget:set-always-on-top', storedAlwaysOnTop).catch(() => {});

  if (gearBtn && popover) {
    gearBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      if (popover.hidden) openSettingsPopover();
      else closeSettingsPopover();
    });
    popover.addEventListener('click', (event) => event.stopPropagation());
    document.addEventListener('click', () => {
      if (!popover.hidden) closeSettingsPopover();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !popover.hidden) closeSettingsPopover();
    });
  }

  document.querySelectorAll('.scale-btn').forEach((btn) => {
    btn.addEventListener('click', () => setUiScale(Number(btn.dataset.scale)));
  });

  if (alwaysOnTopToggle) {
    alwaysOnTopToggle.addEventListener('change', () => {
      const value = alwaysOnTopToggle.checked;
      try {
        localStorage.setItem(ALWAYS_ON_TOP_STORAGE_KEY, String(value));
      } catch {
        // best-effort persistence only.
      }
      window.widget.invoke('widget:set-always-on-top', value).catch((error) => {
        showToast(`항상 위 설정 실패: ${errMsg(error)}`, true);
      });
    });
  }

  if (quitBtn) {
    quitBtn.addEventListener('click', () => {
      window.widget.invoke('widget:quit').catch(() => {});
    });
  }
}

setupQuickAdd('quick-add-input', 'today');
setupQuickAdd('quick-add-backlog-input', 'backlog');
attachSectionHandlers('today-body', 'today');
attachSectionHandlers('backlog-body', 'backlog');
attachEventHandlers('events-body');
setupCalendar();
setupRail();
setupSettings();

refresh();
setInterval(refresh, REFRESH_INTERVAL_MS);
setInterval(tick, CLOCK_TICK_MS);
window.addEventListener('focus', refresh);
