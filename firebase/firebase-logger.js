import { rtdb } from './firebase-config.js';
import {
  ref, push, set
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";
import { normalizeLogEntry } from './observability-registry.js';

const ROOT = 'logs';
const MAX_META_TEXT = 500;

function _pad(n) {
  return String(n).padStart(2, '0');
}

function _localDateKey(date) {
  return `${date.getFullYear()}-${_pad(date.getMonth() + 1)}-${_pad(date.getDate())}`;
}

function _sanitizeMeta(value, depth = 0) {
  if (value === null || value === undefined) return null;
  if (depth > 3) return '[max-depth]';
  if (typeof value === 'string') return value.length > MAX_META_TEXT ? value.slice(0, MAX_META_TEXT) + '...' : value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 20).map(item => _sanitizeMeta(item, depth + 1));
  if (typeof value !== 'object') return String(value);

  const out = {};
  Object.keys(value).slice(0, 30).forEach(key => {
    const val = _sanitizeMeta(value[key], depth + 1);
    if (val !== undefined && val !== null) {
      out[key.replace(/[.#$/\[\]\u0000-\u001f\u007f]/g, '_') || '_empty'] = val;
    }
  });
  return out;
}

export async function writeLog(entry = {}) {
  const now = new Date();
  const normalized = normalizeLogEntry({
    ...entry,
    page: entry.page || (typeof location !== 'undefined' ? location.pathname + location.search : '')
  }, { now });
  const system = normalized.systemStorageKey || normalized.system;
  const systemName = normalized.system;
  const dateKey = _localDateKey(now);
  const logRef = push(ref(rtdb, `${ROOT}/${system}/${dateKey}`));
  const meta = _sanitizeMeta(normalized.meta || {});

  await set(logRef, {
    ...normalized,
    schemaVersion: normalized.schemaVersion,
    time: normalized.time || now.toISOString(),
    system: systemName,
    source: normalized.source,
    fingerprint: normalized.fingerprint,
    cache: _sanitizeMeta(normalized.cache || (meta && meta.cache) || {}),
    payload: _sanitizeMeta(normalized.payload || (meta && meta.payload) || {}),
    invalidation: _sanitizeMeta(normalized.invalidation || (meta && meta.invalidation) || {}),
    meta
  });
}
