const ALL_COLUMNS = [
  '姓名',
  '性別',
  '聚會別',
  '職業',
  '年齡',
  '是否曾接觸教會',
  '來訪原因',
  '表單號',
  '關懷同工',
  '地址',
  '市話',
  '手機',
  '首次來訪日',
  '結案日期',
  '落戶狀態',
  '邀約人',
  '備註',
  '會友狀態',
  '點名編號',
  '現行小組'
];

// Cookie helpers
function setCookie(name, value, days) {
  const date = new Date();
  date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
  const expires = "; expires=" + date.toUTCString();
  document.cookie = name + "=" + encodeURIComponent(value || "") + expires + "; path=/";
}

function getCookie(name) {
  const nameEQ = name + "=";
  const ca = document.cookie.split(';');
  for (let i = 0; i < ca.length; i++) {
    let c = ca[i];
    while (c.charAt(0) === ' ') c = c.substring(1, c.length);
    if (c.indexOf(nameEQ) === 0) return decodeURIComponent(c.substring(nameEQ.length, c.length));
  }
  return null;
}

// Column widths persistence helpers
function saveColumnWidth(column, width) {
  let widths = {};
  const cookieVal = getCookie('column_widths');
  if (cookieVal) {
    try { widths = JSON.parse(cookieVal); } catch(e) {}
  }
  widths[column] = width;
  setCookie('column_widths', JSON.stringify(widths), 365);
}

function getSavedColumnWidth(column) {
  const cookieVal = getCookie('column_widths');
  if (cookieVal) {
    try {
      const widths = JSON.parse(cookieVal);
      return widths[column];
    } catch(e) {}
  }
  return null;
}

// Load visible columns from cookie or default to all
let visibleColumnsTracking = [];
const visibleCookieTracking = getCookie('visible_columns_tracking');
if (visibleCookieTracking) {
  try { visibleColumnsTracking = JSON.parse(visibleCookieTracking); } catch(e) { visibleColumnsTracking = ALL_COLUMNS.filter(col => col !== '結案日期'); }
} else {
  visibleColumnsTracking = ['姓名', '性別', '聚會別', '表單號', '手機', '關懷同工', '邀約人', '首次來訪日', '落戶狀態', '備註', '會友狀態', '點名編號'];
}

let visibleColumnsClosed = [];
const visibleCookieClosed = getCookie('visible_columns_closed');
if (visibleCookieClosed) {
  try { visibleColumnsClosed = JSON.parse(visibleCookieClosed); } catch(e) { visibleColumnsClosed = [...ALL_COLUMNS]; }
} else {
  visibleColumnsClosed = ['姓名', '性別', '聚會別', '表單號', '手機', '關懷同工', '邀約人', '首次來訪日', '結案日期', '落戶狀態', '備註', '會友狀態', '點名編號'];
}

let visibleColumnsAnalysis = [];
const visibleCookieAnalysis = getCookie('visible_columns_analysis');
if (visibleCookieAnalysis) {
  try { visibleColumnsAnalysis = JSON.parse(visibleCookieAnalysis); } catch(e) { visibleColumnsAnalysis = [...ALL_COLUMNS]; }
} else {
  visibleColumnsAnalysis = ['姓名', '首次來訪日', '結案日期', '落戶狀態', '點名編號', '現行小組'];
}

function getTrackingColumns() {
  return ALL_COLUMNS.filter(col => visibleColumnsTracking.includes(col) && col !== '結案日期');
}

function getClosedColumns() {
  return ALL_COLUMNS.filter(col => visibleColumnsClosed.includes(col));
}

function getAnalysisColumns() {
  return ALL_COLUMNS.filter(col => visibleColumnsAnalysis.includes(col));
}

const editFields = [
  { name: '姓名', label: '姓名', required: true },
  { name: '聚會別', label: '聚會別', type: 'meeting', required: true },
  { name: '性別', label: '性別', type: 'select', options: ['男', '女'] },
  { name: '職業', label: '職業' },
  { name: '年齡', label: '年齡' },
  { name: '是否曾接觸教會', label: '是否曾接觸教會', type: 'select', options: ['原有名單', '有', '沒有', '不確定'] },
  { name: '來訪原因', label: '來訪原因', type: 'textarea', full: true },
  { name: '表單號', label: '表單號' },
  { name: '關懷同工', label: '關懷同工' },
  { name: '地址', label: '地址', full: true },
  { name: '市話', label: '市話' },
  { name: '手機', label: '手機' },
  { name: '首次來訪日', label: '首次來訪日', inputType: 'date' },
  { name: '結案日期', label: '結案日期', inputType: 'date' },
  { name: '落戶狀態', label: '落戶狀態', type: 'settlement' },
  { name: '邀約人', label: '邀約人' },
  { name: '備註', label: '備註', type: 'textarea', full: true },
  { name: '會友狀態', label: '會友狀態', type: 'select', options: ['已加入', '已存在'] },
  { name: '點名編號', label: '點名編號' }
];

const form = document.getElementById('newFamilyForm');
const formNotice = document.getElementById('formNotice');
const trackingNotice = document.getElementById('trackingNotice');
const submitBtn = document.getElementById('submitBtn');
const trackingSearchBtn = document.getElementById('trackingSearchBtn');
const addMembersBtn = document.getElementById('addMembersBtn');
const closeBtn = document.getElementById('closeBtn');
const trackingContent = document.getElementById('trackingContent');
const caseCount = document.getElementById('caseCount');
const dateField = document.getElementById('date');
const meetingSelect = document.getElementById('meeting');
const closedNotice = document.getElementById('closedNotice');
const closedContent = document.getElementById('closedContent');
const closedCount = document.getElementById('closedCount');
const closedSearchBtn = document.getElementById('closedSearchBtn');
const closedExportBtn = document.getElementById('closedExportBtn');

// Filter popover elements
const headerFilterPopover = document.getElementById('headerFilterPopover');
const popoverSearchInput = document.getElementById('popoverSearchInput');
const popoverSelectAll = document.getElementById('popoverSelectAll');
const popoverOptionsList = document.getElementById('popoverOptionsList');
const popoverConfirmBtn = document.getElementById('popoverConfirmBtn');
const popoverCancelBtn = document.getElementById('popoverCancelBtn');

const editModal = document.getElementById('editModal');
const editCaseForm = document.getElementById('editCaseForm');
const editFieldContainer = document.getElementById('editFields');
const editNotice = document.getElementById('editNotice');
const editSaveBtn = document.getElementById('editSaveBtn');
const editSubtitle = document.getElementById('editSubtitle');
const analysisCount = document.getElementById('analysisCount');
const analysisOpenBtn = document.getElementById('analysisOpenBtn');
const analysisPreview = document.getElementById('analysisPreview');
const analysisNotice = document.getElementById('analysisNotice');
const analysisYear = document.getElementById('analysisYear');
const analysisStartDate = document.getElementById('analysisStartDate');
const analysisEndDate = document.getElementById('analysisEndDate');
const analysisStatusFilter = document.getElementById('analysisStatusFilter');
const analysisOverdueFilter = document.getElementById('analysisOverdueFilter');
const analysisModal = document.getElementById('analysisModal');
const analysisSubtitle = document.getElementById('analysisSubtitle');
const analysisModalContent = document.getElementById('analysisModalContent');
const analysisExportDetailBtn = document.getElementById('analysisExportDetailBtn');
const analysisExportSummaryBtn = document.getElementById('analysisExportSummaryBtn');
const sessionModal = document.getElementById('sessionModal');
const sessionSelect = document.getElementById('sessionSelect');
const sessionConfirmBtn = document.getElementById('sessionConfirmBtn');
const sessionCancelBtn = document.getElementById('sessionCancelBtn');
const sessionCloseBtn = document.getElementById('sessionCloseBtn');

// Column settings elements
const trackingSettingsBtn = document.getElementById('trackingSettingsBtn');
const closedSettingsBtn = document.getElementById('closedSettingsBtn');
const analysisSettingsBtn = document.getElementById('analysisSettingsBtn');
const columnsSettingsModal = document.getElementById('columnsSettingsModal');
const settingsCloseBtn = document.getElementById('settingsCloseBtn');
const settingsCancelBtn = document.getElementById('settingsCancelBtn');
const settingsSaveBtn = document.getElementById('settingsSaveBtn');
const settingsSelectAll = document.getElementById('settingsSelectAll');
const settingsColumnsList = document.getElementById('settingsColumnsList');

let meetingOptions = [];
let settlementOptions = ['請安拜訪', '尚未落戶'];
let editingCase = null;
let trackingCases = [];
let closedCasesBase = []; // Base loaded closed cases list
let closedCasesAll = [];
let closedRecentCases = [];
let closedHistoryCases = [];
let closedRecentLoadPromise = null;
let closedHistoryLoadPromise = null;
let closedRecentDateRange = null;
let closedRecentLoaded = false;
let closedHistoryLoaded = false;
let closedHistoryLoadAttempted = false;
let closedHistoryCacheStored = false;
let closedRenderRevision = 0;
let activeClosedFilters = {}; // Maps column -> { search: string, selected: Set }
let firebaseCacheModulePromise = null;
let memberDirectoryPromise = null;
let selectedMemberRecord = null;
let currentAnalysisRows = [];
let currentAnalysisPivot = [];

let activeRequestsCount = 0;

function showGlobalLoading() {
  activeRequestsCount++;
  const loadingBar = document.getElementById('loadingBar');
  if (loadingBar) {
    loadingBar.hidden = false;
  }
}

function hideGlobalLoading() {
  activeRequestsCount = Math.max(0, activeRequestsCount - 1);
  const loadingBar = document.getElementById('loadingBar');
  if (loadingBar && activeRequestsCount === 0) {
    loadingBar.hidden = true;
  }
}

const newFamilyCacheTtl = 19800;
const newFamilyListActions = new Set(['getTrackingCases', 'getClosedCases']);
const stoppedAttendanceStatus = '停止聚會';
const CLOSED_CASES_HOT_YEAR = 2025;
const CLOSED_CASES_DEVICE_CACHE_DB = 'lkc-new-family-device-cache';
const CLOSED_CASES_DEVICE_CACHE_STORE = 'lists';
const CLOSED_CASES_DEVICE_CACHE_KEY = 'closed-cases-v1';
const CLOSED_CASES_DEVICE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

setDefaultClosedDateRange();

dateField.valueAsDate = new Date();
analysisYear.value = new Date().getFullYear();
loadMeetingOptions();
loadSettlementStatusOptions();
getMemberDirectory().catch(err => console.warn('Pre-fetch member directory failed:', err));
initNameCombobox();
setAnalysisRange('year');


document.querySelectorAll('.tab').forEach(button => {
  button.addEventListener('click', () => switchTab(button.dataset.tab));
});

form.addEventListener('submit', async event => {
  event.preventDefault();

  if (!confirm('確認要送出此筆新家人資料嗎？')) {
    return;
  }

  setNotice(formNotice, '送出中...');
  submitBtn.disabled = true;

  try {
    const payload = Object.fromEntries(new FormData(form).entries());
    delete payload['會友狀態'];
    if (selectedMemberRecord) {
      payload['點名編號'] = selectedMemberRecord.memberCode;
      payload['會友狀態'] = '已加入';
      if (selectedMemberRecord.sundayGroup) {
        payload['現行小組'] = selectedMemberRecord.sundayGroup;
      }
    }
    const result = await callApi('submitNewFamily', payload);
    setNotice(formNotice, `${result.message}，表單號：${result.formNumber}`, 'success');
    form.reset();
    selectedMemberRecord = null;
    const badge = document.getElementById('memberBadge');
    if (badge) badge.style.display = 'none';
    dateField.valueAsDate = new Date();
  } catch (error) {
    setNotice(formNotice, error.message || String(error), 'error');
  } finally {
    submitBtn.disabled = false;
  }
});

trackingSearchBtn.addEventListener('click', loadTrackingCases);
addMembersBtn.addEventListener('click', openSessionModal);
closeBtn.addEventListener('click', closeSelectedCases);
closedSearchBtn.addEventListener('click', searchClosedCases);
closedExportBtn.addEventListener('click', exportClosedCases);
analysisOpenBtn.addEventListener('click', openAnalysisModal);
analysisExportDetailBtn.addEventListener('click', exportAnalysisDetail);
analysisExportSummaryBtn.addEventListener('click', exportAnalysisSummary);
analysisYear.addEventListener('change', () => setAnalysisRange('year'));
analysisStartDate.addEventListener('change', refreshAnalysisPreview);
analysisEndDate.addEventListener('change', refreshAnalysisPreview);
analysisStatusFilter.addEventListener('change', refreshAnalysisPreview);
analysisOverdueFilter.addEventListener('change', refreshAnalysisPreview);
document.querySelectorAll('[data-analysis-range]').forEach(button => {
  button.addEventListener('click', () => setAnalysisRange(button.dataset.analysisRange));
});
document.getElementById('editCloseBtn').addEventListener('click', closeEditModal);
document.getElementById('editCancelBtn').addEventListener('click', closeEditModal);
document.getElementById('analysisCloseBtn').addEventListener('click', closeAnalysisModal);
document.getElementById('analysisDoneBtn').addEventListener('click', closeAnalysisModal);
editModal.addEventListener('click', event => {
  if (event.target === editModal) closeEditModal();
});
analysisModal.addEventListener('click', event => {
  if (event.target === analysisModal) closeAnalysisModal();
});
sessionCloseBtn.addEventListener('click', closeSessionModal);
sessionCancelBtn.addEventListener('click', closeSessionModal);
sessionModal.addEventListener('click', event => {
  if (event.target === sessionModal) closeSessionModal();
});
sessionConfirmBtn.addEventListener('click', () => {
  const selectedSession = sessionSelect.value;
  if (!selectedSession) {
    alert('請選擇點名場次');
    return;
  }
  if (!confirm('確認是否加入會友清單及當天點名紀錄？')) return;
  closeSessionModal();
  addSelectedMembers(selectedSession);
});
editCaseForm.addEventListener('submit', saveTrackingCase);

