const { Client } = require('pg');
const { getDatabaseConfig, migrate } = require('./migrate_worship_ppt_library_supabase.js');

const DEFAULT_LIBRARY_GAS_URL = 'https://script.google.com/macros/s/AKfycbwiYYWgKxmLRAEaE_pbp_kWyAzlRPcwYVQfvmJVamRJvosvt5wTTkvwebbFBkP8rMqX/exec';
const AUTH_TOKEN = 'ChurchApp-2026';

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
  const fileId = source.fileId || source.file_id || source.gasFileId || source.gas_file_id || source.id;
  const title = String(source.title || source.displayName || '').trim();
  const fileName = String(source.fileName || source.file_name || source.name || '').trim();

  if (!['hymn', 'response'].includes(kind) || !number || !fileId) {
    throw new Error(`PPT Library 第 ${index + 1} 筆索引缺少 kind、number 或 fileId`);
  }

  return {
    kind,
    number,
    title,
    fileId: String(fileId),
    fileName
  };
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

function parseJsonpPayload(body, callbackName) {
  const text = String(body || '').trim();
  if (text.startsWith('{')) return JSON.parse(text);
  const prefix = `${callbackName}(`;
  const start = text.indexOf(prefix);
  const end = text.lastIndexOf(')');
  if (start < 0 || end <= start) throw new Error('PPT Library GAS 沒有回傳可解析的索引資料');
  return JSON.parse(text.slice(start + prefix.length, end).replace(/;\s*$/, '').trim());
}

async function fetchLibraryIndex(gasUrl, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') throw new Error('目前 Node.js 沒有可用的 fetch');
  const callbackName = `__lkcPptLibrarySeed_${Date.now()}`;
  const url = new URL(gasUrl);
  url.searchParams.set('action', 'cal_getPptLibraryIndex');
  url.searchParams.set('token', AUTH_TOKEN);
  url.searchParams.set('data', '{}');
  url.searchParams.set('callback', callbackName);
  url.searchParams.set('_lkc', `${Date.now()}_${callbackName}`);

  const response = await fetchImpl(url.toString());
  if (!response.ok) throw new Error(`PPT Library GAS 回傳 HTTP ${response.status}`);
  const payload = parseJsonpPayload(await response.text(), callbackName);
  if (payload && payload.success === false) throw new Error(payload.message || 'PPT Library GAS 讀取失敗');
  return normalizeLibraryRows(payload);
}

async function upsertLibraryRows(client, rows) {
  const sql = `
    INSERT INTO public.worship_ppt_library_index
      (kind, number, file_id, title, file_name, updated_at, updated_by)
    VALUES ($1, $2, $3, $4, $5, now(), 'ppt-library-seed')
    ON CONFLICT (kind, number) DO UPDATE SET
      file_id = EXCLUDED.file_id,
      title = EXCLUDED.title,
      file_name = EXCLUDED.file_name,
      updated_at = now(),
      updated_by = 'ppt-library-seed'
  `;
  for (const row of rows) {
    await client.query(sql, [row.kind, row.number, row.fileId, row.title, row.fileName]);
  }
  return rows.length;
}

async function seedLibraryRows(rows, env = process.env) {
  const client = new Client(getDatabaseConfig(env));
  await client.connect();
  try {
    await client.query('BEGIN');
    const count = await upsertLibraryRows(client, rows);
    await client.query('COMMIT');
    return count;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end().catch(() => {});
  }
}

async function main() {
  try {
    require('dotenv').config();
  } catch (error) {
    if (error && error.code !== 'MODULE_NOT_FOUND') throw error;
  }

  const gasUrl = process.env.PPT_LIBRARY_GAS_URL || DEFAULT_LIBRARY_GAS_URL;
  const rows = await fetchLibraryIndex(gasUrl);
  const counts = rows.reduce((result, row) => {
    result[row.kind] = (result[row.kind] || 0) + 1;
    return result;
  }, {});
  console.log(`從 Library GAS 取得 ${rows.length} 筆索引：${JSON.stringify(counts)}`);

  if (!process.argv.includes('--apply')) {
    console.log('Dry-run：未寫入 Supabase。若確認資料正確，請加上 --apply。');
    return;
  }

  await migrate();
  const count = await seedLibraryRows(rows);
  console.log(`Supabase PPT Library 索引已寫入 ${count} 筆。`);
}

if (require.main === module) {
  main().catch(error => {
    console.error('Supabase PPT Library seed failed:', error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_LIBRARY_GAS_URL,
  extractIndexRows,
  fetchLibraryIndex,
  normalizeLibraryNumber,
  normalizeLibraryRow,
  normalizeLibraryRows,
  parseJsonpPayload,
  seedLibraryRows,
  upsertLibraryRows
};
