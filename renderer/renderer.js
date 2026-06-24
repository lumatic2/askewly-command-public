const ids = (id) => document.getElementById(id);

const closeButton = ids('closeButton');
const settingsButton = ids('settingsButton');
const settingsPanel = ids('settingsPanel');
const settingsBackdrop = ids('settingsBackdrop');
const settingsCloseButton = ids('settingsCloseButton');
const settingsResetButton = ids('settingsResetButton');
const settingTheme = ids('settingTheme');
const settingFontFamily = ids('settingFontFamily');
const settingFontSize = ids('settingFontSize');
const settingFontSizeValue = ids('settingFontSizeValue');
const cloudAuthStatus = ids('cloudAuthStatus');
const cloudGoogleSignIn = ids('cloudGoogleSignIn');
const cloudKakaoSignIn = ids('cloudKakaoSignIn');
const cloudSignOut = ids('cloudSignOut');
const scheduleViewToggle = ids('scheduleViewToggle');
const scheduleBody = ids('scheduleBody');
const archiveSection = ids('archiveSection');
const todayItems = ids('todayItems');
const deadlineItems = ids('deadlineItems');
const backlogItems = ids('backlogItems');
const archiveItems = ids('archiveItems');
const scheduleBoard = ids('scheduleBoard');
const briefFocus = ids('briefFocus');
const brandMark = ids('brandMark');
const syncErrorHint = ids('syncErrorHint');
const refreshButton = ids('refreshButton');
const syncPushButton = ids('syncPushButton');
const syncPullButton = ids('syncPullButton');
const todayCount = ids('todayCount');
const deadlineCount = ids('deadlineCount');
const backlogCount = ids('backlogCount');
const commandOverview = ids('commandOverview');
const SECTION_HEIGHT_KEY = 'askewly-command-section-heights-v1';
const SECTION_COLLAPSE_KEY = 'askewly-command-collapsed-sections-v1';
const MIN_WIDTH = 460;
const MIN_HEIGHT = 600;
let optimisticAddCounter = 0;
let scheduleView = 'active';
let lastConfirmedAt = 0;
let currentThemePreference = 'dark';
let currentAppearance = {
  theme: 'dark',
  fontFamily: 'Segoe UI',
  fontSize: 13
};
let availableFonts = [];
const DEFAULT_SECTION_BY_TARGET = {
  today: '오늘',
  deadline: '마감',
  recurring: '매주',
  backlog: '백로그'
};
const BOARD_COLUMNS = [
  { status: 'todo', label: '시작되지 않음', hint: 'Next queue' },
  { status: 'doing', label: '진행 중', hint: 'Active work' },
  { status: 'done', label: '완료됨', hint: 'Ready to archive' },
  { status: 'held', label: '보류 중', hint: 'Waiting' },
  { status: 'delayed', label: '지연됨', hint: 'Needs recovery' }
];
const BOARD_STATUS_SET = new Set(BOARD_COLUMNS.map((column) => column.status));
const CLOUD_TO_LEGACY_STATUS = {
  todo: 'pending',
  doing: 'in_progress',
  done: 'completed',
  held: 'pending',
  delayed: 'pending',
  archived: 'cancelled'
};
const LEGACY_TO_CLOUD_STATUS = {
  pending: 'todo',
  in_progress: 'doing',
  completed: 'done',
  cancelled: 'archived'
};
const SOURCE_LABELS = {
  today: 'Today',
  deadline: 'Deadline',
  recurring: 'Recurring',
  backlog: 'Backlog'
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatReset(totalSeconds) {
  if (typeof totalSeconds !== 'number' || !Number.isFinite(totalSeconds)) return '--';
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function splitTaskText(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return { title: '', detail: '' };

  const separators = [' | ', ' — ', ' - ', ' :: ', ': '];
  for (const separator of separators) {
    const idx = text.indexOf(separator);
    if (idx <= 0) continue;
    const head = text.slice(0, idx).trim();
    const tail = text.slice(idx + separator.length).trim();
    if (!head || !tail) continue;
    if (head.length > 40) continue;
    return { title: head, detail: tail };
  }

  return { title: text, detail: '' };
}

function renderTaskText(rawText, projectName = '', projectMilestoneName = '') {
  const { title, detail } = splitTaskText(rawText);
  const safeTitle = escapeHtml(title);
  const chips = [];
  if (projectName) chips.push(`<span class="list-item__graph-chip" data-kind="project">${escapeHtml(projectName)}</span>`);
  if (projectMilestoneName) chips.push(`<span class="list-item__graph-chip" data-kind="milestone">${escapeHtml(projectMilestoneName)}</span>`);
  const projectMeta = chips.length ? `<span class="list-item__graph">${chips.join('')}</span>` : '';
  if (!detail) {
    return `<span class="list-item__title">${safeTitle}</span>${projectMeta}`;
  }
  return `<span class="list-item__title">${safeTitle}</span><span class="list-item__detail">${escapeHtml(detail)}</span>${projectMeta}`;
}

function cloudStatusOf(item) {
  const cloudStatus = String(item?.cloudStatus || '').trim();
  if (BOARD_STATUS_SET.has(cloudStatus) || cloudStatus === 'archived') return cloudStatus;
  const legacyStatus = String(item?.status || '').trim();
  return LEGACY_TO_CLOUD_STATUS[legacyStatus] || 'todo';
}

function legacyStatusForCloudStatus(status) {
  return CLOUD_TO_LEGACY_STATUS[status] || status || 'pending';
}

function boardStatusLabel(status) {
  const column = BOARD_COLUMNS.find((candidate) => candidate.status === status);
  return column?.label || status || '상태 없음';
}

function sourceLabel(sourceKey) {
  return SOURCE_LABELS[sourceKey] || sourceKey || 'Task';
}

function formatBoardDate(value) {
  if (!value) return '';
  const text = String(value).trim();
  if (!text) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  return text;
}

function boardDueLabel(item) {
  if (item?.dueAt) return formatBoardDate(item.dueAt);
  if (item?.due_at) return formatBoardDate(item.due_at);
  if (item?.scheduledFor) return formatBoardDate(item.scheduledFor);
  if (item?.scheduled_for) return formatBoardDate(item.scheduled_for);
  const raw = String(item?.rawText || item?.text || '');
  const date = raw.match(/`([^`]+)`/) || raw.match(/\b(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})\b/);
  return date ? date[1] : '';
}

function boardTaskProgress(item, status) {
  if (typeof item?.progress === 'number' && Number.isFinite(item.progress)) {
    return Math.max(0, Math.min(100, Math.round(item.progress)));
  }
  if (status === 'done') return 100;
  if (status === 'doing') return 35;
  return 0;
}

function boardPriorityLabel(item, rank) {
  if (item?.priority && item.priority !== '-') return String(item.priority);
  if (item?.sourceKey === 'deadline') return '높음';
  if (rank <= 3) return '중간';
  return '낮음';
}

function boardTaskProperties(item, status, rank) {
  const props = [
    ['카테고리', sourceLabel(item?.sourceKey)],
    ['상태', boardStatusLabel(status)],
    ['우선순위', boardPriorityLabel(item, rank)],
    ['진행 상황', `${boardTaskProgress(item, status)}%`]
  ];
  const due = boardDueLabel(item);
  if (due) props.splice(2, 0, ['날짜', due]);
  const graph = [item?.projectName, item?.projectMilestoneName].filter(Boolean).join(' · ');
  props.push(['연결', graph || '비어 있음']);
  return props;
}

function renderBoardProperty(label, value) {
  return `
    <div class="board-card__property">
      <span class="board-card__property-label">${escapeHtml(label)}</span>
      <span class="board-card__property-value">${escapeHtml(value || '비어 있음')}</span>
    </div>
  `;
}

function renderBoardActions(status) {
  const actions = [];
  if (status !== 'doing') actions.push(['doing', '시작']);
  if (status !== 'done') actions.push(['done', '완료']);
  if (status !== 'held') actions.push(['held', '보류']);
  if (status !== 'delayed') actions.push(['delayed', '지연']);
  return actions.map(([nextStatus, label]) => (
    `<button class="board-card__status-action no-drag" data-board-status-action="${escapeHtml(nextStatus)}" type="button">${escapeHtml(label)}</button>`
  )).join('');
}

function renderBoardCard(item, status, rank) {
  const label = typeof item === 'string' ? item : item.text;
  const rawText = typeof item === 'string' ? item : (item.rawText || item.text || '');
  const isActionable = item && typeof item === 'object' && item.lineIndex !== null && item.sourceKey;
  if (!isActionable) {
    return `
      <article class="board-card" data-board-status="${escapeHtml(status)}">
        <div class="board-card__title">${renderTaskText(label)}</div>
      </article>
    `;
  }

  const canEditGraph = window.__workspacePulseState?.today?.source === 'cloud';
  const graphButton = canEditGraph
    ? `<button class="item-action item-action--graph no-drag" data-action="graph" type="button" title="Edit graph">Graph</button>`
    : '';
  const properties = boardTaskProperties(item, status, rank).map(([propLabel, value]) => renderBoardProperty(propLabel, value)).join('');
  return `
    <article class="board-card list-item--interactive is-draggable no-drag" draggable="true"
      data-id="${escapeHtml(item.id)}"
      data-source="${escapeHtml(item.sourceKey)}"
      data-line-index="${escapeHtml(item.lineIndex)}"
      data-status="${escapeHtml(legacyStatusForCloudStatus(status))}"
      data-cloud-status="${escapeHtml(status)}"
      data-project-id="${escapeHtml(item.projectId || '')}"
      data-project-milestone-id="${escapeHtml(item.projectMilestoneId || '')}"
      data-raw-text="${escapeHtml(rawText)}">
      <div class="board-card__topline">
        <span class="board-card__source">${escapeHtml(sourceLabel(item.sourceKey))}</span>
        <span class="board-card__rank">#${escapeHtml(rank)}</span>
      </div>
      <div class="board-card__title-row">
        <button class="item-action--edit no-drag" data-action="edit" type="button" title="Edit">✎</button>
        <button class="board-card__title list-item__text list-item__text--button no-drag" type="button" title="Open source">
          ${renderTaskText(label, item.projectName, item.projectMilestoneName)}
        </button>
      </div>
      <div class="board-card__properties">${properties}</div>
      <div class="board-card__footer">
        <div class="board-card__status-actions">${renderBoardActions(status)}</div>
        <div class="board-card__item-actions">
          ${graphButton}
          <button class="item-action item-action--delete no-drag" data-action="delete" type="button">Del</button>
        </div>
      </div>
    </article>
  `;
}

function buildBoardTasks(todayItemsForBoard, deadlineItemsForBoard, backlogItemsForBoard) {
  return [
    ...todayItemsForBoard,
    ...deadlineItemsForBoard,
    ...backlogItemsForBoard
  ].filter((item) => item && typeof item === 'object' && !item.__isRecurring);
}

function renderScheduleBoard(todayItemsForBoard, deadlineItemsForBoard, backlogItemsForBoard) {
  if (!scheduleBoard) return;
  const cloudMode = window.__workspacePulseState?.today?.source === 'cloud';
  if (scheduleView === 'archive' || !cloudMode) {
    scheduleBoard.hidden = true;
    scheduleBoard.innerHTML = '';
    return;
  }

  const tasks = buildBoardTasks(todayItemsForBoard, deadlineItemsForBoard, backlogItemsForBoard);
  const grouped = new Map(BOARD_COLUMNS.map((column) => [column.status, []]));
  for (const item of tasks) {
    const status = cloudStatusOf(item);
    if (grouped.has(status)) grouped.get(status).push(item);
  }

  scheduleBoard.hidden = false;
  scheduleBoard.innerHTML = `
    <div class="schedule-board__rail" role="list" aria-label="Task status board">
      ${BOARD_COLUMNS.map((column) => {
        const items = grouped.get(column.status) || [];
        return `
          <section class="schedule-board__column" data-board-column="${escapeHtml(column.status)}" role="listitem">
            <header class="schedule-board__column-head">
              <div>
                <p class="schedule-board__label">${escapeHtml(column.label)}</p>
                <span class="schedule-board__hint">${escapeHtml(column.hint)}</span>
              </div>
              <span class="schedule-board__count">${escapeHtml(items.length)}</span>
            </header>
            <div class="schedule-board__cards">
              ${items.length
                ? items.map((item, index) => renderBoardCard(item, column.status, index + 1)).join('')
                : `<p class="schedule-board__empty">비어 있음</p>`}
            </div>
          </section>
        `;
      }).join('')}
    </div>
  `;
}

function parseDeadlineDate(text) {
  const source = String(text || '');
  const now = new Date();
  const year = now.getFullYear();

  const iso = source.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (iso) {
    const due = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    if (!Number.isNaN(due.getTime())) return due;
  }

  const monthDay = source.match(/`(\d{1,2})[-/.](\d{1,2})(?:[^`]*)`/) || source.match(/(?:^|\s)(\d{1,2})[-/.](\d{1,2})(?:\s|$)/);
  if (!monthDay) return null;

  const month = Number(monthDay[1]);
  const day = Number(monthDay[2]);
  if (!month || !day) return null;

  const candidateThisYear = new Date(year, month - 1, day);
  if (Number.isNaN(candidateThisYear.getTime())) return null;
  const today = new Date(year, now.getMonth(), now.getDate());
  if (candidateThisYear < today && (today.getMonth() - (month - 1)) > 6) {
    const nextYear = new Date(year + 1, month - 1, day);
    return Number.isNaN(nextYear.getTime()) ? candidateThisYear : nextYear;
  }
  return candidateThisYear;
}

function computeDeadlineMeta(text) {
  const hasExistingDday = /\bD[-+]\s*\d+\b/i.test(String(text || ''));
  const due = parseDeadlineDate(text);
  if (!due) {
    return {
      sortValue: Number.POSITIVE_INFINITY,
      hasKnownDue: false,
      badge: '⚪',
      dLabel: hasExistingDday ? '' : 'D-?'
    };
  }

  const today = new Date();
  const baseline = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diffDays = Math.ceil((due.getTime() - baseline.getTime()) / (1000 * 60 * 60 * 24));
  let badge = '⚪';
  if (diffDays <= 3) badge = '🔴';
  else if (diffDays <= 7) badge = '🟡';

  return {
    sortValue: diffDays,
    hasKnownDue: true,
    badge,
    dLabel: diffDays >= 0 ? `D-${diffDays}` : `D+${Math.abs(diffDays)}`
  };
}

function normalizeDeadlineLabel(item) {
  const baseText = String(item?.rawText || item?.text || '');
  const cleaned = baseText
    .replace(/`[^`]+`/g, ' ')
    .replace(/\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b/g, ' ')
    .replace(/\b\d{1,2}[-/.]\d{1,2}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const meta = computeDeadlineMeta(baseText);
  const titleText = cleaned || String(item?.text || '').trim();

  if (!meta.dLabel) {
    return {
      ...item,
      text: titleText,
      rawText: baseText,
      __deadlineSortValue: meta.sortValue,
      __deadlineKnownDue: meta.hasKnownDue
    };
  }

  return {
    ...item,
    text: `${meta.badge} ${meta.dLabel} ${titleText}`.trim(),
    rawText: baseText,
    __deadlineSortValue: meta.sortValue,
    __deadlineKnownDue: meta.hasKnownDue
  };
}

function bubblePinnedStatuses(items) {
  const arr = Array.isArray(items) ? items : [];
  const head = [];
  const tail = [];
  for (const it of arr) {
    if (it && typeof it === 'object' && (it.status === 'in_progress' || it.status === 'completed')) head.push(it);
    else tail.push(it);
  }
  return head.concat(tail);
}

function prepareDeadlineItems(items) {
  const normalized = (Array.isArray(items) ? items : []).map((item) => {
    if (typeof item === 'string') {
      const wrapped = {
        id: '',
        text: item,
        rawText: item,
        status: 'pending',
        sourceKey: 'deadline',
        section: '',
        lineIndex: null
      };
      return normalizeDeadlineLabel(wrapped);
    }
    return normalizeDeadlineLabel(item);
  });

  return normalized.sort((a, b) => {
    const aSort = Number(a.__deadlineSortValue);
    const bSort = Number(b.__deadlineSortValue);
    if (Number.isFinite(aSort) && Number.isFinite(bSort) && aSort !== bSort) {
      return aSort - bSort;
    }
    if (Number.isFinite(aSort) !== Number.isFinite(bSort)) {
      return Number.isFinite(aSort) ? -1 : 1;
    }
    return String(a.rawText || a.text || '').localeCompare(String(b.rawText || b.text || ''), 'ko');
  });
}

function matchesRecurringToday(text) {
  const today = new Date().getDay(); // 0=Sun,1=Mon,2=Tue,3=Wed,4=Thu,5=Fri,6=Sat
  const str = String(text || '');
  if (/매일|daily/i.test(str)) return true;
  const cadence = str.split(/\s*[|–—]\s*/)[0];
  const dayMap = { '월': 1, '화': 2, '수': 3, '목': 4, '금': 5, '토': 6, '일': 0 };
  for (const [kor, dayNum] of Object.entries(dayMap)) {
    if (dayNum === today && cadence.includes(kor)) return true;
  }
  return false;
}

function cleanRecurringText(text) {
  const str = String(text || '');
  const parts = str.split(/\s*[|–—]\s*/);
  return parts.length > 1 ? parts.slice(1).join(' | ').trim() : str;
}

function renderListItem(item, mode = 'active') {
  const label = typeof item === 'string' ? item : item.text;
  const rawText = typeof item === 'string' ? item : (item.rawText || item.text || '');
  const isActionable = item && typeof item === 'object' && item.lineIndex !== null && item.sourceKey;
  if (!isActionable) {
    return `<div class="list-item"><div class="list-item__text">${renderTaskText(label)}</div></div>`;
  }

  const sourceBadge = mode === 'archive' ? `<span class="list-item__source">${escapeHtml(item.sourceKey)}</span>` : '';
  if (mode === 'archive') {
    return `
      <div class="list-item list-item--interactive no-drag" data-id="${escapeHtml(item.id)}" data-source="${escapeHtml(item.sourceKey)}" data-line-index="${escapeHtml(item.lineIndex)}" data-archived="true">
        ${sourceBadge}
        <div class="list-item__content">
          <div class="list-item__text">${renderTaskText(label, item.projectName, item.projectMilestoneName)}</div>
        </div>
        <div class="list-item__actions">
          <button class="item-action item-action--restore no-drag" data-action="restore" type="button">Restore</button>
          <button class="item-action item-action--delete no-drag" data-action="delete" type="button">Del</button>
        </div>
      </div>
    `;
  }

  const recurringBadge = item.__isRecurring ? `<span class="recurring-badge">↻</span>` : '';
  const editButton = item.__isRecurring ? '' : `<button class="item-action--edit no-drag" data-action="edit" type="button" title="Edit">✎</button>`;
  const canEditGraph = window.__workspacePulseState?.today?.source === 'cloud';
  const graphButton = canEditGraph
    ? `<button class="item-action item-action--graph no-drag" data-action="graph" type="button" title="프로젝트/마일스톤 연결">Link</button>`
    : '';

  return `
    <div class="list-item list-item--interactive is-draggable no-drag" draggable="true"
      data-id="${escapeHtml(item.id)}"
      data-source="${escapeHtml(item.sourceKey)}"
      data-line-index="${escapeHtml(item.lineIndex)}"
      data-status="${escapeHtml(item.status)}"
      data-project-id="${escapeHtml(item.projectId || '')}"
      data-project-milestone-id="${escapeHtml(item.projectMilestoneId || '')}"
      data-raw-text="${escapeHtml(rawText)}">
      <button class="status-checkbox no-drag" data-status="${escapeHtml(item.status)}" type="button" title="Toggle status"></button>
      <div class="list-item__content no-drag">
        ${recurringBadge}
        <div class="list-item__text-row">
          ${editButton}
          <button class="list-item__text list-item__text--button no-drag" type="button" title="${canEditGraph ? '왼쪽 연필 버튼으로 편집' : 'Open source'}">${renderTaskText(label, item.projectName, item.projectMilestoneName)}</button>
        </div>
      </div>
      <div class="list-item__actions no-drag">
        ${graphButton}
        <button class="item-action item-action--delete no-drag" data-action="delete" type="button">Del</button>
      </div>
    </div>
  `;
}

function renderList(target, items, emptyText, options = {}) {
  const mode = options.mode || 'active';
  const groupBySection = options.groupBySection === true;
  if (!Array.isArray(items) || items.length === 0) {
    target.innerHTML = `<div class="list-empty">${escapeHtml(emptyText)}</div>`;
    return;
  }
  let previousSection = '';
  target.innerHTML = items.map((item) => {
    const section = item && typeof item === 'object' ? String(item.section || '').trim() : '';
    const showSectionHeading = groupBySection && section && section !== previousSection;
    previousSection = section;
    return `${showSectionHeading ? `<div class="list-section-heading">${escapeHtml(section)}</div>` : ''}${renderListItem(item, mode)}`;
  }).join('');
}

function renderCommandOverview(overview) {
  if (!commandOverview) return;
  if (!overview || !overview.counts) {
    commandOverview.hidden = true;
    commandOverview.innerHTML = '';
    return;
  }
  const firstTask = overview.doingTasks?.[0];
  const firstProject = overview.todayProjects?.[0];
  const firstMilestone = overview.upcomingMilestones?.[0];
  const firstLink = overview.obsidianLinks?.[0];
  const firstContent = overview.contentCandidates?.[0];
  const firstUnlinked = overview.unlinkedTasks?.[0];
  commandOverview.hidden = false;
  commandOverview.innerHTML = `
    <div class="command-overview__head">
      <p class="command-overview__title">Command overview</p>
      <div class="command-overview__stats">
        <span>${escapeHtml(overview.counts.doingTasks)} doing</span>
        <span>${escapeHtml(overview.counts.linkedTasks || 0)} linked</span>
        <span>${escapeHtml(overview.counts.unlinkedTasks || 0)} unlinked</span>
        <span>${escapeHtml(overview.counts.contentCandidates || 0)} content</span>
        <span>${escapeHtml(overview.counts.projectLinks || overview.counts.obsidianLinks || 0)} links</span>
      </div>
    </div>
    <div class="command-overview__grid">
      ${renderOverviewCell('Now', firstTask?.title || 'No doing task', firstTask?.projectName || 'Mark a task as doing')}
      ${renderOverviewCell('Unlinked', firstUnlinked?.title || 'No unlinked task', firstUnlinked ? firstUnlinked.sourceKey || 'Needs manual project link' : 'Manual graph is clean')}
      ${renderOverviewCell('Content', firstContent?.title || 'No content work', firstContent?.projectName || firstContent?.sourceKey || 'Task-derived queue')}
      ${renderOverviewCell('Project', firstProject?.name || 'No today project', firstProject?.northStar || 'Link a Today task to a project')}
      ${renderOverviewCell('Milestone', firstMilestone?.title || 'No active milestone', firstMilestone?.status || 'Add one in Projects')}
      ${renderOverviewCell('Obsidian', firstLink?.title || 'No note link', firstLink?.target || 'Add an Obsidian URI')}
    </div>
    ${renderReviewLoop(overview.review)}
  `;
}

function renderOverviewCell(label, title, detail) {
  return `
    <div class="command-overview__cell">
      <span class="command-overview__label">${escapeHtml(label)}</span>
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(detail)}</span>
    </div>
  `;
}

function renderReviewLoop(review) {
  const start = Array.isArray(review?.start) ? review.start : [];
  const close = Array.isArray(review?.close) ? review.close : [];
  if (!start.length && !close.length) return '';
  return `
    <section class="review-loop">
      <header class="review-loop__head">
        <div>
          <p class="review-loop__title">Daily review</p>
          <span class="review-loop__subtitle">Morning choices and evening cleanup</span>
        </div>
        <span class="review-loop__count">${escapeHtml(start.length + close.length)} prompts</span>
      </header>
      <div class="review-loop__columns">
        ${renderReviewColumn('Morning', start)}
        ${renderReviewColumn('Evening', close)}
      </div>
    </section>
  `;
}

function renderReviewColumn(label, cards) {
  return `
    <div class="review-loop__column">
      <p class="review-loop__column-label">${escapeHtml(label)}</p>
      <div class="review-loop__cards">
        ${cards.length ? cards.map(renderReviewCard).join('') : '<p class="review-loop__empty">No review prompts</p>'}
      </div>
    </div>
  `;
}

function renderReviewCard(card) {
  return `
    <article class="review-card">
      <span class="review-card__label">${escapeHtml(card.label || '')}</span>
      <strong>${escapeHtml(card.title || '')}</strong>
      <span>${escapeHtml(card.detail || '')}</span>
      <button
        class="review-card__action no-drag"
        type="button"
        data-review-target="${escapeHtml(card.target || 'schedule')}"
        data-review-source="${escapeHtml(card.sourceKey || 'today')}">
        ${escapeHtml(card.actionLabel || 'Open')}
      </button>
    </article>
  `;
}


function _removedRenderGithubCards(target, items, blocked = false) {
  // GitHub panel removed
  if (!Array.isArray(items) || items.length === 0) {
    return;
  }

  target.innerHTML = items.map((item) => {
    const dirty = item.local?.dirtyCount || 0;
    const ahead = item.local?.ahead || 0;
    const behind = item.local?.behind || 0;
    const branch = item.local?.branch || 'remote';
    const tone = blocked ? 'repo-card--blocked' : dirty > 0 ? 'repo-card--active' : '';
    let localSummary = `branch ${branch}`;
    if (dirty > 0) {
      localSummary = `${dirty} local change${dirty > 1 ? 's' : ''}`;
    } else if (ahead > 0 || behind > 0) {
      const syncBits = [];
      if (ahead > 0) syncBits.push(`+${ahead}`);
      if (behind > 0) syncBits.push(`-${behind}`);
      localSummary = syncBits.join(' ');
    }
    const flags = [item.updatedLabel, localSummary];

    return `
      <article class="repo-card ${tone}" data-repo-name="${escapeHtml(item.name)}">
        <div class="repo-card__head">
          <div class="repo-title"><span class="repo-dot"></span><strong>${escapeHtml(item.name)}</strong></div>
        </div>
        <p class="repo-desc">${escapeHtml(item.description || 'No description')}</p>
        <div class="repo-meta">${flags.map((flag) => `<span>${escapeHtml(flag)}</span>`).join('')}</div>
      </article>
    `;
  }).join('');
}

function render(state) {
  window.__workspacePulseState = state;
  const archiveMode = scheduleView === 'archive';
  const cloudMode = state.today?.source === 'cloud';
  scheduleBody.classList.toggle('is-archive', archiveMode);
  syncPullButton.hidden = cloudMode;
  syncPushButton.hidden = cloudMode;
  archiveSection.hidden = !archiveMode;
  renderCommandOverview(state.today?.commandOverview);

  const focus = state.today?.snapshot?.focus;
  if (briefFocus) {
    if (focus) {
      briefFocus.textContent = focus;
      briefFocus.hidden = false;
    } else {
      briefFocus.hidden = true;
    }
  }

  const todayTasks = state.today?.today || [];
  const todayRecurring = (state.today?.recurring || []).filter((item) => {
    const text = typeof item === 'string' ? item : (item.rawText || item.text || '');
    return matchesRecurringToday(text);
  }).map((item) => ({
    ...item,
    text: cleanRecurringText(typeof item === 'string' ? item : (item.rawText || item.text || '')),
    __isRecurring: true
  }));
  const allTodayItems = bubblePinnedStatuses([...todayTasks, ...todayRecurring]);
  const allDeadlineItems = bubblePinnedStatuses(prepareDeadlineItems(state.today?.deadlines || []));
  const allBacklogItems = bubblePinnedStatuses(state.today?.backlog || []);
  renderScheduleBoard(allTodayItems, allDeadlineItems, allBacklogItems);
  renderList(todayItems, allTodayItems, 'No tasks for today');
  renderList(deadlineItems, allDeadlineItems, 'No deadlines', { groupBySection: true });
  renderList(backlogItems, allBacklogItems, 'No backlog items');
  renderList(archiveItems, state.today?.archived || [], 'No archived tasks', { mode: 'archive', groupBySection: true });

  if (todayCount) todayCount.textContent = allTodayItems.length || '';
  if (deadlineCount) deadlineCount.textContent = allDeadlineItems.length || '';
  if (backlogCount) backlogCount.textContent = allBacklogItems.length || '';
}

function setScheduleView(nextView) {
  scheduleView = nextView === 'archive' ? 'archive' : 'active';
  const archive = scheduleView === 'archive';
  scheduleBody.classList.toggle('is-archive', archive);
  archiveSection.hidden = !archive;
  scheduleViewToggle.textContent = archive ? 'Active' : 'Archive';
  if (archive) closeAllAddForms();
}

function cloneState(state) {
  return JSON.parse(JSON.stringify(state || {}));
}

function isScheduleState(value) {
  return Boolean(
    value
    && typeof value === 'object'
    && value.source
    && Array.isArray(value.today)
    && Array.isArray(value.deadlines)
    && Array.isArray(value.backlog)
  );
}

function isFullWidgetState(value) {
  return Boolean(value && typeof value === 'object' && value.today && !Array.isArray(value.today));
}

function mergeScheduleState(baseState, scheduleState) {
  const base = isFullWidgetState(baseState) ? baseState : {};
  return {
    ...base,
    today: scheduleState,
    generatedAt: new Date().toISOString()
  };
}

function getScheduleBucketKey(sourceKey) {
  if (sourceKey === 'today') return 'today';
  if (sourceKey === 'deadline') return 'deadlines';
  if (sourceKey === 'recurring') return 'recurring';
  if (sourceKey === 'backlog') return 'backlog';
  return '';
}

function findScheduleItemIndex(items, sourceKey, lineIndex) {
  return items.findIndex((item) => item.sourceKey === sourceKey && Number(item.lineIndex) === Number(lineIndex));
}

function renderOptimisticState(nextState) {
  nextState.generatedAt = new Date().toISOString();
  lastConfirmedAt = Date.now();
  render(nextState);
}

function rollbackScheduleMutation(previousState, pendingElement) {
  if (previousState) {
    render(previousState);
    return;
  }
  pendingElement?.classList?.remove('list-item--pending');
}

function commitScheduleMutation({ previousState = null, pendingElement = null, request, resetConfirmationGuard = false, afterRender = null }) {
  if (!previousState) pendingElement?.classList?.add('list-item--pending');
  return Promise.resolve()
    .then(request)
    .then((confirmedState) => {
      lastConfirmedAt = resetConfirmationGuard ? 0 : Date.now();
      renderMutationResult(confirmedState);
      if (typeof afterRender === 'function') afterRender(confirmedState);
    })
    .catch((error) => {
      rollbackScheduleMutation(previousState, pendingElement);
      console.error(error);
    });
}

function applyOptimisticStatusUpdate(sourceKey, lineIndex, nextStatus) {
  const bucketKey = getScheduleBucketKey(sourceKey);
  if (!bucketKey || !window.__workspacePulseState?.today) return null;

  const previous = cloneState(window.__workspacePulseState);
  const next = cloneState(window.__workspacePulseState);
  const items = Array.isArray(next.today[bucketKey]) ? next.today[bucketKey] : [];
  const targetIndex = findScheduleItemIndex(items, sourceKey, lineIndex);
  if (targetIndex === -1) return null;

  if (BOARD_STATUS_SET.has(nextStatus) || nextStatus === 'archived') {
    items[targetIndex].cloudStatus = nextStatus;
    items[targetIndex].status = legacyStatusForCloudStatus(nextStatus);
  } else {
    items[targetIndex].status = nextStatus;
    items[targetIndex].cloudStatus = LEGACY_TO_CLOUD_STATUS[nextStatus] || items[targetIndex].cloudStatus;
  }

  renderOptimisticState(next);
  return previous;
}

function applyOptimisticReorder(sourceKey, fromLineIndex, targetLineIndex, position) {
  const bucketKey = getScheduleBucketKey(sourceKey);
  if (!bucketKey || !window.__workspacePulseState?.today) return null;

  const previous = cloneState(window.__workspacePulseState);
  const next = cloneState(window.__workspacePulseState);
  const items = Array.isArray(next.today[bucketKey]) ? next.today[bucketKey] : [];
  const fromIdx = findScheduleItemIndex(items, sourceKey, fromLineIndex);
  const toIdx = findScheduleItemIndex(items, sourceKey, targetLineIndex);
  if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return null;

  const [moved] = items.splice(fromIdx, 1);
  const insertAt = position === 'above' ? (toIdx > fromIdx ? toIdx - 1 : toIdx) : (toIdx > fromIdx ? toIdx : toIdx + 1);
  items.splice(insertAt, 0, moved);

  renderOptimisticState(next);
  return previous;
}

function applyOptimisticMove(sourceKey, lineIndex, targetKey, targetLineIndex = null, position = 'above') {
  const sourceBucket = getScheduleBucketKey(sourceKey);
  const targetBucket = getScheduleBucketKey(targetKey);
  if (!sourceBucket || !targetBucket || !window.__workspacePulseState?.today) return null;

  const previous = cloneState(window.__workspacePulseState);
  const next = cloneState(window.__workspacePulseState);
  const sourceItems = Array.isArray(next.today[sourceBucket]) ? next.today[sourceBucket] : [];
  const idx = findScheduleItemIndex(sourceItems, sourceKey, lineIndex);
  if (idx === -1) return null;

  const [moved] = sourceItems.splice(idx, 1);
  moved.sourceKey = targetKey;
  const targetItems = Array.isArray(next.today[targetBucket]) ? next.today[targetBucket] : [];
  const targetIdx = targetLineIndex === null ? -1 : findScheduleItemIndex(targetItems, targetKey, targetLineIndex);
  if (targetIdx === -1) {
    targetItems.unshift(moved);
  } else {
    targetItems.splice(position === 'below' ? targetIdx + 1 : targetIdx, 0, moved);
  }
  next.today[targetBucket] = targetItems;

  renderOptimisticState(next);
  return previous;
}

function applyOptimisticAdd(target, text, section) {
  const bucketKey = getScheduleBucketKey(target);
  if (!bucketKey || !window.__workspacePulseState?.today) return null;

  const previous = cloneState(window.__workspacePulseState);
  const next = cloneState(window.__workspacePulseState);
  const items = Array.isArray(next.today[bucketKey]) ? next.today[bucketKey] : [];
  items.unshift({
    id: `optimistic:${target}:${Date.now()}:${optimisticAddCounter += 1}`,
    text,
    rawText: text,
    status: 'pending',
    priority: '-',
    sourceKey: target,
    section: String(section || DEFAULT_SECTION_BY_TARGET[target] || '').trim(),
    lineIndex: -1
  });
  next.today[bucketKey] = items;
  renderOptimisticState(next);
  return previous;
}

function applyOptimisticTextUpdate(sourceKey, lineIndex, newText) {
  const bucketKey = getScheduleBucketKey(sourceKey);
  if (!bucketKey || !window.__workspacePulseState?.today) return null;

  const previous = cloneState(window.__workspacePulseState);
  const next = cloneState(window.__workspacePulseState);
  const items = Array.isArray(next.today[bucketKey]) ? next.today[bucketKey] : [];
  const idx = findScheduleItemIndex(items, sourceKey, lineIndex);
  if (idx === -1) return null;

  items[idx] = { ...items[idx], text: newText, rawText: newText };
  next.today[bucketKey] = items;
  renderOptimisticState(next);
  return previous;
}

function applyOptimisticGraphUpdate(sourceKey, lineIndex, projectId, projectMilestoneId) {
  const bucketKey = getScheduleBucketKey(sourceKey);
  if (!bucketKey || !window.__workspacePulseState?.today) return null;

  const previous = cloneState(window.__workspacePulseState);
  const next = cloneState(window.__workspacePulseState);
  const items = Array.isArray(next.today[bucketKey]) ? next.today[bucketKey] : [];
  const idx = findScheduleItemIndex(items, sourceKey, lineIndex);
  if (idx === -1) return null;

  const projects = Array.isArray(next.today.projects) ? next.today.projects : [];
  const milestones = Array.isArray(next.today.milestones) ? next.today.milestones : [];
  const project = projectId ? projects.find((candidate) => Number(candidate.id) === Number(projectId)) : null;
  const milestone = projectMilestoneId ? milestones.find((candidate) => Number(candidate.id) === Number(projectMilestoneId)) : null;
  items[idx] = {
    ...items[idx],
    projectId: project?.id || null,
    projectMilestoneId: milestone?.id || null,
    projectName: project?.name || '',
    projectMilestoneName: milestone?.title || ''
  };
  next.today[bucketKey] = items;
  renderOptimisticState(next);
  return previous;
}

function applyOptimisticDelete(sourceKey, lineIndex, archived = false) {
  const bucketKey = archived ? 'archived' : getScheduleBucketKey(sourceKey);
  if (!bucketKey || !window.__workspacePulseState?.today) return null;

  const previous = cloneState(window.__workspacePulseState);
  const next = cloneState(window.__workspacePulseState);
  const items = Array.isArray(next.today[bucketKey]) ? next.today[bucketKey] : [];
  const idx = findScheduleItemIndex(items, sourceKey, lineIndex);
  if (idx === -1) return null;

  items.splice(idx, 1);
  next.today[bucketKey] = items;
  renderOptimisticState(next);
  return previous;
}

function resolveTheme(themePreference) {
  if (themePreference === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return themePreference === 'dark' ? 'dark' : 'light';
}

function applyTheme(themePreference) {
  currentThemePreference = themePreference;
  const resolved = resolveTheme(themePreference);
  document.documentElement.dataset.theme = resolved;
}

function applyFontSettings(fontFamily, fontSize) {
  const family = String(fontFamily || 'Segoe UI').trim() || 'Segoe UI';
  const safeSize = Math.min(18, Math.max(10, Number(fontSize) || 12));
  document.documentElement.style.setProperty('--font-family-ui', family);
  document.documentElement.style.setProperty('--font-scale', String(safeSize / 12));
  document.body.style.fontFamily = family;
}

function populateFontOptions(fonts, selected) {
  const cleaned = Array.isArray(fonts)
    ? fonts.map((value) => String(value || '').trim()).filter(Boolean)
    : [];
  const preferredOrder = ['Segoe UI', 'Noto Sans KR', 'Bahnschrift', 'Calibri', 'Georgia', 'Cascadia Mono', 'Consolas'];
  const uniqueSet = new Set(cleaned);
  const ordered = [
    ...preferredOrder.filter((name) => uniqueSet.has(name)),
    ...cleaned.filter((name) => !preferredOrder.includes(name))
  ];
  if (selected && !ordered.includes(selected)) {
    ordered.unshift(selected);
  }

  settingFontFamily.innerHTML = '';
  for (const family of ordered) {
    const option = document.createElement('option');
    option.value = family;
    option.textContent = family;
    settingFontFamily.appendChild(option);
  }
}

function syncAppearanceControls(appearance) {
  settingTheme.value = appearance.theme;
  populateFontOptions(availableFonts, appearance.fontFamily);
  settingFontFamily.value = appearance.fontFamily;
  settingFontSize.value = String(appearance.fontSize);
  settingFontSizeValue.textContent = `${appearance.fontSize}px`;
}

function toggleSettingsPanel(forceOpen = null) {
  const open = typeof forceOpen === 'boolean' ? forceOpen : settingsPanel.hidden;
  settingsPanel.hidden = !open;
  settingsBackdrop.hidden = !open;
  if (open) refreshCloudAuthStatus().catch((error) => {
    if (cloudAuthStatus) cloudAuthStatus.textContent = `Cloud error: ${error?.message || error}`;
  });
}

function renderMutationResult(state) {
  if (isScheduleState(state)) {
    render(mergeScheduleState(window.__workspacePulseState, state));
    return;
  }
  if (isFullWidgetState(state)) {
    render(state);
    return;
  }
  console.warn('Ignoring unexpected schedule mutation response shape', state);
}

function isEditingScheduleItem() {
  return Boolean(document.querySelector('.list-item--interactive[data-editing="true"]'));
}

async function refreshCloudAuthStatus() {
  if (!cloudAuthStatus) return;
  const status = await window.workspacePulse.getCloudAuthStatus();
  if (!status?.configured) {
    cloudAuthStatus.textContent = 'Cloud env missing';
  } else if (status.signedIn) {
    cloudAuthStatus.textContent = status.userEmail ? `Signed in: ${status.userEmail}` : 'Signed in';
  } else if (status.enabled) {
    cloudAuthStatus.textContent = 'Cloud on, sign-in needed';
  } else {
    cloudAuthStatus.textContent = 'Not signed in';
  }
  if (cloudSignOut) cloudSignOut.disabled = !status?.signedIn;
}

async function signInCloud(provider) {
  const buttons = [cloudGoogleSignIn, cloudKakaoSignIn, cloudSignOut].filter(Boolean);
  buttons.forEach((button) => { button.disabled = true; });
  if (cloudAuthStatus) cloudAuthStatus.textContent = `Opening ${provider} sign-in...`;
  try {
    const status = await window.workspacePulse.signInCloud({ provider });
    if (cloudAuthStatus) {
      cloudAuthStatus.textContent = status?.userEmail ? `Signed in: ${status.userEmail}` : 'Signed in';
    }
  } catch (error) {
    if (cloudAuthStatus) cloudAuthStatus.textContent = `Sign-in failed: ${error?.message || error}`;
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
    refreshCloudAuthStatus().catch(() => {});
  }
}

async function signOutCloud() {
  const buttons = [cloudGoogleSignIn, cloudKakaoSignIn, cloudSignOut].filter(Boolean);
  buttons.forEach((button) => { button.disabled = true; });
  try {
    await window.workspacePulse.signOutCloud();
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
    refreshCloudAuthStatus().catch(() => {});
  }
}

async function persistAppearance(nextAppearance) {
  currentAppearance = { ...currentAppearance, ...nextAppearance };
  const saved = await window.workspacePulse.updateSettings({
    appearance: currentAppearance
  });
  availableFonts = Array.isArray(saved?.availableFonts) ? saved.availableFonts : availableFonts;
  currentAppearance = {
    theme: saved?.appearance?.theme || 'light',
    fontFamily: saved?.appearance?.fontFamily || 'Segoe UI',
    fontSize: Number(saved?.appearance?.fontSize || 12)
  };
  applyTheme(currentAppearance.theme);
  applyFontSettings(currentAppearance.fontFamily, currentAppearance.fontSize);
  syncAppearanceControls(currentAppearance);
}

function loadSectionHeights() {
  try {
    return JSON.parse(localStorage.getItem(SECTION_HEIGHT_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveSectionHeights(state) {
  localStorage.setItem(SECTION_HEIGHT_KEY, JSON.stringify(state));
}

function loadSectionCollapsed() {
  try {
    return JSON.parse(localStorage.getItem(SECTION_COLLAPSE_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveSectionCollapsed(state) {
  localStorage.setItem(SECTION_COLLAPSE_KEY, JSON.stringify(state));
}

function setSectionCollapsed(sectionKey, collapsed) {
  const section = document.querySelector(`.schedule-section[data-section-key="${sectionKey}"]`);
  if (!section) return;
  section.classList.toggle('is-collapsed', collapsed);
  const toggle = section.querySelector(`[data-section-toggle="${sectionKey}"]`);
  if (toggle) {
    toggle.textContent = collapsed ? 'Show' : 'Hide';
    toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  }
}

function expandSection(sectionKey) {
  const current = loadSectionCollapsed();
  if (current[sectionKey]) {
    current[sectionKey] = false;
    saveSectionCollapsed(current);
  }
  setSectionCollapsed(sectionKey, false);
}

function revealScheduleItem(sourceKey, lineIndex, rawText = '') {
  const sectionKey = sourceKey === 'deadline' ? 'deadlines' : sourceKey;
  expandSection(sectionKey);
  const section = document.querySelector(`.schedule-section[data-section-key="${sectionKey}"]`);
  if (!section) return;

  const escapedSource = window.CSS?.escape ? CSS.escape(sourceKey) : sourceKey;
  let item = section.querySelector(`.list-item--interactive[data-source="${escapedSource}"][data-line-index="${Number(lineIndex)}"]`);
  if (!item && rawText) {
    item = Array.from(section.querySelectorAll('.list-item--interactive')).find((candidate) => (
      String(candidate.dataset.rawText || '').trim() === String(rawText || '').trim()
    ));
  }
  if (item) item.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function applySectionCollapsed() {
  const collapsed = loadSectionCollapsed();
  document.querySelectorAll('.schedule-section[data-section-key]').forEach((section) => {
    const key = section.dataset.sectionKey;
    setSectionCollapsed(key, Boolean(collapsed[key]));
  });
}

function applySectionHeights() {
  const heights = loadSectionHeights();
  document.querySelectorAll('.schedule-section[data-section-key]').forEach((section) => {
    const key = section.dataset.sectionKey;
    const height = Number(heights[key] || 0);
    if (height >= 118) {
      section.style.height = `${height}px`;
    } else {
      section.style.removeProperty('height');
    }
  });
}

function toggleSection(sectionKey) {
  const current = loadSectionCollapsed();
  current[sectionKey] = !current[sectionKey];
  saveSectionCollapsed(current);
  setSectionCollapsed(sectionKey, current[sectionKey]);
}

function installSectionResizeHandles() {
  const handles = document.querySelectorAll('[data-section-resize]');
  for (const handle of handles) {
    handle.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();

      const key = handle.dataset.sectionResize;
      const section = handle.closest('.schedule-section');
      if (!section || !key) return;
      const previousSection = section.previousElementSibling?.matches?.('.schedule-section[data-section-key]')
        ? section.previousElementSibling
        : null;

      const startY = event.clientY;
      const startHeight = section.getBoundingClientRect().height;
      const startPreviousHeight = previousSection?.getBoundingClientRect().height || 0;
      handle.classList.add('is-resizing');
      document.body.classList.add('is-resizing-section');
      try {
        handle.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture can fail if the window changes focus mid-drag.
      }

      const onMove = (moveEvent) => {
        moveEvent.preventDefault();
        const dy = moveEvent.clientY - startY;
        if (previousSection) {
          const minDy = 118 - startPreviousHeight;
          const maxDy = startHeight - 118;
          const appliedDy = Math.min(maxDy, Math.max(minDy, dy));
          const nextPreviousHeight = Math.round(startPreviousHeight + appliedDy);
          const nextHeight = Math.round(startHeight - appliedDy);
          previousSection.style.height = `${nextPreviousHeight}px`;
          section.style.height = `${nextHeight}px`;
        } else {
          const nextHeight = Math.max(118, Math.round(startHeight + dy));
          section.style.height = `${nextHeight}px`;
        }
      };

      const onUp = (upEvent) => {
        upEvent?.preventDefault?.();
        const nextHeight = Math.max(118, Math.round(section.getBoundingClientRect().height));
        const heights = loadSectionHeights();
        heights[key] = nextHeight;
        if (previousSection?.dataset.sectionKey) {
          heights[previousSection.dataset.sectionKey] = Math.max(118, Math.round(previousSection.getBoundingClientRect().height));
        }
        saveSectionHeights(heights);
        handle.classList.remove('is-resizing');
        document.body.classList.remove('is-resizing-section');
        document.removeEventListener('pointermove', onMove, true);
        document.removeEventListener('pointerup', onUp, true);
        document.removeEventListener('pointercancel', onUp, true);
      };

      document.addEventListener('pointermove', onMove, true);
      document.addEventListener('pointerup', onUp, true);
      document.addEventListener('pointercancel', onUp, true);
    });
  }
}

function closeAllAddForms() {
  document.querySelectorAll('.section-add-form').forEach((form) => {
    form.hidden = true;
    const input = form.querySelector('.section-add-input');
    if (input) input.value = '';
  });
  document.querySelectorAll('.section-add-btn').forEach((btn) => {
    btn.textContent = '+ Add';
  });
}

function openSectionAddForm(target) {
  closeAllAddForms();
  const form = document.querySelector(`.section-add-form[data-add-target="${target}"]`);
  const btn = document.querySelector(`.section-add-btn[data-add-for="${target}"]`);
  if (!form) return;
  form.hidden = false;
  if (btn) btn.textContent = 'Close';
  const input = form.querySelector('.section-add-input');
  if (input) input.focus();
}

function clampBounds(bounds) {
  return {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.max(MIN_WIDTH, Math.round(bounds.width)),
    height: Math.max(MIN_HEIGHT, Math.round(bounds.height))
  };
}

function installResizeHandles() {
  const handles = document.querySelectorAll('[data-resize]');
  for (const handle of handles) {
    handle.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();

      const edge = handle.dataset.resize;
      const startX = event.screenX;
      const startY = event.screenY;
      let startBounds = null;
      let disposed = false;

      handle.classList.add('is-resizing');
      document.body.classList.add('is-resizing-window');
      document.body.dataset.resizeEdge = edge;
      try {
        handle.setPointerCapture(event.pointerId);
      } catch {
        // Keep using document-level listeners even if capture is unavailable.
      }

      const onMove = (moveEvent) => {
        moveEvent.preventDefault();
        if (!startBounds) return;
        const dx = moveEvent.screenX - startX;
        const dy = moveEvent.screenY - startY;
        const next = { ...startBounds };

        if (edge.includes('right')) {
          next.width = startBounds.width + dx;
        }
        if (edge.includes('left')) {
          next.x = startBounds.x + dx;
          next.width = startBounds.width - dx;
        }
        if (edge.includes('bottom')) {
          next.height = startBounds.height + dy;
        }
        if (edge.includes('top')) {
          next.y = startBounds.y + dy;
          next.height = startBounds.height - dy;
        }

        const clamped = clampBounds(next);
        if (edge.includes('left') && clamped.width === MIN_WIDTH) {
          clamped.x = startBounds.x + (startBounds.width - MIN_WIDTH);
        }
        if (edge.includes('top') && clamped.height === MIN_HEIGHT) {
          clamped.y = startBounds.y + (startBounds.height - MIN_HEIGHT);
        }
        window.workspacePulse.resizeWindow(clamped);
      };

      const onUp = (upEvent) => {
        upEvent?.preventDefault?.();
        disposed = true;
        handle.classList.remove('is-resizing');
        document.body.classList.remove('is-resizing-window');
        delete document.body.dataset.resizeEdge;
        document.removeEventListener('pointermove', onMove, true);
        document.removeEventListener('pointerup', onUp, true);
        document.removeEventListener('pointercancel', onUp, true);
      };

      document.addEventListener('pointermove', onMove, true);
      document.addEventListener('pointerup', onUp, true);
      document.addEventListener('pointercancel', onUp, true);

      window.workspacePulse.getWindowBounds().then((bounds) => {
        if (disposed) return;
        if (!bounds) {
          onUp();
          return;
        }
        startBounds = bounds;
      }).catch(() => onUp());
    });
  }
}

function installScheduleDragAndDrop() {
  let dragPayload = null;
  let dragOverItem = null;
  let dragOverPosition = 'below';

  // ── Drag autoscroll ──────────────────────────────────────────────────────
  const AUTOSCROLL_ZONE = 60;  // px from edge to trigger scroll
  const AUTOSCROLL_MAX = 12;   // max px per animation frame
  let autoscrollRafId = null;
  let autoscrollTargets = [];  // [{ el, speed }]

  function computeAutoscrollTargets(mouseY) {
    const targets = [];

    function check(el) {
      if (!el || el.scrollHeight <= el.clientHeight) return;
      const rect = el.getBoundingClientRect();
      const distTop = mouseY - rect.top;
      const distBottom = rect.bottom - mouseY;
      let speed = 0;
      if (distTop < AUTOSCROLL_ZONE && distTop >= 0) {
        speed = -Math.round(AUTOSCROLL_MAX * (1 - distTop / AUTOSCROLL_ZONE));
      } else if (distBottom < AUTOSCROLL_ZONE && distBottom >= 0) {
        speed = Math.round(AUTOSCROLL_MAX * (1 - distBottom / AUTOSCROLL_ZONE));
      }
      if (speed !== 0) targets.push({ el, speed });
    }

    check(scheduleBody);
    document.querySelectorAll('.list-stack').forEach(check);
    return targets;
  }

  function autoscrollTick() {
    autoscrollRafId = null;
    if (!autoscrollTargets.length || !dragPayload) return;
    autoscrollTargets.forEach(({ el, speed }) => { el.scrollTop += speed; });
    autoscrollRafId = requestAnimationFrame(autoscrollTick);
  }

  function startAutoscroll(mouseY) {
    autoscrollTargets = computeAutoscrollTargets(mouseY);
    if (!autoscrollTargets.length) {
      stopAutoscroll();
      return;
    }
    if (!autoscrollRafId) autoscrollRafId = requestAnimationFrame(autoscrollTick);
  }

  function stopAutoscroll() {
    if (autoscrollRafId) {
      cancelAnimationFrame(autoscrollRafId);
      autoscrollRafId = null;
    }
    autoscrollTargets = [];
  }
  // ────────────────────────────────────────────────────────────────────────

  function clearDropIndicators() {
    document.querySelectorAll('.list-stack.is-drag-over').forEach((el) => el.classList.remove('is-drag-over'));
    document.querySelectorAll('.is-drop-above, .is-drop-below').forEach((el) => {
      el.classList.remove('is-drop-above', 'is-drop-below');
    });
    dragOverItem = null;
  }

  document.addEventListener('dragstart', (event) => {
    const item = event.target.closest('.list-item--interactive.is-draggable');
    if (!item) return;
    const blockedControl = event.target.closest('.status-checkbox, .board-card__status-action, .item-action, .item-action--edit, input, textarea, select');
    if (blockedControl || item.dataset.editing === 'true') {
      event.preventDefault();
      return;
    }
    const sourceKey = item.dataset.source;
    const lineIndex = Number(item.dataset.lineIndex);
    if (!sourceKey || Number.isNaN(lineIndex)) return;
    const rawText = item.dataset.rawText || '';
    dragPayload = { sourceKey, lineIndex, rawText };
    event.dataTransfer?.setData('application/x-askewly-command-task', JSON.stringify(dragPayload));
    event.dataTransfer.effectAllowed = 'move';
    item.classList.add('is-dragging');
  });

  document.addEventListener('dragend', (event) => {
    const item = event.target.closest('.list-item--interactive.is-draggable');
    if (item) item.classList.remove('is-dragging');
    clearDropIndicators();
    stopAutoscroll();
    dragPayload = null;
  });

  document.addEventListener('dragover', (event) => {
    if (scheduleView !== 'active') return;
    if (dragPayload) startAutoscroll(event.clientY);

    const overItem = event.target.closest('.list-item--interactive.is-draggable');
    const stack = event.target.closest('.list-stack[data-drop-target]');
    if (!stack) return;

    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';

    const isSameSource = overItem && overItem.dataset.source === dragPayload?.sourceKey;
    const isTargetSource = overItem && overItem.dataset.source === stack.dataset.dropTarget;
    // TODAY visually mixes today and recurring items. Use an item as a precise
    // drop target only when that item belongs to the source being written.
    if (isSameSource || isTargetSource) {
      clearDropIndicators();
      const rect = overItem.getBoundingClientRect();
      dragOverPosition = event.clientY < rect.top + rect.height / 2 ? 'above' : 'below';
      dragOverItem = overItem;
      overItem.classList.add(dragOverPosition === 'above' ? 'is-drop-above' : 'is-drop-below');
    } else {
      clearDropIndicators();
      stack.classList.add('is-drag-over');
    }
  });

  document.addEventListener('dragleave', (event) => {
    const stack = event.target.closest('.list-stack[data-drop-target]');
    if (!stack) return;
    if (!stack.contains(event.relatedTarget)) {
      stack.classList.remove('is-drag-over');
    }
  });

  document.addEventListener('drop', async (event) => {
    const stack = event.target.closest('.list-stack[data-drop-target]');
    if (!stack || scheduleView !== 'active') return;
    event.preventDefault();

    const raw = event.dataTransfer?.getData('application/x-askewly-command-task');
    const capturedOverItem = dragOverItem;
    const capturedPosition = dragOverPosition;
    clearDropIndicators();
    if (!raw || !dragPayload) return;

    try {
      const payload = JSON.parse(raw);
      const targetKey = stack.dataset.dropTarget;
      if (!payload?.sourceKey || Number.isNaN(Number(payload?.lineIndex)) || !targetKey) return;

      if (targetKey === payload.sourceKey) {
        // Intra-section reorder — optimistic
        if (!capturedOverItem) return;
        if (capturedOverItem.dataset.source !== payload.sourceKey) return;
        const targetLineIndex = Number(capturedOverItem.dataset.lineIndex);
        if (Number.isNaN(targetLineIndex) || targetLineIndex === payload.lineIndex) return;
        const insertBeforeLineIndex = capturedPosition === 'above' ? targetLineIndex : targetLineIndex + 1;
        const previousState = applyOptimisticReorder(payload.sourceKey, Number(payload.lineIndex), targetLineIndex, capturedPosition);
        commitScheduleMutation({
          previousState,
          request: () => window.workspacePulse.reorderScheduleItem({
            sourceKey: payload.sourceKey,
            fromLineIndex: Number(payload.lineIndex),
            insertBeforeLineIndex,
            targetLineIndex,
            position: capturedPosition,
            fromRawText: payload.rawText || ''
          })
        });
      } else {
        // Cross-section move — optimistic
        const targetLineIndex = capturedOverItem?.dataset.source === targetKey ? Number(capturedOverItem.dataset.lineIndex) : null;
        const targetPosition = targetLineIndex === null || Number.isNaN(targetLineIndex) ? null : capturedPosition;
        const previousState = applyOptimisticMove(
          payload.sourceKey,
          Number(payload.lineIndex),
          targetKey,
          targetPosition ? targetLineIndex : null,
          targetPosition || 'above'
        );
        commitScheduleMutation({
          previousState,
          resetConfirmationGuard: true,
          afterRender: () => revealScheduleItem(targetKey, Number(payload.lineIndex), payload.rawText || ''),
          request: () => window.workspacePulse.moveScheduleItem({
            sourceKey: payload.sourceKey,
            lineIndex: Number(payload.lineIndex),
            targetKey,
            targetLineIndex: targetPosition ? targetLineIndex : null,
            position: targetPosition || null
          })
        });
      }
    } catch (error) {
      console.error(error);
    }
  });
}

function normalizeWheelDelta(event, pageSize) {
  let deltaY = Number(event.deltaY || 0);
  if (!deltaY) return 0;
  if (event.deltaMode === 1) deltaY *= 16;
  else if (event.deltaMode === 2) deltaY *= pageSize;
  return deltaY;
}

function findScrollableAncestor(startEl) {
  let el = startEl;
  while (el && el !== document.body && el !== document.documentElement) {
    if (el.scrollHeight > el.clientHeight + 1) {
      const style = window.getComputedStyle(el);
      if (/(auto|scroll)/.test(style.overflowY)) return el;
    }
    el = el.parentElement;
  }
  return null;
}

function installWheelRouting() {
  document.addEventListener('wheel', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest('select, input, textarea')) return;

    const scroller = findScrollableAncestor(target);
    if (!scroller) return;

    const deltaY = normalizeWheelDelta(event, scroller.clientHeight);
    if (!deltaY) return;

    const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const nextScrollTop = Math.min(maxScrollTop, Math.max(0, scroller.scrollTop + deltaY));
    if (nextScrollTop === scroller.scrollTop) return;

    scroller.scrollTop = nextScrollTop;
    event.preventDefault();
  }, { passive: false, capture: true });
}

async function initializeAppearance() {
  const settings = await window.workspacePulse.getSettings();
  availableFonts = Array.isArray(settings?.availableFonts) ? settings.availableFonts : [];
  currentAppearance = {
    theme: settings?.appearance?.theme || 'light',
    fontFamily: settings?.appearance?.fontFamily || 'Segoe UI',
    fontSize: Number(settings?.appearance?.fontSize || 12)
  };
  applyTheme(currentAppearance.theme);
  applyFontSettings(currentAppearance.fontFamily, currentAppearance.fontSize);
  syncAppearanceControls(currentAppearance);
}

applySectionHeights();
applySectionCollapsed();
installResizeHandles();
installSectionResizeHandles();
installScheduleDragAndDrop();
installWheelRouting();
setScheduleView('active');
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (currentThemePreference === 'system') {
    applyTheme('system');
  }
});
initializeAppearance().catch((error) => console.error(error));
window.workspacePulse.getInitialState().then(render);
window.workspacePulse.onState((state) => {
  if (Date.now() - lastConfirmedAt < 5000) return;
  if (isEditingScheduleItem()) return;
  render(state);
  if (brandMark) brandMark.dataset.sync = state.error ? 'error' : 'ok';
  if (syncErrorHint) syncErrorHint.hidden = !state.error;
});
window.workspacePulse.onSyncStatus(({ status }) => {
  if (brandMark) brandMark.dataset.sync = status;
  if (syncErrorHint) syncErrorHint.hidden = status !== 'error';
});

closeButton.addEventListener('click', () => {
  window.workspacePulse.close();
});

refreshButton.addEventListener('click', async () => {
  refreshButton.disabled = true;
  refreshButton.classList.add('spinning');
  try {
    await window.workspacePulse.refresh();
  } finally {
    refreshButton.classList.remove('spinning');
    refreshButton.disabled = false;
  }
});

function summarizeSyncResult(result) {
  const parts = [];
  if (result?.failures?.length) {
    parts.push(`실패:\n${result.failures.map((f) => `- ${f.name}: ${f.error}`).join('\n')}`);
  }
  if (result?.skipped?.length) {
    parts.push(`건너뜀:\n${result.skipped.map((s) => `- ${s.name} (${s.reason})`).join('\n')}`);
  }
  return parts.join('\n\n');
}

syncPushButton.addEventListener('click', async () => {
  syncPushButton.disabled = true;
  syncPushButton.classList.add('spinning');
  try {
    const status = await window.workspacePulse.getSyncStatus();
    if (status?.cloudMode) {
      alert('Supabase cloud mode에서는 M4 vault Push를 사용하지 않습니다.');
      return;
    }
    if (status?.unseeded) {
      alert('로컬이 아직 vault에서 시딩되지 않았습니다. 먼저 Pull(⇩)로 M4 vault 내용을 가져오세요.\n\n빈 상태를 강제로 Push하면 원격 데이터를 덮어쓸 수 있습니다.');
      return;
    }
    if (!confirm('로컬 일정을 M4 vault로 덮어씁니다. 진행할까요?')) return;
    const result = await window.workspacePulse.syncPushVault();
    const summary = summarizeSyncResult(result);
    alert(summary || 'M4 vault로 반영 완료');
  } catch (error) {
    alert(`Push 실패: ${error?.message || error}`);
  } finally {
    syncPushButton.classList.remove('spinning');
    syncPushButton.disabled = false;
  }
});

syncPullButton.addEventListener('click', async () => {
  const status = await window.workspacePulse.getSyncStatus();
  if (status?.cloudMode) {
    alert('Supabase cloud mode에서는 M4 vault Pull을 사용하지 않습니다.');
    return;
  }
  if (!confirm('M4 vault 내용으로 로컬을 덮어씁니다. 현재 로컬은 백업 폴더에 보관됩니다. 진행할까요?')) return;
  syncPullButton.disabled = true;
  syncPullButton.classList.add('spinning');
  try {
    const result = await window.workspacePulse.syncPullVault();
    const summary = summarizeSyncResult(result);
    const backupNote = result?.backupDir ? `\n백업: ${result.backupDir}` : '';
    alert((summary ? `${summary}${backupNote}` : `M4 vault에서 가져오기 완료${backupNote}`));
  } catch (error) {
    alert(`Pull 실패: ${error?.message || error}`);
  } finally {
    syncPullButton.classList.remove('spinning');
    syncPullButton.disabled = false;
  }
});

settingsButton.addEventListener('click', () => {
  toggleSettingsPanel();
});

settingsCloseButton.addEventListener('click', () => {
  toggleSettingsPanel(false);
});

settingsBackdrop.addEventListener('click', () => {
  toggleSettingsPanel(false);
});

document.addEventListener('click', (event) => {
  if (settingsPanel.hidden) return;
  const insidePanel = event.target.closest('#settingsPanel');
  const hitButton = event.target.closest('#settingsButton');
  if (!insidePanel && !hitButton) {
    toggleSettingsPanel(false);
  }
});

settingsResetButton.addEventListener('click', () => {
  persistAppearance({
    theme: 'dark',
    fontFamily: 'Segoe UI',
    fontSize: 13
  }).catch((error) => console.error(error));
});

cloudGoogleSignIn?.addEventListener('click', () => {
  signInCloud('google').catch((error) => console.error(error));
});

cloudKakaoSignIn?.addEventListener('click', () => {
  signInCloud('kakao').catch((error) => console.error(error));
});

cloudSignOut?.addEventListener('click', () => {
  signOutCloud().catch((error) => console.error(error));
});

settingTheme.addEventListener('change', () => {
  persistAppearance({ theme: settingTheme.value }).catch((error) => console.error(error));
});

settingFontFamily.addEventListener('change', () => {
  persistAppearance({ fontFamily: settingFontFamily.value }).catch((error) => console.error(error));
});

settingFontSize.addEventListener('input', () => {
  settingFontSizeValue.textContent = `${settingFontSize.value}px`;
});

settingFontSize.addEventListener('change', () => {
  persistAppearance({ fontSize: Number(settingFontSize.value) }).catch((error) => console.error(error));
});

scheduleViewToggle.addEventListener('click', () => {
  setScheduleView(scheduleView === 'archive' ? 'active' : 'archive');
});

document.addEventListener('click', (event) => {
  const toggle = event.target.closest('[data-section-toggle]');
  if (!toggle) return;
  toggleSection(toggle.dataset.sectionToggle);
});

document.addEventListener('click', (event) => {
  const addBtn = event.target.closest('.section-add-btn');
  if (!addBtn || scheduleView === 'archive') return;
  const target = addBtn.dataset.addFor;
  const form = document.querySelector(`.section-add-form[data-add-target="${target}"]`);
  if (form && !form.hidden) {
    closeAllAddForms();
  } else {
    openSectionAddForm(target);
  }
});

document.addEventListener('click', (event) => {
  if (event.target.closest('.section-add-cancel')) {
    closeAllAddForms();
  }
});

async function submitSectionAdd(target, form) {
  const titleInput = form.querySelector('.section-add-title');
  const detailInput = form.querySelector('.section-add-detail');
  const dateInput = form.querySelector('.section-add-date');

  const title = titleInput?.value.trim();
  if (!title) return;

  const detail = detailInput?.value.trim();
  let text = detail ? `${title} — ${detail}` : title;

  if (target === 'deadline' && dateInput?.value) {
    const [, m, d] = dateInput.value.match(/\d{4}-(\d{2})-(\d{2})/) || [];
    if (m && d) text = `${text} \`${m}-${d}\``;
  }

  const section = DEFAULT_SECTION_BY_TARGET[target] || '';
  const previousState = applyOptimisticAdd(target, text, section);
  closeAllAddForms();
  await commitScheduleMutation({
    previousState,
    request: () => window.workspacePulse.addScheduleItem({ target, text, section })
  });
}

