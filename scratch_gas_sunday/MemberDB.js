/**
 * 自動產生下一個 LK 編號
 * 支援傳入已讀取的 data 陣列以節省 API 呼叫
 */
function generateNextUID(data) {
  if (!data) {
    const sheet = getMemberSheet();
    data = sheet.getDataRange().getValues();
  }
  let maxNum = 0;
  for (let i = 1; i < data.length; i++) {
    const uid = data[i][7] ? data[i][7].toString().trim() : "";
    if (uid.startsWith("LK")) {
      const num = parseInt(uid.replace("LK", ""), 10);
      if (!isNaN(num) && num > maxNum) maxNum = num;
    }
  }
  return "LK" + (maxNum + 1).toString().padStart(5, '0');
}

/**
 * 1. 取得會友名單工作表
 *
 * 欄位 schema（共 11 欄）：
 *   A=姓名 B=性別 C=建立日期 D=備註 E=不列入統計
 *   F=異動日期 G=異動紀錄 H=系統編號 I=QR Code J=所屬小組
 *   K=身分（核心同工 / 一般同工 / 小羊 / 陪伴同工，預設 小羊）
 */
function getMemberSheet() {
  const ss = getSS();
  let sheet = ss.getSheetByName(MEMBER_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(MEMBER_SHEET);
    sheet.appendRow(["姓名", "性別", "建立日期", "備註", "不列入統計", "異動日期", "異動紀錄", "系統編號", "QR Code", "所屬小組", "身分"]);
  } else {
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    if (headers.length < 8  || headers[7]  !== "系統編號")  sheet.getRange("H1").setValue("系統編號");
    if (headers.length < 9  || headers[8]  !== "QR Code")   sheet.getRange("I1").setValue("QR Code");
    if (headers.length < 10 || headers[9]  !== "所屬小組")  sheet.getRange("J1").setValue("所屬小組");
    if (headers.length < 11 || headers[10] !== "身分")      sheet.getRange("K1").setValue("身分");
  }
  return sheet;
}

// 4 種身分白名單（系統共用）
const MEMBER_ROLES = ["核心同工", "一般同工", "小羊", "陪伴同工"];
function _normalizeRole(role) {
  const v = role ? String(role).trim() : "";
  return MEMBER_ROLES.indexOf(v) !== -1 ? v : "小羊";
}

// ═══════════════════════════════════════════════════════════
//  群組-身分 字串解析助手（公用）
//
//  資料格式：
//    所屬小組（J 欄）："葡萄樹A組" 或 "葡萄樹A組、以斯帖小組"
//    身分（K 欄）：     "核心同工"   或 "核心同工(葡萄樹A組)、一般同工(以斯帖小組)"
//
//  分隔符號統一用「、」（同時相容半形 , 與全形 ，）
// ═══════════════════════════════════════════════════════════

/** 把所屬小組字串拆成陣列 */
function parseGroupString(groupStr) {
  if (!groupStr) return [];
  return String(groupStr).split(/[、,，]/).map(s => s.trim()).filter(s => s);
}

/**
 * 解析 (所屬小組字串, 身分字串) 對 → { groupName: role } 對照表
 * 支援單組（純字串）與多組（含括號標註）
 */
function parseGroupRoles(groupStr, roleStr) {
  const result = {};
  const groups = parseGroupString(groupStr);
  if (groups.length === 0) return result;

  const rolesByGroup = {};
  let singleRole = null;
  if (roleStr) {
    String(roleStr).split(/[、,，]/).forEach(part => {
      part = part.trim();
      if (!part) return;
      const m = part.match(/^(.+?)\((.+?)\)$/);
      if (m) {
        rolesByGroup[m[2].trim()] = _normalizeRole(m[1]);
      } else {
        singleRole = _normalizeRole(part);
      }
    });
  }

  groups.forEach(g => {
    result[g] = rolesByGroup[g] || singleRole || "小羊";
  });
  return result;
}

/**
 * { groupName: role } 對照表 → 顯示用字串
 * 單組：簡化格式（"小羊"）
 * 多組：含括號（"核心同工(A組)、一般同工(B組)"）
 */
function formatGroupRoles(groupRoles) {
  const groups = Object.keys(groupRoles);
  if (groups.length === 0) return { groupStr: "", roleStr: "" };
  const groupStr = groups.join("、");
  let roleStr;
  if (groups.length === 1) {
    roleStr = groupRoles[groups[0]];
  } else {
    roleStr = groups.map(g => `${groupRoles[g]}(${g})`).join("、");
  }
  return { groupStr, roleStr };
}

