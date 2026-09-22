/**
 * GroupStatistics.js — 小組統計與彙整（整合版）
 *
 * 與原 小組點名_測試版/Statistics.js 相比的關鍵變化：
 *  ❌ 原 SUNDAY_SPREADSHEET_ID 寫死指向 production → ✅ 改用 getSS()
 *      （同 GAS 內，直接讀本專案的主日試算表，省下一次跨 SS openById 成本）
 *  ❌ getSheetSafely / getSs → ✅ getGroupSheet / getGroupSS（小組資料）
 *  ❌ findGroupByCode / verifyGroup 已存在於 GroupCore.js，此處不再重複定義
 *  🔧 helper 函式以 _grp 前綴，避免與其他模組名稱衝突
 */

// 萬用分隔符號：非中英數字也非空白的字元一律視為分隔
const _GRP_SPLIT_REGEX = /[^一-龥a-zA-Z0-9\s]+/;

function _grpCleanName(rawName) {
  if (!rawName) return "";
  let name = rawName.toString().trim();
  name = name.replace(/\(男\)|\(女\)/g, "");
  name = name.replace(/\s+/g, "");
  return name;
}

/**
 * 把點名紀錄的「名單字串」解析為 UID Set
 * 自動相容：UID 直接用 / 姓名走 nameToUid 反查
 */
function _grpParseUidSet(listStr, lookups) {
  const set = new Set();
  if (!listStr) return set;
  String(listStr).split(_GRP_SPLIT_REGEX).forEach(part => {
    const item = part.trim();
    if (!item) return;
    if (/^LK\d+$/i.test(item)) {
      set.add(item.toUpperCase());
    } else {
      const cleaned = item.split('(')[0].trim();
      const uid = lookups.n2u[cleaned];
      if (uid) set.add(uid);
    }
  });
  return set;
}

/**
 * 從本 GAS 的主日試算表讀取點名紀錄，計算指定成員的出席天數
 * 改用 UID 比對：targetMembers 為 [{name, uid}] 物件陣列
 * 回傳 finalResult 以 name 為 key（向下相容）
 */
function _grpFetchSundayDataEngine(sDate, eDate, targetMembers) {
  const lookups = getMemberLookups();
  const uidByName = {};
  targetMembers.forEach(m => {
    if (typeof m === 'string') {
      const uid = lookups.n2u[m];
      if (uid) uidByName[m] = uid;
    } else if (m && m.name) {
      const uid = m.uid || lookups.n2u[m.name];
      if (uid) uidByName[m.name] = uid;
    }
  });

  const startStr = sDate
    ? Utilities.formatDate(sDate, "GMT+8", "yyyy/MM/dd")
    : "1900/01/01";
  const endExclusive = eDate ? new Date(eDate.getTime()) : null;
  if (endExclusive) endExclusive.setDate(endExclusive.getDate() + 1);
  const endStr = endExclusive
    ? Utilities.formatDate(endExclusive, "GMT+8", "yyyy/MM/dd")
    : "2999/12/31";

  const requestStats = (category, targetGroups) => getAttendanceStats({
    type: category + "合計",
    mode: "range",
    baseSheet: "會友名單",
    targetGroups,
    start: startStr,
    end: endStr
  });
  const worshipStats = requestStats("禮拜", ["台語", "華語", "聯合"]);
  const schoolStats = requestStats("主日學", ["主日學A班", "主日學B班"]);

  const indexDetails = stats => {
    const byUid = {};
    (stats && stats.details || []).forEach(detail => {
      const uid = String(detail.uid || "").trim().toUpperCase();
      if (uid) byUid[uid] = detail;
    });
    return byUid;
  };
  const worshipByUid = indexDetails(worshipStats);
  const schoolByUid = indexDetails(schoolStats);
  const sundayTotal = Number(worshipStats && worshipStats.validDays) || 0;
  const schoolTotal = Number(schoolStats && schoolStats.validDays) || 0;

  const finalResult = {};
  Object.keys(uidByName).forEach(name => {
    const uid = String(uidByName[name] || "").trim().toUpperCase();
    const worshipDetail = worshipByUid[uid];
    const schoolDetail = schoolByUid[uid];
    finalResult[name] = {
      sundayCount: Number(worshipDetail && worshipDetail.count) || 0,
      sundayTotal,
      schoolCount: Number(schoolDetail && schoolDetail.count) || 0,
      schoolTotal
    };
  });
  return finalResult;
}

