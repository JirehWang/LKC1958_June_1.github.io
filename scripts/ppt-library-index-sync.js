'use strict';

const DEFAULT_LIBRARY_GAS_URL = 'https://script.google.com/macros/s/AKfycbwiYYWgKxmLRAEaE_pbp_kWyAzlRPcwYVQfvmJVamRJvosvt5wTTkvwebbFBkP8rMqX/exec';
const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_RETRY_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 1000;
const SYNC_UPDATED_BY = 'ppt-library-sync';
const SEED_UPDATED_BY = 'ppt-library-seed';

function normalizeLibraryNumber(value) {
  const raw = String(value == null ? '' : value).trim().toUpperCase();
  const match = raw.match(/^0*(\d+)\s*([A-Z])?$/);
  return match ? `${Number(match[1])}${match[2] || ''}` : raw;
}

function extractIndexRows(result) {
  if (Array.isArray(result)) return result;
  if (!result || typeof result !== 'object') return null;

  const candidates = [result.data, result.records, result.entries, result.items, result.rows, result.index];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
    if (!candidate || typeof candidate !== 'object') continue;
    for (const nestedKey of ['entries', 'items', 'rows', 'records', 'index']) {
      if (Array.isArray(candidate[nestedKey])) return candidate[nestedKey];
    }
    const grouped = ['hymn', 'response']
      .flatMap(kind => Array.isArray(candidate[kind]) ? candidate[kind] : []);
    if (grouped.length) return grouped;
  }
  return null;
}

function normalizeLibraryRow(row, index) {
  const source = row && typeof row === 'object' ? row : {};
  const kind = String(source.kind || '').trim().toLowerCase();
  const number = normalizeLibraryNumber(source.number || source.no || source.songNumber || source.song_number);
  const fileId = String(
    source.fileId || source.file_id || source.gasFileId || source.gas_file_id || source.sourceFileId || source.source_file_id || source.id || ''
  ).trim();
  const title = String(source.title || source.displayName || '').trim();
  const fileName = String(source.fileName || source.file_name || source.name || '').trim();

  if (!['hymn', 'response'].includes(kind) || !number || !fileId) {
    throw new Error(`PPT Library 第 ${index + 1} 筆索引缺少 kind、number 或 fileId`);
  }

  return { kind, number, title, fileId, fileName };
}

function normalizeLibraryRows(result) {
  const rows = extractIndexRows(result);
  if (!rows) throw new Error('PPT Library GAS 索引格式不正確');

  const byKey = new Map();
  rows.forEach((row, index) => {
    const normalized = normalizeLibraryRow(row, index);
    const key = `${normalized.kind}:${normalized.number}`;
    const previous = byKey.get(key);
    if (previous && previous.fileId !== normalized.fileId) {
      throw new Error(`PPT Library 出現重複索引：${normalized.kind} ${normalized.number}`);
    }
    if (!previous) byKey.set(key, normalized);
  });
  return Array.from(byKey.values());
}

function prepareLibraryRows(result) {
  const rows = normalizeLibraryRows(result);
  if (!rows.length) throw new Error('PPT Library GAS 索引沒有任何可同步資料');
  return rows;
}

function parseJsonpPayload(body, callbackName) {
  const text = String(body || '').trim();
  if (text.startsWith('{') || text.startsWith('[')) return JSON.parse(text);
  const prefix = `${callbackName}(`;
  const start = text.indexOf(prefix);
  const end = text.lastIndexOf(')');
  if (start < 0 || end <= start) throw new Error('PPT Library GAS 沒有回傳可解析的索引資料');
  return JSON.parse(text.slice(start + prefix.length, end).replace(/;\s*$/, '').trim());
}

function getLibraryGasToken(env = process.env) {
  const token = String(env.PPT_LIBRARY_GAS_TOKEN || '').trim();
  if (!token) throw new Error('缺少 PPT_LIBRARY_GAS_TOKEN，請以執行環境變數提供 Library GAS 授權 token');
  return token;
}

function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function fetchLibraryIndex(gasUrl, fetchImpl = globalThis.fetch, options = {}) {
  if (fetchImpl && typeof fetchImpl === 'object') {
    options = fetchImpl;
    fetchImpl = globalThis.fetch;
  }
  if (typeof fetchImpl !== 'function') throw new Error('目前 Node.js 沒有可用的 fetch');

  const token = String(options.token || getLibraryGasToken(options.env || process.env)).trim();
  const callbackName = `__lkcPptLibrarySync_${Date.now()}`;
  const url = new URL(gasUrl);
  url.searchParams.set('action', 'cal_getPptLibraryIndex');
  url.searchParams.set('token', token);
  url.searchParams.set('data', '{}');
  url.searchParams.set('callback', callbackName);
  url.searchParams.set('_lkc', `${Date.now()}_${callbackName}`);

  const attempts = Math.max(1, Number(options.retryAttempts || DEFAULT_RETRY_ATTEMPTS));
  const retryDelayMs = Math.max(0, Number(options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS));
  const timeoutMs = Math.max(1, Number(options.timeoutMs || DEFAULT_TIMEOUT_MS));
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    url.searchParams.set('_lkc', `${Date.now()}_${callbackName}_${attempt}`);
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const response = await fetchImpl(url.toString(), controller ? { signal: controller.signal } : {});
      if (!response || response.ok === false) {
        throw new Error(`PPT Library GAS 回傳 HTTP ${response && response.status || 0}`);
      }
      const payload = parseJsonpPayload(await response.text(), callbackName);
      if (payload && payload.success === false) {
        throw new Error(payload.message || 'PPT Library GAS 讀取失敗');
      }
      return prepareLibraryRows(payload);
    } catch (error) {
      lastError = error && error.name === 'AbortError'
        ? new Error(`PPT Library GAS 讀取逾時（${timeoutMs}ms）`)
        : error;
      if (attempt < attempts && retryDelayMs > 0) await sleep(retryDelayMs * attempt);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  throw lastError;
}

