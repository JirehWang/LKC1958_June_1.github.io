/**
 * AttendanceDB.js — 主日點名核心
 *
 * 整合方案 C 後的設計：
 *   - 點名紀錄與 SYNC_TEMP 一律以 UID（系統編號）存取
 *   - 透過 parseAttendanceList 自動相容舊有「姓名(性別)」格式（會自動反查 UID）
 *   - 性別、姓名等顯示資料一律由會友名單 cache 動態解析
 */

/**
 * 1. 取得智慧名單（給點名 UI）
 * 回傳每位會友：id (UID), name, gender, count, isChecked, isSubmitted, operatorId
 */
function getSmartAttendanceList(type, userId, dateStr) {
  const ss = getSS();
  try {
    const members = getCachedMembers();
    const todayStr = dateStr || Utilities.formatDate(new Date(), "GMT+8", "yyyy/M/d");

    // 今日已送出的 UID 集合（從 sheet 解析）
    const attInfo = getTodayAttendanceInfo(ss, type, todayStr);
    const submittedUidSet = new Set(attInfo.uids);

    // 90 天出席計數，key = UID
    const attendanceMap = getAttendanceCountMap(ss, type);

    // SYNC_TEMP 跨裝置點選暫存，key = UID
    const syncTempData = getSyncTempData(ss, type);

    let activeList = [], excludedNames = [];

    members.forEach(row => {
      const name = row[0] ? row[0].toString().trim() : "";
      if (!name) return;
      const memberUid = row[7] ? row[7].toString().trim() : "";

      if (row[4] === true || row[4] === "TRUE") {
        excludedNames.push(name);
        return;
      }

      const isSubmitted = memberUid && submittedUidSet.has(memberUid);
      const temp = (memberUid && syncTempData[memberUid]) || { checked: false, operatorId: "" };

      const dateStr = row[2] ? row[2].toString().replace(/\//g, "-") : "";
      const createDate = dateStr ? new Date(dateStr).getTime() : 0;

      activeList.push({
        id: memberUid,
        name: name,
        gender: row[1] || "未知",
        createDate: createDate,
        count: (memberUid && attendanceMap[memberUid]) || 0,
       isChecked: isSubmitted || temp.checked,
       isSubmitted: isSubmitted,
       operatorId: temp.operatorId,
       pendingSource: temp.source || 'manual',
       pendingOwnerId: temp.ownerId || temp.operatorId || '',
       pendingRevision: Number(temp.revision || 0),
       pendingLockedUntil: Number(temp.lockedUntil || 0),
       pendingExpiresAt: Number(temp.expiresAt || 0)
      });
    });

    activeList.sort((a, b) => (b.count - a.count) || (b.createDate - a.createDate));
    return { activeList, excludedNames, nfMale: attInfo.nfMale, nfFemale: attInfo.nfFemale };
  } catch (e) {
    throw new Error(e.toString());
  }
}

/**
 * 2. 輕量化輪詢（與 1. 同邏輯）
 */
function getQuickSyncData(type, userId, dateStr) {
  return getSmartAttendanceList(type, userId, dateStr);
}

/**
 * 3. 同步點選暫存到 SYNC_TEMP
 *    nameOrUid 可接受姓名或 UID，後端統一轉成 UID 儲存
 */
function syncClickToServer(nameOrUid, isChecked, type, userId) {
  const ss = getSS();
  let sheet = ss.getSheetByName("SYNC_TEMP") || ss.insertSheet("SYNC_TEMP");
  if (sheet.getLastRow() === 0) sheet.appendRow(["UID", "狀態", "類別", "時間", "操作者"]);

  // 統一轉成 UID
  const lookups = getMemberLookups();
  const cleaned = String(nameOrUid).split('(')[0].trim();
  const uid = /^LK\d+$/i.test(cleaned) ? cleaned.toUpperCase() : (lookups.n2u[cleaned] || cleaned);

  const data = sheet.getDataRange().getValues();
  let foundRow = -1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === uid && data[i][2] === type) { foundRow = i + 1; break; }
  }
  if (isChecked) {
    if (foundRow !== -1) {
      sheet.getRange(foundRow, 2, 1, 4).setValues([["checked", type, new Date(), userId]]);
    } else {
      sheet.appendRow([uid, "checked", type, new Date(), userId]);
    }
  } else if (foundRow !== -1) {
    sheet.deleteRow(foundRow);
  }
  return "OK";
}

/**
 * 4. 撤銷已送出名單
 *    nameOrUid 接受姓名或 UID
 */
