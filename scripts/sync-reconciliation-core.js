'use strict';

const crypto = require('node:crypto');

const STATUS = Object.freeze({
  MATCHED: 'MATCHED',
  GAS_ONLY: 'GAS_ONLY',
  SUPABASE_ONLY: 'SUPABASE_ONLY',
  CONTENT_MISMATCH: 'CONTENT_MISMATCH',
  DELETE_MISMATCH: 'DELETE_MISMATCH',
  SOURCE_UNAVAILABLE: 'SOURCE_UNAVAILABLE',
  INVALID_IDENTITY: 'INVALID_IDENTITY'
});

const COMPARISON_STATUSES = [
  STATUS.MATCHED,
  STATUS.GAS_ONLY,
  STATUS.SUPABASE_ONLY,
  STATUS.CONTENT_MISMATCH,
  STATUS.DELETE_MISMATCH,
  STATUS.INVALID_IDENTITY
];

function pad2(value) {
  return String(value).padStart(2, '0');
}

function datePartsInTimeZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const result = {};
  parts.forEach(part => {
    if (part.type !== 'literal') result[part.type] = part.value;
  });
  return result;
}

function toDateOnly(value, timeZone = 'Asia/Taipei') {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error('無效日期');
    const parts = datePartsInTimeZone(value, timeZone);
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  const text = String(value || '').trim();
  const match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!match) throw new Error(`無法解析日期：${text}`);

  const date = `${match[1]}-${pad2(match[2])}-${pad2(match[3])}`;
  const check = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(check.getTime()) || check.toISOString().slice(0, 10) !== date) {
    throw new Error(`無效日期：${text}`);
  }
  return date;
}