/** 取得指定小組的身分（給 checkGroupStatus / 事工管理 過濾用） */
function getRoleForGroup(roleStr, groupName) {
  if (!roleStr) return "小羊";
  const parts = String(roleStr).split(/[、,，]/);
  for (let i = 0; i < parts.length; i++) {
    const m = parts[i].trim().match(/^(.+?)\((.+?)\)$/);
    if (m && m[2].trim() === groupName) return _normalizeRole(m[1]);
  }
  // 沒有括號 → 單組情境，直接用該值
  const trimmed = String(roleStr).trim();
  if (trimmed && trimmed.indexOf("(") === -1) return _normalizeRole(trimmed);
  return "小羊";
}

/** 檢查所屬小組字串是否包含某小組 */
function memberInGroup(groupStr, groupName) {
  return parseGroupString(groupStr).indexOf(groupName) !== -1;
}

// ═══════════════════════════════════════════════════════════
//  UID ↔ 姓名 雙向查詢（會友名單為單一真實來源）
//
//  設計原則：
//   - 點名紀錄一律用 UID 儲存（避免重名混淆、會友改名後紀錄錯亂）
//   - 顯示時用 uidToName() 反查
//   - 為相容舊資料（仍存姓名格式），parseAttendanceList 會自動把姓名轉 UID
// ═══════════════════════════════════════════════════════════

let _memberLookupsMemo = null;
/** 建立姓名/UID/性別 三向查表（請求內 memo） */
function getMemberLookups() {
  if (_memberLookupsMemo) return _memberLookupsMemo;
  const u2n = {}, n2u = {}, u2g = {}, u2group = {}, u2role = {};
  const members = getCachedMembers();
  members.forEach(m => {
    const name   = m[0] ? String(m[0]).trim() : "";
    const gender = m[1] ? String(m[1]).trim() : "";
    const uid    = m[7] ? String(m[7]).trim() : "";
    const grp    = m[8] ? String(m[8]).trim() : "";
    const role   = m[9] ? String(m[9]).trim() : "";
    if (uid && name) {
      u2n[uid] = name;
      n2u[name] = uid;
      u2g[uid] = gender;
      u2group[uid] = grp;
      u2role[uid] = role;
    }
  });
  _memberLookupsMemo = { u2n, n2u, u2g, u2group, u2role };
  return _memberLookupsMemo;
}

/** UID → 姓名（找不到回傳原 UID 字串以便除錯） */
function uidToName(uid) {
  if (!uid) return "";
  const k = String(uid).trim();
  return getMemberLookups().u2n[k] || k;
}

/** 姓名 → UID（找不到回傳空字串） */
function nameToUid(name) {
  if (!name) return "";
  return getMemberLookups().n2u[String(name).trim()] || "";
}

/** UID → 性別 */
function uidToGender(uid) {
  if (!uid) return "";
  return getMemberLookups().u2g[String(uid).trim()] || "";
}

/**
 * 解析點名紀錄的「名單字串」→ 純 UID 陣列
 * 自動相容兩種格式：
 *   新格式：LK00001, LK00002, LK00003
 *   舊格式：張三(男), 李四(女)        ← 自動把姓名反查成 UID
 * 找不到對應的會友會被略過（避免污染統計）
 */
function parseAttendanceList(listStr) {
  if (!listStr) return [];
  const lookups = getMemberLookups();
  const out = [];
  String(listStr).split(/[,，、]\s*/).forEach(part => {
    const item = part.trim();
    if (!item) return;
    const cleaned = item.split('(')[0].trim();   // 去掉性別括號
    if (!cleaned) return;
    if (/^LK\d+$/i.test(cleaned)) {
      out.push(cleaned.toUpperCase());
    } else {
      const uid = lookups.n2u[cleaned];
      if (uid) out.push(uid);
      // 找不到 → 略過（可能是已刪會友或誤入新朋友）
    }
  });
  return out;
}

/** 把 UID 陣列轉成姓名陣列（給前端顯示用） */
function uidsToNames(uidList) {
  if (!uidList || !uidList.length) return [];
  const lookups = getMemberLookups();
  return uidList.map(u => lookups.u2n[String(u).trim()] || String(u));
}

/**
 * 2. 取得所有會友資料（走快取，cache miss 才讀 Sheet）
 */
function getAllMembers() {
  return getCachedMembers();
}

