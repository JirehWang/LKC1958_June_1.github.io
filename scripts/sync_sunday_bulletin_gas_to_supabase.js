'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createClient } = require('../node_modules/@supabase/supabase-js');

const KEY_PREFIXES = Object.freeze({
  bulletins: 'bulletin_draft_',
  reports: 'reports_',
  praise: 'praise_songs_'
});

const TABLES = Object.freeze({
  bulletins: 'sunday_bulletins',
  reports: 'sunday_bulletin_reports',
  praise: 'sunday_bulletin_praise'
});

const KIND_ORDER = Object.freeze({ bulletins: 0, reports: 1, praise: 2 });
const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_RETRY_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 750;
const MIGRATION_USER = 'gas-migration';

function cleanDate(value) {
  const text = String(value || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return '';

  const parsed = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) return '';
  return text;
}

function getKeyKind(key) {
  const text = String(key || '').trim();
  for (const [kind, prefix] of Object.entries(KEY_PREFIXES)) {
    if (text.startsWith(prefix) && cleanDate(text.slice(prefix.length))) return kind;
  }
  return null;
}

function getDateFromKey(key) {
  const kind = getKeyKind(key);
  return kind ? cleanDate(String(key).slice(KEY_PREFIXES[kind].length)) : '';
}

function buildGasListUrl(endpoint) {
  const url = new URL(endpoint);
  url.searchParams.set('action', 'list');
  return url.toString();
}

function buildGasLoadUrl(endpoint, key) {
  const url = new URL(endpoint);
  url.searchParams.set('action', 'load');
  url.searchParams.set('key', key);
  return url.toString();
}

function selectGasKeys(entries, filters = {}) {
  const allowedKinds = new Set(
    Array.isArray(filters.kinds) && filters.kinds.length
      ? filters.kinds
      : Object.keys(KEY_PREFIXES)
  );
  const from = filters.from ? cleanDate(filters.from) : '';
  const to = filters.to ? cleanDate(filters.to) : '';
  if (filters.from && !from) throw new Error(`無效的起始日期：${filters.from}`);
  if (filters.to && !to) throw new Error(`無效的結束日期：${filters.to}`);
  if (from && to && from > to) throw new Error('起始日期不可晚於結束日期');

  const unique = new Set();
  for (const entry of entries || []) {
    const key = typeof entry === 'string' ? entry : entry && entry.key;
    const kind = getKeyKind(key);
    const date = getDateFromKey(key);
    if (!kind || !allowedKinds.has(kind)) continue;
    if (from && date < from) continue;
    if (to && date > to) continue;
    unique.add(String(key).trim());
  }

  return [...unique].sort((left, right) => {
    const dateCompare = getDateFromKey(left).localeCompare(getDateFromKey(right));
    if (dateCompare !== 0) return dateCompare;
    const kindCompare = KIND_ORDER[getKeyKind(left)] - KIND_ORDER[getKeyKind(right)];
    return kindCompare || left.localeCompare(right);
  });
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeTimestamp(data) {
  const candidate = data && (data.updatedAt || data.updated_at);
  if (candidate && !Number.isNaN(Date.parse(String(candidate)))) {
    return new Date(candidate).toISOString();
  }
  return new Date().toISOString();
}

function buildSupabaseRow(item) {
  const key = item && item.key ? String(item.key) : '';
  const kind = item && item.kind ? item.kind : getKeyKind(key);
  const source = isObject(item && item.data) ? item.data : {};
  const date = cleanDate((item && item.date) || source.date || getDateFromKey(key));
  if (!kind || !TABLES[kind]) throw new Error(`不支援的 GAS key：${key}`);
  if (!date) throw new Error(`資料缺少有效日期：${key}`);

  const updatedAt = normalizeTimestamp(source);
  const common = { date, updated_at: updatedAt, updated_by: MIGRATION_USER };

  if (kind === 'reports') {
    return {
      table: TABLES.reports,
      row: {
        ...common,
        announcements: Array.isArray(source.announcements) ? source.announcements : [],
        church_news: Array.isArray(source.churchNews) ? source.churchNews : [],
        prayer: isObject(source.prayer) ? source.prayer : {},
        raw_data: source
      }
    };
  }

  if (kind === 'praise') {
    return {
      table: TABLES.praise,
      row: {
        ...common,
        title: String(source.title || '').trim(),
        kicker: String(source.kicker || '聖歌隊').trim(),
        lyrics: String(source.lyrics || '').trim(),
        raw_data: source
      }
    };
  }

  return {
    table: TABLES.bulletins,
    row: {
      ...common,
      service_type: String(source.serviceType || '台華語'),
      taiwanese: isObject(source.taiwanese) ? source.taiwanese : {},
      mandarin: isObject(source.mandarin) ? source.mandarin : {},
      ministry: isObject(source.ministry) ? source.ministry : {},
      attendance: isObject(source.attendance) ? source.attendance : {},
      events: Array.isArray(source.events) ? source.events : [],
      announcements: Array.isArray(source.announcements) ? source.announcements : [],
      church_news: Array.isArray(source.churchNews) ? source.churchNews : [],
      prayer: isObject(source.prayer) ? source.prayer : {},
      offering_report: isObject(source.offeringReport) ? source.offeringReport : {},
      data: source
    }
  };
}

async function fetchJson(url, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  if (typeof fetchImpl !== 'function') throw new Error('目前 Node 執行環境沒有可用的 fetch');

  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  let response;
  let raw;
  try {
    response = await fetchImpl(url, controller ? { signal: controller.signal } : {});
    raw = typeof response.text === 'function'
      ? await response.text()
      : await response.json();
  } catch (error) {
    if (error && error.name === 'AbortError') throw new Error(`請求逾時（${timeoutMs}ms）：${url}`);
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }

  if (response && response.ok === false) {
    throw new Error(`HTTP ${response.status || '錯誤'}：${url}`);
  }

  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch (error) {
    const preview = raw.replace(/\s+/g, ' ').slice(0, 80);
    throw new Error(`GAS 回應不是有效 JSON（${error.message}；前綴：${preview}）`);
  }
}

async function fetchJsonWithRetry(url, options = {}) {
  const attempts = Math.max(1, Number(options.retryAttempts || DEFAULT_RETRY_ATTEMPTS));
  const retryDelayMs = Math.max(0, Number(options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS));
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetchJson(url, options);
    } catch (error) {
      lastError = error;
      if (attempt < attempts && retryDelayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, retryDelayMs * attempt));
      }
    }
  }

  throw lastError;
}

