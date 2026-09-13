/**
 * 全域變數設定
 * ⚠️ 請把下面的 ID 換成你自己的試算表 ID
 */
const SPREADSHEET_ID = '1_za_qaOJBy-gS-q66hy1__a4F9GR6qazAbtqqIg4nbQ';
const MEMBER_SHEET = '會友名單';

/**
 * 小組系統 action 名稱集合（用於 doPost 路由判斷）
 * 與主日 action 名稱不重疊；新增小組功能時要同步更新此清單
 */
const _GROUP_ACTIONS = new Set([
  'getGroups', 'verifyGroup', 'createGroup', 'findGroupByCode',
  'checkGroupStatus', 'initGroup', 'submitAttendance', 'updateMemberList',
  'updateAttendanceRecord', 'deleteAttendanceRecord',
  'getStats', 'getAllGroupsStats', 'getAllGroupMembers', 'getAdminGroupsList',
  'updateGroupInfo', 'getWeeklyReport', 'getMemberSuggestions',
  'refreshGroupCaches', 'refreshAttendanceCaches',
  'happyGroup_conclude', 'happyGroup_delete', 'happyGroup_getArchives', 'happyGroup_getArchiveContent',
  'getDistrictsAndClusters', 'createDistrict', 'createGroupCluster', 'updateClusterGroups'
]);

/**
 * 統一的 doPost 入口點（三路由版）
 *  - 主日 actions：body = { action, payload }，回應 { data: result }
 *  - 小組 actions：body = { action, token, data }，回應 result（直接）
 *  - 事工 actions：以 'ministry_' 前綴，body = { action, token, data }，回應 result
 */
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);

    // 🛡️ 來源驗證（相容舊版快取瀏覽器：若無帶 clientOrigin 則僅 Log 警告，若帶了但非白名單則阻擋）
    const clientOrigin = body.clientOrigin;
    if (clientOrigin && typeof clientOrigin === 'string') {
      const originLower = clientOrigin.toLowerCase();
      const isAllowed = originLower.indexOf('jirehwang.github.io') !== -1 ||
                        originLower.indexOf('localhost') !== -1 ||
                        originLower.indexOf('127.0.0.1') !== -1;
      if (!isAllowed) {
        return ContentService
          .createTextOutput(JSON.stringify({ error: "Unauthorized: 非法請求來源" }))
          .setMimeType(ContentService.MimeType.JSON);
      }
    } else {
      Logger.log("⚠️ [警告] 請求未附帶 clientOrigin，請確認前端是否已更新。");
    }

    const action = body.action;

    // 🗓️ 行事曆分流
    if (typeof action === 'string' && (action.indexOf('cal_') === 0 || action === 'load' || action === 'save' || action === 'ai_parse')) {
      return _handleCalendarRequest(body);
    }
    // 🎵 敬拜團分流
    if (typeof action === 'string' && action.indexOf('worship_') === 0) {
      return _handleWorshipRequest(body);
    }
    // 💼 事工分流
    if (typeof action === 'string' && action.indexOf('ministry_') === 0) {
      return _handleMinistryRequest(body);
    }
    if (_GROUP_ACTIONS.has(action)) {
      return _handleGroupRequest(body);
    }
    return _handleAttendanceRequest(body);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Keep external response shapes unchanged while making GAS the only writer of
// Firebase cache entries. A failed write-through is recorded inside
// FirebaseSync and deliberately does not trigger another Sheet/GAS read.
function _captureServerCacheRevision(action) {
  try {
    return typeof firebaseCaptureCacheRevision === 'function'
      ? firebaseCaptureCacheRevision(action)
      : null;
  } catch (e) {
    // Cache metadata must never change the request path or API response.
    return null;
  }
}

function _respondWithServerCache(action, requestData, result, sourceRevision) {
  try {
    if (typeof firebaseCacheWriteThrough === 'function') {
      firebaseCacheWriteThrough(action, requestData || {}, result, sourceRevision);
    }
  } catch (e) {
    // Defensive only: cache ownership must never change the API contract.
    console.log('[firebase] write-through guard failed: ' + e.message);
  }
  return _groupResponseJSON(result);
}