document.addEventListener('click', (event) => {
  const saveBtn = event.target.closest('.section-add-save');
  if (!saveBtn) return;
  const form = saveBtn.closest('.section-add-form');
  if (!form) return;
  const target = form.dataset.addTarget;
  if (target) submitSectionAdd(target, form);
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  const form = event.target.closest('.section-add-form');
  if (!form) return;
  event.preventDefault();
  const target = form.dataset.addTarget;
  if (target) submitSectionAdd(target, form);
});

const taskGraphModal = {
  currentElement: null,
  el: null,
  backdrop: null,
  title: null,
  projectSelect: null,
  milestoneSelect: null,
  status: null,
  save: null,
  clear: null,
  close: null
};

function ensureTaskGraphModalRefs() {
  if (taskGraphModal.el) return true;
  taskGraphModal.el = document.getElementById('taskGraphModal');
  taskGraphModal.backdrop = document.getElementById('taskGraphModalBackdrop');
  taskGraphModal.title = document.getElementById('taskGraphModalTitle');
  taskGraphModal.projectSelect = document.getElementById('taskGraphProject');
  taskGraphModal.milestoneSelect = document.getElementById('taskGraphMilestone');
  taskGraphModal.status = document.getElementById('taskGraphModalStatus');
  taskGraphModal.save = document.getElementById('taskGraphModalSave');
  taskGraphModal.clear = document.getElementById('taskGraphModalClear');
  taskGraphModal.close = document.getElementById('taskGraphModalClose');
  if (!taskGraphModal.el) return false;

  taskGraphModal.projectSelect.addEventListener('change', () => {
    renderTaskGraphMilestoneOptions(Number(taskGraphModal.projectSelect.value) || null, null);
  });
  taskGraphModal.save.addEventListener('click', () => saveTaskGraphModal(false));
  taskGraphModal.clear.addEventListener('click', () => saveTaskGraphModal(true));
  taskGraphModal.close.addEventListener('click', closeTaskGraphModal);
  taskGraphModal.backdrop.addEventListener('click', closeTaskGraphModal);
  taskGraphModal.el.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeTaskGraphModal();
    }
  });
  return true;
}

