/**
 * ReportService.js — 主日出席統計與報表
 *
 * 整合方案 C 後的設計：
 *   - 點名紀錄一律以 UID 儲存；用 parseAttendanceList 解析（自動相容舊姓名格式）
 *   - 性別統計改成從 UID 反查會友名單 cache，不再依賴記錄裡的 (男)/(女) 註記
 *   - getSmallGroupMembersList 直接從主日「所屬小組」欄判斷，省掉跨 SS 讀取
 */

/** 日期轉數字工具 (yyyymmdd 整數) */
function toDateNum(dateObj) {
  if (!dateObj) return 0;
  const d = new Date(dateObj);
  if (isNaN(d.getTime())) return 0;
  const y = d.getFullYear();
  const m = ("0" + (d.getMonth() + 1)).slice(-2);
  const day = ("0" + d.getDate()).slice(-2);
  return parseInt(y + m + day, 10);
}

/** 共用：依 UID 陣列 + lookups 算男女人數 */
function _countGendersByUids(uids, lookups) {
  let male = 0, female = 0;
  uids.forEach(uid => {
    const g = lookups.u2g[uid];
    if (g === '男') male++;
    else if (g === '女') female++;
  });
  return { male, female };
}

/** 統計主入口 */
function getAttendanceStats(req) {
  const ss = getSS();
  const type = req.type;
  const baseSheet = req.baseSheet || "會友名單";
  let data;

  if (type.indexOf('合計') !== -1) {
    const targetGroups = req.targetGroups || [];
    if (targetGroups.length === 0) return { presentCount: 0, newFriends: 0, nfMale: 0, nfFemale: 0, presentMale: 0, presentFemale: 0, details: [] };
    if (req.mode === 'single') data = _getCombinedSingleStats(ss, req.date, baseSheet, targetGroups);
    else data = _getCombinedRangeStats(ss, req.start, req.end, baseSheet, targetGroups);
  } else {
    if (req.mode === 'single') data = _getSingleDayStats(ss, type, req.date, baseSheet);
    else data = _getRangeStats(ss, type, req.start, req.end, baseSheet);
  }

  const groupMembersMap = getSmallGroupMembersList();
  if (data && data.details && data.details.length > 0) {
    data.details.forEach(row => { row.inGroup = !!groupMembersMap[row.name]; });
  }
  return data;
}

/**
 * 1. 單日統計
 */
function _getSingleDayStats(ss, type, dateStr, baseSheetName) {
  const targetDateNum = toDateNum(dateStr);
  const sheet = ss.getSheetByName(type + "點名紀錄");
  const result = { presentCount: 0, newFriends: 0, nfMale: 0, nfFemale: 0, presentMale: 0, presentFemale: 0, details: [] };
  if (!sheet) return result;

  const lookups = getMemberLookups();
  const data = sheet.getDataRange().getValues();
  let presentUidSet = new Set();
  for (let i = 1; i < data.length; i++) {
    if (toDateNum(data[i][0]) === targetDateNum) {
      const listStr = data[i][1] ? data[i][1].toString() : "";
      parseAttendanceList(listStr).forEach(u => presentUidSet.add(u));
      result.nfMale = Number(data[i][2] || 0);
      result.nfFemale = Number(data[i][3] || 0);
      break;
    }
  }
  // 性別從 cache 反查
  const g = _countGendersByUids([...presentUidSet], lookups);
  result.presentMale = g.male;
  result.presentFemale = g.female;
  result.presentCount = presentUidSet.size;
  result.newFriends = result.nfMale + result.nfFemale;

  // 詳細：以名單為基礎列出每人狀態
  const memberSheet = ss.getSheetByName(baseSheetName);
  if (!memberSheet) return result;
  const memData = memberSheet.getDataRange().getValues();
  const nameIdx = memData[0].indexOf("姓名");
  const genderIdx = memData[0].indexOf("性別");
  const excludeIdx = memData[0].indexOf("不列入統計");
  const uidIdx = memData[0].indexOf("系統編號");

  for (let i = 1; i < memData.length; i++) {
    const name = nameIdx !== -1 ? memData[i][nameIdx] : memData[i][0];
    const gender = genderIdx !== -1 ? memData[i][genderIdx] : "";
    const uid = uidIdx !== -1 ? String(memData[i][uidIdx] || "").trim() : "";
    const isExcluded = excludeIdx !== -1 ? (memData[i][excludeIdx] === true || memData[i][excludeIdx] === "TRUE") : false;
    const attended = uid && presentUidSet.has(uid);
    if (!isExcluded || attended) result.details.push({ name, gender, uid, count: attended ? 1 : 0, attended, rate: 0 });
  }
  result.details.sort((a, b) => (b.attended ? 1 : 0) - (a.attended ? 1 : 0));
  return result;
}