window.addEventListener('pagehide', () => {
  if (closedHistoryCacheStored) {
    refreshClosedCasesDeviceCacheExpiry().catch(error => {
      console.warn('[new-family-cache] failed to refresh device-cache expiry', error);
    });
  }
});



async function callApi(action, data = {}) {
  showGlobalLoading();
  try {
    if (window.NewFamilySupabaseService && typeof window.NewFamilySupabaseService[action] === 'function') {
      return await window.NewFamilySupabaseService[action](data);
    }
    await window.ensureAPIReady();
    const result = await window.churchAPI(action, data);
    if (!result.success) {
      throw new Error(result.message || '操作失敗');
    }
    return result;
  } finally {
    hideGlobalLoading();
  }
}

async function callCachedListApi(action, data = {}) {
  if (window.NewFamilySupabaseService && typeof window.NewFamilySupabaseService[action] === 'function') {
    return await window.NewFamilySupabaseService[action](data);
  }
  if (!newFamilyListActions.has(action)) {
    return callApi(action, data);
  }

  let gasCalled = false;
  try {
    const cache = await getFirebaseCacheModule();
    return await cache.cacheGetOrFetch(
      action,
      '_default',
      () => {
        gasCalled = true;
        return callApi(action, data);
      },
      newFamilyCacheTtl
    );
  } catch (error) {
    if (gasCalled) throw error;
    console.warn('[new-family-cache] Firebase read failed; direct GAS once', error);
    return callApi(action, data);
  }
}

function getFirebaseCacheModule() {
  if (!firebaseCacheModulePromise) {
    firebaseCacheModulePromise = import('../../firebase/firebase-cache.js');
  }
  return firebaseCacheModulePromise;
}

function setDefaultClosedDateRange() {
  const startInput = document.getElementById('closedStartDate');
  const endInput = document.getElementById('closedEndDate');
  if (!startInput || !endInput) return;

  const today = new Date();
  const start = new Date(today);
  start.setFullYear(start.getFullYear() - 1);

  const toDateInputValue = date => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  if (!startInput.value) startInput.value = toDateInputValue(start);
  if (!endInput.value) endInput.value = toDateInputValue(today);
}

function getClosedSearchFilters() {
  return {
    name: document.getElementById('closedName').value,
    startDate: document.getElementById('closedStartDate').value,
    endDate: document.getElementById('closedEndDate').value
  };
}

function extractClosedCaseRows(response) {
  if (Array.isArray(response)) return response;
  if (response && response.success === false) {
    throw new Error(response.message || '已結案資料讀取失敗');
  }
  if (response && Array.isArray(response.data)) return response.data;
  throw new Error('已結案資料格式不正確');
}

function getClosedCaseKey(item) {
  const formNumber = String(item['表單號'] || item.form_number || '').trim();
  if (formNumber) return `form:${formNumber}`;
  const id = String(item.id || '').trim();
  if (id) return `id:${id}`;
  const rowNumber = String(item.rowNumber || item.row_number || '').trim();
  if (rowNumber) return `row:${rowNumber}`;
  return `${String(item['姓名'] || item.name || '').trim()}|${String(item['首次來訪日'] || item.first_visit_date || '').trim()}`;
}

function mergeClosedCaseRows(...rowLists) {
  const merged = new Map();
  rowLists.forEach(rows => {
    (rows || []).forEach(item => {
      if (!item || typeof item !== 'object') return;
      merged.set(getClosedCaseKey(item), item);
    });
  });
  return Array.from(merged.values());
}

async function callOriginalNewFamilyApi(action, data = {}) {
  if (typeof window.ensureAPIReady === 'function') {
    await window.ensureAPIReady();
  }
  const api = window.churchAPI_original_nf || window.churchAPI;
  if (typeof api !== 'function') throw new Error('新家人 API 尚未準備完成');
  const result = await api(action, data);
  if (result && result.success === false) {
    throw new Error(result.message || '新家人資料讀取失敗');
  }
  return result;
}

async function fetchRecentClosedCases(filters) {
  showGlobalLoading();
  try {
    const service = window.NewFamilySupabaseService;
    if (service && typeof service.getClosedCases === 'function') {
      try {
        const result = await service.getClosedCases(filters);
        if (result) return extractClosedCaseRows(result);
      } catch (error) {
        console.warn('[new-family] recent Supabase read failed; using GAS fallback', error);
        return extractClosedCaseRows(await callOriginalNewFamilyApi('getClosedCases', filters));
      }
    }
    return extractClosedCaseRows(await callOriginalNewFamilyApi('getClosedCases', filters));
  } finally {
    hideGlobalLoading();
  }
}

function isColdClosedCase(item) {
  const visitDate = String(item['首次來訪日'] || item.first_visit_date || '').trim();
  const formNumber = String(item['表單號'] || item.form_number || '').trim();
  const yearText = visitDate.slice(0, 4) || formNumber.slice(0, 4);
  const year = Number(yearText);
  return Number.isInteger(year) && year > 0 && year < CLOSED_CASES_HOT_YEAR;
}

async function fetchColdClosedCasesFromFirebaseOrGas() {
  let cachedResponse = null;
  try {
    const cache = await getFirebaseCacheModule();
    cachedResponse = await cache.cacheGet('getClosedCases', '_default');
  } catch (error) {
    console.warn('[new-family-cache] Firebase cold-list read failed; falling back to GAS', error);
    firebaseCacheModulePromise = null;
  }

  if (cachedResponse) {
    try {
      return extractClosedCaseRows(cachedResponse).filter(isColdClosedCase);
    } catch (error) {
      console.warn('[new-family-cache] Firebase cold-list entry is unusable; falling back to GAS', error);
    }
  }

  const response = await callOriginalNewFamilyApi('getClosedCases', {});
  return extractClosedCaseRows(response).filter(isColdClosedCase);
}

async function fetchAllHotClosedCases() {
  const filters = { startDate: `${CLOSED_CASES_HOT_YEAR}-01-01` };
  const service = window.NewFamilySupabaseService;
  if (service && typeof service.getClosedCases === 'function') {
    try {
      const result = await service.getClosedCases(filters);
      if (result) return extractClosedCaseRows(result);
    } catch (error) {
      console.warn('[new-family] historical Supabase read failed; using GAS fallback', error);
      return extractClosedCaseRows(await callOriginalNewFamilyApi('getClosedCases', filters));
    }
  }
  return extractClosedCaseRows(await callOriginalNewFamilyApi('getClosedCases', filters));
}

function openClosedCasesDeviceCache() {
  if (!window.indexedDB) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(CLOSED_CASES_DEVICE_CACHE_DB, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(CLOSED_CASES_DEVICE_CACHE_STORE)) {
        database.createObjectStore(CLOSED_CASES_DEVICE_CACHE_STORE, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('裝置快取資料庫無法開啟'));
  });
}

async function readClosedCasesDeviceCache() {
  const database = await openClosedCasesDeviceCache();
  if (!database) return null;
  const record = await new Promise((resolve, reject) => {
    const transaction = database.transaction(CLOSED_CASES_DEVICE_CACHE_STORE, 'readonly');
    const request = transaction.objectStore(CLOSED_CASES_DEVICE_CACHE_STORE).get(CLOSED_CASES_DEVICE_CACHE_KEY);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error('裝置快取讀取失敗'));
    transaction.onabort = () => reject(transaction.error || new Error('裝置快取讀取中斷'));
  });
  database.close();

  if (!record) return null;
  if (record.schemaVersion !== 1 || record.expiresAt <= Date.now() || !Array.isArray(record.rows)) {
    await deleteClosedCasesDeviceCache();
    return null;
  }
  return record;
}

async function writeClosedCasesDeviceCache(rows) {
  const database = await openClosedCasesDeviceCache();
  if (!database) return false;
  const record = {
    key: CLOSED_CASES_DEVICE_CACHE_KEY,
    schemaVersion: 1,
    rows,
    savedAt: Date.now(),
    expiresAt: Date.now() + CLOSED_CASES_DEVICE_CACHE_TTL_MS
  };
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(CLOSED_CASES_DEVICE_CACHE_STORE, 'readwrite');
    transaction.objectStore(CLOSED_CASES_DEVICE_CACHE_STORE).put(record);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || new Error('裝置快取寫入失敗'));
    transaction.onabort = () => reject(transaction.error || new Error('裝置快取寫入中斷'));
  });
  database.close();
  closedHistoryCacheStored = true;
  return true;
}

async function deleteClosedCasesDeviceCache() {
  const database = await openClosedCasesDeviceCache();
  if (!database) return;
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(CLOSED_CASES_DEVICE_CACHE_STORE, 'readwrite');
    transaction.objectStore(CLOSED_CASES_DEVICE_CACHE_STORE).delete(CLOSED_CASES_DEVICE_CACHE_KEY);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || new Error('裝置快取清除失敗'));
  });
  database.close();
  closedHistoryCacheStored = false;
}

async function refreshClosedCasesDeviceCacheExpiry() {
  const database = await openClosedCasesDeviceCache();
  if (!database) return;
  const transaction = database.transaction(CLOSED_CASES_DEVICE_CACHE_STORE, 'readwrite');
  const store = transaction.objectStore(CLOSED_CASES_DEVICE_CACHE_STORE);
  const request = store.get(CLOSED_CASES_DEVICE_CACHE_KEY);
  request.onsuccess = () => {
    if (!request.result || !Array.isArray(request.result.rows)) return;
    request.result.expiresAt = Date.now() + CLOSED_CASES_DEVICE_CACHE_TTL_MS;
    store.put(request.result);
  };
  await new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || new Error('裝置快取期限更新失敗'));
    transaction.onabort = () => reject(transaction.error || new Error('裝置快取期限更新中斷'));
  });
  database.close();
}

async function callSundayAttendanceApi(action, data = {}) {
  if (window.AttendanceSupabaseService && typeof window.AttendanceSupabaseService[action] === 'function') {
    return await window.AttendanceSupabaseService[action](data);
  }
  const apiUrl = window.SUNDAY_ATTENDANCE_API_URL || '';
  const token = window.NEW_FAMILY_AUTH_TOKEN || '';

  if (!apiUrl) {
    throw new Error('尚未設定主日出席 API URL');
  }

  showGlobalLoading();
  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, token, data })
    });

    const result = await response.json();
    if (result.status === 'error' || result.error) {
      throw new Error(result.message || result.error || '聚會清單讀取失敗');
    }
    return result.data || result;
  } finally {
    hideGlobalLoading();
  }
}

async function callSundayAttendancePayloadApi(action, payload) {
  if (window.AttendanceSupabaseService && typeof window.AttendanceSupabaseService[action] === 'function') {
    return await window.AttendanceSupabaseService[action](payload);
  }
  const apiUrl = window.SUNDAY_ATTENDANCE_API_URL || '';

  if (!apiUrl) {
    throw new Error('尚未設定主日出席 API URL');
  }

  showGlobalLoading();
  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, payload })
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error);
    }
    return result.data;
  } finally {
    hideGlobalLoading();
  }
}

async function callGroupAttendanceApi(action, data = {}) {
  const apiUrl = window.GROUP_ATTENDANCE_API_URL || '';
  const token = window.NEW_FAMILY_AUTH_TOKEN || '';

  if (!apiUrl) {
    throw new Error('尚未設定小組點名 API URL');
  }

  const loadFromGas = async () => {
    showGlobalLoading();
    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action, token, data })
      });

      const result = await response.json();
      if (!result.success) {
        throw new Error(result.message || '小組群清單讀取失敗');
      }
      return result;
    } finally {
      hideGlobalLoading();
    }
  };

  if (action !== 'getDistrictsAndClusters') return loadFromGas();

  let gasCalled = false;
  try {
    const cache = await getFirebaseCacheModule();
    return await cache.cacheGetOrFetch(
      action,
      '_default',
      () => {
        gasCalled = true;
        return loadFromGas();
      },
      newFamilyCacheTtl
    );
  } catch (error) {
    if (gasCalled) throw error;
    console.warn('[new-family-cache] Firebase read failed; direct Group GAS once', error);
    return loadFromGas();
  }
}

async function loadMeetingOptions() {
  meetingSelect.disabled = true;
  meetingSelect.innerHTML = '<option value="">載入聚會清單中...</option>';

  try {
    const groupConfig = await callSundayAttendanceApi('getGroupConfig');
    const options = flattenMeetingOptions(groupConfig);
    meetingOptions = options;

    meetingSelect.innerHTML = '<option value="">請選擇</option>';
    options.forEach(item => {
      const option = document.createElement('option');
      option.value = item.name;
      option.textContent = `${item.category} / ${item.name}`;
      meetingSelect.appendChild(option);
    });
  } catch (error) {
    meetingSelect.innerHTML = '<option value="">聚會清單讀取失敗</option>';
    setNotice(formNotice, error.message || String(error), 'error');
  } finally {
    meetingSelect.disabled = false;
  }
}

