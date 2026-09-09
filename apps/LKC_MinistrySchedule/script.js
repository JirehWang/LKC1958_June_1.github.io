// ============================================================
//  📋 教會服事管理系統 — 前端邏輯 (script.js)
//  修正版本 v3.0
//  v2.0 修正項目：
//    1. 使用 config.js 的 churchAPI() 與改進的錯誤處理
//    2. 加入防重複提交鎖定
//    3. 改用 userNotification 替代原生 alert
//    4. Session 管理改進（加入時間戳記）
//    5. 錯誤分類處理（不同錯誤顯示不同訊息）
//    6. AI 狀態提示改進
//  v3.0 修正項目：
//    7. 修正 getPageConfig 參數傳遞方式
//       { id: currentId } → { data: { id: currentId } }
//    8. 修正 getAggregatedReport 參數傳遞方式
//       { type: type } → { data: { type: type } }
//       （對齊後端 doPost 讀取 data.id / data.type 的方式）
// ============================================================

// userNotification / uiState / sessionManager / APIError 由中央 config.js 提供。
// 提供 getNotifier / getUIState shim 以避免大規模呼叫端改寫。
const getNotifier   = () => window.userNotification;
const getUIState    = () => window.uiState;
const getSessionMgr = () => window.sessionManager;

var _ms_lastFilteredCardsMatrix = [];

function ensureXLSXReady() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.sheetjs.com/xlsx-latest/package/dist/xlsx.full.min.js';
    s.onload = () => resolve(window.XLSX);
    s.onerror = () => reject(new Error('無法載入 Excel 解析模組 (XLSX)'));
    document.head.appendChild(s);
  });
}

function ensureExcelJSReady() {
  if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
    s.onload = () => resolve(window.ExcelJS);
    s.onerror = () => reject(new Error('無法載入 ExcelJS 模組'));
    document.head.appendChild(s);
  });
}

// ============================================================

const encryptGroupCode = window.encryptGroupCode || ((s) => s);
const decryptGroupCode = window.decryptGroupCode || ((s) => s);
const ENC_PREFIX = "enc_";

// 取得原始 ID 並立即進行混淆/加密處理，以防在網址列暴露明文 ID
let rawUrlId = new URLSearchParams(window.location.search).get('id') || "";
if (rawUrlId && rawUrlId.indexOf(ENC_PREFIX) !== 0) {
  const encryptedId = encryptGroupCode(rawUrlId);
  const urlParams = new URLSearchParams(window.location.search);
  urlParams.set('id', encryptedId);
  const newUrl = window.location.pathname + '?' + urlParams.toString();
  window.history.replaceState({}, '', newUrl);
  rawUrlId = encryptedId;
}
const currentId = rawUrlId;
let activeGroupName = "";
let currentTableHeaders = [];

let currentGroupMembers = [];
let currentCoreMembers = [];
let currentGeneralMembers = [];
let currentGroupPrompt = "";
let currentAutoRoleRules = "";

// 鎖定狀態與 Modal 實體
let isEditorUnlocked = false;
let bulletinModalInstance = null;

// 名單與聚會資料變數
let localCustomMembers = [];
let currentTemplate = "";
let currentScheduleMode = "schedule";
let currentScheduleTarget = "members";
let globalGroupClusters = [];
let currentEventData = [];
let currentSermonSettings = { useSermon: false, sermonType: "華語/聯合" };
let currentPageFieldConfig = null;
let fieldSettingsDraft = null;
let availableMinistryTemplates = [];

// 預覽佈告欄 modal 目前的篩選後矩陣（給下載 Excel 用）
let _currentBulletinFiltered = null;

const initialFieldTemplates = {
  "聚會型模板": {
    defaultFields: ["日期", "主題", "經文", "地點", "敬拜", "話語分享"],
    requiredFields: ["日期"]
  },
  "事工型模板": {
    defaultFields: ["日期", "地點"],
    requiredFields: ["日期"]
  }
};

const fieldTemplateBackendMap = {
  "聚會型模板": "聚會型模板",
  "事工型模板": "事工型模板"
};

function getBackendTemplateForFieldType(fieldTemplateType) {
  const preferred = fieldTemplateBackendMap[fieldTemplateType] || fieldTemplateType;
  if (!availableMinistryTemplates.length || availableMinistryTemplates.includes(preferred)) return preferred;
  if (fieldTemplateType === "聚會型模板") {
    return availableMinistryTemplates.find(t => t.includes("聚會") || t.includes("小組") || t.includes("團契")) || "聚會型模板";
  }
  return availableMinistryTemplates.find(t => !t.includes("聚會") && !t.includes("小組") && !t.includes("團契")) || "事工型模板";
}

function getFieldTemplateType(templateName) {
  if (!templateName) return "聚會型模板";
  const t = String(templateName).trim();
  if (t === "小組聚會表模板" || t === "團契聚會表模板" || t === "聚會型模板" || t === "gathering") {
    return "聚會型模板";
  }
  if (t === "事工型模板" || t === "ministry" || t.includes("事工")) {
    return "事工型模板";
  }
  if (t.includes("小組") || t.includes("團契") || t.includes("聚會")) {
    return "聚會型模板";
  }
  return "事工型模板";
}

function isMeetingTemplate(templateName = currentTemplate) {
  return getFieldTemplateType(templateName) === "聚會型模板";
}

function getFieldConfigStorageKey(pageId = currentId) {
  return `ministry.pageFieldConfig.${pageId || "new"}`;
}

function getEnabledFieldsFromConfig(config) {
  if (!config || !Array.isArray(config.fields)) return [];
  return config.fields.filter(field => field && field.enabled !== false).map(field => field.name);
}

function getRequiredFields(config) {
  return (config && Array.isArray(config.requiredFields) && config.requiredFields.length)
    ? config.requiredFields
    : ["日期"];
}

function isFieldMemberListEnabled(fieldName) {
  if (!currentPageFieldConfig || !Array.isArray(currentPageFieldConfig.fields)) {
    const noListFields = ["日期", "地點", "主題", "經文", "聚會名稱", "聚會類別", "套用講道"];
    return !noListFields.some(f => fieldName.includes(f));
  }
  const fieldObj = currentPageFieldConfig.fields.find(f => f.name === fieldName);
  if (fieldObj && typeof fieldObj.useMemberList === "boolean") {
    return fieldObj.useMemberList;
  }
  const noListFields = ["日期", "地點", "主題", "經文", "聚會名稱", "聚會類別", "套用講道"];
  return !noListFields.some(f => fieldName.includes(f));
}

function getFieldMemberListId(fieldName, templateName = currentTemplate) {
  if (!isFieldMemberListEnabled(fieldName)) return "";

  if (isMeetingTemplate(templateName)) {
    return "generalMembersList";
  }
  if (templateName === "新家人服事表模板" && fieldName.includes("小家長")) {
    return "parentMembersList";
  }
  if (templateName === "新家人服事表模板" && fieldName.includes("新家人同工")) {
    return "normalMembersList";
  }
  return "customMembersList";
}

function normalizeFieldConfig(rawConfig, templateType, pageId) {
  const template = initialFieldTemplates[templateType] || initialFieldTemplates["事工型模板"];
  const requiredFields = Array.from(new Set([...(rawConfig && rawConfig.requiredFields || []), ...template.requiredFields]));
  const sourceFields = Array.isArray(rawConfig && rawConfig.fields) && rawConfig.fields.length
    ? rawConfig.fields
    : template.defaultFields.map(name => ({ name, enabled: true }));

  const seen = new Set();
  const fields = [];
  const noListFields = ["日期", "地點", "主題", "經文", "聚會名稱", "聚會類別", "套用講道"];

  sourceFields.forEach(field => {
    const name = typeof field === "string" ? field : field && field.name;
    if (!name || seen.has(name)) return;
    seen.add(name);

    const isNoListDefault = noListFields.some(f => name.includes(f));
    const useMemberList = (field && typeof field.useMemberList === "boolean")
      ? field.useMemberList
      : !isNoListDefault;

    fields.push({
      name,
      enabled: requiredFields.includes(name) ? true : (typeof field === "object" && field.enabled === false ? false : true),
      custom: typeof field === "object" ? field.custom === true : !template.defaultFields.includes(name),
      useMemberList: useMemberList
    });
  });
  requiredFields.forEach(name => {
    if (!seen.has(name)) {
      seen.add(name);
      const isNoListDefault = noListFields.some(f => name.includes(f));
      fields.unshift({ name, enabled: true, custom: false, useMemberList: !isNoListDefault });
    }
  });

  return {
    pageId: pageId || "",
    fieldTemplateType: templateType,
    scheduleMode: normalizeScheduleMode(rawConfig && rawConfig.scheduleMode),
    scheduleTarget: rawConfig && rawConfig.scheduleTarget || "members",
    fields,
    requiredFields,
    customFields: fields.filter(field => field.custom).map(field => field.name),
    updatedAt: new Date().toISOString()
  };
}

function normalizeScheduleMode(mode) {
  return mode === "membersOnly" ? "membersOnly" : "schedule";
}

function isScheduleModeEditable() {
  return !isMeetingTemplate();
}

function isScheduleRequired() {
  return isMeetingTemplate() || currentScheduleMode !== "membersOnly";
}

function syncScheduleModeControls() {
  const section = document.getElementById('scheduleModeSection');
  const select = document.getElementById('scheduleModeSelect');
  const targetSelect = document.getElementById('scheduleTargetSelect');
  const editable = isScheduleModeEditable();
  const requiresSchedule = isScheduleRequired();

  if (section) section.classList.toggle('hidden', !editable);
  if (select) select.value = currentScheduleMode;
  if (targetSelect) targetSelect.value = currentScheduleTarget || "members";
  document.querySelector('.date-filter-toolbar')?.classList.toggle('hidden', !requiresSchedule);
  document.querySelector('.ministry-primary-actions')?.classList.toggle('hidden', !requiresSchedule);
  document.getElementById('toggleActionsBtn')?.classList.toggle('hidden', !requiresSchedule);
  document.getElementById('saveScheduleDataBtn')?.classList.toggle('hidden', !requiresSchedule);
}

function renderMembersOnlyView() {
  const container = document.getElementById('dynamicFormContainer');
  if (!container) return;
  const memberRows = localCustomMembers.length
    ? localCustomMembers.map(m => `
      <li class="list-group-item d-flex justify-content-between align-items-center">
        <span class="fw-bold">${m.name}</span>
        ${m.uid ? `<small class="text-muted">${m.uid}</small>` : ''}
      </li>
    `).join('')
    : '<li class="list-group-item text-muted text-center">尚未建立成員名單</li>';

  container.innerHTML = `
    <div class="members-only-view p-4 text-center">
      <h5 class="fw-bold text-primary mb-2">此事工目前不需要排班</h5>
      <div class="text-muted mb-3">只維護成員名單。</div>
      <div class="members-only-actions d-flex flex-wrap justify-content-center gap-2 mb-4">
        <button type="button" class="btn btn-primary fw-bold" onclick="openMemberModal()">管理成員名單</button>
        <button type="button" class="btn btn-outline-secondary fw-bold" onclick="openScheduleSettingsModal()">事工模式設定</button>
      </div>
      <ul class="list-group text-start mx-auto" style="max-width: 420px;">${memberRows}</ul>
    </div>
  `;
}

function buildPageFieldConfig(data, rawHeaders) {
  const templateType = getFieldTemplateType(data.template || "");
  const storageKey = getFieldConfigStorageKey();
  const stored = localStorage.getItem(storageKey);
  if (stored) {
    try {
      const storedConfig = JSON.parse(stored);
      const backendMode = data.scheduleMode || (data.pageFieldConfig && data.pageFieldConfig.scheduleMode);
      if (backendMode) storedConfig.scheduleMode = backendMode;
      const backendTarget = data.scheduleTarget || (data.pageFieldConfig && data.pageFieldConfig.scheduleTarget);
      if (backendTarget) storedConfig.scheduleTarget = backendTarget;
      // 後端已儲存的欄位設定是跨裝置的真實來源；避免舊版 localStorage
      // 蓋掉「使用名單」等新設定。保留只存在於本機的暫存欄位，讓離線變更不會消失。
      const backendFields = data.pageFieldConfig && Array.isArray(data.pageFieldConfig.fields)
        ? data.pageFieldConfig.fields
        : [];
      if (backendFields.length) {
        const backendFieldByName = new Map(backendFields.map(field => [field && field.name, field]));
        const localFields = Array.isArray(storedConfig.fields) ? storedConfig.fields : [];
        const localFieldNames = new Set();
        storedConfig.fields = localFields.map(field => {
          const name = typeof field === "string" ? field : field && field.name;
          localFieldNames.add(name);
          const backendField = backendFieldByName.get(name);
          return backendField ? { ...(typeof field === "object" ? field : { name }), ...backendField } : field;
        });
        backendFields.forEach(field => {
          if (field && field.name && !localFieldNames.has(field.name)) storedConfig.fields.push(field);
        });
      }
      return normalizeFieldConfig(storedConfig, templateType, currentId);
    } catch (e) {
      localStorage.removeItem(storageKey);
    }
  }

  if (data.pageFieldConfig) {
    return normalizeFieldConfig(data.pageFieldConfig, data.pageFieldConfig.fieldTemplateType || templateType, currentId);
  }

  const existingHeaders = (rawHeaders || []).map(h => String(h || "").trim()).filter(Boolean);
  const template = initialFieldTemplates[templateType] || initialFieldTemplates["事工型模板"];
  const fields = existingHeaders.length ? existingHeaders : template.defaultFields;
  return normalizeFieldConfig({
    fields: fields.map(name => ({ name, enabled: true, custom: !template.defaultFields.includes(name) })),
    requiredFields: template.requiredFields
  }, templateType, currentId);
}

function savePageFieldConfigLocally(config) {
  currentPageFieldConfig = normalizeFieldConfig(config, config.fieldTemplateType || getFieldTemplateType(currentTemplate), currentId);
  localStorage.setItem(getFieldConfigStorageKey(), JSON.stringify(currentPageFieldConfig));
}


// ============================================================
//  🛡️ API 呼叫核心
//  config.js 已載入並提供 window.GAS_URL / window.AUTH_TOKEN，
//  此處的 fetchAPI 與中央 churchAPI 並存，差異在於：
//    - churchAPI 用 text/plain；fetchAPI 用 form-urlencoded（避開 preflight）
//    - fetchAPI 帶有 timeout/retry 邏輯
//  payload 結構：{ action, token, data: { ...params } }
// ============================================================

const _API_TIMEOUT_MS = 120000;

async function loadGroupClusters() {
  if (globalGroupClusters.length > 0) return globalGroupClusters;
  try {
    const res = await fetchAPI('getDistrictsAndClusters');
    if (res && Array.isArray(res.clusters)) {
      globalGroupClusters = res.clusters.map(c => c.name);
    }
  } catch (err) {
    console.error('Failed to load group clusters:', err);
  }
  return globalGroupClusters;
}

async function prepareClustersAndRender(data) {
  const target = data && data.pageFieldConfig && data.pageFieldConfig.scheduleTarget || "members";
  if (target === "clusters") {
    await loadGroupClusters();
  }
  renderTable(data);
}

function normalizeMinistryAction(action) {
  return action.indexOf('ministry_') === 0 ? action : 'ministry_' + action;
}

function isMalformedCachedResult(result) {
  return result &&
    result.status &&
    result.status !== 'success' &&
    !result.message &&
    !Object.prototype.hasOwnProperty.call(result, 'data');
}

/**
 * 事工管理 API 呼叫
 *
 * 優先走中央 churchAPI（自動加 ministry_ 前綴 + Firebase RTDB 快取）
 * 若 churchAPI 不可用，回退至直接呼叫 GAS（手動加前綴）
 *
 * 回傳格式：後端統一回 { status, data, message? }
 * 此函式只回傳 data 部分；非 success 就拋 APIError
 */
async function fetchAPI(action, data = {}) {
  // ⚡ 0. 優先嘗試 Supabase 熱響應服務 (<50ms)
  const cleanAction = action.replace(/^ministry_/, '');
  if (window.MinistrySupabaseService && typeof window.MinistrySupabaseService[cleanAction] === 'function') {
    try {
      const res = await window.MinistrySupabaseService[cleanAction](data);
      if (res && res.status === 'success') {
        return res.data;
      }
    } catch (sbErr) {
      console.warn('[MinistrySupabase] Direct call error, falling back to churchAPI/GAS:', sbErr);
    }
  }

  // ── 優先路徑：中央 churchAPI（含 Firebase cache + 自動加前綴） ──
  if (typeof window.churchAPI === 'function') {
    try {
      const result = await window.churchAPI(action, data);
      if (result && result.status === 'success') {
        return result.data;
      }
      if (isMalformedCachedResult(result)) {
        console.warn('[ministry-api] malformed cached result, fallback to direct GAS:', action, result);
        if (typeof window.churchAPIInvalidate === 'function') {
          window.churchAPIInvalidate(normalizeMinistryAction(action)).catch(err => {
            console.warn('[ministry-api] cache invalidation failed:', err);
          });
        }
        return await fetchDirectGAS(action, data);
      }
      if (!result || result.status !== 'success') {
        throw new APIError(
          (result && result.message) || '伺服器錯誤',
          null,
          classifyError(result && result.message)
        );
      }
    } catch (err) {
      if (err instanceof APIError) throw err;
      throw new APIError(err.message || '網路錯誤', null, classifyError(err.message));
    }
  }

  // ── 回退路徑：直接打 GAS（保留 retry / timeout 邏輯） ──
  // 手動加 ministry_ 前綴
  return await fetchDirectGAS(action, data);
}

async function fetchDirectGAS(action, data = {}) {
  const realAction = normalizeMinistryAction(action);
  const payload = {
    action: realAction,
    token:  window.AUTH_TOKEN,
    data:   data
  };

  const gasUrl = window.GAS_URL;
  if (!gasUrl) {
    throw new APIError("GAS 部署網址尚未設定", null, 'CONFIG_ERROR');
  }

  let lastError;
  const maxRetries = 3;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), _API_TIMEOUT_MS);

      // 改用 text/plain + 純 JSON body（與整合後的 doPost 一致）
      const response = await fetch(gasUrl, {
        method:   'POST',
        headers:  { 'Content-Type': 'text/plain;charset=utf-8' },
        body:     JSON.stringify(payload),
        signal:   controller.signal,
        redirect: 'follow'
      });
      clearTimeout(timer);

      if (!response.ok) throw new APIError(`HTTP ${response.status}`, response.status, 'HTTP_ERROR');

      const json = await response.json();
      if (json.status !== 'success') {
        throw new APIError(json.message || '伺服器錯誤', null, classifyError(json.message));
      }
      return json.data;

    } catch (err) {
      lastError = err;
      const type = err instanceof APIError ? err.type : classifyError(err.message);
      const retryable = ['HTTP_ERROR', 'SERVER_ERROR', 'SERVER_BUSY'].includes(type);
      if (retryable && attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 1000 * attempt));
        continue;
      }
      break;
    }
  }
  throw lastError;
}

