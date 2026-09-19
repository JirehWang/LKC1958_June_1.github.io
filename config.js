// 📦 中央安全路由設定 (多專案版)
//
// 使用方式：HTML 在載入此檔之前先宣告自己的 key，例如：
//   <script>window._GAS_KEY = 'LKC_worship';</script>
//   <script src="https://jirehwang.github.io/LKC1958_June_1.github.io/config.js"></script>
//
// 若沒有宣告 _GAS_KEY，會 fallback 到 pathname / hostname 推測。
//
// 提供的共用 API：
//   window.churchAPI(action, data)        — 呼叫 GAS
//   window.ensureAPIReady()                — 等待路由就緒（事件式）
//   window.showLoading(msg) / hideLoading()— 顯示遮罩（自動偵測 DOM）
//   window.userNotification                — toast 通知 + 載入指示
//   window.uiState                         — 防重複提交鎖
//   window.sessionManager                  — sessionStorage 管理
//   window.APIError                        — 自訂錯誤類別
(function() {
  // 📝 子系統 → GAS 部署網址 對應表
  const _URL_ROUTER = {
    "LKC_worship":                      "https://script.google.com/macros/s/AKfycbyk_6tUucVg-U4rRQjYHvk632teZyxufDkNX_X1WRUXPMGgsTaemVXD_mv9kBDjuSwOnA/exec",
    "LKC_MasterSchedule":               "https://script.google.com/macros/s/AKfycbwiYYWgKxmLRAEaE_pbp_kWyAzlRPcwYVQfvmJVamRJvosvt5wTTkvwebbFBkP8rMqX/exec",
    "LKC_WorshipPPT":                   "https://script.google.com/macros/s/AKfycbxBOFeLiXu23kBMGU8iSvRyJci6fruTfk7HdahhcQFY777sCPSgasuNM7Z1CeuzuS-r/exec",
    // 禮拜 PPT Library 唯讀橋接：只處理 index fallback 與 fileId -> PPTX binary，
    // 不代表 Supabase 儲存 PPTX，也不應被主行事曆／聖經 action 共用。
    "LKC_WorshipPPT_LIBRARY":            "https://script.google.com/macros/s/AKfycbwiYYWgKxmLRAEaE_pbp_kWyAzlRPcwYVQfvmJVamRJvosvt5wTTkvwebbFBkP8rMqX/exec",
    "LKC_PrayerPPT":                    "https://script.google.com/macros/s/AKfycbxBOFeLiXu23kBMGU8iSvRyJci6fruTfk7HdahhcQFY777sCPSgasuNM7Z1CeuzuS-r/exec",
    "LKC_MinistrySchedule":             "https://script.google.com/macros/s/AKfycbxBOFeLiXu23kBMGU8iSvRyJci6fruTfk7HdahhcQFY777sCPSgasuNM7Z1CeuzuS-r/exec",
    "LKC_Group":                        "https://script.google.com/macros/s/AKfycbxBOFeLiXu23kBMGU8iSvRyJci6fruTfk7HdahhcQFY777sCPSgasuNM7Z1CeuzuS-r/exec",
    "LKC_WhosCar":                      "https://script.google.com/macros/s/AKfycbxOkoaNquIx_V8n_7eS_5ULmoqxPVly_Bezx9_QsmWSzNOcojrCI9Oa6UNd5hOD2euS/exec",
    "LKC_SundayserviceAttendance":      "https://script.google.com/macros/s/AKfycbxBOFeLiXu23kBMGU8iSvRyJci6fruTfk7HdahhcQFY777sCPSgasuNM7Z1CeuzuS-r/exec",
    "LKC_SundayserviceAttendance_TEST": "https://script.google.com/macros/s/AKfycbxBOFeLiXu23kBMGU8iSvRyJci6fruTfk7HdahhcQFY777sCPSgasuNM7Z1CeuzuS-r/exec",
    "LKC_MemberStatus":                 "https://script.google.com/macros/s/AKfycbxBOFeLiXu23kBMGU8iSvRyJci6fruTfk7HdahhcQFY777sCPSgasuNM7Z1CeuzuS-r/exec",
    "LKC_MemberStatus_TEST":            "https://script.google.com/macros/s/AKfycbxBOFeLiXu23kBMGU8iSvRyJci6fruTfk7HdahhcQFY777sCPSgasuNM7Z1CeuzuS-r/exec",
    "LKC_ChildrenAttendance":           "https://script.google.com/macros/s/AKfycbxxXU0AuFpIsDvkBXw0JVibi_jC-1H2-XL5GUR_wH1tndbKnEH9qfTIj1QTKLHmpnjStA/exec",
    "LKC_ChildrenAttendance_TEST":      "https://script.google.com/macros/s/AKfycbxxXU0AuFpIsDvkBXw0JVibi_jC-1H2-XL5GUR_wH1tndbKnEH9qfTIj1QTKLHmpnjStA/exec",
    // 🔀 方案 B 整合：小組系統共用主日 GAS
    "LKC_Group_TEST":                   "https://script.google.com/macros/s/AKfycbxBOFeLiXu23kBMGU8iSvRyJci6fruTfk7HdahhcQFY777sCPSgasuNM7Z1CeuzuS-r/exec",
    // 🔀 方案 C 整合：事工管理共用主日 GAS（action 自動加 ministry_ 前綴）
    "LKC_MinistrySchedule_TEST":        "https://script.google.com/macros/s/AKfycbxBOFeLiXu23kBMGU8iSvRyJci6fruTfk7HdahhcQFY777sCPSgasuNM7Z1CeuzuS-r/exec",
    "LKC_NewFamily":                    "https://script.google.com/macros/s/AKfycbzU4f0XKtniINXQMbIK5QDPuT3ub2HeyiEYI60oUM3YHipdf-02uvuP3lp963dogxml/exec",
    // 🔀 Phase 5 & 6 整合測試版：行事曆與敬拜團併入主 GAS
    "LKC_MasterSchedule_TEST":          "https://script.google.com/macros/s/AKfycbxBOFeLiXu23kBMGU8iSvRyJci6fruTfk7HdahhcQFY777sCPSgasuNM7Z1CeuzuS-r/exec",
    "LKC_worship_TEST":                 "https://script.google.com/macros/s/AKfycbxBOFeLiXu23kBMGU8iSvRyJci6fruTfk7HdahhcQFY777sCPSgasuNM7Z1CeuzuS-r/exec",
    // 🪙 奉獻管理系統（獨立 GAS 專案）
    "LKC_Offering":                     "https://script.google.com/macros/s/AKfycbwOM66vKlyd27kBiZlLavBBoaNAWlSHtXW__wAOB-1NxzqGk_TKaW_ixqBO0s0RfxqMTA/exec",
    "LKC_Offering_TEST":                "https://script.google.com/macros/s/AKfycbwOM66vKlyd27kBiZlLavBBoaNAWlSHtXW__wAOB-1NxzqGk_TKaW_ixqBO0s0RfxqMTA/exec",
  };

  // 📝 子系統 → 後端 action 自動前綴（避免不同系統 action 名稱衝突）
  const _ACTION_PREFIX = {
    "LKC_MinistrySchedule":      "ministry_",
    "LKC_MinistrySchedule_TEST": "ministry_",
    "LKC_worship_TEST":          "worship_",
    "LKC_MemberStatus":          "memberStatus_",
    "LKC_MemberStatus_TEST":     "memberStatus_",
    "LKC_ChildrenAttendance":    "children_",
    "LKC_ChildrenAttendance_TEST": "children_",
  };

  const _AUTH_TOKEN = "ChurchApp-2026";
  const _SESSION_TTL_MS = 3600000; // 1 小時
  const _GAS_REQUEST_TIMEOUT_MS = 45000;
  const _APP_VERSION = window.LKC_APP_VERSION || '2026-06-14-observability-v2';

  // 🌟 路由判斷：_GAS_KEY 優先，其次 pathname / hostname
  const rawPath = window.location.pathname.split('/')[1] || "";
  const repoName = rawPath.replace(/\.github\.io$/i, '');
  const hostname = window.location.hostname.split('.')[0];

  // 🌟 自動切換測試路由（若在 localhost, 127.0.0.1、本地檔案執行，或帶有 ?test=1/?env=test，自動強制走 _TEST 路由）
  const isTestQuery = /[?&](env=test|test=1)\b/.test(window.location.search);
  const isLocalEnv = window.location.hostname === 'localhost' || 
                     window.location.hostname === '127.0.0.1' || 
                     window.location.protocol === 'file:' ||
                     isTestQuery;
  const _ENVIRONMENT = isLocalEnv ? 'test' : 'prod';

  function _getAnonSessionId() {
    try {
      const key = 'lkc_log_session_id';
      let value = window.localStorage && window.localStorage.getItem(key);
      if (!value) {
        value = 'sess_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
        window.localStorage && window.localStorage.setItem(key, value);
      }
      return value;
    } catch (e) {
      return 'session_unavailable';
    }
  }

  const _LOG_SESSION_ID = _getAnonSessionId();

  if (isLocalEnv && !window._FORCE_PRODUCTION_GAS && window._GAS_KEY && !window._GAS_KEY.endsWith('_TEST')) {
    const testKey = window._GAS_KEY + '_TEST';
    if (_URL_ROUTER[testKey]) {
      console.warn(`⚠️ [開發環境] 偵測到本地/測試執行，已將 ${window._GAS_KEY} 自動切換為測試版 ${testKey}`);
      window._GAS_KEY = testKey;
    }
  }

  let currentKey = null;
  if (window._GAS_KEY && _URL_ROUTER[window._GAS_KEY]) {
    currentKey = window._GAS_KEY;
  } else if (_URL_ROUTER[repoName]) {
    currentKey = repoName;
  } else if (_URL_ROUTER[hostname]) {
    currentKey = hostname;
  }

  if (!currentKey) {
    console.error(`🚨 [路由錯誤] 找不到對應的 GAS：未宣告 window._GAS_KEY，且 pathname='${repoName}' / hostname='${hostname}' 都不在 _URL_ROUTER 中`);
    window.GAS_URL = null;
  } else {
    window.GAS_URL = _URL_ROUTER[currentKey];
    console.log(`✅ [${currentKey}] 中央路由系統已就緒`);
  }

  if (window._WORSHIP_PPT_LIBRARY_GAS_KEY && _URL_ROUTER[window._WORSHIP_PPT_LIBRARY_GAS_KEY]) {
    window.LKC_WORSHIP_PPT_LIBRARY_GAS_URL = _URL_ROUTER[window._WORSHIP_PPT_LIBRARY_GAS_KEY];
  }

  // Phase 2 browser observability：中央 config 頁面保留既有 API logger，
  // 只開啟全域例外/console/resource 捕捉，避免 fetch wrapper 與 churchAPI 重複記錄。
  window.__LKC_OBSERVABILITY_CONFIG__ = {
    system: currentKey || undefined,
    environment: _ENVIRONMENT,
    captureConsole: true,
    captureErrors: true,
    captureFetch: false
  };

  window.AUTH_TOKEN = _AUTH_TOKEN;

  // ============================================================
  //  🎯 自訂 APIError
  // ============================================================
  class APIError extends Error {
    constructor(message, httpStatus = null, type = 'UNKNOWN_ERROR') {
      super(message);
      this.name = 'APIError';
      this.httpStatus = httpStatus;
      this.type = type;
    }
  }
  window.APIError = APIError;

  // ============================================================
  //  🚀 中央 API 呼叫（含 Firebase RTDB 快取整合）
  //    若當前 _GAS_KEY 在 _ACTION_PREFIX 中，自動加前綴
  //    若 action 在 _CACHEABLE_ACTIONS 中，自動經 Firebase 快取
  //    若 action 在 _INVALIDATE_ON_WRITE 中，呼叫後自動清除相關快取
  // ============================================================
  const _actionPrefix = _ACTION_PREFIX[currentKey] || "";

  // 📋 快取設定（key = 完整 action 名稱含前綴；value = TTL 秒）
  // 統一 21600 = 6 小時。實際更新依靠 invalidation 機制（前端 + GAS + onEdit）
  // TTL 只是「兜底」：若 invalidation 全部漏接，最壞 6 小時後自動刷新
  const _SIX_HOURS = 21600;
  const _NINETY_DAYS = 90 * 24 * 60 * 60;
  const _CACHEABLE_ACTIONS = {
    // 主日系統 — 全域資料
    'getGroups':                    _SIX_HOURS,
    'getGroupConfig':               _SIX_HOURS,
    'getWeeklyReport':              _SIX_HOURS,
    'getAllMembers':                _SIX_HOURS,
    'getAdminGroupsList':           _SIX_HOURS,
    'getAllGroupMembers':           _SIX_HOURS,
    'getMemberSuggestions':         _SIX_HOURS,

    // 主日系統 — 僅匿名近 90 天出席排序索引可進 Firebase；含姓名名單 direct-GAS。
    'getAttendanceSortIndex':       _NINETY_DAYS,
    'checkGroupStatus':             _SIX_HOURS,  // 小組點名首頁：組員 + 初始化狀態

    // 主日系統 — 統計 / 圖表
    'getStats':                     _SIX_HOURS,
    'getAllGroupsStats':            _SIX_HOURS,
    'getAttendanceStats':           _SIX_HOURS,
    'getAttendanceTrend':           _SIX_HOURS,
    'getCategoryChartData':         _SIX_HOURS,  // 趨勢圖表（依分類）

    // 事工管理
    'ministry_getGroups':           _SIX_HOURS,
    'ministry_getTemplates':        _SIX_HOURS,
    'ministry_getAggregatedReport': _SIX_HOURS,
    'ministry_getPageConfig':       _SIX_HOURS,
    'ministry_getGroupMembers':     _SIX_HOURS,
    'ministry_getMemberSuggestions': _SIX_HOURS,

    // 同工服事狀態管理系統
    'memberStatus_getMembers':              300,
    'memberStatus_getProfile':              300,
    'memberStatus_getServiceIndex':         300,
    'memberStatus_getDiscipleshipStatus':   300,

    // 敬拜團 (無前綴版本，供舊獨立專案相容)
    'getSchedule':                  _SIX_HOURS,  // 公佈欄總表 + 服事表安排（季度）
    'getScheduleByDateRange':       _SIX_HOURS,  // 服事表安排（區間）
    'getPositions':                 _SIX_HOURS,  // 位置與同工
    'getTeamMembers':               _SIX_HOURS,  // 敬拜團員名單
    'getSongs':                     _SIX_HOURS,  // 敬拜曲目（順帶加上）

    // 敬拜團 (worship_ 前綴版本，供合併後的主 GAS 專案使用)
    'worship_getSchedule':              _SIX_HOURS,
    'worship_getScheduleByDateRange':   _SIX_HOURS,
    'worship_getPositions':             _SIX_HOURS,
    'worship_getTeamMembers':           _SIX_HOURS,
    'worship_getSongs':                 _SIX_HOURS,
    'worship_getMemberSuggestions':     _SIX_HOURS,

    // 教會行事曆
    'cal_getTypes':                 _SIX_HOURS,  // 事項類型（含 children 樹）
    'cal_getFields':                _SIX_HOURS,  // 欄位定義（含繼承解析）
    'cal_getEvents':                _SIX_HOURS,  // 事項清單（依日期/類型篩選）
    'cal_getEvent':                 _SIX_HOURS,   // 單一事項詳情

    // 兒童點名系統 (children_ 前綴)
    'children_getAttendanceSortIndex':   _NINETY_DAYS
  };

  // These routes are served by GAS projects outside this repository. Until
  // those projects ship the v2 GAS write-through contract, bypass shared
  // Firebase rather than accepting old entries or pretending this repo can
  // populate them. They keep their existing direct-GAS response contract.
  const _EXTERNAL_CACHE_V2_PENDING_RE = /^(memberStatus_|children_)/;
  function _requiresExternalCacheV2(realAction) {
    return _EXTERNAL_CACHE_V2_PENDING_RE.test(realAction) &&
      realAction !== 'children_getAttendanceSortIndex';
  }

  // 寫入時要連帶清除的 read-cache（key = 寫入 action，value = 要清掉的 read action 陣列）
  // 使用 cacheDeleteAll 清整個 topic（包含所有 subkey），所以不分 data 變體
  const _INVALIDATE_ON_WRITE = {
    // ── 會友名單異動 ──
    'addMember':              ['getAllMembers', 'getAllGroupMembers', 'getMemberSuggestions', 'ministry_getMemberSuggestions', 'getStats', 'getAllGroupsStats', 'getAdminGroupsList', 'ministry_getPageConfig', 'getSmartAttendanceList', 'memberStatus_getMembers', 'memberStatus_getProfile', 'memberStatus_getServiceIndex'],
    'updateMember':           ['getAllMembers', 'getAllGroupMembers', 'getMemberSuggestions', 'ministry_getMemberSuggestions', 'getStats', 'getAllGroupsStats', 'getAdminGroupsList', 'ministry_getPageConfig', 'getSmartAttendanceList', 'memberStatus_getMembers', 'memberStatus_getProfile', 'memberStatus_getServiceIndex'],
    'deleteMember':           ['getAllMembers', 'getAllGroupMembers', 'getMemberSuggestions', 'ministry_getMemberSuggestions', 'getStats', 'getAllGroupsStats', 'getAdminGroupsList', 'ministry_getPageConfig', 'getSmartAttendanceList', 'memberStatus_getMembers', 'memberStatus_getProfile', 'memberStatus_getServiceIndex'],

    // ── 小組異動 ──
    'createGroup':            ['getGroups', 'getAdminGroupsList'],
    'updateGroupInfo':        ['getGroups', 'getAdminGroupsList'],
    'updateMemberList':       ['getAllMembers', 'getAllGroupMembers', 'getMemberSuggestions', 'ministry_getMemberSuggestions', 'getStats', 'getAllGroupsStats', 'ministry_getPageConfig', 'ministry_getGroupMembers', 'checkGroupStatus', 'memberStatus_getMembers', 'memberStatus_getProfile', 'memberStatus_getServiceIndex'],
    'ministry_updateGroupMemberRoles': ['getAllMembers', 'getAllGroupMembers', 'getMemberSuggestions', 'ministry_getMemberSuggestions', 'getStats', 'getAllGroupsStats', 'ministry_getPageConfig', 'ministry_getGroupMembers', 'checkGroupStatus', 'memberStatus_getMembers', 'memberStatus_getProfile', 'memberStatus_getServiceIndex'],
    'initGroup':              ['checkGroupStatus', 'getGroups', 'getAllGroupMembers'],

    // ── 主日點名異動 ──
    'createAttendanceGroup':  ['getGroupConfig'],
    'saveAttendance':         ['getWeeklyReport', 'getAttendanceStats', 'getAttendanceTrend', 'getStats', 'getAllGroupsStats', 'getAttendanceSortIndex', 'getCategoryChartData', 'memberStatus_getMembers', 'memberStatus_getProfile', 'memberStatus_getServiceIndex'],
    'revokeAttendance':       ['getWeeklyReport', 'getAttendanceStats', 'getAttendanceTrend', 'getStats', 'getAllGroupsStats', 'getAttendanceSortIndex', 'getCategoryChartData', 'memberStatus_getMembers', 'memberStatus_getProfile', 'memberStatus_getServiceIndex'],

    // ── 小組點名異動 ──
    'submitAttendance':       ['getWeeklyReport', 'getStats', 'getAllGroupsStats', 'checkGroupStatus', 'getCategoryChartData', 'memberStatus_getMembers', 'memberStatus_getProfile', 'memberStatus_getServiceIndex'],
    'updateAttendanceRecord': ['getWeeklyReport', 'getStats', 'getAllGroupsStats', 'checkGroupStatus', 'getCategoryChartData', 'memberStatus_getMembers', 'memberStatus_getProfile', 'memberStatus_getServiceIndex'],
    'deleteAttendanceRecord': ['getWeeklyReport', 'getStats', 'getAllGroupsStats', 'checkGroupStatus', 'getCategoryChartData', 'memberStatus_getMembers', 'memberStatus_getProfile', 'memberStatus_getServiceIndex'],

    // ── 事工異動 ──
    'ministry_createGroup':       ['ministry_getGroups', 'ministry_getAggregatedReport'],
    'ministry_toggleGroupStatus': ['ministry_getGroups'],
    'ministry_saveSheetData':     ['ministry_getAggregatedReport', 'ministry_getPageConfig', 'memberStatus_getMembers', 'memberStatus_getProfile', 'memberStatus_getServiceIndex'],
    'ministry_savePageFieldConfig': ['ministry_getAggregatedReport', 'ministry_getPageConfig', 'memberStatus_getMembers', 'memberStatus_getProfile', 'memberStatus_getServiceIndex'],
    'ministry_updatePageInfo':    ['ministry_getGroups', 'ministry_getPageConfig', 'ministry_getAggregatedReport', 'memberStatus_getMembers', 'memberStatus_getProfile', 'memberStatus_getServiceIndex'],
    'ministry_saveGroupPrompt':   ['ministry_getPageConfig'],
    'ministry_saveGroupMembers':  ['ministry_getPageConfig', 'memberStatus_getMembers', 'memberStatus_getProfile', 'memberStatus_getServiceIndex'],
    'ministry_saveSermonSettings': ['ministry_getPageConfig'],
    'ministry_forceRefreshEvents': ['ministry_getPageConfig'],

    // ── 敬拜團異動 ──
    'saveSchedule':           ['getSchedule', 'getScheduleByDateRange'],
    'savePositions':          ['getPositions'],
    'saveTeamMembers':        ['getTeamMembers'],
    'saveSongs':              ['getSongs', 'getSchedule', 'getScheduleByDateRange'],
    // 行事曆連結設定改變 → 公佈欄 / 服事表的「聚會名稱、聚會類別、講道資訊」會跟著變
    'setDefaultSermonSubType': ['getSchedule', 'getScheduleByDateRange'],
    'setDateOverride':         ['getSchedule', 'getScheduleByDateRange'],
    'clearCalendarLinkCache':  ['getSchedule', 'getScheduleByDateRange'],

    // ── 敬拜團異動 (worship_ 前綴版本) ──
    'worship_saveSchedule':           ['worship_getSchedule', 'worship_getScheduleByDateRange', 'memberStatus_getMembers', 'memberStatus_getProfile', 'memberStatus_getServiceIndex'],
    'worship_savePositions':          ['worship_getPositions'],
    'worship_saveTeamMembers':        ['worship_getTeamMembers', 'memberStatus_getMembers', 'memberStatus_getProfile', 'memberStatus_getServiceIndex'],
    'worship_saveSongs':              ['worship_getSongs', 'worship_getSchedule', 'worship_getScheduleByDateRange'],
    'worship_setDefaultSermonSubType': ['worship_getSchedule', 'worship_getScheduleByDateRange'],
    'worship_setDateOverride':         ['worship_getSchedule', 'worship_getScheduleByDateRange'],
    'worship_clearCalendarLinkCache':  ['worship_getSchedule', 'worship_getScheduleByDateRange', 'memberStatus_getMembers', 'memberStatus_getProfile', 'memberStatus_getServiceIndex'],

    // ── 同工服事狀態管理系統 ──
    'memberStatus_refreshCaches': ['memberStatus_getMembers', 'memberStatus_getProfile', 'memberStatus_getServiceIndex', 'memberStatus_getDiscipleshipStatus'],

    // ── 教會行事曆異動 ──
    // 類型 / 排除欄位改變 → 影響事項本身的子類型/欄位顯示 + 敬拜團公佈欄
    'cal_addType':             ['cal_getTypes', 'cal_getFields', 'cal_getEvents', 'cal_getEvent', 'getSchedule', 'getScheduleByDateRange'],
    'cal_updateType':          ['cal_getTypes', 'cal_getFields', 'cal_getEvents', 'cal_getEvent', 'getSchedule', 'getScheduleByDateRange'],
    'cal_deleteType':          ['cal_getTypes', 'cal_getFields', 'cal_getEvents', 'cal_getEvent', 'getSchedule', 'getScheduleByDateRange'],
    // 欄位改變 → 事項顯示 + 敬拜團公佈欄
    'cal_addField':            ['cal_getFields', 'cal_getEvents', 'cal_getEvent', 'getSchedule', 'getScheduleByDateRange'],
    'cal_updateField':         ['cal_getFields', 'cal_getEvents', 'cal_getEvent', 'getSchedule', 'getScheduleByDateRange'],
    'cal_deleteField':         ['cal_getFields', 'cal_getEvents', 'cal_getEvent', 'getSchedule', 'getScheduleByDateRange'],
    'cal_reorderFields':       ['cal_getFields', 'cal_getEvents', 'cal_getEvent'],
    // 事項 CRUD → 公佈欄要重抓
    'cal_addEvent':            ['cal_getEvents', 'cal_getEvent', 'getSchedule', 'getScheduleByDateRange'],
    'cal_updateEvent':         ['cal_getEvents', 'cal_getEvent', 'getSchedule', 'getScheduleByDateRange'],
    'cal_deleteEvent':         ['cal_getEvents', 'cal_getEvent', 'getSchedule', 'getScheduleByDateRange'],
    'cal_addEventsBatch':      ['cal_getEvents', 'cal_getEvent', 'getSchedule', 'getScheduleByDateRange'],
    // 整批操作
    'cal_setupSchema':         ['cal_getTypes', 'cal_getFields', 'cal_getEvents', 'cal_getEvent'],
    'cal_migrateOldData':      ['cal_getTypes', 'cal_getFields', 'cal_getEvents', 'cal_getEvent', 'getSchedule', 'getScheduleByDateRange'],
    'cal_clearNewData':        ['cal_getEvents', 'cal_getEvent', 'getSchedule', 'getScheduleByDateRange'],

    // ── 兒童點名異動 ──
    'children_addMember':              ['children_getAllMembers', 'children_getSmartAttendanceList', 'children_getAttendanceStats'],
    'children_updateMember':           ['children_getAllMembers', 'children_getSmartAttendanceList', 'children_getAttendanceStats'],
    'children_deleteMember':           ['children_getAllMembers', 'children_getSmartAttendanceList', 'children_getAttendanceStats'],
    'children_saveAttendance':         ['children_getAttendanceSortIndex'],
    'children_revokeAttendance':       ['children_getAttendanceSortIndex'],
    'children_createAttendanceGroup':  ['children_getGroupConfig']
  };

  // Lazy-load Firebase cache module（僅在需要時 import；失敗則自動 fallback 至直接 GAS 呼叫）
  let _firebaseCachePromise = null;
  function _getFirebaseCache() {
    if (_firebaseCachePromise) return _firebaseCachePromise;
    _firebaseCachePromise = import('https://jirehwang.github.io/LKC1958_June_1.github.io/firebase/firebase-cache.js')
      .catch(err => { console.warn('[firebase-cache] 載入失敗，將以直接呼叫 GAS 模式運作:', err); return null; });
    return _firebaseCachePromise;
  }

  let _firebaseLoggerPromise = null;
  function _getFirebaseLogger() {
    if (_firebaseLoggerPromise) return _firebaseLoggerPromise;
    _firebaseLoggerPromise = import('https://jirehwang.github.io/LKC1958_June_1.github.io/firebase/firebase-logger.js')
      .catch(err => { console.warn('[firebase-logger] 載入失敗，略過遠端紀錄:', err); return null; });
    return _firebaseLoggerPromise;
  }

  let _browserObservabilityPromise = null;
  function _getBrowserObservability() {
    if (_browserObservabilityPromise) return _browserObservabilityPromise;
    _browserObservabilityPromise = import('https://jirehwang.github.io/LKC1958_June_1.github.io/firebase/observability-browser.js')
      .catch(err => { console.warn('[browser-observability] 載入失敗，略過全域錯誤捕捉:', err); return null; });
    return _browserObservabilityPromise;
  }

  function _logEvent(level, action, message, meta = {}) {
    if (!currentKey) return;
    const requestId = meta.requestId || '';
    const cache = meta.cache || null;
    const payload = meta.payload || null;
    const invalidation = meta.invalidation || null;
    const errorType = meta.errorType || meta.type || '';
    return _getFirebaseLogger().then(logger => {
      if (!logger || !logger.writeLog) return;
      return logger.writeLog({
        system: currentKey,
        level,
        action,
        message,
        requestId,
        environment: _ENVIRONMENT,
        appVersion: _APP_VERSION,
        sessionId: _LOG_SESSION_ID,
        errorType,
        durationMs: meta.durationMs,
        source: meta.source || 'config.js',
        endpoint: meta.endpoint || '',
        cache,
        payload,
        invalidation,
        meta
      });
    }).catch(err => {
      console.warn('[church-log] 寫入失敗:', err);
    });
  }

  window.churchLog = function(entry = {}) {
    const meta = Object.assign({}, entry.meta || {});
    ['source', 'endpoint', 'errorType', 'requestId', 'environment', 'appVersion', 'sessionId', 'durationMs', 'cache', 'payload', 'invalidation']
      .forEach(key => {
        if (entry[key] !== undefined && meta[key] === undefined) meta[key] = entry[key];
      });
    return _logEvent(entry.level || 'info', entry.action || '', entry.message || '', meta);
  };

  _getBrowserObservability();

  // 為帶 data 的 cache 計算 subkey（無 data → null 走 _default）
  // ⚠️ 不可截斷！之前用 substring(0, 24) 會讓 {year:'2026',quarter:'Q1'}
  //    與 {year:'2026',quarter:'Q2'} 產生同樣 subkey（差異在末尾），導致 cache 撞鍵
  function _makeSubkey(data) {
    if (!data || Object.keys(data).length === 0) return null;
    const json = JSON.stringify(data);
    return btoa(unescape(encodeURIComponent(json))).replace(/[^a-zA-Z0-9]/g, '');
  }

  function _isInvalidApiResponse(value) {
    return value &&
      typeof value === 'object' &&
      ((Object.prototype.hasOwnProperty.call(value, 'status') && value.status !== 'success') ||
       (Object.prototype.hasOwnProperty.call(value, 'success') && value.success === false));
  }

  // 直接打 GAS（不走 cache）
  function _newRequestId(realAction) {
    return [
      currentKey || 'unknown',
      realAction || 'unknown',
      Date.now().toString(36),
      Math.random().toString(36).slice(2, 8)
    ].join('-').replace(/[^a-zA-Z0-9_-]/g, '_');
  }

  function _jsonSizeBytes(value) {
    try {
      const text = JSON.stringify(value == null ? null : value);
      if (window.TextEncoder) return new TextEncoder().encode(text).length;
      return unescape(encodeURIComponent(text)).length;
    } catch (e) {
      return null;
    }
  }

  function _estimateItemCount(value) {
    if (!value) return null;
    if (Array.isArray(value)) return value.length;
    if (typeof value !== 'object') return null;
    const data = value.data || value.items || value.records || value.rows || value.list || value.value;
    if (Array.isArray(data)) return data.length;
    if (data && typeof data === 'object') return Object.keys(data).length;
    return null;
  }

  function _payloadMeta(requestBody, result) {
    return {
      requestBytes: _jsonSizeBytes(requestBody),
      responseBytes: _jsonSizeBytes(result),
      itemCount: _estimateItemCount(result)
    };
  }

  async function _doDirectCall(realAction, data) {
    const requestBody = { action: realAction, token: window.AUTH_TOKEN, data: data };
    const configuredTimeout = Number(window.LKC_GAS_REQUEST_TIMEOUT_MS);
    const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0
      ? configuredTimeout
      : _GAS_REQUEST_TIMEOUT_MS;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const requestOptions = {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(requestBody)
    };
    if (controller) requestOptions.signal = controller.signal;
    let timerId = null;
    if (controller) timerId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const resp = await fetch(window.GAS_URL, requestOptions);
      let result;
      if (typeof resp.text === 'function') {
        const text = await resp.text();
        const normalizedText = String(text || '').trim();
        try {
          result = JSON.parse(normalizedText);
        } catch (e) {
          if (normalizedText && (normalizedText.includes('<!DOCTYPE') || normalizedText.includes('<html'))) {
            throw new APIError('後端服務 (GAS) 回傳 HTML 頁面，可能是權限不足或後端執行逾時', resp.status, 'GAS_HTML_ERROR');
          }
          if (/^ *✅|行事曆系統 API/.test(normalizedText)) {
            throw new APIError('後端服務回傳健康檢查文字，可能使用了錯誤的 GAS 路由或後端尚未部署', resp.status, 'INVALID_RESPONSE');
          }
          throw new APIError('後端服務回傳非 JSON 格式', resp.status, 'INVALID_RESPONSE');
        }
      } else {
        try {
          result = await resp.json();
        } catch (error) {
          if (error && error.name === 'SyntaxError') {
            throw new APIError('後端服務回傳非 JSON 格式', resp.status, 'INVALID_RESPONSE');
          }
          throw error;
        }
      }
      return {
        result,
        payload: _payloadMeta(requestBody, result),
        httpStatus: resp.status
      };
    } catch (error) {
      if (error && error.name === 'AbortError') {
        throw new APIError('後端服務 (GAS) 回應逾時，請稍後再試', null, 'GAS_TIMEOUT');
      }
      throw error;
    } finally {
      if (timerId !== null) clearTimeout(timerId);
    }
  }

  window.churchAPI = async function(action, data = {}) {
    if (!window.GAS_URL) {
      throw new APIError("系統尚未就緒：GAS_URL 為空", null, 'CONFIG_ERROR');
    }
    const startedAt = Date.now();
    // 已有前綴或全域跨系統 action（如 cal_ 行事曆）不重複加
    const realAction = (_actionPrefix && action.indexOf(_actionPrefix) !== 0 && !action.startsWith('cal_'))
      ? _actionPrefix + action
      : action;
    const requestId = _newRequestId(realAction);
    const ttl = _CACHEABLE_ACTIONS[realAction];
    const isWriteAction = Object.prototype.hasOwnProperty.call(_INVALIDATE_ON_WRITE, realAction);

    function logApi(level, message, extra = {}) {
      _logEvent(level, realAction, message, Object.assign({
        requestId,
        environment: _ENVIRONMENT,
        appVersion: _APP_VERSION,
        sessionId: _LOG_SESSION_ID,
        source: 'gas',
        endpoint: window.GAS_URL,
        requestedAction: action,
        durationMs: Date.now() - startedAt,
        cacheable: Boolean(ttl),
        writeAction: isWriteAction
      }, extra));
    }

    try {
      // 🔥 可快取 → 走 Firebase（cache 路徑：cache/{action}/{dataHash}）
      if (ttl && !_requiresExternalCacheV2(realAction)) {
        const fb = await _getFirebaseCache();
        if (fb && fb.cacheGetOrFetch) {
          const subkey = _makeSubkey(data);
          // This state belongs to the whole cache attempt, including its
          // fallback catch: the catch must not retry a loader that already
          // reached GAS and failed.
          let gasAttempted = false;
          try {
            let freshDirect = null;
            const cacheLoader = async () => {
              gasAttempted = true;
              freshDirect = await _doDirectCall(realAction, data);
              return freshDirect.result;
            };
            const cacheResult = fb.cacheGetOrFetchWithMeta
              ? await fb.cacheGetOrFetchWithMeta(realAction, subkey, cacheLoader, ttl)
              : { value: await fb.cacheGetOrFetch(realAction, subkey, cacheLoader, ttl), source: 'unknown' };
            const result = cacheResult.value;
            const payload = freshDirect
              ? freshDirect.payload
              : {
                  requestBytes: _jsonSizeBytes({ action: realAction, token: window.AUTH_TOKEN, data: data }),
                  responseBytes: _jsonSizeBytes(result),
                  itemCount: _estimateItemCount(result)
                };
            const cacheMeta = {
              enabled: true,
              topic: realAction,
              subkey,
              ttl,
              source: cacheResult.source,
              hit: cacheResult.source === 'cache',
              miss: cacheResult.source !== 'cache'
            };
            // Invalid or legacy Firebase entries are treated as misses by the
            // cache module. Do not delete or retry them from the browser.
            const durationMs = Date.now() - startedAt;
            if (cacheResult.source === 'fresh' || durationMs > 3000) {
              logApi(durationMs > 5000 ? 'warn' : 'info', 'cacheable API completed', {
                cache: cacheMeta,
                payload,
                httpStatus: freshDirect && freshDirect.httpStatus,
                responseStatus: result && result.status
              });
            }
            return result;
          } catch (e) {
            console.warn('[firebase-cache]', realAction, '失敗，回退直接呼叫:', e);
            logApi('warn', 'firebase cache read failed, direct GAS once', {
              errorType: 'FIREBASE_CACHE_ERROR',
              error: e && e.message ? e.message : String(e),
              cache: {
                enabled: true,
                topic: realAction,
                subkey,
                ttl,
                source: 'cache-error',
                fallback: true
              }
            });
            // If GAS was already the single-flight loader, its network/JSON
            // failure is the response for this request. Retrying here would
            // double both GAS and possible Sheet work.
            if (gasAttempted) throw e;
            // The cache module single-flights a miss. Return from this catch
            // so a Firebase failure cannot fall through to a second GAS call.
            const direct = await _doDirectCall(realAction, data);
            return direct.result;
          }
        }
      }

      // 直接呼叫 GAS
      const direct = await _doDirectCall(realAction, data);
      const result = direct.result;
      if (_isInvalidApiResponse(result)) {
        logApi('error', 'GAS returned non-success response', {
          errorType: 'GAS_NON_SUCCESS',
          payload: direct.payload,
          httpStatus: direct.httpStatus,
          responseStatus: result.status,
          message: result.message || ''
        });
      } else if (isWriteAction || Date.now() - startedAt > 3000) {
        logApi(Date.now() - startedAt > 5000 ? 'warn' : 'info', 'direct GAS API completed', {
          cache: { enabled: Boolean(ttl), source: 'direct-gas', hit: false },
          payload: direct.payload,
          httpStatus: direct.httpStatus,
          responseStatus: result && result.status
        });
      }

      // 🗑️ 寫入 action 觸發整個 topic 的 cache 失效（不分 data 變體）
      // ⚠️ 改為 await：避免使用者寫入後立刻去讀（例：改完覆寫立刻看公佈欄），
      //    invalidation 還沒完成 → 讀到舊 cache → 看不到變動
      // Kept only as a compatibility map for older pages. Server-side GAS is
      // now the sole cache mutator, so this client-side branch is disabled.
      const toInvalidate = [];
      if (toInvalidate && toInvalidate.length > 0) {
        const fb = await _getFirebaseCache();
        if (fb && fb.cacheDeleteAll) {
          try {
            const invalidationStartedAt = Date.now();
            const failedTopics = [];
            const uniqueTopics = Array.from(new Set(toInvalidate));
            await Promise.all(uniqueTopics.map(topic =>
              fb.cacheDeleteAll(topic).catch(err => {
                console.warn('[invalidate]', topic, err);
                failedTopics.push(topic);
              })
            ));
            console.log('[invalidate] cleared:', uniqueTopics.join(', '));
            logApi('info', 'server-owned cache sync after write', {
              invalidation: {
                writeAction: realAction,
                topics: uniqueTopics,
                count: uniqueTopics.length,
                failedTopics,
                durationMs: Date.now() - invalidationStartedAt
              }
            });
          } catch (e) { /* 已個別 catch */ }
        }
      }

      return result;
    } catch (err) {
      console.error("📡 API 通訊失敗:", err);
      logApi('error', 'API request failed', {
        errorType: err && err.type ? err.type : (err && err.name ? err.name : 'API_REQUEST_FAILED'),
        error: err && err.message ? err.message : String(err),
        errorName: err && err.name,
        httpStatus: err && err.httpStatus,
        type: err && err.type
      });
      throw err;
    }
  };

  // 對外暴露：手動清除整個 topic 的 cache
  window.churchAPIInvalidate = async function(topic) {
    console.warn('[firebase-cache] client invalidation is disabled; request the GAS maintenance action instead:', topic);
    return false;
  };

  // ============================================================
  //  🐛 debug — 受 ?debug=1 或 window.DEBUG 控制的條件式 log
  //  使用方式：debug('[Module] 訊息', data) 取代瑣碎的 console.log
  // ============================================================
  const _debugEnabled = /[?&]debug=1\b/.test(window.location.search) || window.DEBUG === true;
  window.debug = _debugEnabled
    ? console.log.bind(console, '%c[debug]', 'color:#888')
    : function() {};

  // ============================================================
  //  🗓️ 共用日期工具
  // ============================================================
  window.WEEKDAY_NAMES = ['日', '一', '二', '三', '四', '五', '六'];

  // 格式化為 YYYY-MM-DD（使用本地時區，避免 toISOString 的 UTC 偏移）
  window.formatYMD = function(date) {
    const d = (date instanceof Date) ? date : new Date(date);
    if (isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  // ============================================================
  //  🛡️ ensureAPIReady — 由於 <script> 標籤同步載入順序保證 config.js
  //  在 app script 之前完成，這裡幾乎都是立即 resolve；保留 API 以兼容
  //  舊呼叫方式，並在極端情況提供 microtask 等待。
  // ============================================================
  window.ensureAPIReady = function() {
    if (typeof window.churchAPI === 'function' && window.GAS_URL) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      if (typeof window.churchAPI === 'function' && window.GAS_URL) {
        return resolve();
      }
      const timer = setTimeout(() => {
        document.removeEventListener('churchAPIReady', onReady);
        reject(new APIError("安全路由載入逾時，請確認網路連線或檔案路徑。", null, 'CONFIG_ERROR'));
      }, 5000);
      const onReady = () => {
        clearTimeout(timer);
        resolve();
      };
      document.addEventListener('churchAPIReady', onReady, { once: true });
    });
  };

  // ============================================================
  //  💡 載入指示器：自動偵測 DOM 元素
  //    - LKC_Group / LKC_MasterSchedule 用 #loading-overlay + #overlay-text
  //    - LKC_MinistrySchedule 用 #globalLoading
  // ============================================================
  function showLoading(msg = "處理中...") {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
      const textEl = document.getElementById('overlay-text');
      if (textEl) textEl.innerText = msg;
      overlay.style.display = 'flex';
      return;
    }
    const global = document.getElementById('globalLoading');
    if (global) {
      global.innerText = msg;
      global.classList.remove('hidden');
    }
  }

  function hideLoading() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.style.display = 'none';
    const global = document.getElementById('globalLoading');
    if (global) global.classList.add('hidden');
  }

  window.showLoading = showLoading;
  window.hideLoading = hideLoading;

  // ============================================================
  //  🔔 userNotification — toast 通知（Bootstrap-free，使用 inline style）
  // ============================================================
  const _toastStyle = {
    success: { bg: '#28a745', color: '#fff' },
    warning: { bg: '#ffc107', color: '#212529' },
    danger:  { bg: '#dc3545', color: '#fff' },
    info:    { bg: '#17a2b8', color: '#fff' }
  };

  let _toastStack = 0;
  function showToast(message, type = 'info', duration = 3000) {
    const style = _toastStyle[type] || _toastStyle.info;
    const offset = 16 + (_toastStack * 64);
    _toastStack++;

    const toast = document.createElement('div');
    toast.style.cssText = [
      'position:fixed', `bottom:${offset}px`, 'right:16px', 'z-index:99999',
      `background:${style.bg}`, `color:${style.color}`,
      'padding:12px 16px 12px 18px', 'border-radius:8px',
      'box-shadow:0 4px 14px rgba(0,0,0,0.18)',
      'font-family:"Microsoft JhengHei","Noto Sans TC",sans-serif',
      'font-size:14px', 'max-width:90vw', 'min-width:220px',
      'display:flex', 'align-items:center', 'gap:12px',
      'animation:lkc-toast-in 0.18s ease-out'
    ].join(';');
    toast.textContent = String(message);

    const closeBtn = document.createElement('span');
    closeBtn.textContent = '×';
    closeBtn.style.cssText = `cursor:pointer;font-size:20px;line-height:1;opacity:0.85;color:${style.color};margin-left:auto`;
    closeBtn.addEventListener('click', () => removeToast());
    toast.appendChild(closeBtn);

    document.body.appendChild(toast);

    function removeToast() {
      if (!toast.parentNode) return;
      toast.remove();
      _toastStack = Math.max(0, _toastStack - 1);
    }
    if (duration > 0) setTimeout(removeToast, duration);
  }

  // toast 進場動畫（一次性注入 keyframes）
  if (typeof document !== 'undefined' && !document.getElementById('lkc-toast-style')) {
    const style = document.createElement('style');
    style.id = 'lkc-toast-style';
    style.textContent = '@keyframes lkc-toast-in{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}';
    document.head && document.head.appendChild(style);
  }

  window.userNotification = {
    success: (msg, d = 3000) => showToast(msg, 'success', d),
    warning: (msg, d = 5000) => showToast(msg, 'warning', d),
    error:   (msg, d = 5000) => showToast(msg, 'danger',  d),
    info:    (msg, d = 3000) => showToast(msg, 'info',    d),
    showLoading: showLoading,
    hideLoading: hideLoading
  };

  // ============================================================
  //  🔐 uiState — 防重複提交鎖
  // ============================================================
  window.uiState = (function() {
    const _locks = {};
    return {
      lock:     (k) => { _locks[k] = true; },
      unlock:   (k) => { _locks[k] = false; },
      isLocked: (k) => _locks[k] === true
    };
  })();

  // ============================================================
  //  💾 sessionManager — sessionStorage 帶過期檢查
  // ============================================================
  window.sessionManager = {
    setUnlocked(id) {
      sessionStorage.setItem(`session_${id}`, JSON.stringify({ unlocked: true, timestamp: Date.now() }));
    },
    isUnlocked(id) {
      const raw = sessionStorage.getItem(`session_${id}`);
      if (!raw) return false;
      try {
        const data = JSON.parse(raw);
        if (Date.now() - data.timestamp > _SESSION_TTL_MS) {
          sessionStorage.removeItem(`session_${id}`);
          return false;
        }
        return data.unlocked === true;
      } catch (e) {
        return false;
      }
    },
    clear(id) {
      sessionStorage.removeItem(`session_${id}`);
    }
  };

  // ─────────────────────────────────────────────────────────────
  //  PWA Service Worker 自動註冊與強制更新
  //  - HTML / config.js / app JS 由 SW 走 network-first，避免部署卡舊版
  //  - 發現新版 SW 時立即 skipWaiting，接管後自動 reload 一次
  // ─────────────────────────────────────────────────────────────
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function() {
      // 依據 hostname 動態判定 scope 路徑
      // 本地環境可能是 "/"，而 GitHub Pages 是 "/LKC1958_June_1.github.io/"
      let scopePath = '/';
      let swPath = '/service-worker.js';

      if (window.location.hostname.indexOf('github.io') !== -1) {
        scopePath = '/LKC1958_June_1.github.io/';
        swPath = '/LKC1958_June_1.github.io/service-worker.js';
      }

      var reloadedForSwUpdate = false;
      navigator.serviceWorker.addEventListener('controllerchange', function() {
        if (reloadedForSwUpdate) return;
        reloadedForSwUpdate = true;
        var url = new URL(window.location.href);
        url.searchParams.set('nocache', Date.now().toString());
        window.location.replace(url.toString());
      });

      function activateWaitingWorker(reg) {
        if (reg && reg.waiting) {
          reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        }
      }

      navigator.serviceWorker.register(swPath, { scope: scopePath })
        .then(function(reg) {
          console.log('✅ [PWA] ServiceWorker 註冊成功，Scope: ', reg.scope);
          activateWaitingWorker(reg);
          reg.addEventListener('updatefound', function() {
            var newWorker = reg.installing;
            if (!newWorker) return;
            newWorker.addEventListener('statechange', function() {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                activateWaitingWorker(reg);
              }
            });
          });
          if (typeof reg.update === 'function') {
            reg.update().then(function() {
              activateWaitingWorker(reg);
            }).catch(function(err) {
              console.warn('⚠️ [PWA] ServiceWorker 更新檢查失敗: ', err);
            });
          }
        }).catch(function(err) {
          console.warn('❌ [PWA] ServiceWorker 註冊失敗: ', err);
        });
    });
  }

  // ============================================================
  //  🔐 安全混淆與加解密工具 (XOR)
  // ============================================================
  const OBFUSCATION_KEY = "LKC-Secure-2026";
  const ENC_PREFIX = "enc_";

  window.encryptGroupCode = function(str) {
    const safeStr = String(str || "");
    if (!safeStr) return "";
    if (safeStr.indexOf(ENC_PREFIX) === 0) return safeStr;
    try {
      var hex = "";
      for (var i = 0; i < safeStr.length; i++) {
        var charCode = safeStr.charCodeAt(i);
        var encCharCode = charCode ^ OBFUSCATION_KEY.charCodeAt(i % OBFUSCATION_KEY.length);
        var hexPart = encCharCode.toString(16);
        if (hexPart.length < 2) hexPart = "0" + hexPart;
        hex += hexPart;
      }
      return ENC_PREFIX + hex;
    } catch (e) {
      return safeStr;
    }
  };

  window.decryptGroupCode = function(str) {
    const safeStr = String(str || "");
    if (!safeStr) return "";
    if (safeStr.indexOf(ENC_PREFIX) !== 0) return safeStr;
    try {
      var hex = safeStr.substring(ENC_PREFIX.length);
      var plainText = "";
      for (var i = 0; i < hex.length; i += 2) {
        var charCode = parseInt(hex.substring(i, i + 2), 16);
        var decCharCode = charCode ^ OBFUSCATION_KEY.charCodeAt((i / 2) % OBFUSCATION_KEY.length);
        plainText += String.fromCharCode(decCharCode);
      }
      return plainText;
    } catch (e) {
      return safeStr;
    }
  };

  // ============================================================
  //  📖 經文格式自動標準化工具 (BibleFormatter)
  // ============================================================
  const BibleFormatter = (function() {
    const BIBLE_BOOKS = {
      "創": "創世記", "創世記": "創世記",
      "出": "出埃及記", "出埃及": "出埃及記", "出埃及記": "出埃及記",
      "利": "利未記", "利未": "利未記", "利未記": "利未記",
      "民": "民數記", "民數": "民數記", "民數記": "民數記",
      "申": "申命記", "申命": "申命記", "申命記": "申命記",
      "書": "約書亞記", "約書亞": "約書亞記", "約書亞記": "約書亞記",
      "士": "士師記", "士師": "士師記", "士師記": "士師記",
      "得": "路得記", "路得": "路得記", "路得記": "路得記",
      "撒上": "撒母耳記上", "撒母耳記上": "撒母耳記上", "撒記上": "撒母耳記上", "薩上": "撒母耳記上",
      "撒下": "撒母耳記下", "撒母耳記下": "撒母耳記下", "撒記下": "撒母耳記下", "薩下": "撒母耳記下",
      "王上": "列王紀上", "列王紀上": "列王紀上", "列王上": "列王紀上",
      "王下": "列王紀下", "列王紀下": "列王紀下", "列王下": "列王紀下",
      "代上": "歷代志上", "歷代志上": "歷代志上", "歷代上": "歷代志上",
      "代下": "歷代志下", "歷代志下": "歷代志下", "歷代下": "歷代志下",
      "拉": "以斯拉記", "以斯拉": "以斯拉記", "以斯拉記": "以斯拉記",
      "尼": "尼希米記", "尼希米": "尼希米記", "尼希米記": "尼希米記",
      "斯": "以斯帖記", "以斯帖": "以斯帖記", "以斯帖記": "以斯帖記",
      "伯": "約伯記", "約伯": "約伯記", "約伯記": "約伯記",
      "詩": "詩篇", "詩篇": "詩篇",
      "箴": "箴言", "箴言": "箴言",
      "傳": "傳道書", "傳道": "傳道書", "傳道書": "傳道書",
      "歌": "雅歌", "雅歌": "雅歌",
      "賽": "以賽亞書", "以賽亞": "以賽亞書", "以賽亞書": "以賽亞書",
      "耶": "耶利米書", "耶利米": "耶利米書", "耶利米書": "耶利米書",
      "哀": "耶利米哀歌", "耶利米哀歌": "耶利米哀歌", "哀歌": "耶利米哀歌",
      "結": "以西結書", "以西結": "以西結書", "以西結書": "以西結書",
      "但": "但以理書", "但以理": "但以理書", "但以理書": "但以理書",
      "何": "何西阿書", "何西阿": "何西阿書", "何西阿書": "何西阿書",
      "珥": "約珥書", "約珥": "約珥書", "約珥書": "約珥書",
      "摩": "阿摩司書", "阿摩司": "阿摩司書", "阿摩司書": "阿摩司書",
      "俄": "俄巴底亞書", "俄巴底亞": "俄巴底亞書", "俄巴底亞書": "俄巴底亞書",
      "拿": "約拿書", "約拿": "約拿書", "約拿書": "約拿書",
      "彌": "彌迦書", "彌迦": "彌迦書", "彌迦書": "彌迦書",
      "鴻": "那鴻書", "那鴻": "那鴻書", "那鴻書": "那鴻書",
      "哈": "哈巴谷書", "哈巴谷": "哈巴谷書", "哈巴谷書": "哈巴谷書",
      "番": "西番雅書", "西番雅": "西番雅書", "西番雅書": "西番雅書",
      "該": "哈該書", "該": "哈該書", "哈該書": "哈該書",
      "亞": "撒迦利亞書", "撒迦利亞": "撒迦利亞書", "撒迦利亞書": "撒迦利亞書",
      "瑪": "瑪拉基書", "瑪拉基": "瑪拉基書", "瑪拉基書": "瑪拉基書",

      "太": "馬太福音", "馬太": "馬太福音", "馬太福音": "馬太福音",
      "可": "馬可福音", "馬可": "馬可福音", "馬可福音": "馬可福音",
      "路": "路加福音", "路加": "路加福音", "路加福音": "路加福音",
      "約": "約翰福音", "約翰": "約翰福音", "約翰福音": "約翰福音",
      "徒": "使徒行傳", "使徒": "使徒行傳", "使徒行傳": "使徒行傳",
      "羅": "羅馬書", "羅馬": "羅馬書", "羅馬書": "羅馬書",
      "林前": "哥林多前書", "哥林多前書": "哥林多前書", "哥林多前": "哥林多前書",
      "林後": "哥林多後書", "哥林多後書": "哥林多後書", "哥林多後": "哥林多後書",
      "加": "加拉太書", "加拉太": "加拉太書", "加拉太書": "加拉太書",
      "弗": "以弗所書", "以弗所": "以弗所書", "以弗所書": "以弗所書",
      "腓": "腓立比書", "腓立比": "腓立比書", "腓立比書": "腓立比書",
      "西": "歌羅西書", "歌羅西": "歌羅西書", "歌羅西書": "歌羅西書",
      "帖前": "帖撒羅尼迦前書", "帖撒羅尼迦前書": "帖撒羅尼迦前書", "帖前書": "帖撒羅尼迦前書",
      "帖後": "帖撒羅尼迦後書", "帖撒羅尼迦後書": "帖撒羅尼迦後書", "帖後書": "帖撒羅尼迦後書",
      "提前": "提摩太前書", "提摩太前書": "提摩太前書", "提前書": "提摩太前書",
      "提後": "提摩太後書", "提摩太後書": "提摩太後書", "提後書": "提摩太後書",
      "多": "提多書", "多": "提多書", "提多書": "提多書",
      "門": "腓利門書", "腓利門": "腓利門書", "腓利門書": "腓利門書",
      "來": "希伯來書", "希伯來": "希伯來書", "希伯來書": "希伯來書",
      "雅": "雅各書", "雅各": "雅各書", "雅各書": "雅各書",
      "彼前": "彼得前書", "彼得前書": "彼得前書", "彼前書": "彼得前書",
      "彼後": "彼得後書", "彼得後書": "彼得後書", "彼後書": "彼得後書",
      "約壹": "約翰一書", "約壹書": "約翰一書", "約翰壹書": "約翰一書",
      "約一": "約翰一書", "約翰一書": "約翰一書", "約一書": "約翰一書",
      "約二": "約翰二書", "約翰二書": "約翰二書", "約二書": "約翰二書",
      "約三": "約翰三書", "約翰三書": "約翰三書", "約三書": "約翰三書",
      "猶": "猶大書", "猶大": "猶大書", "猶大書": "猶大書",
      "啟": "啟示錄", "啟示": "啟示錄", "啟示錄": "啟示錄"
    };

    function toHalfWidth(str) {
      if (!str) return '';
      return str.replace(/[\uFF01-\uFF5E]/g, function(char) {
        return String.fromCharCode(char.charCodeAt(0) - 0xfee0);
      }).replace(/\u3000/g, ' ');
    }

    function chineseToNumber(zhNum) {
      const charMap = {
        '零': 0, '〇': 0, '一': 1, '二': 2, '两': 2, '兩': 2, '三': 3, '四': 4,
        '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
        '廿': 20, '卅': 30, '卌': 40
      };
      zhNum = (zhNum || '').trim();
      if (!zhNum) return 0;
      if (/^\d+$/.test(zhNum)) return parseInt(zhNum, 10);

      let total = 0;
      let r = 0;
      for (let i = 0; i < zhNum.length; i++) {
        const char = zhNum[i];
        const val = charMap[char];
        if (val !== undefined) {
          if (val === 10) {
            if (r === 0) r = 1;
            total += r * 10;
            r = 0;
          } else if (val === 20 || val === 30 || val === 40) {
            total += val;
            r = 0;
          } else {
            r = val;
          }
        } else if (char === '百') {
          if (r === 0) r = 1;
          total += r * 100;
          r = 0;
        }
      }
      total += r;
      return total;
    }

    const bookRegexPart = Object.keys(BIBLE_BOOKS)
      .sort((a, b) => b.length - a.length)
      .map(k => k.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'))
      .join('|');
      
    const numClass = '[0-9０-９]+|[一二三四五六七八九十百廿卅卌]+';
    const scriptureRegex = new RegExp(
      '(' + bookRegexPart + ')\\s*(?:(' + numClass + ')(?:\\s*(?:章|:|：)\\s*|\\s+)(' + numClass + ')|([一二三四五六七八九十百廿卅卌]+)([0-9０-９]+))節?(?:\\s*(?:-|~|－|～|至|到)\\s*(' + numClass + ')節?(?![：:]))?',
      'g'
    );
    const chapSecRegex = new RegExp(
      '^\\s*(?:節\\s*)?\\s*(?:(' + numClass + ')(?:\\s*(?:章|:|：)\\s*|\\s+)(' + numClass + ')|([一二三四五六七八九十百廿卅卌]+)([0-9０-９]+))節?(?:\\s*(?:-|~|－|～|至|到)\\s*(' + numClass + ')節?(?![：:]))?\\s*$',
      'i'
    );

    function format(rawText) {
      if (!rawText) return '';
      const tokens = rawText.split(/([;；,，、\n\r]+)/);
      let currentBook = null;
      
      for (let i = 0; i < tokens.length; i += 2) {
        const token = tokens[i];
        if (!token) continue;
        
        const bookMatch = token.match(scriptureRegex);
        if (bookMatch) {
          const singleBookMatch = token.match(new RegExp('(' + bookRegexPart + ')'));
          if (singleBookMatch) {
            const bookName = singleBookMatch[1];
            currentBook = BIBLE_BOOKS[bookName] || bookName;
          }
          tokens[i] = token.replace(scriptureRegex, function(match, book, chapA, secA, chapB, secB, endSec) {
            const fullBook = BIBLE_BOOKS[book] || book;
            const chap = chapA || chapB;
            const sec = secA || secB;
            
            const chapNum = chineseToNumber(toHalfWidth(chap));
            const secNum = chineseToNumber(toHalfWidth(sec));
            
            let formatted = `${fullBook}${chapNum}:${secNum}`;
            if (endSec) {
              const endSecNum = chineseToNumber(toHalfWidth(endSec));
              formatted += `-${endSecNum}`;
            }
            return formatted;
          });
        } else if (currentBook) {
          const match = token.match(chapSecRegex);
          if (match) {
            const chap = match[1] || match[3];
            const sec = match[2] || match[4];
            const endSec = match[5];
            
            const chapNum = chineseToNumber(toHalfWidth(chap));
            const secNum = chineseToNumber(toHalfWidth(sec));
            
            let formatted = `${chapNum}:${secNum}`;
            if (endSec) {
              const endSecNum = chineseToNumber(toHalfWidth(endSec));
              formatted += `-${endSecNum}`;
            }
            
            const leadSpace = token.match(/^\s*/)[0];
            const trailSpace = token.match(/\s*$/)[0];
            tokens[i] = leadSpace + formatted + trailSpace;
          }
        }
      }
      return tokens.join('');
    }

    return { format, bookRegexPart, BIBLE_BOOKS };
  })();
  window.BibleFormatter = BibleFormatter;

  // 通知就緒（給可能等待的 ensureAPIReady listener）
  if (typeof document !== 'undefined') {
    document.dispatchEvent(new Event('churchAPIReady'));
  }
})();