function flattenMeetingOptions(groupConfig) {
  return Object.entries(groupConfig || {}).flatMap(([category, names]) => {
    if (!Array.isArray(names)) return [];
    return names
      .filter(Boolean)
      .map(name => ({ category, name: String(name).trim() }))
      .filter(item => item.name);
  });
}

async function loadSettlementStatusOptions() {
  try {
    const result = await callGroupAttendanceApi('getDistrictsAndClusters');
    const groupNames = (result.clusters || [])
      .map(cluster => String(cluster.name || '').trim())
      .filter(Boolean);
    settlementOptions = Array.from(new Set([...groupNames, '請安拜訪', '尚未落戶']));
  } catch (error) {
    console.warn('[new-family] failed to load official group clusters', error);
    settlementOptions = ['請安拜訪', '尚未落戶'];
    setNotice(formNotice, `小組群清單讀取失敗：${error.message || String(error)}`, 'error');
  }
}

document.addEventListener('click', event => {
  document.querySelectorAll('.action-menu').forEach(menu => {
    menu.hidden = true;
  });
  if (headerFilterPopover && !headerFilterPopover.hidden && !headerFilterPopover.contains(event.target) && !event.target.classList.contains('header-filter-btn')) {
    closeHeaderFilterPopover();
  }
});

function switchTab(tabName) {
  document.querySelectorAll('.tab').forEach(button => {
    button.classList.toggle('active', button.dataset.tab === tabName);
  });

  document.getElementById('formPanel').hidden = tabName !== 'form';
  document.getElementById('trackingPanel').hidden = tabName !== 'tracking';
  document.getElementById('closedPanel').hidden = tabName !== 'closed';
  document.getElementById('analysisPanel').hidden = tabName !== 'analysis';

  if (tabName === 'tracking') loadTrackingCases();
  if (tabName === 'closed') loadClosedCases();
  if (tabName === 'analysis') refreshAnalysisPreview();
}

async function loadTrackingCases() {
  setNotice(trackingNotice, '');
  setEmptyState(trackingContent, '正在悉心翻土中...', 'loading');
  trackingSearchBtn.disabled = true;
  addMembersBtn.disabled = true;
  closeBtn.disabled = true;

  try {
    const filters = {
      name: document.getElementById('trackingName').value,
      startDate: document.getElementById('trackingStartDate').value,
      endDate: document.getElementById('trackingEndDate').value
    };
    const result = await callCachedListApi('getTrackingCases');
    renderTrackingCases(filterCases(result.data || [], filters));
  } catch (error) {
    setEmptyState(trackingContent, '資料灌溉失敗，請稍後再試！', 'error');
    setNotice(trackingNotice, error.message || String(error), 'error');
  } finally {
    trackingSearchBtn.disabled = false;
    addMembersBtn.disabled = false;
    closeBtn.disabled = false;
  }
}

function renderTrackingCases(rows) {
  // 依表單號降冪排序（越新越前面）
  rows.sort((a, b) => {
    const fnA = String(a['表單號'] || '').trim();
    const fnB = String(b['表單號'] || '').trim();
    if (fnA && fnB) return fnB.localeCompare(fnA);
    const dateA = String(a['首次來訪日'] || '').trim();
    const dateB = String(b['首次來訪日'] || '').trim();
    return dateB.localeCompare(dateA);
  });
  trackingCases = rows;
  caseCount.textContent = `共 ${rows.length} 筆`;

  if (!rows.length) {
    setEmptyState(trackingContent, '目前沒有追蹤中的家人資料 🌱');
    return;
  }

  trackingContent.className = 'table-wrap';
  trackingContent.textContent = '';
  trackingContent.appendChild(buildCaseTable(rows, true, getTrackingColumns()));
}

async function addSelectedMembers(sessionName) {
  const selectedCases = getSelectedTrackingCases();

  const alreadyJoined = selectedCases.filter(item => String(item['會友狀態'] || '').trim() === '已加入');
  if (alreadyJoined.length > 0) {
    const names = alreadyJoined.map(item => item['姓名']).join('、');
    setNotice(trackingNotice, `勾選名單中「${names}」已是會友，加入程序已終止。`, 'error');
    return;
  }

  if (!selectedCases.length) {
    setNotice(trackingNotice, '請先勾選要加入會友名單的資料', 'error');
    return;
  }

  const selectedNames = selectedCases
    .map(item => item['姓名'])
    .filter(Boolean);
  if (!selectedNames.length) {
    setNotice(trackingNotice, '勾選資料沒有可加入的姓名', 'error');
    return;
  }

  addMembersBtn.disabled = true;
  closeBtn.disabled = true;
  setNotice(trackingNotice, `準備加入會友名單 (0/${selectedCases.length})...`);

  try {
    const results = [];
    let currentIndex = 0;
    const totalCases = selectedCases.length;

    for (const item of selectedCases) {
      const name = String(item['姓名'] || '').trim();
      currentIndex++;
      if (!name) {
        results.push({ ok: false, name: '未填姓名', message: '略過未填姓名資料' });
        continue;
      }
      setNotice(trackingNotice, `正在加入會友名單 (${currentIndex}/${totalCases})：${name}...`);

      const message = String(await callSundayAttendancePayloadApi('addMember', {
        name,
        gender: item['性別'] || ''
      }) || '');
      let memberCode = extractMemberCode(message);
      const duplicate = message.includes('已存在');
      if (message.includes('成功')) {
        memberDirectoryPromise = null;
      }
      const existingMember = await findMemberRecord(name, memberCode);
      if (!memberCode && duplicate) memberCode = existingMember.memberCode;
      const sundayGroup = existingMember.sundayGroup || '';
      results.push({
        id: item.id,
        formNumber: item['表單號'],
        ok: message.includes('成功'),
        duplicate,
        rowNumber: item.rowNumber,
        memberCode,
        sundayGroup,
        name,
        message
      });
    }

    // 收集成功加入或已存在的會友姓名
    const activeNames = results
      .filter(item => item.ok || item.duplicate)
      .map(item => item.name)
      .filter(Boolean);

    if (activeNames.length) {
      try {
        const today = new Date();
        // 格式化為 yyyy/M/d 格式，如 2026/6/7
        const dateStr = `${today.getFullYear()}/${today.getMonth() + 1}/${today.getDate()}`;
        
        // 呼叫點名 API
        await callSundayAttendancePayloadApi('saveAttendance', {
          date: dateStr,
          presentList: activeNames,
          type: sessionName,
          nfMale: 0,
          nfFemale: 0
        });
        console.log(`[new-family] successfully added ${activeNames.join(', ')} to ${sessionName} attendance`);
      } catch (attError) {
        console.error('[new-family] failed to sync attendance', attError);
        // 僅記錄 error，不阻斷後續新家人表狀態標記流程
      }
    }

    const successCount = results.filter(item => item.ok).length;
    const duplicateCount = results.filter(item => item.duplicate).length;
    const memberStatuses = results
      .filter(item => item.ok || item.duplicate)
      .map(item => ({
        id: item.id,
        formNumber: item.formNumber,
        name: item.name,
        rowNumber: item.rowNumber,
        status: item.ok ? '已加入' : '已存在',
        memberCode: item.memberCode || '',
        sundayGroup: item.sundayGroup || ''
      }));

    if (memberStatuses.length) {
      await callApi('markTrackingMemberStatuses', { items: memberStatuses });
      await loadTrackingCases();
    }

    const failed = results.filter(item => !item.ok && !item.duplicate);
    const suffix = failed.length
      ? `；未加入：${failed.map(item => `${item.name} ${item.message}`).join('、')}`
      : '';
    const codeText = results
      .filter(item => (item.ok || item.duplicate) && item.memberCode)
      .map(item => `${item.name}(${item.memberCode})`)
      .join('、');
    const codeSuffix = codeText ? `；會友代碼：${codeText}` : '';
    const duplicateText = duplicateCount ? `，已存在 ${duplicateCount} 位` : '';
    
    const totalProcessed = successCount + duplicateCount;
    const prefix = totalProcessed > 0
      ? `已成功加入會友清單及當天點名紀錄${duplicateText}${codeSuffix}`
      : `加入會友清單及當天點名紀錄失敗`;

    setNotice(
      trackingNotice,
      `${prefix}${suffix}`,
      failed.length ? 'error' : 'success'
    );
  } catch (error) {
    setNotice(trackingNotice, error.message || String(error), 'error');
  } finally {
    addMembersBtn.disabled = false;
    closeBtn.disabled = false;
  }
}

function extractMemberCode(message) {
  const match = String(message || '').match(/編號[:：]\s*([A-Z]+\d+)/i);
  return match ? match[1].toUpperCase() : '';
}

async function getMemberDirectory() {
  if (!memberDirectoryPromise) {
    memberDirectoryPromise = callSundayAttendancePayloadApi('getAllMembers', {})
      .then(members => {
        const byName = new Map();
        const byCode = new Map();
        (Array.isArray(members) ? members : []).forEach(member => {
          const name = String(member[0] || '').trim();
          const memberCode = String(member[7] || '').trim();
          const sundayGroup = String(member[8] || '').trim();
          const isExcluded = normalizeBoolean(member[4]);
          const record = { name, memberCode, sundayGroup, isExcluded };
          if (name) byName.set(name, record);
          if (memberCode) byCode.set(memberCode, record);
        });
        return { byName, byCode };
      })
      .catch(error => {
        memberDirectoryPromise = null;
        throw error;
      });
  }
  return memberDirectoryPromise;
}

async function findMemberRecord(name, memberCode) {
  try {
    const directory = await getMemberDirectory();
    const targetName = String(name || '').trim();
    const targetCode = String(memberCode || '').trim();
    return directory.byCode.get(targetCode) || directory.byName.get(targetName) || {
      name: targetName,
      memberCode: targetCode,
      sundayGroup: '',
      isExcluded: false
    };
  } catch (error) {
    console.warn('[new-family] member lookup failed', error);
    return {
      name: String(name || '').trim(),
      memberCode: String(memberCode || '').trim(),
      sundayGroup: '',
      isExcluded: false
    };
  }
}

async function enrichRowsWithSundayMemberData(rows) {
  try {
    const directory = await getMemberDirectory();
    return rows.map(item => {
      const memberCode = String(item['點名編號'] || '').trim();
      const name = String(item['姓名'] || '').trim();
      const member = directory.byCode.get(memberCode) || directory.byName.get(name);
      if (!member) return item;
      return {
        ...item,
        '現行小組': member.sundayGroup || item['現行小組'] || '',
        displaySettlementStatus: member.isExcluded
          ? stoppedAttendanceStatus
          : normalizeSettlementStatus(item['落戶狀態'])
      };
    });
  } catch (error) {
    console.warn('[new-family] sunday member enrich skipped', error);
    return rows;
  }
}

async function loadClosedCases() {
  if (closedRecentLoaded) {
    await renderCurrentClosedSearch();
    void refreshRecentClosedCases();
    void ensureClosedHistoryLoaded();
    return;
  }
  if (closedRecentLoadPromise) return closedRecentLoadPromise;

  setNotice(closedNotice, '正在載入近一年資料...');
  setEmptyState(closedContent, '正在載入近一年已結案資料...', 'loading');
  const dateRange = getClosedRecentDateRange();
  closedRecentLoadPromise = (async () => {
    try {
      closedRecentCases = await fetchRecentClosedCases({ ...dateRange });
      closedRecentLoaded = true;
      await refreshClosedCasesView();
      setNotice(closedNotice, '近一年資料已載入；較早資料正在背景讀取。');
      void ensureClosedHistoryLoaded();
    } catch (error) {
      setEmptyState(closedContent, '近一年資料讀取失敗，請稍後再試。', 'error');
      setNotice(closedNotice, error.message || String(error), 'error');
      // A device cache may still provide a usable list while the live query is unavailable.
      void ensureClosedHistoryLoaded();
    } finally {
      closedRecentLoadPromise = null;
    }
  })();
  return closedRecentLoadPromise;
}

function getClosedRecentDateRange() {
  if (!closedRecentDateRange) {
    setDefaultClosedDateRange();
    closedRecentDateRange = {
      startDate: document.getElementById('closedStartDate').value,
      endDate: document.getElementById('closedEndDate').value
    };
  }
  return closedRecentDateRange;
}

async function refreshRecentClosedCases() {
  if (closedRecentLoadPromise) return closedRecentLoadPromise;
  const dateRange = getClosedRecentDateRange();
  closedRecentLoadPromise = (async () => {
    try {
      closedRecentCases = await fetchRecentClosedCases({ ...dateRange });
      closedRecentLoaded = true;
      await refreshClosedCasesView();
    } catch (error) {
      console.warn('[new-family] recent closed-case refresh failed', error);
    } finally {
      closedRecentLoadPromise = null;
    }
  })();
  return closedRecentLoadPromise;
}

function searchClosedCases() {
  activeClosedFilters = {};
  void renderCurrentClosedSearch();
  if (!closedHistoryLoaded) {
    setNotice(closedNotice, closedHistoryLoadPromise
      ? '查詢使用目前已載入的資料；較早資料仍在背景讀取。'
      : '查詢使用目前已載入的資料；較早資料尚未完整載入。');
  }
}