function libraryRowKey(row) {
  return `${row.kind}:${row.number}`;
}

function normalizeExistingRows(rows) {
  const byKey = new Map();
  for (const [index, row] of (rows || []).entries()) {
    const normalized = normalizeLibraryRow(row, index);
    const key = libraryRowKey(normalized);
    if (byKey.has(key)) throw new Error(`Supabase PPT Library 出現重複索引：${normalized.kind} ${normalized.number}`);
    byKey.set(key, normalized);
  }
  return byKey;
}

function planLibrarySync(sourceRows, existingRows) {
  const source = prepareLibraryRows(sourceRows);
  const sourceByKey = normalizeExistingRows(source);
  const existingByKey = normalizeExistingRows(existingRows);
  const changes = [];
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;

  for (const row of source) {
    const key = libraryRowKey(row);
    const previous = existingByKey.get(key);
    if (!previous) {
      inserted += 1;
      changes.push({ key, type: 'insert', after: row });
      continue;
    }

    const same = previous.fileId === row.fileId
      && previous.title === row.title
      && previous.fileName === row.fileName;
    if (same) {
      unchanged += 1;
    } else {
      updated += 1;
      changes.push({ key, type: 'update', before: previous, after: row });
    }
  }

  let preserved = 0;
  for (const key of existingByKey.keys()) {
    if (!sourceByKey.has(key)) preserved += 1;
  }

  return {
    sourceCount: source.length,
    existingCount: existingByKey.size,
    inserted,
    updated,
    unchanged,
    preserved,
    projectedCount: existingByKey.size + inserted,
    changes
  };
}

async function readLibraryRows(client) {
  const result = await client.query(`
    SELECT kind, number, file_id, title, file_name
      FROM public.worship_ppt_library_index
     ORDER BY kind, number
  `);
  return result && Array.isArray(result.rows) ? result.rows : [];
}

function assertUpdatedBy(updatedBy) {
  if (![SYNC_UPDATED_BY, SEED_UPDATED_BY].includes(updatedBy)) {
    throw new Error(`不支援的 PPT Library updated_by：${updatedBy}`);
  }
  return updatedBy;
}

async function upsertLibraryRows(client, rows, options = {}) {
  const updatedBy = assertUpdatedBy(options.updatedBy || SYNC_UPDATED_BY);
  const sql = `
    INSERT INTO public.worship_ppt_library_index
      (kind, number, file_id, title, file_name, updated_at, updated_by)
    VALUES ($1, $2, $3, $4, $5, now(), '${updatedBy}')
    ON CONFLICT (kind, number) DO UPDATE SET
      file_id = EXCLUDED.file_id,
      title = EXCLUDED.title,
      file_name = EXCLUDED.file_name,
      updated_at = now(),
      updated_by = '${updatedBy}'
  `;
  for (const row of rows) {
    await client.query(sql, [row.kind, row.number, row.fileId, row.title, row.fileName]);
  }
  return rows.length;
}

async function applyLibrarySync(client, sourceRows, options = {}) {
  const source = prepareLibraryRows(sourceRows);
  await client.query('BEGIN');
  try {
    const existing = options.existingRows || await readLibraryRows(client);
    const plan = planLibrarySync(source, existing);
    const changedRows = plan.changes.map(change => change.after);
    await upsertLibraryRows(client, changedRows, { updatedBy: options.updatedBy || SYNC_UPDATED_BY });
    await client.query('COMMIT');
    return plan;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

module.exports = {
  DEFAULT_LIBRARY_GAS_URL,
  DEFAULT_RETRY_ATTEMPTS,
  DEFAULT_RETRY_DELAY_MS,
  DEFAULT_TIMEOUT_MS,
  SEED_UPDATED_BY,
  SYNC_UPDATED_BY,
  applyLibrarySync,
  extractIndexRows,
  fetchLibraryIndex,
  getLibraryGasToken,
  libraryRowKey,
  normalizeLibraryNumber,
  normalizeLibraryRow,
  normalizeLibraryRows,
  parseJsonpPayload,
  planLibrarySync,
  prepareLibraryRows,
  readLibraryRows,
  upsertLibraryRows
};
