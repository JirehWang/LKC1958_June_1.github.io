'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createClient } = require('@supabase/supabase-js');

const {
  STATUS,
  addDays,
  buildDateWindow,
  compareRecords,
  normalizeValue,
  summarizeResults,
  toDateOnly
} = require('./sync-reconciliation-core.js');
const {
  buildSupabaseRow,
  loadGasItems,
  readDefaultGasUrl
} = require('./sync_sunday_bulletin_gas_to_supabase.js');
const { SyncLedgerClient } = require('./sync-ledger-client.js');

const DEFAULT_TIME_ZONE = 'Asia/Taipei';
const DEFAULT_DAYS = 365;

const DEFAULT_DOMAINS = Object.freeze([
  'church_members',
  'attendance_records',
  'new_family_cases',
  'groups',
  'group_members',
  'group_attendance_records',
  'sunday_bulletins',
  'sunday_bulletin_reports',
  'praise_index'
]);

const NEW_FAMILY_FIELDS = Object.freeze({
  '表單號': 'form_number',
  '姓名': 'name',
  '性別': 'gender',
  '聚會別': 'service_type',
  '職業': 'occupation',
  '年齡': 'age_group',
  '是否曾接觸教會': 'contacted_church_before',
  '來訪原因': 'visit_reason',
  '關懷同工': 'assigned_staff',
  '地址': 'address',
  '市話': 'tel',
  '手機': 'phone',
  '首次來訪日': 'first_visit_date',
  '結案日期': 'closed_date',
  '落戶狀態': 'settlement_status',
  '邀約人': 'inviter',
  '備註': 'notes',
  '會友狀態': 'member_status',
  '點名編號': 'member_code',
  '現行小組': 'current_group'
});

class SourceUnavailableError extends Error {
  constructor(source, message, details = {}) {
    super(message);
    this.name = 'SourceUnavailableError';
    this.source = source;
    this.details = details;
  }
}

function text(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function numberValue(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function booleanValue(value) {
  if (value === true || value === 1) return true;
  return ['true', 'yes', 'y', '1'].includes(text(value).toLowerCase());
}

function dateOnly(value) {
  if (value === null || value === undefined || value === '') return '';
  try {
    return toDateOnly(value, DEFAULT_TIME_ZONE);
  } catch (error) {
    const match = text(value).match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (!match) return '';
    return [
      match[1],
      String(match[2]).padStart(2, '0'),
      String(match[3]).padStart(2, '0')
    ].join('-');
  }
}

function coerceList(value) {
  if (Array.isArray(value)) {
    return value.map(text).filter(Boolean);
  }
  const raw = text(value);
  if (!raw) return [];
  if ((raw.startsWith('[') && raw.endsWith(']')) || (raw.startsWith('"') && raw.endsWith('"'))) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map(text).filter(Boolean);
      if (typeof parsed === 'string') return [parsed.trim()].filter(Boolean);
    } catch (error) {
      // Fall through to the spreadsheet-compatible delimiters.
    }
  }
  return raw.split(/[,，、]\s*/).map(text).filter(Boolean);
}

function sortedList(value) {
  return coerceList(value).sort((left, right) => left.localeCompare(right));
}

function uniqueByKey(records, keyOf) {
  const map = new Map();
  for (const record of records || []) {
    const key = text(keyOf(record));
    if (key) map.set(key, record);
  }
  return [...map.values()];
}

function unwrapData(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Object.prototype.hasOwnProperty.call(payload, 'data')) return payload.data;
  return payload;
}

function assertSuccessfulPayload(payload, label) {
  if (payload && payload.success === false) {
    throw new Error(label + '：' + text(payload.error || payload.message || 'GAS 回傳失敗'));
  }
  if (payload && payload.error && payload.data === undefined) {
    throw new Error(label + '：' + text(payload.error));
  }
  return payload;
}

function makeRunId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'run-' + Date.now() + '-' + Math.random().toString(16).slice(2);
}