async function ensureClosedHistoryLoaded() {
  if (closedHistoryLoaded || closedHistoryLoadAttempted) return closedHistoryLoadPromise;
  if (closedHistoryLoadPromise) return closedHistoryLoadPromise;

  closedHistoryLoadAttempted = true;
  setNotice(closedNotice, '近一年資料已載入；正在背景讀取完整歷史資料。');
  closedHistoryLoadPromise = (async () => {
    try {
      const cached = await readClosedCasesDeviceCache();
      if (cached) {
        closedHistoryCases = cached.rows;
        closedHistoryLoaded = true;
        closedHistoryCacheStored = true;
        await refreshClosedCasesView();
        setNotice(closedNotice, '已載入此裝置保存的完整名單。');
        return;
      }

      const [hotResult, coldResult] = await Promise.allSettled([
        fetchAllHotClosedCases(),
        fetchColdClosedCasesFromFirebaseOrGas()
      ]);
      const hotRows = hotResult.status === 'fulfilled' ? hotResult.value : [];
      const coldRows = coldResult.status === 'fulfilled' ? coldResult.value : [];

      if (hotResult.status === 'fulfilled' || coldResult.status === 'fulfilled') {
        closedHistoryCases = mergeClosedCaseRows(coldRows, hotRows);
        await refreshClosedCasesView();
      }

      if (hotResult.status === 'fulfilled' && coldResult.status === 'fulfilled') {
        closedHistoryLoaded = true;
        try {
          const saved = await writeClosedCasesDeviceCache(closedHistoryCases);
          setNotice(closedNotice, saved
            ? '完整名單已載入並保存在此裝置；離開頁面後保留一天。'
            : '完整名單已載入；此瀏覽器未提供裝置快取。');
        } catch (error) {
          console.warn('[new-family-cache] device-cache write failed', error);
          setNotice(closedNotice, '完整名單已載入，但無法保存到此裝置。');
        }
        return;
      }

      const failedSources = [];
      if (hotResult.status === 'rejected') failedSources.push(`熱資料：${hotResult.reason?.message || '讀取失敗'}`);
      if (coldResult.status === 'rejected') failedSources.push(`歷史資料：${coldResult.reason?.message || '讀取失敗'}`);
      setNotice(closedNotice, `部分歷史資料讀取失敗，舊日期查詢可能不完整。${failedSources.join('；')}`, 'error');
    } catch (error) {
      console.warn('[new-family] background history load failed', error);
      setNotice(closedNotice, `歷史資料背景讀取失敗；目前已載入資料仍可查詢。${error.message || String(error)}`, 'error');
    } finally {
      closedHistoryLoadPromise = null;
    }
  })();
  return closedHistoryLoadPromise;
}

async function refreshClosedCasesView(resetHeaderFilters = false) {
  closedCasesAll = mergeClosedCaseRows(closedHistoryCases, closedRecentCases);
  await renderCurrentClosedSearch(resetHeaderFilters);
}

async function renderCurrentClosedSearch(resetHeaderFilters = false) {
  if (resetHeaderFilters) activeClosedFilters = {};
  const renderRevision = ++closedRenderRevision;
  const filters = getClosedSearchFilters();
  const filteredRows = filterCases(closedCasesAll, filters);
  const enrichedRows = await enrichRowsWithSundayMemberData(filteredRows);
  if (renderRevision !== closedRenderRevision) return;
  renderClosedCases(enrichedRows);
}

function renderClosedCases(rows) {
  // 依表單號降冪排序（越新越前面）
  rows.sort((a, b) => {
    const fnA = String(a['表單號'] || '').trim();
    const fnB = String(b['表單號'] || '').trim();
    if (fnA && fnB) return fnB.localeCompare(fnA);
    const dateA = String(a['首次來訪日'] || a['結案日期'] || '').trim();
    const dateB = String(b['首次來訪日'] || b['結案日期'] || '').trim();
    if (dateA && dateB) return dateB.localeCompare(dateA);
    if (dateA) return -1;
    if (dateB) return 1;
    return 0;
  });
  closedCasesBase = rows;
  renderFilteredClosedCases();
}

function renderFilteredClosedCases() {
  const filtered = getFilteredClosedCases();

  const searchFilters = getClosedSearchFilters();
  const isFiltered = Object.keys(activeClosedFilters).length > 0 ||
    Boolean(String(searchFilters.name || '').trim() || searchFilters.startDate || searchFilters.endDate);
  closedCount.textContent = `共 ${filtered.length} 筆${isFiltered ? ' (符合查詢條件)' : ''}`;

  if (!filtered.length) {
    setEmptyState(closedContent, '沒有符合篩選條件的已結案家人 🌱');
    return;
  }

  closedContent.className = 'table-wrap';
  closedContent.textContent = '';
  // Note the last argument is true to indicate isClosed = true
  closedContent.appendChild(buildCaseTable(filtered, false, getClosedColumns(), true));
  
  highlightActiveFilters();
}

// Global variable tracking which filter popover is active
let activeFilterPopoverColumn = null;

function getFilteredClosedCases() {
  return closedCasesBase.filter(item => {
    for (const column in activeClosedFilters) {
      const filter = activeClosedFilters[column];
      const val = getFilterValue(item, column);
      
      // Check search text (contains keyword)
      if (filter.search && !val.toLowerCase().includes(filter.search.toLowerCase())) {
        return false;
      }
      
      // Check checkbox select values
      if (filter.selected && filter.selected.size > 0) {
        if (!filter.selected.has(val)) {
          return false;
        }
      }
    }
    return true;
  });
}

function parseDateOnly(value) {
  if (!value) return null;
  const text = String(value).trim();
  const match = text.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime();
}

function checkSettleOverdue(item) {
  const status = getDisplaySettlementStatus(item);
  if (status === '請安拜訪' || status === '停止聚會') return false;

  // "沒有抓到現行小組的資料" means "現行小組" is empty or '尚未落戶' or '未'
  const group = String(item['現行小組'] || '').trim();
  if (group && group !== '尚未落戶') return false;

  const closedDateStr = item['結案日期'];
  if (!closedDateStr) return false;
  
  const closedDateMs = parseDateOnly(closedDateStr);
  if (!closedDateMs) return false;

  const msIn28Days = 28 * 24 * 60 * 60 * 1000;
  const overdueThreshold = closedDateMs + msIn28Days;
  
  return Date.now() > overdueThreshold;
}

function getFilterValue(item, column) {
  if (column === '落戶狀態') {
    return getDisplaySettlementStatus(item);
  }
  if (column === '現行小組') {
    return item['現行小組'] || '';
  }
  return String(item[column] || '').trim();
}

function highlightActiveFilters() {
  document.querySelectorAll('.filterable-header').forEach(th => {
    const col = th.dataset.column;
    const filterBtn = th.querySelector('.header-filter-btn');
    if (filterBtn) {
      if (activeClosedFilters[col]) {
        filterBtn.classList.add('active');
        filterBtn.textContent = '▼(篩)';
      } else {
        filterBtn.classList.remove('active');
        filterBtn.textContent = '▼';
      }
    }
  });
}

async function refreshAnalysisPreview() {
  setNotice(analysisNotice, '');
  setEmptyState(analysisPreview, '正在統計與灌溉落戶樹苗...', 'loading');
  analysisOpenBtn.disabled = true;
  analysisExportDetailBtn.disabled = true;

  try {
    const dateRows = await getAnalysisDateRows();
    populateAnalysisStatusFilter(dateRows);
    const rows = filterAnalysisRowsByStatus(dateRows);
    currentAnalysisRows = rows;
    currentAnalysisPivot = buildSettlementPivot(rows);
    analysisCount.textContent = `共 ${rows.length} 筆`;

    if (!rows.length) {
      setEmptyState(analysisPreview, '這個期間沒有符合落戶資料的新朋友 🌱');
      return;
    }

    analysisPreview.className = 'table-wrap analysis-table';
    analysisPreview.textContent = '';
    analysisPreview.appendChild(buildAnalysisDetailTable(rows));
  } catch (error) {
    currentAnalysisRows = [];
    currentAnalysisPivot = [];
    setEmptyState(analysisPreview, '分析資料讀取失敗，請重新整理！', 'error');
    setNotice(analysisNotice, error.message || String(error), 'error');
  } finally {
    analysisOpenBtn.disabled = false;
    analysisExportDetailBtn.disabled = !currentAnalysisRows.length;
  }
}

async function openAnalysisModal() {
  setNotice(analysisNotice, '');
  analysisOpenBtn.disabled = true;

  try {
    const dateRows = await getAnalysisDateRows();
    const rows = filterAnalysisRowsByStatus(dateRows);
    const pivot = buildSettlementPivot(rows);
    currentAnalysisRows = rows;
    currentAnalysisPivot = pivot;

    analysisSubtitle.textContent = `${analysisStartDate.value || '不限'} 至 ${analysisEndDate.value || '不限'}`;
    analysisModalContent.textContent = '';
    analysisModalContent.appendChild(buildAnalysisSummary(rows, pivot));

    const pivotWrap = document.createElement('div');
    pivotWrap.className = 'table-wrap analysis-table';
    pivotWrap.appendChild(buildAnalysisPivotTable(pivot, rows.length));
    analysisModalContent.appendChild(pivotWrap);

    analysisModal.hidden = false;
    analysisExportSummaryBtn.disabled = !rows.length;
  } catch (error) {
    setNotice(analysisNotice, error.message || String(error), 'error');
  } finally {
    analysisOpenBtn.disabled = false;
  }
}

function closeAnalysisModal() {
  analysisModal.hidden = true;
  analysisModalContent.textContent = '';
}

function closeSessionModal() {
  sessionModal.hidden = true;
  sessionSelect.innerHTML = '';
}

function openSessionModal() {
  setNotice(trackingNotice, '');
  const selectedCases = getSelectedTrackingCases();
  if (!selectedCases.length) {
    setNotice(trackingNotice, '請先勾選要加入會友名單的資料', 'error');
    return;
  }
  const selectedNames = selectedCases.map(item => item['姓名']).filter(Boolean);
  if (!selectedNames.length) {
    setNotice(trackingNotice, '勾選資料沒有可加入的姓名', 'error');
    return;
  }

  sessionSelect.innerHTML = '<option value="">請選擇點名場次</option>';
  meetingOptions.forEach(item => {
    const option = document.createElement('option');
    option.value = item.name;
    option.textContent = `${item.category} / ${item.name}`;
    sessionSelect.appendChild(option);
  });

  sessionModal.hidden = false;
}

async function exportAnalysisDetail() {
  await exportCombinedWorkbook();
}

async function exportAnalysisSummary() {
  await exportCombinedWorkbook();
}