function addDays(dateOnly, days) {
  const date = new Date(`${dateOnly}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

function buildDateWindow({ now = new Date(), days = 365, timeZone = 'Asia/Taipei' } = {}) {
  const normalizedDays = Number(days);
  if (!Number.isInteger(normalizedDays) || normalizedDays < 1) {
    throw new Error('days 必須是正整數');
  }

  const end = toDateOnly(now, timeZone);
  return {
    start: addDays(end, -(normalizedDays - 1)),
    end,
    days: normalizedDays,
    timeZone
  };
}

function normalizeValue(value, options = {}) {
  const sortArrays = Boolean(options.sortArrays);
  const ignoredKeys = new Set((options.ignoredKeys || []).map(String));

  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();

  if (Array.isArray(value)) {
    const items = value.map(item => normalizeValue(item, options));
    return sortArrays
      ? items.slice().sort((left, right) => stableStringify(left).localeCompare(stableStringify(right)))
      : items;
  }

  if (typeof value === 'object') {
    return Object.keys(value)
      .filter(key => !ignoredKeys.has(key))
      .sort()
      .reduce((result, key) => {
        result[key] = normalizeValue(value[key], options);
        return result;
      }, {});
  }

  return String(value).trim();
}

function stableStringify(value) {
  return JSON.stringify(value);
}

function fingerprint(value, options = {}) {
  const canonical = normalizeValue(value, options);
  return crypto.createHash('sha256').update(stableStringify(canonical)).digest('hex');
}

function collectDiffPaths(left, right, path = '', output = []) {
  if (stableStringify(left) === stableStringify(right)) return output;

  if (Array.isArray(left) || Array.isArray(right)) {
    output.push(path || '$');
    return output;
  }

  if (left && right && typeof left === 'object' && typeof right === 'object') {
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    keys.forEach(key => {
      collectDiffPaths(left[key], right[key], path ? `${path}.${key}` : key, output);
    });
    return output;
  }

  output.push(path || '$');
  return output;
}

function indexRecords(records, keyOf, source) {
  const map = new Map();
  const duplicates = new Map();

  for (const record of records || []) {
    const rawKey = keyOf(record);
    const key = rawKey === undefined || rawKey === null ? '' : String(rawKey).trim();
    if (!key) {
      const list = duplicates.get('__missing__') || [];
      list.push(record);
      duplicates.set('__missing__', list);
      continue;
    }
    if (map.has(key)) {
      const list = duplicates.get(key) || [map.get(key)];
      list.push(record);
      duplicates.set(key, list);
      continue;
    }
    map.set(key, record);
  }

  return { map, duplicates, source };
}

function emptyCounts() {
  return {};
}

function compareRecords({
  domain,
  gasRecords = [],
  supabaseRecords = [],
  keyOf,
  normalizeGas = value => value,
  normalizeSupabase = value => value,
  sourceStatus,
  sourceError
} = {}) {
  if (!domain) throw new Error('compareRecords 需要 domain');
  if (typeof keyOf !== 'function') throw new Error('compareRecords 需要 keyOf');

  const counts = emptyCounts();
  if (sourceStatus === STATUS.SOURCE_UNAVAILABLE) {
    counts[STATUS.SOURCE_UNAVAILABLE] = 1;
    return {
      domain,
      counts,
      items: [{
        domain,
        key: '__source__',
        status: STATUS.SOURCE_UNAVAILABLE,
        error: String(sourceError || '來源不可用')
      }]
    };
  }

  const gasIndex = indexRecords(gasRecords, keyOf, 'gas');
  const supabaseIndex = indexRecords(supabaseRecords, keyOf, 'supabase');
  const allKeys = new Set([
    ...gasIndex.map.keys(),
    ...supabaseIndex.map.keys(),
    ...gasIndex.duplicates.keys(),
    ...supabaseIndex.duplicates.keys()
  ]);
  const items = [];

  for (const key of allKeys) {
    const gasDuplicates = gasIndex.duplicates.get(key) || [];
    const supabaseDuplicates = supabaseIndex.duplicates.get(key) || [];
    if (gasDuplicates.length || supabaseDuplicates.length || key === '__missing__') {
      counts[STATUS.INVALID_IDENTITY] = (counts[STATUS.INVALID_IDENTITY] || 0) + 1;
      items.push({
        domain,
        key,
        status: STATUS.INVALID_IDENTITY,
        duplicateCounts: {
          gas: gasDuplicates.length,
          supabase: supabaseDuplicates.length
        }
      });
      continue;
    }

    const gasRecord = gasIndex.map.get(key);
    const supabaseRecord = supabaseIndex.map.get(key);
    if (!gasRecord) {
      counts[STATUS.SUPABASE_ONLY] = (counts[STATUS.SUPABASE_ONLY] || 0) + 1;
      items.push({ domain, key, status: STATUS.SUPABASE_ONLY });
      continue;
    }
    if (!supabaseRecord) {
      counts[STATUS.GAS_ONLY] = (counts[STATUS.GAS_ONLY] || 0) + 1;
      items.push({ domain, key, status: STATUS.GAS_ONLY });
      continue;
    }

    const gasCanonical = normalizeGas(gasRecord);
    const supabaseCanonical = normalizeSupabase(supabaseRecord);
    const gasHash = fingerprint(gasCanonical);
    const supabaseHash = fingerprint(supabaseCanonical);
    if (gasHash === supabaseHash) {
      counts[STATUS.MATCHED] = (counts[STATUS.MATCHED] || 0) + 1;
      items.push({ domain, key, status: STATUS.MATCHED, gasHash, supabaseHash });
      continue;
    }

    counts[STATUS.CONTENT_MISMATCH] = (counts[STATUS.CONTENT_MISMATCH] || 0) + 1;
    items.push({
      domain,
      key,
      status: STATUS.CONTENT_MISMATCH,
      gasHash,
      supabaseHash,
      diffPaths: collectDiffPaths(gasCanonical, supabaseCanonical)
    });
  }

  return { domain, counts, items };
}

function mergeCounts(results) {
  const counts = emptyCounts();
  for (const result of results || []) {
    Object.entries(result.counts || {}).forEach(([status, count]) => {
      counts[status] = (counts[status] || 0) + Number(count || 0);
    });
  }
  return counts;
}

function summarizeResults(results) {
  const counts = mergeCounts(results);
  return {
    domains: (results || []).map(result => result.domain),
    counts,
    total: Object.values(counts).reduce((sum, count) => sum + count, 0),
    matched: counts[STATUS.MATCHED] || 0,
    actionable: [
      STATUS.GAS_ONLY,
      STATUS.SUPABASE_ONLY,
      STATUS.CONTENT_MISMATCH,
      STATUS.DELETE_MISMATCH,
      STATUS.INVALID_IDENTITY
    ].reduce((sum, status) => sum + (counts[status] || 0), 0),
    sourceUnavailable: counts[STATUS.SOURCE_UNAVAILABLE] || 0
  };
}

module.exports = {
  STATUS,
  addDays,
  buildDateWindow,
  collectDiffPaths,
  compareRecords,
  fingerprint,
  mergeCounts,
  normalizeValue,
  stableStringify,
  summarizeResults,
  toDateOnly
};