/**
 * 取得單一小組統計（UID 化）
 *
 * 改造重點：
 *   - 成員從主日 cache 取（master 為單一真實來源）
 *   - 點名紀錄解析為 UID Set，比對改用 UID
 *   - RAW_MODE 額外回傳 nameDirectory 供前端反查（uid → name）
 */
function getStats(groupName, groupCode, startDate, endDate) {
  const decryptedCode = decryptGroupCode(groupCode).trim().toUpperCase();
  const isAdminCall = (decryptedCode === ADMIN_CODE);
  const isRawMode = (startDate === "RAW_MODE");

  if (!isAdminCall) {
    const verify = verifyGroup(groupName, groupCode);
    if (!verify.success) return { success: false, message: "權限不足" };
  }

  const rSheet = getGroupSheet(groupName + "_點名紀錄");
  if (!rSheet) return { success: false, message: "找不到紀錄" };

  const allValues = rSheet.getDataRange().getValues();
  const rows = allValues.slice(1);

  // RAW_MODE：原始資料 + 額外提供 uid→name 反查表
  if (isRawMode) {
    const lookups = getMemberLookups();
    return {
      success: true,
      groupName: groupName,
      isSingleDay: false,
      data: rows,
      nameDirectory: lookups.u2n  // { LK00001: "王小明", ... }
    };
  }

  // 從主日 cache 取此組成員（含 UID + 身分）
  const lookups = getMemberLookups();
  const allMembers = getCachedMembers();
  const groupMembersList = [];   // [{ name, uid, role }]
  const companionUidSet = new Set();
  const allUids = new Set();

  allMembers.forEach(m => {
    if (!memberInGroup(m[8], groupName)) return;
    const name = m[0] ? String(m[0]).trim() : "";
    const uid = m[7] ? String(m[7]).trim() : "";
    const role = getRoleForGroup(m[9], groupName);
    if (!name || !uid) return;
    groupMembersList.push({ name, uid, role });
    allUids.add(uid);
    if (role === "陪伴同工") companionUidSet.add(uid);
  });

  const sDate = startDate ? new Date(startDate) : null;
  const eDate = endDate ? new Date(endDate) : null;
  if (sDate) sDate.setHours(0, 0, 0, 0);
  if (eDate) eDate.setHours(23, 59, 59, 999);

  const filteredRows = rows.filter(row => {
    if (!row[0]) return false;
    const time = new Date(row[0]).getTime();
    if (sDate && time < sDate.getTime()) return false;
    if (eDate && time > eDate.getTime()) return false;
    return true;
  });

  const isSingleDay = (startDate === endDate && startDate !== "");
  const sundayData = _grpFetchSundayDataEngine(sDate, eDate, groupMembersList);

  if (isSingleDay) {
    if (filteredRows.length === 0) return { success: true, groupName: groupName, isSingleDay: true, data: [] };
    const row = filteredRows[0];
    const presentUidSet = _grpParseUidSet(row[1] || "", lookups);

    // 把當天有出席但目前已不在此組的人也補進清單（標記為「(歷史)」）
    presentUidSet.forEach(uid => {
      if (!groupMembersList.find(m => m.uid === uid)) {
        const name = lookups.u2n[uid] || uid;
        groupMembersList.push({ name, uid, role: "(歷史)" });
      }
    });

    const singleDayData = groupMembersList
      .filter(m => !companionUidSet.has(m.uid))
      .map(m => ({
        name: m.name,
        uid: m.uid,
        group: groupName,
        cell: presentUidSet.has(m.uid),
        sunday: sundayData[m.name] && sundayData[m.name].sundayCount > 0,
        school: sundayData[m.name] && sundayData[m.name].schoolCount > 0
      }));

    return { success: true, groupName: groupName, isSingleDay: true, data: singleDayData };
  }

  // 區間模式：累積每位 UID 的出席次數
  const totalCellSessions = filteredRows.length;
  const cellCounts = {}; // uid -> count
  allUids.forEach(u => cellCounts[u] = 0);

  // 「歷史曾出席但已離組」的 uid 也會列出（後續以 uid 反查名）
  const extraUids = new Set();

  filteredRows.forEach(row => {
    const presentSet = _grpParseUidSet(row[1] || "", lookups);
    presentSet.forEach(uid => {
      if (cellCounts.hasOwnProperty(uid)) {
        cellCounts[uid]++;
      } else {
        cellCounts[uid] = 1;
        extraUids.add(uid);
      }
    });
  });

  // 把 extraUids 也補進顯示
  extraUids.forEach(uid => {
    const name = lookups.u2n[uid] || uid;
    if (!groupMembersList.find(m => m.uid === uid)) {
      groupMembersList.push({ name, uid, role: "(歷史)" });
    }
    if (!sundayData[name]) sundayData[name] = { sundayCount: 0, sundayTotal: 0, schoolCount: 0, schoolTotal: 0 };
  });

  const intervalData = groupMembersList
    .filter(m => !companionUidSet.has(m.uid))
    .map(m => {
      const cCount = cellCounts[m.uid] || 0;
      const cTotal = totalCellSessions;
      const cRate = cTotal > 0 ? ((cCount / cTotal) * 100).toFixed(1) : 0;
      const sData = sundayData[m.name] || { sundayCount: 0, sundayTotal: 0, schoolCount: 0, schoolTotal: 0 };
      return {
        name: m.name,
        uid: m.uid,
        group: groupName,
        cellRate: cRate,
        cellStr: `${cCount}/${cTotal}`,
        sundayRate: sData.sundayTotal > 0 ? ((sData.sundayCount / sData.sundayTotal) * 100).toFixed(1) : 0,
        sundayStr: `${sData.sundayCount}/${sData.sundayTotal}`,
        schoolRate: sData.schoolTotal > 0 ? ((sData.schoolCount / sData.schoolTotal) * 100).toFixed(1) : 0,
        schoolStr: `${sData.schoolCount}/${sData.schoolTotal}`
      };
    });

  intervalData.sort((a, b) => parseFloat(b.cellRate) - parseFloat(a.cellRate));
  return { success: true, groupName: groupName, isSingleDay: false, data: intervalData };
}