function classifyError(msg) {
  if (!msg) return 'UNKNOWN_ERROR';
  const m = msg.toLowerCase();
  if (m.includes('未授權') || m.includes('無效的憑證')) return 'AUTH_ERROR';
  if (m.includes('逾時') || m.includes('abort'))        return 'TIMEOUT';
  if (m.includes('failed to fetch') || m.includes('networkerror')) return 'NETWORK_ERROR';
  if (m.includes('已達上限'))                           return 'AI_DAILY_LIMIT';
  if (m.includes('503') || m.includes('忙線'))          return 'SERVER_BUSY';
  if (m.includes('找不到'))                             return 'NOT_FOUND';
  return 'UNKNOWN_ERROR';
}


// ============================================================
//  🎨 改進的錯誤處理
// ============================================================
function handleAPIError(err) {
  console.error("API 錯誤", err);

  if (!(err instanceof APIError)) {
    // 非 API 錯誤（例如 JSON 解析錯誤）
    getNotifier().error("發生未預期的錯誤：" + err.message);
    return;
  }

  const errorType = err.type;
  const message = err.message;

  switch (errorType) {
    case 'AUTH_ERROR':
      getNotifier().error("❌ 權限不足，請重新整理並輸入正確的 ID");
      break;

    case 'PERMISSION_ERROR':
      getNotifier().error("❌ 您沒有權限執行此操作");
      break;

    case 'TIMEOUT':
      getNotifier().error("⏱️ 請求逾時，請檢查網路連線並重試");
      break;

    case 'NETWORK_ERROR':
      getNotifier().error("🌐 網路連線失敗，請檢查網路狀態");
      break;

    case 'RATE_LIMIT':
      getNotifier().warning("⚠️ 請求過於頻繁，請稍候再試");
      break;

    case 'AI_DAILY_LIMIT':
      getNotifier().error("🤖 今日 AI 使用次數已達上限，請明日再試");
      break;

    case 'SERVER_BUSY':
      getNotifier().warning("⚠️ 伺服器忙線中，將自動重試...");
      break;

    case 'NOT_FOUND':
      getNotifier().error("❌ 找不到相關資料：" + message);
      break;

    case 'VALIDATION_ERROR':
      getNotifier().error("❌ 資料驗證失敗：" + message);
      break;

    default:
      getNotifier().error("❌ 錯誤：" + message);
  }
}


// ============================================================
//  📥 頁面初始化
// ============================================================
window.onload = async () => {
  // 檢查編輯鎖定狀態（使用改進的 sessionManager）
  if (currentId && getSessionMgr().isUnlocked(currentId)) {
    isEditorUnlocked = true;
  }

  // 還原功能區收合狀態
  const isCollapsed = localStorage.getItem('ministry.primaryActionsCollapsed') === 'true';
  const container = document.querySelector('.ministry-primary-actions');
  const btn = document.getElementById('toggleActionsBtn');
  const arrow = document.getElementById('toggleActionsArrow');
  if (container && btn) {
    if (isCollapsed) {
      container.classList.add('collapsed');
      if (arrow) arrow.innerText = '▾';
      btn.classList.remove('active');
    } else {
      container.classList.remove('collapsed');
      if (arrow) arrow.innerText = '▴';
      btn.classList.add('active');
    }
  }

  if (!currentId) {
    showSection('adminMain');
    await loadAdminData();
  } else {
    showSection('reportSection');
    initDateQuickFilter();
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const autoCreate = urlParams.get('from') === 'group' || urlParams.get('autoCreate') === '1';
      const data = await fetchAPI('getPageConfig', { id: currentId, autoCreate: autoCreate });
      await prepareClustersAndRender(data);

      // 如果未解鎖，才顯示佈告欄 (預覽模式)
      if (!isEditorUnlocked) {
        showBulletinBoard();
      }
    } catch (err) {
      handleAPIError(err);
    }
  }
};


// ============================================================
//  📊 載入管理頁面資料
// ============================================================
async function loadAdminData() {
  try {
    getNotifier().showLoading("⏳ 整理儀表板中...");

    const [rawGroups, rawTemplates] = await Promise.all([
      fetchAPI('getGroups', {}),
      fetchAPI('getTemplates', {})
    ]);
    const groups = Array.isArray(rawGroups) ? rawGroups : (rawGroups && Array.isArray(rawGroups.groups) ? rawGroups.groups : []);
    availableMinistryTemplates = Array.isArray(rawTemplates) ? rawTemplates : (rawTemplates && Array.isArray(rawTemplates.templates) ? rawTemplates.templates : []);

    const div = document.getElementById('groupButtons');
    const base = window.location.href.split('?')[0];

    const grouped = groups.reduce((acc, g) => {
      const cat = getFieldTemplateType(g.template || "");
      const catName = cat === "聚會型模板" ? "聚會型分頁" : "事工型分頁";
      if (!acc[catName]) acc[catName] = [];
      acc[catName].push(g);
      return acc;
    }, {});

    let html = "";
    const catKeys = ["聚會型分頁", "事工型分頁"];
    catKeys.forEach(cat => {
      if (!grouped[cat]) return;
      html += `<div class="col-12 category-section" data-cat="${cat}"><div class="category-header">📦 ${cat} <span class="category-badge">${grouped[cat].length}</span></div></div>`;

      html += grouped[cat].map(g => {
        const isEnabled = g.status !== "停用";
        const shareUrl = `${base}?id=${encryptGroupCode(g.id)}`;

        return `
          <div class="col-12 col-md-4 group-item" data-search="${g.name} ${g.template} ${g.id}">
            <div class="card group-card h-100 shadow-sm d-flex flex-column" style="opacity: ${isEnabled ? '1' : '0.5'}; border-left: 5px solid ${isEnabled ? '#0d6efd' : '#ced4da'};">
              <div class="card-body p-3 flex-grow-1 d-flex flex-column justify-content-between">
                <div>
                  <div class="d-flex align-items-center justify-content-between mb-2">
                    <a href="${isEnabled ? shareUrl : 'javascript:void(0)'}" class="group-link m-0" style="${isEnabled ? '' : 'pointer-events: none; cursor: default;'}">
                      <h5 class="card-title ${isEnabled ? 'text-dark' : 'text-muted'} m-0" style="${isEnabled ? '' : 'text-decoration: line-through;'}">${g.name}</h5>
                    </a>
                    <div class="form-check form-switch m-0 ms-3">
                      <input class="form-check-input" type="checkbox" role="switch" ${isEnabled ? 'checked' : ''} onchange="toggleStatus('${g.id}', '${g.status}')">
                    </div>
                  </div>
                  <div class="text-muted small mb-2">代碼: <code>${g.id}</code></div>
                </div>
                <div>
                  <div class="d-flex gap-1 flex-wrap mt-2">
                    ${isEnabled ? `<button class="btn btn-sm btn-outline-success flex-grow-1 fw-bold" onclick="copyShareLink('${shareUrl}')">🔗 複製連結</button>` : ''}
                    ${cat === "事工型分頁" ? `<button class="btn btn-sm btn-outline-primary flex-grow-1 fw-bold" onclick="openEditPageModal('${g.id}', '${g.name}')">✏️ 編輯</button>` : ''}
                  </div>
                  ${!isEnabled ? '<p class="text-muted small mt-2 m-0 text-center">已停用</p>' : ''}
                </div>
              </div>
            </div>
          </div>
        `;
      }).join('');
    });

    div.innerHTML = html || '<p class="text-center text-muted">目前尚無資料</p>';
    document.getElementById('templateSelect').innerHTML = `
      <option value="" disabled selected>選擇表格類型</option>
      <option value="聚會型模板">聚會型模板</option>
      <option value="事工型模板">事工型模板</option>
    `;

    getNotifier().success("✅ 儀表板已載入");
  } catch (err) {
    handleAPIError(err);
    document.getElementById('groupButtons').innerHTML = '<p class="text-danger">載入失敗，請重試</p>';
  } finally {
    getNotifier().hideLoading();
  }
}


// ============================================================
//  🔗 複製分享網址
// ============================================================
function copyShareLink(url) {
  navigator.clipboard.writeText(url)
    .then(() => getNotifier().success("✅ 專屬網址已複製！"))
    .catch(() => {
      getNotifier().warning("⚠️ 複製失敗，請手動複製：\n" + url);
    });
}


// ============================================================
//  🔍 搜尋小組
// ============================================================
function filterGroups() {
  const val = document.getElementById('groupSearch').value.toLowerCase();
  document.querySelectorAll('.group-item').forEach(el => {
    el.style.display = el.dataset.search.toLowerCase().includes(val) ? "" : "none";
  });
  document.querySelectorAll('.category-section').forEach(header => {
    let hasVisible = false;
    let next = header.nextElementSibling;
    while (next && next.classList.contains('group-item')) {
      if (next.style.display !== "none") hasVisible = true;
      next = next.nextElementSibling;
    }
    header.style.display = hasVisible ? "" : "none";
  });
}

function remapRowToCurrentHeaders(row, sourceHeaders) {
  const mapped = currentTableHeaders.map(header => {
    const idx = sourceHeaders.indexOf(header);
    return idx !== -1 ? (row[idx] || "") : "";
  });
  return mapped;
}


// ============================================================
//  📄 渲染排班表單
// ============================================================
function renderTable(data) {
  activeGroupName = data.groupName;
  document.getElementById('groupTitle').innerText = data.groupName;

  currentGroupMembers = data.members || [];
  currentCoreMembers = data.coreMembers || [];
  currentGeneralMembers = data.generalMembers || [];
  const rawEvents = Array.isArray(data.eventData) ? data.eventData : (Array.isArray(data.events) ? data.events : (typeof data.eventData === 'object' && data.eventData !== null ? Object.keys(data.eventData).map(d => ({ date: d, ...(data.eventData[d] || {}) })) : []));
  currentEventData = rawEvents.map(ev => {
    if (ev.date) {
      const normalized = parseGregorianDate(String(ev.date));
      if (normalized) {
        ev.date = normalized;
      }
    }
    return ev;
  });

  currentTemplate = data.template || "";
  currentScheduleTarget = data.scheduleTarget || (currentPageFieldConfig && currentPageFieldConfig.scheduleTarget) || "members";
  localCustomMembers = data.customMembers || [];
  updateTemplateSpecificLabels();

  const memberBtn = document.getElementById('manageMembersBtn');
  const groupRoleBtn = document.getElementById('manageGroupRolesBtn');
  const isGroupOrFellowship = isMeetingTemplate(currentTemplate);

  // 聚會型模板的 members 來自小組主名單（核心＋一般同工）；不可被
  // 事工自訂名單覆蓋，否則破冰／敬拜欄位會遺失一般同工。
  if (!isGroupOrFellowship) currentGroupMembers = localCustomMembers.map(m => m.name);

  if (memberBtn && !isGroupOrFellowship) {
    memberBtn.classList.remove('hidden');
    memberBtn.innerText = currentScheduleTarget === "clusters" ? "👥 管理小組群名單" : "👥 管理同工名單";

    if (currentTemplate === "新家人服事表模板") {
      const parentNames = localCustomMembers.filter(m => m.role === "小家長").map(m => m.name).join(", ");
      const normalNames = localCustomMembers.filter(m => m.role === "一般同工").map(m => m.name).join(", ");
      currentAutoRoleRules = `【系統強制權限】：\n小家長 (${parentNames})：可排所有服事。\n一般同工 (${normalNames})：不可排特定帶領服事。`;
    }
  } else if (memberBtn) {
    memberBtn.classList.add('hidden');
  }

  // 小組/團契模板才顯示「設定組員身分」按鈕與「講道連動設定」按鈕
  if (groupRoleBtn) {
    groupRoleBtn.classList.toggle('hidden', !isGroupOrFellowship);
  }
  const sermonSettingsSection = document.getElementById('sermonSettingsSection');
  if (sermonSettingsSection) {
    sermonSettingsSection.classList.toggle('hidden', !isGroupOrFellowship);
  }

  if (isGroupOrFellowship) {
    currentSermonSettings = data.sermonSettings || { useSermon: false, sermonType: "華語/聯合" };
    const useSermonToggle = document.getElementById('useSermonToggle');
    if (useSermonToggle) {
      useSermonToggle.checked = currentSermonSettings.useSermon === true;
      toggleSermonTypeSelect();
    }
    const sermonTypeSelect = document.getElementById('sermonTypeSelect');
    if (sermonTypeSelect) {
      sermonTypeSelect.value = currentSermonSettings.sermonType || "華語/聯合";
    }
  }

  const promptInput = document.getElementById('groupPromptInput');
  if (promptInput) promptInput.value = currentGroupPrompt;

  if (!data.matrix || !Array.isArray(data.matrix) || data.matrix.length === 0) {
    const templateType = getFieldTemplateType(currentTemplate);
    data.matrix = [initialFieldTemplates[templateType].defaultFields.slice()];
  }

  let rawHeaders = data.matrix[0].map(h => h.toString().trim());
  let validColCount = rawHeaders.length;
  while (validColCount > 0 && rawHeaders[validColCount - 1] === "") validColCount--;
  currentPageFieldConfig = buildPageFieldConfig(data, rawHeaders.slice(0, validColCount));
  currentScheduleMode = isGroupOrFellowship
    ? "schedule"
    : normalizeScheduleMode(data.scheduleMode || currentPageFieldConfig.scheduleMode);
  currentPageFieldConfig.scheduleMode = currentScheduleMode;
  currentScheduleTarget = isGroupOrFellowship
    ? "members"
    : (data.scheduleTarget || currentPageFieldConfig.scheduleTarget || "members");
  currentPageFieldConfig.scheduleTarget = currentScheduleTarget;
  syncScheduleModeControls();
  if (!isScheduleRequired()) {
    currentTableHeaders = getEnabledFieldsFromConfig(currentPageFieldConfig);
    renderMembersOnlyView();
    return;
  }
  rawHeaders = getEnabledFieldsFromConfig(currentPageFieldConfig);
  validColCount = rawHeaders.length;

  // 自動補齊「套用講道」欄位
  if (isGroupOrFellowship) {
    const hasSermonLinkHeader = rawHeaders.slice(0, validColCount).some(h => h === "套用講道");
    if (!hasSermonLinkHeader) {
      rawHeaders[validColCount] = "套用講道";
      validColCount++;
    }
  }

  currentTableHeaders = rawHeaders.slice(0, validColCount);

  let datalistHTML = "";
  if (currentGroupMembers.length > 0)
    datalistHTML += `<datalist id="allMembersList">` + currentGroupMembers.map(m => `<option value="${m}">`).join('') + `</datalist>`;
  if (currentCoreMembers.length > 0)
    datalistHTML += `<datalist id="coreMembersList">` + currentCoreMembers.map(m => `<option value="${m}">`).join('') + `</datalist>`;
  if (currentGeneralMembers.length > 0)
    datalistHTML += `<datalist id="generalMembersList">` + currentGeneralMembers.map(m => `<option value="${m}">`).join('') + `</datalist>`;

  if (!isMeetingTemplate(currentTemplate)) {
    if (currentTemplate === "新家人服事表模板") {
      const normalNames = localCustomMembers.filter(m => m.role === "一般同工").map(m => m.name);
      const parentNames = localCustomMembers.filter(m => m.role === "小家長").map(m => m.name);
      const customNames = localCustomMembers.map(m => m.name);
      datalistHTML += `<datalist id="normalMembersList">` + normalNames.map(m => `<option value="${m}">`).join('') + `</datalist>`;
      datalistHTML += `<datalist id="parentMembersList">` + parentNames.map(m => `<option value="${m}">`).join('') + `</datalist>`;
      datalistHTML += `<datalist id="customMembersList">` + customNames.map(m => `<option value="${m}">`).join('') + `</datalist>`;
    } else {
      const customNames = localCustomMembers.map(m => m.name);
      datalistHTML += `<datalist id="customMembersList">` + customNames.map(m => `<option value="${m}">`).join('') + `</datalist>`;
    }
  }

  const gridTemplate = buildRecordGridTemplate(validColCount);

  let html = datalistHTML;
  html += `<div class="record-grid-header fw-bold text-muted mb-2" style="display: grid; grid-template-columns: ${gridTemplate};">`;
  currentTableHeaders.forEach(h => html += `<div class="record-cell record-header-cell">${h}</div>`);
  html += `<div class="record-cell record-header-cell record-delete-header"><button type="button" class="record-delete-header-btn" onclick="deleteSelectedRows()">刪除</button></div></div>`;
  html += `<div id="rowsContainer" class="d-flex flex-column gap-2">`;

  const sourceHeaders = data.matrix[0].map(h => h.toString().trim());
  const rows = data.matrix.slice(1);
  let validRows = rows
    .filter(r => r.some(cell => cell.toString().trim() !== ""))
    .map(row => remapRowToCurrentHeaders(row, sourceHeaders));

  // 補齊行矩陣長度與預設值
  const sermonLinkColIdx = currentTableHeaders.indexOf("套用講道");
  validRows.forEach(row => {
    while (row.length < validColCount) {
      row.push("");
    }
    if (isGroupOrFellowship && sermonLinkColIdx !== -1 && !row[sermonLinkColIdx]) {
      row[sermonLinkColIdx] = "N";
    }
  });

  const dateColIdx = currentTableHeaders.findIndex(h => h.includes("日期"));
  const nameColIdx = currentTableHeaders.findIndex(h => h.includes("聚會名稱"));
  const catColIdx = currentTableHeaders.findIndex(h => h.includes("聚會類別"));

  // 1. 若為非小組/聚會型模板（事工型模板），先將 eventData 中缺少的日期補入
  if (dateColIdx !== -1 && !isMeetingTemplate(currentTemplate) && currentEventData.length > 0) {
    const existingDates = validRows.map(r => r[dateColIdx]);
    currentEventData.forEach(event => {
      if (!existingDates.includes(event.date)) {
        let newRow = new Array(validColCount).fill("");
        newRow[dateColIdx] = event.date;
        if (nameColIdx !== -1) newRow[nameColIdx] = event.name;
        if (catColIdx !== -1) newRow[catColIdx] = event.category;
        if (sermonLinkColIdx !== -1) newRow[sermonLinkColIdx] = "N";
        validRows.push(newRow);
      }
    });
  }

  // 2. 對於所有有效的 rows 中的日期，一律先格式化為 yyyy/mm/dd
  if (dateColIdx !== -1) {
    validRows.forEach(row => {
      if (row[dateColIdx]) {
        const slashDate = parseToSlashDate(row[dateColIdx]);
        if (slashDate) {
          row[dateColIdx] = slashDate;
        }
      }
    });

    // 3. 不限模板，全域按日期由小到大排序 (空白排在最下方)
    validRows.sort((a, b) => {
      let dateA = a[dateColIdx] || "9999/99/99";
      let dateB = b[dateColIdx] || "9999/99/99";
      if (!a[dateColIdx] || a[dateColIdx].trim() === "") dateA = "9999/99/99";
      if (!b[dateColIdx] || b[dateColIdx].trim() === "") dateB = "9999/99/99";
      return dateA.localeCompare(dateB);
    });
  }

  if (validRows.length === 0) {
    const emptyRow = new Array(validColCount).fill("");
    if (sermonLinkColIdx !== -1) emptyRow[sermonLinkColIdx] = "N";
    validRows.push(emptyRow);
  }

  validRows.forEach((rowData) => html += createRowHTML(rowData, gridTemplate));

  html += `</div>`;
  html += `<button type="button" class="btn btn-outline-primary w-100 mt-3 border border-2 border-primary border-opacity-50" style="border-style: dashed !important;" onclick="addNewRow()">➕ 新增一筆空白列</button>`;

  document.getElementById('dynamicFormContainer').innerHTML = html;
  initGridInteraction();

  // 載入時，針對所有有連動講道的列，進行一次講道資料的自動套用初始化
  document.querySelectorAll('.record-row').forEach(rowDiv => {
    if (sermonLinkColIdx !== -1) {
      const checkbox = rowDiv.querySelector(`input.sermon-link-checkbox[data-c="${sermonLinkColIdx}"]`);
      const sw = rowDiv.querySelector(`input.sermon-lang-switch[data-c="${sermonLinkColIdx}"]`);
      if (checkbox && checkbox.checked && dateColIdx !== -1) {
        const dVal = rowDiv.querySelector(`input.grid-input[data-c="${dateColIdx}"]`).value.trim();
        const langVal = sw && sw.checked ? "台語/聯合" : "華語/聯合";
        updateRowSermonState(rowDiv, langVal, dVal);
      }
    }
  });
}