/**
 * 事工管理路由處理（沿用 { action, token, data } 協定）
 *  - action 一律以 'ministry_' 前綴
 *  - 內部 dispatch 後直接呼叫 MinistryCore.js 的對應函式
 */
function _handleMinistryRequest(body) {
  const action = body.action;
  const token  = body.token;
  const data   = body.data || {};

  if (token !== SECRET_TOKEN) {
    return _groupResponseJSON({ success: false, message: "Unauthorized: 金鑰驗證失敗" });
  }

  const cacheRevision = _captureServerCacheRevision(action);
  let result;
  try {
    switch (action) {
      // 讀取
      case 'ministry_verifyPageId':
        result = { status: 'success', data: ministry_verifyPageId(data.id, data.code) };
        break;
      case 'ministry_getGroups':            result = { status: 'success', data: ministry_getGroups() }; break;
      case 'ministry_getTemplates':         result = { status: 'success', data: ministry_getTemplates() }; break;
      case 'ministry_getPageConfig':
        console.log("getPageConfig input data: " + JSON.stringify(data));
        result = { status: 'success', data: ministry_getPageConfig(data.id, data.autoCreate) };
        break;
      case 'ministry_getAggregatedReport':  result = { status: 'success', data: ministry_getAggregatedReport(data.type) }; break;
      case 'ministry_getDistrictsAndClusters': {
        const r = handleHierarchyAction('getDistrictsAndClusters', data);
        if (r.success) {
          result = { status: 'success', data: r };
        } else {
          result = { status: 'error', message: r.message || '伺服器錯誤' };
        }
        break;
      }


      // 寫入
      case 'ministry_saveSheetData':        result = { status: 'success', message: ministry_saveSheetData(data) }; break;
      case 'ministry_savePageFieldConfig':  result = { status: 'success', message: ministry_savePageFieldConfig(data).msg }; break;
      case 'ministry_updatePageInfo':       result = { status: 'success', data: ministry_updatePageInfo(data) }; break;
      case 'ministry_createGroup':          result = { status: 'success', message: ministry_createGroup(data).msg }; break;
      case 'ministry_toggleGroupStatus':    result = { status: 'success', message: ministry_toggleGroupStatus(data).msg }; break;
      case 'ministry_saveGroupPrompt':      result = { status: 'success', message: ministry_saveGroupPrompt(data).msg }; break;
      case 'ministry_saveGroupMembers':     result = { status: 'success', message: ministry_saveGroupMembers(data).msg }; break;
      case 'ministry_saveSermonSettings':    result = { status: 'success', message: ministry_saveSermonSettings(data).msg }; break;
      case 'ministry_forceRefreshEvents':   result = { status: 'success', data: ministry_forceRefreshEvents() }; break;
      case 'ministry_refreshCaches':        result = { status: 'success', data: ministry_refreshCaches() }; break;

      // AI
      case 'ministry_parseWithAI':          result = { status: 'success', data: ministry_parseWithAI(data) }; break;
      case 'ministry_proofreadFields':     result = { status: 'success', data: ministry_proofreadFields(data) }; break;

      // 小組成員身分管理（橋接到小組系統）
      case 'ministry_getGroupMembers':
        result = { status: 'success', data: ministry_getGroupMembersForRoleEdit(data.groupName) };
        break;
      case 'ministry_updateGroupMemberRoles': {
        const r = ministry_updateGroupMemberRoles(data.groupName, data.members);
        result = r.success
          ? { status: 'success', message: r.message }
          : { status: 'error', message: r.message };
        break;
      }

      default:
        result = { status: 'error', message: '未知事工操作: ' + action };
    }
  } catch (err) {
    result = { status: 'error', message: err.toString() };
  }
  return _respondWithServerCache(action, data, result, cacheRevision);
}

/**
 * 主日點名系統的請求處理（沿用原有協定 { action, payload }）
 */