/**
 * 最高權限：全小組彙整（UID 化）
 *  - 從主日 cache 取所有有所屬小組的會友
 *  - 對每組記錄解析 UID，計算每位會友在該組的出席率
 */
function getAllGroupsStats(startDate, endDate) {
  const ss = getGroupSS();
  const sheets = ss.getSheets();
  const allMembersData = [];

  const sLimit = startDate ? new Date(startDate) : null;
  const eLimit = endDate ? new Date(endDate) : null;
  if (sLimit) sLimit.setHours(0, 0, 0, 0);
  if (eLimit) eLimit.setHours(23, 59, 59, 999);

  const lookups = getMemberLookups();
  const allMembers = getCachedMembers();

  // group -> { uids: Set, companions: Set, members: [{name, uid}] }
  const groupMemberMap = {};
  allMembers.forEach(m => {
    const name = m[0] ? String(m[0]).trim() : "";
    const uid  = m[7] ? String(m[7]).trim() : "";
    const groups = parseGroupString(m[8]);
    if (!name || !uid || groups.length === 0) return;
    groups.forEach(g => {
      if (!groupMemberMap[g]) groupMemberMap[g] = { uids: new Set(), companions: new Set(), members: [] };
      groupMemberMap[g].uids.add(uid);
      groupMemberMap[g].members.push({ name, uid });
      const role = getRoleForGroup(m[9], g);
      if (role === "陪伴同工") groupMemberMap[g].companions.add(uid);
    });
  });

  // 解析每組的點名紀錄
  // gName -> { sessionDates: Set, attendCounts: { uid: count } }
  const groupStats = {};

  sheets.forEach(sheet => {
    const name = sheet.getName();
    if (!name.endsWith("_點名紀錄")) return;
    const gName = name.replace("_點名紀錄", "");
    const rows = sheet.getDataRange().getValues().slice(1);

    if (!groupStats[gName]) groupStats[gName] = { sessionDates: new Set(), attendCounts: {} };

    rows.forEach(row => {
      if (!row[0]) return;
      const time = new Date(row[0]).getTime();
      if (sLimit && time < sLimit.getTime()) return;
      if (eLimit && time > eLimit.getTime()) return;

      groupStats[gName].sessionDates.add(Utilities.formatDate(new Date(row[0]), "GMT+8", "yyyy-MM-dd"));
      const presentSet = _grpParseUidSet(row[1] || "", lookups);
      presentSet.forEach(uid => {
        groupStats[gName].attendCounts[uid] = (groupStats[gName].attendCounts[uid] || 0) + 1;
      });
    });
  });

  const isSingleDay = (startDate === endDate && startDate !== "");

  // 為每組的每位會友（master 名單 + 紀錄中出現過的 UID）產出統計
  Object.keys(groupMemberMap).forEach(gName => {
    const grpInfo = groupMemberMap[gName];
    const stats = groupStats[gName] || { sessionDates: new Set(), attendCounts: {} };
    const totalSessions = stats.sessionDates.size;

    // 列出所有要顯示的 UID：master 名單 + 紀錄出現的 UID
    const uidsToShow = new Set([...grpInfo.uids, ...Object.keys(stats.attendCounts)]);

    uidsToShow.forEach(uid => {
      if (grpInfo.companions.has(uid)) return; // 排除陪伴同工
      const cellCount = stats.attendCounts[uid] || 0;
      const memberObj = grpInfo.members.find(m => m.uid === uid);
      const displayName = memberObj ? memberObj.name : (lookups.u2n[uid] || uid);

      if (isSingleDay) {
        allMembersData.push({ name: displayName, uid: uid, group: gName, cell: cellCount > 0 });
      } else {
        const cRate = totalSessions > 0 ? ((cellCount / totalSessions) * 100).toFixed(1) : 0;
        allMembersData.push({
          name: displayName,
          uid: uid,
          group: gName,
          cellRate: cRate,
          cellStr: `${cellCount}/${totalSessions}`
        });
      }
    });
  });

  if (!isSingleDay) {
    allMembersData.sort((a, b) => {
      if (a.group !== b.group) return a.group.localeCompare(b.group);
      return parseFloat(b.cellRate) - parseFloat(a.cellRate);
    });
  }
  return { success: true, groupName: "ALL", isSingleDay: isSingleDay, data: allMembersData };
}