// ============================================================
//  🧩 建立表單列 HTML
// ============================================================
function createRowHTML(rowData, gridTemplate) {
  if (!gridTemplate) gridTemplate = buildRecordGridTemplate(currentTableHeaders.length);
  let rowHtml = `<div class="record-row align-items-center" style="display: grid; grid-template-columns: ${gridTemplate};">`;

  const sermonLinkColIdx = currentTableHeaders.indexOf("套用講道");
  const rowLinkVal = sermonLinkColIdx !== -1 ? String(rowData[sermonLinkColIdx] || "N").trim() : "N";
  const isRowSermonLinked = rowLinkVal !== "N" && rowLinkVal !== "";

  currentTableHeaders.forEach((header, cIdx) => {
    let val = rowData[cIdx] || "";
    if (header === "經文" && isMeetingTemplate(currentTemplate) && window.BibleFormatter) {
      val = window.BibleFormatter.format(val);
    }
    if (header === "套用講道") {
      const currentLinkVal = String(rowData[cIdx] || "N").trim();
      const isChecked = currentLinkVal !== "N" && currentLinkVal !== "";
      
      let langVal = currentLinkVal;
      if (currentLinkVal === "Y" || currentLinkVal === "true") {
        langVal = currentSermonSettings.sermonType;
      }
      if (langVal !== "華語/聯合" && langVal !== "台語/聯合") {
        langVal = currentSermonSettings.sermonType || "華語/聯合";
      }
      
      const isTaiwanese = langVal === "台語/聯合";
      const leftOpacity = (isChecked && !isTaiwanese) ? "1" : "0.4";
      const rightOpacity = (isChecked && isTaiwanese) ? "1" : "0.4";
      const switchDisabledAttr = isChecked ? "" : "disabled";
      
      const cellHtml = `
        <div class="d-flex align-items-center justify-content-center gap-1" style="width: 100%; height: 100%; font-size: 0.8rem; user-select: none;">
          <input type="checkbox" class="grid-checkbox sermon-link-checkbox" data-c="${cIdx}" ${isChecked ? 'checked' : ''} onchange="onSermonCheckboxChange(this)" style="margin-right: 2px;">
          <span class="text-primary fw-bold" id="lang-label-left-${cIdx}" style="font-size: 0.72rem; opacity: ${leftOpacity}; transition: opacity 0.2s;">華</span>
          <div class="form-check form-switch m-0 p-0 d-flex align-items-center" style="min-height: auto;">
            <input class="form-check-input sermon-lang-switch" type="checkbox" role="switch" data-c="${cIdx}" ${isTaiwanese ? 'checked' : ''} ${switchDisabledAttr} onchange="onSermonSwitchChange(this)" style="cursor: pointer; margin: 0; width: 1.6em; height: 0.95em; transition: all 0.2s;">
          </div>
          <span class="fw-bold" id="lang-label-right-${cIdx}" style="color: #fd7e14 !important; font-size: 0.72rem; opacity: ${rightOpacity}; transition: opacity 0.2s;">台</span>
        </div>
      `;
      rowHtml += `<div class="record-cell d-flex align-items-center justify-content-center">${cellHtml}</div>`;
      return;
    }

    let listAttr = "";
    let extraClass = "";
    let inputType = "text";
    // 表格內部的日期改用 text 輸入框以支援 yyyy/mm/dd 格式的手動輸入與顯示
    if (header.includes("日期")) inputType = "text";

    const isSermonField = header === "主題" || header === "經文";
    const readonlyAttr = (isRowSermonLinked && isSermonField) ? "readonly" : "";

    const memberListId = getFieldMemberListId(header, currentTemplate);
    if (memberListId) {
      listAttr = `list="${memberListId}"`;
      extraClass = `datalist-input`;
    }

    rowHtml += `<div class="record-cell"><input type="${inputType}" class="grid-input ${extraClass}" data-c="${cIdx}" value="${val}" title="${val}" ${listAttr} ${readonlyAttr}></div>`;
  });

  rowHtml += `<div class="record-cell d-flex justify-content-center"><input type="checkbox" class="form-check-input row-delete-checkbox" title="勾選後可批次刪除"></div></div>`;
  return rowHtml;
}

function buildRecordGridTemplate(columnCount) {
  const isNarrow = window.matchMedia && window.matchMedia('(max-width: 768px)').matches;
  const inputMinWidth = isNarrow ? 172 : 148;
  const actionWidth = isNarrow ? 64 : 48;
  return `repeat(${columnCount}, ${inputMinWidth}px) ${actionWidth}px`;
}

function sortRowsByDate() {
  const dateColIdx = currentTableHeaders.findIndex(h => h.includes("日期"));
  if (dateColIdx === -1) return;

  // 收集目前畫面上所有有效的 rows
  const matrix = collectVisibleMatrix();
  const headers = matrix[0];
  const rows = matrix.slice(1);

  // 排序，確保空白日期排在最下方
  rows.sort((a, b) => {
    let dateA = a[dateColIdx] || "9999/99/99";
    let dateB = b[dateColIdx] || "9999/99/99";
    if (!a[dateColIdx] || a[dateColIdx].trim() === "") dateA = "9999/99/99";
    if (!b[dateColIdx] || b[dateColIdx].trim() === "") dateB = "9999/99/99";
    return dateA.localeCompare(dateB);
  });

  // 重新渲染表格
  rerenderWithMatrix([headers, ...rows]);
}
window.sortRowsByDate = sortRowsByDate;

// ============================================================
//  ➕ 新增列 / 🗑️ 刪除列
// ============================================================
function addNewRow() {
  const container = document.getElementById('rowsContainer');
  const tempDiv = document.createElement('div');
  
  const defaultRow = Array(currentTableHeaders.length).fill("");
  const sermonLinkColIdx = currentTableHeaders.indexOf("套用講道");
  if (sermonLinkColIdx !== -1) {
    defaultRow[sermonLinkColIdx] = "N";
  }
  
  tempDiv.innerHTML = createRowHTML(defaultRow);
  const newRowEl = tempDiv.firstElementChild;
  container.prepend(newRowEl);
  return newRowEl;
}

function deleteRow(btnElement) {
  if (confirm("確定要刪除這筆排班資料嗎？")) {
    btnElement.parentElement.remove();
  }
}

function deleteSelectedRows() {
  const selected = Array.from(document.querySelectorAll('.row-delete-checkbox:checked'));
  if (selected.length === 0) {
    getNotifier().warning("⚠️ 請先勾選要刪除的列");
    return;
  }
  if (!confirm(`確定要刪除 ${selected.length} 列資料嗎？`)) return;
  selected.forEach(checkbox => checkbox.closest('.record-row')?.remove());
  getNotifier().success(`✅ 已刪除 ${selected.length} 列`);
}

function collectVisibleMatrix() {
  const matrix = [currentTableHeaders.slice()];
  document.querySelectorAll('.record-row').forEach(rowDiv => {
    const row = [];
    currentTableHeaders.forEach((header, cIdx) => {
      if (header === "套用講道") {
        const checkbox = rowDiv.querySelector(`input.sermon-link-checkbox[data-c="${cIdx}"]`);
        const sw = rowDiv.querySelector(`input.sermon-lang-switch[data-c="${cIdx}"]`);
        const isChecked = checkbox && checkbox.checked;
        const langVal = sw && sw.checked ? "台語/聯合" : "華語/聯合";
        row.push(isChecked ? langVal : "N");
      } else {
        const input = rowDiv.querySelector(`input.grid-input[data-c="${cIdx}"]`);
        row.push(input ? input.value.trim() : "");
      }
    });
    matrix.push(row);
  });
  return matrix;
}

function rerenderWithMatrix(matrix) {
  renderTable({
    groupName: activeGroupName,
    template: currentTemplate,
    matrix,
    members: currentGroupMembers,
    coreMembers: currentCoreMembers,
    customMembers: localCustomMembers,
    groupPrompt: currentGroupPrompt,
    autoRoleRules: currentAutoRoleRules,
    eventData: currentEventData,
    sermonSettings: currentSermonSettings
  });
}

function isMeetingTemplate(templateName = currentTemplate) {
  return getFieldTemplateType(templateName) === "聚會型模板";
}

function updateTemplateSpecificLabels() {
  const serviceMode = !isMeetingTemplate();
  const quarterTitle = serviceMode ? "新增一季服事表" : "新增一季聚會";
  const settingsTitle = serviceMode ? "服事表設定" : "聚會表設定";

  const quarterActionTitle = document.getElementById('quarterActionTitle');
  const quarterModalTitle = document.getElementById('quarterModalTitle');
  const settingsActionTitle = document.getElementById('scheduleSettingsActionTitle');
  const settingsModalTitle = document.getElementById('scheduleSettingsModalTitle');

  if (quarterActionTitle) quarterActionTitle.innerText = quarterTitle;
  if (quarterModalTitle) quarterModalTitle.innerText = quarterTitle;
  if (settingsActionTitle) settingsActionTitle.innerText = settingsTitle;
  if (settingsModalTitle) settingsModalTitle.innerText = settingsTitle;
}

function openQuarterModal() {
  if (!isScheduleRequired()) {
    getNotifier().warning("⚠️ 此事工目前設定為不需要排班");
    return;
  }
  const yearInput = document.getElementById('quarterYear');
  const quarterSelect = document.getElementById('quarterNumber');
  const sermonCheckbox = document.getElementById('quarterUseSermon');
  const sermonRow = document.getElementById('quarterUseSermonRow');
  const now = new Date();
  if (yearInput && !yearInput.value) yearInput.value = now.getFullYear();
  if (quarterSelect && !quarterSelect.value) quarterSelect.value = String(Math.floor(now.getMonth() / 3) + 1);
  const meetingMode = isMeetingTemplate();
  if (sermonRow) sermonRow.classList.toggle('hidden', !meetingMode);
  if (sermonCheckbox) sermonCheckbox.checked = meetingMode && currentSermonSettings.useSermon === true;
  updateTemplateSpecificLabels();
  new bootstrap.Modal(document.getElementById('quarterModal')).show();
}

function generateQuarterRows() {
  const year = Number(document.getElementById('quarterYear').value);
  const quarter = Number(document.getElementById('quarterNumber').value);
  const weekday = Number(document.getElementById('quarterWeekday').value);
  const useAI = document.getElementById('quarterUseAI').checked;
  const useSermonForNewRows = isMeetingTemplate() && document.getElementById('quarterUseSermon').checked;
  const dateColIdx = currentTableHeaders.findIndex(h => h.includes("日期"));
  const sermonLinkColIdx = currentTableHeaders.indexOf("套用講道");
  if (!year || dateColIdx === -1) {
    getNotifier().warning("⚠️ 需要年度與日期欄位才能產生季度資料");
    return;
  }

  const startMonth = (quarter - 1) * 3;
  const start = new Date(year, startMonth, 1);
  const end = new Date(year, startMonth + 3, 0);
  const dates = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    if (d.getDay() === weekday) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      // 改成 yyyy/mm/dd 斜線格式
      dates.push(`${y}/${m}/${day}`);
    }
  }

  const existingDates = new Set();
  document.querySelectorAll('.record-row').forEach(rowDiv => {
    const input = rowDiv.querySelector(`.grid-input[data-c="${dateColIdx}"]`);
    if (input && input.value.trim()) existingDates.add(input.value.trim());
  });

  let added = 0;
  const addedDates = [];
  dates.forEach(date => {
    if (existingDates.has(date)) return;
    const row = Array(currentTableHeaders.length).fill("");
    row[dateColIdx] = date;
    if (sermonLinkColIdx !== -1) row[sermonLinkColIdx] = useSermonForNewRows ? currentSermonSettings.sermonType : "N";
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = createRowHTML(row);
    const rowEl = tempDiv.firstElementChild;
    document.getElementById('rowsContainer').appendChild(rowEl);
    if (sermonLinkColIdx !== -1 && useSermonForNewRows) {
      updateRowSermonState(rowEl, currentSermonSettings.sermonType, date);
    }
    addedDates.push(date);
    added++;
  });

  bootstrap.Modal.getInstance(document.getElementById('quarterModal'))?.hide();
  getNotifier().success(`✅ 已新增 ${added} 筆季度聚會日期`);
  sortRowsByDate();

  if (useAI && addedDates.length > 0) {
    const aiBox = document.getElementById('aiRawText');
    if (aiBox) {
      aiBox.value = [
        `請依照目前儲存的班表規則，為 ${year} 年第 ${quarter} 季以下日期進行排班。`,
        "請保留日期，不要新增或刪除日期。",
        "",
        addedDates.map(date => `- ${date}`).join("\n")
      ].join("\n");
      processAI();
    }
  }
}

function openAiScheduleModal() {
  if (!isScheduleRequired()) {
    getNotifier().warning("⚠️ 此事工目前設定為不需要排班");
    return;
  }
  const modal = new bootstrap.Modal(document.getElementById('aiScheduleModal'));
  modal.show();
  setTimeout(() => {
    const box = document.getElementById('aiRawText');
    if (box) box.focus();
  }, 180);
}

function openScheduleRuleModal() {
  const modal = new bootstrap.Modal(document.getElementById('scheduleRuleModal'));
  modal.show();
  setTimeout(() => {
    const input = document.getElementById('groupPromptInput');
    if (input) input.focus();
  }, 180);
}

function openScheduleSettingsModal() {
  syncScheduleModeControls();
  new bootstrap.Modal(document.getElementById('scheduleSettingsModal')).show();
}

async function saveScheduleMode() {
  if (window.event) window.event.preventDefault();
  if (!isScheduleModeEditable()) return;
  if (getUIState().isLocked('saveScheduleMode')) return;
  getUIState().lock('saveScheduleMode');

  const select = document.getElementById('scheduleModeSelect');
  const targetSelect = document.getElementById('scheduleTargetSelect');
  const previousMode = currentScheduleMode;
  const previousTarget = currentScheduleTarget;
  const nextMode = normalizeScheduleMode(select && select.value);
  const nextTarget = targetSelect ? targetSelect.value : "members";
  const nextConfig = {
    ...(currentPageFieldConfig || normalizeFieldConfig(null, getFieldTemplateType(currentTemplate), currentId)),
    scheduleMode: nextMode,
    scheduleTarget: nextTarget
  };

  getNotifier().showLoading("儲存事工模式中...");
  try {
    await fetchAPI("savePageFieldConfig", { id: currentId, pageFieldConfig: nextConfig });
    if (typeof window.churchAPIInvalidate === 'function') {
      await Promise.allSettled([
        window.churchAPIInvalidate('ministry_getPageConfig'),
        window.churchAPIInvalidate('ministry_getAggregatedReport'),
        window.churchAPIInvalidate('memberStatus_getServiceIndex'),
        window.churchAPIInvalidate('memberStatus_getMembers'),
        window.churchAPIInvalidate('memberStatus_getProfile')
      ]);
    }
    const data = await fetchAPI('getPageConfig', { id: currentId, refreshAt: Date.now() });
    const savedConfig = data && (data.pageFieldConfig || data.fieldConfig || {});
    const savedMode = normalizeScheduleMode(savedConfig.scheduleMode || data.scheduleMode);
    const savedTarget = savedConfig.scheduleTarget || data.scheduleTarget || "members";
    if (savedMode !== nextMode || savedTarget !== nextTarget) {
      throw new APIError('後端尚未保存設定，請確認 GAS 已部署最新版後再試一次。');
    }
    currentScheduleMode = nextMode;
    currentScheduleTarget = nextTarget;
    currentPageFieldConfig = normalizeFieldConfig(savedConfig, getFieldTemplateType(currentTemplate), currentId);
    try {
      localStorage.setItem(getFieldConfigStorageKey(), JSON.stringify(currentPageFieldConfig));
    } catch (storageErr) {
      console.warn('[ministry] failed to persist field config locally:', storageErr);
    }
    await prepareClustersAndRender(data);
    getNotifier().success("✅ 已儲存事工設定");
  } catch (err) {
    currentScheduleMode = previousMode;
    currentScheduleTarget = previousTarget;
    syncScheduleModeControls();
    handleAPIError(err);
  } finally {
    getNotifier().hideLoading();
    getUIState().unlock('saveScheduleMode');
  }
}

function focusPasteBox() {
  openAiScheduleModal();
}

function focusAiRawText() {
  const box = document.getElementById('aiRawText');
  if (!box) return;
  box.scrollIntoView({ behavior: 'smooth', block: 'center' });
  box.focus();
}

function openFieldSettingsModal() {
  fieldSettingsDraft = JSON.parse(JSON.stringify(currentPageFieldConfig || normalizeFieldConfig(null, getFieldTemplateType(currentTemplate), currentId)));
  renderFieldSettingsList();
  new bootstrap.Modal(document.getElementById('fieldSettingsModal')).show();
}

function renderFieldSettingsList() {
  const list = document.getElementById('fieldSettingsList');
  const required = getRequiredFields(fieldSettingsDraft);
  list.innerHTML = fieldSettingsDraft.fields.map((field, idx) => {
    const isRequired = required.includes(field.name);
    const isNoListField = ["日期", "聚會名稱", "聚會類別", "套用講道"].some(f => field.name.includes(f));
    const showMemberListToggle = !isNoListField;

    return `
      <div class="field-settings-row">
        <div class="field-settings-name">${field.name}${isRequired ? ' <span class="field-settings-required">必要</span>' : ''}</div>
        <div class="form-check form-switch m-0">
          <input class="form-check-input" type="checkbox" ${field.enabled !== false ? 'checked' : ''} ${isRequired ? 'disabled' : ''} onchange="toggleDraftField(${idx}, this.checked)">
        </div>
        <div class="form-check m-0">
          ${showMemberListToggle ? `
            <input class="form-check-input" type="checkbox" ${field.useMemberList !== false ? 'checked' : ''} onchange="toggleDraftFieldMemberList(${idx}, this.checked)" id="toggleList_${idx}">
            <label class="form-check-label small text-muted" for="toggleList_${idx}">套用名單</label>
          ` : ''}
        </div>
        <div class="text-muted small">${field.custom ? '自訂' : '模板'}</div>
        <div class="field-settings-actions">
          <button class="btn btn-sm btn-outline-secondary" type="button" onclick="moveDraftField(${idx}, -1)" ${idx === 0 ? 'disabled' : ''}>↑</button>
          <button class="btn btn-sm btn-outline-secondary" type="button" onclick="moveDraftField(${idx}, 1)" ${idx === fieldSettingsDraft.fields.length - 1 ? 'disabled' : ''}>↓</button>
          <button class="btn btn-sm btn-outline-danger" type="button" onclick="removeDraftField(${idx})" ${isRequired ? 'disabled' : ''}>刪除</button>
        </div>
      </div>
    `;
  }).join('');
}