function getTaskGraphProjects() {
  return Array.isArray(window.__workspacePulseState?.today?.projects)
    ? window.__workspacePulseState.today.projects
    : [];
}

function getTaskGraphMilestones() {
  return Array.isArray(window.__workspacePulseState?.today?.milestones)
    ? window.__workspacePulseState.today.milestones
    : [];
}

function renderTaskGraphProjectOptions(selectedProjectId) {
  const projects = getTaskGraphProjects();
  taskGraphModal.projectSelect.innerHTML = [
    `<option value="">No project</option>`,
    ...projects.map((project) => (
      `<option value="${escapeHtml(project.id)}" ${Number(project.id) === Number(selectedProjectId) ? 'selected' : ''}>${escapeHtml(project.name || `Project ${project.id}`)}</option>`
    ))
  ].join('');
}

function renderTaskGraphMilestoneOptions(projectId, selectedMilestoneId) {
  const milestones = getTaskGraphMilestones().filter((milestone) => Number(milestone.projectId) === Number(projectId));
  taskGraphModal.milestoneSelect.disabled = !projectId || milestones.length === 0;
  taskGraphModal.milestoneSelect.innerHTML = [
    `<option value="">No milestone</option>`,
    ...milestones.map((milestone) => (
      `<option value="${escapeHtml(milestone.id)}" ${Number(milestone.id) === Number(selectedMilestoneId) ? 'selected' : ''}>${escapeHtml(milestone.title || `Milestone ${milestone.id}`)}</option>`
    ))
  ].join('');
}