function _handleAttendanceRequest(body) {
  const action = body.action;
  const payload = body.payload;

  const cacheRevision = _captureServerCacheRevision(action);
  let result;

  switch (action) {
    // ===== 會友管理 =====
    case 'getAllMembers':
      result = getAllMembers(); break;
    case 'getMemberManagementData':
      result = getMemberManagementData(); break;
    case 'getAllAttendanceHistory':
      result = getAllAttendanceHistory(); break;
    case 'updateMember':
      result = updateMember(payload.oldName || payload[0], payload.newData || payload[1]); break;
    case 'deleteMember':
      result = deleteMember(payload.name || payload); break;
    case 'addMember':
      result = addMember(payload); break;
    case 'previewMemberCard':
      result = previewMemberCard(payload); break;
    case 'generateMemberCard':
      result = generateMemberCard(payload); break;

    // ===== 點名系統 =====
    case 'getGroupConfig':
      result = getGroupConfig(); break;
    case 'getSmartAttendanceList':
      result = getSmartAttendanceList(payload.type || payload[0], payload.userId || payload[1], payload.date || payload[2]); break;
    case 'syncClickToServer':
      result = syncClickToServer(payload.name || payload[0], payload.isChecked || payload[1], payload.type || payload[2], payload.userId || payload[3]); break;
    case 'saveAttendance':
      result = saveAttendance(payload.date || payload[0], payload.presentList || payload[1], payload.type || payload[2], payload.nfMale || payload[3], payload.nfFemale || payload[4]); break;
    case 'revokeAttendance':
      result = revokeAttendance(payload.name || payload[0], payload.type || payload[1], payload.userId || payload[2], payload.date || payload[3]); break;
    case 'createAttendanceGroup':
      result = createAttendanceGroup(payload.category || payload[0], payload.groupName || payload[1]); break;
    case 'updateDeviceMode':
      result = updateDeviceMode(payload.userId || payload[0], payload.mode || payload[1]); break;
    case 'getQuickSyncData':
      result = getQuickSyncData(payload.type || payload[0], payload.userId || payload[1], payload.date || payload[2]); break;

    // ===== 統計查詢 =====
    case 'getAttendanceStats':
      result = getAttendanceStats(payload); break;
    case 'getAttendanceTrend':
      result = getAttendanceTrend(payload); break;

    // ===== 趨勢分析 =====
    case 'getCategoryChartData':
      result = getCategoryChartData(payload.category || payload[0], payload.startDate || payload[1], payload.endDate || payload[2]); break;

    default:
      throw new Error('未知操作：' + action);
  }

  return _respondWithServerCache(action, body.data || payload || {}, { data: result }, cacheRevision);
}

/**
 * 小組點名系統的請求處理（沿用原有協定 { action, token, data }）
 *  - 強制 token 驗證（與原 小組_GAS 一致）
 *  - 回應為 result 物件本身（不額外包 { data: ... }）
 */