function toggleDraftFieldMemberList(idx, checked) {
  fieldSettingsDraft.fields[idx].useMemberList = checked;
}

function toggleDraftField(idx, checked) {
  const required = getRequiredFields(fieldSettingsDraft);
  if (required.includes(fieldSettingsDraft.fields[idx].name)) return;
  fieldSettingsDraft.fields[idx].enabled = checked;
}

function moveDraftField(idx, delta) {
  const next = idx + delta;
  if (next < 0 || next >= fieldSettingsDraft.fields.length) return;
  const copy = fieldSettingsDraft.fields.slice();
  [copy[idx], copy[next]] = [copy[next], copy[idx]];
  fieldSettingsDraft.fields = copy;
  renderFieldSettingsList();
}

function removeDraftField(idx) {
  const required = getRequiredFields(fieldSettingsDraft);
  if (required.includes(fieldSettingsDraft.fields[idx].name)) return;
  fieldSettingsDraft.fields.splice(idx, 1);
  renderFieldSettingsList();
}

function addCustomField() {
  const input = document.getElementById('newFieldName');
  const name = input.value.trim();
  if (!name) return;
  if (fieldSettingsDraft.fields.some(field => field.name === name)) {
    getNotifier().warning("⚠️ 此欄位已存在");
    return;
  }
  fieldSettingsDraft.fields.push({ name, enabled: true, custom: true, useMemberList: true });
  input.value = "";
  renderFieldSettingsList();
}

function applyInitialTemplateFields() {
  const templateType = fieldSettingsDraft.fieldTemplateType || getFieldTemplateType(currentTemplate);
  const template = initialFieldTemplates[templateType];
  const existing = new Set(fieldSettingsDraft.fields.map(field => field.name));
  let added = 0;
  template.defaultFields.forEach(name => {
    if (existing.has(name)) return;
    fieldSettingsDraft.fields.push({ name, enabled: true, custom: false });
    existing.add(name);
    added++;
  });
  fieldSettingsDraft.requiredFields = Array.from(new Set([
    ...(fieldSettingsDraft.requiredFields || []),
    ...template.requiredFields
  ]));
  renderFieldSettingsList();
  getNotifier().success(added ? `✅ 已補齊 ${added} 個初始欄位` : "✅ 初始模板欄位已完整");
}

function saveFieldSettings() {
  const previousHeaders = currentTableHeaders.slice();
  const previousRows = collectVisibleMatrix().slice(1);
  savePageFieldConfigLocally(fieldSettingsDraft);
  const nextHeaders = getEnabledFieldsFromConfig(currentPageFieldConfig);
  currentTableHeaders = nextHeaders;
  const nextRows = previousRows.map(row => remapRowToCurrentHeaders(row, previousHeaders));
  rerenderWithMatrix([nextHeaders, ...nextRows]);
  bootstrap.Modal.getInstance(document.getElementById('fieldSettingsModal'))?.hide();
  getNotifier().success("✅ 欄位設定已套用，請記得儲存變更");
  if (currentId) {
    fetchAPI("savePageFieldConfig", { id: currentId, pageFieldConfig: currentPageFieldConfig })
      .catch(err => console.warn("pageFieldConfig 暫存於瀏覽器，後端尚未儲存：", err));
  }
}


// ============================================================
//  🎯 網格互動（複製貼上等）
// ============================================================
function initGridInteraction() {
  const container = document.getElementById('rowsContainer');
  if (!container) return;

  // 監聽日期變更：若是連動講道的列，日期變更後自動重新抓取講道資訊
  container.addEventListener('change', (e) => {
    const target = e.target;
    if (target.classList.contains('grid-input')) {
      const cIdx = parseInt(target.dataset.c);
      const header = currentTableHeaders[cIdx];
      if (header && header.includes("日期")) {
        const dVal = target.value.trim();
        if (dVal !== "") {
          const slashDate = parseToSlashDate(dVal);
          if (slashDate) {
            target.value = slashDate;
            target.title = slashDate;
            
            // 講道連動邏輯
            const rowDiv = target.closest('.record-row');
            const sermonLinkColIdx = currentTableHeaders.indexOf("套用講道");
            if (sermonLinkColIdx !== -1) {
              const checkbox = rowDiv.querySelector(`input.sermon-link-checkbox[data-c="${sermonLinkColIdx}"]`);
              if (checkbox && checkbox.checked) {
                const sw = rowDiv.querySelector(`input.sermon-lang-switch[data-c="${sermonLinkColIdx}"]`);
                const langVal = sw && sw.checked ? "台語/聯合" : "華語/聯合";
                updateRowSermonState(rowDiv, langVal, slashDate);
              }
            }
            
            // 日期變更後，不再即時排序，改為儲存時排序，避免編輯中的列跳走妨礙輸入

          } else {
            getNotifier().error("❌ 日期不符格式，請按照yyyy/mm/dd進行建立");
            target.value = "";
            target.title = "";
            target.focus();
          }
        }
      } else if (header && header === "經文" && isMeetingTemplate(currentTemplate) && window.BibleFormatter) {
        const val = target.value.trim();
        if (val !== "") {
          const formatted = window.BibleFormatter.format(val);
          if (formatted !== val) {
            target.value = formatted;
            target.title = formatted;
          }
        }
      }
    }
  });

  container.addEventListener('paste', (e) => {
    const target = e.target;
    if (!target.classList.contains('grid-input')) return;
    const pasteData = (e.clipboardData || window.clipboardData).getData('text');
    if (pasteData.includes('\t') || pasteData.includes('\n')) {
      e.preventDefault();
      const startC = parseInt(target.dataset.c);
      const currentRowDiv = target.closest('.record-row');
      let currentRowIndex = Array.from(container.children).indexOf(currentRowDiv);
      const rows = pasteData.split(/\r?\n/);
      if (rows[rows.length - 1] === "") rows.pop();

      for (let i = 0; i < rows.length; i++) {
        if (currentRowIndex + i >= container.children.length) addNewRow();
        const targetRowDiv = container.children[currentRowIndex + i];
        const cols = rows[i].split('\t');
        for (let j = 0; j < cols.length; j++) {
          const c = startC + j;
          const input = targetRowDiv.querySelector(`[data-c="${c}"]`);
          if (input) {
            if (input.classList.contains('sermon-link-checkbox')) {
              let val = cols[j].trim();
              const isChecked = val !== 'N' && val !== 'false' && val !== '0' && val !== '';
              input.checked = isChecked;
              
              let langVal = currentSermonSettings.sermonType;
              if (val === '華語/聯合' || val === '台語/聯合') {
                langVal = val;
              }
              const sw = targetRowDiv.querySelector(`input.sermon-lang-switch[data-c="${c}"]`);
              if (sw) {
                sw.checked = langVal === "台語/聯合";
              }
              onSermonCheckboxChange(input);
            } else if (input.type === 'checkbox') {
              input.checked = (cols[j] === 'Y' || cols[j] === 'true' || cols[j] === true);
              onSermonLinkChange(input);
            } else {
              let val = cols[j];
              if (currentTableHeaders[c] === "經文" && isMeetingTemplate(currentTemplate) && window.BibleFormatter) {
                val = window.BibleFormatter.format(val);
              }
              input.value = val;
              input.title = val;
              input.classList.add('highlight');
              setTimeout(() => input.classList.remove('highlight'), 2000);
              
              // 貼上日期時，如果同列的講道連動是啟用狀態，觸發重算講道
              if (currentTableHeaders[c] && currentTableHeaders[c].includes("日期")) {
                const sermonLinkColIdx = currentTableHeaders.indexOf("套用講道");
                if (sermonLinkColIdx !== -1) {
                  const checkbox = targetRowDiv.querySelector(`input.sermon-link-checkbox[data-c="${sermonLinkColIdx}"]`);
                  if (checkbox && checkbox.checked) {
                    const sw = targetRowDiv.querySelector(`input.sermon-lang-switch[data-c="${sermonLinkColIdx}"]`);
                    const langVal = sw && sw.checked ? "台語/聯合" : "華語/聯合";
                    updateRowSermonState(targetRowDiv, langVal, val.trim());
                  }
                }
              }
            }
          }
        }
      }
      
      // paste 處理完所有行後，最後呼叫即時排序
      sortRowsByDate();
    }
  });
}


// ============================================================
//  📅 日期篩選
// ============================================================
function initDateQuickFilter() {
  const yearSelect = document.getElementById('dateQuickYear');
  const quarterSelect = document.getElementById('dateQuickQuarter');
  if (!yearSelect || !quarterSelect) return;

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentQuarter = Math.floor(now.getMonth() / 3) + 1;
  const years = [];
  for (let year = currentYear - 2; year <= currentYear + 3; year++) years.push(year);

  yearSelect.innerHTML = years
    .map(year => `<option value="${year}" ${year === currentYear ? 'selected' : ''}>${year}</option>`)
    .join('');
  quarterSelect.value = String(currentQuarter);
}

function quarterDateRange(year, quarter) {
  const startMonth = (quarter - 1) * 3;
  const start = new Date(year, startMonth, 1);
  const end = new Date(year, startMonth + 3, 0);
  return {
    start: formatDateInputValue(start),
    end: formatDateInputValue(end)
  };
}

function formatDateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function applyQuarterDateFilter() {
  const year = Number(document.getElementById('dateQuickYear').value);
  const quarter = Number(document.getElementById('dateQuickQuarter').value);
  const range = quarterDateRange(year, quarter);
  document.getElementById('startDate').value = range.start;
  document.getElementById('endDate').value = range.end;
  filterByDate();
}

function applyYearDateFilter() {
  const year = Number(document.getElementById('dateQuickYear').value);
  document.getElementById('startDate').value = `${year}-01-01`;
  document.getElementById('endDate').value = `${year}-12-31`;
  filterByDate();
}

function filterByDate() {
  if (window.event) window.event.preventDefault();
  const start = document.getElementById('startDate').value;
  const end = document.getElementById('endDate').value;
  const recordRows = document.querySelectorAll('.record-row');
  const dateColIdx = currentTableHeaders.findIndex(h => h.includes("日期"));

  if (dateColIdx === -1) {
    getNotifier().warning("⚠️ 找不到包含「日期」的欄位。");
    return;
  }

  let visibleCount = 0;
  recordRows.forEach(rowDiv => {
    const inputs = rowDiv.querySelectorAll('.grid-input');
    if (inputs.length === 0) return;
    const dateVal = inputs[dateColIdx].value.trim();
    let show = true;
    if (!start && !end) show = true;
    else if (!dateVal) show = false;
    else {
      // 將表格的斜線日期暫時轉為橫線，以便與原生的 YYYY-MM-DD input 值進行正確的大小比對
      const compareDate = dateVal.replace(/\//g, "-");
      if (start && compareDate < start) show = false;
      if (end && compareDate > end) show = false;
    }
    if (show) {
      rowDiv.classList.remove('hidden');
      visibleCount++;
    } else {
      rowDiv.classList.add('hidden');
    }
  });

  if (start || end) {
    getNotifier().success(`✅ 已篩選出 ${visibleCount} 筆資料`);
  }
}

function clearDateFilter() {
  if (window.event) window.event.preventDefault();
  document.getElementById('startDate').value = "";
  document.getElementById('endDate').value = "";
  document.querySelectorAll('.record-row').forEach(rowDiv => rowDiv.classList.remove('hidden'));
}


// ============================================================
//  🤖 AI 排班處理（改進的狀態提示）
// ============================================================
async function processAI() {
  if (window.event) window.event.preventDefault();
  if (!isScheduleRequired()) {
    getNotifier().warning("⚠️ 此事工目前設定為不需要排班");
    return;
  }

  // 防止重複提交
  if (getUIState().isLocked('processAI')) return;
  getUIState().lock('processAI');

  const rawText = document.getElementById('aiRawText').value.trim();
  if (!rawText) {
    getNotifier().warning("⚠️ 請貼上排班文字或輸入排班條件");
    getUIState().unlock('processAI');
    return;
  }

  const submitBtn = document.querySelector('#aiScheduleModal .btn-success');
  const textarea = document.getElementById('aiRawText');
  if (submitBtn) submitBtn.disabled = true;
  if (textarea) textarea.disabled = true;

  getNotifier().showLoading("🤖 AI 運算中，請稍候...");
  document.getElementById('aiStatus').innerText = "⏳ 處理中...";

  // 構造表頭欄位指示與範例 JSON，強制 AI 生成精確符合目前 Excel 欄位的鍵值
  const formatExampleObj = currentTableHeaders.reduce((obj, h) => {
    if (h === "日期") obj[h] = "2026/06/14";
    else if (h === "套用講道") obj[h] = "N";
    else if (h === "主題") obj[h] = "主題名稱";
    else if (h === "經文") obj[h] = "經文範圍";
    else obj[h] = "人員姓名";
    return obj;
  }, {});

  const headerPrompt = `
【重要指令：輸出格式與欄位對齊指南】
請將排班資料轉換為 JSON 陣列，每個物件代表一筆聚會，且物件的屬性（Keys）必須與以下 Excel 欄位陣列「完全相同且精確對應」：
${JSON.stringify(currentTableHeaders)}

精確格式範例如下：
${JSON.stringify([formatExampleObj], null, 2)}

注意事項：
1. 屬性（Keys）的字元必須完全一致，包括中文字元，不能自創或修改欄位名稱。
2. 「日期」欄位必須標準化為西元格式 (yyyy/mm/dd)。
3. 「套用講道」若未特別提及一律填入 "N"。
4. 服事人員名稱必須使用名單中的人名。
`;

  try {
    const resData = await fetchAPI("parseWithAI", {
      text: rawText,
      headers: currentTableHeaders,
      members: currentGroupMembers,
      groupPrompt: currentGroupPrompt + "\n" + currentAutoRoleRules + "\n" + headerPrompt,
      template: currentTemplate
    });

    resData.forEach(row => {
      if (row["套用講道"] === undefined || row["套用講道"] === null || row["套用講道"] === "") {
        row["套用講道"] = "N";
      }
    });
    fillTableWithData(resData);
    getNotifier().success("✅ 貼上聚會表解析完成！");
    document.getElementById('aiStatus').innerText = "✅ 解析/聚會表填充完成！";
    document.getElementById('aiRawText').value = "";
  } catch (err) {
    handleAPIError(err);
    document.getElementById('aiStatus').innerText = "❌ 處理失敗，請重試";
  } finally {
    getNotifier().hideLoading();
    getUIState().unlock('processAI');
    if (submitBtn) submitBtn.disabled = false;
    if (textarea) textarea.disabled = false;
  }
}


// ============================================================
//  📝 填充表單資料
// ============================================================
function fillTableWithData(parsedRows, isPaste = false) {
  const container = document.getElementById('rowsContainer');
  const dateColIdx = currentTableHeaders.findIndex(h => h.includes("日期"));

  // 預先快取目前所有 row 與其 inputsMap (cIdx -> input/checkbox/select)
  const rowCache = Array.from(container.querySelectorAll('.record-row')).map(rowDiv => ({
    rowDiv,
    inputsMap: Array.from(rowDiv.querySelectorAll('input, select')).reduce((map, input) => {
      const c = input.dataset.c;
      if (c !== undefined) map[c] = input;
      return map;
    }, {})
  }));

  parsedRows.forEach(rowData => {
    let target = null;
    let aiDate = rowData["日期"] || rowData[currentTableHeaders[dateColIdx]];

    // 檢查並格式化為 yyyy/mm/dd
    if (aiDate && dateColIdx !== -1) {
      const slashDate = parseToSlashDate(String(aiDate).trim());
      if (slashDate) {
        rowData["日期"] = slashDate;
        if (currentTableHeaders[dateColIdx] !== "日期") {
          rowData[currentTableHeaders[dateColIdx]] = slashDate;
        }
        aiDate = slashDate; // 同步更新供後續比對使用
      } else {
        getNotifier().error(`❌ 日期 "${aiDate}" 不符格式，請按照yyyy/mm/dd進行建立`);
        return; // 跳過此筆無效資料的填充
      }
    }

    // 先嘗試比對日期
    if (aiDate && dateColIdx !== -1) {
      target = rowCache.find(r => {
        const di = r.inputsMap[dateColIdx];
        return di && di.value.trim() === aiDate;
      });
    }

    // 找不到日期相符的 → 找完全空白的列
    if (!target) {
      target = rowCache.find(r => {
        return Object.values(r.inputsMap).every(input => {
          if (input.type === 'checkbox') return true; // 勾選框不視為內容填寫
          return input.value.trim() === "";
        });
      });
    }

    // 都沒有 → 新增一列並加入 cache
    if (!target) {
      const rowDiv = addNewRow();
      target = {
        rowDiv,
        inputsMap: Array.from(rowDiv.querySelectorAll('input, select')).reduce((map, input) => {
          const c = input.dataset.c;
          if (c !== undefined) map[c] = input;
          return map;
        }, {})
      };
      rowCache.push(target);
    }

    if (isPaste) {
      rowData["套用講道"] = "N";
      updateRowSermonState(target.rowDiv, "N", aiDate);
    }

    currentTableHeaders.forEach((header, colIdx) => {
      const val = rowData[header];
      if (val !== undefined && val !== null && val !== "") {
        const input = target.rowDiv.querySelector(`input.sermon-link-checkbox[data-c="${colIdx}"]`) || target.inputsMap[colIdx];
        if (input) {
          if (input.classList.contains('sermon-link-checkbox')) {
            const isChecked = val !== 'N' && val !== 'false' && val !== '0' && val !== '';
            input.checked = isChecked;
            let langVal = currentSermonSettings.sermonType;
            if (val === '華語/聯合' || val === '台語/聯合') {
              langVal = val;
            }
            const sw = target.rowDiv.querySelector(`input.sermon-lang-switch[data-c="${colIdx}"]`);
            if (sw) {
              sw.checked = langVal === "台語/聯合";
            }
            onSermonCheckboxChange(input);
          } else if (input.type === 'checkbox') {
            input.checked = (val === 'Y' || val === 'true' || val === true);
            onSermonLinkChange(input);
          } else {
            let finalVal = val;
            if (header === "經文" && isMeetingTemplate(currentTemplate) && window.BibleFormatter) {
              finalVal = window.BibleFormatter.format(val);
            }
            input.value = finalVal;
            input.title = finalVal;
            input.classList.add('highlight');
            setTimeout(() => input.classList.remove('highlight'), 2000);
          }
        }
      }
    });

    // 填充完後，若是連動講道的列，觸發重算/代入講道資訊
    const sermonLinkColIdx = currentTableHeaders.indexOf("套用講道");
    if (sermonLinkColIdx !== -1 && dateColIdx !== -1) {
      const checkbox = target.rowDiv.querySelector(`input.sermon-link-checkbox[data-c="${sermonLinkColIdx}"]`);
      const dInput = target.inputsMap[dateColIdx];
      if (checkbox && checkbox.checked && dInput && dInput.value) {
        const sw = target.rowDiv.querySelector(`input.sermon-lang-switch[data-c="${sermonLinkColIdx}"]`);
        const langVal = sw && sw.checked ? "台語/聯合" : "華語/聯合";
        updateRowSermonState(target.rowDiv, langVal, dInput.value.trim());
      }
    }
  });

  sortRowsByDate();
}


// ============================================================
//  💾 儲存資料
// ============================================================
async function saveData() {
  if (window.event) window.event.preventDefault();
  if (!isScheduleRequired()) {
    getNotifier().warning("⚠️ 此事工目前設定為不需要排班，請改用成員名單儲存");
    return;
  }

  // 防止重複提交
  if (getUIState().isLocked('saveData')) return;
  getUIState().lock('saveData');

  // 儲存前先將畫面上的列按日期排序，以確保儲存到 Sheet 也是排序好的
  sortRowsByDate();

  getNotifier().showLoading("💾 儲存中...");

  try {
    const matrix = [currentTableHeaders];
    document.querySelectorAll('.record-row').forEach(rowDiv => {
      const row = [];
      currentTableHeaders.forEach((header, cIdx) => {
        if (header === "套用講道") {
          const checkbox = rowDiv.querySelector(`input.sermon-link-checkbox[data-c="${cIdx}"]`);
          const sw = rowDiv.querySelector(`input.sermon-lang-switch[data-c="${cIdx}"]`);
          const isChecked = checkbox && checkbox.checked;
          const langVal = sw && sw.checked ? "台語/聯合" : "華語/聯合";
          row.push(isChecked ? langVal : "N");
        } else {
          const input = rowDiv.querySelector(`input.grid-input[data-c="${cIdx}"]`);
          row.push(input ? input.value : "");
        }
      });
      // 只要有任何非「套用講道」的欄位有內容，即視為有效列
      if (row.some((v, idx) => currentTableHeaders[idx] !== "套用講道" && v.trim() !== "")) {
        matrix.push(row);
      }
    });

    while (matrix.length <= 50) matrix.push(Array(currentTableHeaders.length).fill(""));

    await fetchAPI("saveSheetData", { groupName: activeGroupName, matrix: matrix });

    getNotifier().success("✅ 儲存成功！");
  } catch (err) {
    handleAPIError(err);
  } finally {
    getNotifier().hideLoading();
    getUIState().unlock('saveData');
  }
}


// ============================================================
//  🔄 切換狀態
// ============================================================
async function toggleStatus(groupId, currentStatus) {
  if (window.event) window.event.preventDefault();

  if (getUIState().isLocked('toggleStatus')) return;
  getUIState().lock('toggleStatus');

  getNotifier().showLoading("🔄 更新狀態中...");

  try {
    await fetchAPI("toggleGroupStatus", { id: groupId, status: currentStatus });
    await loadAdminData();
  } catch (err) {
    handleAPIError(err);
  } finally {
    getNotifier().hideLoading();
    getUIState().unlock('toggleStatus');
  }
}


// ============================================================
//  🎨 UI 元件控制
// ============================================================
function showSection(id) {
  document.querySelectorAll('.card-custom').forEach(el => el.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
}


// ============================================================
//  ➕ 建立新分頁表單
// ============================================================
const createForm = document.getElementById('createGroupForm');
if (createForm) {
  const templateSelect = document.getElementById('templateSelect');
  if (templateSelect) {
    templateSelect.addEventListener('change', function() {
      const container = document.getElementById('ministryOptionsContainer');
      if (container) {
        if (this.value === '事工型模板') {
          container.classList.remove('hidden');
        } else {
          container.classList.add('hidden');
        }
      }
    });
  }

  createForm.onsubmit = async function(e) {
    e.preventDefault();

    if (getUIState().isLocked('createGroup')) return;
    getUIState().lock('createGroup');

    getNotifier().showLoading("建立中...");
    try {
      const fieldTemplateType = document.getElementById('templateSelect').value;
      const nextId = document.getElementById('newId').value.trim();
      const template = initialFieldTemplates[fieldTemplateType] || initialFieldTemplates["事工型模板"];
      
      let scheduleMode = "schedule";
      let scheduleTarget = "members";
      if (fieldTemplateType === "事工型模板") {
        const modeEl = document.getElementById('newScheduleModeSelect');
        const targetEl = document.getElementById('newScheduleTargetSelect');
        if (modeEl) scheduleMode = modeEl.value;
        if (targetEl) scheduleTarget = targetEl.value;
      }

      const firstConfig = normalizeFieldConfig({
        fields: template.defaultFields.map(name => ({ name, enabled: true, custom: false })),
        requiredFields: template.requiredFields,
        scheduleMode: scheduleMode,
        scheduleTarget: scheduleTarget
      }, fieldTemplateType, nextId);
      await fetchAPI("createGroup", {
        id: nextId,
        name: document.getElementById('newName').value,
        template: getBackendTemplateForFieldType(fieldTemplateType),
        fieldTemplateType,
        pageFieldConfig: firstConfig
      });
      localStorage.setItem(getFieldConfigStorageKey(nextId), JSON.stringify(firstConfig));
      location.reload();
    } catch (err) {
      handleAPIError(err);
    } finally {
      getNotifier().hideLoading();
      getUIState().unlock('createGroup');
    }
  };
}


// ============================================================
//  💾 儲存小組規則
// ============================================================
async function saveGroupPrompt() {
  if (window.event) window.event.preventDefault();

  if (getUIState().isLocked('saveGroupPrompt')) return;
  getUIState().lock('saveGroupPrompt');

  const newPrompt = document.getElementById('groupPromptInput').value.trim();
  getNotifier().showLoading("💾 儲存規則中...");

  try {
    await fetchAPI("saveGroupPrompt", { id: currentId, prompt: newPrompt });
    currentGroupPrompt = newPrompt;
    getNotifier().success("✅ 專屬規則儲存成功！");
  } catch (err) {
    handleAPIError(err);
  } finally {
    getNotifier().hideLoading();
    getUIState().unlock('saveGroupPrompt');
  }
}


// ============================================================
//  📅 共用日期篩選器（modal 用：年度 + 季度 + 滾動近 3 個月）
// ============================================================
const _MS_FILTER_QUARTERS = [1, 2, 3, 4];

// 應該被視為「小組類聚會」的模板（小組總表 / 各小組佈告欄會包含這些）
const _MS_FELLOWSHIP_TEMPLATES = ['小組聚會表模板', '團契聚會表模板', '聚會型模板', 'gathering'];
// 各項服事總表合併同日期時，要丟掉的「來源」欄位
const _MS_META_COLS = ['分頁名稱', '模板類型', '聚會名稱', '聚會類別'];

// ---- 矩陣 / 物件互轉 ----
function _ms_matrixToObjects(matrix) {
  if (!matrix || matrix.length < 2) return [];
  const headers = matrix[0];
  return matrix.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = row[i]);
    return obj;
  });
}