function readConfigUrl(key) {
  const configPath = path.join(__dirname, '..', 'config.js');
  const source = fs.readFileSync(configPath, 'utf8');
  const escapedKey = key.replace(/[.*+?^\u0024{}()|[\]\\]/g, '\\$&');
  const expression = new RegExp('["]' + escapedKey + '["]\\s*:\\s*["]([^"]+)["]');
  const match = source.match(expression);
  if (!match) throw new Error('找不到 config.js URL：' + key);
  return match[1];
}

function resolveUrl(value, configKey) {
  const configured = text(value);
  if (configured) return configured;
  return readConfigUrl(configKey);
}

function readSupabaseConfig(env = process.env) {
  const localConfig = require('../supabase/supabase-config.js');
  const url = text(env.SUPABASE_URL || localConfig.SUPABASE_URL);
  const key = text(
    env.SUPABASE_SERVICE_ROLE_KEY
      || env.SUPABASE_ANON_KEY
      || env.SUPABASE_KEY
      || localConfig.SUPABASE_ANON_KEY
  );
  if (!url || !key) throw new Error('缺少 Supabase URL 或 key');
  return { url, key, usingServiceRole: Boolean(text(env.SUPABASE_SERVICE_ROLE_KEY)) };
}

function readAuditConfig(env = process.env) {
  return {
    ledgerUrl: text(env.SYNC_LEDGER_GAS_URL),
    ledgerToken: text(env.SYNC_LEDGER_GAS_TOKEN),
    mainGasUrl: resolveUrl(env.SUNDAY_ATTENDANCE_GAS_URL, 'LKC_SundayserviceAttendance'),
    mainGasToken: text(env.SUNDAY_ATTENDANCE_GAS_TOKEN || env.GAS_AUTH_TOKEN),
    newFamilyGasUrl: resolveUrl(env.NEW_FAMILY_GAS_URL, 'LKC_NewFamily'),
    newFamilyGasToken: text(env.NEW_FAMILY_GAS_TOKEN || env.GAS_AUTH_TOKEN),
    bulletinGasUrl: text(env.BULLETIN_GAS_URL || env.GAS_SYNC_URL) || readDefaultGasUrl(),
    groupAdminCode: text(env.GROUP_ADMIN_CODE),
    supabase: readSupabaseConfig(env)
  };
}

async function parseResponse(response, url) {
  if (!response || response.ok === false) {
    throw new Error('HTTP ' + (response && response.status ? response.status : '錯誤') + '：' + url);
  }
  const raw = typeof response.text === 'function' ? await response.text() : await response.json();
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error('回應不是有效 JSON：' + text(raw).slice(0, 120));
  }
}

async function postJson(url, body, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('目前 Node 執行環境沒有可用的 fetch');
  const timeoutMs = Number(options.timeoutMs || 60000);
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      signal: controller ? controller.signal : undefined
    });
    return await parseResponse(response, url);
  } catch (error) {
    if (error && error.name === 'AbortError') {
      throw new Error('請求逾時（' + timeoutMs + 'ms）：' + url);
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function postJsonWithRetry(url, body, options = {}) {
  const attempts = Math.max(1, Number(options.retryAttempts || 3));
  const delayMs = Math.max(0, Number(options.retryDelayMs ?? 750));
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await postJson(url, body, options);
    } catch (error) {
      lastError = error;
      if (attempt < attempts && delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, delayMs * attempt));
      }
    }
  }
  throw lastError;
}

function createGasReader(config, options = {}) {
  const requestOptions = {
    fetchImpl: options.fetchImpl || globalThis.fetch,
    timeoutMs: options.timeoutMs || 60000,
    retryAttempts: options.retryAttempts || 3,
    retryDelayMs: options.retryDelayMs ?? 750
  };

  const call = async (url, action, data, token) => {
    if (!text(url)) throw new SourceUnavailableError('GAS', '缺少 GAS endpoint：' + action);
    const payload = await postJsonWithRetry(url, {
      action,
      token: text(token),
      data: data || {},
      payload: data || {}
    }, requestOptions);
    return assertSuccessfulPayload(payload, action);
  };

  return {
    main: (action, data) => call(config.mainGasUrl, action, data, config.mainGasToken),
    newFamily: (action, data) => call(config.newFamilyGasUrl, action, data, config.newFamilyGasToken),
    bulletin: config.bulletinGasUrl
  };
}