function _handleGroupRequest(body) {
  const action = body.action;
  const token  = body.token;
  const data   = body.data || {};

  // 🛡️ Token 驗證
  if (token !== SECRET_TOKEN) {
    return _groupResponseJSON({ success: false, message: "Unauthorized: 金鑰驗證失敗" });
  }

  const cacheRevision = _captureServerCacheRevision(action);
  let result;

  switch (action) {
    case 'getGroups':                result = getGroups(); break;
    case 'refreshGroupCaches':        result = refreshGroupCaches(); break;
    case 'refreshAttendanceCaches':   result = refreshAttendanceCaches(); break;
    case 'verifyGroup':
      var verifyRes = verifyGroup(data.groupName, data.groupCode);
      if (verifyRes.success && !verifyRes.encryptedCode) {
        verifyRes.encryptedCode = encryptGroupCode(data.groupCode);
      }
      result = verifyRes;
      break;
    case 'createGroup': {
      result = handleCreateGroupWithHierarchy(data);
      break;
    }
    case 'findGroupByCode':          result = findGroupByCode(data.groupCode); break;
    case 'checkGroupStatus':         result = checkGroupStatus(data.groupName); break;
    case 'initGroup':                result = initGroup(data.groupName, data.members); break;
    case 'submitAttendance':         result = submitAttendance(data.groupName, data.date, data.present, data.absent, data.newFriends); break;
    case 'updateMemberList':         result = updateMemberList(data.groupName, data.members); break;
    case 'updateAttendanceRecord':   result = updateAttendanceRecord(data.groupName, data.originalDate, data.newDate, data.present, data.absent, data.newFriends); break;
    case 'deleteAttendanceRecord':   result = deleteAttendanceRecord(data.groupName, data.originalDate); break;

    case 'getStats':                 result = getStats(data.groupName, data.groupCode, data.startDate, data.endDate); break;

    case 'getAllGroupsStats': {
      // 嚴格比對最高權限密碼
      const checkAdminCode = String(data.groupCode || data.authCode || "").trim();
      if (checkAdminCode !== ADMIN_CODE) {
        return _groupResponseJSON({ success: false, message: "無權限存取全小組統計" });
      }
      result = getAllGroupsStats(data.startDate, data.endDate);
      break;
    }

    case 'getAllGroupMembers':       result = getAllGroupMembers(data.authCode || data.groupCode); break;
    case 'getMemberSuggestions':     result = getMemberSuggestions(); break;
    case 'getAdminGroupsList': {
      result = enrichAdminGroupsListWithHierarchy(getAdminGroupsList(data.authCode || data.groupCode), data.authCode || data.groupCode);
      break;
    }
    case 'updateGroupInfo': {
      result = updateGroupInfo(data.uuid, data.oldName, data.newName, data.newCode, data.newStatus);
      if (result && result.success) {
        writeGroupHierarchyFields(data.uuid, data.districtUuid, data.clusterUuid);
      }
      break;
    }
    case 'getWeeklyReport':          result = getWeeklyReport(data); break;

    case 'happyGroup_conclude':      result = happyGroup_conclude(data.groupName, data.bestToUpgrade, data.authCode); break;
    case 'happyGroup_delete':        result = happyGroup_delete(data.groupName, data.authCode); break;
    case 'happyGroup_getArchives':   result = happyGroup_getArchives(); break;
    case 'happyGroup_getArchiveContent': result = happyGroup_getArchiveContent(data.fileId); break;

    // ===== 牧區與小組群 =====
    case 'getDistrictsAndClusters':
    case 'createDistrict':
    case 'createGroupCluster':
    case 'updateClusterGroups':
      result = handleHierarchyAction(action, data);
      break;

    default:
      result = { success: false, message: '未知小組操作: ' + action };
  }

  return _respondWithServerCache(action, data, result, cacheRevision);
}

/**
 * doGet：處理 QR 掃描請求（保留原有功能）
 */