function assertGasSuccess(payload, key) {
  if (!payload || payload.success !== true || !isObject(payload.data)) {
    const message = payload && (payload.error || payload.message);
    throw new Error(`GAS 無法載入 ${key}${message ? `：${message}` : ''}`);
  }
  return payload.data;
}

async function loadGasItems(gasUrl, filters = {}) {
  const options = filters.requestOptions || {};
  const listPayload = await fetchJsonWithRetry(buildGasListUrl(gasUrl), options);
  if (!listPayload || listPayload.success !== true || !Array.isArray(listPayload.drafts)) {
    throw new Error(`GAS 列表回應格式錯誤${listPayload?.error ? `：${listPayload.error}` : ''}`);
  }

  const keys = selectGasKeys(listPayload.drafts, filters);
  const items = [];
  const failures = [];

  // 逐筆讀取，避免一次把 GAS 工作表與所有 JSON 壓在同一個請求中。
  for (const key of keys) {
    try {
      const payload = await fetchJsonWithRetry(buildGasLoadUrl(gasUrl, key), options);
      const data = assertGasSuccess(payload, key);
      items.push({ key, kind: getKeyKind(key), date: getDateFromKey(key), data });
    } catch (error) {
      failures.push({ key, error: error.message });
    }
  }

  return { listed: listPayload.drafts.length, keys, items, failures };
}

async function syncItems(items, options = {}) {
  const dryRun = options.dryRun !== false;
  const client = options.client;
  if (!dryRun && (!client || typeof client.from !== 'function')) {
    throw new Error('寫入模式需要 Supabase client');
  }

  const result = { planned: Array.isArray(items) ? items.length : 0, upserted: 0, failed: 0, failures: [] };
  for (const item of items || []) {
    try {
      const built = buildSupabaseRow(item);
      if (!dryRun) {
        const response = await client
          .from(built.table)
          .upsert(built.row, { onConflict: 'date' });
        if (response && response.error) throw response.error;
        result.upserted += 1;
      }
    } catch (error) {
      result.failed += 1;
      result.failures.push({ key: item && item.key, error: error.message });
    }
  }

  return result;
}

function readDefaultGasUrl() {
  if (process.env.GAS_SYNC_URL) return process.env.GAS_SYNC_URL;
  const configPath = path.join(__dirname, '..', 'apps', 'LKC_SundayBulletin', 'js', 'config.js');
  const source = fs.readFileSync(configPath, 'utf8');
  const match = source.match(/GAS_SYNC_URL\s*:\s*['"]([^'"]+)['"]/);
  if (!match) throw new Error('找不到 GAS_SYNC_URL，請設定 GAS_SYNC_URL 環境變數');
  return match[1];
}