function openTaskGraphModal(itemElement) {
  if (!ensureTaskGraphModalRefs()) return;
  if (!window.workspacePulse?.updateScheduleItemGraph) {
    window.alert('Task graph editing requires an updated desktop bridge.');
    return;
  }
  const projects = getTaskGraphProjects();
  if (projects.length === 0) {
    window.alert('연결할 활성 프로젝트가 없습니다.');
    return;
  }
  taskGraphModal.currentElement = itemElement;
  const title = itemElement.querySelector('.list-item__title')?.textContent || 'Task';
  const projectId = Number(itemElement.dataset.projectId) || null;
  const milestoneId = Number(itemElement.dataset.projectMilestoneId) || null;
  taskGraphModal.title.textContent = `Project link · ${title.slice(0, 48)}`;
  if (taskGraphModal.status) {
    taskGraphModal.status.dataset.state = '';
    taskGraphModal.status.textContent = 'Project를 고른 뒤 필요하면 해당 Project의 Milestone을 고르세요.';
  }
  renderTaskGraphProjectOptions(projectId);
  renderTaskGraphMilestoneOptions(projectId, milestoneId);
  taskGraphModal.el.hidden = false;
  taskGraphModal.backdrop.hidden = false;
  setTimeout(() => taskGraphModal.projectSelect.focus(), 20);
}

function closeTaskGraphModal() {
  if (!taskGraphModal.el) return;
  taskGraphModal.currentElement = null;
  taskGraphModal.el.hidden = true;
  if (taskGraphModal.backdrop) taskGraphModal.backdrop.hidden = true;
}

function saveTaskGraphModal(clear = false) {
  const itemElement = taskGraphModal.currentElement;
  if (!itemElement) return;
  const sourceKey = itemElement.dataset.source;
  const lineIndex = Number(itemElement.dataset.lineIndex);
  const projectId = clear ? null : (Number(taskGraphModal.projectSelect.value) || null);
  const projectMilestoneId = clear || !projectId ? null : (Number(taskGraphModal.milestoneSelect.value) || null);
  const previousState = applyOptimisticGraphUpdate(sourceKey, lineIndex, projectId, projectMilestoneId);
  closeTaskGraphModal();
  commitScheduleMutation({
    previousState,
    pendingElement: itemElement,
    request: () => window.workspacePulse.updateScheduleItemGraph({
      sourceKey,
      lineIndex,
      projectId,
      projectMilestoneId
    })
  });
}

function activateInlineEdit(itemElement) {
  if (itemElement.dataset.editing === 'true') return;
  const textButton = itemElement.querySelector('.list-item__text--button');
  if (!textButton) return;

  const rawText = itemElement.dataset.rawText || textButton.textContent.trim();
  const isDeadline = itemElement.dataset.source === 'deadline';
  itemElement.dataset.editing = 'true';
  itemElement.draggable = false;
  itemElement.classList.remove('is-draggable');

  // Strip backtick date for deadline items
  let textForEdit = rawText;
  let initialDate = '';
  if (isDeadline) {
    const dm = rawText.match(/`(\d{1,2})-(\d{1,2})`/);
    if (dm) {
      textForEdit = rawText.replace(/\s*`\d{1,2}-\d{1,2}`/, '').trim();
      const year = new Date().getFullYear();
      initialDate = `${year}-${dm[1].padStart(2, '0')}-${dm[2].padStart(2, '0')}`;
    }
  }

  // Split into title + detail
  const { title: initialTitle, detail: initialDetail } = splitTaskText(textForEdit);
  const sepMatch = textForEdit.match(/ (\||\u2014|-|::) /);
  const sep = sepMatch ? ` ${sepMatch[1]} ` : ' — ';

  // Build inputs
  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.className = 'list-item__edit-input list-item__edit-input--title';
  titleInput.value = initialTitle;
  titleInput.placeholder = '제목';

  const detailInput = document.createElement('input');
  detailInput.type = 'text';
  detailInput.className = 'list-item__edit-input list-item__edit-input--detail';
  detailInput.value = initialDetail;
  detailInput.placeholder = '설명 (선택)';

  let dateInput = null;
  const topRow = document.createElement('div');
  topRow.className = 'list-item__edit-row';
  topRow.appendChild(titleInput);
  if (isDeadline) {
    dateInput = document.createElement('input');
    dateInput.type = 'date';
    dateInput.className = 'list-item__edit-date';
    if (initialDate) dateInput.value = initialDate;
    topRow.appendChild(dateInput);
  }

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'panel-action list-item__edit-save';
  saveBtn.textContent = 'Save';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'panel-action panel-action--ghost list-item__edit-cancel';
  cancelBtn.textContent = 'Cancel';

  const actionsRow = document.createElement('div');
  actionsRow.className = 'list-item__edit-actions';
  actionsRow.appendChild(saveBtn);
  actionsRow.appendChild(cancelBtn);

  const wrapper = document.createElement('div');
  wrapper.className = 'list-item__edit-stack';
  wrapper.appendChild(topRow);
  wrapper.appendChild(detailInput);
  wrapper.appendChild(actionsRow);

  const replaceTarget = wrapper;
  textButton.replaceWith(wrapper);
  titleInput.focus();
  titleInput.select();

  let saved = false;

  const cancel = () => {
    if (saved) return;
    saved = true;
    replaceTarget.replaceWith(textButton);
    delete itemElement.dataset.editing;
    itemElement.draggable = true;
    itemElement.classList.add('is-draggable');
  };

  const save = async () => {
    if (saved) return;
    const title = titleInput.value.trim();
    const detail = detailInput.value.trim();
    if (!title) { cancel(); return; }
    let newText = detail ? `${title}${sep}${detail}` : title;
    if (isDeadline && dateInput?.value) {
      const [, mo, dy] = dateInput.value.match(/\d{4}-(\d{2})-(\d{2})/) || [];
      if (mo && dy) newText = `${newText} \`${mo}-${dy}\``;
    }
    if (newText === rawText) { cancel(); return; }
    saved = true;

    const sourceKey = itemElement.dataset.source;
    const lineIndex = Number(itemElement.dataset.lineIndex);
    const previousState = applyOptimisticTextUpdate(sourceKey, lineIndex, newText);
    commitScheduleMutation({
      previousState,
      pendingElement: itemElement,
      request: () => window.workspacePulse.updateScheduleItemText({ sourceKey, lineIndex, newText })
    });
  };

  saveBtn.addEventListener('click', (e) => { e.preventDefault(); save(); });
  cancelBtn.addEventListener('click', (e) => { e.preventDefault(); cancel(); });

  for (const el of [titleInput, detailInput, dateInput].filter(Boolean)) {
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); save(); }
      if (e.key === 'Escape') cancel();
    });
  }
}

document.addEventListener('click', async (event) => {
  const editButton = event.target.closest('.item-action--edit');
  if (editButton) {
    const itemElement = editButton.closest('.list-item--interactive');
    if (itemElement) activateInlineEdit(itemElement);
    return;
  }

  const actionButton = event.target.closest('.item-action');
  if (!actionButton) return;

  const itemElement = actionButton.closest('.list-item--interactive');
  if (!itemElement) return;

  if (actionButton.dataset.action === 'graph') {
    openTaskGraphModal(itemElement);
    return;
  }

  if (actionButton.dataset.action === 'restore') {
    commitScheduleMutation({
      pendingElement: itemElement,
      request: () => window.workspacePulse.restoreArchivedItem({
        sourceKey: itemElement.dataset.source,
        lineIndex: Number(itemElement.dataset.lineIndex)
      })
    });
    return;
  }

  if (actionButton.dataset.action === 'delete') {
    const confirmed = window.confirm('이 일정을 삭제할까요?');
    if (!confirmed) return;

    const sourceKey = itemElement.dataset.source;
    const lineIndex = Number(itemElement.dataset.lineIndex);
    const isArchived = itemElement.dataset.archived === 'true';
    const previousState = applyOptimisticDelete(sourceKey, lineIndex, isArchived);
    commitScheduleMutation({
      previousState,
      pendingElement: itemElement,
      request: () => window.workspacePulse.deleteScheduleItem({ sourceKey, lineIndex, archived: isArchived })
    });
    return;
  }

  // Status pill buttons removed — handled by .status-checkbox below
});

// Status button cycles pending -> in progress -> completed -> pending.
// Archive/delete remains a separate action.
const STATUS_TOGGLE = { pending: 'in_progress', in_progress: 'completed', completed: 'pending' };

document.addEventListener('click', async (event) => {
  const checkbox = event.target.closest('.status-checkbox');
  if (!checkbox) return;

  const itemElement = checkbox.closest('.list-item--interactive');
  if (!itemElement) return;

  const currentStatus = checkbox.dataset.status || 'pending';
  const nextStatus = STATUS_TOGGLE[currentStatus] || 'pending';

  const previousState = applyOptimisticStatusUpdate(
    itemElement.dataset.source,
    Number(itemElement.dataset.lineIndex),
    nextStatus
  );
  commitScheduleMutation({
    previousState,
    pendingElement: itemElement,
    request: () => window.workspacePulse.updateScheduleItem({
      sourceKey: itemElement.dataset.source,
      lineIndex: Number(itemElement.dataset.lineIndex),
      nextStatus
    })
  });
});

document.addEventListener('click', async (event) => {
  const statusButton = event.target.closest('[data-board-status-action]');
  if (!statusButton) return;

  const itemElement = statusButton.closest('.list-item--interactive');
  if (!itemElement) return;

  const nextStatus = statusButton.dataset.boardStatusAction;
  if (!BOARD_STATUS_SET.has(nextStatus)) return;

  const previousState = applyOptimisticStatusUpdate(
    itemElement.dataset.source,
    Number(itemElement.dataset.lineIndex),
    nextStatus
  );
  commitScheduleMutation({
    previousState,
    pendingElement: itemElement,
    request: () => window.workspacePulse.updateScheduleItem({
      sourceKey: itemElement.dataset.source,
      lineIndex: Number(itemElement.dataset.lineIndex),
      nextStatus
    })
  });
});

document.addEventListener('click', async (event) => {
  const sourceButton = event.target.closest('.list-item__text--button');
  if (!sourceButton) return;

  const itemElement = sourceButton.closest('.list-item--interactive');
  if (!itemElement) return;
  if (itemElement.dataset.archived === 'true') return;
  if (window.__workspacePulseState?.today?.source === 'cloud') return;

  try {
    const opened = await window.workspacePulse.openScheduleSource({
      sourceKey: itemElement.dataset.source,
      lineIndex: Number(itemElement.dataset.lineIndex)
    });
    if (!opened) {
      activateInlineEdit(itemElement);
    }
  } catch (error) {
    console.error(error);
  }
});

/* ── Tab system ────────────────────────────────────────────── */
const TAB_KEY = 'askewly-command-active-tab-v1';
const TABS = ['command', 'schedule', 'content', 'projects', 'log', 'vault', 'notion', 'calendar'];
const sidebarTabs = document.querySelectorAll('.sidebar-tab');
const tabPanels = document.querySelectorAll('.tab-panel');

const POLL_INTERVAL = {
  projects: 45000,
  notion: 90000,
  content: 240000,
  vault: 240000,
  calendar: 300000
};
let activeTab = 'command';
let pollTimer = null;

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

function startPolling() {
  stopPolling();
  if (document.hidden) return;
  if (activeTab === 'schedule' || activeTab === 'command') return;
  const ms = POLL_INTERVAL[activeTab];
  if (!ms) return;
  pollTimer = setInterval(() => {
    if (document.hidden) return;
    loadTabData(activeTab, { force: true });
  }, ms);
}

function setActiveTab(tab) {
  if (!TABS.includes(tab)) tab = 'command';
  activeTab = tab;
  sidebarTabs.forEach((btn) => {
    btn.dataset.active = btn.dataset.tab === tab ? 'true' : 'false';
  });
  tabPanels.forEach((panel) => {
    panel.hidden = panel.dataset.tabPanel !== tab;
  });
  try { localStorage.setItem(TAB_KEY, tab); } catch (_) {}
  if (tab !== 'schedule' && tab !== 'command') loadTabData(tab);
  startPolling();
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopPolling();
  else startPolling();
});

sidebarTabs.forEach((btn) => {
  btn.addEventListener('click', () => setActiveTab(btn.dataset.tab));
});

document.addEventListener('click', (event) => {
  const reviewButton = event.target.closest('[data-review-target]');
  if (!reviewButton) return;
  const target = reviewButton.dataset.reviewTarget || 'schedule';
  if (target === 'projects') {
    setActiveTab('projects');
  } else if (target === 'obsidian') {
    setActiveTab('vault');
  } else {
    setActiveTab('schedule');
  }
});

document.addEventListener('click', (event) => {
  const refreshBtn = event.target.closest('[data-tab-refresh]');
  if (!refreshBtn) return;
  const tab = refreshBtn.dataset.tabRefresh;
  if (tab === 'command') {
    window.workspacePulse.refresh?.().catch((error) => console.error(error));
    return;
  }
  loadTabData(tab, { force: true });
});

const initialTab = (() => {
  try { return localStorage.getItem(TAB_KEY) || 'command'; }
  catch (_) { return 'command'; }
})();
/* ── Tab data loaders ──────────────────────────────────────── */
const tabCache = { content: null, projects: null, vault: null, notion: null, calendar: null, log: null };
const tabLoading = { content: false, projects: false, vault: false, notion: false, calendar: false, log: false };

// stale-while-revalidate 캐시.
// Content(SSH→원격 node CLI)·Notion(search API)·Projects 는 원격 호출이 1~3s 걸려
// 콜드 스타트 때 "로딩 중" 빈 화면이 길다. 마지막 결과를 localStorage 에 저장해
// 위젯 재시작 후에도 탭 열면 즉시 stale 을 그리고 백그라운드로 갱신한다.
const TAB_CACHE_TTL = 30000;
const PERSISTED_TABS = ['content', 'notion', 'projects'];
const TAB_CACHE_STORE_KEY = 'askewly-command-tab-cache-v1';

function persistTabCache(tab, entry) {
  if (!PERSISTED_TABS.includes(tab)) return;
  try {
    const store = JSON.parse(localStorage.getItem(TAB_CACHE_STORE_KEY) || '{}');
    store[tab] = entry;
    localStorage.setItem(TAB_CACHE_STORE_KEY, JSON.stringify(store));
  } catch (_) { /* quota/parse 실패는 무시 — 캐시는 best-effort */ }
}

function loadPersistedTabCache(tab) {
  if (!PERSISTED_TABS.includes(tab)) return null;
  try {
    const store = JSON.parse(localStorage.getItem(TAB_CACHE_STORE_KEY) || '{}');
    return store[tab] || null;
  } catch (_) { return null; }
}
const CALENDAR_RANGE_KEY = 'askewly-command-calendar-range-v1';
let calendarRange = (() => {
  try { return localStorage.getItem(CALENDAR_RANGE_KEY) === 'month' ? 'month' : 'week'; }
  catch (_) { return 'week'; }
})();

async function loadTabData(tab, { force = false } = {}) {
  if (!['content', 'projects', 'vault', 'notion', 'calendar', 'log'].includes(tab)) return;
  if (tabLoading[tab]) return;

  // 메모리 캐시가 비었으면 디스크(localStorage) 캐시를 끌어온다 (재시작 직후 즉시 표시용).
  if (!tabCache[tab]) {
    const persisted = loadPersistedTabCache(tab);
    if (persisted) tabCache[tab] = persisted;
  }

  // stale-while-revalidate: 캐시가 있으면 일단 즉시 그려 빈 화면을 없앤다.
  const cached = tabCache[tab];
  if (cached) {
    renderTab(tab, cached.data);
    // 충분히 신선하면 원격 재호출 생략
    if (!force && Date.now() - cached.fetchedAt < TAB_CACHE_TTL) return;
  }

  const statusEl = document.getElementById(`${tab}Status`);
  // 캐시가 전혀 없을 때만 "로딩 중" — 캐시가 있으면 stale 위에 조용히 갱신
  if (statusEl) {
    if (cached) { statusEl.dataset.state = ''; statusEl.textContent = '갱신 중…'; }
    else { statusEl.dataset.state = ''; statusEl.textContent = '로딩 중...'; }
  }
  tabLoading[tab] = true;
  try {
    const api = window.workspacePulse;
    let data = null;
    if (tab === 'content' && api.getContentState) data = await api.getContentState();
    else if (tab === 'projects' && api.getProjectsState) data = await api.getProjectsState();
    else if (tab === 'vault' && api.getVaultState) data = await api.getVaultState();
    else if (tab === 'notion' && api.getNotionState) data = await api.getNotionState();
    else if (tab === 'calendar' && api.getCalendarState) data = await api.getCalendarState({ range: calendarRange, force });
    else if (tab === 'log' && api.getTodayLog) data = await api.getTodayLog();
    else data = { items: [], error: '아직 구현되지 않음' };
    const entry = { data, fetchedAt: Date.now() };
    tabCache[tab] = entry;
    // 에러 응답(핸들러가 throw 대신 data.error 로 반환)은 디스크에 안 남겨 마지막 정상 데이터를 보존한다.
    if (!data || !data.error) persistTabCache(tab, entry);
    renderTab(tab, data);
  } catch (error) {
    console.error(`load ${tab}`, error);
    // 백그라운드 갱신 실패 시 stale 데이터는 그대로 두고 상태만 에러로 표시한다.
    if (statusEl) { statusEl.dataset.state = 'error'; statusEl.textContent = String(error.message || error); }
  } finally {
    tabLoading[tab] = false;
  }
}

function formatRelative(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const diff = Date.now() - then;
  const abs = Math.abs(diff);
  const suffix = diff >= 0 ? '전' : '후';
  const min = Math.round(abs / 60000);
  if (min < 1) return '방금';
  if (min < 60) return `${min}분 ${suffix}`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}시간 ${suffix}`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}일 ${suffix}`;
  const mon = Math.round(day / 30);
  return `${mon}개월 ${suffix}`;
}