/**
 * 2b. 取得會友管理名冊及 UID 使用狀態（判斷有效 / 不可刪除）
 */
function getMemberManagementData() {
  const ss = getSS();
  const members = getAllMembers();
  const usedUids = new Set();
  const sheets = ['台語點名紀錄', '華語點名紀錄', '主日學A班點名紀錄', '主日學B班點名紀錄', '禱告會點名紀錄', '聯合點名紀錄'];
  sheets.forEach(function(sName) {
    const sh = ss.getSheetByName(sName);
    if (!sh) return;
    const data = sh.getDataRange().getValues();
    for (let r = 1; r < data.length; r++) {
      const listStr = data[r][1] ? data[r][1].toString() : '';
      parseAttendanceList(listStr).forEach(function(u) { usedUids.add(u); });
    }
  });

  const usageByUid = {};
  members.forEach(function(row) {
    const uid = row[7] ? String(row[7]).trim().toUpperCase() : '';
    const group = row[8] ? String(row[8]).trim() : '';
    if (uid) {
      usageByUid[uid] = { effective: usedUids.has(uid) || Boolean(group) };
    }
  });

  return {
    members: members,
    usageByUid: usageByUid
  };
}

/**
 * 3. 新增會友
 */
function addMember(member) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getMemberSheet();
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] == member.name) return "⚠️ 新增失敗：姓名 [" + member.name + "] 已存在！";
    }
    const now = new Date();
    const uid = generateNextUID(data);
    const role = _normalizeRole(member.role);
    sheet.appendRow([member.name, member.gender, now, member.note, member.isExcluded, now, "初始建立", uid, "", member.group || "", role]);
    invalidateAndRebuildMemberCache();
    firebaseInvalidate(['getAllMembers', 'getAllGroupMembers', 'getMemberSuggestions', 'getStats', 'getAllGroupsStats', 'getAdminGroupsList', 'ministry_getPageConfig', 'ministry_getGroupMembers', 'getAttendanceStats']);
    return "✅ 新增成功！編號：" + uid;
  } finally {
    lock.releaseLock();
  }
}

/**
 * 4. 編輯會友（支援 partial update：只傳要改的欄位即可，未提供的保留原值）
 *    身分欄不再 normalize 成單一身分（因為要支援 "核心同工(A組)、一般同工(B組)" 多組格式）
 */
function updateMember(oldName, newData) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getMemberSheet();
    const data = sheet.getDataRange().getValues();
    const now = new Date();

    for (let i = 1; i < data.length; i++) {
      if (data[i][0] == oldName) {
        const rowIndex = i + 1;

        // 對每個欄位，若 newData 有提供就用新值，未提供則保留原值
        const finalName     = newData.name       !== undefined ? newData.name       : data[i][0];
        const finalGender   = newData.gender     !== undefined ? newData.gender     : data[i][1];
        const finalNote     = newData.note       !== undefined ? newData.note       : data[i][3];
        const finalExcluded = newData.isExcluded !== undefined ? newData.isExcluded : data[i][4];
        const finalGroup    = newData.group      !== undefined ? String(newData.group || "").trim() : (data[i][9] || "");
        const finalRole     = newData.role       !== undefined ? String(newData.role || "小羊").trim() : (data[i][10] || "小羊");

        const changeLog = [];
        if (data[i][0] != finalName)   changeLog.push("姓名: " + data[i][0] + "->" + finalName);
        if (data[i][1] != finalGender) changeLog.push("性別: " + data[i][1] + "->" + finalGender);
        if (data[i][3] != finalNote)   changeLog.push("備註異動");
        const oldExcluded = (data[i][4] === true || data[i][4] === "TRUE");
        const newExcluded = (finalExcluded === true || finalExcluded === "TRUE");
        if (oldExcluded !== newExcluded) changeLog.push("統計狀態變更");
        const oldGroup = data[i][9] ? String(data[i][9]).trim() : "";
        if (oldGroup !== finalGroup)   changeLog.push("所屬小組: " + (oldGroup || "(無)") + "->" + (finalGroup || "(無)"));
        const oldRole = data[i][10] ? String(data[i][10]).trim() : "小羊";
        if (oldRole !== finalRole)     changeLog.push("身分: " + oldRole + "->" + finalRole);

        if (changeLog.length > 0) {
          sheet.getRange(rowIndex, 1, 1, 7).setValues([[
            finalName, finalGender, data[i][2], finalNote, finalExcluded, now, changeLog.join(" | ")
          ]]);
          sheet.getRange(rowIndex, 10).setValue(finalGroup);
          sheet.getRange(rowIndex, 11).setValue(finalRole);
          invalidateAndRebuildMemberCache();
          firebaseInvalidate(['getAllMembers', 'getAllGroupMembers', 'getMemberSuggestions', 'getStats', 'getAllGroupsStats', 'getAdminGroupsList', 'ministry_getPageConfig', 'ministry_getGroupMembers', 'getAttendanceStats']);
          return "✅ 更新成功！";
        } else {
          return "⚠️ 資料無異動";
        }
      }
    }
    return "❌ 找不到原始資料，無法更新";
  } finally {
    lock.releaseLock();
  }
}