function doGet(e) {
  try {
    const action = e.parameter.action;
    const cat = e.parameter.cat;
    const grp = e.parameter.grp;

    // 1. 處理 QR 掃描點名請求
    if (action === 'syncClickToServer') {
      const result = handleQrScanRequest(e);
      return ContentService.createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // 2. 處理場次跳轉請求（手機掃描場次 QR Code）
    if (cat && grp) {
      // 測試區前端路徑（GitHub Pages 上的 LKC_SundayserviceAttendance 子資料夾）
      const githubUrl = "https://jirehwang.github.io/LKC1958_June_1.github.io/apps/LKC_SundayserviceAttendance/";
      const redirectUrl = githubUrl + "?cat=" + encodeURIComponent(cat) + "&grp=" + encodeURIComponent(grp);
      
      return HtmlService.createHtmlOutput(
        '<meta http-equiv="refresh" content="0; URL=' + redirectUrl + '">'
      )
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    }

    // 3. 其他請求
    return ContentService.createTextOutput(JSON.stringify({ status: "ok" }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * 取得試算表實例
 */
function getSS() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

/**
 * 引入 HTML 檔案（保留舊有支援）
 */
function include(filename) {
  try {
    return HtmlService.createHtmlOutputFromFile(filename).getContent();
  } catch (err) {
    return '';
  }
}

/**
 * 教會行事曆路由處理
 */
function _handleCalendarRequest(body) {
  const action = body.action;
  const token  = body.token;
  const data   = body.data || {};

  if (token !== SECRET_TOKEN) {
    return _groupResponseJSON({ success: false, message: "Unauthorized: 金鑰驗證失敗" });
  }

  const cacheRevision = _captureServerCacheRevision(action);
  let result = {};
  try {
    switch (action) {
      // 1. 載入資料
      case 'load':
        result = { success: true, events: loadEvents() };
        break;

      // 2. 儲存資料
      case 'save':
        saveEvents(data);
        result = { success: true, message: '雲端資料已成功儲存' };
        break;
      
      // 3. 處理 AI 講道解析
      case 'ai_parse':
        const aiParseResult = callGeminiApi(data.prompt, data.rawText);
        result = { success: true, result: aiParseResult };
        break;

      // ─── Phase 1：新版事項類型 / 欄位 ───
      case 'cal_setupSchema':         result = cal_setupSchema(); break;
      case 'cal_migrateOldData':      result = cal_migrateOldData(); break;
      case 'cal_clearNewData':        result = cal_clearNewData(); break;

      case 'cal_getTypes':            result = { success: true, data: cal_getTypes() }; break;
      case 'cal_addType':             result = cal_addType(data); break;
      case 'cal_updateType':          result = cal_updateType(data); break;
      case 'cal_deleteType':          result = cal_deleteType(data); break;
      case 'cal_verifyTypePassword':  result = cal_verifyTypePassword(data); break;

      case 'cal_getFields':           result = { success: true, data: cal_getFields(data) }; break;
      case 'cal_addField':            result = cal_addField(data); break;
      case 'cal_updateField':         result = cal_updateField(data); break;
      case 'cal_deleteField':         result = cal_deleteField(data); break;
      case 'cal_reorderFields':       result = cal_reorderFields(data); break;

      // ─── Phase 2：事項 CRUD ───
      case 'cal_getEvents':           result = { success: true, data: cal_getEvents(data) }; break;
      case 'cal_getEvent':            result = { success: true, data: cal_getEvent(data) }; break;
      case 'cal_addEvent':            result = cal_addEvent(data); break;
      case 'cal_updateEvent':         result = cal_updateEvent(data); break;
      case 'cal_deleteEvent':         result = cal_deleteEvent(data); break;

      // ─── Phase 2.5：批量 + AI ───
      case 'cal_addEventsBatch':      result = cal_addEventsBatch(data); break;
      case 'cal_aiParseForType':      result = cal_aiParseForType(data); break;
      case 'cal_parsePrayerImage':    result = cal_parsePrayerImage(data); break;

      // ─── FHL Bible API ───
      case 'cal_queryBible':          result = cal_queryBible(data); break;

      default:
        result = { success: false, message: '後端行事曆未定義此操作: ' + action };
    }
  } catch (error) {
    result = { success: false, message: "後端行事曆錯誤: " + error.toString() };
  }
  return _respondWithServerCache(action, data, result, cacheRevision);
}

/**
 * 敬拜團路由處理
 */
function _handleWorshipRequest(body) {
  const actionWithPrefix = body.action;
  const token  = body.token;
  const data   = body.data || {};

  if (token !== SECRET_TOKEN) {
    return _groupResponseJSON({ success: false, message: "Unauthorized: 金鑰驗證失敗" });
  }

  const cacheRevision = _captureServerCacheRevision(actionWithPrefix);
  // 移除 'worship_' 前綴，使之適應敬拜團原有的 switch-case 邏輯
  const action = actionWithPrefix.replace(/^worship_/, '');

  let response;
  try {
    switch(action) {
      case 'getSchedule':
        response = { status: 'success', data: getMergedSchedule(data.year, data.quarter) };
        break;

      case 'getScheduleByDateRange':
        response = getScheduleByDateRange(data); 
        break;

      case 'saveSchedule':
        response = saveScheduleData(data.scheduleData);
        break;

      case 'getPositions':
        response = { status: 'success', data: getPositions() };
        break;

      case 'savePositions':
        response = { status: 'success', data: savePositions(data.positionsData) };
        break;

      case 'getSongs':
        response = getSongs(data);
        break;

      case 'saveSongs':
        response = saveSongs(data);
        break;

      case 'getMemberSuggestions':
        response = { status: 'success', data: worship_getMemberSuggestions() };
        break;

      case 'getTeamMembers':
        response = { status: 'success', data: getTeamMembers() };
        break;

      case 'saveTeamMembers':
        response = saveTeamMembers(data.members);
        response.status = 'success';
        break;

      case 'getCalendarLinkConfig':
        response = { status: 'success', data: getCalendarLinkConfig() };
        break;

      case 'getScheduleDates':
        response = { status: 'success', data: getScheduleDates() };
        break;

      case 'setDefaultSermonSubType':
        response = setDefaultSermonSubType(data);
        response.status = response.success ? 'success' : 'error';
        break;

      case 'setDateOverride':
        response = setDateOverride(data);
        response.status = response.success ? 'success' : 'error';
        break;

      case 'getCalendarDataForDates':
        response = { status: 'success', data: getCalendarDataForDates(data) };
        break;

      case 'clearCalendarLinkCache':
        response = clearCalendarLinkCache();
        response.status = 'success';
        break;

      case 'refreshCaches':
        response = worship_refreshCaches();
        response.status = response.success ? 'success' : 'error';
        break;

      default:
        response = { status: 'error', message: '後端敬拜團未定義此操作: ' + action };
    }
  } catch (error) {
    response = { status: 'error', message: error.toString() };
  }
  return _respondWithServerCache(actionWithPrefix, data, response, cacheRevision);
}

/**
 * AI 圖片辨識手寫禱告項目 (呼叫 Gemini Vision API)
 */
function cal_parsePrayerImage(data) {
  const apiKey = _getGeminiApiKey();
  const model = _getGeminiModel();
  if (!apiKey) {
    throw new Error("未設定 GEMINI_API_KEY，請至主專案指令碼屬性設定。");
  }

  const mimeType = data.mimeType || 'image/jpeg';
  const base64Data = data.base64Data;
  if (!base64Data) {
    throw new Error("未接收到有效的圖片數據！");
  }

  const apiUrl = "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent?key=" + apiKey;

  const systemPrompt = "你是一個專業的林口長老教會助理。請仔細辨識這張手寫禱告會草稿圖片中的所有中文與英文文字，並將其整理成結構化的純文字格式。\n" +
                       "請以條列式輸出，格式如下：\n" +
                       "1. 請安靜心、等候神\n" +
                       "請放下身心重擔...\n" +
                       "\n" +
                       "3. 經文 (台語漢字)\n" +
                       "羅 8:26\n" +
                       "\n" +
                       "4. 獻上感謝讚美的 pray.\n" +
                       "a. 讚美上帝的美好...\n" +
                       "\n" +
                       "請務必保留原本的編號與標題，不要添加任何 Markdown 標籤（如 ```）或多餘的說明文字。直接回傳純文字內容即可。";

  const requestBody = {
    contents: [{
      parts: [
        { text: systemPrompt },
        {
          inlineData: {
            mimeType: mimeType,
            data: base64Data
          }
        }
      ]
    }]
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(requestBody),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(apiUrl, options);
  const respCode = response.getResponseCode();
  const respText = response.getContentText();

  if (respCode !== 200) {
    throw new Error("Gemini API 回傳錯誤 (" + respCode + "): " + respText);
  }

  const resJson = JSON.parse(respText);
  const extractedText = resJson.candidates[0].content.parts[0].text.trim();
  return { success: true, text: extractedText };
}