function normalizeMemberGas(record) {
  const row = Array.isArray(record)
    ? {
        name: record[0],
        gender: record[1],
        note: record[3],
        is_excluded: record[4],
        uid: record[7],
        group_name: record[8],
        role: record[9]
      }
    : (record || {});
  return {
    uid: text(row.uid),
    name: text(row.name),
    gender: text(row.gender),
    group_name: text(row.group_name || row.group),
    role: text(row.role || '小羊'),
    is_excluded: booleanValue(row.is_excluded),
    note: text(row.note || (row.metadata && row.metadata.note))
  };
}

function normalizeMemberSupabase(record) {
  return normalizeMemberGas(record || {});
}

function normalizeAttendance(record) {
  const row = record || {};
  return {
    service_type: text(row.service_type || row.serviceType),
    date: dateOnly(row.date),
    present_uids: sortedList(row.present_uids || row.present_members),
    new_friends_male: numberValue(row.new_friends_male || row.nfMale),
    new_friends_female: numberValue(row.new_friends_female || row.nfFemale)
  };
}

function normalizeNewFamily(record, statusOverride) {
  const row = record || {};
  const normalized = {};
  Object.entries(NEW_FAMILY_FIELDS).forEach(([gasField, dbField]) => {
    const value = row[gasField] !== undefined ? row[gasField] : row[dbField];
    normalized[dbField] = dbField.endsWith('_date') ? dateOnly(value) : text(value);
  });
  normalized.form_number = text(normalized.form_number);
  normalized.status = text(statusOverride || row.status || 'tracking');
  return normalized;
}

function normalizeBulletin(record) {
  return {
    date: dateOnly(record.date),
    service_type: text(record.service_type),
    taiwanese: record.taiwanese || {},
    mandarin: record.mandarin || {},
    ministry: record.ministry || {},
    attendance: record.attendance || {},
    events: Array.isArray(record.events) ? record.events : [],
    announcements: Array.isArray(record.announcements) ? record.announcements : [],
    church_news: Array.isArray(record.church_news) ? record.church_news : [],
    prayer: record.prayer || {},
    offering_report: record.offering_report || {},
    data: record.data || {}
  };
}

function normalizeReport(record) {
  return {
    date: dateOnly(record.date),
    announcements: Array.isArray(record.announcements) ? record.announcements : [],
    church_news: Array.isArray(record.church_news) ? record.church_news : [],
    prayer: record.prayer || {}
  };
}

function normalizePraiseTitle(record) {
  return { title: text(record && (record.title || record.name)) };
}

function normalizeGroup(record) {
  const row = record || {};
  return {
    uuid: text(row.uuid),
    name: text(row.name),
    code: text(row.code),
    status: text(row.status || '顯示'),
    type: text(row.type || row.group_type || row.groupType || '一般小組'),
    associated_group: text(row.associated_group || row.associatedGroup),
    date: dateOnly(row.date)
  };
}

function normalizeGroupMember(record) {
  const row = record || {};
  return {
    group_name: text(row.group_name || row.group),
    uid: text(row.uid),
    name: text(row.name),
    role: text(row.role || '小羊')
  };
}

function normalizeGroupAttendance(record) {
  const row = record || {};
  return {
    group_name: text(row.group_name || row.groupName),
    date: dateOnly(row.date),
    present_uids: sortedList(row.present_uids || row.present_members),
    absent_uids: sortedList(row.absent_uids || row.absent_members),
    new_friends: sortedList(row.new_friends || row.newFriends)
  };
}

function keyAttendance(row) {
  return text(row.service_type) + '|' + text(row.date);
}

function keyNewFamily(row) {
  return text(row.form_number);
}

function keyGroup(row) {
  return text(row.uuid) || text(row.name);
}

function keyGroupMember(row) {
  return text(row.group_name) + '|' + text(row.uid);
}