/**
 * 5. 刪除會友
 */
function deleteMember(name) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    try {
      const sheet = getMemberSheet();
      const data = sheet.getDataRange().getValues();
      const targetName = name.toString().trim();
      for (let i = data.length - 1; i >= 1; i--) {
        if (data[i][0].toString().trim() === targetName) {
          const uid = data[i][7] ? String(data[i][7]).trim().toUpperCase() : "";
          const group = data[i][9] ? String(data[i][9]).trim() : "";
          if (group) {
            return "⚠️ 此會友具備小組關聯，無法直接刪除；請改設為「不統計」。";
          }
          if (uid) {
            const ss = getSS();
            const attSheets = ['台語點名紀錄', '華語點名紀錄', '主日學A班點名紀錄', '主日學B班點名紀錄', '禱告會點名紀錄', '聯合點名紀錄'];
            for (let s = 0; s < attSheets.length; s++) {
              const sh = ss.getSheetByName(attSheets[s]);
              if (!sh) continue;
              const sData = sh.getDataRange().getValues();
              for (let r = 1; r < sData.length; r++) {
                const uids = parseAttendanceList(sData[r][1] ? sData[r][1].toString() : '');
                if (uids.indexOf(uid) !== -1) {
                  return "⚠️ 此會友曾有點名紀錄，無法直接刪除；請改設為「不統計」。";
                }
              }
            }
          }
          sheet.deleteRow(i + 1);
          invalidateAndRebuildMemberCache();
          firebaseInvalidate(['getAllMembers', 'getAllGroupMembers', 'getMemberSuggestions', 'getStats', 'getAllGroupsStats', 'getAdminGroupsList', 'ministry_getPageConfig', 'ministry_getGroupMembers', 'getAttendanceStats']);
          return "🗑️ 成功刪除會友: " + targetName;
        }
      }
      return "❌ 找不到會友 [" + targetName + "]";
    } catch (e) {
      return "❌ 刪除過程出錯: " + e.toString();
    }
  } finally {
    lock.releaseLock();
  }
}

/**
 * 6. 補齊舊會友系統編號（GAS 編輯器手動執行）
 * ✅ 改為從目前最大 LK 編號往下續編，優化為批次處理
 */
function batchGenerateMissingQRCodes() {
  const sheet = getMemberSheet();
  const data = sheet.getDataRange().getValues();
  
  // 1. 先找出目前最大的 LK 編號
  let maxNum = 0;
  for (let i = 1; i < data.length; i++) {
    const existingUid = data[i][7] ? data[i][7].toString().trim() : "";
    if (existingUid.startsWith("LK")) {
      const num = parseInt(existingUid.replace("LK", ""), 10);
      if (!isNaN(num) && num > maxNum) maxNum = num;
    }
  }

  // 2. 準備批次更新的編號陣列 (只抓出第 8 欄，即 index 7)
  let updatedCount = 0;
  const newUids = [];
  
  for (let i = 1; i < data.length; i++) {
    let currentUid = data[i][7] ? data[i][7].toString().trim() : "";
    if (!currentUid) {
      maxNum++;
      currentUid = "LK" + maxNum.toString().padStart(5, '0');
      updatedCount++;
    }
    newUids.push([currentUid]);
  }

  // 3. 一次性寫回所有 UID 到第 8 欄 (從第 2 列開始)
  if (updatedCount > 0) {
    sheet.getRange(2, 8, newUids.length, 1).setValues(newUids);
  }
  
  Logger.log("✅ 共補齊了 " + updatedCount + " 位會友的系統編號。");
}

// ==========================================
//  卡片製作
// ==========================================

const CARD_CONFIG = {
  TEMPLATE_SLIDE_ID: '13hmS49cHuIgX-P0lYxa-rJ_o29xNnNExr3v2BaLcdKw',
  OUTPUT_FOLDER_ID: '1XzD7WujBRisXYkp2WFtPoqcrVzHloT6T',
  QR_API: "https://quickchart.io/qr?size=300x300&text="
};