/**
 * 2. 區間統計
 */
function _getRangeStats(ss, type, startStr, endStr, baseSheetName) {
  const startNum = toDateNum(startStr), endNum = toDateNum(endStr);
  const sheet = ss.getSheetByName(type + "點名紀錄");
  const result = { presentCount: 0, newFriends: 0, nfMale: 0, nfFemale: 0, presentMale: 0, presentFemale: 0, avgCount: 0, details: [] };
  if (!sheet) return result;

  const lookups = getMemberLookups();
  const data = sheet.getDataRange().getValues();
  let validDays = 0;
  const attendanceMap = {}; // uid -> count
  let sumMemberCounts = 0, sumTotalCounts = 0, totalPresentMale = 0, totalPresentFemale = 0;

  for (let i = 1; i < data.length; i++) {
    const rowDateNum = toDateNum(data[i][0]);
    if (rowDateNum >= startNum && rowDateNum < endNum) {
      const listStr = data[i][1] ? data[i][1].toString().trim() : "";
      const dayMale = Number(data[i][2] || 0), dayFemale = Number(data[i][3] || 0);
      if (listStr === "" && dayMale === 0 && dayFemale === 0) continue;
      validDays++;
      const dayUids = parseAttendanceList(listStr);
      const g = _countGendersByUids(dayUids, lookups);
      totalPresentMale += g.male;
      totalPresentFemale += g.female;
      dayUids.forEach(uid => { attendanceMap[uid] = (attendanceMap[uid] || 0) + 1; });
      result.nfMale += dayMale; result.nfFemale += dayFemale;
      sumMemberCounts += dayUids.length;
      sumTotalCounts += (dayUids.length + dayMale + dayFemale);
    }
  }
  result.newFriends = result.nfMale + result.nfFemale;
  if (validDays > 0) {
    result.avgCount = Math.round(sumTotalCounts / validDays);
    result.presentCount = Math.round(sumMemberCounts / validDays);
    result.presentMale = Math.round(totalPresentMale / validDays);
    result.presentFemale = Math.round(totalPresentFemale / validDays);
  }

  // 詳細：以名單為基礎
  const memberSheet = ss.getSheetByName(baseSheetName);
  if (!memberSheet) return result;
  const memData = memberSheet.getDataRange().getValues();
  const nameIdx = memData[0].indexOf("姓名"), genderIdx = memData[0].indexOf("性別"), excludeIdx = memData[0].indexOf("不列入統計"), uidIdx = memData[0].indexOf("系統編號");

  for (let i = 1; i < memData.length; i++) {
    const name = nameIdx !== -1 ? memData[i][nameIdx] : memData[i][0];
    const gender = genderIdx !== -1 ? memData[i][genderIdx] : "";
    const uid = uidIdx !== -1 ? String(memData[i][uidIdx] || "").trim() : "";
    const isExcluded = excludeIdx !== -1 ? (memData[i][excludeIdx] === true || memData[i][excludeIdx] === "TRUE") : false;
    const count = (uid && attendanceMap[uid]) || 0;
    if (!isExcluded || count > 0) {
      result.details.push({ name, gender, uid, count, rate: validDays > 0 ? Math.round((count / validDays) * 100) : 0 });
    }
  }
  result.details.sort((a, b) => b.rate - a.rate);
  return result;
}