function revokeAttendance(nameOrUid, type, userId, dateStr) {
  const ss = getSS();
  const todayStr = dateStr || Utilities.formatDate(new Date(), "GMT+8", "yyyy/M/d");
  const sheet = ss.getSheetByName(type + "點名紀錄");
  if (!sheet) return "錯誤：找不到紀錄表";

  const lookups = getMemberLookups();
  const cleaned = String(nameOrUid).split('(')[0].trim();
  const targetUid = /^LK\d+$/i.test(cleaned) ? cleaned.toUpperCase() : (lookups.n2u[cleaned] || "");
  if (!targetUid) return "錯誤：找不到此會友的系統編號";

  const lastRow = sheet.getLastRow();
  let rowIndex = -1;
  let rowData = null;
  if (lastRow > 0) {
    const numRows = Math.min(30, lastRow);
    const startRow = lastRow - numRows + 1;
    const data = sheet.getRange(startRow, 1, numRows, 4).getValues();
    for (let i = data.length - 1; i >= 0; i--) {
      if (startRow + i === 1) continue;
      const d = (data[i][0] instanceof Date) ? Utilities.formatDate(data[i][0], "GMT+8", "yyyy/M/d") : data[i][0].toString();
      if (d === todayStr) { rowIndex = startRow + i; rowData = data[i]; break; }
    }
  }
  if (rowIndex !== -1) {
    let uidList = parseAttendanceList(rowData[1].toString());
    let newList = uidList.filter(u => u !== targetUid);
    const nfMale = Number(rowData[2] || 0);
    const nfFemale = Number(rowData[3] || 0);
    if (newList.length === 0 && nfMale === 0 && nfFemale === 0) {
      sheet.deleteRow(rowIndex);
    } else {
      sheet.getRange(rowIndex, 2).setValue(newList.join(", "));
    }
    firebaseInvalidate(['getAttendanceStats', 'getAttendanceTrend', 'getWeeklyReport', 'getStats', 'getAllGroupsStats']);
    return "OK";
  }
  return "找不到紀錄";
}

/**
 * 5. 正式送出點名
 *    presentList 可接受 UID 或 姓名(性別) 混合，自動正規化為純 UID 儲存
 */
function saveAttendance(date, presentList, type, nfMale, nfFemale) {
  const ss = getSS();
  const sheetName = type + "點名紀錄";
  let sheet = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);
  if (sheet.getLastRow() === 0) sheet.appendRow(["出席日", "名單", "新朋友(男)", "新朋友(女)"]);

  // 1. 正規化為純 UID 陣列
  const lookups = getMemberLookups();
  const incomingUids = (presentList || []).map(item => {
    const cleaned = String(item).split('(')[0].trim();
    if (/^LK\d+$/i.test(cleaned)) return cleaned.toUpperCase();
    return lookups.n2u[cleaned] || "";
  }).filter(u => u);

  // 2. 找今天的紀錄列
  const lastRow = sheet.getLastRow();
  let rowIndex = -1, existingListStr = "";
  if (lastRow > 1) {
    const numRows = Math.min(30, lastRow);
    const startRow = lastRow - numRows + 1;
    const data = sheet.getRange(startRow, 1, numRows, 2).getValues();
    for (let i = data.length - 1; i >= 0; i--) {
      if (startRow + i === 1) continue;
      const d = (data[i][0] instanceof Date) ? Utilities.formatDate(data[i][0], "GMT+8", "yyyy/M/d") : data[i][0];
      if (d === date) { rowIndex = startRow + i; existingListStr = data[i][1] || ""; break; }
    }
  }

  // 3. 合併（聯集）
  let finalUids;
  if (rowIndex !== -1 && existingListStr !== "") {
    const existingUids = parseAttendanceList(existingListStr);
    finalUids = Array.from(new Set([...existingUids, ...incomingUids]));
  } else {
    finalUids = Array.from(new Set(incomingUids));
  }
  const finalNames = finalUids.join(", ");

  const isEmptyRecord = (finalNames === "" && nfMale === 0 && nfFemale === 0);
  if (rowIndex !== -1) {
    if (isEmptyRecord) {
      sheet.deleteRow(rowIndex);
    } else {
      sheet.getRange(rowIndex, 2, 1, 3).setValues([[finalNames, nfMale, nfFemale]]);
    }
  } else {
    if (!isEmptyRecord) sheet.appendRow([date, finalNames, nfMale, nfFemale]);
  }
  clearTempAfterSubmit(type, finalUids);
  firebaseInvalidate(['getAttendanceStats', 'getAttendanceTrend', 'getWeeklyReport', 'getStats', 'getAllGroupsStats']);
  return isEmptyRecord ? `✅ 已清除當天空白紀錄` : `✅ 同步成功 (新朋友: 男 ${nfMale} 人, 女 ${nfFemale} 人)`;
}