function keyGroupAttendance(row) {
  return text(row.group_name) + '|' + text(row.date);
}

function canonicalOptions(sortArrays = false) {
  return value => normalizeValue(value, { sortArrays });
}

async function fetchSupabaseRows(client, table, filters = {}, options = {}) {
  if (!client || typeof client.from !== 'function') {
    throw new SourceUnavailableError('Supabase', '缺少 Supabase client');
  }
  const pageSize = Math.max(1, Number(options.pageSize || 1000));
  const rows = [];
  let page = 0;

  while (true) {
    let query = client.from(table).select('*');
    if (filters.gte) query = query.gte(filters.gte[0], filters.gte[1]);
    if (filters.lte) query = query.lte(filters.lte[0], filters.lte[1]);
    if (filters.eq) query = query.eq(filters.eq[0], filters.eq[1]);
    const canPage = typeof query.range === 'function';
    if (canPage) query = query.range(page * pageSize, page * pageSize + pageSize - 1);
    const response = await query;
    if (response && response.error) throw response.error;
    const data = response && Array.isArray(response.data) ? response.data : [];
    rows.push(...data);
    if (data.length < pageSize || !canPage) break;
    page += 1;
  }
  return rows;
}

function ensureArray(value, label) {
  if (!Array.isArray(value)) throw new Error(label + ' 回應不是陣列');
  return value;
}

function getGroupList(payload) {
  if (payload && Array.isArray(payload.groups)) return payload.groups;
  const data = unwrapData(payload);
  if (data && Array.isArray(data.groups)) return data.groups;
  return ensureArray(data, '小組清單');
}