function _ms_objectsToMatrix(objects, headerOrder, opts = {}) {
  // strict: 只用 headerOrder 列出的欄位，忽略 objects 中其他欄位
  const strict = opts.strict === true;
  if (!objects || objects.length === 0) return headerOrder ? [headerOrder.slice()] : [];
  let headers;
  if (strict && headerOrder) {
    headers = headerOrder.slice();
  } else {
    const seen = new Set();
    headers = [];
    if (headerOrder) headerOrder.forEach(h => { if (!seen.has(h)) { seen.add(h); headers.push(h); } });
    objects.forEach(obj => Object.keys(obj).forEach(k => { if (!seen.has(k)) { seen.add(k); headers.push(k); } }));
  }
  const rows = objects.map(obj => headers.map(h => obj[h] == null ? '' : obj[h]));
  return [headers, ...rows];
}

function _ms_filterMatrix(matrix, predicate) {
  if (!matrix || matrix.length < 2) return matrix ? matrix.slice() : [];
  const filtered = _ms_matrixToObjects(matrix).filter(predicate);
  return _ms_objectsToMatrix(filtered, matrix[0]);
}

// 合併兩個（或多個）矩陣，headers 取 union 並依首次出現的順序排列
function _ms_mergeMatrices(...matrices) {
  const objs = matrices.flatMap(m => _ms_matrixToObjects(m || []));
  const seen = new Set();
  const headerOrder = [];
  matrices.forEach(m => {
    if (m && m[0]) m[0].forEach(h => { if (!seen.has(h)) { seen.add(h); headerOrder.push(h); } });
  });
  return _ms_objectsToMatrix(objs, headerOrder);
}

// 同日期的多列合併成一列：每欄不同值用「\n」串接，並加上 (來源) 標記
// dropColumns 中的欄位會被移除（預設為「分頁名稱/模板類型/聚會名稱/聚會類別」）
function _ms_collapseByDate(matrix, opts = {}) {
  const dropCols = opts.dropColumns || _MS_META_COLS;
  if (!matrix || matrix.length < 2) return matrix ? matrix.slice() : [];

  const objects = _ms_matrixToObjects(matrix);
  const byDate = new Map();
  const sourceOf = obj => obj['分頁名稱'] || obj['聚會名稱'] || '';

  objects.forEach(obj => {
    const date = obj['日期'] || '';
    if (!date) return;
    if (!byDate.has(date)) byDate.set(date, new Map()); // colName -> Map<value, Set<source>>
    const cols = byDate.get(date);
    const src = sourceOf(obj);
    Object.keys(obj).forEach(k => {
      if (k === '日期' || dropCols.includes(k)) return;
      const v = obj[k];
      if (v == null || v === '' || v === '-') return;
      if (!cols.has(k)) cols.set(k, new Map());
      const valMap = cols.get(k);
      const sv = String(v);
      if (!valMap.has(sv)) valMap.set(sv, new Set());
      if (src) valMap.get(sv).add(src);
    });
  });

  const merged = [];
  Array.from(byDate.keys()).sort().forEach(date => {
    const obj = { '日期': date };
    byDate.get(date).forEach((valMap, k) => {
      const lines = Array.from(valMap.entries()).map(([value, sources]) => {
        const srcs = Array.from(sources).filter(Boolean);
        return srcs.length > 0 ? `${value} (${srcs.join('、')})` : value;
      });
      obj[k] = lines.join('\n');
    });
    merged.push(obj);
  });

  // 欄位順序：日期優先，後接原始 matrix 的欄位（去掉 drop 跟日期）
  const headerOrder = ['日期', ...matrix[0].filter(h => h !== '日期' && !dropCols.includes(h))];
  return _ms_objectsToMatrix(merged, headerOrder);
}

// ---- getAggregatedReport 雙桶快取（30 秒內重複開 modal 不重複 fetch）----
let _ms_aggCache = { sm: null, oth: null, ts: 0 };
const _MS_AGG_TTL = 30 * 1000;

async function _ms_fetchBothAggregated() {
  const now = Date.now();
  if (_ms_aggCache.sm && (now - _ms_aggCache.ts) < _MS_AGG_TTL) return _ms_aggCache;
  // 用 allSettled 允許單邊失敗：例如 'others' 失敗時，'小組總表' 仍能顯示（只是少了 團契 那塊）
  const [smRes, othRes] = await Promise.allSettled([
    fetchAPI('getAggregatedReport', { type: 'smallGroup' }),
    fetchAPI('getAggregatedReport', { type: 'others' })
  ]);
  const sm  = smRes.status === 'fulfilled'  ? (smRes.value  || []) : [];
  const oth = othRes.status === 'fulfilled' ? (othRes.value || []) : [];
  if (smRes.status === 'rejected')  console.warn('[MinistrySchedule] 小組總表抓取失敗：', smRes.reason);
  if (othRes.status === 'rejected') console.warn('[MinistrySchedule] 各項總表抓取失敗：', othRes.reason);
  _ms_aggCache = { sm, oth, ts: now };
  return _ms_aggCache;
}

/**
 * 尋找當前 matrix 中最接近今天日期的資料列索引 (1-based)。
 * 優先尋找今天或未來的聚會中，最靠近今天（差距最小）的那一列。
 * 若全部聚會皆在過去，則回傳過去中距離今天最近（即最新）的一列。
 */
function _ms_findClosestRowIndex(matrix, dateColIdx) {
  if (!matrix || matrix.length <= 1 || dateColIdx < 0) return -1;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();

  let closestIdx = -1;
  let minDiffFuture = Infinity;
  let closestIdxPast = -1;
  let minDiffPast = Infinity;

  for (let i = 1; i < matrix.length; i++) {
    const dStr = matrix[i][dateColIdx];
    const d = _ms_parseLocalDate(dStr);
    if (!d) continue;
    const dMs = d.getTime();
    
    const diff = dMs - todayMs;
    if (diff >= 0) {
      if (diff < minDiffFuture) {
        minDiffFuture = diff;
        closestIdx = i;
      }
    } else {
      const absDiff = Math.abs(diff);
      if (absDiff < minDiffPast) {
        minDiffPast = absDiff;
        closestIdxPast = i;
      }
    }
  }

  return closestIdx !== -1 ? closestIdx : closestIdxPast;
}

function _ms_getDateColIdx(headers) {
  if (!Array.isArray(headers)) return -1;
  return headers.findIndex(h => String(h || '').includes('日期'));
}

function _ms_yearsFromMatrix(matrix, dateColIdx) {
  if (!matrix || matrix.length < 2 || dateColIdx < 0) return [new Date().getFullYear()];
  const ys = new Set();
  for (let i = 1; i < matrix.length; i++) {
    const d = _ms_parseLocalDate(matrix[i][dateColIdx]);
    if (d) ys.add(d.getFullYear());
  }
  const arr = Array.from(ys).sort((a, b) => b - a);
  const cur = new Date().getFullYear();
  if (!arr.includes(cur)) arr.unshift(cur);
  return arr;
}

function _ms_currentQuarter() {
  return Math.floor(new Date().getMonth() / 3) + 1;
}

function _ms_parseLocalDate(value) {
  if (value instanceof Date && !isNaN(value)) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }

  const parts = String(value || '').match(/\d+/g);
  if (!parts || parts.length < 3) return null;

  let year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  const day = parseInt(parts[2], 10);

  if (year <= 99) {
    year += 2000;
  } else if (year <= 200) {
    year += 1911;
  }

  const parsed = new Date(year, month - 1, day);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) return null;

  parsed.setHours(0, 0, 0, 0);
  return parsed;
}

function _ms_formatLocalDate(date) {
  if (!(date instanceof Date) || isNaN(date)) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function _ms_rollingWindow() {
  // 預設範圍：往前 1 個月、往後 2 個月
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setMonth(start.getMonth() - 1);
  const end = new Date(today);
  end.setMonth(end.getMonth() + 2);
  end.setHours(23, 59, 59, 999);
  return [start, end];
}

function _ms_applyDateFilter(matrix, dateColIdx, mode, year, quarter) {
  if (!matrix || matrix.length < 2) return matrix ? matrix.slice() : [];
  if (dateColIdx < 0) return matrix.slice();
  const headers = matrix[0];
  let predicate;
  if (mode === 'rolling') {
    const [start, end] = _ms_rollingWindow();
    predicate = d => d >= start && d <= end;
  } else {
    const m1 = (quarter - 1) * 3 + 1;
    predicate = d => d.getFullYear() === year && (d.getMonth() + 1) >= m1 && (d.getMonth() + 1) <= m1 + 2;
  }
  const filtered = matrix.slice(1).filter(row => {
    const d = _ms_parseLocalDate(row[dateColIdx]);
    if (!d) return false;
    return predicate(d);
  });
  return [headers, ...filtered];
}

function _ms_buildTableHtml(matrix, opts = {}) {
  const minWidth = opts.minWidth || 800;
  if (!matrix || matrix.length <= 1) {
    return '<p class="text-center text-muted my-4">此範圍內沒有資料，請改選其他季度</p>';
  }
  const dateColIdx = _ms_getDateColIdx(matrix[0]);
  const closestIdx = _ms_findClosestRowIndex(matrix, dateColIdx);

  let html = `<table class="table table-bordered table-hover text-center align-middle m-0" style="min-width: ${minWidth}px;"><thead><tr>`;
  matrix[0].forEach(h => html += `<th class="bg-light" style="position: sticky; top: 0; z-index: 10; outline: 1px solid #dee2e6;">${h}</th>`);
  html += '</tr></thead><tbody>';
  // td 用 white-space: pre-line 讓合併日期時的「\n 換行」能正確呈現多行
  for (let i = 1; i < matrix.length; i++) {
    const isClosest = (i === closestIdx);
    const trIdAttr = isClosest ? 'id="ms-closest-date-item"' : '';
    const trClassAttr = isClosest ? 'class="closest-date-row"' : '';
    html += `<tr ${trIdAttr} ${trClassAttr}>`;
    matrix[i].forEach(cell => html += `<td style="white-space: pre-line; vertical-align: top;">${cell || "-"}</td>`);
    html += '</tr>';
  }
  html += '</tbody></table>';
  return html;
}

function _ms_buildCardsHtml(matrix) {
  if (!matrix || matrix.length <= 1) {
    return '<p class="text-center text-muted my-4">此範圍內沒有資料，請改選其他季度</p>';
  }
  _ms_lastFilteredCardsMatrix = matrix;
  const headers = matrix[0];
  const dateColIdx = _ms_getDateColIdx(headers);
  const closestIdx = _ms_findClosestRowIndex(matrix, dateColIdx);

  const topicColIdx = headers.findIndex(h => h === '主題' || h === '聚會名稱');
  const verseColIdx = headers.findIndex(h => h === '經文');
  const locColIdx = headers.findIndex(h => h === '地點');
  const sermonColIdx = headers.findIndex(h => h === '講道連動');

  const excludeFields = ['日期', '主題', '聚會名稱', '經文', '地點', '講道連動', '分頁名稱', '模板類型', '聚會類別'];

  let cardsHtml = '<div class="glass-board-container">';

  for (let i = 1; i < matrix.length; i++) {
    const row = matrix[i];
    const dateVal = dateColIdx >= 0 ? row[dateColIdx] : '';

    const dateObj = _ms_parseLocalDate(dateVal);
    let day = '';
    let yearMonth = '';
    let weekDay = '';
    if (dateObj) {
      day = String(dateObj.getDate()).padStart(2, '0');
      yearMonth = `${dateObj.getFullYear()}年 ${String(dateObj.getMonth() + 1).padStart(2, '0')}月`;
      weekDay = '星期' + ['日', '一', '二', '三', '四', '五', '六'][dateObj.getDay()];
    } else {
      day = '📅';
      yearMonth = dateVal || '聚會日';
      weekDay = '聚會日';
    }

    const topic = topicColIdx >= 0 ? row[topicColIdx] : '';
    const verse = verseColIdx >= 0 ? row[verseColIdx] : '';
    const location = locColIdx >= 0 ? row[locColIdx] : '';
    const hasSermon = sermonColIdx >= 0 && (String(row[sermonColIdx]).toUpperCase() === 'TRUE' || row[sermonColIdx] === true || String(row[sermonColIdx]) === '1');

    const duties = [];
    headers.forEach((h, idx) => {
      if (excludeFields.includes(h)) return;
      const val = row[idx];
      if (val && val !== '-' && val !== '') {
        duties.push({ role: h, name: val });
      }
    });

    const dutyItemsHtml = duties.map(d => `
      <div class="glass-duty-item">
        <span class="glass-duty-role">👤 ${d.role}</span>
        <span class="glass-duty-name">${d.name}</span>
      </div>
    `).join('');

    const metaItems = [];
    if (verse) metaItems.push(`<span>📖 <b>經文：</b><a href="verse_view.html?q=${encodeURIComponent(verse)}" target="_blank" class="verse-link">${verse}</a></span>`);
    if (location) metaItems.push(`<span>📍 <b>地點：</b>${location}</span>`);
    const metaHtml = metaItems.length > 0 ? `<div class="glass-meta">${metaItems.join('')}</div>` : '';

    const isClosest = (i === closestIdx);
    const cardIdAttr = isClosest ? 'id="ms-closest-date-item"' : '';
    const closestClass = isClosest ? 'closest-date-card' : '';

    cardsHtml += `
      <div ${cardIdAttr} class="glass-card color-ramp-${(i - 1) % 5} ${closestClass}">
        <div class="glass-date">
          <div class="day">${day}</div>
          <div class="month-year">${yearMonth}</div>
          <div class="weekday">${weekDay}</div>
        </div>
        <div class="glass-content">
          <div class="glass-topic-line d-flex justify-content-between align-items-center mb-2">
            <h3 class="glass-topic m-0">${topic || ((activeGroupName && activeGroupName.includes('團契')) ? '團契聚會' : '小組聚會')}</h3>
            <button type="button" class="btn-copy-glass-card" onclick="_ms_copyCardEvent(${i}, this)" title="一鍵複製此日聚會資訊">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
              <span>複製</span>
            </button>
          </div>
          <div class="glass-duties">
            ${dutyItemsHtml || '<div class="text-muted small">一般聚會，無需特別服事</div>'}
          </div>
          ${metaHtml}
        </div>
      </div>
    `;
  }

  cardsHtml += '</div>';
  return cardsHtml;
}

async function _ms_copyTextToClipboard(text, btn) {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      console.warn('navigator.clipboard failed, fallback:', e);
    }
  }
  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.style.position = 'fixed';
  textArea.style.left = '0';
  textArea.style.top = '0';
  textArea.style.opacity = '0.01';
  textArea.style.zIndex = '999999';
  const container = (btn && btn.closest('.modal-content')) || document.body;
  container.appendChild(textArea);
  textArea.focus();
  textArea.select();
  textArea.setSelectionRange(0, 99999);
  let success = false;
  try {
    success = document.execCommand('copy');
  } catch (err) {
    console.error('execCommand failed:', err);
  }
  container.removeChild(textArea);
  return success;
}