/**
 * 本週各小組聚會人數報表（公開，不需驗證）
 *  名單欄改用 _grpParseUidSet 計算去重後的 UID 數量
 */
function getWeeklyReport(data) {
  let sunday, saturday;

  if (data && data.startDate && data.endDate) {
    const startParts = String(data.startDate).split('-');
    const endParts = String(data.endDate).split('-');
    if (startParts.length === 3 && endParts.length === 3) {
      sunday = new Date(startParts[0], startParts[1] - 1, startParts[2], 0, 0, 0, 0);
      saturday = new Date(endParts[0], endParts[1] - 1, endParts[2], 23, 59, 59, 999);
    }
  }

  // Fallback if dates are missing or invalid
  if (!sunday || !saturday || isNaN(sunday.getTime()) || isNaN(saturday.getTime())) {
    const now = new Date();
    const day = now.getDay();

    sunday = new Date(now);
    sunday.setDate(now.getDate() - day);
    sunday.setHours(0, 0, 0, 0);

    saturday = new Date(sunday);
    saturday.setDate(sunday.getDate() + 6);
    saturday.setHours(23, 59, 59, 999);
  }

  const ss = getGroupSS();
  const sheets = ss.getSheets();
  const result = [];
  const lookups = getMemberLookups();

  sheets.forEach(sheet => {
    const name = sheet.getName();
    if (!name.endsWith("_點名紀錄")) return;

    const groupName = name.replace("_點名紀錄", "");
    const rows = sheet.getDataRange().getValues().slice(1);

    let totalPresent = 0;
    let totalNewFriends = 0;
    let sessionCount = 0;

    rows.forEach(row => {
      if (!row[0]) return;
      const time = new Date(row[0]).getTime();
      if (time < sunday.getTime() || time > saturday.getTime()) return;

      const presentSet = _grpParseUidSet(row[1] || "", lookups);
      // 新朋友仍是純文字
      const newFriendsArr = row[3] ? row[3].toString().split(_GRP_SPLIT_REGEX).map(s => _grpCleanName(s)).filter(n => n) : [];

      totalPresent += presentSet.size;
      totalNewFriends += newFriendsArr.length;
      sessionCount++;
    });

    if (sessionCount > 0) {
      result.push({
        groupName: groupName,
        sessionCount: sessionCount,
        present: totalPresent,
        newFriends: totalNewFriends,
        total: totalPresent + totalNewFriends
      });
    }
  });

  result.sort((a, b) => b.total - a.total);
  const dateRangeStr = Utilities.formatDate(sunday, "GMT+8", "M/d") + " ~ " + Utilities.formatDate(saturday, "GMT+8", "M/d");
  return { success: true, dateRange: dateRangeStr, data: result };
}