function createDomainAdapters({ config, gas, supabase, fetchImpl } = {}) {
  if (!config) throw new Error('createDomainAdapters 需要 config');
  if (!gas) throw new Error('createDomainAdapters 需要 gas reader');

  const adapters = {};

  adapters.church_members = {
    domain: 'church_members',
    async load() {
      const payload = await gas.main('getAllMembers', {});
      const raw = unwrapData(payload);
      const gasRecords = ensureArray(raw, 'GAS 會友名單').map(normalizeMemberGas);
      const supabaseRecords = (await fetchSupabaseRows(supabase, 'church_members')).map(normalizeMemberSupabase);
      return { gasRecords, supabaseRecords, keyOf: row => text(row.uid), normalizeGas: canonicalOptions(), normalizeSupabase: canonicalOptions() };
    }
  };

  adapters.attendance_records = {
    domain: 'attendance_records',
    async load({ window }) {
      const payload = await gas.main('getAttendanceRecords', {
        types: ['台語', '華語', '聯合'],
        start: window.start,
        end: addDays(window.end, 1)
      });
      const gasRecords = ensureArray(unwrapData(payload), 'GAS 主日出席').map(normalizeAttendance);
      const supabaseRecords = (await fetchSupabaseRows(supabase, 'attendance_records', {
        gte: ['date', window.start],
        lte: ['date', window.end]
      })).map(normalizeAttendance);
      return { gasRecords, supabaseRecords, keyOf: keyAttendance, normalizeGas: canonicalOptions(true), normalizeSupabase: canonicalOptions(true) };
    }
  };

  adapters.new_family_cases = {
    domain: 'new_family_cases',
    async load({ window }) {
      const [trackingPayload, closedPayload] = await Promise.all([
        gas.newFamily('getTrackingCases', { startDate: window.start, endDate: window.end }),
        gas.newFamily('getClosedCases', { startDate: window.start, endDate: window.end })
      ]);
      const tracking = ensureArray(unwrapData(trackingPayload), 'GAS 追蹤中案件')
        .map(row => normalizeNewFamily(row, 'tracking'));
      const closed = ensureArray(unwrapData(closedPayload), 'GAS 已結案案件')
        .map(row => normalizeNewFamily(row, 'closed'));
      const gasRecords = tracking.concat(closed);
      const supabaseRecords = (await fetchSupabaseRows(supabase, 'new_family_cases', {
        gte: ['first_visit_date', window.start],
        lte: ['first_visit_date', window.end]
      })).map(row => normalizeNewFamily(row));
      return { gasRecords, supabaseRecords, keyOf: keyNewFamily, normalizeGas: canonicalOptions(), normalizeSupabase: canonicalOptions() };
    }
  };

  adapters.groups = {
    domain: 'groups',
    async load() {
      const payload = await gas.main('getGroups', {});
      const gasRecords = getGroupList(payload).map(normalizeGroup);
      const supabaseRecords = (await fetchSupabaseRows(supabase, 'groups')).map(normalizeGroup);
      return { gasRecords, supabaseRecords, keyOf: keyGroup, normalizeGas: canonicalOptions(), normalizeSupabase: canonicalOptions() };
    }
  };

  adapters.group_members = {
    domain: 'group_members',
    async load() {
      if (!config.groupAdminCode) {
        throw new SourceUnavailableError('GAS', '缺少 GROUP_ADMIN_CODE，無法讀取小組成員總表');
      }
      const payload = await gas.main('getAllGroupMembers', { authCode: config.groupAdminCode });
      const data = unwrapData(payload);
      const gasRecords = ensureArray(data && data.data !== undefined ? data.data : data, 'GAS 小組成員').map(normalizeGroupMember);
      const supabaseRecords = (await fetchSupabaseRows(supabase, 'group_members')).map(normalizeGroupMember);
      return { gasRecords, supabaseRecords, keyOf: keyGroupMember, normalizeGas: canonicalOptions(), normalizeSupabase: canonicalOptions() };
    }
  };

  adapters.group_attendance_records = {
    domain: 'group_attendance_records',
    async load({ window }) {
      if (!config.groupAdminCode) {
        throw new SourceUnavailableError('GAS', '缺少 GROUP_ADMIN_CODE，無法讀取小組點名紀錄');
      }
      const groupsPayload = await gas.main('getGroups', {});
      const groups = getGroupList(groupsPayload);
      const gasRecords = [];

      for (const group of groups) {
        const groupName = text(group && group.name);
        if (!groupName) continue;
        const statsPayload = await gas.main('getStats', {
          groupName,
          groupCode: config.groupAdminCode,
          startDate: 'RAW_MODE'
        });
        if (statsPayload && statsPayload.success === false) {
          throw new Error('GAS 小組 ' + groupName + '：' + text(statsPayload.message || statsPayload.error));
        }
        const rawRows = statsPayload && Array.isArray(statsPayload.data)
          ? statsPayload.data
          : ensureArray(unwrapData(statsPayload), 'GAS 小組點名');
        rawRows.forEach(row => {
          if (!Array.isArray(row)) return;
          const date = dateOnly(row[0]);
          if (!date || date < window.start || date > window.end) return;
          gasRecords.push(normalizeGroupAttendance({
            group_name: groupName,
            date,
            present_uids: row[1],
            absent_uids: row[2],
            new_friends: row[3]
          }));
        });
      }

      const supabaseRecords = (await fetchSupabaseRows(supabase, 'group_attendance_records', {
        gte: ['date', window.start],
        lte: ['date', window.end]
      })).map(normalizeGroupAttendance);
      return { gasRecords, supabaseRecords, keyOf: keyGroupAttendance, normalizeGas: canonicalOptions(true), normalizeSupabase: canonicalOptions(true) };
    }
  };

  async function loadBulletinDomain(domain, kind, normalizer, table, window) {
    const loaded = await loadGasItems(gas.bulletin, {
      from: window.start,
      to: window.end,
      kinds: [kind],
      requestOptions: { fetchImpl }
    });
    if (loaded.failures.length) {
      throw new SourceUnavailableError('GAS', domain + ' 有 ' + loaded.failures.length + ' 筆無法讀取', {
        failures: loaded.failures.slice(0, 20)
      });
    }
    const gasRecords = loaded.items.map(item => normalizer(buildSupabaseRow(item).row));
    const supabaseRecords = (await fetchSupabaseRows(supabase, table, {
      gte: ['date', window.start],
      lte: ['date', window.end]
    })).map(normalizer);
    return {
      gasRecords,
      supabaseRecords,
      keyOf: row => text(row.date),
      normalizeGas: canonicalOptions(false),
      normalizeSupabase: canonicalOptions(false)
    };
  }

  adapters.sunday_bulletins = {
    domain: 'sunday_bulletins',
    async load({ window }) {
      return loadBulletinDomain('sunday_bulletins', 'bulletins', normalizeBulletin, 'sunday_bulletins', window);
    }
  };

  adapters.sunday_bulletin_reports = {
    domain: 'sunday_bulletin_reports',
    async load({ window }) {
      return loadBulletinDomain('sunday_bulletin_reports', 'reports', normalizeReport, 'sunday_bulletin_reports', window);
    }
  };

  adapters.praise_index = {
    domain: 'praise_index',
    async load() {
      const loaded = await loadGasItems(gas.bulletin, {
        kinds: ['praise'],
        requestOptions: { fetchImpl }
      });
      if (loaded.failures.length) {
        throw new SourceUnavailableError('GAS', '讚美詩索引有 ' + loaded.failures.length + ' 筆無法讀取', {
          failures: loaded.failures.slice(0, 20)
        });
      }
      const gasRecords = uniqueByKey(
        loaded.items.map(item => normalizePraiseTitle(item.data)),
        row => row.title
      );
      const supabaseRecords = uniqueByKey(
        (await fetchSupabaseRows(supabase, 'sunday_bulletin_praise_titles')).map(normalizePraiseTitle),
        row => row.title
      );
      return { gasRecords, supabaseRecords, keyOf: row => text(row.title), normalizeGas: canonicalOptions(), normalizeSupabase: canonicalOptions() };
    }
  };

  return adapters;
}