/**
 * 6. 取得分類結構（快取優先）
 */
function getGroupConfig() {
  const ss = getSS();
  let listSheet = ss.getSheetByName("點名系統清單");
  if (!listSheet) {
    listSheet = ss.insertSheet("點名系統清單");
    listSheet.appendRow(["點名類別", "群組名稱"]);
    listSheet.getRange("A1:B1").setFontWeight("bold").setBackground("#f3f3f3");
    listSheet.setFrozenRows(1);
    const defaultData = [
      ["禮拜", "台語"], ["禮拜", "華語"], ["禮拜", "聯合"],
      ["主日學", "主日學A班"], ["主日學", "主日學B班"]
    ];
    listSheet.getRange(2, 1, defaultData.length, 2).setValues(defaultData);
    invalidateAndRebuildGroupConfigCache();
  }
  return getCachedGroupConfig();
}

/**
 * 7. 建立新群組
 */
function createAttendanceGroup(category, groupName) {
  if (!groupName || groupName.trim() === "") throw new Error("群組名稱不能為空！");
  const cleanName = groupName.trim();
  const sheetName = cleanName + "點名紀錄";
  const ss = getSS();
  if (ss.getSheetByName(sheetName)) throw new Error("⚠️ 建立失敗：[" + cleanName + "] 的分頁已經存在囉！");
  const newSheet = ss.insertSheet(sheetName);
  newSheet.appendRow(["日期", "點名單", "新朋友(男)", "新朋友(女)"]);
  newSheet.getRange("A1:D1").setFontWeight("bold").setBackground("#f3f3f3");
  newSheet.setFrozenRows(1);
  let listSheet = ss.getSheetByName("點名系統清單");
  if (!listSheet) { getGroupConfig(); listSheet = ss.getSheetByName("點名系統清單"); }
  const data = listSheet.getDataRange().getValues();
  let isExist = false;
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === category && data[i][1] === cleanName) { isExist = true; break; }
  }
  if (!isExist) listSheet.appendRow([category, cleanName]);
  const result = invalidateAndRebuildGroupConfigCache();
  firebaseInvalidate(['getGroupConfig']);
  return result;
}

// ==========================================
//  輔助函式
// ==========================================

/**
 * 取得今日點名資料：UID 列表 + 新朋友男女數
 * uids 已自動轉換（舊格式自動反查、新格式直接用）
 */
function getTodayAttendanceInfo(ss, type, todayStr) {
  const sheet = ss.getSheetByName(type + "點名紀錄");
  if (!sheet) return { uids: [], nfMale: 0, nfFemale: 0 };
  const lastRow = sheet.getLastRow();
  if (lastRow === 0) return { uids: [], nfMale: 0, nfFemale: 0 };
  const numRows = Math.min(30, lastRow);
  const startRow = lastRow - numRows + 1;
  const data = sheet.getRange(startRow, 1, numRows, 4).getValues();
  for (let i = data.length - 1; i >= 0; i--) {
    if (startRow + i === 1) continue;
    let d = (data[i][0] instanceof Date) ? Utilities.formatDate(data[i][0], "GMT+8", "yyyy/M/d") : data[i][0].toString();
    if (d === todayStr) {
      const uids = data[i][1] ? parseAttendanceList(data[i][1].toString()) : [];
      return { uids: uids, nfMale: Number(data[i][2] || 0), nfFemale: Number(data[i][3] || 0) };
    }
  }
  return { uids: [], nfMale: 0, nfFemale: 0 };
}

/** 從 SYNC_TEMP 讀跨裝置點選暫存（key = UID） */
function getSyncTempData(ss, type) {
  const tempSheet = ss.getSheetByName("SYNC_TEMP");
  const result = {};
  if (!tempSheet) return result;
  const data = tempSheet.getDataRange().getValues();
  const NOW = new Date().getTime();
  const lookups = getMemberLookups();
  for (let i = 1; i < data.length; i++) {
    if (data[i][2] === type) {
      const raw = String(data[i][0] || "").trim();
      const uid = /^LK\d+$/i.test(raw) ? raw.toUpperCase() : (lookups.n2u[raw] || raw);
      const updatedAt = new Date(data[i][3]).getTime();
      const lockedUntil = Number(data[i][7] || 0);
      const expiresAt = updatedAt + 6 * 60 * 60 * 1000;
      const isExpired = expiresAt <= NOW;
      result[uid] = {
        checked: !isExpired && data[i][1] === "checked",
        operatorId: isExpired ? "" : data[i][4],
        source: String(data[i][5] || 'manual').trim() === 'qr' ? 'qr' : 'manual',
        ownerId: isExpired ? '' : String(data[i][8] || data[i][4] || '').trim(),
        revision: Number(data[i][6] || 0),
        lockedUntil: lockedUntil,
        expiresAt: expiresAt
      };
    }
  }
  return result;
}