function _ms_copyCardEvent(rowIdx, btn) {
  try {
    if (!_ms_lastFilteredCardsMatrix || !_ms_lastFilteredCardsMatrix[rowIdx]) return;
    const headers = _ms_lastFilteredCardsMatrix[0] || [];
    const row = _ms_lastFilteredCardsMatrix[rowIdx] || [];

    const dateColIdx = _ms_getDateColIdx(headers);
    const topicColIdx = headers.findIndex(h => h === '主題' || h === '聚會名稱');
    const verseColIdx = headers.findIndex(h => h === '經文');
    const locColIdx = headers.findIndex(h => h === '地點');

    const dateVal = dateColIdx >= 0 ? row[dateColIdx] : '';
    const dateObj = _ms_parseLocalDate(dateVal);
    let dateFormatted = dateVal;
    if (dateObj) {
      const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
      dateFormatted = `${_ms_formatLocalDate(dateObj)} (星期${weekDays[dateObj.getDay()]})`;
    }

    const topic = topicColIdx >= 0 ? row[topicColIdx] : '';
    const verse = verseColIdx >= 0 ? row[verseColIdx] : '';
    const location = locColIdx >= 0 ? row[locColIdx] : '';
    const groupName = activeGroupName || '小組';

    const excludeFields = ['日期', '主題', '經文', '地點', '聚會名稱', '聚會類別', '分頁名稱', '模板類型', '講道連動', '套用講道'];
    const dutyLines = [];
    headers.forEach((h, idx) => {
      if (excludeFields.includes(h)) return;
      const val = row[idx];
      if (val && val !== '-' && val !== '') {
        dutyLines.push(`  • ${h}：${val}`);
      }
    });

    let lines = [
      `🌿【${groupName} 聚會資訊】`,
      `📅 日期：${dateFormatted}`,
      `🏷️ 主題：${topic || ((activeGroupName && activeGroupName.includes('團契')) ? '團契聚會' : '小組聚會')}`
    ];
    if (location) lines.push(`📍 地點：${location}`);
    if (verse) {
      const verseUrl = new URL(`verse_view.html?q=${encodeURIComponent(verse)}`, window.location.href).href;
      lines.push(`📖 經文：${verse}`);
      lines.push(`🔗 經文連結：${verseUrl}`);
    }
    if (dutyLines.length > 0) {
      lines.push(`👥 服事同工：`);
      lines.push(...dutyLines);
    }

    const textToCopy = lines.join('\n');
    _ms_copyTextToClipboard(textToCopy, btn).then(success => {
      if (btn) {
        const origHtml = btn.innerHTML;
        btn.innerHTML = `
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
          <span>已複製！</span>
        `;
        btn.classList.add('copied');
        setTimeout(() => {
          btn.innerHTML = origHtml;
          btn.classList.remove('copied');
        }, 1500);
      }
    });
  } catch (err) {
    console.error('Error in _ms_copyCardEvent:', err);
  }
}
window._ms_copyCardEvent = _ms_copyCardEvent;

/**
 * 在指定容器內渲染「年度+季度」篩選器 + 表格或卡片。
 */
function _ms_renderFilterableTable({ container, fullMatrix, tableMinWidth, renderMode = 'table', onFilteredChange }) {
  const headers = (fullMatrix && fullMatrix[0]) || [];
  const dateColIdx = _ms_getDateColIdx(headers);
  const noDateCol = dateColIdx < 0;
  const years = _ms_yearsFromMatrix(fullMatrix, dateColIdx);
  const today = new Date();
  const state = {
    mode: 'rolling',
    year: years.includes(today.getFullYear()) ? today.getFullYear() : years[0],
    quarter: _ms_currentQuarter()
  };

  const filterBar = noDateCol ? '' : `
    <div class="ms-filter-toolbar d-flex align-items-center gap-2 mb-2 flex-wrap p-2 bg-light rounded border">
      <span class="text-muted small fw-bold">📅 顯示範圍：</span>
      <button type="button" id="ms-filter-rolling" class="btn btn-sm btn-primary">近 3 個月</button>
      <span class="text-muted">|</span>
      <select id="ms-filter-year" class="form-select form-select-sm" style="width: auto;">
        ${years.map(y => `<option value="${y}" ${y === state.year ? 'selected' : ''}>${y} 年</option>`).join('')}
      </select>
      <select id="ms-filter-quarter" class="form-select form-select-sm" style="width: auto;">
        ${_MS_FILTER_QUARTERS.map(q => `<option value="${q}" ${q === state.quarter ? 'selected' : ''}>Q${q} (${(q - 1) * 3 + 1}~${q * 3}月)</option>`).join('')}
      </select>
      <span id="ms-filter-status" class="text-muted small ms-auto"></span>
    </div>`;

  container.innerHTML = filterBar + `<div class="table-responsive" id="ms-filter-table" style="max-height: 60vh; overflow-y: auto;"></div>`;

  function rerender() {
    const filtered = noDateCol
      ? fullMatrix.slice()
      : _ms_applyDateFilter(fullMatrix, dateColIdx, state.mode, state.year, state.quarter);
    
    if (renderMode === 'cards') {
      document.getElementById('ms-filter-table').innerHTML = _ms_buildCardsHtml(filtered);
    } else {
      document.getElementById('ms-filter-table').innerHTML = _ms_buildTableHtml(filtered, { minWidth: tableMinWidth });
    }
    
    const statusEl = document.getElementById('ms-filter-status');
    if (statusEl) {
      const recordCount = Math.max(filtered.length - 1, 0);
      statusEl.innerText = state.mode === 'rolling'
        ? `共 ${recordCount} 筆（近 3 個月）`
        : `共 ${recordCount} 筆（${state.year} Q${state.quarter}）`;
    }
    const rollingBtn = document.getElementById('ms-filter-rolling');
    if (rollingBtn) {
      rollingBtn.classList.toggle('btn-primary', state.mode === 'rolling');
      rollingBtn.classList.toggle('btn-outline-primary', state.mode !== 'rolling');
    }
    if (typeof onFilteredChange === 'function') onFilteredChange(filtered);

    // 自動滾動至最接近今日日期的列/卡片
    setTimeout(() => {
      const closestEl = document.getElementById('ms-closest-date-item');
      if (closestEl) {
        closestEl.scrollIntoView({ block: 'center' });
      }
    }, 150);
  }

  if (!noDateCol) {
    document.getElementById('ms-filter-rolling').onclick = () => { state.mode = 'rolling'; rerender(); };
    document.getElementById('ms-filter-year').onchange = e => { state.mode = 'quarter'; state.year = +e.target.value; rerender(); };
    document.getElementById('ms-filter-quarter').onchange = e => { state.mode = 'quarter'; state.quarter = +e.target.value; rerender(); };
  }

  rerender();
}


// ============================================================
//  📋 預覽佈告欄
// ============================================================
function showBulletinBoard() {
  if (window.event) window.event.preventDefault();

  // 從目前的編輯表單擷取完整 matrix（仍尊重 .hidden 過濾，例如編輯模式的日期區間）
  const matrix = [currentTableHeaders];
  document.querySelectorAll('.record-row').forEach(rowDiv => {
    if (rowDiv.classList.contains('hidden')) return;
    const row = Array.from(rowDiv.querySelectorAll('.grid-input')).map(i => i.value.trim());
    if (row.some(v => v !== "")) matrix.push(row);
  });

  _currentBulletinFiltered = matrix;
  _ms_renderFilterableTable({
    container: document.getElementById('bulletinContent'),
    fullMatrix: matrix,
    tableMinWidth: 800,
    renderMode: 'cards',
    onFilteredChange: filtered => { _currentBulletinFiltered = filtered; }
  });

  document.getElementById('bulletinModalLabel').innerText = `📋 ${activeGroupName} - 排班佈告欄`;

  const closeBtn = document.getElementById('modalCloseBtn');
  if (isEditorUnlocked) {
    closeBtn.innerText = "✖ 關閉預覽";
    closeBtn.classList.replace('btn-warning', 'btn-secondary');
  }

  if (!bulletinModalInstance) {
    bulletinModalInstance = new bootstrap.Modal(document.getElementById('bulletinModal'), {
      backdrop: 'static',
      keyboard: false
    });
  }

  const modalEl = document.getElementById('bulletinModal');
  if (modalEl) {
    if (modalEl._shownListener) {
      modalEl.removeEventListener('shown.bs.modal', modalEl._shownListener);
    }
    modalEl._shownListener = () => {
      setTimeout(() => {
        const closestEl = document.getElementById('ms-closest-date-item');
        if (closestEl) {
          closestEl.scrollIntoView({ block: 'center' });
        }
      }, 50);
    };
    modalEl.addEventListener('shown.bs.modal', modalEl._shownListener);
  }

  bulletinModalInstance.show();
}


// ============================================================
//  🔓 解鎖編輯模式 (本地驗證與解密版)
// ============================================================

let unlockVerifyModalInstance = null;

async function closeModalOrUnlock() {
  if (window.event) window.event.preventDefault();
  if (isEditorUnlocked) {
    bulletinModalInstance.hide();
  } else {
    if (!unlockVerifyModalInstance) {
      unlockVerifyModalInstance = new bootstrap.Modal(document.getElementById('unlockVerifyModal'), {
        backdrop: 'static',
        keyboard: false
      });
      // 註冊 Enter 鍵監聽
      document.getElementById('unlockVerifyCode').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          submitUnlockVerifyCode();
        }
      });
    }
    document.getElementById('unlockVerifyCode').value = '';
    document.getElementById('unlockVerifyError').classList.add('hidden');
    unlockVerifyModalInstance.show();
    
    // 延遲聚焦以支援 CSS 動畫完成
    setTimeout(() => {
      document.getElementById('unlockVerifyCode').focus();
    }, 500);
  }
}

async function submitUnlockVerifyCode() {
  const pwd = document.getElementById('unlockVerifyCode').value.trim();
  if (!pwd) {
    getNotifier().warning("⚠️ 請輸入專屬 ID");
    return;
  }

  const errorEl = document.getElementById('unlockVerifyError');
  errorEl.classList.add('hidden');

  const decryptedId = decryptGroupCode(currentId);
  const inputCode = pwd.toUpperCase();
  const isMaster = (inputCode === "LK31"); // ADMIN_CODE
  const isMatch = (inputCode === decryptedId.toUpperCase());

  if (isMaster || isMatch) {
    isEditorUnlocked = true;
    getSessionMgr().setUnlocked(currentId);
    
    if (unlockVerifyModalInstance) unlockVerifyModalInstance.hide();
    if (bulletinModalInstance) bulletinModalInstance.hide();
    
    getNotifier().success("✅ 編輯模式已啟用");
  } else {
    errorEl.classList.remove('hidden');
    const inputEl = document.getElementById('unlockVerifyCode');
    inputEl.value = '';
    inputEl.focus();
  }
}

window.submitUnlockVerifyCode = submitUnlockVerifyCode;


// ============================================================
//  📥 下載 Excel
// ============================================================
async function downloadExcel() {
  if (window.event) window.event.preventDefault();

  await ensureXLSXReady();

  const sermonLinkColIdx = currentTableHeaders.indexOf("套用講道");
  
  // 產生過濾掉「套用講道」的標題列
  const exportHeaders = currentTableHeaders.filter(h => h !== "套用講道");

  let matrix;
  if (Array.isArray(_currentBulletinFiltered) && _currentBulletinFiltered.length > 1) {
    // 若有篩選快取，將每一列的「套用講道」欄位濾除
    matrix = _currentBulletinFiltered.map((row, rIdx) => {
      if (rIdx === 0) return exportHeaders; // 標題列
      if (sermonLinkColIdx !== -1) {
        return row.filter((_, cIdx) => cIdx !== sermonLinkColIdx);
      }
      return row;
    });
  } else {
    matrix = [exportHeaders];
    document.querySelectorAll('.record-row').forEach(rowDiv => {
      if (rowDiv.classList.contains('hidden')) return;
      
      const row = [];
      currentTableHeaders.forEach((header, cIdx) => {
        if (header === "套用講道") {
          // 下載排班表時不納入此欄位，直接跳過
          return;
        }
        const input = rowDiv.querySelector(`input.grid-input[data-c="${cIdx}"]`);
        row.push(input ? input.value.trim() : "");
      });

      if (row.some(v => v !== "")) {
        matrix.push(row);
      }
    });
  }

  if (matrix.length === 1) {
    getNotifier().warning("⚠️ 目前沒有資料可以下載！");
    return;
  }

  const ws = XLSX.utils.aoa_to_sheet(matrix);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "佈告欄");

  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  XLSX.writeFile(wb, `${activeGroupName}_排班表_${today}.xlsx`);
  getNotifier().success("✅ Excel 已下載");
}


// ============================================================
//  👥 管理同工名單
// ============================================================
let _memberSuggestionsCache = null;

async function loadMemberSuggestions() {
  const datalist = document.getElementById('memberSuggestionsList');
  if (!datalist) return;

  if (currentScheduleTarget === "clusters") {
    await loadGroupClusters();
    // 排除已在名單中的 (只比對 name)
    const existingNames = new Set(localCustomMembers.map(m => m.name));
    const candidates = globalGroupClusters.filter(name => !existingNames.has(name));
    datalist.innerHTML = candidates.map(name => `<option value="${name}"></option>`).join('');
    return;
  }

  const buildOptions = (data) => {
    // 排除已在名單中的 (同 name+uid 才算重複)
    const existingKey = new Set(localCustomMembers.map(m => `${m.name}__${m.uid || ''}`));
    const candidates = data.filter(m => !existingKey.has(`${m.name}__${m.uid}`));

    // 計算每個 name 出現次數以決定是否需要用 UID 區分
    const nameCount = {};
    candidates.forEach(m => { nameCount[m.name] = (nameCount[m.name] || 0) + 1; });

    datalist.innerHTML = candidates.map(m => {
      const label = nameCount[m.name] > 1
        ? `${m.name} (${m.uid})`
        : m.name;
      return `<option value="${label}"></option>`;
    }).join('');
  };

  if (_memberSuggestionsCache) {
    buildOptions(_memberSuggestionsCache);
    return;
  }

  try {
    const res = await fetchAPI('getMemberSuggestions');
    if (res && Array.isArray(res)) {
      _memberSuggestionsCache = res;
      buildOptions(res);
    }
  } catch (e) {
    console.warn('載入會友建議清單失敗', e);
  }
}

function openMemberModal() {
  if (window.event) window.event.preventDefault();
  const roleSelect = document.getElementById('newMemberRole');
  if (currentTemplate === "新家人服事表模板") {
    roleSelect.classList.remove('hidden');
  } else {
    roleSelect.classList.add('hidden');
  }

  const modalEl = document.getElementById('memberModal');
  const titleEl = modalEl.querySelector('.modal-title');
  const inputEl = document.getElementById('newMemberInput');
  if (currentScheduleTarget === "clusters") {
    if (titleEl) titleEl.innerText = "👥 管理小組群名單";
    if (inputEl) {
      inputEl.placeholder = "輸入小組群名稱 (可從下拉清單選擇)";
    }
  } else {
    if (titleEl) titleEl.innerText = "👥 管理同工名單";
    if (inputEl) {
      inputEl.placeholder = "輸入姓名 (可從下拉清單選擇)";
    }
  }

  renderMemberList();
  loadMemberSuggestions();
  new bootstrap.Modal(modalEl).show();
}

function renderMemberList() {
  const listEl = document.getElementById('memberList');
  listEl.innerHTML = localCustomMembers.map((m, idx) => `
    <li class="list-group-item d-flex justify-content-between align-items-center">
      <div>
        <span class="fw-bold">${m.name}</span>
        ${m.uid ? `<small class="text-muted ms-2">(${m.uid})</small>` : ''}
        ${currentTemplate === "新家人服事表模板" ? `<span class="badge bg-secondary ms-2">${m.role}</span>` : ''}
      </div>
      <button type="button" class="btn btn-sm btn-danger" onclick="deleteMember(${idx})">刪除</button>
    </li>
  `).join('');
}