/**
 * 3. 合計區間統計
 */
function _getCombinedRangeStats(ss, startStr, endStr, baseSheetName, targetTypes) {
  const startNum = toDateNum(startStr), endNum = toDateNum(endStr);
  const lookups = getMemberLookups();
  let serviceDates = new Set(), memberDatesMap = {}, uniqueDailyAttendance = {}, nfMaleTotal = 0, nfFemaleTotal = 0;

  targetTypes.forEach(type => {
    const sheet = ss.getSheetByName(type + "點名紀錄");
    if (!sheet) return;
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      const rowDateNum = toDateNum(data[i][0]);
      if (rowDateNum >= startNum && rowDateNum < endNum) {
        const listStr = data[i][1] ? data[i][1].toString().trim() : "";
        const dMale = Number(data[i][2] || 0), dFemale = Number(data[i][3] || 0);
        if (listStr === "" && dMale === 0 && dFemale === 0) continue;
        const dateKey = rowDateNum.toString();
        serviceDates.add(dateKey);
        nfMaleTotal += dMale;
        nfFemaleTotal += dFemale;
        if (!uniqueDailyAttendance[dateKey]) uniqueDailyAttendance[dateKey] = {};
        const uids = parseAttendanceList(listStr);
        uids.forEach(uid => {
          if (!memberDatesMap[uid]) memberDatesMap[uid] = new Set();
          memberDatesMap[uid].add(dateKey);
          uniqueDailyAttendance[dateKey][uid] = lookups.u2g[uid] || "未知";
        });
      }
    }
  });

  const validDays = serviceDates.size;
  let details = [], sumAttendance = 0, totalMale = 0, totalFemale = 0;
  for (const date in uniqueDailyAttendance) {
    for (const uid in uniqueDailyAttendance[date]) {
      if (uniqueDailyAttendance[date][uid] === '男') totalMale++;
      if (uniqueDailyAttendance[date][uid] === '女') totalFemale++;
    }
  }

  const memberSheet = ss.getSheetByName(baseSheetName);
  if (!memberSheet) return { presentCount: 0, newFriends: 0, nfMale: 0, nfFemale: 0, presentMale: 0, presentFemale: 0, avgCount: 0, details: [] };
  const memData = memberSheet.getDataRange().getValues();
  const nameIdx = memData[0].indexOf("姓名"), genderIdx = memData[0].indexOf("性別"), excludeIdx = memData[0].indexOf("不列入統計"), uidIdx = memData[0].indexOf("系統編號");

  for (let i = 1; i < memData.length; i++) {
    const name = nameIdx !== -1 ? memData[i][nameIdx] : memData[i][0];
    const gender = genderIdx !== -1 ? memData[i][genderIdx] : "";
    const uid = uidIdx !== -1 ? String(memData[i][uidIdx] || "").trim() : "";
    const isExcluded = excludeIdx !== -1 ? (memData[i][excludeIdx] === true || memData[i][excludeIdx] === "TRUE") : false;
    const count = (uid && memberDatesMap[uid]) ? memberDatesMap[uid].size : 0;
    if (!isExcluded || count > 0) {
      sumAttendance += count;
      details.push({ name, gender, uid, count, rate: validDays > 0 ? Math.round((count / validDays) * 100) : 0 });
    }
  }
  details.sort((a, b) => b.rate - a.rate);
  return {
    presentCount: validDays > 0 ? Math.round(sumAttendance / validDays) : 0,
    newFriends: nfMaleTotal + nfFemaleTotal,
    nfMale: nfMaleTotal, nfFemale: nfFemaleTotal,
    presentMale: validDays > 0 ? Math.round(totalMale / validDays) : 0,
    presentFemale: validDays > 0 ? Math.round(totalFemale / validDays) : 0,
    avgCount: validDays > 0 ? Math.round((sumAttendance + nfMaleTotal + nfFemaleTotal) / validDays) : 0,
    details
  };
}