function recommendationFor(status) {
  switch (status) {
    case STATUS.MATCHED: return 'NONE';
    case STATUS.GAS_ONLY: return 'REVIEW_GAS_ONLY';
    case STATUS.SUPABASE_ONLY: return 'REVIEW_SUPABASE_ONLY';
    case STATUS.CONTENT_MISMATCH: return 'MANUAL_REVIEW';
    case STATUS.DELETE_MISMATCH: return 'MANUAL_REVIEW';
    case STATUS.INVALID_IDENTITY: return 'FIX_IDENTITY';
    case STATUS.SOURCE_UNAVAILABLE: return 'RETRY_SOURCE';
    default: return 'MANUAL_REVIEW';
  }
}

function repairDirection(status) {
  if (status === STATUS.GAS_ONLY) return 'GAS_TO_SUPABASE';
  if (status === STATUS.SUPABASE_ONLY) return 'SUPABASE_TO_GAS';
  return 'MANUAL_REVIEW';
}

function toLedgerItem(item) {
  const detail = {};
  if (item.error) detail.error = text(item.error);
  if (item.source) detail.source = text(item.source);
  if (item.duplicateCounts) detail.duplicateCounts = item.duplicateCounts;
  return {
    domain: item.domain,
    key: item.key,
    status: item.status,
    gasHash: item.gasHash,
    supabaseHash: item.supabaseHash,
    diffPaths: item.diffPaths || [],
    recommendation: recommendationFor(item.status),
    detail
  };
}

function toRepairItem(runId, item) {
  if ([
    STATUS.GAS_ONLY,
    STATUS.SUPABASE_ONLY,
    STATUS.CONTENT_MISMATCH,
    STATUS.DELETE_MISMATCH,
    STATUS.INVALID_IDENTITY
  ].includes(item.status)) {
    return {
      domain: item.domain,
      key: item.key,
      direction: repairDirection(item.status),
      action: 'AUDIT_ONLY_MANUAL_REVIEW',
      payload: {
        runId,
        status: item.status,
        diffPaths: item.diffPaths || []
      }
    };
  }
  return null;
}

function enrichSummary(summary, results) {
  return {
    ...summary,
    domainCounts: results.reduce((output, result) => {
      output[result.domain] = result.counts || {};
      return output;
    }, {})
  };
}