function readSupabaseConfig() {
  const configuredUrl = process.env.SUPABASE_URL;
  const configuredKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;
  if (configuredUrl && configuredKey) return { url: configuredUrl, anonKey: configuredKey };

  const config = require('../supabase/supabase-config.js');
  const url = configuredUrl || config.SUPABASE_URL;
  const anonKey = configuredKey || config.SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error('缺少 Supabase URL 或 anon key');
  return { url, anonKey };
}

function createSupabaseClient() {
  const config = readSupabaseConfig();
  return createClient(config.url, config.anonKey);
}

function parseArgs(argv) {
  const options = {
    dryRun: true,
    from: '',
    to: '',
    kinds: Object.keys(KEY_PREFIXES),
    gasUrl: ''
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      if (index + 1 >= argv.length) throw new Error(`${arg} 缺少參數`);
      index += 1;
      return argv[index];
    };

    if (arg === '--write') options.dryRun = false;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--from') options.from = next();
    else if (arg === '--to') options.to = next();
    else if (arg === '--date') options.from = options.to = next();
    else if (arg === '--gas-url') options.gasUrl = next();
    else if (arg === '--kinds') {
      options.kinds = next().split(',').map(value => value.trim()).filter(Boolean);
      const aliases = { bulletin: 'bulletins', bulletin_draft: 'bulletins', report: 'reports', song: 'praise' };
      options.kinds = options.kinds.map(value => aliases[value] || value);
      if (options.kinds.some(kind => !TABLES[kind])) throw new Error(`不支援的資料類型：${options.kinds.join(', ')}`);
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else {
      throw new Error(`不認識的參數：${arg}`);
    }
  }

  return options;
}

function printUsage() {
  console.log([
    '用法：node scripts/sync_sunday_bulletin_gas_to_supabase.js [選項]',
    '',
    '預設為 dry-run；加入 --write 才會寫入 Supabase。',
    '--write                 執行只新增/更新的 upsert，不執行刪除',
    '--dry-run               只讀 GAS 並顯示計畫（預設）',
    '--from YYYY-MM-DD       起始日期（含）',
    '--to YYYY-MM-DD         結束日期（含）',
    '--date YYYY-MM-DD       只同步單一日期',
    '--kinds a,b,c           bulletins,reports,praise（預設全部）',
    '--gas-url URL           覆寫 GAS endpoint'
  ].join('\n'));
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    printUsage();
    return { options };
  }

  const gasUrl = options.gasUrl || readDefaultGasUrl();
  const loaded = await loadGasItems(gasUrl, {
    from: options.from,
    to: options.to,
    kinds: options.kinds
  });

  const counts = loaded.items.reduce((acc, item) => {
    acc[item.kind] += 1;
    return acc;
  }, { bulletins: 0, reports: 0, praise: 0 });
  console.log(`GAS 列表 ${loaded.listed} 筆；選取 ${loaded.keys.length} 筆；成功讀取 ${loaded.items.length} 筆。`);
  console.log(`同步計畫：完整週報 ${counts.bulletins}、消息/代禱 ${counts.reports}、讚美 ${counts.praise}。`);
  if (loaded.failures.length) {
    for (const failure of loaded.failures) console.error(`GAS 讀取失敗：${failure.key}：${failure.error}`);
  }

  const syncResult = await syncItems(loaded.items, {
    dryRun: options.dryRun,
    client: options.dryRun ? null : createSupabaseClient()
  });

  if (options.dryRun) {
    console.log(`DRY-RUN 完成：將 upsert ${syncResult.planned} 筆，未寫入 Supabase。`);
  } else {
    console.log(`Supabase 同步完成：upsert ${syncResult.upserted} 筆，失敗 ${syncResult.failed} 筆。`);
  }
  for (const failure of syncResult.failures) {
    console.error(`Supabase 寫入失敗：${failure.key}：${failure.error}`);
  }

  if (loaded.failures.length || syncResult.failed) process.exitCode = 1;
  return { options, loaded, syncResult };
}

if (require.main === module) {
  main().catch(error => {
    console.error(`同步中止：${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  KEY_PREFIXES,
  TABLES,
  buildGasListUrl,
  buildGasLoadUrl,
  getKeyKind,
  getDateFromKey,
  selectGasKeys,
  buildSupabaseRow,
  fetchJson,
  fetchJsonWithRetry,
  loadGasItems,
  syncItems,
  parseArgs,
  readDefaultGasUrl,
  readSupabaseConfig,
  main
};