/**
 * 4. 合計單日統計
 */
function _getCombinedSingleStats(ss, dateStr, baseSheetName, targetTypes) {
  const targetDateNum = toDateNum(dateStr);
  const lookups = getMemberLookups();
  let uniqueAttendees = {}; // uid -> gender
  let nfMaleTotal = 0, nfFemaleTotal = 0;

  targetTypes.forEach(type => {
    const sheet = ss.getSheetByName(type + "點名紀錄");
    if (!sheet) return;
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (toDateNum(data[i][0]) === targetDateNum) {
        if (data[i][1]) {
          parseAttendanceList(data[i][1].toString()).forEach(uid => {
            uniqueAttendees[uid] = lookups.u2g[uid] || "未知";
          });
        }
        nfMaleTotal += Number(data[i][2] || 0);
        nfFemaleTotal += Number(data[i][3] || 0);
        break;
      }
    }
  });

  let presentMale = 0, presentFemale = 0;
  for (const uid in uniqueAttendees) {
    if (uniqueAttendees[uid] === '男') presentMale++;
    if (uniqueAttendees[uid] === '女') presentFemale++;
  }
  const result = {
    presentCount: Object.keys(uniqueAttendees).length,
    newFriends: nfMaleTotal + nfFemaleTotal,
    nfMale: nfMaleTotal, nfFemale: nfFemaleTotal,
    presentMale, presentFemale, details: []
  };

  const memberSheet = ss.getSheetByName(baseSheetName);
  if (!memberSheet) return result;
  const memData = memberSheet.getDataRange().getValues();
  const nameIdx = memData[0].indexOf("姓名"), genderIdx = memData[0].indexOf("性別"), excludeIdx = memData[0].indexOf("不列入統計"), uidIdx = memData[0].indexOf("系統編號");

  for (let i = 1; i < memData.length; i++) {
    const name = nameIdx !== -1 ? memData[i][nameIdx] : memData[i][0];
    const gender = genderIdx !== -1 ? memData[i][genderIdx] : "";
    const uid = uidIdx !== -1 ? String(memData[i][uidIdx] || "").trim() : "";
    const isExcluded = excludeIdx !== -1 ? (memData[i][excludeIdx] === true || memData[i][excludeIdx] === "TRUE") : false;
    const attended = uid && uniqueAttendees.hasOwnProperty(uid);
    if (!isExcluded || attended) result.details.push({ name, gender, uid, count: attended ? 1 : 0, attended, rate: 0 });
  }
  result.details.sort((a, b) => (b.attended ? 1 : 0) - (a.attended ? 1 : 0));
  return result;
}

/**
 * 小組名單查詢 — 改成直接從會友名單 cache 判斷「是否屬於任何小組」
 *   不再跨 SS openById（消除性能瓶頸）
 *   回傳：{ name: true } map（為與舊呼叫相容）
 */
function getSmallGroupMembersList() {
  const groupMembers = {};
  try {
    getCachedMembers().forEach(m => {
      const name = m[0] ? String(m[0]).trim() : "";
      const grp  = m[8] ? String(m[8]).trim() : "";
      if (name && grp) groupMembers[name] = true;
    });
  } catch (e) {
    console.error("getSmallGroupMembersList 失敗: " + e.toString());
  }
  return groupMembers;
}

/**
 * 出席頻率變化分析（所有比對改用 UID）
 */