function selectAdapters(adapters, domains) {
  const selected = [];
  for (const domain of domains) {
    const adapter = adapters && (adapters[domain] || (Array.isArray(adapters) && adapters.find(item => item.domain === domain)));
    if (!adapter || typeof adapter.load !== 'function') {
      throw new Error('找不到稽核 adapter：' + domain);
    }
    selected.push(adapter);
  }
  return selected;
}

async function runAudit({ window, adapters, domains = DEFAULT_DOMAINS, ledger, mode = 'audit', runId = makeRunId() } = {}) {
  if (!window || !window.start || !window.end) throw new Error('runAudit 需要日期範圍');
  if (mode !== 'audit') throw new Error('目前只允許 audit 模式；不執行自動修正');
  if (!ledger || typeof ledger.startRun !== 'function') throw new Error('runAudit 需要 GAS ledger client');

  const selected = selectAdapters(adapters, domains);
  await ledger.startRun({
    runId,
    mode,
    windowStart: window.start,
    windowEnd: window.end
  });

  const results = [];
  for (const adapter of selected) {
    let result;
    try {
      const snapshot = await adapter.load({ window });
      result = compareRecords({
        domain: adapter.domain,
        gasRecords: snapshot.gasRecords,
        supabaseRecords: snapshot.supabaseRecords,
        keyOf: snapshot.keyOf,
        normalizeGas: snapshot.normalizeGas,
        normalizeSupabase: snapshot.normalizeSupabase
      });
    } catch (error) {
      const sourceError = error instanceof SourceUnavailableError
        ? error.source + '：' + error.message
        : error.message;
      result = compareRecords({
        domain: adapter.domain,
        sourceStatus: STATUS.SOURCE_UNAVAILABLE,
        sourceError,
        keyOf: () => '__source__'
      });
      result.items[0].source = error.source || 'unknown';
      result.items[0].details = error.details || {};
    }
    results.push(result);
  }

  const baseSummary = summarizeResults(results);
  const summary = enrichSummary(baseSummary, results);
  const ledgerItems = results.flatMap(result => result.items.map(toLedgerItem));
  const repairItems = results
    .flatMap(result => result.items.map(item => toRepairItem(runId, item)))
    .filter(Boolean);

  try {
    await ledger.appendItems(runId, ledgerItems);
    if (repairItems.length && typeof ledger.enqueueRepairs === 'function') {
      await ledger.enqueueRepairs(runId, repairItems);
    }
    await ledger.finishRun(runId, summary);
  } catch (error) {
    try {
      await ledger.finishRun(runId, {
        ...summary,
        sourceUnavailable: (summary.sourceUnavailable || 0) + 1,
        error: 'GAS ledger write failed: ' + error.message
      }, error.message);
    } catch (finishError) {
      // Preserve the original ledger error for the caller.
    }
    throw error;
  }

  return {
    runId,
    mode,
    window,
    summary,
    results,
    ledgerItems,
    repairItems
  };
}

function buildRequestedWindow(options = {}) {
  const timeZone = options.timeZone || DEFAULT_TIME_ZONE;
  const now = options.now || new Date();
  if (!options.from && !options.to) {
    return buildDateWindow({ now, days: options.days || DEFAULT_DAYS, timeZone });
  }
  const end = options.to ? toDateOnly(options.to, timeZone) : toDateOnly(now, timeZone);
  const start = options.from
    ? toDateOnly(options.from, timeZone)
    : addDays(end, -(Number(options.days || DEFAULT_DAYS) - 1));
  if (start > end) throw new Error('起始日期不可晚於結束日期');
  const startTime = new Date(start + 'T00:00:00Z').getTime();
  const endTime = new Date(end + 'T00:00:00Z').getTime();
  return {
    start,
    end,
    days: Math.floor((endTime - startTime) / 86400000) + 1,
    timeZone
  };
}