async function exportCombinedWorkbook() {
  try {
    const rows = currentAnalysisRows.length
      ? currentAnalysisRows
      : filterAnalysisRowsByStatus(await getAnalysisDateRows());
    if (!rows.length) {
      setNotice(analysisNotice, '沒有可匯出的資料', 'error');
      return;
    }

    const hierarchyResult = await callGroupAttendanceApi('getDistrictsAndClusters');
    if (!hierarchyResult || hierarchyResult.success !== true || !Array.isArray(hierarchyResult.clusters)) {
      throw new Error('小組群清單格式不正確，無法產生落戶統計');
    }

    let groups = Array.from(new Set(
      hierarchyResult.clusters
        .map(cluster => String(cluster.name || '').trim())
        .filter(name => name && name !== '請安拜訪' && name !== '尚未落戶')
    ));
    if (!groups.length) throw new Error('小組群清單是空的，無法產生落戶統計');
    groups.push('尚未落戶');

    function mapGroup(status) {
      const s = String(status || '').trim();
      if ((s === '松年' || s === '松年團契') && groups.includes('松年團契')) return '松年團契';
      if ((s === '恩典' || s === '恩典團契') && groups.includes('恩典團契')) return '恩典團契';
      if (groups.includes(s)) return s;
      return '尚未落戶';
    }

    function getYearQuarter(dateStr) {
      if (!dateStr) return null;
      const match = dateStr.match(/^(\d{4})[-\/](\d{1,2})[-\/]\d{1,2}/);
      if (!match) return null;
      const year = parseInt(match[1], 10);
      const month = parseInt(match[2], 10);
      let quarter = '';
      if (month >= 1 && month <= 3) quarter = 'Q1';
      else if (month >= 4 && month <= 6) quarter = 'Q2';
      else if (month >= 7 && month <= 9) quarter = 'Q3';
      else if (month >= 10 && month <= 12) quarter = 'Q4';
      return { year, quarter };
    }

    function getServiceType(meetingName) {
      const name = String(meetingName || '');
      if (name.includes('聯合')) return '聯合';
      if (name.includes('台語')) return '台語';
      if (name.includes('華語')) return '華語';
      return '華語';
    }

    // Determine the year range from the selected date range in the UI or fallback to dates in rows
    let startYear = 2024;
    let endYear = 2026;
    if (analysisStartDate.value) {
      startYear = parseInt(analysisStartDate.value.split('-')[0], 10);
    } else if (rows.length > 0) {
      const years = rows.map(item => {
        const yq = getYearQuarter(item['首次來訪日']);
        return yq ? yq.year : null;
      }).filter(Boolean);
      if (years.length > 0) startYear = Math.min(...years);
    }
    if (analysisEndDate.value) {
      endYear = parseInt(analysisEndDate.value.split('-')[0], 10);
    } else if (rows.length > 0) {
      const years = rows.map(item => {
        const yq = getYearQuarter(item['首次來訪日']);
        return yq ? yq.year : null;
      }).filter(Boolean);
      if (years.length > 0) endYear = Math.max(...years);
    }

    const columnGroups = [];
    for (let y = startYear; y <= endYear; y++) {
      const yrRows = rows.filter(item => {
        const yq = getYearQuarter(item['首次來訪日']);
        return yq && yq.year === y;
      });
      const quartersMap = new Map();
      yrRows.forEach(item => {
        const yq = getYearQuarter(item['首次來訪日']);
        if (yq) quartersMap.set(yq.quarter, yq);
      });
      const sortedQuarters = Array.from(quartersMap.keys()).sort();
      if (sortedQuarters.length > 0) {
        if (sortedQuarters.length > 1) {
          columnGroups.push({ year: y, quarter: `${sortedQuarters[0]}-${sortedQuarters[sortedQuarters.length - 1]}` });
        }
        sortedQuarters.forEach(q => {
          columnGroups.push({ year: y, quarter: q });
        });
      }
    }

    const numGroups = columnGroups.length;
    const numCols = 15 + 3 * numGroups;
    
    // Initialize Sheet 1: Pivot Table matrix (dynamically sizing row dimension)
    const totalRowIdx = 4 + 2 * groups.length;
    const matrixRows = totalRowIdx + 15;
    const matrix = [];
    for (let r = 0; r < matrixRows; r++) {
      matrix.push(new Array(numCols).fill(null));
    }

    const years = Array.from(new Set(columnGroups.map(g => g.year))).sort();
    const summaryYears = years.slice(0, 3);
    summaryYears.forEach((year, yIdx) => {
      const colIdx = 1 + yIdx * 2;
      const yrRows = rows.filter(item => {
        const yq = getYearQuarter(item['首次來訪日']);
        return yq && yq.year === year;
      });

      const totalCount = yrRows.length;
      let dateRangeStr = '';
      if (yrRows.length > 0) {
        const dates = yrRows.map(item => item['首次來訪日']).filter(Boolean).sort();
        if (dates.length > 0) {
          const formatDate = (dStr) => {
            const parts = dStr.split('-');
            return `${parts[0]}/${parseInt(parts[1], 10)}/${parseInt(parts[2], 10)}`;
          };
          dateRangeStr = `（${formatDate(dates[0])}-${formatDate(dates[dates.length - 1])}）`;
        }
      }

      const groupCounts = {};
      groups.forEach(g => { groupCounts[g] = 0; });
      let stoppedCount = 0;
      let visitCount = 0;

      yrRows.forEach(item => {
        const status = String(item['落戶狀態'] || '').trim();
        if (status === '停止聚會') {
          stoppedCount++;
        } else if (status === '請安拜訪') {
          visitCount++;
        } else {
          const mapped = mapGroup(status);
          groupCounts[mapped] = (groupCounts[mapped] || 0) + 1;
        }
      });

      const validCount = Object.values(groupCounts).reduce((a, b) => a + b, 0);

      matrix[1][colIdx] = `${year}年度新家人落戶說明：`;
      matrix[3][colIdx] = `📌 留名卡總數：${totalCount} 筆`;
      matrix[4][colIdx] = dateRangeStr;
      matrix[6][colIdx] = `✅ 有效名單：${validCount} 位`;
      matrix[7][colIdx] = `目前落戶情況如下：`;

      const groupEmojis = {
        '葡萄樹': '🍇',
        '以斯帖': '👑',
        '松年團契': '🌿',
        '棕樹': '🌴',
        '芥菜種': '🌱',
        '香柏樹': '🌲',
        '橄欖樹': '🫒',
        '種子': '🌾',
        '提摩太': '📖',
        '恩典團契': '💒',
        '尚未落戶': '🕊️'
      };

      groups.forEach((g, gIdx) => {
        const emoji = groupEmojis[g] || '';
        matrix[8 + gIdx][colIdx] = `• ${emoji} ${g}：${groupCounts[g]} 位`;
      });

      matrix[8 + groups.length + 1][colIdx] = `❌ 停止聚會名單：${stoppedCount} 位`;
      matrix[8 + groups.length + 2][colIdx] = `（曾落戶小組後因故離開）`;
      matrix[8 + groups.length + 4][colIdx] = `📋 請安拜訪名單：${visitCount} 位`;
    });

    const allValidCount = rows.filter(item => {
      const status = String(item['落戶狀態'] || '').trim();
      return status !== '停止聚會' && status !== '請安拜訪';
    }).length;
    matrix[14 + groups.length][1] = `** 統計表數字同各年度新家人落戶說明 (參照初始資料 - 以${allValidCount}筆有效資料分析)`;
    matrix[16 + groups.length][1] = `**2025/03/16 三樓禮拜堂啟用`;
    matrix[17 + groups.length][1] = `**2025/10/19 一樓禮拜堂啟用`;
    matrix[18 + groups.length][1] = `**2026/03/01 台華語同步禮拜10:00`;

    // Populate Pivot Table Headers
    matrix[1][7] = '新家人落戶統計';
    columnGroups.forEach((group, groupIdx) => {
      const startCol = 9 + 3 * groupIdx;
      // Only write the year when it first appears in the groups to match template's merged cells
      const isFirstOfYear = groupIdx === 0 || columnGroups[groupIdx - 1].year !== group.year;
      if (isFirstOfYear) {
        matrix[1][startCol] = group.year;
      }
      matrix[2][startCol] = group.quarter;
      matrix[3][startCol] = '聯合';
      matrix[3][startCol + 1] = '台語';
      matrix[3][startCol + 2] = '華語';
    });

    const grandTotalStart = 9 + 3 * numGroups;
    matrix[1][grandTotalStart] = '總計';
    matrix[3][grandTotalStart] = '聯合';
    matrix[3][grandTotalStart + 1] = '台語';
    matrix[3][grandTotalStart + 2] = '華語';

    const pctCol = 12 + 3 * numGroups;
    matrix[1][pctCol] = '%';

    matrix[3][7] = '小組別';
    matrix[3][8] = '是否受邀';

    // Helper functions for column names
    function colIndex(colLetter) {
      let index = 0;
      for (let i = 0; i < colLetter.length; i++) {
        index = index * 26 + (colLetter.charCodeAt(i) - 64);
      }
      return index - 1;
    }

    const activeColLetters = [];
    columnGroups.forEach((group, groupIdx) => {
      if (!group.quarter.includes('-')) {
        activeColLetters.push(columnName(9 + 3 * groupIdx));
      }
    });

    // Populate Pivot Table Data Rows
    groups.forEach((g, gIdx) => {
      const rIdx = 4 + 2 * gIdx; // Excel row R = rIdx + 1
      const R_invited = rIdx + 1;
      const R_notInvited = rIdx + 2;

      matrix[rIdx][7] = g;
      matrix[rIdx][8] = '受邀';
      matrix[rIdx + 1][8] = '非受邀';

      // Counts for each Column Group
      columnGroups.forEach((group, groupIdx) => {
        const startCol = 9 + 3 * groupIdx;
        const matchingCases = rows.filter(item => {
          if (mapGroup(item['落戶狀態']) !== g) return false;
          const yq = getYearQuarter(item['首次來訪日']);
          if (!yq || yq.year !== group.year) return false;
          const isYearSummary = group.quarter.includes('-');
          if (!isYearSummary && yq.quarter !== group.quarter) return false;
          return true;
        });

        // Split by invited and service
        const invitedCases = matchingCases.filter(item => item['邀約人'] && String(item['邀約人']).trim());
        const notInvitedCases = matchingCases.filter(item => !item['邀約人'] || !String(item['邀約人']).trim());

        function countService(cases, type) {
          const count = cases.filter(item => getServiceType(item['聚會別']) === type).length;
          return count > 0 ? count : null;
        }

        matrix[rIdx][startCol] = countService(invitedCases, '聯合');
        matrix[rIdx][startCol + 1] = countService(invitedCases, '台語');
        matrix[rIdx][startCol + 2] = countService(invitedCases, '華語');

        matrix[rIdx + 1][startCol] = countService(notInvitedCases, '聯合');
        matrix[rIdx + 1][startCol + 1] = countService(notInvitedCases, '台語');
        matrix[rIdx + 1][startCol + 2] = countService(notInvitedCases, '華語');
      });

      // Sum formulas for grand total columns
      const colAE = columnName(grandTotalStart);
      const colAF = columnName(grandTotalStart + 1);
      const colAG = columnName(grandTotalStart + 2);

      matrix[rIdx][grandTotalStart] = '=' + activeColLetters.map(col => `${col}${R_invited}`).join('+');
      matrix[rIdx][grandTotalStart + 1] = '=' + activeColLetters.map(col => `${columnName(colIndex(col) + 1)}${R_invited}`).join('+');
      matrix[rIdx][grandTotalStart + 2] = '=' + activeColLetters.map(col => `${columnName(colIndex(col) + 2)}${R_invited}`).join('+');

      matrix[rIdx + 1][grandTotalStart] = '=' + activeColLetters.map(col => `${col}${R_notInvited}`).join('+');
      matrix[rIdx + 1][grandTotalStart + 1] = '=' + activeColLetters.map(col => `${columnName(colIndex(col) + 1)}${R_notInvited}`).join('+');
      matrix[rIdx + 1][grandTotalStart + 2] = '=' + activeColLetters.map(col => `${columnName(colIndex(col) + 2)}${R_notInvited}`).join('+');

      // Percentage formula
      matrix[rIdx][pctCol] = `=SUM(${colAE}${R_invited}:${colAG}${R_invited})/SUM(${colAE}${R_invited}:${colAG}${R_notInvited})`;
      matrix[rIdx + 1][pctCol] = `=SUM(${colAE}${R_notInvited}:${colAG}${R_notInvited})/SUM(${colAE}${R_invited}:${colAG}${R_notInvited})`;
    });

    // Row Totals
    matrix[totalRowIdx][7] = '總計';
    matrix[totalRowIdx][8] = '受邀';
    matrix[totalRowIdx + 1][8] = '非受邀';

    const invitedRows = [];
    const notInvitedRows = [];
    groups.forEach((g, gIdx) => {
      invitedRows.push(5 + 2 * gIdx);
      notInvitedRows.push(6 + 2 * gIdx);
    });

    for (let c = 9; c <= grandTotalStart + 2; c++) {
      const col = columnName(c);
      matrix[totalRowIdx][c] = '=' + invitedRows.map(r => `${col}${r}`).join('+');
      matrix[totalRowIdx + 1][c] = '=' + notInvitedRows.map(r => `${col}${r}`).join('+');
    }

    // Row Percentages for Column Groups
    matrix[totalRowIdx + 2][7] = '%';
    matrix[totalRowIdx + 2][8] = '受邀';
    matrix[totalRowIdx + 3][8] = '非受邀';

    const R_totInvited = totalRowIdx + 1;
    const R_totNotInvited = totalRowIdx + 2;

    columnGroups.forEach((group, groupIdx) => {
      const startCol = 9 + 3 * groupIdx;
      const colA = columnName(startCol);
      const colB = columnName(startCol + 1);
      const colC = columnName(startCol + 2);
      
      for (let c = startCol; c <= startCol + 2; c++) {
        const col = columnName(c);
        matrix[totalRowIdx + 2][c] = `=${col}${R_totInvited}/SUM(${colA}${R_totInvited}:${colC}${R_totNotInvited})`;
        matrix[totalRowIdx + 3][c] = `=${col}${R_totNotInvited}/SUM(${colA}${R_totInvited}:${colC}${R_totNotInvited})`;
      }
    });

    // Percentages for Grand Total column group
    const colAE = columnName(grandTotalStart);
    const colAF = columnName(grandTotalStart + 1);
    const colAG = columnName(grandTotalStart + 2);
    for (let c = grandTotalStart; c <= grandTotalStart + 2; c++) {
      const col = columnName(c);
      matrix[totalRowIdx + 2][c] = `=${col}${R_totInvited}/SUM(${colAE}${R_totInvited}:${colAG}${R_totNotInvited})`;
      matrix[totalRowIdx + 3][c] = `=${col}${R_totNotInvited}/SUM(${colAE}${R_totInvited}:${colAG}${R_totNotInvited})`;
    }

    // Row: 主日禮拜人數
    const attendanceRowIdx = totalRowIdx + 5;
    matrix[attendanceRowIdx][7] = '主日禮拜人數';
    for (let c = 9; c <= grandTotalStart + 2; c++) {
      matrix[attendanceRowIdx][c] = '-';
    }
    matrix[attendanceRowIdx][pctCol] = '-';

    // Sheet 2: Detail table
    const detailHeaders = ['姓名', '聚會別', '表單號', '關懷同工', '關懷狀態', '落戶狀態', '邀約人', '立案日', '結案日', '家長備註欄'];
    const detailRows = [
      detailHeaders,
      ...rows.map(item => [
        item['姓名'] || '',
        item['聚會別'] || '',
        item['表單號'] ? Number(item['表單號']) : '',
        item['關懷同工'] || '',
        '結案',
        getDisplaySettlementStatus(item) || '',
        item['邀約人'] || '',
        item['首次來訪日'] || '',
        item['結案日期'] || '',
        item['備註'] || ''
      ])
    ];

    const sheets = [
      { name: '新家人落戶分析 (以初始資料為主)', rows: matrix },
      { name: '最新新家人名單&落戶狀態', rows: detailRows }
    ];

    exportWorkbook(sheets, `新家人留名卡紀錄_截至${(analysisEndDate.value || '').replace(/-/g, '')}`);
  } catch (error) {
    setNotice(analysisNotice, error.message || String(error), 'error');
  }
}