function addMember() {
  if (window.event) window.event.preventDefault();
  const nameInput = document.getElementById('newMemberInput');
  const roleSelect = document.getElementById('newMemberRole');
  const rawText = nameInput.value.trim();
  const role = roleSelect.value;

  if (!rawText) {
    getNotifier().warning("⚠️ 請輸入姓名！");
    return;
  }

  // 解析「名字 (LKxxxxx)」格式（同名情況下會看到）
  const m = rawText.match(/^(.+?)\s*\((LK\d+)\)\s*$/i);
  let newName = m ? m[1].trim() : rawText;
  let newUid  = m ? m[2].trim().toUpperCase() : '';

  // 若使用者只打了姓名，且大名單中恰好有 唯一一個 同名會友 → 自動帶入 UID
  if (!newUid && _memberSuggestionsCache) {
    const matched = _memberSuggestionsCache.filter(x => x.name === newName);
    if (matched.length === 1) newUid = matched[0].uid;
  }

  // 同名 + 同 UID 才視為重複（容許多個同名但 UID 不同的人）
  const dup = localCustomMembers.some(em =>
    em.name === newName && (em.uid || '') === newUid
  );
  if (dup) {
    getNotifier().warning("⚠️ 此人已經在名單中了！");
    return;
  }

  localCustomMembers.push({
    name: newName,
    uid: newUid,
    role: currentTemplate === "新家人服事表模板" ? role : "一般同工"
  });

  nameInput.value = "";
  renderMemberList();
  loadMemberSuggestions();
  getNotifier().success("✅ 已新增");
}

function deleteMember(idx) {
  if (window.event) window.event.preventDefault();
  localCustomMembers.splice(idx, 1);
  renderMemberList();
  loadMemberSuggestions();
}

async function saveMembersToServer() {
  if (window.event) window.event.preventDefault();

  if (getUIState().isLocked('saveMembersToServer')) return;
  getUIState().lock('saveMembersToServer');

  getNotifier().showLoading("💾 儲存名單中...");

  try {
    await fetchAPI("saveGroupMembers", { id: currentId, members: localCustomMembers });
    getNotifier().success("✅ 名單儲存成功！");

    const memberModalEl = document.getElementById('memberModal');
    if (memberModalEl) {
      const memberModal = bootstrap.Modal.getInstance(memberModalEl);
      if (memberModal) memberModal.hide();
    }

    getNotifier().showLoading("🔄 更新畫面中...");
    const freshConfig = await fetchAPI('getPageConfig', { id: currentId });
    await prepareClustersAndRender(freshConfig);
    getNotifier().success("✅ 畫面已更新");
  } catch (err) {
    handleAPIError(err);
  } finally {
    getNotifier().hideLoading();
    getUIState().unlock('saveMembersToServer');
  }
}


// ============================================================
//  🧑‍🤝‍🧑 設定小組組員身分（小組/團契模板專用，跳過小組系統直接編輯 master）
// ============================================================
let _groupRoleEditingMembers = [];

async function openGroupRoleModal() {
  if (window.event) window.event.preventDefault();
  if (!activeGroupName) {
    getNotifier().warning("⚠️ 尚未載入小組資料");
    return;
  }

  document.getElementById('groupRoleModalTitle').innerText = activeGroupName;
  const listEl = document.getElementById('groupRoleList');
  listEl.innerHTML = '<li class="list-group-item text-center text-muted"><div class="spinner-border spinner-border-sm me-2"></div>載入中...</li>';

  new bootstrap.Modal(document.getElementById('groupRoleModal')).show();

  try {
    const data = await fetchAPI('getGroupMembers', { groupName: activeGroupName });
    if (!data || !data.isInitialized) {
      listEl.innerHTML = '<li class="list-group-item text-center text-warning py-3">⚠️ 此小組尚未初始化名單<br><small class="text-muted">請先去小組系統初始化</small></li>';
      _groupRoleEditingMembers = [];
      return;
    }
    _groupRoleEditingMembers = (data.members || []).map(m => ({ ...m }));
    renderGroupRoleList();
  } catch (err) {
    handleAPIError(err);
    listEl.innerHTML = `<li class="list-group-item text-center text-danger py-3">❌ 載入失敗</li>`;
  }
}

function renderGroupRoleList() {
  const listEl = document.getElementById('groupRoleList');
  if (_groupRoleEditingMembers.length === 0) {
    listEl.innerHTML = '<li class="list-group-item text-center text-muted py-3">此小組沒有任何成員</li>';
    return;
  }
  listEl.innerHTML = _groupRoleEditingMembers.map((m, idx) => {
    const roleClasses = {
      '核心同工': 'role-core',
      '一般同工': 'role-active',
      '陪伴同工': 'role-companion',
      '小羊':     'role-sheep'
    };
    const selClasses = {
      '核心同工': 'sel-core',
      '一般同工': 'sel-active',
      '陪伴同工': 'sel-companion',
      '小羊':     'sel-sheep'
    };
    const bClass = roleClasses[m.role] || 'role-sheep';
    const sClass = selClasses[m.role] || 'sel-sheep';
    const nickname = (m.nickname || '').trim();
    return `
      <li class="list-group-item d-flex justify-content-between align-items-center role-item ${bClass}">
        <div>
          <span class="fw-bold">${m.name}</span>
          ${nickname ? `<small class="text-muted ms-2">(${nickname})</small>` : ''}
        </div>
        <select class="form-select form-select-sm role-select ${sClass}" style="width: 150px;"
                onchange="updateGroupRoleByIdx(${idx}, this.value)">
          <option value="核心同工" ${m.role === '核心同工' ? 'selected' : ''}>⭐ 核心同工</option>
          <option value="一般同工" ${m.role === '一般同工' ? 'selected' : ''}>👤 一般同工</option>
          <option value="小羊"     ${m.role === '小羊'     ? 'selected' : ''}>🐑 小羊</option>
          <option value="陪伴同工" ${m.role === '陪伴同工' ? 'selected' : ''}>👥 陪伴同工</option>
        </select>
      </li>
    `;
  }).join('');
}

function updateGroupRoleByIdx(idx, newRole) {
  if (_groupRoleEditingMembers[idx]) {
    _groupRoleEditingMembers[idx].role = newRole;
    // 即時更新左側 border 顏色
    renderGroupRoleList();
  }
}

async function saveGroupRoles() {
  if (window.event) window.event.preventDefault();
  if (getUIState().isLocked('saveGroupRoles')) return;
  getUIState().lock('saveGroupRoles');

  getNotifier().showLoading("💾 儲存身分中...");
  try {
    await fetchAPI('updateGroupMemberRoles', {
      groupName: activeGroupName,
      members: _groupRoleEditingMembers
    });
    getNotifier().success("✅ 身分已更新！小組系統與 AI 排班會即時同步");

    const modal = bootstrap.Modal.getInstance(document.getElementById('groupRoleModal'));
    if (modal) modal.hide();

    // 重新讀取頁面設定（讓 AI 規則更新到新身分）
    getNotifier().showLoading("🔄 更新畫面中...");
    const freshConfig = await fetchAPI('getPageConfig', { id: currentId });
    await prepareClustersAndRender(freshConfig);
  } catch (err) {
    handleAPIError(err);
  } finally {
    getNotifier().hideLoading();
    getUIState().unlock('saveGroupRoles');
  }
}


// ============================================================
//  📊 彙整報表
// ============================================================
async function showAggregatedReport(type) {
  if (window.event) window.event.preventDefault();

  if (getUIState().isLocked('showAggregatedReport')) return;
  getUIState().lock('showAggregatedReport');

  getNotifier().showLoading("📊 彙整資料中，這可能需要幾秒鐘...");

  try {
    // 同時抓 smallGroup + others，用模板類型重新分桶（團契歸到小組那邊）
    const { sm: smRaw, oth: othRaw } = await _ms_fetchBothAggregated();

    let matrix;
    if (type === 'smallGroup') {
      // 小組聚會總表 = 僅撈取後端 smallGroup（使用小組聚會表模板）的群組，不加入團契
      if (smRaw && smRaw.length > 1) {
        // 從快取直接讀取小組的實際欄位，並排除系統設定用欄位（套用講道、模板類型）
        const excludeHeaders = ['套用講道', '模板類型'];
        const finalHeaders = smRaw[0].filter(h => !excludeHeaders.includes(h));

        // 僅撈取小組聚會（排除團契）
        const objs = _ms_matrixToObjects(smRaw).filter(obj => 
          (obj['模板類型'] === '小組聚會表模板' || obj['模板類型'] === '聚會型模板' || obj['模板類型'] === 'gathering') &&
          !String(obj['分頁名稱'] || '').includes('團契')
        );

        // 先依「分頁名稱（組）」排序，相同組別再依「日期」升冪排序，統一用本地日期解析
        objs.sort((a, b) => {
          const groupA = String(a['分頁名稱'] || '');
          const groupB = String(b['分頁名稱'] || '');
          if (groupA !== groupB) {
            return groupA.localeCompare(groupB, 'zh-Hant');
          }
          const da = _ms_parseLocalDate(a['日期']);
          const db = _ms_parseLocalDate(b['日期']);
          if (!da && !db) return 0;
          if (!da) return 1;
          if (!db) return -1;
          return da.getTime() - db.getTime();
        });

        // 依據過濾後的欄位直接轉回矩陣呈現，不預設其他欄位
        matrix = _ms_objectsToMatrix(objs, finalHeaders, { strict: true });
      } else {
        matrix = smRaw;
      }
    } else {
      // 各項服事總表 = others 排除聚會型模板，依「分頁名稱（組）」及「日期」排列，不再做跨組的全域日期合併
      const withoutFellowship = _ms_filterMatrix(othRaw, obj => !isMeetingTemplate(obj['模板類型']));
      if (withoutFellowship.length > 1) {
        const objs = _ms_matrixToObjects(withoutFellowship);
        
        // 依「分頁名稱（組）」排序，相同組別再依「日期」升冪排序
        objs.sort((a, b) => {
          const groupA = String(a['分頁名稱'] || '');
          const groupB = String(b['分頁名稱'] || '');
          if (groupA !== groupB) {
            return groupA.localeCompare(groupB, 'zh-Hant');
          }
          const da = _ms_parseLocalDate(a['日期']);
          const db = _ms_parseLocalDate(b['日期']);
          if (!da && !db) return 0;
          if (!da) return 1;
          if (!db) return -1;
          return da.getTime() - db.getTime();
        });

        // 欄位順序：日期優先，後接分頁名稱，再接其他服事欄位（排除其餘 meta 欄位）
        const excludeHeaders = ['模板類型', '聚會名稱', '聚會類別', '日期', '分頁名稱'];
        const otherHeaders = withoutFellowship[0].filter(h => !excludeHeaders.includes(h));
        const finalHeaders = ['日期', '分頁名稱', ...otherHeaders];
        
        matrix = _ms_objectsToMatrix(objs, finalHeaders, { strict: true });
      } else {
        matrix = withoutFellowship;
      }
    }

    if (!matrix || matrix.length <= 1) {
      getNotifier().warning("⚠️ 目前還沒有建立任何資料，或是資料都是空的喔！");
      return;
    }

    const title = type === 'smallGroup' ? '📊 所有小組聚會總表' : '📊 教會各項服事總表';
    let currentFiltered = matrix;

    _ms_renderFilterableTable({
      container: document.getElementById('aggregatedReportContent'),
      fullMatrix: matrix,
      tableMinWidth: 1200,
      onFilteredChange: filtered => { currentFiltered = filtered; }
    });

    document.getElementById('aggregatedReportModalLabel').innerText = title;
    document.getElementById('downloadAggregatedBtn').onclick = () => downloadAggregatedExcel(currentFiltered, title);

    new bootstrap.Modal(document.getElementById('aggregatedReportModal')).show();
  } catch (err) {
    handleAPIError(err);
  } finally {
    getNotifier().hideLoading();
    getUIState().unlock('showAggregatedReport');
  }
}


// ============================================================
//  📥 下載彙整報表 Excel
// ============================================================
async function downloadAggregatedExcel(matrix, fileName) {
  if (!matrix || matrix.length === 0) return;

  await ensureXLSXReady();

  const wb = XLSX.utils.book_new();
  const headers = matrix[0];
  const groupColIdx = headers.indexOf("分頁名稱");

  if (groupColIdx >= 0 && matrix.length > 1) {
    // 依「分頁名稱」將資料列分組
    const grouped = {};
    for (let i = 1; i < matrix.length; i++) {
      const row = matrix[i];
      const groupName = row[groupColIdx] || "未分類";
      if (!grouped[groupName]) {
        grouped[groupName] = [];
      }
      grouped[groupName].push(row);
    }

    const usedNames = new Set();
    // 每個組別建立一個分頁 (Sheet)
    Object.keys(grouped).forEach(groupName => {
      let sheetName = sanitizeSheetName(groupName);
      let baseName = sheetName;
      let counter = 1;
      // 確保分頁名稱在 Excel 中不重複（不區分大小寫）
      while (usedNames.has(sheetName.toLowerCase())) {
        sheetName = `${baseName}_${counter}`;
        counter++;
      }
      usedNames.add(sheetName.toLowerCase());

      const sheetData = [headers, ...grouped[groupName]];
      const ws = XLSX.utils.aoa_to_sheet(sheetData);
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    });
  } else {
    // 若無分頁名稱欄位，則使用單一彙整分頁
    const ws = XLSX.utils.aoa_to_sheet(matrix);
    XLSX.utils.book_append_sheet(wb, ws, "彙整總表");
  }

  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  XLSX.writeFile(wb, `${fileName}_${today}.xlsx`);
  getNotifier().success("✅ Excel 已下載");
}

function sanitizeSheetName(name) {
  if (!name) return "未分類";
  // 移除 Excel 不支援的特殊字元 \ / ? * : [ ]
  let cleanName = name.replace(/[\\\/?*:[\]]/g, "").trim();
  // 限制長度為 31 個字元
  if (cleanName.length > 31) {
    cleanName = cleanName.slice(0, 31);
  }
  return cleanName || "未分類";
}


// ============================================================
//  🛠️ 輔助工具：將 0-based 欄位索引轉成 Excel 字母 (如 0->A)
// ============================================================
function getColLetter(colIdx) {
  let temp = colIdx;
  let letter = "";
  while (temp >= 0) {
    letter = String.fromCharCode((temp % 26) + 65) + letter;
    temp = Math.floor(temp / 26) - 1;
  }
  return letter;
}


// ============================================================
//  📥 匯出空白 Excel 模板
// ============================================================
async function exportBlankTemplate() {
  if (!currentTableHeaders || currentTableHeaders.length === 0) {
    getNotifier().warning("⚠️ 找不到表格標題，請先載入排班表！");
    return;
  }

  getNotifier().showLoading("⏳ 正在產生 Excel 模板...");

  try {
    await ensureExcelJSReady();
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("填寫模板");

    // 設定標題列
    worksheet.addRow(currentTableHeaders);

    // 增加 5 筆空白列
    for (let i = 0; i < 5; i++) {
      worksheet.addRow(currentTableHeaders.map(() => ""));
    }

    // 尋找「套用講道」欄位
    const sermonLinkColIdx = currentTableHeaders.indexOf("套用講道");
    if (sermonLinkColIdx !== -1) {
      const colLetter = getColLetter(sermonLinkColIdx);
      // 使用 worksheet.dataValidations.add 針對整個範圍進行資料驗證設定
      // 這能確保即使儲存格為空白，Excel 也能正確載入下拉選單限制
      worksheet.dataValidations.add(`${colLetter}2:${colLetter}500`, {
        type: 'list',
        allowBlank: true,
        formulae: ['"N,華語/聯合,台語/聯合"'],
        showDropDown: true
      });
    }

    // 匯出並下載
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${activeGroupName}_Excel填寫模板.xlsx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    getNotifier().success("✅ Excel 模板已下載！請填寫日期後匯入。");
  } catch (err) {
    console.error("產生模板失敗：", err);
    getNotifier().error("❌ 產生模板失敗：" + err.message);
  } finally {
    getNotifier().hideLoading();
  }
}


// ============================================================
//  📅 容錯日期解析（支援民國曆、西元、兩位年份、僅月日）
// ============================================================
function parseGregorianDate(rawStr) {
  if (!rawStr || typeof rawStr !== 'string') return null;

  const s = rawStr
    .replace(/[（(][一二三四五六日][）)]/g, '')
    .replace(/[（(][A-Za-z]{3}[）)]/gi, '')
    .replace(/星期[一二三四五六日]/g, '')
    .trim();

  const parts = s.match(/\d+/g);
  if (!parts) return null;

  let year, month, day;

  if (parts.length >= 3) {
    const p1 = parseInt(parts[0]);
    const p2 = parseInt(parts[1]);
    const p3 = parseInt(parts[2]);

    let rawYear, rawMonth, rawDay;
    if (p1 > 31) {
      rawYear = p1; rawMonth = p2; rawDay = p3;
    } else if (p3 > 31) {
      rawYear = p3; rawMonth = p2; rawDay = p1;
    } else {
      rawYear = p1; rawMonth = p2; rawDay = p3;
    }

    // <= 99: 2-digit Gregorian abbrev (26 → 2026)
    // 100-200: ROC (民國) year (115 → 2026)
    // > 200: 4-digit Gregorian
    if (rawYear <= 99) {
      year = 2000 + rawYear;
    } else if (rawYear <= 200) {
      year = rawYear + 1911;
    } else {
      year = rawYear;
    }
    month = rawMonth;
    day = rawDay;

  } else if (parts.length === 2) {
    year = new Date().getFullYear();
    month = parseInt(parts[0]);
    day = parseInt(parts[1]);
  } else {
    return null;
  }

  if (!year || !month || !day) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}