function getAttendanceTrend(req) {
  const ss = getSS();
  const baseSheetName = req.baseSheet || "會友名單";
  const startNum = toDateNum(req.start);
  const endNum   = toDateNum(req.end);
  const groupMembersMap = getSmallGroupMembersList();

  // --- 1. 決定要查的點名表 ---
  let sheetNames = [];
  if (req.targetGroups && req.targetGroups.length > 0) {
    sheetNames = req.targetGroups.map(t => t + "點名紀錄");
  } else {
    sheetNames = [req.type + "點名紀錄"];
  }

  // --- 2. 收集場次資料：每場日期 -> 出席 UID Set ---
  const sessionMap = {};

  sheetNames.forEach(sheetName => {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) return;
    const data = sheet.getDataRange().getValues();

    for (let i = 1; i < data.length; i++) {
      const rowDateNum = toDateNum(data[i][0]);
      if (rowDateNum < startNum || rowDateNum >= endNum) continue;

      const listStr = data[i][1] ? data[i][1].toString().trim() : "";
      const nfMale  = Number(data[i][2] || 0);
      const nfFemale = Number(data[i][3] || 0);
      if (listStr === "" && nfMale === 0 && nfFemale === 0) continue;

      const dateKey = rowDateNum.toString();
      if (!sessionMap[dateKey]) sessionMap[dateKey] = { uids: new Set(), nfCount: 0 };

      parseAttendanceList(listStr).forEach(uid => sessionMap[dateKey].uids.add(uid));
      sessionMap[dateKey].nfCount = Math.max(sessionMap[dateKey].nfCount, nfMale + nfFemale);
    }
  });

  // --- 3. 場次清單（按日期排序）---
  const allDates = Object.keys(sessionMap).sort();
  if (allDates.length === 0) {
    throw new Error("在指定日期前找不到任何有效場次紀錄。");
  }

  // --- 4. 載入會友名單 ---
  const memberSheet = ss.getSheetByName(baseSheetName);
  if (!memberSheet) throw new Error("找不到名單：" + baseSheetName);

  const memData    = memberSheet.getDataRange().getValues();
  const nameIdx    = memData[0].indexOf("姓名");
  const genderIdx  = memData[0].indexOf("性別");
  const excludeIdx = memData[0].indexOf("不列入統計");
  const uidIdx     = memData[0].indexOf("系統編號");

  const members = {}; // uid -> { name, gender, inGroup }
  for (let i = 1; i < memData.length; i++) {
    const name   = nameIdx   !== -1 ? memData[i][nameIdx]   : memData[i][0];
    const gender = genderIdx !== -1 ? memData[i][genderIdx] : "";
    const uid    = uidIdx    !== -1 ? String(memData[i][uidIdx] || "").trim() : "";
    const isExcluded = excludeIdx !== -1 ? (memData[i][excludeIdx] === true || memData[i][excludeIdx] === "TRUE") : false;
    if (!uid || isExcluded) continue;
    members[uid] = { name: name, gender: gender || "-", inGroup: !!groupMembersMap[name] };
  }

  // --- 5. 時間窗：近期可調 (最少3週)，歷史最長 365 天 ---
  const recentWeeks = (req && req.recentWeeks) ? parseInt(req.recentWeeks, 10) : 8;
  const finalRecentWeeks = isNaN(recentWeeks) ? 8 : Math.max(3, recentWeeks);
  const RECENT_WINDOW_DAYS = finalRecentWeeks * 7;
  const MAX_HISTORY_DAYS = 365;

  function parseDateKey(dKey) {
    return new Date(parseInt(dKey.substring(0,4), 10), parseInt(dKey.substring(4,6), 10) - 1, parseInt(dKey.substring(6,8), 10));
  }

  const latestDateKey = allDates[allDates.length - 1];
  const latestDate = parseDateKey(latestDateKey);
  const cutoffDate = new Date(latestDate);
  cutoffDate.setDate(cutoffDate.getDate() - RECENT_WINDOW_DAYS);
  const maxHistoryDate = new Date(cutoffDate);
  maxHistoryDate.setDate(maxHistoryDate.getDate() - MAX_HISTORY_DAYS);

  const recentDates = [];
  const generalHistoryDates = [];
  allDates.forEach(d => {
    const dDate = parseDateKey(d);
    if (dDate > cutoffDate) recentDates.push(d);
    else if (dDate >= maxHistoryDate) generalHistoryDates.push(d);
  });

  const recentCount = recentDates.length;
  const details = [];

  // --- 6. 計算每位會友的衰退指標 ---
  Object.keys(members).forEach(uid => {
    let firstAppearanceDateStr = null;
    for (let i = 0; i < allDates.length; i++) {
      if (sessionMap[allDates[i]].uids.has(uid)) {
        firstAppearanceDateStr = allDates[i];
        break;
      }
    }
    if (!firstAppearanceDateStr) return;

    const firstAppDate = parseDateKey(firstAppearanceDateStr);
    const individualStartDate = firstAppDate > maxHistoryDate ? firstAppDate : maxHistoryDate;
    const historyDays = Math.ceil((cutoffDate.getTime() - individualStartDate.getTime()) / (1000 * 3600 * 24));
    // 歷史至少要有 8 週 (56 天) 才有參考價值，若未滿則不列入分析
    if (historyDays < 56) return;

    let historyAttended = 0, individualHistoryCount = 0;
    generalHistoryDates.forEach(d => {
      const dDate = parseDateKey(d);
      if (dDate >= individualStartDate) {
        individualHistoryCount++;
        if (sessionMap[d].uids.has(uid)) historyAttended++;
      }
    });
    let recentAttended = 0;
    recentDates.forEach(d => { if (sessionMap[d].uids.has(uid)) recentAttended++; });

    let consecutiveMisses = 0, lastAttendedDateKey = null;
    for (let i = allDates.length - 1; i >= 0; i--) {
      if (!sessionMap[allDates[i]].uids.has(uid)) consecutiveMisses++;
      else { lastAttendedDateKey = allDates[i]; break; }
    }

    let missingThreeWeeks = false;
    if (lastAttendedDateKey) {
      const lastDate = parseDateKey(lastAttendedDateKey);
      const diffDays = Math.floor((latestDate.getTime() - lastDate.getTime()) / (1000 * 3600 * 24));
      if (diffDays >= 21) missingThreeWeeks = true;
    } else if (consecutiveMisses > 0) {
      missingThreeWeeks = true;
    }

    const historyRate = individualHistoryCount > 0 ? Math.round((historyAttended / individualHistoryCount) * 100) : 0;
    const recentRate  = recentCount > 0 ? Math.round((recentAttended / recentCount) * 100) : 0;
    const rateDrop    = historyRate - recentRate;
    const dropScore   = rateDrop > 0 ? rateDrop : 0;

    details.push({
      name: members[uid].name,
      uid: uid,
      gender: members[uid].gender,
      inGroup: members[uid].inGroup,
      historyRate, recentRate, rateDrop, consecutiveMisses, dropScore, missingThreeWeeks,
      warningDesc: missingThreeWeeks ? "⚠️ 已連續三週未出席" : ""
    });
  });

  details.sort((a, b) => b.dropScore - a.dropScore);

  // --- 7. 格式化日期 ---
  function fmt(dateKey) {
    return dateKey.substring(0,4) + "/" + dateKey.substring(4,6) + "/" + dateKey.substring(6,8);
  }

  return {
    periodHistory: generalHistoryDates.length > 0 ? (fmt(generalHistoryDates[0]) + " ~ " + fmt(generalHistoryDates[generalHistoryDates.length - 1])) : "無",
    periodRecent: recentDates.length > 0 ? (fmt(recentDates[0]) + " ~ " + fmt(recentDates[recentDates.length - 1])) : "無",
    sessionsHistory: generalHistoryDates.length,
    sessionsRecent: recentDates.length,
    details: details
  };
}