function exportWorkbook(sheets, filenameBase) {
  const blob = createXlsxBlob(sheets);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${sanitizeFilename(filenameBase)}.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function getAnalysisRangeLabel() {
  return `${analysisStartDate.value || 'all'}_${analysisEndDate.value || 'all'}`;
}

function sanitizeFilename(value) {
  return String(value || 'export')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, '_');
}

function createXlsxBlob(sheets) {
  const files = {};
  const safeSheets = sheets.map((sheet, index) => ({
    name: sanitizeSheetName(sheet.name || `Sheet${index + 1}`),
    rows: rowsToMatrix(sheet.rows || [])
  }));

  files['[Content_Types].xml'] = buildContentTypesXml(safeSheets.length);
  files['_rels/.rels'] = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>',
    '</Relationships>'
  ].join('');
  files['xl/workbook.xml'] = buildWorkbookXml(safeSheets);
  files['xl/_rels/workbook.xml.rels'] = buildWorkbookRelsXml(safeSheets.length);

  safeSheets.forEach((sheet, index) => {
    files[`xl/worksheets/sheet${index + 1}.xml`] = buildWorksheetXml(sheet.rows);
  });

  return new Blob([buildZip(files)], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
}

function rowsToMatrix(rows) {
  if (!rows.length) return [[]];
  if (Array.isArray(rows[0])) return rows;
  const headers = Object.keys(rows[0]);
  return [
    headers,
    ...rows.map(row => headers.map(header => row[header] === undefined || row[header] === null ? '' : row[header]))
  ];
}

function buildContentTypesXml(sheetCount) {
  const sheetOverrides = Array.from({ length: sheetCount }, (_, index) =>
    `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
  ).join('');
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
    sheetOverrides,
    '</Types>'
  ].join('');
}

function buildWorkbookXml(sheets) {
  const sheetTags = sheets.map((sheet, index) =>
    `<sheet name="${escapeXmlAttribute(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`
  ).join('');
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
    `<sheets>${sheetTags}</sheets>`,
    '</workbook>'
  ].join('');
}

function buildWorkbookRelsXml(sheetCount) {
  const relations = Array.from({ length: sheetCount }, (_, index) =>
    `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`
  ).join('');
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    relations,
    '</Relationships>'
  ].join('');
}

function buildWorksheetXml(rows) {
  const rowXml = rows.map((row, rowIndex) => {
    const cellXml = row.map((value, columnIndex) => buildCellXml(value, columnIndex, rowIndex)).join('');
    return `<row r="${rowIndex + 1}">${cellXml}</row>`;
  }).join('');
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
    `<sheetData>${rowXml}</sheetData>`,
    '</worksheet>'
  ].join('');
}

function buildCellXml(value, columnIndex, rowIndex) {
  const reference = `${columnName(columnIndex)}${rowIndex + 1}`;
  if (value === null || value === undefined || value === '') {
    return '';
  }
  if (typeof value === 'string' && value.startsWith('=')) {
    return `<c r="${reference}"><f>${escapeXmlText(value.slice(1))}</f></c>`;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${reference}"><v>${value}</v></c>`;
  }
  return `<c r="${reference}" t="inlineStr"><is><t>${escapeXmlText(value)}</t></is></c>`;
}