// ============================================================
//  📤 匯入 Excel 填寫
// ============================================================
async function importExcelFile(input) {
  const file = input.files[0];
  if (!file) return;

  getNotifier().showLoading("⏳ 正在解析 Excel...");

  try {
    await ensureXLSXReady();
    const buffer = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result);
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });

    const wb = XLSX.read(buffer, { type: "array", cellDates: true, cellNF: false, cellText: false });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

    if (!rows || rows.length < 2) {
      getNotifier().warning("⚠️ Excel 檔案沒有資料列！");
      return;
    }

    // Normalize headers for case-insensitive, space-agnostic matching
    const normalize = h => String(h || "").trim().toLowerCase().replace(/\s/g, "");
    const excelHeaders = rows[0].map(normalize);
    const localHeaders = currentTableHeaders.map(normalize);

    // Build mapping: excelColIdx → localColIdx
    const colMap = {};
    excelHeaders.forEach((eh, ei) => {
      const li = localHeaders.findIndex(lh => lh === eh);
      if (li !== -1) colMap[ei] = li;
    });

    const dateLocalIdx = currentTableHeaders.findIndex(h => h.includes("日期"));
    if (dateLocalIdx === -1) {
      getNotifier().error("❌ 找不到「日期」欄位！");
      return;
    }

    // Find which Excel column maps to the local date column
    let dateExcelIdx = -1;
    for (const [ei, li] of Object.entries(colMap)) {
      if (parseInt(li) === dateLocalIdx) { dateExcelIdx = parseInt(ei); break; }
    }

    const parsedRows = [];
    let skippedCount = 0;

    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || row.every(cell => cell === "" || cell == null)) continue;

      // Parse date value
      let dateStr = null;
      if (dateExcelIdx !== -1) {
        const rawDate = row[dateExcelIdx];
        if (rawDate instanceof Date) {
          const y = rawDate.getFullYear();
          const m = String(rawDate.getMonth() + 1).padStart(2, '0');
          const d = String(rawDate.getDate()).padStart(2, '0');
          dateStr = `${y}-${m}-${d}`;
        } else if (rawDate !== "" && rawDate != null) {
          dateStr = parseGregorianDate(String(rawDate));
        }
      }

      if (!dateStr) {
        skippedCount++;
        getNotifier().error(`❌ 日期 "${row[dateExcelIdx] || ''}" 不符格式，請按照yyyy/mm/dd進行建立`);
        console.warn(`[importExcel] 第 ${r + 1} 列日期無效或缺失，已略過`, row);
        continue;
      }
      
      const slashDate = parseToSlashDate(dateStr);
      if (!slashDate) {
        skippedCount++;
        getNotifier().error(`❌ 日期 "${row[dateExcelIdx] || ''}" 不符格式，請按照yyyy/mm/dd進行建立`);
        continue;
      }
      dateStr = slashDate;

      // Build row object keyed by local header names
      const rowObj = {};
      for (const [ei, li] of Object.entries(colMap)) {
        const header = currentTableHeaders[li];
        let val = row[parseInt(ei)];
        if (val instanceof Date) {
          const y = val.getFullYear();
          const m = String(val.getMonth() + 1).padStart(2, '0');
          const d = String(val.getDate()).padStart(2, '0');
          val = `${y}-${m}-${d}`;
        } else {
          val = val == null ? "" : String(val);
        }
        rowObj[header] = val;
      }
      // Ensure date is in canonical YYYY-MM-DD format
      rowObj[currentTableHeaders[dateLocalIdx]] = dateStr;
      parsedRows.push(rowObj);
    }

    if (parsedRows.length === 0) {
      getNotifier().warning(`⚠️ 沒有可匯入的資料！（${skippedCount} 筆因日期無效被略過）`);
      return;
    }

    fillTableWithData(parsedRows);

    if (skippedCount > 0) {
      getNotifier().warning(`⚠️ 已匯入 ${parsedRows.length} 筆，另有 ${skippedCount} 筆因日期無效被略過。`);
    } else {
      getNotifier().success(`✅ 已成功匯入 ${parsedRows.length} 筆排班資料！`);
    }
  } catch (err) {
    console.error("[importExcel] 解析失敗：", err);
    getNotifier().error("❌ Excel 解析失敗：" + err.message);
  } finally {
    getNotifier().hideLoading();
    input.value = "";
  }
}

// ============================================================
//  📢 講道資訊連動設定與連動邏輯
// ============================================================
function toggleSermonTypeSelect() {
  const useSermonToggle = document.getElementById('useSermonToggle');
  const sermonTypeCol = document.getElementById('sermonTypeCol');
  if (useSermonToggle && sermonTypeCol) {
    sermonTypeCol.style.opacity = useSermonToggle.checked ? "1" : "0.5";
    sermonTypeCol.style.pointerEvents = useSermonToggle.checked ? "auto" : "none";
  }
}

async function saveSermonSettings() {
  if (getUIState().isLocked('saveSermonSettings')) return;
  getUIState().lock('saveSermonSettings');

  const useSermon = document.getElementById('useSermonToggle').checked;
  const sermonType = document.getElementById('sermonTypeSelect').value;

  getNotifier().showLoading("💾 儲存設定中...");
  try {
    await fetchAPI("saveSermonSettings", {
      id: currentId,
      sermonSettings: { useSermon, sermonType }
    });

    currentSermonSettings = { useSermon, sermonType };
    getNotifier().success("✅ 講道資訊連動設定已更新！各列的「套用講道」勾選請透過新增一季聚會或匯入功能設定。");
  } catch (err) {
    handleAPIError(err);
  } finally {
    getNotifier().hideLoading();
    getUIState().unlock('saveSermonSettings');
  }
}

function onSermonLinkChange(checkbox) {
  const rowDiv = checkbox.closest('.record-row');
  const dateColIdx = currentTableHeaders.findIndex(h => h.includes("日期"));
  if (dateColIdx === -1) return;
  const dateInput = rowDiv.querySelector(`input[data-c="${dateColIdx}"]`);
  const dateVal = dateInput ? dateInput.value.trim() : "";

  const linkType = checkbox.checked ? "Y" : "N";
  updateRowSermonState(rowDiv, linkType, dateVal);
}

function updateRowSermonState(rowDiv, linkType, dateStr) {
  if (typeof linkType === 'boolean') {
    linkType = linkType ? "Y" : "N";
  }
  // 同步更新「套用講道」勾選框與語言滑動開關狀態，確保畫面顯示與連動狀態一致
  const sermonLinkColIdx = currentTableHeaders.indexOf("套用講道");
  if (sermonLinkColIdx !== -1) {
    const checkbox = rowDiv.querySelector(`input.sermon-link-checkbox[data-c="${sermonLinkColIdx}"]`);
    const sw = rowDiv.querySelector(`input.sermon-lang-switch[data-c="${sermonLinkColIdx}"]`);
    const lblLeft = rowDiv.querySelector(`#lang-label-left-${sermonLinkColIdx}`);
    const lblRight = rowDiv.querySelector(`#lang-label-right-${sermonLinkColIdx}`);
    
    const isLinked = linkType !== "N" && linkType !== "";
    
    if (checkbox && checkbox.checked !== isLinked) {
      checkbox.checked = isLinked;
    }
    
    if (sw) {
      let langVal = linkType === "Y" ? currentSermonSettings.sermonType : linkType;
      if (langVal !== "華語/聯合" && langVal !== "台語/聯合") {
        let isSwChecked = sw.checked;
        langVal = isSwChecked ? "台語/聯合" : "華語/聯合";
      }
      
      const isTaiwanese = langVal === "台語/聯合";
      if (sw.checked !== isTaiwanese) {
        sw.checked = isTaiwanese;
      }
      sw.disabled = !isLinked;
      
      // 更新標籤透明度
      if (lblLeft && lblRight) {
        if (isLinked) {
          lblLeft.style.opacity = isTaiwanese ? "0.4" : "1";
          lblRight.style.opacity = isTaiwanese ? "1" : "0.4";
        } else {
          lblLeft.style.opacity = "0.4";
          lblRight.style.opacity = "0.4";
        }
      }
    }
  }

  // 找出這一列中所有 grid-input
  const inputsMap = Array.from(rowDiv.querySelectorAll('.grid-input')).reduce((map, input) => {
    const c = input.dataset.c;
    if (c !== undefined) map[c] = input;
    return map;
  }, {});

  // 只連動「主題」和「經文」，話語分享不受講道連動影響
  const fields = ["主題", "經文"];
  const fieldIndices = {};
  fields.forEach(f => {
    fieldIndices[f] = currentTableHeaders.indexOf(f);
  });

  console.log(`[SermonLink] updateRowSermonState: linkType="${linkType}", dateStr="${dateStr}", sermonType="${currentSermonSettings ? currentSermonSettings.sermonType : 'undefined'}"`);

  const isLinked = linkType !== "N" && linkType !== "";

  if (isLinked) {
    // 設為唯讀
    fields.forEach(f => {
      const idx = fieldIndices[f];
      if (idx !== -1 && inputsMap[idx]) {
        inputsMap[idx].readOnly = true;
      }
    });

    // 尋找對應講道資訊並套用
    if (dateStr) {
      const activeSermonType = (linkType === "Y") ? currentSermonSettings.sermonType : linkType;
      const sermon = findSermonForDate(dateStr, activeSermonType);
      console.log(`[SermonLink] findSermonForDate returned:`, sermon);
      if (sermon) {
        fields.forEach(f => {
          const idx = fieldIndices[f];
          if (idx !== -1 && inputsMap[idx]) {
            let val = "";
            if (f === "主題") val = (sermon.title || "").trim() || "主日講道信息";
            else if (f === "經文") val = sermon.scripture || "";
            inputsMap[idx].value = val;
            inputsMap[idx].title = val;
            inputsMap[idx].classList.add('highlight');
            setTimeout(() => inputsMap[idx].classList.remove('highlight'), 1000);
          }
        });
        return;
      }
    }
    // 未設定日期或查無講道，則主題填入「主日講道信息」，其餘清空
    fields.forEach(f => {
      const idx = fieldIndices[f];
      if (idx !== -1 && inputsMap[idx]) {
        let val = "";
        if (f === "主題") val = "主日講道信息";
        inputsMap[idx].value = val;
        inputsMap[idx].title = val;
      }
    });
  } else {
    // 取消或啟用為不可連動狀態：設為可編輯
    fields.forEach(f => {
      const idx = fieldIndices[f];
      if (idx !== -1 && inputsMap[idx]) {
        inputsMap[idx].readOnly = false;
      }
    });
  }
}

function findSermonForDate(dateStr, sermonType) {
  console.log(`[SermonLink] findSermonForDate details - dateStr: "${dateStr}", sermonType: "${sermonType}". currentEventData size: ${currentEventData ? currentEventData.length : 0}`);
  if (!dateStr || !currentEventData || currentEventData.length === 0) return null;

  // 1. 往前推到可作為小組分享主題的講道週日。
  //    若聚會日期本身是週日，使用再前一個週日，避免同一天上午講道被下午小組直接套用。
  const canonicalDate = parseGregorianDate(dateStr);
  if (!canonicalDate) {
    console.warn(`[SermonLink] parseGregorianDate returned null for dateStr: "${dateStr}"`);
    return null;
  }

  const parts = canonicalDate.split("-");
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1; // Date.UTC month is 0-11
  const day = parseInt(parts[2], 10);

  const dateObj = new Date(Date.UTC(year, month, day));
  if (isNaN(dateObj.getTime())) {
    console.error(`[SermonLink] Invalid Date constructed from:`, parts);
    return null;
  }

  // getUTCDay() 回傳 0-6 (星期天為 0)。
  // 週日聚會要取前一週；其他日子取當週往前最近的週日。
  const daysSinceSunday = dateObj.getUTCDay();
  const offsetDays = daysSinceSunday === 0 ? 7 : daysSinceSunday;
  dateObj.setUTCDate(dateObj.getUTCDate() - offsetDays);
  
  const y = dateObj.getUTCFullYear();
  const m = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getUTCDate()).padStart(2, '0');
  const sundayStr = `${y}-${m}-${d}`;
  console.log(`[SermonLink] Computed Sunday: "${sundayStr}"`);

  // 2. 篩選出該週日的所有行事曆活動
  const sundayEvents = currentEventData.filter(ev => ev.date === sundayStr);
  console.log(`[SermonLink] Filtered Sunday events for "${sundayStr}":`, sundayEvents);
  if (sundayEvents.length === 0) return null;

  // 3. 收集所有活動中的講道資訊
  const sermons = [];
  sundayEvents.forEach(ev => {
    if (ev.sermons && ev.sermons.length > 0) {
      sermons.push(...ev.sermons);
    }
  });
  console.log(`[SermonLink] Sermons list for "${sundayStr}":`, sermons);

  if (sermons.length === 0) return null;

  // 4. 根據 sermonType 連動對應類別的講道 (例如 "華語/聯合" 拆成 "華語" 與 "聯合" 依序尋找)
  const targetTypes = (sermonType || "").split('/');
  let match = null;
  for (const t of targetTypes) {
    const trimmed = t.trim();
    if (!trimmed) continue;
    match = sermons.find(s => s.type && s.type.indexOf(trimmed) !== -1);
    if (match) break;
  }
  
  // 若都沒有，回傳 null（即空白），不套用第一筆講道
  if (!match) return null;
  console.log(`[SermonLink] Selected sermon match:`, match);

  return match;
}

async function forceSyncSermonData() {
  if (getUIState().isLocked('forceSyncSermonData')) return;
  getUIState().lock('forceSyncSermonData');

  getNotifier().showLoading("🔄 正在重新同步外部講道行事曆，請稍候...");
  try {
    const res = await fetchAPI("forceRefreshEvents", {});
    const count = (res && res.count !== undefined) ? res.count : 0;
    
    // 重新載入當前頁面的 PageConfig 以更新前端的 currentEventData
    const pageData = await fetchAPI('getPageConfig', { id: currentId });
    currentEventData = (pageData.eventData || []).map(ev => {
      if (ev.date) {
        const normalized = parseGregorianDate(String(ev.date));
        if (normalized) {
          ev.date = normalized;
        }
      }
      return ev;
    });
    
    // 重新整理目前畫面上所有勾選了「套用講道」的列
    const dateColIdx = currentTableHeaders.findIndex(h => h.includes("日期"));
    const sermonLinkColIdx = currentTableHeaders.indexOf("套用講道");
    
    document.querySelectorAll('.record-row').forEach(rowDiv => {
      if (sermonLinkColIdx !== -1) {
        const checkbox = rowDiv.querySelector(`input.sermon-link-checkbox[data-c="${sermonLinkColIdx}"]`);
        if (checkbox && checkbox.checked && dateColIdx !== -1) {
          const dVal = rowDiv.querySelector(`input.grid-input[data-c="${dateColIdx}"]`).value.trim();
          const sw = rowDiv.querySelector(`input.sermon-lang-switch[data-c="${sermonLinkColIdx}"]`);
          const langVal = sw && sw.checked ? "台語/聯合" : "華語/聯合";
          updateRowSermonState(rowDiv, langVal, dVal);
        }
      }
    });

    getNotifier().success(`✅ 同步完成！已更新 ${count} 筆講道日期資料。`);
  } catch (err) {
    handleAPIError(err);
  } finally {
    getNotifier().hideLoading();
    getUIState().unlock('forceSyncSermonData');
  }
}

function onSermonCheckboxChange(checkbox) {
  const rowDiv = checkbox.closest('.record-row');
  const dateColIdx = currentTableHeaders.findIndex(h => h.includes("日期"));
  if (dateColIdx === -1) return;
  const dateInput = rowDiv.querySelector(`input[data-c="${dateColIdx}"]`);
  const dateVal = dateInput ? dateInput.value.trim() : "";

  const sw = rowDiv.querySelector(`input.sermon-lang-switch[data-c="${checkbox.dataset.c}"]`);
  const lblLeft = rowDiv.querySelector(`#lang-label-left-${checkbox.dataset.c}`);
  const lblRight = rowDiv.querySelector(`#lang-label-right-${checkbox.dataset.c}`);

  if (sw) {
    sw.disabled = !checkbox.checked;
  }

  const isTaiwanese = sw ? sw.checked : false;
  if (lblLeft && lblRight) {
    if (checkbox.checked) {
      lblLeft.style.opacity = isTaiwanese ? "0.4" : "1";
      lblRight.style.opacity = isTaiwanese ? "1" : "0.4";
    } else {
      lblLeft.style.opacity = "0.4";
      lblRight.style.opacity = "0.4";
    }
  }

  const langVal = isTaiwanese ? "台語/聯合" : "華語/聯合";
  const linkType = checkbox.checked ? langVal : "N";
  updateRowSermonState(rowDiv, linkType, dateVal);
}

function onSermonSwitchChange(sw) {
  const rowDiv = sw.closest('.record-row');
  const dateColIdx = currentTableHeaders.findIndex(h => h.includes("日期"));
  if (dateColIdx === -1) return;
  const dateInput = rowDiv.querySelector(`input[data-c="${dateColIdx}"]`);
  const dateVal = dateInput ? dateInput.value.trim() : "";

  const lblLeft = rowDiv.querySelector(`#lang-label-left-${sw.dataset.c}`);
  const lblRight = rowDiv.querySelector(`#lang-label-right-${sw.dataset.c}`);

  const isTaiwanese = sw.checked;
  if (lblLeft && lblRight) {
    lblLeft.style.opacity = isTaiwanese ? "0.4" : "1";
    lblRight.style.opacity = isTaiwanese ? "1" : "0.4";
  }

  const langVal = isTaiwanese ? "台語/聯合" : "華語/聯合";
  updateRowSermonState(rowDiv, langVal, dateVal);
}

// 註冊至全域 window，確保 inline HTML 呼叫無誤
window.toggleSermonTypeSelect = toggleSermonTypeSelect;
window.saveSermonSettings = saveSermonSettings;
window.onSermonLinkChange = onSermonLinkChange;
window.onSermonCheckboxChange = onSermonCheckboxChange;
window.onSermonSwitchChange = onSermonSwitchChange;
window.forceSyncSermonData = forceSyncSermonData;

function togglePrimaryActions() {
  const container = document.querySelector('.ministry-primary-actions');
  const btn = document.getElementById('toggleActionsBtn');
  const arrow = document.getElementById('toggleActionsArrow');
  if (!container || !btn) return;
  
  const isCollapsed = container.classList.toggle('collapsed');
  
  localStorage.setItem('ministry.primaryActionsCollapsed', isCollapsed ? 'true' : 'false');
  
  if (isCollapsed) {
    if (arrow) arrow.innerText = '▾';
    btn.classList.remove('active');
  } else {
    if (arrow) arrow.innerText = '▴';
    btn.classList.add('active');
  }
}
window.togglePrimaryActions = togglePrimaryActions;

function parseToSlashDate(rawStr) {
  if (!rawStr) return null;
  const hypenDate = parseGregorianDate(String(rawStr).trim());
  if (!hypenDate) return null;
  return hypenDate.replace(/-/g, "/");
}
window.parseToSlashDate = parseToSlashDate;

function openEditPageModal(id, name) {
  document.getElementById('editPageOldId').value = id;
  document.getElementById('editPageName').value = name;
  document.getElementById('editPageId').value = id;
  
  const modal = new bootstrap.Modal(document.getElementById('editMinistryPageModal'));
  modal.show();
}
window.openEditPageModal = openEditPageModal;

async function submitEditMinistryPage() {
  const oldId = document.getElementById('editPageOldId').value;
  const newName = document.getElementById('editPageName').value.trim();
  const newId = document.getElementById('editPageId').value.trim();

  if (!newName || !newId) {
    getNotifier().error("❌ 分頁名稱與代碼不可為空！");
    return;
  }
  
  if (!/^[A-Za-z0-9_]+$/.test(newId)) {
    getNotifier().error("❌ 分頁代碼僅接受英數字與下底線！");
    return;
  }

  getNotifier().showLoading("⏳ 正在更新分頁資訊...");
  try {
    const res = await fetchAPI("updatePageInfo", {
      oldId: encryptGroupCode(oldId),
      newId: newId,
      newName: newName
    });
    
    getNotifier().success(`✅ ${res.msg || "更新成功"}`);
    
    // 關閉 Modal
    const modalEl = document.getElementById('editMinistryPageModal');
    const modalInstance = bootstrap.Modal.getInstance(modalEl);
    if (modalInstance) modalInstance.hide();
    
    // 重新載入儀表板
    await loadAdminData();
  } catch (err) {
    handleAPIError(err);
  } finally {
    getNotifier().hideLoading();
  }
}
window.submitEditMinistryPage = submitEditMinistryPage;
