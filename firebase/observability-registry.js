/**
 * Shared observability vocabulary for the dashboard and browser logger.
 *
 * Keep this module free of Firebase imports so it can be used by tests and by
 * any future ingestion adapter without coupling the data contract to transport.
 */

export const ERROR_LEVELS = Object.freeze({
  critical: 'critical',
  error: 'error',
  warn: 'warn',
  info: 'info'
});

export const ERROR_LEVEL_META = Object.freeze({
  critical: Object.freeze({ label: '嚴重', shortLabel: 'Critical', rank: 4, tone: 'critical' }),
  error: Object.freeze({ label: '錯誤', shortLabel: 'Error', rank: 3, tone: 'error' }),
  warn: Object.freeze({ label: '警告', shortLabel: 'Warn', rank: 2, tone: 'warn' }),
  info: Object.freeze({ label: '資訊', shortLabel: 'Info', rank: 1, tone: 'info' })
});

export const LOG_SOURCES = Object.freeze([
  'api',
  'ui',
  'unhandled',
  'supabase',
  'firebase',
  'gas',
  'audio',
  'workflow',
  'unknown'
]);

export const SYSTEM_GROUPS = Object.freeze([
  Object.freeze({ id: 'administration', label: '行政與排程', order: 1 }),
  Object.freeze({ id: 'attendance', label: '出席與群組', order: 2 }),
  Object.freeze({ id: 'worship', label: '敬拜、公告與奉獻', order: 3 }),
  Object.freeze({ id: 'media', label: '媒體與製作', order: 4 }),
  Object.freeze({ id: 'tools', label: '交通與工具', order: 5 }),
  Object.freeze({ id: 'platform', label: '平台服務', order: 6 }),
  Object.freeze({ id: 'unknown', label: '未分類系統', order: 99 })
]);

const SYSTEM = (id, label, group, environment = 'production', extra = {}) => Object.freeze({
  id,
  label,
  group,
  environment,
  storageId: extra.storageId || id,
  ...extra
});

export const OBSERVABILITY_SYSTEMS = Object.freeze([
  SYSTEM('LKC_NewFamily', '新家人系統', 'administration'),
  SYSTEM('LKC_MemberStatus', '會友狀態', 'administration'),
  SYSTEM('LKC_MinistrySchedule', '事工排程', 'administration'),
  SYSTEM('LKC_MinistrySchedule_TEST', '事工排程（測試）', 'administration', 'test', { variantOf: 'LKC_MinistrySchedule' }),
  SYSTEM('LKC_MasterSchedule', '教會行事曆', 'administration'),

  SYSTEM('LKC_ChildrenAttendance', '兒童點名', 'attendance'),
  SYSTEM('LKC_SundayserviceAttendance', '主日點名', 'attendance'),
  SYSTEM('LKC_SundayserviceAttendance_TEST', '主日點名（測試）', 'attendance', 'test', { variantOf: 'LKC_SundayserviceAttendance' }),
  SYSTEM('LKC_Group', '小組系統', 'attendance'),
  SYSTEM('LKC_Group_TEST', '小組系統（測試）', 'attendance', 'test', { variantOf: 'LKC_Group' }),

  SYSTEM('LKC_worship', '敬拜團', 'worship'),
  SYSTEM('LKC_Offering', '奉獻系統', 'worship'),
  SYSTEM('LKC_SundayBulletin', '主日週報', 'worship'),

  SYSTEM('LKC_TaiwaneseAudioBible', '台語聖經音訊', 'media'),
  SYSTEM('LKC_PrayerPPT', '禱告簡報', 'media'),
  SYSTEM('LKC_WorshipPPT', '敬拜簡報', 'media'),
  SYSTEM('LKC_ppt_generator', '簡報產生器', 'media'),

  SYSTEM('LKC_WhosCar', '誰的車', 'tools'),
  SYSTEM('qrcodescanner.github.io', 'QR Code 掃描器', 'tools', 'production', { storageId: 'qrcodescanner_github_io' }),

  SYSTEM('firebase', 'Firebase 平台', 'platform'),
  SYSTEM('supabase', 'Supabase 平台', 'platform'),
  SYSTEM('github-actions', 'GitHub Actions', 'platform')
]);