function renderTab(tab, data) {
  if (tab === 'projects') renderProjectsTab(data);
  else if (tab === 'content') renderContentTab(data);
  else if (tab === 'vault') renderVaultTab(data);
  else if (tab === 'notion') renderNotionTab(data);
  else if (tab === 'calendar') renderCalendarTab(data);
  else if (tab === 'log') renderLogTab(data);
}

/* ── Today Log tab ─────────────────────────────────────────── */
const CAPTURE_LINE_RE = /^(\s*-\s*)(\d{2}:\d{2})\s+(.+)$/;

function renderLogTab(data) {
  const titleEl = document.getElementById('logTitle');
  const bodyEl = document.getElementById('logBody');
  const statusEl = document.getElementById('logStatus');
  if (!bodyEl) return;
  if (!data || data.ok === false) {
    bodyEl.innerHTML = '';
    if (statusEl) { statusEl.dataset.state = 'error'; statusEl.textContent = data?.error || '로드 실패'; }
    return;
  }
  if (titleEl) titleEl.textContent = `Today Log · ${data.dateStr}`;
  bodyEl.innerHTML = '';
  if (!data.exists) {
    bodyEl.textContent = '(오늘 로그 파일 없음 — 캡쳐 시 자동 생성)';
    if (statusEl) { statusEl.dataset.state = ''; statusEl.textContent = data.filePath || ''; }
    return;
  }
  const lines = (data.content || '').split('\n');
  lines.forEach((raw, idx) => {
    const row = document.createElement('div');
    row.className = 'log-line';
    const m = raw.match(CAPTURE_LINE_RE);
    if (m) {
      row.classList.add('log-line--capture');
      row.dataset.lineIndex = String(idx);
      const time = document.createElement('span');
      time.className = 'log-line__time';
      time.textContent = m[2];
      const text = document.createElement('span');
      text.className = 'log-line__text';
      text.textContent = m[3];
      const actions = document.createElement('span');
      actions.className = 'log-line__actions';
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'log-line__btn';
      editBtn.title = '수정';
      editBtn.textContent = '✎';
      editBtn.addEventListener('click', (e) => { e.stopPropagation(); startEditLogLine(row, idx, m[3]); });
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'log-line__btn log-line__btn--danger';
      delBtn.title = '삭제';
      delBtn.textContent = '✕';
      delBtn.addEventListener('click', (e) => { e.stopPropagation(); deleteLogLine(idx, m[3]); });
      actions.appendChild(editBtn);
      actions.appendChild(delBtn);
      row.appendChild(time);
      row.appendChild(text);
      row.appendChild(actions);
    } else {
      row.classList.add('log-line--plain');
      row.textContent = raw;
    }
    bodyEl.appendChild(row);
  });
  bodyEl.scrollTop = bodyEl.scrollHeight;
  if (statusEl) { statusEl.dataset.state = ''; statusEl.textContent = data.filePath || ''; }
}

async function deleteLogLine(lineIndex, preview) {
  const statusEl = document.getElementById('logStatus');
  const logInputEl = document.getElementById('logInput');
  try {
    const res = await window.workspacePulse.deleteTodayLogLine({ lineIndex });
    if (res?.ok) {
      tabCache.log = null;
      await loadTabData('log', { force: true });
      if (statusEl) { statusEl.dataset.state = ''; statusEl.textContent = `삭제됨: ${preview}`; }
    } else if (statusEl) {
      statusEl.dataset.state = 'error';
      statusEl.textContent = `삭제 실패: ${res?.error}`;
    }
  } catch (err) {
    if (statusEl) { statusEl.dataset.state = 'error'; statusEl.textContent = `예외: ${err.message || err}`; }
  } finally {
    if (logInputEl) { logInputEl.disabled = false; logInputEl.focus(); }
  }
}

function startEditLogLine(row, lineIndex, currentText) {
  const textSpan = row.querySelector('.log-line__text');
  if (!textSpan) return;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'log-line__edit-input';
  input.value = currentText;
  textSpan.replaceWith(input);
  input.focus();
  input.select();
  const finish = async (commit) => {
    if (!commit) { tabCache.log = null; await loadTabData('log', { force: true }); return; }
    const newText = input.value.trim();
    if (!newText || newText === currentText) { tabCache.log = null; await loadTabData('log', { force: true }); return; }
    const statusEl = document.getElementById('logStatus');
    try {
      const res = await window.workspacePulse.editTodayLogLine({ lineIndex, newText });
      if (res?.ok) {
        tabCache.log = null;
        await loadTabData('log', { force: true });
      } else if (statusEl) {
        statusEl.dataset.state = 'error';
        statusEl.textContent = `수정 실패: ${res?.error}`;
      }
    } catch (err) {
      if (statusEl) { statusEl.dataset.state = 'error'; statusEl.textContent = `예외: ${err.message || err}`; }
    }
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
}

const logInputEl = document.getElementById('logInput');
if (logInputEl) {
  logInputEl.addEventListener('keydown', async (event) => {
    if (event.key !== 'Enter') return;
    const text = logInputEl.value.trim();
    if (!text) return;
    logInputEl.disabled = true;
    try {
      const res = await window.workspacePulse.appendTodayLog({ text });
      if (res?.ok) {
        logInputEl.value = '';
        tabCache.log = null;
        await loadTabData('log', { force: true });
      } else {
        const statusEl = document.getElementById('logStatus');
        if (statusEl) { statusEl.dataset.state = 'error'; statusEl.textContent = res?.error || '추가 실패'; }
      }
    } finally {
      logInputEl.disabled = false;
      logInputEl.focus();
    }
  });
}

// Event delegation: more robust against bind timing issues
document.addEventListener('click', async (event) => {
  const btn = event.target.closest('#logOpenBtn');
  if (!btn) return;
  const statusEl = document.getElementById('logStatus');
  try {
    if (!window.workspacePulse?.openTodayLog) {
      if (statusEl) { statusEl.dataset.state = 'error'; statusEl.textContent = 'openTodayLog API 없음 (preload 미반영, 재시작 필요)'; }
      return;
    }
    if (statusEl) { statusEl.dataset.state = ''; statusEl.textContent = 'notepad 호출 중...'; }
    const res = await window.workspacePulse.openTodayLog();
    if (statusEl) {
      if (res?.ok) { statusEl.dataset.state = ''; statusEl.textContent = `열림: ${res.filePath || ''}`; }
      else { statusEl.dataset.state = 'error'; statusEl.textContent = `실패: ${res?.error || 'unknown'}`; }
    }
  } catch (err) {
    if (statusEl) { statusEl.dataset.state = 'error'; statusEl.textContent = `예외: ${err.message || err}`; }
  }
});

/* ── Calendar tab ──────────────────────────────────────────── */
const KOREAN_WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

function localDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function buildDateRange(rangeKey) {
  const days = rangeKey === 'month' ? 30 : 7;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const out = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    out.push({
      dateKey: localDateKey(d),
      date: d,
      weekday: KOREAN_WEEKDAYS[d.getDay()],
      isToday: i === 0,
      isWeekend: d.getDay() === 0 || d.getDay() === 6,
      monthDay: `${d.getMonth() + 1}/${d.getDate()}`
    });
  }
  return out;
}

let calendarLastData = null;
const calendarEventsById = new Map();
let calendarWritableCalendars = [];

function renderCalendarTab(data) {
  const body = document.getElementById('calendarBody');
  const statusEl = document.getElementById('calendarStatus');
  if (!body) return;

  calendarLastData = data;
  calendarEventsById.clear();
  calendarWritableCalendars = Array.isArray(data?.calendars)
    ? data.calendars.filter((c) => c.accessRole === 'owner' || c.accessRole === 'writer')
    : [];

  document.querySelectorAll('.calendar-range-btn').forEach((btn) => {
    btn.dataset.active = btn.dataset.calendarRange === calendarRange ? 'true' : 'false';
  });

  if (data?.error) {
    body.innerHTML = `<p class="empty-state">캘린더 로드 실패: ${escapeHtml(data.error)}</p>`;
    if (statusEl) { statusEl.dataset.state = 'error'; statusEl.textContent = '오류'; }
    return;
  }

  const events = Array.isArray(data?.events) ? data.events : [];
  const eventsByDate = new Map();
  for (const ev of events) {
    if (!ev?.dateKey) continue;
    calendarEventsById.set(ev.id, ev);
    const arr = eventsByDate.get(ev.dateKey) || [];
    arr.push(ev);
    eventsByDate.set(ev.dateKey, arr);
  }

  const dateRange = buildDateRange(data?.range || calendarRange);
  const cards = dateRange.map((day) => {
    const dayEvents = eventsByDate.get(day.dateKey) || [];
    const eventsHtml = dayEvents.length === 0
      ? `<p class="calendar-empty">—</p>`
      : dayEvents.map((ev) => {
          const colorStyle = ev.calendarColor ? `style="--cal-color:${escapeHtml(ev.calendarColor)}"` : '';
          const writableClass = ev.writable ? 'is-writable' : 'is-readonly';
          const recurringIcon = ev.recurring ? '<span class="calendar-event__icon" title="반복">↻</span>' : '';
          return `
            <div class="calendar-event ${ev.allDay ? 'is-allday' : ''} ${writableClass}" ${colorStyle}>
              <button class="calendar-event__main" type="button"
                data-calendar-event-id="${escapeHtml(ev.id)}" title="${ev.writable ? '클릭해서 편집' : '읽기 전용'}">
                <span class="calendar-event__time">${escapeHtml(ev.timeLabel || '')}</span>
                <span class="calendar-event__summary">${escapeHtml(ev.summary)}${recurringIcon}</span>
                ${ev.location ? `<span class="calendar-event__loc">📍 ${escapeHtml(ev.location)}</span>` : ''}
              </button>
              <button class="calendar-event__open" type="button"
                data-calendar-event-link="${escapeHtml(ev.id)}" title="Google 캘린더에서 열기">↗</button>
            </div>
          `;
        }).join('');
    return `
      <section class="calendar-day ${day.isToday ? 'is-today' : ''} ${day.isWeekend ? 'is-weekend' : ''}" data-day-key="${escapeHtml(day.dateKey)}">
        <header class="calendar-day__head">
          <span class="calendar-day__date">${escapeHtml(day.monthDay)}</span>
          <span class="calendar-day__wd">${escapeHtml(day.weekday)}</span>
          ${day.isToday ? '<span class="calendar-day__badge">오늘</span>' : ''}
          <button class="calendar-day__add" type="button" data-calendar-add-day="${escapeHtml(day.dateKey)}" title="이 날에 추가">+</button>
          <span class="calendar-day__count">${dayEvents.length || ''}</span>
        </header>
        <div class="calendar-day__body">${eventsHtml}</div>
      </section>
    `;
  }).join('');

  body.innerHTML = cards;

  if (statusEl) {
    const total = events.length;
    statusEl.dataset.state = '';
    statusEl.textContent = total === 0 ? '이벤트 없음' : `${total}개 이벤트 · ${calendarRange === 'month' ? '30일' : '7일'}`;
  }
}

/* ── Calendar event modal ─────────────────────────────────── */
const calendarEventModal = {
  el: null,
  backdrop: null,
  title: null,
  inputs: null,
  status: null,
  saveBtn: null,
  deleteBtn: null,
  mode: 'create',
  editingId: null,
  editingCalendarId: null
};

function initCalendarEventModal() {
  if (calendarEventModal.el) return;
  calendarEventModal.el = document.getElementById('calendarEventModal');
  calendarEventModal.backdrop = document.getElementById('calendarEventModalBackdrop');
  calendarEventModal.title = document.getElementById('calendarEventModalTitle');
  calendarEventModal.status = document.getElementById('calendarEventModalStatus');
  calendarEventModal.saveBtn = document.getElementById('calendarEventModalSave');
  calendarEventModal.deleteBtn = document.getElementById('calendarEventModalDelete');
  calendarEventModal.inputs = {
    title: document.getElementById('calendarEventTitle'),
    allDay: document.getElementById('calendarEventAllDay'),
    start: document.getElementById('calendarEventStart'),
    end: document.getElementById('calendarEventEnd'),
    location: document.getElementById('calendarEventLocation'),
    calendar: document.getElementById('calendarEventCalendar')
  };

  document.getElementById('calendarEventModalClose').addEventListener('click', closeCalendarEventModal);
  if (calendarEventModal.backdrop) calendarEventModal.backdrop.addEventListener('click', closeCalendarEventModal);
  calendarEventModal.saveBtn.addEventListener('click', submitCalendarEventModal);
  calendarEventModal.deleteBtn.addEventListener('click', deleteCalendarEventFromModal);
  calendarEventModal.inputs.allDay.addEventListener('change', () => {
    applyAllDayMode(calendarEventModal.inputs.allDay.checked);
  });
}

function applyAllDayMode(isAllDay) {
  const startInput = calendarEventModal.inputs.start;
  const endInput = calendarEventModal.inputs.end;
  if (isAllDay) {
    convertInputToType(startInput, 'date');
    convertInputToType(endInput, 'date');
  } else {
    convertInputToType(startInput, 'datetime-local');
    convertInputToType(endInput, 'datetime-local');
  }
}

function convertInputToType(input, type) {
  if (!input || input.type === type) return;
  const oldVal = input.value;
  input.type = type;
  if (type === 'date' && /^\d{4}-\d{2}-\d{2}T/.test(oldVal)) {
    input.value = oldVal.slice(0, 10);
  } else if (type === 'datetime-local' && /^\d{4}-\d{2}-\d{2}$/.test(oldVal)) {
    input.value = `${oldVal}T09:00`;
  }
}

function fillCalendarSelect() {
  const select = calendarEventModal.inputs.calendar;
  select.innerHTML = '';
  if (calendarWritableCalendars.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '편집 가능한 캘린더 없음';
    select.appendChild(opt);
    return;
  }
  for (const cal of calendarWritableCalendars) {
    const opt = document.createElement('option');
    opt.value = cal.id;
    opt.textContent = cal.summary + (cal.primary ? ' (primary)' : '');
    select.appendChild(opt);
  }
  const primary = calendarWritableCalendars.find((c) => c.primary);
  if (primary) select.value = primary.id;
}

function pad2(n) { return String(n).padStart(2, '0'); }

function defaultStartFor(dateKey) {
  const now = new Date();
  const next = new Date(`${dateKey || localDateKey(now)}T${pad2(now.getHours() + 1)}:00`);
  return `${dateKey || localDateKey(now)}T${pad2(next.getHours())}:00`;
}

function openCalendarEventModalForCreate(dateKey) {
  initCalendarEventModal();
  fillCalendarSelect();
  calendarEventModal.mode = 'create';
  calendarEventModal.editingId = null;
  calendarEventModal.editingCalendarId = null;
  calendarEventModal.title.textContent = '새 일정';
  calendarEventModal.deleteBtn.hidden = true;
  calendarEventModal.status.textContent = '';
  calendarEventModal.status.dataset.state = '';
  calendarEventModal.inputs.allDay.checked = false;
  applyAllDayMode(false);
  const startVal = defaultStartFor(dateKey);
  calendarEventModal.inputs.title.value = '';
  calendarEventModal.inputs.location.value = '';
  calendarEventModal.inputs.start.value = startVal;
  const startDate = new Date(startVal);
  startDate.setHours(startDate.getHours() + 1);
  calendarEventModal.inputs.end.value = `${localDateKey(startDate)}T${pad2(startDate.getHours())}:${pad2(startDate.getMinutes())}`;
  showCalendarEventModal();
  calendarEventModal.inputs.title.focus();
}

function openCalendarEventModalForEdit(eventId) {
  const ev = calendarEventsById.get(eventId);
  if (!ev) return;
  if (!ev.writable) {
    if (window.workspacePulse?.openCalendarEvent && ev.htmlLink) {
      window.workspacePulse.openCalendarEvent({ htmlLink: ev.htmlLink }).catch((err) => console.error(err));
    }
    return;
  }
  initCalendarEventModal();
  fillCalendarSelect();
  calendarEventModal.mode = 'edit';
  calendarEventModal.editingId = ev.id;
  calendarEventModal.editingCalendarId = ev.calendarId;
  calendarEventModal.title.textContent = '일정 편집';
  calendarEventModal.deleteBtn.hidden = false;
  calendarEventModal.status.textContent = '';
  calendarEventModal.status.dataset.state = '';
  calendarEventModal.inputs.allDay.checked = !!ev.allDay;
  applyAllDayMode(!!ev.allDay);
  calendarEventModal.inputs.title.value = ev.summary || '';
  calendarEventModal.inputs.location.value = ev.location || '';
  if (ev.allDay) {
    calendarEventModal.inputs.start.value = ev.startRaw?.date || ev.dateKey;
    calendarEventModal.inputs.end.value = ev.endRaw?.date || ev.dateKey;
  } else {
    calendarEventModal.inputs.start.value = (ev.startRaw?.dateTime || '').slice(0, 16);
    calendarEventModal.inputs.end.value = (ev.endRaw?.dateTime || '').slice(0, 16);
  }
  if (calendarEventModal.inputs.calendar.querySelector(`option[value="${ev.calendarId}"]`)) {
    calendarEventModal.inputs.calendar.value = ev.calendarId;
  }
  showCalendarEventModal();
  calendarEventModal.inputs.title.focus();
  calendarEventModal.inputs.title.select();
}

function showCalendarEventModal() {
  calendarEventModal.el.hidden = false;
  if (calendarEventModal.backdrop) calendarEventModal.backdrop.hidden = false;
}

function closeCalendarEventModal() {
  if (!calendarEventModal.el) return;
  calendarEventModal.el.hidden = true;
  if (calendarEventModal.backdrop) calendarEventModal.backdrop.hidden = true;
}

async function submitCalendarEventModal() {
  const summary = calendarEventModal.inputs.title.value.trim();
  if (!summary) {
    calendarEventModal.status.dataset.state = 'error';
    calendarEventModal.status.textContent = '제목을 입력해.';
    return;
  }
  const calendarId = calendarEventModal.inputs.calendar.value;
  if (!calendarId) {
    calendarEventModal.status.dataset.state = 'error';
    calendarEventModal.status.textContent = '캘린더를 선택해.';
    return;
  }
  const allDay = calendarEventModal.inputs.allDay.checked;
  const startVal = calendarEventModal.inputs.start.value;
  const endVal = calendarEventModal.inputs.end.value;
  if (!startVal || !endVal) {
    calendarEventModal.status.dataset.state = 'error';
    calendarEventModal.status.textContent = '시작·종료를 입력해.';
    return;
  }
  let start = startVal;
  let end = endVal;
  if (!allDay) {
    // Google Calendar API requires RFC3339 with timezone offset.
    // datetime-local input has none; widget targets KST users → +09:00.
    start = `${startVal}:00+09:00`;
    end = `${endVal}:00+09:00`;
  }

  const payload = {
    calendarId,
    summary,
    location: calendarEventModal.inputs.location.value.trim(),
    allDay,
    start,
    end,
    timeZone: 'Asia/Seoul'
  };

  calendarEventModal.saveBtn.disabled = true;
  calendarEventModal.status.dataset.state = '';
  calendarEventModal.status.textContent = '저장 중...';

  try {
    let result;
    if (calendarEventModal.mode === 'edit' && calendarEventModal.editingId) {
      result = await window.workspacePulse.updateCalendarEvent({
        ...payload,
        eventId: calendarEventModal.editingId
      });
    } else {
      result = await window.workspacePulse.addCalendarEvent(payload);
    }
    if (!result?.ok) throw new Error(result?.error || '실패');
    closeCalendarEventModal();
    tabCache.calendar = null;
    loadTabData('calendar', { force: true });
  } catch (error) {
    calendarEventModal.status.dataset.state = 'error';
    calendarEventModal.status.textContent = String(error.message || error);
  } finally {
    calendarEventModal.saveBtn.disabled = false;
  }
}

async function deleteCalendarEventFromModal() {
  if (calendarEventModal.mode !== 'edit' || !calendarEventModal.editingId) return;
  if (!confirm('이 일정을 삭제할까?')) return;
  calendarEventModal.deleteBtn.disabled = true;
  calendarEventModal.status.dataset.state = '';
  calendarEventModal.status.textContent = '삭제 중...';
  try {
    const result = await window.workspacePulse.deleteCalendarEvent({
      calendarId: calendarEventModal.editingCalendarId,
      eventId: calendarEventModal.editingId
    });
    if (!result?.ok) throw new Error(result?.error || '삭제 실패');
    closeCalendarEventModal();
    tabCache.calendar = null;
    loadTabData('calendar', { force: true });
  } catch (error) {
    calendarEventModal.status.dataset.state = 'error';
    calendarEventModal.status.textContent = String(error.message || error);
  } finally {
    calendarEventModal.deleteBtn.disabled = false;
  }
}

document.addEventListener('click', (event) => {
  const rangeBtn = event.target.closest('[data-calendar-range]');
  if (rangeBtn) {
    const next = rangeBtn.dataset.calendarRange === 'month' ? 'month' : 'week';
    if (next !== calendarRange) {
      calendarRange = next;
      try { localStorage.setItem(CALENDAR_RANGE_KEY, next); } catch (_) {}
      tabCache.calendar = null;
      loadTabData('calendar', { force: true });
    }
    return;
  }
  const addDayBtn = event.target.closest('[data-calendar-add-day]');
  if (addDayBtn) {
    event.stopPropagation();
    openCalendarEventModalForCreate(addDayBtn.dataset.calendarAddDay);
    return;
  }
  if (event.target.id === 'calendarAddBtn') {
    openCalendarEventModalForCreate(localDateKey(new Date()));
    return;
  }
  const linkBtn = event.target.closest('[data-calendar-event-link]');
  if (linkBtn) {
    event.stopPropagation();
    const ev = calendarEventsById.get(linkBtn.dataset.calendarEventLink);
    if (ev?.htmlLink && window.workspacePulse?.openCalendarEvent) {
      window.workspacePulse.openCalendarEvent({ htmlLink: ev.htmlLink }).catch((err) => console.error(err));
    }
    return;
  }
  const evBtn = event.target.closest('[data-calendar-event-id]');
  if (evBtn) {
    openCalendarEventModalForEdit(evBtn.dataset.calendarEventId);
  }
});

