const NOTION_SEARCH_API = 'https://api.notion.com/v1/search';
const NOTION_BLOCKS_API = 'https://api.notion.com/v1/blocks';
const NOTION_PAGES_API = 'https://api.notion.com/v1/pages';
const NOTION_DATABASES_API = 'https://api.notion.com/v1/databases';
const NOTION_VERSION = '2022-06-28';
const FETCH_TIMEOUT = 15000;

function resolveActiveWorkspace(config) {
  const workspaces = Array.isArray(config?.notion?.workspaces) ? config.notion.workspaces : [];
  const activeId = config?.notion?.activeWorkspaceId || '';
  let ws = workspaces.find((w) => w.id === activeId);
  if (!ws && workspaces.length > 0) ws = workspaces[0];
  if (ws?.token) return { id: ws.id, label: ws.label || ws.id, token: ws.token };
  const envToken = process.env.NOTION_TOKEN || process.env.PERSONAL_NOTION_TOKEN || '';
  if (envToken) return { id: '__env__', label: '환경변수 (legacy)', token: envToken };
  return null;
}

function extractTitleFromPage(obj) {
  const props = obj?.properties || {};
  for (const key of Object.keys(props)) {
    const prop = props[key];
    if (prop?.type === 'title' && Array.isArray(prop.title) && prop.title.length > 0) {
      return prop.title.map((t) => t.plain_text || '').join('').trim();
    }
  }
  if (Array.isArray(obj?.title) && obj.title.length > 0) {
    return obj.title.map((t) => t.plain_text || '').join('').trim();
  }
  return '(untitled)';
}

function normalizeParent(parent) {
  if (!parent) return { type: 'workspace', id: null };
  if (parent.type === 'workspace') return { type: 'workspace', id: null };
  if (parent.type === 'page_id') return { type: 'page', id: parent.page_id };
  if (parent.type === 'database_id') return { type: 'database', id: parent.database_id };
  if (parent.type === 'block_id') return { type: 'block', id: parent.block_id };
  return { type: parent.type || 'unknown', id: null };
}

function normalizeItem(r) {
  return {
    id: r.id,
    kind: r.object,
    title: extractTitleFromPage(r),
    url: r.url || '',
    modifiedAt: r.last_edited_time || null,
    createdAt: r.created_time || null,
    parent: normalizeParent(r.parent),
    hasChildren: r.object === 'database' ? true : (r.has_children === true)
  };
}

async function notionFetch(url, token, { method = 'GET', body = null, timeoutMs = FETCH_TIMEOUT } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json'
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      const err = new Error(`Notion API ${response.status}: ${text.slice(0, 200)}`);
      err.status = response.status;
      throw err;
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function searchNotion(config, { pageSize = 100 } = {}) {
  const active = resolveActiveWorkspace(config);
  const workspaces = (config?.notion?.workspaces || []).map((w) => ({ id: w.id, label: w.label || w.id, hasToken: !!w.token }));
  if (!active) {
    return { items: [], workspaces, activeWorkspaceId: '', error: '워크스페이스가 없습니다. Notion 탭에서 추가하세요.' };
  }
  try {
    const payload = await notionFetch(NOTION_SEARCH_API, active.token, {
      method: 'POST',
      body: {
        page_size: pageSize,
        sort: { direction: 'descending', timestamp: 'last_edited_time' }
      }
    });
    const items = (payload.results || [])
      .filter((r) => !r.in_trash && !r.archived)
      .map(normalizeItem);
    return { items, workspaces, activeWorkspaceId: active.id, activeWorkspaceLabel: active.label, fetchedAt: new Date().toISOString() };
  } catch (error) {
    if (error.name === 'AbortError') {
      return { items: [], workspaces, activeWorkspaceId: active.id, activeWorkspaceLabel: active.label, error: 'Notion API 타임아웃 (15s)' };
    }
    return { items: [], workspaces, activeWorkspaceId: active.id, activeWorkspaceLabel: active.label, error: String(error.message || error) };
  }
}

async function fetchPageMeta(pageId, token) {
  try {
    const page = await notionFetch(`${NOTION_PAGES_API}/${pageId}`, token);
    return normalizeItem(page);
  } catch (_) { return null; }
}

async function fetchDatabaseMeta(databaseId, token) {
  try {
    const db = await notionFetch(`${NOTION_DATABASES_API}/${databaseId}`, token);
    return normalizeItem(db);
  } catch (_) { return null; }
}

async function listChildPageBlocks(parentId, token) {
  const children = [];
  let cursor = null;
  let guard = 0;
  do {
    const qs = cursor ? `?start_cursor=${encodeURIComponent(cursor)}&page_size=100` : '?page_size=100';
    const payload = await notionFetch(`${NOTION_BLOCKS_API}/${parentId}/children${qs}`, token);
    for (const blk of payload.results || []) {
      if (blk.type === 'child_page' || blk.type === 'child_database') {
        children.push({
          id: blk.id,
          kind: blk.type === 'child_page' ? 'page' : 'database',
          title: blk.type === 'child_page' ? (blk.child_page?.title || '(untitled)') : (blk.child_database?.title || '(untitled)'),
          has_children: blk.has_children
        });
      }
    }
    cursor = payload.has_more ? payload.next_cursor : null;
    guard += 1;
  } while (cursor && guard < 10);
  return children;
}

async function queryDatabaseEntries(databaseId, token, { pageSize = 50 } = {}) {
  try {
    const payload = await notionFetch(`${NOTION_DATABASES_API}/${databaseId}/query`, token, {
      method: 'POST',
      body: { page_size: pageSize }
    });
    return (payload.results || [])
      .filter((r) => !r.in_trash && !r.archived)
      .map(normalizeItem);
  } catch (error) {
    return [];
  }
}

async function getNotionChildren(config, { parentId, parentKind } = {}) {
  const active = resolveActiveWorkspace(config);
  if (!active) return { items: [], error: '워크스페이스 없음' };
  if (!parentId) return { items: [], error: 'parentId required' };
  try {
    if (parentKind === 'database') {
      const entries = await queryDatabaseEntries(parentId, active.token);
      return { items: entries };
    }
    const stubs = await listChildPageBlocks(parentId, active.token);
    const enriched = await Promise.all(stubs.map(async (s) => {
      const meta = s.kind === 'database' ? await fetchDatabaseMeta(s.id, active.token) : await fetchPageMeta(s.id, active.token);
      if (meta) return meta;
      return {
        id: s.id,
        kind: s.kind,
        title: s.title,
        url: '',
        modifiedAt: null,
        createdAt: null,
        parent: { type: 'page', id: parentId },
        hasChildren: s.has_children === true
      };
    }));
    return { items: enriched };
  } catch (error) {
    if (error.name === 'AbortError') return { items: [], error: 'Notion API 타임아웃' };
    return { items: [], error: String(error.message || error) };
  }
}

module.exports = { searchNotion, getNotionChildren };