function columnName(index) {
  let name = '';
  let value = index + 1;
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

function sanitizeSheetName(value) {
  return String(value || 'Sheet')
    .replace(/[:\\/?*\[\]]/g, ' ')
    .slice(0, 31)
    .trim() || 'Sheet';
}

function escapeXmlText(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeXmlAttribute(value) {
  return escapeXmlText(value).replace(/"/g, '&quot;');
}

function buildZip(files) {
  const encoder = new TextEncoder();
  const chunks = [];
  const centralDirectory = [];
  let offset = 0;
  const entries = Object.entries(files).map(([name, content]) => ({
    name,
    nameBytes: encoder.encode(name),
    data: encoder.encode(content)
  }));

  entries.forEach(entry => {
    const crc = crc32(entry.data);
    const localHeader = zipLocalHeader(entry, crc);
    chunks.push(localHeader, entry.nameBytes, entry.data);
    centralDirectory.push({ entry, crc, offset });
    offset += localHeader.length + entry.nameBytes.length + entry.data.length;
  });

  const centralStart = offset;
  centralDirectory.forEach(item => {
    const centralHeader = zipCentralHeader(item.entry, item.crc, item.offset);
    chunks.push(centralHeader, item.entry.nameBytes);
    offset += centralHeader.length + item.entry.nameBytes.length;
  });

  const centralSize = offset - centralStart;
  chunks.push(zipEndRecord(entries.length, centralSize, centralStart));
  return concatUint8Arrays(chunks);
}

function zipLocalHeader(entry, crc) {
  const buffer = new ArrayBuffer(30);
  const view = new DataView(buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, 0, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, 0, true);
  view.setUint32(14, crc, true);
  view.setUint32(18, entry.data.length, true);
  view.setUint32(22, entry.data.length, true);
  view.setUint16(26, entry.nameBytes.length, true);
  view.setUint16(28, 0, true);
  return new Uint8Array(buffer);
}

function zipCentralHeader(entry, crc, localOffset) {
  const buffer = new ArrayBuffer(46);
  const view = new DataView(buffer);
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(8, 0, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, 0, true);
  view.setUint16(14, 0, true);
  view.setUint32(16, crc, true);
  view.setUint32(20, entry.data.length, true);
  view.setUint32(24, entry.data.length, true);
  view.setUint16(28, entry.nameBytes.length, true);
  view.setUint16(30, 0, true);
  view.setUint16(32, 0, true);
  view.setUint16(34, 0, true);
  view.setUint16(36, 0, true);
  view.setUint32(38, 0, true);
  view.setUint32(42, localOffset, true);
  return new Uint8Array(buffer);
}

function zipEndRecord(entryCount, centralSize, centralStart) {
  const buffer = new ArrayBuffer(22);
  const view = new DataView(buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(4, 0, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, entryCount, true);
  view.setUint16(10, entryCount, true);
  view.setUint32(12, centralSize, true);
  view.setUint32(16, centralStart, true);
  view.setUint16(20, 0, true);
  return new Uint8Array(buffer);
}

function concatUint8Arrays(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  parts.forEach(part => {
    output.set(part, offset);
    offset += part.length;
  });
  return output;
}

function crc32(data) {
  let crc = -1;
  for (let index = 0; index < data.length; index++) {
    crc = (crc >>> 8) ^ crc32Table[(crc ^ data[index]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

const crc32Table = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

async function getAnalysisDateRows() {
  const filters = {
    startDate: analysisStartDate.value,
    endDate: analysisEndDate.value
  };
  const result = await callCachedListApi('getClosedCases', filters);
  return enrichRowsWithSundayMemberData(filterCases(result.data || [], filters));
}

function filterAnalysisRowsByStatus(rows) {
  let filtered = rows;
  const status = analysisStatusFilter.value;
  if (status) {
    filtered = filtered.filter(item => getDisplaySettlementStatus(item) === status);
  }
  if (analysisOverdueFilter && analysisOverdueFilter.checked) {
    filtered = filtered.filter(item => checkSettleOverdue(item));
  }
  return filtered;
}

function setAnalysisRange(rangeKey) {
  const year = Number(analysisYear.value) || new Date().getFullYear();
  const ranges = {
    year: ['01-01', '12-31'],
    h1: ['01-01', '06-30'],
    h2: ['07-01', '12-31'],
    q1: ['01-01', '03-31'],
    q2: ['04-01', '06-30'],
    q3: ['07-01', '09-30'],
    q4: ['10-01', '12-31']
  };
  const range = ranges[rangeKey] || ranges.year;
  analysisStartDate.value = `${year}-${range[0]}`;
  analysisEndDate.value = `${year}-${range[1]}`;

  if (!document.getElementById('analysisPanel').hidden) {
    refreshAnalysisPreview();
  }
}

function populateAnalysisStatusFilter(rows) {
  const current = analysisStatusFilter.value;
  const statuses = Array.from(new Set(rows.map(item => getDisplaySettlementStatus(item)))).sort();
  analysisStatusFilter.innerHTML = '<option value="">全部</option>';
  statuses.forEach(status => {
    const option = document.createElement('option');
    option.value = status;
    option.textContent = status;
    analysisStatusFilter.appendChild(option);
  });
  if (statuses.includes(current)) {
    analysisStatusFilter.value = current;
  }
}

function buildSettlementPivot(rows) {
  const counts = new Map();
  rows.forEach(item => {
    const status = getDisplaySettlementStatus(item);
    counts.set(status, (counts.get(status) || 0) + 1);
  });
  return Array.from(counts.entries())
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count || a.status.localeCompare(b.status));
}

function normalizeSettlementStatus(value) {
  return String(value || '').trim() || '未填落戶狀態';
}

function getDisplaySettlementStatus(item) {
  return item && item.displaySettlementStatus
    ? item.displaySettlementStatus
    : normalizeSettlementStatus(item && item['落戶狀態']);
}

function normalizeBoolean(value) {
  if (value === true) return true;
  const text = String(value || '').trim().toLowerCase();
  return ['true', 'yes', 'y', '1', '是'].includes(text);
}

function buildAnalysisSummary(rows, pivot) {
  const summary = document.createElement('div');
  summary.className = 'analysis-summary';
  summary.innerHTML = `
    <div class="summary-item"><span>總清單人數</span><strong>${rows.length}</strong></div>
    <div class="summary-item"><span>落戶狀態種類</span><strong>${pivot.length}</strong></div>
  `;
  return summary;
}

function buildAnalysisPivotTable(pivot, total) {
  const table = document.createElement('table');
  const body = pivot.length
    ? pivot.map(item => {
      const percent = total ? Math.round((item.count / total) * 1000) / 10 : 0;
      return `<tr><td>${escapeHtml(item.status)}</td><td>${item.count}</td><td>${percent}%</td></tr>`;
    }).join('')
    : '<tr><td colspan="3">沒有符合範圍的資料</td></tr>';
  table.innerHTML = `
    <thead><tr><th>落戶狀態</th><th>人數</th><th>比例</th></tr></thead>
    <tbody>${body}</tbody>
  `;
  return table;
}

function buildAnalysisDetailTable(rows) {
  return buildCaseTable(rows, false, getAnalysisColumns(), false, false);
}

function filterCases(rows, filters) {
  const name = String(filters.name || '').trim().toLowerCase();
  const startDate = String(filters.startDate || '').trim();
  const endDate = String(filters.endDate || '').trim();

  return rows.filter(item => {
    const caseName = String(item['姓名'] || '').toLowerCase();
    const caseDate = String(item['首次來訪日'] || '').trim();

    if (name && !caseName.includes(name)) return false;
    if (startDate && (!caseDate || caseDate < startDate)) return false;
    if (endDate && (!caseDate || caseDate > endDate)) return false;
    return true;
  });
}

function buildCaseTable(rows, selectable, columns, isClosed = false, showAction = true) {
  const table = document.createElement('table');
  table.className = 'resizable-table';
  const thead = document.createElement('thead');
  const tbody = document.createElement('tbody');
  const headRow = document.createElement('tr');

  // Checkbox column is only for tracking cases (selectable = true)
  if (selectable) {
    const thCheck = document.createElement('th');
    thCheck.className = 'check-cell';
    thCheck.textContent = '結案';
    thCheck.style.width = '60px';
    thCheck.style.minWidth = '60px';
    headRow.appendChild(thCheck);
  }

  // Action column
  if (showAction) {
    const thAction = document.createElement('th');
    thAction.className = 'action-cell';
    thAction.textContent = isClosed ? '編輯' : '';
    thAction.style.width = isClosed ? '80px' : '90px';
    thAction.style.minWidth = isClosed ? '80px' : '90px';
    headRow.appendChild(thAction);
  }

  // Column headers
  columns.forEach(column => {
    const th = document.createElement('th');
    th.dataset.column = column;
    
    const titleSpan = document.createElement('span');
    titleSpan.textContent = getColumnLabel(column);
    th.appendChild(titleSpan);

    if (isClosed) {
      th.classList.add('filterable-header');
      const filterBtn = document.createElement('button');
      filterBtn.type = 'button';
      filterBtn.className = 'header-filter-btn';
      filterBtn.textContent = activeClosedFilters[column] ? '▼(篩)' : '▼';
      if (activeClosedFilters[column]) filterBtn.classList.add('active');
      filterBtn.setAttribute('aria-label', `篩選 ${getColumnLabel(column)}`);
      
      filterBtn.addEventListener('click', event => {
        event.stopPropagation();
        toggleHeaderFilter(event, column);
      });
      th.appendChild(filterBtn);
    }
    
    // Add resizer handle
    const resizer = document.createElement('div');
    resizer.className = 'resizer';
    th.appendChild(resizer);
    
    // Set saved width or default
    const savedWidth = getSavedColumnWidth(column);
    if (savedWidth) {
      th.style.width = savedWidth + 'px';
      th.style.minWidth = savedWidth + 'px';
    } else {
      th.style.width = '120px';
      th.style.minWidth = '100px';
    }
    
    headRow.appendChild(th);
  });
  
  thead.appendChild(headRow);

  rows.forEach(item => {
    const row = document.createElement('tr');

    // Checkbox cell
    if (selectable) {
      const checkboxCell = document.createElement('td');
      checkboxCell.className = 'check-cell';
      checkboxCell.innerHTML = `<input type="checkbox" value="${item.rowNumber}" aria-label="勾選 ${escapeHtml(item['姓名'] || '此筆資料')} 結案">`;
      row.appendChild(checkboxCell);
    }

    // Action cell
    if (showAction) {
      const actionCell = document.createElement('td');
      actionCell.className = 'action-cell';
      
      if (isClosed) {
        // Render Edit button directly for closed cases
        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'btn secondary edit-direct-btn';
        editBtn.textContent = '編輯';
        editBtn.addEventListener('click', () => {
          openEditModal(item, true);
        });
        actionCell.appendChild(editBtn);
      } else {
        // Render Action dropdown for tracking cases
        const dropdown = document.createElement('div');
        dropdown.className = 'action-dropdown';

        const toggleButton = document.createElement('button');
        toggleButton.type = 'button';
        toggleButton.className = 'btn secondary action-toggle-btn';
        toggleButton.textContent = '操作';
        dropdown.appendChild(toggleButton);

        const menu = document.createElement('div');
        menu.className = 'action-menu';
        menu.hidden = true;

        const editItem = document.createElement('button');
        editItem.type = 'button';
        editItem.className = 'menu-item';
        editItem.textContent = '編輯';
        editItem.addEventListener('click', () => {
          menu.hidden = true;
          openEditModal(item, isClosed);
        });
        menu.appendChild(editItem);

        const deleteItem = document.createElement('button');
        deleteItem.type = 'button';
        deleteItem.className = 'menu-item danger';
        deleteItem.textContent = '刪除';
        deleteItem.addEventListener('click', () => {
          menu.hidden = true;
          deleteSingleCase(item);
        });
        menu.appendChild(deleteItem);

        dropdown.appendChild(menu);
        actionCell.appendChild(dropdown);

        toggleButton.addEventListener('click', event => {
          event.stopPropagation();
          document.querySelectorAll('.action-menu').forEach(m => {
            if (m !== menu) m.hidden = true;
          });
          menu.hidden = !menu.hidden;
        });
      }
      row.appendChild(actionCell);
    }
    
    columns.forEach(column => {
      const cell = document.createElement('td');
      if (column === '現行小組') {
        cell.appendChild(buildSundayGroupTag(item[column] || ''));
      } else if (column === '落戶狀態') {
        cell.textContent = getDisplaySettlementStatus(item);
      } else if (column === '姓名') {
        const wrapper = document.createElement('span');
        wrapper.className = 'name-cell-wrapper';
        wrapper.textContent = item[column] || '';
        cell.appendChild(wrapper);
        if (checkSettleOverdue(item)) {
          const warningTag = document.createElement('span');
          warningTag.className = 'warning-tag';
          warningTag.textContent = '尚未落戶完成 🌱';
          cell.appendChild(warningTag);
        }
      } else {
        cell.textContent = item[column] || '';
      }
      row.appendChild(cell);
    });

    tbody.appendChild(row);
  });

  // Event delegation for columns resizing
  table.addEventListener('mousedown', e => {
    if (e.target.classList.contains('resizer')) {
      e.preventDefault();
      const resizer = e.target;
      const th = resizer.parentElement;
      const column = th.dataset.column;
      const startX = e.pageX;
      const startWidth = th.offsetWidth;
      
      document.body.style.cursor = 'col-resize';
      resizer.classList.add('resizing');
      
      const onMouseMove = ev => {
        const newWidth = startWidth + (ev.pageX - startX);
        if (newWidth > 50) {
          th.style.width = newWidth + 'px';
          th.style.minWidth = newWidth + 'px';
        }
      };
      
      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.body.style.cursor = '';
        resizer.classList.remove('resizing');
        
        saveColumnWidth(column, th.offsetWidth);
      };
      
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    }
  });

  table.appendChild(thead);
  table.appendChild(tbody);
  return table;
}

function buildSundayGroupTag(value) {
  const groupName = String(value || '').trim();
  const tag = document.createElement('button');
  tag.type = 'button';
  tag.className = groupName ? 'group-tag' : 'group-tag empty-tag';
  tag.textContent = groupName ? shortenGroupName(groupName) : '未';
  tag.title = groupName || '尚無現行小組';
  tag.setAttribute('aria-label', groupName ? `現行小組：${groupName}` : '尚無現行小組');
  tag.addEventListener('click', () => tag.classList.toggle('expanded'));
  return tag;
}

function getColumnLabel(column) {
  return column;
}

function shortenGroupName(groupName) {
  const normalized = String(groupName || '').trim();
  return normalized.length > 4 ? `${normalized.slice(0, 3)}...` : normalized;
}

function openEditModal(item, isClosed = false) {
  editingCase = { ...item, isClosed };
  document.getElementById('editTitle').textContent = isClosed ? '編輯已結案資料' : '編輯追蹤中資料';
  editSubtitle.textContent = item['姓名']
    ? `${item['姓名']}，表單號 ${item['表單號'] || '未填'}`
    : `表單號 ${item['表單號'] || '未填'}`;
  setNotice(editNotice, '');
  editFieldContainer.textContent = '';

  editFields.forEach((field, index) => {
    const wrapper = document.createElement('div');
    wrapper.className = `field ${field.full ? 'full' : ''}`.trim();

    const label = document.createElement('label');
    label.textContent = field.label;
    label.htmlFor = `edit-field-${index}`;

    const val = (item[field.name] !== undefined)
      ? item[field.name]
      : item[field.name.replace(/[.#$/\[\]\u0000-\u001f\u007f]/g, '_')];
    const control = createEditControl(field, val || '');
    control.id = `edit-field-${index}`;
    control.name = field.name;
    if (field.required) control.required = true;

    wrapper.appendChild(label);
    wrapper.appendChild(control);
    editFieldContainer.appendChild(wrapper);
  });

  editModal.hidden = false;
}

function closeEditModal() {
  editingCase = null;
  editModal.hidden = true;
  editCaseForm.reset();
  editFieldContainer.textContent = '';
  setNotice(editNotice, '');
}

function createEditControl(field, value) {
  if (field.type === 'textarea') {
    const textarea = document.createElement('textarea');
    textarea.value = value;
    return textarea;
  }

  if (field.type === 'meeting') {
    return createSelectControl(
      meetingOptions.map(item => ({ value: item.name, text: `${item.category} / ${item.name}` })),
      value
    );
  }

  if (field.type === 'settlement') {
    return createSelectControl(
      settlementOptions.map(name => ({ value: name, text: name })),
      value
    );
  }

  if (field.type === 'select') {
    return createSelectControl(
      field.options.map(option => ({ value: option, text: option })),
      value
    );
  }

  const input = document.createElement('input');
  input.type = field.inputType || 'text';
  input.value = value;
  return input;
}

function createSelectControl(options, value) {
  const select = document.createElement('select');
  const blank = document.createElement('option');
  blank.value = '';
  blank.textContent = '請選擇';
  select.appendChild(blank);

  const values = new Set();
  options.forEach(item => {
    if (!item.value || values.has(item.value)) return;
    values.add(item.value);
    const option = document.createElement('option');
    option.value = item.value;
    option.textContent = item.text;
    select.appendChild(option);
  });

  if (value && !values.has(value)) {
    const current = document.createElement('option');
    current.value = value;
    current.textContent = value;
    select.appendChild(current);
  }

  select.value = value;
  return select;
}

async function saveTrackingCase(event) {
  event.preventDefault();
  if (!editingCase) return;

  setNotice(editNotice, '儲存中...');
  editSaveBtn.disabled = true;

  const isClosed = editingCase.isClosed;
  const action = isClosed ? 'updateClosedCase' : 'updateTrackingCase';
  const noticeElement = isClosed ? closedNotice : trackingNotice;

  try {
    const values = Object.fromEntries(new FormData(editCaseForm).entries());
    const editedCaseKey = getClosedCaseKey(editingCase);
    const result = await callApi(action, {
      id: editingCase.id,
      rowNumber: editingCase.rowNumber,
      formNumber: editingCase['表單號'],
      form_number: editingCase['表單號'],
      name: editingCase['姓名'],
      values
    });
    setNotice(noticeElement, result.message, 'success');
    closeEditModal();
    if (isClosed) {
      const applyUpdate = rows => rows.map(item => getClosedCaseKey(item) === editedCaseKey
        ? { ...item, ...values }
        : item);
      closedRecentCases = applyUpdate(closedRecentCases);
      closedHistoryCases = applyUpdate(closedHistoryCases);
      closedCasesAll = mergeClosedCaseRows(closedHistoryCases, closedRecentCases);
      await renderCurrentClosedSearch();
      if (closedHistoryLoaded) {
        try {
          await writeClosedCasesDeviceCache(closedHistoryCases);
        } catch (cacheError) {
          console.warn('[new-family-cache] failed to save edited case to device cache', cacheError);
        }
      }
    } else {
      await loadTrackingCases();
    }
  } catch (error) {
    setNotice(editNotice, error.message || String(error), 'error');
  } finally {
    editSaveBtn.disabled = false;
  }
}

async function closeSelectedCases() {
  const selectedCases = getSelectedTrackingCases();
  const selected = selectedCases.map(item => item.rowNumber);

  if (!selectedCases.length) {
    setNotice(trackingNotice, '請先勾選要結案的資料', 'error');
    return;
  }

  if (!confirm(`確認將 ${selectedCases.length} 筆資料移到「已結案」嗎？`)) return;

  setNotice(trackingNotice, '結案處理中...');
  closeBtn.disabled = true;

  try {
    const result = await callApi('closeCases', {
      rowNumbers: selected,
      items: selectedCases.map(item => ({
        id: item.id,
        rowNumber: item.rowNumber,
        formNumber: item['表單號'],
        form_number: item['表單號'],
        name: item['姓名']
      }))
    });
    setNotice(trackingNotice, result.message, 'success');
    await loadTrackingCases();
  } catch (error) {
    setNotice(trackingNotice, error.message || String(error), 'error');
  } finally {
    closeBtn.disabled = false;
  }
}

async function deleteSingleCase(item) {
  const name = item['姓名'] || '此筆資料';
  if (!confirm(`確認要永久刪除新朋友「${name}」的追蹤資料嗎？此操作將無法復原。`)) {
    return;
  }

  setNotice(trackingNotice, '刪除中...');
  
  try {
    const result = await callApi('deleteTrackingCase', {
      id: item.id,
      rowNumber: item.rowNumber,
      formNumber: item['表單號'],
      form_number: item['表單號'],
      name: item['姓名']
    });
    setNotice(trackingNotice, result.message, 'success');
    await loadTrackingCases();
  } catch (error) {
    setNotice(trackingNotice, error.message || String(error), 'error');
  }
}

function getSelectedTrackingCases() {
  const selectedRows = new Set(Array.from(trackingContent.querySelectorAll('input[type="checkbox"]:checked'))
    .map(input => Number(input.value)));
  return trackingCases.filter(item => selectedRows.has(Number(item.rowNumber)));
}

function setNotice(element, message, type) {
  let displayMessage = message;
  if (message) {
    if (type === 'success') {
      displayMessage = `🌱 ${message}`;
    } else if (type === 'error') {
      displayMessage = `⚠️ ${message}`;
    } else if (message.includes('中...')) {
      displayMessage = `⚙️ ${message}`;
    }
  }
  element.textContent = displayMessage;
  element.className = `notice ${type || ''}`.trim();
}

function setEmptyState(element, message, type = 'empty') {
  element.className = 'empty';
  if (type === 'loading') {
    element.innerHTML = `
      <div style="text-align: center; padding: 24px;">
        <div class="loading-sprout">🌱</div>
        <div style="font-weight: 500; color: var(--muted); font-size: 13px;">${message}</div>
      </div>
    `;
  } else if (type === 'error') {
    element.innerHTML = `
      <div style="text-align: center; padding: 24px;">
        <div style="font-size: 24px; margin-bottom: 8px;">⚠️</div>
        <div style="font-weight: 500; color: var(--danger); font-size: 13px;">${message}</div>
      </div>
    `;
  } else {
    element.innerHTML = `
      <div style="text-align: center; padding: 24px;">
        <div style="font-size: 24px; margin-bottom: 8px;">🌱</div>
        <div style="font-weight: 500; color: var(--muted); font-size: 13px;">${message}</div>
      </div>
    `;
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ============================================================
// 🟢 已結案 Excel 匯出與表頭篩選功能
// ============================================================
async function exportClosedCases() {
  setNotice(closedNotice, '準備匯出中...');
  try {
    const filteredRows = getFilteredClosedCases();

    if (!filteredRows.length) {
      setNotice(closedNotice, '目前沒有符合篩選條件的已結案資料可供匯出', 'error');
      return;
    }

    const headers = [
      '姓名',
      '性別',
      '聚會別',
      '職業',
      '年齡',
      '是否曾接觸教會',
      '來訪原因',
      '表單號',
      '關懷同工',
      '地址',
      '市話',
      '手機',
      '首次來訪日',
      '結案日期',
      '落戶狀態',
      '邀約人',
      '備註',
      '會友狀態',
      '點名編號',
      '現行小組'
    ];

    const dataRows = [
      headers,
      ...filteredRows.map(item => [
        item['姓名'] || '',
        item['性別'] || '',
        item['聚會別'] || '',
        item['職業'] || '',
        item['年齡'] || '',
        item['是否曾接觸教會'] || '',
        item['來訪原因'] || '',
        item['表單號'] ? Number(item['表單號']) : '',
        item['關懷同工'] || '',
        item['地址'] || '',
        item['市話'] || '',
        item['手機'] || '',
        item['首次來訪日'] || '',
        item['結案日期'] || '',
        getDisplaySettlementStatus(item) || '',
        item['邀約人'] || '',
        item['備註'] || '',
        item['會友狀態'] || '',
        item['點名編號'] || '',
        item['現行小組'] || ''
      ])
    ];

    const sheets = [
      { name: '已結案新家人名單', rows: dataRows }
    ];

    const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    exportWorkbook(sheets, `已結案新家人名單_篩選後_截至${todayStr}`);
    setNotice(closedNotice, '匯出成功', 'success');
  } catch (error) {
    setNotice(closedNotice, error.message || String(error), 'error');
  }
}

function toggleHeaderFilter(event, column) {
  activeFilterPopoverColumn = column;
  
  // Clean popover inputs
  popoverSearchInput.value = activeClosedFilters[column]?.search || '';
  popoverOptionsList.innerHTML = '';
  
  // Get all unique values in this column
  const uniqueVals = Array.from(new Set(closedCasesBase.map(item => getFilterValue(item, column))))
    .map(v => v === '' ? '(空白)' : v)
    .sort((a, b) => a.localeCompare(b, 'zh-Hant'));
  
  const currentFilter = activeClosedFilters[column];
  
  uniqueVals.forEach(val => {
    const label = document.createElement('label');
    label.className = 'popover-option';
    label.dataset.value = val === '(空白)' ? '' : val;
    
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    
    // Checked if no filter is active, or if this value is in the selected set
    const origVal = val === '(空白)' ? '' : val;
    checkbox.checked = !currentFilter || currentFilter.selected.has(origVal);
    
    const span = document.createElement('span');
    span.textContent = val;
    
    label.appendChild(checkbox);
    label.appendChild(span);
    popoverOptionsList.appendChild(label);
  });
  
  // Bind select all change
  updateSelectAllCheckboxState();
  
  popoverSelectAll.onchange = () => {
    const checked = popoverSelectAll.checked;
    // Toggle visible options
    popoverOptionsList.querySelectorAll('.popover-option').forEach(label => {
      if (label.style.display !== 'none') {
        label.querySelector('input').checked = checked;
      }
    });
  };
  
  // Bind input filter search
  popoverSearchInput.oninput = () => {
    const searchVal = popoverSearchInput.value.toLowerCase();
    popoverOptionsList.querySelectorAll('.popover-option').forEach(label => {
      const text = label.textContent.toLowerCase();
      if (text.includes(searchVal)) {
        label.style.display = 'flex';
      } else {
        label.style.display = 'none';
      }
    });
    updateSelectAllCheckboxState();
  };
  
  // Bind change event to checkboxes to update select all state
  popoverOptionsList.querySelectorAll('.popover-option input').forEach(input => {
    input.onchange = updateSelectAllCheckboxState;
  });

  // Position and show popover
  const rect = event.currentTarget.getBoundingClientRect();
  headerFilterPopover.style.top = `${window.scrollY + rect.bottom + 4}px`;
  
  const popoverWidth = 220;
  let left = window.scrollX + rect.left;
  if (left + popoverWidth > window.innerWidth) {
    left = window.innerWidth - popoverWidth - 10;
  }
  headerFilterPopover.style.left = `${left < 0 ? 10 : left}px`;
  headerFilterPopover.hidden = false;
}

function updateSelectAllCheckboxState() {
  const visibleCheckboxes = Array.from(popoverOptionsList.querySelectorAll('.popover-option'))
    .filter(label => label.style.display !== 'none')
    .map(label => label.querySelector('input'));
  
  if (visibleCheckboxes.length === 0) {
    popoverSelectAll.checked = false;
    popoverSelectAll.indeterminate = false;
    return;
  }
  
  const checkedCount = visibleCheckboxes.filter(cb => cb.checked).length;
  popoverSelectAll.checked = checkedCount === visibleCheckboxes.length;
  popoverSelectAll.indeterminate = checkedCount > 0 && checkedCount < visibleCheckboxes.length;
}

function applyHeaderFilter(column) {
  const searchVal = popoverSearchInput.value.trim();
  const checkedValues = [];
  
  popoverOptionsList.querySelectorAll('.popover-option').forEach(label => {
    const val = label.dataset.value;
    const checked = label.querySelector('input').checked;
    if (checked) {
      checkedValues.push(val);
    }
  });

  const totalOptions = popoverOptionsList.querySelectorAll('.popover-option').length;
  
  if (checkedValues.length === totalOptions && !searchVal) {
    // No filter needed if all are selected and search text is empty
    delete activeClosedFilters[column];
  } else {
    activeClosedFilters[column] = {
      search: searchVal,
      selected: new Set(checkedValues)
    };
  }

  renderFilteredClosedCases();
  closeHeaderFilterPopover();
}

function closeHeaderFilterPopover() {
  headerFilterPopover.hidden = true;
  activeFilterPopoverColumn = null;
}

popoverConfirmBtn.addEventListener('click', () => {
  if (activeFilterPopoverColumn) {
    applyHeaderFilter(activeFilterPopoverColumn);
  }
});

popoverCancelBtn.addEventListener('click', closeHeaderFilterPopover);

// ============================================================
// ⚙️ 欄位顯示設定與事件綁定
// ============================================================
trackingSettingsBtn.addEventListener('click', openColumnsSettingsModal);
closedSettingsBtn.addEventListener('click', openColumnsSettingsModal);
analysisSettingsBtn.addEventListener('click', openColumnsSettingsModal);
settingsCloseBtn.addEventListener('click', closeColumnsSettingsModal);
settingsCancelBtn.addEventListener('click', closeColumnsSettingsModal);
settingsSaveBtn.addEventListener('click', saveColumnsSettings);
settingsSelectAll.addEventListener('change', toggleAllSettingsCheckboxes);
columnsSettingsModal.addEventListener('click', event => {
  if (event.target === columnsSettingsModal) closeColumnsSettingsModal();
});

function getActiveTab() {
  if (!document.getElementById('trackingPanel').hidden) return 'tracking';
  if (!document.getElementById('closedPanel').hidden) return 'closed';
  if (!document.getElementById('analysisPanel').hidden) return 'analysis';
  return 'form';
}

function openColumnsSettingsModal() {
  const activeTab = getActiveTab();
  if (activeTab === 'form') return;

  settingsColumnsList.innerHTML = '';
  
  const titleMap = {
    'tracking': '追蹤中 - 欄位顯示設定',
    'closed': '已結案 - 欄位顯示設定',
    'analysis': '落戶分析 - 欄位顯示設定'
  };
  document.getElementById('settingsTitle').textContent = titleMap[activeTab];

  const applicableColumns = ALL_COLUMNS.filter(col => {
    if (activeTab === 'tracking' && col === '結案日期') return false;
    return true;
  });

  let activeVisible = [];
  if (activeTab === 'tracking') activeVisible = visibleColumnsTracking;
  else if (activeTab === 'closed') activeVisible = visibleColumnsClosed;
  else if (activeTab === 'analysis') activeVisible = visibleColumnsAnalysis;

  applicableColumns.forEach(column => {
    const label = document.createElement('label');
    label.style.display = 'flex';
    label.style.alignItems = 'center';
    label.style.gap = '8px';
    label.style.cursor = 'pointer';
    label.style.padding = '4px 0';
    
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = column;
    checkbox.checked = activeVisible.includes(column);
    checkbox.addEventListener('change', updateSelectAllSettingsCheckboxState);
    
    const span = document.createElement('span');
    span.textContent = column;
    
    label.appendChild(checkbox);
    label.appendChild(span);
    settingsColumnsList.appendChild(label);
  });
  
  updateSelectAllSettingsCheckboxState();
  columnsSettingsModal.hidden = false;
}

function closeColumnsSettingsModal() {
  columnsSettingsModal.hidden = true;
}

function toggleAllSettingsCheckboxes() {
  const checked = settingsSelectAll.checked;
  settingsColumnsList.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.checked = checked;
  });
}

function updateSelectAllSettingsCheckboxState() {
  const checkboxes = Array.from(settingsColumnsList.querySelectorAll('input[type="checkbox"]'));
  const checkedCount = checkboxes.filter(cb => cb.checked).length;
  settingsSelectAll.checked = checkedCount === checkboxes.length;
  settingsSelectAll.indeterminate = checkedCount > 0 && checkedCount < checkboxes.length;
}

function saveColumnsSettings() {
  const activeTab = getActiveTab();
  if (activeTab === 'form') return;

  const checkedCols = Array.from(settingsColumnsList.querySelectorAll('input[type="checkbox"]:checked'))
    .map(cb => cb.value);
    
  if (checkedCols.length === 0) {
    alert('請至少勾選顯示一個欄位！');
    return;
  }
  
  if (activeTab === 'tracking') {
    visibleColumnsTracking = checkedCols;
    setCookie('visible_columns_tracking', JSON.stringify(visibleColumnsTracking), 365);
    loadTrackingCases();
  } else if (activeTab === 'closed') {
    visibleColumnsClosed = checkedCols;
    setCookie('visible_columns_closed', JSON.stringify(visibleColumnsClosed), 365);
    void renderCurrentClosedSearch();
  } else if (activeTab === 'analysis') {
    visibleColumnsAnalysis = checkedCols;
    setCookie('visible_columns_analysis', JSON.stringify(visibleColumnsAnalysis), 365);
    refreshAnalysisPreview();
  }
  
  closeColumnsSettingsModal();
}

function initNameCombobox() {
  const nameInput = document.getElementById('name');
  const dropdown = document.getElementById('memberDropdown');
  const badge = document.getElementById('memberBadge');
  
  if (!nameInput || !dropdown || !badge) return;
  
  let activeIndex = -1;
  let matches = [];

  function hideDropdown() {
    dropdown.hidden = true;
    dropdown.innerHTML = '';
    activeIndex = -1;
  }

  function setSelectedMember(member) {
    selectedMemberRecord = member;
    if (member) {
      badge.style.display = 'inline-block';
    } else {
      badge.style.display = 'none';
    }
  }

  async function updateDropdown() {
    const val = nameInput.value.trim().toLowerCase();
    if (!val) {
      hideDropdown();
      return;
    }

    try {
      const directory = await getMemberDirectory();
      const allMembers = Array.from(directory.byName.values());

      matches = allMembers.filter(m => 
        m.name.toLowerCase().includes(val) || 
        m.memberCode.toLowerCase().includes(val)
      ).slice(0, 10);

      if (matches.length === 0) {
        hideDropdown();
        return;
      }

      dropdown.innerHTML = '';
      dropdown.hidden = false;

      matches.forEach((member, index) => {
        const item = document.createElement('div');
        item.className = 'combobox-item';
        if (index === activeIndex) item.classList.add('active');

        item.innerHTML = `
          <span>${escapeHtml(member.name)}</span>
          <span class="item-meta">${escapeHtml(member.memberCode)} ${member.sundayGroup ? '(' + escapeHtml(member.sundayGroup) + ')' : ''}</span>
        `;

        item.addEventListener('click', () => {
          selectMember(member);
        });

        dropdown.appendChild(item);
      });
    } catch (e) {
      console.error('[combobox] failed to load members', e);
    }
  }

  function selectMember(member) {
    nameInput.value = member.name;
    setSelectedMember(member);
    hideDropdown();
  }

  nameInput.addEventListener('input', () => {
    activeIndex = -1;
    setSelectedMember(null); // Clear selection when user manually edits input text
    updateDropdown();
  });

  nameInput.addEventListener('focus', () => {
    updateDropdown();
  });

  nameInput.addEventListener('keydown', (e) => {
    if (dropdown.hidden) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIndex = (activeIndex + 1) % matches.length;
      highlightItem();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = (activeIndex - 1 + matches.length) % matches.length;
      highlightItem();
    } else if (e.key === 'Enter') {
      if (activeIndex >= 0 && activeIndex < matches.length) {
        e.preventDefault();
        selectMember(matches[activeIndex]);
      }
    } else if (e.key === 'Escape') {
      hideDropdown();
    }
  });

  function highlightItem() {
    Array.from(dropdown.children).forEach((item, index) => {
      if (index === activeIndex) {
        item.classList.add('active');
        item.scrollIntoView({ block: 'nearest' });
      } else {
        item.classList.remove('active');
      }
    });
  }

  document.addEventListener('click', (e) => {
    if (!nameInput.contains(e.target) && !dropdown.contains(e.target)) {
      hideDropdown();
    }
  });
}