const notionTree = {
  nodesById: new Map(),
  childrenByParent: new Map(),
  roots: [],
  expanded: new Set(),
  loading: new Set(),
  loaded: new Set(),
  errorById: new Map(),
  activeWorkspaceId: ''
};

function notionKindIcon(kind) {
  return kind === 'database' ? '📊' : '📄';
}

function indexNotionNodes(items) {
  for (const item of items) {
    if (!item?.id) continue;
    notionTree.nodesById.set(item.id, item);
  }
}

function buildNotionTreeFromItems(items) {
  notionTree.nodesById = new Map();
  notionTree.childrenByParent = new Map();
  notionTree.roots = [];
  indexNotionNodes(items);

  for (const item of items) {
    const parent = item.parent || { type: 'workspace', id: null };
    const parentId = parent.id;
    if (parent.type === 'workspace' || !parentId || !notionTree.nodesById.has(parentId)) {
      notionTree.roots.push(item.id);
      continue;
    }
    const arr = notionTree.childrenByParent.get(parentId) || [];
    arr.push(item.id);
    notionTree.childrenByParent.set(parentId, arr);
  }
  const sortFn = (aId, bId) => {
    const a = notionTree.nodesById.get(aId);
    const b = notionTree.nodesById.get(bId);
    const aTime = a?.modifiedAt ? new Date(a.modifiedAt).getTime() : 0;
    const bTime = b?.modifiedAt ? new Date(b.modifiedAt).getTime() : 0;
    return bTime - aTime;
  };
  notionTree.roots.sort(sortFn);
  for (const [k, arr] of notionTree.childrenByParent) arr.sort(sortFn);
}

function notionChildIds(parentId) {
  return notionTree.childrenByParent.get(parentId) || [];
}

function renderNotionNode(nodeId, depth) {
  const node = notionTree.nodesById.get(nodeId);
  if (!node) return '';
  const knownKids = notionChildIds(node.id);
  const mayHave = node.hasChildren === true || knownKids.length > 0;
  const isExpanded = notionTree.expanded.has(node.id);
  const isLoading = notionTree.loading.has(node.id);
  const hasLoaded = notionTree.loaded.has(node.id);
  const errorMsg = notionTree.errorById.get(node.id);

  const chevron = mayHave
    ? (isLoading ? '⏳' : (isExpanded ? '▾' : '▸'))
    : '·';
  const chevronClass = mayHave ? 'notion-node__chevron notion-node__chevron--active' : 'notion-node__chevron';

  const childrenHtml = isExpanded
    ? (knownKids.length > 0
        ? knownKids.map((id) => renderNotionNode(id, depth + 1)).join('')
        : (hasLoaded && !errorMsg ? `<div class="notion-node__empty" style="padding-left:${(depth + 1) * 14 + 8}px">(비어있음)</div>` : ''))
    : '';
  const errorHtml = isExpanded && errorMsg
    ? `<div class="notion-node__error" style="padding-left:${(depth + 1) * 14 + 8}px">${escapeHtml(errorMsg)}</div>`
    : '';

  const padLeft = depth * 14;
  const title = escapeHtml(node.title || '?');
  const relMod = node.modifiedAt ? escapeHtml(formatRelative(node.modifiedAt)) : '';

  return `
    <div class="notion-node" data-notion-id="${escapeHtml(node.id)}" data-depth="${depth}">
      <div class="notion-node__row" style="padding-left:${padLeft}px">
        <button type="button" class="${chevronClass}" data-notion-toggle="${escapeHtml(node.id)}" data-notion-kind="${escapeHtml(node.kind || 'page')}" aria-label="toggle">${chevron}</button>
        <span class="notion-node__icon">${notionKindIcon(node.kind)}</span>
        <button type="button" class="notion-node__title" data-notion-url="${escapeHtml(node.url || '')}" title="${escapeHtml(node.url || '')}">${title}</button>
        ${relMod ? `<span class="notion-node__meta">${relMod}</span>` : ''}
      </div>
      ${errorHtml}
      ${childrenHtml}
    </div>`;
}

function renderNotionTree() {
  const container = document.getElementById('notionItems');
  if (!container) return;
  if (notionTree.roots.length === 0) {
    container.innerHTML = `<p class="empty-state">페이지 없음</p>`;
    return;
  }
  container.innerHTML = notionTree.roots.map((id) => renderNotionNode(id, 0)).join('');
}

async function toggleNotionNode(nodeId, kind) {
  const node = notionTree.nodesById.get(nodeId);
  if (!node) return;
  if (notionTree.expanded.has(nodeId)) {
    notionTree.expanded.delete(nodeId);
    renderNotionTree();
    return;
  }
  notionTree.expanded.add(nodeId);
  const hasKnownKids = notionChildIds(nodeId).length > 0;
  const alreadyLoaded = notionTree.loaded.has(nodeId);
  const mayHave = node.hasChildren === true || hasKnownKids;
  if (!mayHave) { renderNotionTree(); return; }
  if (alreadyLoaded || hasKnownKids) {
    // already have some known children from the search results; also lazy-load once to fill in the rest
    if (alreadyLoaded) { renderNotionTree(); return; }
  }
  notionTree.loading.add(nodeId);
  notionTree.errorById.delete(nodeId);
  renderNotionTree();
  try {
    const api = window.workspacePulse;
    const res = api.getNotionChildren ? await api.getNotionChildren({ parentId: nodeId, parentKind: kind || node.kind }) : { items: [], error: 'getNotionChildren 미지원' };
    const fetched = Array.isArray(res?.items) ? res.items : [];
    if (res?.error) notionTree.errorById.set(nodeId, res.error);
    const existing = new Set(notionChildIds(nodeId));
    for (const child of fetched) {
      if (!child?.id) continue;
      notionTree.nodesById.set(child.id, { ...(notionTree.nodesById.get(child.id) || {}), ...child });
      if (!existing.has(child.id)) {
        const arr = notionTree.childrenByParent.get(nodeId) || [];
        arr.push(child.id);
        notionTree.childrenByParent.set(nodeId, arr);
        existing.add(child.id);
      }
    }
    const arr = notionTree.childrenByParent.get(nodeId);
    if (arr) {
      arr.sort((a, b) => {
        const A = notionTree.nodesById.get(a);
        const B = notionTree.nodesById.get(b);
        const at = A?.modifiedAt ? new Date(A.modifiedAt).getTime() : 0;
        const bt = B?.modifiedAt ? new Date(B.modifiedAt).getTime() : 0;
        return bt - at;
      });
    }
    notionTree.loaded.add(nodeId);
  } catch (error) {
    notionTree.errorById.set(nodeId, String(error.message || error));
  } finally {
    notionTree.loading.delete(nodeId);
    renderNotionTree();
  }
}

function renderNotionTab(data) {
  const container = document.getElementById('notionItems');
  const statusEl = document.getElementById('notionStatus');
  const wsSelect = document.getElementById('notionWorkspaceSelect');
  if (!container) return;

  const workspaces = Array.isArray(data?.workspaces) ? data.workspaces : [];
  const activeId = data?.activeWorkspaceId || '';
  if (wsSelect) {
    const prevValue = wsSelect.value;
    wsSelect.innerHTML = workspaces.length === 0
      ? `<option value="">(워크스페이스 없음)</option>`
      : workspaces.map((w) => `<option value="${escapeHtml(w.id)}" ${w.id === activeId ? 'selected' : ''}>${escapeHtml(w.label)}${w.hasToken ? '' : ' ⚠'}</option>`).join('');
    if (prevValue && !wsSelect.value && workspaces.some((w) => w.id === prevValue)) wsSelect.value = prevValue;
  }

  if (notionTree.activeWorkspaceId !== activeId) {
    notionTree.expanded = new Set();
    notionTree.loading = new Set();
    notionTree.loaded = new Set();
    notionTree.errorById = new Map();
    notionTree.activeWorkspaceId = activeId;
  }

  const items = Array.isArray(data?.items) ? data.items : [];
  if (items.length === 0) {
    container.innerHTML = `<p class="empty-state">${data?.error ? escapeHtml(data.error) : (data?.note || '페이지 없음')}</p>`;
  } else {
    buildNotionTreeFromItems(items);
    renderNotionTree();
  }
  if (statusEl) {
    if (data?.error) {
      statusEl.dataset.state = 'error';
      statusEl.textContent = data.error;
    } else {
      statusEl.dataset.state = '';
      const parts = [];
      if (data?.activeWorkspaceLabel) parts.push(`[${data.activeWorkspaceLabel}]`);
      parts.push(`${items.length}개 · 루트 ${notionTree.roots.length}`);
      if (data?.fetchedAt) parts.push(`업데이트 ${formatRelative(data.fetchedAt)}`);
      statusEl.textContent = parts.join(' · ');
    }
  }
}

/* ── Reusable input modal (replacement for window.prompt, which Electron blocks) */
const __inputModal = {
  el: null, backdrop: null, title: null, hint: null, fields: null, status: null,
  submitBtn: null, cancelBtn: null, currentResolver: null
};
function ensureInputModalRefs() {
  if (__inputModal.el) return;
  __inputModal.el = document.getElementById('inputModal');
  __inputModal.backdrop = document.getElementById('inputModalBackdrop');
  __inputModal.title = document.getElementById('inputModalTitle');
  __inputModal.hint = document.getElementById('inputModalHint');
  __inputModal.fields = document.getElementById('inputModalFields');
  __inputModal.status = document.getElementById('inputModalStatus');
  __inputModal.submitBtn = document.getElementById('inputModalSubmit');
  __inputModal.cancelBtn = document.getElementById('inputModalCancel');
  if (!__inputModal.el) return;
  const close = (result) => {
    __inputModal.el.hidden = true;
    if (__inputModal.backdrop) __inputModal.backdrop.hidden = true;
    const r = __inputModal.currentResolver;
    __inputModal.currentResolver = null;
    if (r) r(result);
  };
  __inputModal.cancelBtn.addEventListener('click', () => close(null));
  __inputModal.backdrop.addEventListener('click', () => close(null));
  __inputModal.submitBtn.addEventListener('click', () => {
    const inputs = __inputModal.fields.querySelectorAll('[data-input-key]');
    const result = {};
    for (const inp of inputs) result[inp.dataset.inputKey] = inp.value;
    close(result);
  });
  __inputModal.el.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && ev.target.tagName !== 'TEXTAREA') {
      ev.preventDefault();
      __inputModal.submitBtn.click();
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      close(null);
    }
  });
}
function openInputModal({ title = '입력', hint = '', fields = [] }) {
  ensureInputModalRefs();
  if (!__inputModal.el) return Promise.resolve(null);
  __inputModal.title.textContent = title;
  if (hint) { __inputModal.hint.textContent = hint; __inputModal.hint.hidden = false; }
  else { __inputModal.hint.hidden = true; }
  __inputModal.fields.innerHTML = fields.map((f) => `
    <label class="input-modal__row">
      <span class="input-modal__label">${escapeHtml(f.label || f.key)}</span>
      <input class="input-modal__input" type="${f.type === 'password' ? 'password' : 'text'}" data-input-key="${escapeHtml(f.key)}" placeholder="${escapeHtml(f.placeholder || '')}" value="${escapeHtml(f.value || '')}" />
    </label>`).join('');
  __inputModal.status.textContent = '';
  __inputModal.el.hidden = false;
  __inputModal.backdrop.hidden = false;
  const first = __inputModal.fields.querySelector('[data-input-key]');
  if (first) setTimeout(() => first.focus(), 20);
  return new Promise((resolve) => { __inputModal.currentResolver = resolve; });
}

async function notionWorkspaceCall(payload) {
  if (!window.workspacePulse.notionWorkspaceAction) return null;
  try {
    const result = await window.workspacePulse.notionWorkspaceAction(payload);
    if (!result?.ok) {
      alert(`실패: ${result?.error || 'unknown'}`);
      return null;
    }
    await loadTabData('notion', { force: true });
    return result;
  } catch (error) {
    alert(`에러: ${error.message || error}`);
    return null;
  }
}

(function bindNotionWorkspaceControls() {
  const select = document.getElementById('notionWorkspaceSelect');
  const addBtn = document.getElementById('notionWorkspaceAdd');
  const editBtn = document.getElementById('notionWorkspaceEdit');
  const rmBtn = document.getElementById('notionWorkspaceRemove');
  if (select) {
    select.addEventListener('change', async () => {
      if (!select.value) return;
      await notionWorkspaceCall({ action: 'set-active', id: select.value });
    });
  }
  if (addBtn) {
    addBtn.addEventListener('click', async () => {
      const result = await openInputModal({
        title: 'Notion 워크스페이스 추가',
        hint: '토큰에 "env" 입력 시 NOTION_TOKEN 환경변수를 가져옵니다.',
        fields: [
          { key: 'label', label: '이름', placeholder: '예: 개인 / 회사' },
          { key: 'token', label: '토큰', placeholder: 'ntn_... / secret_... / env', type: 'password' }
        ]
      });
      if (!result) return;
      const label = (result.label || '').trim();
      const token = (result.token || '').trim();
      if (!label || !token) return;
      if (token.toLowerCase() === 'env') {
        await notionWorkspaceCall({ action: 'import-env', label });
      } else {
        await notionWorkspaceCall({ action: 'add', label, token });
      }
    });
  }
  if (editBtn) {
    editBtn.addEventListener('click', async () => {
      if (!select?.value) return;
      const opt = select.options[select.selectedIndex];
      const curLabel = opt?.textContent?.replace(' ⚠', '') || '';
      const result = await openInputModal({
        title: '워크스페이스 편집',
        hint: '이름만 바꾸려면 토큰은 비워두세요. 토큰만 바꾸려면 이름을 그대로 두세요.',
        fields: [
          { key: 'label', label: '이름', value: curLabel },
          { key: 'token', label: '새 토큰 (선택)', placeholder: '비워두면 유지', type: 'password' }
        ]
      });
      if (!result) return;
      const label = (result.label || '').trim();
      const token = (result.token || '').trim();
      if (label && label !== curLabel) {
        await notionWorkspaceCall({ action: 'rename', id: select.value, label });
      }
      if (token) {
        await notionWorkspaceCall({ action: 'replace-token', id: select.value, token });
      }
    });
  }
  if (rmBtn) {
    rmBtn.addEventListener('click', async () => {
      if (!select?.value) return;
      const label = select.options[select.selectedIndex]?.textContent || '';
      if (!window.confirm(`"${label}" 워크스페이스를 삭제할까요?`)) return;
      await notionWorkspaceCall({ action: 'remove', id: select.value });
    });
  }
})();

document.addEventListener('click', async (event) => {
  const toggleBtn = event.target.closest('[data-notion-toggle]');
  if (toggleBtn) {
    event.stopPropagation();
    const id = toggleBtn.dataset.notionToggle;
    const kind = toggleBtn.dataset.notionKind || 'page';
    await toggleNotionNode(id, kind);
    return;
  }
  const target = event.target.closest('[data-notion-url]');
  if (!target) return;
  const url = target.dataset.notionUrl;
  if (!url || !window.workspacePulse.openNotionPage) return;
  try { await window.workspacePulse.openNotionPage({ url }); }
  catch (error) { console.error('open notion', error); }
});

const PROJECT_CATEGORY_ORDER = ['AI', 'Web', 'MCP', 'Bot', 'Game', 'Tool', 'Infra', 'Etc'];
let projectsShowArchive = false;

function activityTagOf(p) {
  const iso = p.lastOpenedAt || p.lastCommitAt;
  if (!iso) return 'dormant';
  const age = (Date.now() - new Date(iso).getTime()) / 86400000;
  if (p.dirty > 0 || age <= 7) return 'active';
  if (age <= 30) return 'recent';
  return 'dormant';
}

function sortProjects(items, mode) {
  const copy = items.slice();
  if (mode === 'name') {
    copy.sort((a, b) => a.name.localeCompare(b.name));
  } else if (mode === 'dirty') {
    copy.sort((a, b) => (b.dirty || 0) - (a.dirty || 0) || ((new Date(b.sortKey || 0)) - (new Date(a.sortKey || 0))));
  } else if (mode === 'roadmap') {
    copy.sort((a, b) => (b.roadmapPercent ?? -1) - (a.roadmapPercent ?? -1));
  } else {
    copy.sort((a, b) => (new Date(b.sortKey || 0)) - (new Date(a.sortKey || 0)));
  }
  return copy;
}

function normalizeCategory(cat) {
  if (!cat) return 'Etc';
  const hit = PROJECT_CATEGORY_ORDER.find((c) => c.toLowerCase() === cat.toLowerCase());
  return hit || cat;
}

function renderProjectsTab(data) {
  const container = document.getElementById('projectsItems');
  const statusEl = document.getElementById('projectsStatus');
  const filterInput = document.getElementById('projectsFilter');
  const sortSelect = document.getElementById('projectsSort');
  if (!container) return;
  const items = Array.isArray(data?.items) ? data.items : [];
  const filter = (filterInput?.value || '').trim().toLowerCase();
  const sortMode = sortSelect?.value || 'recent';
  const archivedCount = items.filter((p) => p.archive).length;
  const visible = items.filter((p) => projectsShowArchive ? true : !p.archive);
  const filtered = filter ? visible.filter((it) => (it.name + ' ' + (it.desc || '')).toLowerCase().includes(filter)) : visible;
  window.__lastProjectList = filtered;

  const buildRow = (p, idx) => {
    const badges = [];
    if (p.dirty > 0) badges.push(`<span class="project-row__badge" data-kind="dirty" title="${p.dirty} uncommitted">●${p.dirty}</span>`);
    if (Array.isArray(p.worktrees) && p.worktrees.length > 0) {
      badges.push(`<span class="project-row__badge" data-kind="wt" title="${p.worktrees.length}개 worktree">⌥ ${p.worktrees.length}</span>`);
    }
    const rel = formatRelative(p.sortKey);
    const encPath = escapeHtml(p.path || '');
    const desc = p.desc ? `<span class="project-row__desc"> — ${escapeHtml(p.desc)}</span>` : '';
    const pinTitle = p.pin ? '핀 해제' : '핀 고정';
    const pinValue = p.pin ? 'off' : 'on';
    return `
      <div class="project-row ${p.archive ? 'is-archive' : ''}" data-project-index="${idx}" data-project-path="${encPath}" title="${encPath}">
        <button class="project-row__pin ${p.pin ? 'is-pinned' : ''}" data-project-meta="pin" data-name="${escapeHtml(p.name)}" data-value="${pinValue}" type="button" title="${pinTitle}" aria-label="${pinTitle}">${p.pin ? '★' : '☆'}</button>
        <div class="project-row__name">${escapeHtml(p.name)}${desc}</div>
        <div class="project-row__meta">
          ${badges.join('')}
          <span>${escapeHtml(rel)}</span>
          <button class="project-row__action" data-project-action="folder" data-path="${encPath}" type="button" title="탐색기에서 열기">📁</button>
          <button class="project-row__action" data-project-action="terminal" data-path="${encPath}" type="button" title="Windows Terminal로 열기">▸_</button>
        </div>
      </div>`;
  };

  const renderSection = (label, list, keyAttr) => {
    const sorted = sortProjects(list, sortMode);
    const rowsHtml = sorted.map((p) => buildRow(p, filtered.indexOf(p))).join('');
    return `
      <div class="project-category" data-cat-key="${escapeHtml(keyAttr)}">
        <div class="project-category__head">${escapeHtml(label)} <span class="project-category__count">${sorted.length}</span></div>
        ${rowsHtml}
      </div>`;
  };

  if (filtered.length === 0) {
    container.innerHTML = `<p class="empty-state">${items.length === 0 ? '프로젝트를 찾을 수 없습니다.' : '필터 결과 없음.'}</p>`;
  } else {
    const sections = [];
    const pinned = filtered.filter((p) => p.pin && !p.archive);
    if (pinned.length > 0) sections.push(renderSection('⭐ Pinned', pinned, 'pinned'));

    const grouped = new Map();
    for (const p of filtered) {
      if (p.pin && !p.archive) continue;
      if (p.archive) continue;
      const key = normalizeCategory(p.cat);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(p);
    }
    for (const cat of PROJECT_CATEGORY_ORDER) {
      if (!grouped.has(cat)) continue;
      sections.push(renderSection(cat, grouped.get(cat), cat));
      grouped.delete(cat);
    }
    for (const [cat, list] of grouped) {
      sections.push(renderSection(cat, list, cat));
    }

    if (projectsShowArchive) {
      const arc = filtered.filter((p) => p.archive);
      if (arc.length > 0) sections.push(renderSection('🗄 Archive', arc, 'archive'));
    }
    container.innerHTML = sections.join('');
  }
  if (statusEl) {
    const parts = [`${items.length}개 프로젝트`];
    if (data?.scannedAt) parts.push(`업데이트 ${formatRelative(data.scannedAt)}`);
    if (data?.error) { statusEl.dataset.state = 'error'; parts.push(data.error); }
    else statusEl.dataset.state = '';
    const archiveToggleLabel = projectsShowArchive
      ? `아카이브 숨기기`
      : `아카이브 ${archivedCount}개 보기`;
    statusEl.innerHTML = `<span>${escapeHtml(parts.join(' · '))}</span>${archivedCount > 0 ? ` · <a href="#" id="projectsArchiveToggle" class="panel-status__link">${escapeHtml(archiveToggleLabel)}</a>` : ''}`;
    const toggleLink = document.getElementById('projectsArchiveToggle');
    if (toggleLink) {
      toggleLink.addEventListener('click', (ev) => {
        ev.preventDefault();
        projectsShowArchive = !projectsShowArchive;
        if (tabCache.projects) renderProjectsTab(tabCache.projects.data);
      });
    }
  }
  if (filterInput && !filterInput.dataset.bound) {
    filterInput.dataset.bound = 'true';
    filterInput.addEventListener('input', () => {
      if (tabCache.projects) renderProjectsTab(tabCache.projects.data);
    });
  }
  if (sortSelect && !sortSelect.dataset.bound) {
    sortSelect.dataset.bound = 'true';
    sortSelect.addEventListener('change', () => {
      if (tabCache.projects) renderProjectsTab(tabCache.projects.data);
    });
  }
}