/** 送出點名後清除 SYNC_TEMP 中對應的暫存（uids 為已送出的 UID 陣列） */
function clearTempAfterSubmit(type, uids) {
  const ss = getSS();
  const sheet = ss.getSheetByName("SYNC_TEMP");
  if (!sheet) return;
  const data = sheet.getDataRange().getValues();
  const uidSet = new Set(uids);
  const lookups = getMemberLookups();
  for (let i = data.length - 1; i >= 1; i--) {
    if (data[i][2] === type) {
      const raw = String(data[i][0] || "").trim();
      const uid = /^LK\d+$/i.test(raw) ? raw.toUpperCase() : (lookups.n2u[raw] || raw);
      if (uidSet.has(uid)) sheet.deleteRow(i + 1);
    }
  }
}

/**
 * 90 天出席計數（key = UID）
 * 自動相容舊「姓名(性別)」格式
 */
function getAttendanceCountMap(ss, type) {
  const cache = CacheService.getScriptCache();
  const todayDateStr = Utilities.formatDate(new Date(), "GMT+8", "yyyyMMdd");
  const cacheKey = "ATT_MAP_" + type + "_" + todayDateStr;
  const cachedData = cache.get(cacheKey);
  if (cachedData) return JSON.parse(cachedData);
  const counts = {};
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 90);
  const cutoffTime = cutoffDate.getTime();
  let targetSheets = (type === '聯合') ? ["台語點名紀錄", "華語點名紀錄", "聯合點名紀錄"] : [type + "點名紀錄"];
  targetSheets.forEach(sheetName => {
    const sh = ss.getSheetByName(sheetName);
    if (!sh) return;
    const data = sh.getDataRange().getValues();
    if (data.length <= 1) return;
    data.slice(1).forEach(row => {
      if (row[0] instanceof Date && row[0].getTime() >= cutoffTime && row[1]) {
        parseAttendanceList(row[1].toString()).forEach(uid => {
          counts[uid] = (counts[uid] || 0) + 1;
        });
      }
    });
  });
  cache.put(cacheKey, JSON.stringify(counts), 21600);
  return counts;
}

/**
 * 取得線上所有點名紀錄表的歷史出席數據（供全量審計與 Supabase 同步）
 */
function getAllAttendanceHistory() {
  const ss = getSS();
  const sheets = ['台語點名紀錄', '華語點名紀錄', '聯合點名紀錄', '主日學A班點名紀錄', '主日學B班點名紀錄', '禱告會點名紀錄'];
  const allRecords = [];
  const allUids = {};
  const memberCounts = {};

  sheets.forEach(function(sName) {
    const sh = ss.getSheetByName(sName);
    if (!sh) return;
    const data = sh.getDataRange().getValues();
    const serviceType = sName.replace('點名紀錄', '');

    for (let r = 1; r < data.length; r++) {
      const dVal = data[r][0];
      if (!dVal) continue;
      let dStr = '';
      if (dVal instanceof Date) {
        dStr = Utilities.formatDate(dVal, "GMT+8", "yyyy-MM-dd");
      } else {
        const dMatch = String(dVal).match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
        if (dMatch) {
          dStr = dMatch[1] + '-' + ('0' + dMatch[2]).slice(-2) + '-' + ('0' + dMatch[3]).slice(-2);
        } else {
          dStr = String(dVal).trim();
        }
      }
      if (!dStr) continue;

      const listStr = data[r][1] ? data[r][1].toString() : '';
      const nfMale = Number(data[r][2] || 0);
      const nfFemale = Number(data[r][3] || 0);
      const uids = parseAttendanceList(listStr);

      uids.forEach(function(u) {
        allUids[u] = true;
        memberCounts[u] = (memberCounts[u] || 0) + 1;
      });

      if (uids.length > 0 || nfMale > 0 || nfFemale > 0) {
        allRecords.push({
          service_type: serviceType,
          date: dStr,
          present_uids: uids,
          new_friends_male: nfMale,
          new_friends_female: nfFemale,
          raw_list_str: listStr
        });
      }
    }
  });

  return {
    recordsCount: allRecords.length,
    uniqueUids: Object.keys(allUids),
    memberCounts: memberCounts,
    records: allRecords
  };
}