function parseArgs(argv = []) {
  const options = {
    mode: 'audit',
    days: DEFAULT_DAYS,
    from: '',
    to: '',
    domains: [...DEFAULT_DOMAINS],
    timeZone: DEFAULT_TIME_ZONE
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      if (index + 1 >= argv.length) throw new Error(arg + ' 缺少參數');
      index += 1;
      return argv[index];
    };
    if (arg === '--mode') options.mode = next();
    else if (arg === '--days') options.days = Number(next());
    else if (arg === '--from') options.from = next();
    else if (arg === '--to') options.to = next();
    else if (arg === '--domains') {
      options.domains = next().split(',').map(text).filter(Boolean);
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else {
      throw new Error('不認識的參數：' + arg);
    }
  }
  if (options.mode !== 'audit') throw new Error('目前只允許 --mode audit');
  if (!Number.isInteger(options.days) || options.days < 1) throw new Error('days 必須是正整數');
  if (!options.domains.length) throw new Error('至少要指定一個 domain');
  return options;
}

function printUsage() {
  console.log([
    '用法：node scripts/reconcile-gas-supabase.js [選項]',
    '',
    '預設為只讀 audit；本工具不寫入業務資料、不執行刪除。',
    '--mode audit             只讀稽核模式（目前唯一模式）',
    '--days 365               從今天往前的含首尾天數',
    '--from YYYY-MM-DD        起始日期（含）',
    '--to YYYY-MM-DD          結束日期（含）',
    '--domains a,b,c          指定資料域；預設全部',
    '',
    '必要環境變數：SYNC_LEDGER_GAS_URL、SYNC_LEDGER_GAS_TOKEN。',
    '建議環境變數：SUPABASE_SERVICE_ROLE_KEY、SUNDAY_ATTENDANCE_GAS_TOKEN、',
    'NEW_FAMILY_GAS_TOKEN、GROUP_ADMIN_CODE。'
  ].join('\n'));
}

function createConfiguredClients(config, options = {}) {
  if (!config.ledgerUrl || !config.ledgerToken) {
    throw new Error('缺少 SYNC_LEDGER_GAS_URL 或 SYNC_LEDGER_GAS_TOKEN');
  }
  const ledger = new SyncLedgerClient({
    url: config.ledgerUrl,
    token: config.ledgerToken,
    fetchImpl: options.fetchImpl
  });
  const supabase = createClient(config.supabase.url, config.supabase.key);
  const gas = createGasReader(config, options);
  return { ledger, supabase, gas };
}

async function main(argv = process.argv.slice(2), dependencies = {}) {
  const options = parseArgs(argv);
  if (options.help) {
    printUsage();
    return { options };
  }

  const config = dependencies.config || readAuditConfig(dependencies.env || process.env);
  const clients = dependencies.clients || createConfiguredClients(config, dependencies);
  const window = buildRequestedWindow(options);
  const adapters = dependencies.adapters
    || createDomainAdapters({
      config,
      gas: clients.gas,
      supabase: clients.supabase,
      fetchImpl: dependencies.fetchImpl
    });
  const result = await runAudit({
    window,
    adapters,
    domains: options.domains,
    ledger: clients.ledger,
    mode: options.mode
  });

  const output = {
    runId: result.runId,
    window: result.window,
    summary: result.summary
  };
  console.log(JSON.stringify(output, null, 2));
  if (result.summary.sourceUnavailable || result.summary.actionable) {
    process.exitCode = 2;
  }
  return result;
}

if (require.main === module) {
  main().catch(error => {
    console.error('稽核中止：' + error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_DOMAINS,
  NEW_FAMILY_FIELDS,
  STATUS,
  SourceUnavailableError,
  buildRequestedWindow,
  createConfiguredClients,
  createDomainAdapters,
  createGasReader,
  fetchSupabaseRows,
  normalizeAttendance,
  normalizeBulletin,
  normalizeGroup,
  normalizeGroupAttendance,
  normalizeGroupMember,
  normalizeMemberGas,
  normalizeMemberSupabase,
  normalizeNewFamily,
  normalizePraiseTitle,
  parseArgs,
  readAuditConfig,
  runAudit,
  toLedgerItem,
  toRepairItem
};