function renderContentTab(data) {
  const cron = Array.isArray(data?.cron) ? data.cron : [];
  const recent = Array.isArray(data?.recent) ? data.recent : [];
  const queue = Array.isArray(data?.queue) ? data.queue : [];
  const statusEl = document.getElementById('contentStatus');
  const cloudContent = getDesktopContentCandidatesFromState();
  const cronContainer = document.getElementById('contentCronItems');
  const cronCount = document.getElementById('contentCronCount');
  if (cronCount) cronCount.textContent = cron.length ? `(${cron.length})` : '';
  if (cronContainer) {
    if (cron.length === 0) {
      cronContainer.innerHTML = `<p class="empty-state">비어 있음</p>`;
    } else {
      cronContainer.innerHTML = cron.map((it, idx) => {
        const parts = [];
        if (it.schedule) parts.push(`⏱ ${it.schedule}`);
        if (it.nextRunAt) parts.push(`next ${formatRelative(it.nextRunAt)}`);
        if (it.deliveryChannel) parts.push(`→ ${it.deliveryChannel}`);
        if (it.enabled === false) parts.push('disabled');
        if (it.consecutiveErrors > 0) parts.push(`err×${it.consecutiveErrors}`);
        const title = `${it.enabled === false ? '⏸ ' : ''}${it.name || it.id || '?'}`;
        const meta = it.lastRunAt ? `last ${formatRelative(it.lastRunAt)}` : '';
        const statusBadge = it.lastStatus
          ? `<span class="entry-row__status" data-state="${escapeHtml(statusStateOf(it.lastStatus))}">${escapeHtml(it.lastStatus)}</span>`
          : '';
        return `
          <div class="entry-row entry-row--clickable" data-cron-index="${idx}">
            <div class="entry-row__head">
              <div class="entry-row__title">${escapeHtml(title)}</div>
              <div class="entry-row__meta">${statusBadge}<span>${escapeHtml(meta)}</span></div>
            </div>
            <div class="entry-row__detail">${escapeHtml(parts.join(' · '))}</div>
          </div>`;
      }).join('');
    }
  }
  window.__lastCronList = cron;
  renderEntryList('contentRecentItems', 'contentRecentCount', recent, (it) => ({
    title: it.title || it.name || '?',
    detail: it.platform || it.type || '',
    meta: it.createdAt ? formatRelative(it.createdAt) : '',
    status: it.status
  }));
  renderEntryList('contentQueueItems', 'contentQueueCount', queue, (it) => ({
    title: it.title || it.name || '?',
    detail: it.stage || '',
    meta: it.queuedAt ? formatRelative(it.queuedAt) : '',
    status: it.status
  }));
  renderEntryList('contentCloudItems', 'contentCloudCount', cloudContent, (it) => ({
    title: it.title || it.text || '?',
    detail: [it.projectName, it.projectMilestoneName].filter(Boolean).join(' · ') || it.detail || 'task 기반 content work',
    meta: [labelForSourceKey(it.sourceKey), it.cloudStatus || it.status].filter(Boolean).join(' · '),
    status: it.cloudStatus || it.status
  }));
  if (statusEl) {
    if (data?.error) { statusEl.dataset.state = 'error'; statusEl.textContent = data.error; }
    else {
      statusEl.dataset.state = '';
      statusEl.textContent = data?.fetchedAt ? `업데이트 ${formatRelative(data.fetchedAt)}` : '';
    }
  }
}

function labelForSourceKey(sourceKey) {
  if (sourceKey === 'today') return 'Today';
  if (sourceKey === 'deadline') return 'Deadlines';
  if (sourceKey === 'backlog') return 'Backlog';
  return sourceKey || '';
}

function getDesktopContentCandidatesFromState() {
  const overview = window.__workspacePulseState?.today?.commandOverview;
  if (Array.isArray(overview?.contentCandidates)) return overview.contentCandidates;
  return [];
}

const VAULT_FOLDER_KEYS = ['inbox', 'resources', 'areas', 'projects', 'logs', 'archives'];
const VAULT_FOLDER_LABELS = { inbox: '05-Inbox', resources: '10-Resources', areas: '20-Areas', projects: '30-Projects', logs: '40-Logs', archives: '90-Archives' };

const vaultTreeState = {
  expanded: new Set() // keys like "projects::my-app/docs"
};

function buildVaultRow(it, folderKey) {
  const title = it.title || it.name || '?';
  const subtitle = it.title && it.name && it.title !== it.name ? it.name : '';
  const sizeKb = it.size ? `${Math.max(1, Math.round(it.size / 1024))}KB` : '';
  const meta = [sizeKb, it.modifiedAt ? formatRelative(it.modifiedAt) : ''].filter(Boolean).join(' · ');
  const folderBadge = folderKey
    ? `<span class="entry-row__status" data-state="ok">${escapeHtml(VAULT_FOLDER_LABELS[folderKey] || folderKey)}</span>`
    : '';
  const subpath = it.relPath && it.relPath !== it.name ? it.relPath.replace(/\/[^/]+$/, '') : '';
  const detail = subtitle || subpath;
  return `
    <div class="entry-row entry-row--clickable" data-vault-open="${escapeHtml(it.path)}" title="${escapeHtml(it.path)}">
      <div class="entry-row__head">
        <div class="entry-row__title">${escapeHtml(title)}</div>
        <div class="entry-row__meta">${folderBadge}<span>${escapeHtml(meta)}</span></div>
      </div>
      ${detail ? `<div class="entry-row__detail">${escapeHtml(detail)}</div>` : ''}
    </div>`;
}

function buildVaultTree(items) {
  const root = { dirs: new Map(), files: [] };
  for (const item of items) {
    const rel = item.relPath || item.name || '';
    const segs = rel.split('/').filter(Boolean);
    if (segs.length === 0) continue;
    let node = root;
    for (let i = 0; i < segs.length - 1; i++) {
      const seg = segs[i];
      if (!node.dirs.has(seg)) {
        node.dirs.set(seg, { name: seg, dirs: new Map(), files: [] });
      }
      node = node.dirs.get(seg);
    }
    node.files.push(item);
  }
  return root;
}

function renderVaultTreeNode(node, folderKey, pathPrefix, depth) {
  const parts = [];
  const dirNames = Array.from(node.dirs.keys()).sort((a, b) => a.localeCompare(b));
  for (const name of dirNames) {
    const child = node.dirs.get(name);
    const dirKey = `${folderKey}::${pathPrefix ? `${pathPrefix}/${name}` : name}`;
    const expanded = vaultTreeState.expanded.has(dirKey);
    const fileCount = countVaultFiles(child);
    const padLeft = depth * 14;
    parts.push(`
      <div class="vault-node vault-node--dir">
        <div class="vault-node__row" style="padding-left:${padLeft}px">
          <button type="button" class="vault-node__chevron vault-node__chevron--active" data-vault-dir-toggle="${escapeHtml(dirKey)}" aria-label="toggle">${expanded ? '▾' : '▸'}</button>
          <span class="vault-node__icon">📁</span>
          <span class="vault-node__label">${escapeHtml(name)}</span>
          <span class="vault-node__count">${fileCount}</span>
        </div>
        ${expanded ? renderVaultTreeNode(child, folderKey, pathPrefix ? `${pathPrefix}/${name}` : name, depth + 1) : ''}
      </div>`);
  }
  const files = node.files.slice().sort((a, b) => {
    const an = a.title || a.name || '';
    const bn = b.title || b.name || '';
    return an.localeCompare(bn, 'ko');
  });
  for (const file of files) {
    const padLeft = depth * 14;
    const stripped = String(file.name || '').replace(/\.(md|canvas)$/i, '');
    const title = file.title || stripped || '?';
    const rel = formatRelative(file.modifiedAt);
    parts.push(`
      <div class="vault-node vault-node--file" data-vault-open="${escapeHtml(file.path)}" title="${escapeHtml(file.path)}">
        <div class="vault-node__row" style="padding-left:${padLeft}px">
          <span class="vault-node__chevron">·</span>
          <span class="vault-node__icon">📄</span>
          <span class="vault-node__label">${escapeHtml(title)}</span>
          ${rel ? `<span class="vault-node__meta">${escapeHtml(rel)}</span>` : ''}
        </div>
      </div>`);
  }
  return parts.join('');
}

function countVaultFiles(node) {
  let n = node.files.length;
  for (const child of node.dirs.values()) n += countVaultFiles(child);
  return n;
}

function renderVaultTab(data) {
  const statusEl = document.getElementById('vaultStatus');
  const searchInput = document.getElementById('vaultSearch');
  const searchResults = document.getElementById('vaultSearchResults');
  const folders = data?.folders || {};
  const query = (searchInput?.value || '').trim().toLowerCase();

  const folderSections = document.querySelectorAll('#panel-vault .schedule-section');

  if (query) {
    folderSections.forEach((el) => { el.hidden = true; });
    if (searchResults) {
      searchResults.hidden = false;
      const hits = [];
      for (const key of VAULT_FOLDER_KEYS) {
        const items = Array.isArray(folders[key]?.items) ? folders[key].items : [];
        for (const it of items) {
          const haystack = `${it.title || ''} ${it.name || ''} ${it.path || ''}`.toLowerCase();
          if (haystack.includes(query)) hits.push({ item: it, folderKey: key });
        }
      }
      hits.sort((a, b) => {
        const ta = a.item.modifiedAt ? new Date(a.item.modifiedAt).getTime() : 0;
        const tb = b.item.modifiedAt ? new Date(b.item.modifiedAt).getTime() : 0;
        return tb - ta;
      });
      searchResults.innerHTML = hits.length === 0
        ? `<p class="empty-state">검색 결과 없음</p>`
        : hits.map(({ item, folderKey }) => buildVaultRow(item, folderKey)).join('');
    }
  } else {
    folderSections.forEach((el) => { el.hidden = false; });
    if (searchResults) { searchResults.hidden = true; searchResults.innerHTML = ''; }
    for (const key of VAULT_FOLDER_KEYS) {
      const folder = folders[key] || { items: [] };
      const container = document.querySelector(`[data-vault-items="${key}"]`);
      const countEl = document.querySelector(`[data-vault-count="${key}"]`);
      if (!container) continue;
      const items = Array.isArray(folder.items) ? folder.items : [];
      if (countEl) countEl.textContent = items.length ? `(${items.length})` : '';
      if (items.length === 0) {
        container.innerHTML = `<p class="empty-state">비어 있음</p>`;
        continue;
      }
      const tree = buildVaultTree(items);
      container.innerHTML = renderVaultTreeNode(tree, key, '', 0) || `<p class="empty-state">비어 있음</p>`;
    }
  }

  if (statusEl) {
    if (data?.error) { statusEl.dataset.state = 'error'; statusEl.textContent = data.error; }
    else {
      statusEl.dataset.state = '';
      const parts = [];
      if (query) {
        const hitCount = searchResults?.querySelectorAll('[data-vault-open]').length || 0;
        parts.push(`검색 "${query}" · ${hitCount}건`);
      }
      if (data?.fetchedAt) parts.push(`업데이트 ${formatRelative(data.fetchedAt)}`);
      if (data?.syncStatus) parts.push(`sync: ${data.syncStatus}`);
      statusEl.textContent = parts.join(' · ');
    }
  }

  if (searchInput && !searchInput.dataset.bound) {
    searchInput.dataset.bound = 'true';
    searchInput.addEventListener('input', () => {
      if (tabCache.vault) renderVaultTab(tabCache.vault.data);
    });
  }
}

function applyProjectPatchOptimistic(name, patch) {
  const cache = tabCache.projects;
  const items = cache?.data?.items;
  if (!Array.isArray(items)) return null;
  const proj = items.find((p) => p.name === name);
  if (!proj) return null;
  const prev = {};
  for (const k of Object.keys(patch)) prev[k] = proj[k];
  Object.assign(proj, patch);
  renderProjectsTab(cache.data);
  return { proj, prev };
}

async function commitProjectPatch(name, patch) {
  const optimistic = applyProjectPatchOptimistic(name, patch);
  try {
    const res = await window.workspacePulse.updateProjectMeta({ name, patch });
    if (!res?.ok) throw new Error(res?.error || 'updateProjectMeta 실패');
  } catch (error) {
    console.error('project meta', error);
    if (optimistic) {
      Object.assign(optimistic.proj, optimistic.prev);
      renderProjectsTab(tabCache.projects.data);
    }
    alert(`실패: ${error.message || error}`);
  }
}

document.addEventListener('click', async (event) => {
  const metaBtn = event.target.closest('[data-project-meta]');
  if (metaBtn) {
    event.stopPropagation();
    const kind = metaBtn.dataset.projectMeta;
    const name = metaBtn.dataset.name;
    if (!name || !window.workspacePulse.updateProjectMeta) return;
    if (kind === 'pin') {
      const next = metaBtn.dataset.value === 'on';
      commitProjectPatch(name, { pin: next });
      return;
    }
    if (kind === 'archive') {
      const next = metaBtn.dataset.value === 'on';
      commitProjectPatch(name, { archive: next });
      return;
    }
    if (kind === 'edit') {
      const curDesc = metaBtn.dataset.curDesc || '';
      const curCat = metaBtn.dataset.curCat || '';
      const result = await openInputModal({
        title: `[${name}] 편집`,
        fields: [
          { key: 'desc', label: '설명', value: curDesc },
          { key: 'cat', label: '카테고리', value: curCat, placeholder: 'AI/Web/MCP/Bot/Game/Tool/Infra/Etc' }
        ]
      });
      if (!result) return;
      commitProjectPatch(name, { desc: result.desc ?? curDesc, cat: result.cat ?? curCat });
      return;
    }
    return;
  }
  const actionBtn = event.target.closest('[data-project-action]');
  if (actionBtn) {
    event.stopPropagation();
    const action = actionBtn.dataset.projectAction;
    const path = actionBtn.dataset.path;
    if (!path || !window.workspacePulse.openProjectAction) return;
    actionBtn.disabled = true;
    try {
      const result = await window.workspacePulse.openProjectAction({ path, action });
      if (!result?.ok) console.error('project action failed', result?.error);
    } catch (error) {
      console.error('project action', error);
    } finally {
      actionBtn.disabled = false;
    }
    return;
  }
});

/* ── Vault preview modal + minimal markdown renderer ─────── */
const vaultPreview = {
  currentPath: '',
  rawContent: '',
  showRaw: false,
  meta: null
};

function mdInline(text) {
  let s = escapeHtml(text);
  // fenced inline code `...`
  s = s.replace(/`([^`\n]+)`/g, (_, c) => `<code>${c}</code>`);
  // images ![alt](src) — attachments live on M4, show as placeholder
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, url) => {
    const label = alt || (url.split('/').pop() || 'image');
    return `<span class="md-img">[🖼 ${escapeHtml(label)}]</span>`;
  });
  // links [text](url) — clickable, opens externally
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, url) => {
    const safeUrl = url.replace(/"/g, '&quot;');
    return `<a data-md-link="${safeUrl}" title="${safeUrl}">${text}</a>`;
  });
  // Obsidian wikilinks [[...]]
  s = s.replace(/\[\[([^\]]+)\]\]/g, (_, t) => `<span class="md-wiki">[[${t}]]</span>`);
  // bold **...**
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  // italic *...* (single-line)
  s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  // strikethrough ~~...~~
  s = s.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
  return s;
}

function renderMarkdown(mdRaw) {
  if (!mdRaw) return '<p class="empty-state">(비어있음)</p>';
  // strip YAML frontmatter
  let md = mdRaw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  const lines = md.split(/\r?\n/);
  const out = [];
  let i = 0;
  let paraBuf = [];
  let listType = null;
  const flushPara = () => {
    if (paraBuf.length) {
      out.push(`<p>${mdInline(paraBuf.join(' '))}</p>`);
      paraBuf = [];
    }
  };
  const flushList = () => {
    if (listType) { out.push(`</${listType}>`); listType = null; }
  };

  while (i < lines.length) {
    const line = lines[i];

    // fenced code block
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      flushPara(); flushList();
      const lang = fence[1] || '';
      const buf = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++;
      const langAttr = lang ? ` data-lang="${escapeHtml(lang)}"` : '';
      out.push(`<pre class="md-pre"${langAttr}><code>${escapeHtml(buf.join('\n'))}</code></pre>`);
      continue;
    }

    // blank line
    if (!line.trim()) { flushPara(); flushList(); i++; continue; }

    // heading
    const h = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (h) {
      flushPara(); flushList();
      const level = h[1].length;
      out.push(`<h${level}>${mdInline(h[2])}</h${level}>`);
      i++; continue;
    }

    // hr
    if (/^(\-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushPara(); flushList();
      out.push('<hr/>');
      i++; continue;
    }

    // blockquote
    if (/^>\s?/.test(line)) {
      flushPara(); flushList();
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      out.push(`<blockquote>${mdInline(buf.join(' '))}</blockquote>`);
      continue;
    }

    // task list / unordered list
    const taskMatch = line.match(/^\s*[-*+]\s+\[([ xX])\]\s+(.+)$/);
    if (taskMatch) {
      flushPara();
      if (listType !== 'ul') { flushList(); listType = 'ul'; out.push('<ul class="md-tasks">'); }
      const done = taskMatch[1].toLowerCase() === 'x';
      out.push(`<li class="md-task${done ? ' md-task--done' : ''}"><span class="md-checkbox">${done ? '☑' : '☐'}</span> ${mdInline(taskMatch[2])}</li>`);
      i++; continue;
    }
    const ulMatch = line.match(/^\s*[-*+]\s+(.+)$/);
    if (ulMatch) {
      flushPara();
      if (listType !== 'ul') { flushList(); listType = 'ul'; out.push('<ul>'); }
      out.push(`<li>${mdInline(ulMatch[1])}</li>`);
      i++; continue;
    }
    const olMatch = line.match(/^\s*\d+\.\s+(.+)$/);
    if (olMatch) {
      flushPara();
      if (listType !== 'ol') { flushList(); listType = 'ol'; out.push('<ol>'); }
      out.push(`<li>${mdInline(olMatch[1])}</li>`);
      i++; continue;
    }

    // accumulate paragraph
    flushList();
    paraBuf.push(line);
    i++;
  }
  flushPara(); flushList();
  return out.join('\n') || '<p class="empty-state">(비어있음)</p>';
}

function vaultPreviewElements() {
  return {
    modal: document.getElementById('vaultPreviewModal'),
    backdrop: document.getElementById('vaultPreviewBackdrop'),
    title: document.getElementById('vaultPreviewTitle'),
    meta: document.getElementById('vaultPreviewMeta'),
    body: document.getElementById('vaultPreviewBody'),
    status: document.getElementById('vaultPreviewStatus'),
    close: document.getElementById('vaultPreviewClose'),
    toggle: document.getElementById('vaultPreviewToggle')
  };
}

function renderVaultPreviewBody() {
  const { body, toggle } = vaultPreviewElements();
  if (!body) return;
  if (vaultPreview.showRaw) {
    body.innerHTML = `<pre class="md-raw">${escapeHtml(vaultPreview.rawContent || '')}</pre>`;
    if (toggle) toggle.textContent = 'rendered';
  } else {
    body.innerHTML = `<div class="md-rendered">${renderMarkdown(vaultPreview.rawContent || '')}</div>`;
    if (toggle) toggle.textContent = 'raw';
  }
}

function closeVaultPreview() {
  const el = vaultPreviewElements();
  if (el.modal) el.modal.hidden = true;
  if (el.backdrop) el.backdrop.hidden = true;
}

async function openVaultPreview(path) {
  const el = vaultPreviewElements();
  if (!el.modal) return;
  vaultPreview.currentPath = path;
  vaultPreview.rawContent = '';
  vaultPreview.showRaw = false;
  const fileName = path.split('/').pop() || path;
  if (el.title) el.title.textContent = fileName;
  if (el.meta) el.meta.textContent = path;
  if (el.body) el.body.innerHTML = `<p class="empty-state">불러오는 중...</p>`;
  if (el.status) { el.status.dataset.state = ''; el.status.textContent = ''; }
  el.modal.hidden = false;
  el.backdrop.hidden = false;
  try {
    const api = window.workspacePulse;
    const res = api.readVaultNote ? await api.readVaultNote({ path }) : { ok: false, error: 'readVaultNote 미지원' };
    if (!res?.ok) {
      if (el.body) el.body.innerHTML = `<p class="empty-state">읽기 실패: ${escapeHtml(res?.error || 'unknown')}</p>`;
      return;
    }
    vaultPreview.rawContent = res.content || '';
    renderVaultPreviewBody();
    if (el.status) {
      const parts = [];
      if (res.totalBytes != null) parts.push(`${Math.round(res.totalBytes / 1024) || 1}KB`);
      if (res.truncated) parts.push('⚠ 512KB 이상: 앞부분만 표시');
      el.status.textContent = parts.join(' · ');
    }
  } catch (error) {
    if (el.body) el.body.innerHTML = `<p class="empty-state">에러: ${escapeHtml(error.message || String(error))}</p>`;
  }
}

(function bindVaultPreviewControls() {
  const el = vaultPreviewElements();
  if (!el.modal) return;
  if (el.close) el.close.addEventListener('click', closeVaultPreview);
  if (el.backdrop) el.backdrop.addEventListener('click', closeVaultPreview);
  if (el.toggle) el.toggle.addEventListener('click', () => {
    vaultPreview.showRaw = !vaultPreview.showRaw;
    renderVaultPreviewBody();
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !el.modal.hidden) closeVaultPreview();
  });
})();

document.addEventListener('click', async (event) => {
  const linkEl = event.target.closest('[data-md-link]');
  if (linkEl) {
    event.preventDefault();
    const url = linkEl.dataset.mdLink;
    if (/^https?:\/\//i.test(url) && window.workspacePulse.openNotionPage) {
      try { await window.workspacePulse.openNotionPage({ url }); }
      catch (err) { console.error('open md link', err); }
    }
    return;
  }
  const dirToggle = event.target.closest('[data-vault-dir-toggle]');
  if (dirToggle) {
    event.stopPropagation();
    const key = dirToggle.dataset.vaultDirToggle;
    if (vaultTreeState.expanded.has(key)) vaultTreeState.expanded.delete(key);
    else vaultTreeState.expanded.add(key);
    if (tabCache.vault) renderVaultTab(tabCache.vault.data);
    return;
  }
  const target = event.target.closest('[data-vault-open]');
  if (!target) return;
  const path = target.dataset.vaultOpen;
  if (!path) return;
  await openVaultPreview(path);
});

function renderEntryList(containerId, countId, items, transform) {
  const container = document.getElementById(containerId);
  const countEl = document.getElementById(countId);
  if (!container) return;
  if (countEl) countEl.textContent = items.length ? `(${items.length})` : '';
  if (items.length === 0) {
    container.innerHTML = `<p class="empty-state">비어 있음</p>`;
    return;
  }
  container.innerHTML = items.map((item) => {
    const t = transform(item);
    const statusBadge = t.status ? `<span class="entry-row__status" data-state="${escapeHtml(statusStateOf(t.status))}">${escapeHtml(t.status)}</span>` : '';
    return `
      <div class="entry-row">
        <div class="entry-row__head">
          <div class="entry-row__title">${escapeHtml(t.title)}</div>
          <div class="entry-row__meta">${statusBadge}<span>${escapeHtml(t.meta)}</span></div>
        </div>
        ${t.detail ? `<div class="entry-row__detail">${escapeHtml(t.detail)}</div>` : ''}
      </div>`;
  }).join('');
}

function statusStateOf(s) {
  const v = String(s || '').toLowerCase();
  if (/(ok|success|done|published)/.test(v)) return 'ok';
  if (/(fail|error|blocked)/.test(v)) return 'error';
  if (/(warn|pending|queued|running)/.test(v)) return 'warn';
  return 'ok';
}

setActiveTab(initialTab);

/* ── Cron detail modal ─────────────────────────────────────── */
const cronModal = document.getElementById('cronModal');
const cronModalBackdrop = document.getElementById('cronModalBackdrop');
const cronModalTitle = document.getElementById('cronModalTitle');
const cronModalMeta = document.getElementById('cronModalMeta');
const cronModalPayload = document.getElementById('cronModalPayload');
const cronModalClose = document.getElementById('cronModalClose');
const cronModalRun = document.getElementById('cronModalRun');
const cronModalStatus = document.getElementById('cronModalStatus');
let cronModalCurrentId = null;

function openCronModal(job) {
  if (!cronModal || !job) return;
  cronModalCurrentId = job.id;
  if (cronModalTitle) cronModalTitle.textContent = job.name || job.id || 'Cron Job';
  if (cronModalMeta) {
    const metaRows = [
      ['id', job.id || ''],
      ['enabled', String(job.enabled !== false)],
      ['schedule', `${job.schedule || ''}${job.tz ? ` (${job.tz})` : ''}`],
      ['next run', job.nextRunAt ? `${formatRelative(job.nextRunAt)} · ${new Date(job.nextRunAt).toLocaleString()}` : '-'],
      ['last run', job.lastRunAt ? `${formatRelative(job.lastRunAt)} · ${job.lastStatus || ''} · ${job.lastDurationMs ? Math.round(job.lastDurationMs / 1000) + 's' : ''}` : '-'],
      ['target', [job.target, job.wakeMode].filter(Boolean).join(' · ')],
      ['delivery', [job.deliveryMode, job.deliveryChannel, job.accountId, job.deliveryTo].filter(Boolean).join(' · ') || '-'],
      ['payload kind', job.payloadKind || '-'],
      ['timeout', job.payloadTimeoutSeconds ? `${job.payloadTimeoutSeconds}s` : '-']
    ];
    if (job.description) metaRows.push(['description', job.description]);
    if (job.consecutiveErrors > 0) metaRows.push(['errors', `연속 ${job.consecutiveErrors}회`]);
    cronModalMeta.innerHTML = metaRows
      .map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(String(v))}</dd>`)
      .join('');
  }
  if (cronModalPayload) {
    cronModalPayload.textContent = job.payloadMessage || '(payload 없음)';
  }
  if (cronModalStatus) { cronModalStatus.dataset.state = ''; cronModalStatus.textContent = ''; }
  if (cronModalRun) {
    cronModalRun.disabled = false;
    cronModalRun.textContent = '즉시 실행';
  }
  cronModal.hidden = false;
  if (cronModalBackdrop) cronModalBackdrop.hidden = false;
}