const SYSTEM_BY_ID = new Map(OBSERVABILITY_SYSTEMS.map(system => [system.id, system]));
const SYSTEM_BY_STORAGE_ID = new Map(OBSERVABILITY_SYSTEMS.map(system => [system.storageId, system]));
OBSERVABILITY_SYSTEMS.forEach(system => {
  (system.aliases || []).forEach(alias => SYSTEM_BY_ID.set(alias, system));
});
const GROUP_BY_ID = new Map(SYSTEM_GROUPS.map(group => [group.id, group]));
const LEVEL_SET = new Set(Object.values(ERROR_LEVELS));
const SOURCE_ALIASES = Object.freeze({
  'config.js': 'api',
  config: 'api',
  api: 'api',
  browser: 'ui',
  frontend: 'ui',
  ui: 'ui',
  'window.onerror': 'unhandled',
  unhandledrejection: 'unhandled',
  unhandled: 'unhandled',
  supabase: 'supabase',
  firebase: 'firebase',
  gas: 'gas',
  audio: 'audio',
  workflow: 'workflow'
});

const ILLEGAL_SYSTEM_CHARS = /[.#$/\[\]\u0000-\u001f\u007f]/g;

function text(value, maxLength = 500) {
  if (value === null || value === undefined) return '';
  return String(value).trim().slice(0, maxLength);
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function normalizeSystemId(value) {
  return text(value || 'unknown', 160) || 'unknown';
}

function storageSystemId(value) {
  return normalizeSystemId(value).replace(ILLEGAL_SYSTEM_CHARS, '_') || 'unknown';
}

function normalizeEnvironment(value, system) {
  const raw = text(value).toLowerCase();
  if (raw === 'prod' || raw === 'production') return 'production';
  if (raw === 'test' || raw === 'testing') return 'test';
  if (raw === 'dev' || raw === 'development') return 'development';
  if (raw === 'stage' || raw === 'staging') return 'staging';
  if (raw) return raw.slice(0, 40);
  return system.environment || 'unknown';
}

function normalizeLevel(value) {
  const candidate = text(value).toLowerCase();
  return LEVEL_SET.has(candidate) ? candidate : ERROR_LEVELS.info;
}

function normalizeSource(value) {
  const candidate = text(value).toLowerCase();
  return SOURCE_ALIASES[candidate] || (LOG_SOURCES.includes(candidate) ? candidate : 'unknown');
}

function normalizeEndpoint(value) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'string') return value.trim().slice(0, 400);
  try {
    return JSON.stringify(value).slice(0, 400);
  } catch {
    return '[unserializable]';
  }
}

function hashFingerprint(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fp_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function getSystemDefinition(systemId) {
  const normalizedId = normalizeSystemId(systemId);
  return SYSTEM_BY_ID.get(normalizedId)
    || SYSTEM_BY_STORAGE_ID.get(normalizedId)
    || SYSTEM_BY_STORAGE_ID.get(storageSystemId(normalizedId))
    || SYSTEM(storageSystemId(normalizedId), storageSystemId(normalizedId), 'unknown', 'unknown');
}

export function getSystemGroup(systemId) {
  return GROUP_BY_ID.get(getSystemDefinition(systemId).group) || GROUP_BY_ID.get('unknown');
}

export function normalizeLogEntry(entry = {}, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const system = getSystemDefinition(entry.system);
  const systemId = system.id;
  const level = normalizeLevel(entry.level);
  const source = normalizeSource(entry.source || 'unknown');
  const errorType = text(entry.errorType || (entry.meta && entry.meta.errorType));
  const action = text(entry.action);
  const message = text(entry.message);
  const fingerprintInput = [systemId, source, level, errorType, action, message]
    .map(value => value.toLowerCase())
    .join('|');

  return {
    schemaVersion: 1,
    time: text(entry.time) || now.toISOString(),
    system: systemId,
    systemStorageKey: system.storageId || storageSystemId(systemId),
    level,
    source,
    environment: normalizeEnvironment(entry.environment, system),
    appVersion: text(entry.appVersion, 120),
    sessionId: text(entry.sessionId, 160),
    requestId: text(entry.requestId || (entry.meta && entry.meta.requestId), 160),
    action,
    message,
    errorType,
    endpoint: normalizeEndpoint(entry.endpoint),
    page: text(entry.page, 400),
    durationMs: numberOrNull(entry.durationMs),
    fingerprint: text(entry.fingerprint, 80) || hashFingerprint(fingerprintInput),
    cache: entry.cache || {},
    payload: entry.payload || {},
    invalidation: entry.invalidation || {},
    meta: entry.meta && typeof entry.meta === 'object' ? entry.meta : {}
  };
}