/**
 * 7. 產生個人卡片（儲存 JPG 到雲端硬碟）
 */
function generateMemberCard(member) {
  if (!member) return { success: false, msg: "未接收到資料" };
  let tempCopy = null;
  try {
    const name = String(member.name || "").trim();
    const uid  = String(member.uid  || "").trim();

    const templateFile = DriveApp.getFileById(CARD_CONFIG.TEMPLATE_SLIDE_ID);
    const folder       = DriveApp.getFolderById(CARD_CONFIG.OUTPUT_FOLDER_ID);

    // 1. 複製模板（暫存用）
    tempCopy = templateFile.makeCopy(`[暫存]_${name}`);
    const tempId     = tempCopy.getId();
    const presentation = SlidesApp.openById(tempId);
    const slide        = presentation.getSlides()[0];

    // 2. 替換文字
    slide.replaceAllText('{{NAME}}', name);
    slide.replaceAllText('{{UID}}',  uid);

    // 3. 插入 QR Code
    const qrUrl      = CARD_CONFIG.QR_API + encodeURIComponent(uid);
    const qrResponse = UrlFetchApp.fetch(qrUrl, { muteHttpExceptions: true });
    if (qrResponse.getResponseCode() === 200) {
      const qrImage = slide.insertImage(qrResponse.getBlob());
      qrImage.setLeft(35).setTop(35).setWidth(525).setHeight(525);
    }
    presentation.saveAndClose();

    // 4. 等待 Google 處理完成
    Utilities.sleep(1500);

    // 5. 匯出第一頁為 JPEG
    const exportUrl = `https://docs.google.com/presentation/d/${tempId}/export/jpeg`;
    const response  = UrlFetchApp.fetch(exportUrl, {
      headers: { 'Authorization': 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true
    });
    if (response.getResponseCode() !== 200) throw new Error("匯出圖片失敗，HTTP " + response.getResponseCode());

    // 6. 將 JPG 存到指定資料夾
    const jpgBlob = response.getBlob().setName(`${name}_個人名卡.jpg`);
    const jpgFile = folder.createFile(jpgBlob);

    // 7. 刪除暫存 Slide
    tempCopy.setTrashed(true);

    return { success: true, fileUrl: jpgFile.getUrl(), fileName: jpgFile.getName() };

  } catch (e) {
    if (tempCopy) { try { tempCopy.setTrashed(true); } catch(ex) {} }
    return { success: false, msg: e.toString() };
  }
}

/**
 * 8. 預覽卡片（回傳 JPG base64）
 */
function previewMemberCard(member) {
  if (!member) return { success: false, msg: "未接收到會友資料" };
  let tempCopy = null;
  try {
    const name = String(member.name || "").trim() || "空姓名";
    const uid = String(member.uid || "").trim();
    if (!uid || uid === "無編號") throw new Error("無效的系統編號");
    const templateFile = DriveApp.getFileById(CARD_CONFIG.TEMPLATE_SLIDE_ID);
    tempCopy = templateFile.makeCopy(`[暫存預覽]_${name}`);
    const tempId = tempCopy.getId();
    const presentation = SlidesApp.openById(tempId);
    const slide = presentation.getSlides()[0];
    slide.replaceAllText('{{NAME}}', name);
    slide.replaceAllText('{{UID}}', uid);
    const qrUrl = CARD_CONFIG.QR_API + encodeURIComponent(uid);
    const qrResponse = UrlFetchApp.fetch(qrUrl, { muteHttpExceptions: true });
    if (qrResponse.getResponseCode() === 200) {
      const qrImage = slide.insertImage(qrResponse.getBlob());
      qrImage.setLeft(35).setTop(35).setWidth(525).setHeight(525);
    }
    presentation.saveAndClose();
    Utilities.sleep(1500);
    const exportUrl = `https://docs.google.com/presentation/d/${tempId}/export/jpeg`;
    const response = UrlFetchApp.fetch(exportUrl, {
      headers: { 'Authorization': 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true
    });
    if (response.getResponseCode() !== 200) throw new Error("匯出圖片失敗");
    const base64Str = Utilities.base64Encode(response.getBlob().getBytes());
    tempCopy.setTrashed(true);
    return { success: true, base64: "data:image/jpeg;base64," + base64Str };
  } catch (e) {
    if (tempCopy) { try { tempCopy.setTrashed(true); } catch(ex) {} }
    return { success: false, msg: e.toString() };
  }
}

/**
 * 批量產生所有會友名卡（支援斷點續跑）
 * 每次手動執行會從上次中斷處繼續，全部完成後自動清除進度
 */
function batchGenerateAllMemberCards() {
  const MAX_RUNTIME_MS = 5 * 60 * 1000;
  const startTime = Date.now();

  const props = PropertiesService.getScriptProperties();
  const sheet = getMemberSheet();
  const data = sheet.getDataRange().getValues();

  let startRow     = parseInt(props.getProperty("BATCH_CARD_START_ROW") || "1", 10);
  let successCount = parseInt(props.getProperty("BATCH_CARD_SUCCESS")   || "0", 10);
  let skipCount    = parseInt(props.getProperty("BATCH_CARD_SKIP")      || "0", 10);
  let failList     = JSON.parse(props.getProperty("BATCH_CARD_FAILS")   || "[]");

  Logger.log("▶️ 從第 " + startRow + " 列開始，共 " + (data.length - 1) + " 人");

  for (let i = startRow; i < data.length; i++) {

    // 逾時檢查
    if (Date.now() - startTime > MAX_RUNTIME_MS) {
      saveProgress(props, i, successCount, skipCount, failList);
      const msg = "⏸️ 已暫停（接近時間上限）\n目前進度：第 " + i + " / " + (data.length - 1) + " 人\n✅ 成功：" + successCount + "　❌ 失敗：" + failList.length + "\n\n請再次執行繼續";
      Logger.log(msg);
      SpreadsheetApp.getUi().alert(msg);
      return;
    }

    const name = data[i][0] ? data[i][0].toString().trim() : "";
    const uid  = data[i][7] ? data[i][7].toString().trim() : "";

    if (!name || !uid) {
      skipCount++;
      // ✅ 跳過也立刻存進度
      saveProgress(props, i + 1, successCount, skipCount, failList);
      continue;
    }

    try {
      const result = generateMemberCard({ name: name, uid: uid });
      if (result.success) {
        successCount++;
        Logger.log("✅ [" + i + "] " + name + " (" + uid + ")");
      } else {
        failList.push(name + "：" + result.msg);
        Logger.log("❌ [" + i + "] " + name + " 失敗：" + result.msg);
      }
    } catch (e) {
      failList.push(name + "：" + e.toString());
      Logger.log("❌ [" + i + "] " + name + " 例外：" + e.toString());
    }

    // ✅ 每處理完一人，無論成功失敗，立刻儲存進度到下一列
    saveProgress(props, i + 1, successCount, skipCount, failList);

    Utilities.sleep(1500);
  }

  // 全部完成，清除進度
  props.deleteProperty("BATCH_CARD_START_ROW");
  props.deleteProperty("BATCH_CARD_SUCCESS");
  props.deleteProperty("BATCH_CARD_SKIP");
  props.deleteProperty("BATCH_CARD_FAILS");

  const summary = [
    "===== 全部完成 =====",
    "✅ 成功：" + successCount + " 人",
    "⏭️ 跳過：" + skipCount + " 人",
    "❌ 失敗：" + failList.length + " 人",
    failList.length > 0 ? "失敗名單：\n" + failList.join("\n") : ""
  ].join("\n");

  Logger.log(summary);
  SpreadsheetApp.getUi().alert(summary);
}

function forceSetStartRow() {
  PropertiesService.getScriptProperties().setProperty("BATCH_CARD_START_ROW", "77");
  Logger.log("✅ 已設定從第 77 列開始");
}
/**
 * 統一的進度儲存函式
 */
function saveProgress(props, nextRow, successCount, skipCount, failList) {
  props.setProperty("BATCH_CARD_START_ROW", String(nextRow));
  props.setProperty("BATCH_CARD_SUCCESS",   String(successCount));
  props.setProperty("BATCH_CARD_SKIP",      String(skipCount));
  props.setProperty("BATCH_CARD_FAILS",     JSON.stringify(failList));
}

/**
 * 手動重置進度（如果想從頭重跑時執行）
 */
function resetBatchCardProgress() {
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty("BATCH_CARD_START_ROW");
  props.deleteProperty("BATCH_CARD_SUCCESS");
  props.deleteProperty("BATCH_CARD_SKIP");
  props.deleteProperty("BATCH_CARD_FAILS");
  SpreadsheetApp.getUi().alert("✅ 進度已重置，下次執行將從頭開始");
}