function closeCronModal() {
  cronModalCurrentId = null;
  if (cronModal) cronModal.hidden = true;
  if (cronModalBackdrop) cronModalBackdrop.hidden = true;
}

if (cronModalClose) cronModalClose.addEventListener('click', closeCronModal);
if (cronModalBackdrop) cronModalBackdrop.addEventListener('click', closeCronModal);

document.addEventListener('click', (event) => {
  const row = event.target.closest('[data-cron-index]');
  if (!row) return;
  const idx = Number(row.dataset.cronIndex);
  const cron = window.__lastCronList || [];
  const job = cron[idx];
  if (job) openCronModal(job);
});

if (cronModalRun) {
  cronModalRun.addEventListener('click', async () => {
    if (!cronModalCurrentId || !window.workspacePulse.runCronJob) return;
    cronModalRun.disabled = true;
    cronModalRun.textContent = '실행 중...';
    if (cronModalStatus) {
      cronModalStatus.dataset.state = 'running';
      cronModalStatus.textContent = '실행 요청 전송...';
    }
    try {
      const result = await window.workspacePulse.runCronJob({ id: cronModalCurrentId });
      if (result?.ok) {
        if (cronModalStatus) {
          cronModalStatus.dataset.state = 'ok';
          cronModalStatus.textContent = '요청 완료. Content 탭 Refresh로 결과 확인.';
        }
      } else {
        if (cronModalStatus) {
          cronModalStatus.dataset.state = 'error';
          cronModalStatus.textContent = result?.error || '실행 실패';
        }
      }
    } catch (error) {
      if (cronModalStatus) {
        cronModalStatus.dataset.state = 'error';
        cronModalStatus.textContent = String(error.message || error);
      }
    } finally {
      cronModalRun.disabled = false;
      cronModalRun.textContent = '다시 실행';
    }
  });
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && cronModal && !cronModal.hidden) closeCronModal();
});

/* ── Project detail modal ─────────────────────────────────────── */
const projectModal = document.getElementById('projectModal');
const projectModalBackdrop = document.getElementById('projectModalBackdrop');
const projectModalTitle = document.getElementById('projectModalTitle');
const projectModalMeta = document.getElementById('projectModalMeta');
const projectModalRoadmap = document.getElementById('projectModalRoadmap');
const projectModalClose = document.getElementById('projectModalClose');
const projectModalStatus = document.getElementById('projectModalStatus');
const projectModalOpenFolder = document.getElementById('projectModalOpenFolder');
const projectModalOpenTerminal = document.getElementById('projectModalOpenTerminal');
const projectModalEdit = document.getElementById('projectModalEdit');
const projectModalArchive = document.getElementById('projectModalArchive');
let projectModalCurrentPath = null;
let projectModalCurrent = null;

function renderProgressBar(percent) {
  const filled = Math.floor((percent || 0) / 5);
  const empty = 20 - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

function openProjectModal(project) {
  if (!projectModal || !project) return;
  projectModalCurrentPath = project.path;
  projectModalCurrent = project;
  if (projectModalArchive) {
    projectModalArchive.textContent = project.archive ? '↩ 복원' : '🗄 아카이브';
  }
  if (projectModalTitle) {
    const catStr = project.cat ? ` [${project.cat}]` : '';
    const pinStr = project.pin ? '⭐ ' : '';
    projectModalTitle.textContent = `${pinStr}${project.name}${catStr}`;
  }
  if (projectModalMeta) {
    const statusBits = [];
    if (project.dirty > 0) statusBits.push(`${project.dirty} modified`);
    if (project.ahead > 0) statusBits.push(`${project.ahead} ahead`);
    if (project.behind > 0) statusBits.push(`${project.behind} behind`);
    const statusStr = statusBits.length ? statusBits.join(' · ') : (project.hasGit ? 'clean' : '(git 아님)');

    const rows = [
      ['description', project.desc || '-'],
      ['path', project.path],
      ['branch', project.hasGit ? (project.branch || '-') : '없음'],
      ['status', statusStr],
      ['last opened', project.lastOpenedAt ? `${formatRelative(project.lastOpenedAt)} · ${new Date(project.lastOpenedAt).toLocaleString()}` : '-'],
      ['last commit', project.lastCommitAt ? `${formatRelative(project.lastCommitAt)} · ${new Date(project.lastCommitAt).toLocaleString()}` : '-']
    ];
    projectModalMeta.innerHTML = rows.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(String(v))}</dd>`).join('');
  }
  if (projectModalRoadmap) {
    const html = [];

    const wts = Array.isArray(project.worktrees) ? project.worktrees : [];
    if (wts.length > 0) {
      html.push(`<div class="project-modal__section"><div class="project-modal__section-head">Worktrees <span class="roadmap-section__count">${wts.length}</span></div>`);
      html.push(wts.map((w) => {
        const wStatus = w.dirty > 0 ? `${w.dirty} mod` : 'clean';
        const encP = escapeHtml(w.path);
        return `<div class="worktree-row"><span class="worktree-row__name">${escapeHtml(w.name)}</span><span class="worktree-row__branch">${escapeHtml(w.branch)}</span><span class="worktree-row__status" data-state="${w.dirty > 0 ? 'warn' : 'ok'}">${escapeHtml(wStatus)}</span>${w.desc ? `<span class="worktree-row__desc">${escapeHtml(w.desc)}</span>` : ''}<button class="project-row__action" data-project-action="folder" data-path="${encP}" type="button" title="폴더 열기">📁</button><button class="project-row__action" data-project-action="terminal" data-path="${encP}" type="button" title="Windows Terminal">▸_</button></div>`;
      }).join(''));
      html.push(`</div>`);
    }

    const items = Array.isArray(project.roadmapItems) ? project.roadmapItems : [];
    if (items.length === 0) {
      html.push(`<div class="project-modal__section"><div class="project-modal__section-head">ROADMAP</div><p class="empty-state">ROADMAP.md 없음</p></div>`);
    } else {
      const bar = renderProgressBar(project.roadmapPercent);
      html.push(`<div class="project-modal__section"><div class="project-modal__section-head">ROADMAP <span class="roadmap-section__count">${project.roadmapDone}/${project.roadmapTotal} · ${project.roadmapPercent}%</span></div>`);
      html.push(`<div class="roadmap-bar">${bar}</div>`);
      const grouped = new Map();
      for (const it of items) {
        const key = it.section || '(기타)';
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(it);
      }
      for (const [section, list] of grouped) {
        const todo = list.filter((i) => !i.done);
        const done = list.filter((i) => i.done);
        const doneCount = done.length;
        html.push(`<div class="roadmap-section"><div class="roadmap-section__head">${escapeHtml(section)} <span class="roadmap-section__count">${doneCount}/${list.length}</span></div>`);
        html.push(todo.map((i) => `<div class="roadmap-item"><span class="roadmap-item__mark">○</span><span class="roadmap-item__text">${escapeHtml(i.text)}</span></div>`).join(''));
        if (done.length > 0) {
          html.push(`<details class="roadmap-done-fold"><summary>완료 ${doneCount}개 보기</summary>`);
          html.push(done.map((i) => `<div class="roadmap-item is-done"><span class="roadmap-item__mark">✔</span><span class="roadmap-item__text">${escapeHtml(i.text)}</span></div>`).join(''));
          html.push(`</details>`);
        }
        html.push(`</div>`);
      }
      html.push(`</div>`);
    }
    projectModalRoadmap.innerHTML = html.join('');
  }
  if (projectModalStatus) { projectModalStatus.dataset.state = ''; projectModalStatus.textContent = ''; }
  projectModal.hidden = false;
  if (projectModalBackdrop) projectModalBackdrop.hidden = false;
}

function closeProjectModal() {
  projectModalCurrentPath = null;
  projectModalCurrent = null;
  if (projectModal) projectModal.hidden = true;
  if (projectModalBackdrop) projectModalBackdrop.hidden = true;
}

if (projectModalClose) projectModalClose.addEventListener('click', closeProjectModal);
if (projectModalBackdrop) projectModalBackdrop.addEventListener('click', closeProjectModal);

async function runProjectModalAction(action) {
  if (!projectModalCurrentPath || !window.workspacePulse.openProjectAction) return;
  try {
    const result = await window.workspacePulse.openProjectAction({ path: projectModalCurrentPath, action });
    if (!result?.ok && projectModalStatus) {
      projectModalStatus.dataset.state = 'error';
      projectModalStatus.textContent = result?.error || '실패';
    }
  } catch (error) {
    if (projectModalStatus) {
      projectModalStatus.dataset.state = 'error';
      projectModalStatus.textContent = String(error.message || error);
    }
  }
}

if (projectModalOpenFolder) projectModalOpenFolder.addEventListener('click', () => runProjectModalAction('folder'));
if (projectModalOpenTerminal) projectModalOpenTerminal.addEventListener('click', () => runProjectModalAction('terminal'));

if (projectModalEdit) projectModalEdit.addEventListener('click', async () => {
  const project = projectModalCurrent;
  if (!project || !window.workspacePulse.updateProjectMeta) return;
  const curDesc = project.desc || '';
  const curCat = project.cat || '';
  const result = await openInputModal({
    title: `[${project.name}] 편집`,
    fields: [
      { key: 'desc', label: '설명', value: curDesc },
      { key: 'cat', label: '카테고리', value: curCat, placeholder: 'AI/Web/MCP/Bot/Game/Tool/Infra/Etc' }
    ]
  });
  if (!result) return;
  closeProjectModal();
  commitProjectPatch(project.name, { desc: result.desc ?? curDesc, cat: result.cat ?? curCat });
});

if (projectModalArchive) projectModalArchive.addEventListener('click', () => {
  const project = projectModalCurrent;
  if (!project || !window.workspacePulse.updateProjectMeta) return;
  const nextArchive = !project.archive;
  closeProjectModal();
  commitProjectPatch(project.name, { archive: nextArchive });
});

document.addEventListener('click', (event) => {
  if (event.target.closest('[data-project-action]') || event.target.closest('[data-project-meta]')) return;
  const row = event.target.closest('[data-project-index]');
  if (!row) return;
  const idx = Number(row.dataset.projectIndex);
  const list = window.__lastProjectList || [];
  const project = list[idx];
  if (project) openProjectModal(project);
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && projectModal && !projectModal.hidden) closeProjectModal();
});

/* ── Global search (Ctrl+K) ─────────────────────────────────── */
const globalSearch = document.getElementById('globalSearch');
const globalSearchBackdrop = document.getElementById('globalSearchBackdrop');
const globalSearchInput = document.getElementById('globalSearchInput');
const globalSearchResults = document.getElementById('globalSearchResults');
let globalSearchSelectedIdx = 0;
let globalSearchCurrentHits = [];

function collectSearchSources() {
  const sources = [];
  const state = window.__workspacePulseState;
  if (state?.today) {
    const pushSch = (it, bucket) => {
      const text = typeof it === 'string' ? it : (it.text || it.rawText || it.title || '');
      if (!text) return;
      sources.push({
        source: 'schedule',
        label: `📅 ${bucket}`,
        title: text,
        detail: it.section || it.date || '',
        key: text.toLowerCase() + ' ' + (it.section || '').toLowerCase(),
        payload: { bucket, item: it }
      });
    };
    (state.today.today || []).forEach((it) => pushSch(it, 'today'));
    (state.today.recurring || []).forEach((it) => pushSch(it, 'recurring'));
    (state.today.deadlines || []).forEach((it) => pushSch(it, 'deadline'));
    (state.today.backlog || []).forEach((it) => pushSch(it, 'backlog'));
  }
  const projects = tabCache.projects?.data?.items || [];
  for (const p of projects) {
    sources.push({
      source: 'project',
      label: `📂 ${p.cat || 'Etc'}`,
      title: p.name,
      detail: p.desc || p.path,
      key: `${p.name} ${p.desc || ''} ${p.cat || ''}`.toLowerCase(),
      payload: { project: p }
    });
    for (const w of p.worktrees || []) {
      sources.push({
        source: 'worktree',
        label: `⌥ ${p.name}`,
        title: w.name,
        detail: `${w.branch || ''} · ${w.desc || w.path}`,
        key: `${p.name} ${w.name} ${w.branch || ''} ${w.desc || ''}`.toLowerCase(),
        payload: { project: p, worktree: w }
      });
    }
  }
  const content = tabCache.content?.data;
  if (content) {
    (content.cron || []).forEach((it) => sources.push({
      source: 'cron',
      label: `⏱ cron`,
      title: it.name || it.id,
      detail: [it.schedule, it.deliveryChannel].filter(Boolean).join(' · '),
      key: `${it.name || ''} ${it.id || ''} ${it.description || ''}`.toLowerCase(),
      payload: { job: it }
    }));
    (content.recent || []).forEach((it) => sources.push({
      source: 'content-recent',
      label: `📰 recent`,
      title: it.title || it.name,
      detail: [it.platform, it.status].filter(Boolean).join(' · '),
      key: `${it.title || ''} ${it.name || ''}`.toLowerCase(),
      payload: { item: it }
    }));
  }
  const vault = tabCache.vault?.data;
  if (vault?.folders) {
    for (const [fkey, folder] of Object.entries(vault.folders)) {
      (folder?.items || []).forEach((it) => sources.push({
        source: 'vault',
        label: `📓 ${VAULT_FOLDER_LABELS[fkey] || fkey}`,
        title: it.title || it.name,
        detail: it.name && it.title !== it.name ? it.name : (it.path || ''),
        key: `${it.title || ''} ${it.name || ''} ${it.path || ''}`.toLowerCase(),
        payload: { path: it.path }
      }));
    }
  }
  const notion = tabCache.notion?.data;
  if (notion?.items) {
    notion.items.forEach((n) => sources.push({
      source: 'notion',
      label: `🔖 ${n.kind === 'database' ? 'DB' : 'page'}`,
      title: n.title,
      detail: n.parent || '',
      key: `${n.title || ''} ${n.parent || ''}`.toLowerCase(),
      payload: { url: n.url }
    }));
  }
  return sources;
}

function filterSearchHits(sources, query) {
  if (!query) return sources.slice(0, 20);
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = [];
  for (const s of sources) {
    if (tokens.every((t) => s.key.includes(t))) hits.push(s);
  }
  return hits.slice(0, 50);
}

function renderSearchResults() {
  if (!globalSearchResults) return;
  const query = (globalSearchInput?.value || '').trim();
  const sources = collectSearchSources();
  globalSearchCurrentHits = filterSearchHits(sources, query);
  if (globalSearchCurrentHits.length === 0) {
    globalSearchResults.innerHTML = `<div class="command-palette__empty">${query ? '결과 없음' : '캐시된 데이터 없음 · 탭을 먼저 열어보세요'}</div>`;
    return;
  }
  if (globalSearchSelectedIdx >= globalSearchCurrentHits.length) globalSearchSelectedIdx = 0;
  globalSearchResults.innerHTML = globalSearchCurrentHits.map((h, idx) => `
    <div class="command-palette__item ${idx === globalSearchSelectedIdx ? 'is-selected' : ''}" data-search-idx="${idx}">
      <span class="command-palette__source">${escapeHtml(h.label)}</span>
      <span class="command-palette__title">${escapeHtml(h.title || '')}</span>
      ${h.detail ? `<span class="command-palette__detail">${escapeHtml(h.detail)}</span>` : ''}
    </div>`).join('');
  const sel = globalSearchResults.querySelector('.is-selected');
  if (sel) sel.scrollIntoView({ block: 'nearest' });
}

function openGlobalSearch() {
  if (!globalSearch) return;
  globalSearch.hidden = false;
  if (globalSearchBackdrop) globalSearchBackdrop.hidden = false;
  globalSearchSelectedIdx = 0;
  if (globalSearchInput) {
    globalSearchInput.value = '';
    globalSearchInput.focus();
  }
  ['projects', 'content', 'vault', 'notion'].forEach((t) => {
    if (!tabCache[t]) loadTabData(t).catch(() => {});
  });
  renderSearchResults();
}

function closeGlobalSearch() {
  if (!globalSearch) return;
  globalSearch.hidden = true;
  if (globalSearchBackdrop) globalSearchBackdrop.hidden = true;
}

async function executeSearchHit(hit) {
  if (!hit) return;
  closeGlobalSearch();
  if (hit.source === 'schedule') {
    setActiveTab('schedule');
  } else if (hit.source === 'project' || hit.source === 'worktree') {
    setActiveTab('projects');
    openProjectModal(hit.payload.project);
  } else if (hit.source === 'cron') {
    setActiveTab('content');
    openCronModal(hit.payload.job);
  } else if (hit.source === 'content-recent') {
    setActiveTab('content');
  } else if (hit.source === 'vault') {
    if (hit.payload.path && window.workspacePulse.openVaultNote) {
      try { await window.workspacePulse.openVaultNote({ path: hit.payload.path }); }
      catch (error) { console.error('open vault', error); }
    }
  } else if (hit.source === 'notion') {
    if (hit.payload.url && window.workspacePulse.openNotionPage) {
      try { await window.workspacePulse.openNotionPage({ url: hit.payload.url }); }
      catch (error) { console.error('open notion', error); }
    }
  }
}

if (globalSearchInput) {
  globalSearchInput.addEventListener('input', () => {
    globalSearchSelectedIdx = 0;
    renderSearchResults();
  });
  globalSearchInput.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (globalSearchSelectedIdx < globalSearchCurrentHits.length - 1) globalSearchSelectedIdx++;
      renderSearchResults();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (globalSearchSelectedIdx > 0) globalSearchSelectedIdx--;
      renderSearchResults();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      executeSearchHit(globalSearchCurrentHits[globalSearchSelectedIdx]);
    }
  });
}

if (globalSearchBackdrop) globalSearchBackdrop.addEventListener('click', closeGlobalSearch);

if (globalSearchResults) {
  globalSearchResults.addEventListener('click', (event) => {
    const row = event.target.closest('[data-search-idx]');
    if (!row) return;
    const idx = Number(row.dataset.searchIdx);
    executeSearchHit(globalSearchCurrentHits[idx]);
  });
}

document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    if (globalSearch && !globalSearch.hidden) closeGlobalSearch();
    else openGlobalSearch();
    return;
  }
  if (event.key === 'Escape' && globalSearch && !globalSearch.hidden) closeGlobalSearch();
});
