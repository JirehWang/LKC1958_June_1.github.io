/**
 * GroupAttendance.js — 小組點名業務邏輯（整合版）
 *
 * 與原 小組點名_測試版/GroupAttendance.js 相比的關鍵變化：
 *  ❌ 不再 UrlFetch 主日 GAS 取會友名單 → ✅ 直接呼叫 getCachedMembers()
 *  ❌ 不再 UrlFetch 主日 GAS 新增會友 → ✅ 直接呼叫 addMember()
 *  → 同一個 GAS 內函式呼叫，省下 1 次跨 GAS 冷啟動 + HTTP overhead
 */

// ── 1. 檢查/同步小組名單 ─────────────────────────────────────
//
// 整合方案 C 後的設計：
//  ✅ 主日「會友名單」是身分的單一真實來源（cache index 9 = 身分）
//  ✅ 小組 _名單 sheet 只是「方便人類在試算表查看」的鏡像，邏輯上可省略
//  ✅ 即使有人手動改 _名單 的身分欄，也會被下次同步覆蓋（避免兩處不一致）
//
// 性能優化：
//  ① 直接從 master cache 取資料，不必讀本地 _名單
//  ② diff 後才寫，沒變動時連 Sheet 都不碰
function _isHappyGroup(groupName) {
  const sheet = getGroupSheet("小組清單");
  if (!sheet) return false;
  _ensureGroupListSchema(sheet);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] && String(data[i][0]).trim() === String(groupName).trim()) {
      return String(data[i][5] || "").trim() === "幸福小組";
    }
  }
  return false;
}

function checkGroupStatus(groupName) {
  const isHappy = _isHappyGroup(groupName);
  const mSheet = getGroupSheet(groupName + "_名單");
  if (!mSheet) return { isInitialized: false, type: isHappy ? "幸福小組" : "一般小組" };

  // 從主日會友名單取此組成員（含 UID + 身分）— 主日為單一真實來源
  // 支援多組格式：所屬小組 = "A、B"，身分 = "核心同工(A)、一般同工(B)"
  let masterMembers = []; // [{ name, role, uid }]
  try {
    const allMembers = getCachedMembers();
    masterMembers = allMembers
      .filter(m => memberInGroup(m[8], groupName))
      .map(m => ({
        name: m[0] ? String(m[0]).trim() : "",
        uid:  m[7] ? String(m[7]).trim() : "",
        role: getRoleForGroup(m[9], groupName)
      }))
      .filter(m => m.name);
  } catch (e) {
    console.log("讀取主日會友名單失敗，回退至本地 _名單: " + e.message);
  }

  // 如果是幸福小組，需要將本地試算表中的 BEST 撈出來合併，不覆蓋它們
  let localBest = [];
  const lastRow = mSheet.getLastRow();
  const orderMap = {};       // name -> orderNumber
  const nicknameMap = {};    // name -> nickname
  
  if (lastRow > 1) {
    const localData = mSheet.getRange(2, 1, lastRow - 1, 6).getValues();
    localData.forEach(row => {
      const n = row[0] ? String(row[0]).trim() : "";
      if (!n) return;
      const ord = row[4] !== undefined && row[4] !== "" ? Number(row[4]) : 9999;
      if (!isNaN(ord)) orderMap[n] = ord;
      nicknameMap[n] = row[5] ? String(row[5]).trim() : "";
      
      const uid = row[3] ? String(row[3]).trim() : "";
      const role = row[2] ? String(row[2]).trim() : "";
      // 如果是幸福小組，且為 BEST (無 LK 編號)
      if (isHappy && (!uid || !uid.toUpperCase().startsWith("LK"))) {
        localBest.push({
          name: n,
          uid: uid,
          role: role || "BEST"
        });
      }
    });
  }

  // 合併同工與 BEST
  if (isHappy) {
    masterMembers = masterMembers.concat(localBest);
  }

  if (masterMembers.length > 0) {
    _ensureGroupNameSheetSchema(mSheet);

    // 按本地排序排好 master 成員
    masterMembers.sort((a, b) => {
      const oa = orderMap[a.name] !== undefined ? orderMap[a.name] : 9999;
      const ob = orderMap[b.name] !== undefined ? orderMap[b.name] : 9999;
      if (oa !== ob) return oa - ob;
      return (a.name || "").localeCompare(b.name || "");
    });

    // 把暱稱附加到 master 成員（前端會用到）
    masterMembers.forEach(m => {
      m.nickname = nicknameMap[m.name] || "";
    });

    // 判斷是否要寫 Sheet
    let needWrite = true;
    if (lastRow > 1) {
      const local = mSheet.getRange(2, 1, lastRow - 1, 6).getValues();
      if (local.length === masterMembers.length) {
        needWrite = !masterMembers.every((m, i) => {
          const r = local[i];
          if (!r) return false;
          return String(r[0]).trim() === m.name
              && String(r[2]).trim() === m.role
              && String(r[3]).trim() === m.uid;
        });
      }
    }

    if (needWrite) {
      if (lastRow > 1) mSheet.getRange(2, 1, lastRow - 1, 6).clearContent();
      const newRows = masterMembers.map((m, i) => [
        m.name, new Date(), m.role, m.uid,
        orderMap[m.name] !== undefined ? orderMap[m.name] : (i + 1),
        nicknameMap[m.name] || ""
      ]);
      mSheet.getRange(2, 1, newRows.length, 6).setValues(newRows);
    }

    return { isInitialized: true, members: masterMembers, type: isHappy ? "幸福小組" : "一般小組" };
  }

  // master 沒資料時：回退至本地 _名單（容錯）
  if (lastRow <= 1) return { isInitialized: true, members: [], type: isHappy ? "幸福小組" : "一般小組" };

  const data = mSheet.getRange(2, 1, lastRow - 1, 6).getValues();
  const members = data
    .map(row => ({
      name:     row[0] ? row[0].toString().trim() : "",
      role:     row[2] ? row[2].toString().trim() : (isHappy ? "BEST" : "小羊"),
      uid:      row[3] ? row[3].toString().trim() : "",
      nickname: row[5] ? row[5].toString().trim() : "",
      _ord:     row[4] !== undefined && row[4] !== "" ? Number(row[4]) : 9999
    }))
    .filter(m => m.name)
    .sort((a, b) => (a._ord - b._ord) || a.name.localeCompare(b.name))
    .map(m => ({ name: m.name, role: m.role, uid: m.uid, nickname: m.nickname }));
  return { isInitialized: true, members: members, type: isHappy ? "幸福小組" : "一般小組" };
}

/**
 * 確保小組 _名單 sheet 的欄位完整：
 *   A=姓名 B=建立日期 C=身分 D=系統編號 E=排序 F=暱稱
 * 排序為小數字優先（1, 2, 3...），新成員預設給 9999 → 排在最後
 * 暱稱是「該小組對此會友的稱呼」，可空白
 */
function _ensureGroupNameSheetSchema(mSheet) {
  const expected = ["姓名", "建立日期", "身分", "系統編號", "排序", "暱稱"];
  const cur = mSheet.getRange(1, 1, 1, expected.length).getValues()[0];
  expected.forEach((h, i) => {
    if (!cur[i] || String(cur[i]).trim() !== h) {
      mSheet.getRange(1, i + 1).setValue(h);
    }
  });
}

// ── 2. 初始化小組分頁 ─────────────────────────────────────────
//   schema：本地 _名單 = A:姓名 B:建立日期 C:身分 D:系統編號 E:排序 F:暱稱
function initGroup(groupName, members) {
  var lock = LockService.getScriptLock();
  var hasLock = false;
  try {
    lock.waitLock(10000);
    hasLock = true;

    const ss = getGroupSS();

    if (getGroupSheet(groupName + "_名單")) {
      return { success: false, message: "此小組已存在名單" };
    }

    const now = new Date();
    const lookups = getMemberLookups();
    const memberRows = members
      .filter(m => m.name && m.name.trim() !== "")
      .map((m, i) => {
        const name = m.name.trim();
        const uid = lookups.n2u[name] || "";
        return [name, now, m.role || "小羊", uid, i + 1, (m.nickname || "").trim()];
      });

    const mSheet = ss.insertSheet(groupName + "_名單");
    mSheet.appendRow(["姓名", "建立日期", "身分", "系統編號", "排序", "暱稱"]);

    if (memberRows.length > 0) {
      mSheet.getRange(2, 1, memberRows.length, 6).setValues(memberRows);
    }

    const rSheet = ss.insertSheet(groupName + "_點名紀錄");
    rSheet.appendRow(["日期", "出席人員", "缺席人員", "新朋友", "實到人數"]);

    return { success: true, message: "初始化成功" };
  } catch (e) {
    if (!hasLock) {
      return { success: false, message: "伺服器繁忙，請稍後再試..." };
    }
    return { success: false, message: "執行錯誤：" + e.message };
  } finally {
    if (hasLock) {
      lock.releaseLock();
    }
  }
}

// ── 3. 送出點名結果 ──────────────────────────────────────────
//   present/absent 接受 UID 或 姓名 混合，自動正規化為 UID 儲存
function submitAttendance(groupName, date, present, absent, newFriends) {
  var lock = LockService.getScriptLock();
  var hasLock = false;
  try {
    lock.waitLock(10000);
    hasLock = true;

    const rSheet = getGroupSheet(groupName + "_點名紀錄");
    if (!rSheet) return { success: false, message: "找不到紀錄表，請重新初始化" };

    const lookups = getMemberLookups();
    const isHappy = _isHappyGroup(groupName);
    const toUid = (item) => {
      const cleaned = String(item).split('(')[0].trim();
      if (/^LK\d+$/i.test(cleaned)) return cleaned.toUpperCase();
      const uid = lookups.n2u[cleaned];
      if (uid) return uid;
      if (isHappy) return cleaned; // If Happy Group, keep name for BESTs
      return "";
    };
    const presentUids = (present || []).map(toUid).filter(u => u);
    const absentUids  = (absent  || []).map(toUid).filter(u => u);

    const nfList = newFriends ? newFriends.split(/[,，、]/).filter(n => n.trim()) : [];
    const totalCount = presentUids.length + nfList.length;

    rSheet.appendRow([
      date,
      presentUids.join(", "),
      absentUids.join(", "),
      newFriends || "",
      totalCount
    ]);

    firebaseInvalidate(['getStats', 'getAllGroupsStats', 'getWeeklyReport']);
    return { success: true, message: "點名成功" };
  } catch (e) {
    if (!hasLock) {
      return { success: false, message: "伺服器繁忙，請稍後再試..." };
    }
    return { success: false, message: "執行錯誤：" + e.message };
  } finally {
    if (hasLock) {
      lock.releaseLock();
    }
  }
}

// ── 4. 更新小組成員名單 ──
//
// 整合方案 C 後：主日為單一真實來源；支援一個會友屬多組
//  - 新成員：addMember 寫入主日（此組 + 此身分）
//  - 既有成員：解析現有 group/role 字串 → 只更新此組的身分 → 寫回（其他組保留）
//  - 被移除成員：從主日的「所屬小組」+「身分」拿掉此組（保留其他組）
//  - 不從主日刪除整個會友（人還在，只是離開這組）
var _groupRoleCatalogKnownRolesCache = null;

function _groupRoleCatalogDefaults_() {
  return {
    '一般小組': ['小羊', '一般同工', '核心同工', '陪伴同工'],
    '幸福小組': ['BEST', '同工', '福長', '陪伴同工']
  };
}

function _readGroupRoleCatalogStore_() {
  try {
    const raw = PropertiesService.getScriptProperties().getProperty('GROUP_ROLE_CATALOGS_V1');
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (e) {
    return {};
  }
}

function _cleanGroupRoleLabels_(values) {
  if (!Array.isArray(values)) return [];
  const roles = [];
  const seen = new Set();
  values.forEach(value => {
    const role = String(value || '').trim();
    if (!role || role.length > 40) return;
    const key = role.toLocaleLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    roles.push(role);
  });
  return roles;
}

function getGroupRoleCatalog(groupType) {
  const type = String(groupType || '一般小組').trim();
  const defaults = _groupRoleCatalogDefaults_();
  if (!Object.prototype.hasOwnProperty.call(defaults, type)) {
    return { success: false, message: '不支援此小組類型的身分清單。' };
  }

  const saved = _readGroupRoleCatalogStore_()[type];
  const configured = Array.isArray(saved) ? saved : (saved && saved.roles);
  const roles = _cleanGroupRoleLabels_(configured);
  return { success: true, groupType: type, roles: roles.length ? roles : defaults[type] };
}

function _isGroupRoleCatalogAdmin_(authCode) {
  let decryptedCode = '';
  try {
    decryptedCode = String(decryptGroupCode(String(authCode || '')) || '').trim().toUpperCase();
  } catch (e) {
    decryptedCode = String(authCode || '').trim().toUpperCase();
  }
  return decryptedCode === ADMIN_CODE;
}

function verifyGroupRoleAdmin(authCode) {
  const isAdmin = _isGroupRoleCatalogAdmin_(authCode);
  return {
    success: isAdmin,
    isAdmin,
    message: isAdmin ? '' : '管理者驗證未通過。'
  };
}

function saveGroupRoleCatalog(groupType, roleValues, authCode) {
  if (!_isGroupRoleCatalogAdmin_(authCode)) {
    return { success: false, message: '管理者驗證未通過。' };
  }

  const type = String(groupType || '').trim();
  if (!Object.prototype.hasOwnProperty.call(_groupRoleCatalogDefaults_(), type)) {
    return { success: false, message: '不支援此小組類型的身分清單。' };
  }
  if (!Array.isArray(roleValues) || roleValues.length > 30) {
    return { success: false, message: '身分選項需為 1 至 30 個。' };
  }
  if (roleValues.some(value => String(value || '').trim().length > 40)) {
    return { success: false, message: '身分名稱最多 40 個字元。' };
  }
  const roles = _cleanGroupRoleLabels_(roleValues);
  if (!roles.length || roles.length > 30) {
    return { success: false, message: '至少保留一個身分選項，且最多可設定 30 個。' };
  }

  const lock = LockService.getScriptLock();
  let hasLock = false;
  let savedRoles = null;
  try {
    lock.waitLock(10000);
    hasLock = true;
    const props = PropertiesService.getScriptProperties();
    const store = _readGroupRoleCatalogStore_();
    const previous = store[type] || {};
    const previousRoles = Array.isArray(previous) ? previous : (previous.roles || []);
    const previousRetired = Array.isArray(previous.retiredRoles) ? previous.retiredRoles : [];
    const activeKeys = new Set(roles.map(role => role.toLocaleLowerCase()));
    const retired = _cleanGroupRoleLabels_(previousRetired.concat(previousRoles))
      .filter(role => !activeKeys.has(role.toLocaleLowerCase()));

    store[type] = { roles, retiredRoles: retired };
    props.setProperty('GROUP_ROLE_CATALOGS_V1', JSON.stringify(store));
    _groupRoleCatalogKnownRolesCache = null;
    savedRoles = roles;
  } catch (e) {
    if (!hasLock) return { success: false, message: '伺服器繁忙，請稍後再試。' };
    return { success: false, message: '儲存身分清單失敗：' + e.message };
  } finally {
    if (hasLock) lock.releaseLock();
  }

  // Script Properties remains the admin-controlled source of truth. Mirror the
  // saved catalog into the shared Firebase read cache so other clients can load
  // it without another GAS request; invalidate first to reject any in-flight
  // stale catalog read, then seed the exact read key with the new value.
  try {
    if (typeof firebaseInvalidate === 'function') {
      firebaseInvalidate(['getGroupRoleCatalog']);
    }
    if (typeof firebaseCacheWriteThrough === 'function') {
      firebaseCacheWriteThrough('getGroupRoleCatalog', { groupType: type }, {
        success: true,
        groupType: type,
        roles: savedRoles
      });
    }
  } catch (e) {
    console.log('[firebase] group role catalog cache sync failed: ' + e.message);
  }
  return { success: true, groupType: type, roles: savedRoles };
}

function _getKnownGroupRoleLabels_() {
  if (Array.isArray(_groupRoleCatalogKnownRolesCache)) return _groupRoleCatalogKnownRolesCache;
  const store = _readGroupRoleCatalogStore_();
  const defaults = _groupRoleCatalogDefaults_();
  const allRoles = defaults['一般小組'].concat(defaults['幸福小組']);
  Object.keys(store).forEach(type => {
    const entry = store[type];
    if (Array.isArray(entry)) {
      allRoles.push.apply(allRoles, entry);
      return;
    }
    if (entry && typeof entry === 'object') {
      if (Array.isArray(entry.roles)) allRoles.push.apply(allRoles, entry.roles);
      if (Array.isArray(entry.retiredRoles)) allRoles.push.apply(allRoles, entry.retiredRoles);
    }
  });
  _groupRoleCatalogKnownRolesCache = _cleanGroupRoleLabels_(allRoles);
  return _groupRoleCatalogKnownRolesCache;
}

function updateMemberList(groupName, members) {
  var lock = LockService.getScriptLock();
  var hasLock = false;
  try {
    lock.waitLock(10000);
    hasLock = true;

    const isHappy = _isHappyGroup(groupName);

    // 先拿鎖，然後才讀取最新的會友名單做差異分析 (diff)
    const allMembers = getCachedMembers();
    const masterByName = {};
    allMembers.forEach(m => {
      const name = m[0] ? String(m[0]).trim() : "";
      if (name) {
        masterByName[name] = {
          groupStr: m[8] ? String(m[8]).trim() : "",
          roleStr:  m[9] ? String(m[9]).trim() : ""
        };
      }
    });

    // 處理「被移除」的會友（之前在此組，新名單沒有）
    const newNames = new Set(members.map(m => (m.name || '').trim()).filter(n => n));
    const previouslyInGroup = allMembers
      .filter(m => memberInGroup(m[8], groupName))
      .map(m => ({
        name:   m[0] ? String(m[0]).trim() : "",
        group:  m[8] ? String(m[8]).trim() : "",
        role:   m[9] ? String(m[9]).trim() : ""
      }))
      .filter(m => m.name);

    const errors = [];
    let added = 0, roleUpdated = 0, groupAdded = 0, unchanged = 0, removed = 0;

    // 先處理移除（從 master 的所屬小組/身分拿掉此組，其他組保留）
    previouslyInGroup.forEach(prev => {
      if (newNames.has(prev.name)) return;  // 還在新名單，不處理
      const groupRoles = parseGroupRoles(prev.group, prev.role);
      if (!groupRoles[groupName]) return;   // 異常：原本就不在此組
      delete groupRoles[groupName];
      const formatted = formatGroupRoles(groupRoles);
      try {
        updateMember(prev.name, {
          group: formatted.groupStr,                       // 可能變空字串（沒組）
          role:  formatted.roleStr || '小羊'                // 沒組就回到「小羊」
        });
        removed++;
        // 更新本地 masterByName 快取（避免接下來處理新名單時用到舊資料）
        if (masterByName[prev.name]) {
          masterByName[prev.name].groupStr = formatted.groupStr;
          masterByName[prev.name].roleStr  = formatted.roleStr;
        }
      } catch (e) {
        errors.push(prev.name + "（移除失敗）：" + e.message);
      }
    });

    members.forEach(m => {
      const name = m.name ? m.name.trim() : "";
      const role = m.role || (isHappy ? "BEST" : "小羊");
      if (!name) return;

      // 如果是幸福小組的 BEST/慕道友，跳過寫入主日會友大名單的流程
      if (isHappy && (role === "BEST" || role === "慕道友")) {
        unchanged++;
        return;
      }

      try {
        const existing = masterByName[name];
        if (!existing) {
          // 主日沒這個人 → 新增（單組單身分）
          const result = addMember({ name, gender: "", note: "", isExcluded: false, group: groupName, role });
          if (typeof result === 'string' && result.indexOf('失敗') !== -1) {
            errors.push(name + "：" + result);
          } else {
            added++;
          }
        } else {
          // 已存在：解析 → 更新此組 → 寫回（保留其他組）
          const groupRoles = parseGroupRoles(existing.groupStr, existing.roleStr);
          const currentRoleForThisGroup = groupRoles[groupName];

          if (currentRoleForThisGroup === role) {
            unchanged++;
            return;
          }

          const wasInGroup = currentRoleForThisGroup !== undefined;
          groupRoles[groupName] = role;
          const formatted = formatGroupRoles(groupRoles);

          // partial update：只改 group + role，其他欄位保留
          updateMember(name, {
            group: formatted.groupStr,
            role:  formatted.roleStr
          });

          if (wasInGroup) roleUpdated++;
          else groupAdded++;
        }
      } catch (e) {
        errors.push(name + "：" + e.message);
      }
    });

    if (errors.length > 0) {
      return { success: false, message: "部分異動失敗：" + errors.join("; ") };
    }

    // 寫入新的排序 + 暱稱到 _名單（同時清掉移除的人）
    _saveMemberLocalData(groupName, members);

    firebaseInvalidate(['getAllMembers', 'getAllGroupMembers', 'getMemberSuggestions', 'getStats', 'getAllGroupsStats', 'ministry_getPageConfig', 'ministry_getGroupMembers']);
    return {
      success: true,
      message: `名單已同步至主日（新增同工 ${added}、更新同工身分 ${roleUpdated}、加入此組 ${groupAdded}、移除同工 ${removed}、未動/BEST ${unchanged}）`
    };
  } catch (e) {
    if (!hasLock) {
      return { success: false, message: "伺服器繁忙，請稍後再試..." };
    }
    return { success: false, message: "更新名單發生錯誤：" + e.message };
  } finally {
    if (hasLock) {
      lock.releaseLock();
    }
  }
}

/**
 * 把前端傳來的 members 陣列「覆寫」進 _名單（被移除的人會從 _名單 消失）
 *   - 排序 = 陣列索引 (1, 2, 3...)
 *   - 暱稱 = m.nickname
 *   - 建立日期 = 若該會友原本就在 _名單 → 保留原本日期；否則用 now
 */
function _saveMemberLocalData(groupName, members) {
  const mSheet = getGroupSheet(groupName + "_名單");
  if (!mSheet) return;
  _ensureGroupNameSheetSchema(mSheet);

  // 先讀現有資料，保留每個會友的「建立日期」
  const lastRow = mSheet.getLastRow();
  const originalDates = {};   // name -> date
  if (lastRow > 1) {
    mSheet.getRange(2, 1, lastRow - 1, 6).getValues().forEach(row => {
      const name = row[0] ? String(row[0]).trim() : "";
      if (name && row[1]) originalDates[name] = row[1];
    });
    // 清空舊資料
    mSheet.getRange(2, 1, lastRow - 1, 6).clearContent();
  }

  if (!members || members.length === 0) return;

  const lookups = getMemberLookups();
  const now = new Date();
  const rows = members
    .filter(m => m && m.name && m.name.trim())
    .map((m, i) => {
      const name = m.name.trim();
      const uid = m.uid || lookups.n2u[name] || '';
      return [
        name,
        originalDates[name] || now,
        m.role || '小羊',
        uid,
        i + 1,                                                     // 排序
        m.nickname !== undefined ? String(m.nickname).trim() : ''  // 暱稱
      ];
    });

  if (rows.length > 0) {
    mSheet.getRange(2, 1, rows.length, 6).setValues(rows);
  }
}

// ── 5. 修改歷史點名紀錄 ──────────────────────────────────────
//   present/absent 接受 UID 或 姓名 混合，自動正規化為 UID 儲存
function updateAttendanceRecord(groupName, originalDate, newDate, present, absent, newFriends) {
  var lock = LockService.getScriptLock();
  var hasLock = false;
  try {
    lock.waitLock(10000);
    hasLock = true;

    const rSheet = getGroupSheet(groupName + "_點名紀錄");
    if (!rSheet) return { success: false, message: "找不到紀錄表" };

    const targetRowIndex = _findAttendanceRowByDate(rSheet, originalDate);
    if (targetRowIndex === -1) {
      return { success: false, message: "找不到該日期的紀錄，無法修改" };
    }

    const lookups = getMemberLookups();
    const isHappy = _isHappyGroup(groupName);
    const toUid = (item) => {
      const cleaned = String(item).split('(')[0].trim();
      if (/^LK\d+$/i.test(cleaned)) return cleaned.toUpperCase();
      const uid = lookups.n2u[cleaned];
      if (uid) return uid;
      if (isHappy) return cleaned; // If Happy Group, keep name for BESTs
      return "";
    };
    const presentUids = (present || []).map(toUid).filter(u => u);
    const absentUids  = (absent  || []).map(toUid).filter(u => u);

    const nfList = newFriends ? newFriends.split(/[,，、]/).filter(n => n.trim()) : [];
    const totalCount = presentUids.length + nfList.length;

    rSheet.getRange(targetRowIndex, 1, 1, 5).setValues([[
      newDate,
      presentUids.join(", "),
      absentUids.join(", "),
      newFriends || "",
      totalCount
    ]]);

    firebaseInvalidate(['getStats', 'getAllGroupsStats', 'getWeeklyReport']);
    return { success: true, message: "紀錄修改成功" };
  } catch (e) {
    if (!hasLock) {
      return { success: false, message: "伺服器繁忙，請稍後再試..." };
    }
    return { success: false, message: "修改紀錄發生錯誤：" + e.message };
  } finally {
    if (hasLock) {
      lock.releaseLock();
    }
  }
}

// ── 6. 刪除整筆點名紀錄 ──────────────────────────────────────
function deleteAttendanceRecord(groupName, originalDate) {
  var lock = LockService.getScriptLock();
  var hasLock = false;
  try {
    lock.waitLock(10000);
    hasLock = true;

    const rSheet = getGroupSheet(groupName + "_點名紀錄");
    if (!rSheet) return { success: false, message: "找不到紀錄表" };

    const targetRowIndex = _findAttendanceRowByDate(rSheet, originalDate);
    if (targetRowIndex !== -1) {
      rSheet.deleteRow(targetRowIndex);
      firebaseInvalidate(['getStats', 'getAllGroupsStats', 'getWeeklyReport']);
      return { success: true, message: "紀錄刪除成功" };
    }
    return { success: false, message: "找不到該日期的紀錄" };
  } catch (e) {
    if (!hasLock) {
      return { success: false, message: "伺服器繁忙，請稍後再試..." };
    }
    return { success: false, message: "刪除紀錄發生錯誤：" + e.message };
  } finally {
    if (hasLock) {
      lock.releaseLock();
    }
  }
}

// 共用：依日期字串 (yyyy-MM-dd, GMT+8) 找列數
function _findAttendanceRowByDate(rSheet, dateStr) {
  const data = rSheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    const d = new Date(data[i][0]);
    if (Utilities.formatDate(d, "GMT+8", "yyyy-MM-dd") === dateStr) {
      return i + 1;
    }
  }
  return -1;
}

// ── 7. 幸福小組結案、刪除與雲端封存 ──────────────────────────────────────

function happyGroup_conclude(groupName, bestToUpgrade, authCode) {
  var lock = LockService.getScriptLock();
  var hasLock = false;
  try {
    lock.waitLock(15000); // 延長等待鎖，因為要處理多個小組與 Drive
    hasLock = true;

    // 1. 權限驗證
    const decrypted = decryptGroupCode(authCode).trim().toUpperCase();
    if (decrypted !== ADMIN_CODE) {
      const verifyRes = verifyGroup(groupName, authCode);
      if (!verifyRes.success) {
        return { success: false, message: "權限不足，驗證失敗" };
      }
    }

    // 2. 檢查小組是否存在
    const listSheet = getGroupSheet("小組清單");
    if (!listSheet) return { success: false, message: "找不到小組清單" };
    _ensureGroupListSchema(listSheet);

    const listData = listSheet.getDataRange().getValues();
    let targetRowIndex = -1;
    let isHappy = false;
    for (let i = 1; i < listData.length; i++) {
      if (listData[i][0] && String(listData[i][0]).trim() === String(groupName).trim()) {
        targetRowIndex = i + 1;
        isHappy = (String(listData[i][5] || "").trim() === "幸福小組");
        break;
      }
    }

    if (targetRowIndex === -1) return { success: false, message: "找不到該小組" };

    const status = String(listData[targetRowIndex - 1][1] || "").trim();
    if (status === "結案") return { success: false, message: "該小組已經是結案狀態" };

    const mSheet = getGroupSheet(groupName + "_名單");
    const rSheet = getGroupSheet(groupName + "_點名紀錄");
    if (!mSheet || !rSheet) return { success: false, message: "找不到小組名單或點名紀錄表" };

    // 3. 升級會友 (僅限幸福小組 BEST to Regular Groups)
    let upgradeCount = 0;
    if (isHappy && bestToUpgrade && bestToUpgrade.length > 0) {
      bestToUpgrade.forEach(best => {
        const name = String(best.name || "").trim();
        const gender = String(best.gender || "").trim();
        const note = String(best.note || "幸福小組升級").trim();
        const targetGroup = String(best.targetGroup || "").trim();
        if (!name || !targetGroup) return;

        // 調用 addMember 新增會友，此處會自動產生新 UID
        const addRes = addMember({
          name: name,
          gender: gender,
          note: note,
          isExcluded: false,
          group: targetGroup,
          role: "小羊"
        });
        if (addRes && addRes.indexOf("新增成功") !== -1) {
          upgradeCount++;
        }
      });
    }

    // 4. 整理數據並歷史封存成 JSON 儲存在 Google Drive
    const membersData = mSheet.getDataRange().getValues();
    const recordsData = rSheet.getDataRange().getValues();

    const members = [];
    for (let i = 1; i < membersData.length; i++) {
      const row = membersData[i];
      if (row[0]) {
        members.push({
          name: String(row[0]).trim(),
          date: row[1],
          role: String(row[2] || "").trim(),
          uid: String(row[3] || "").trim(),
          order: row[4],
          nickname: String(row[5] || "").trim()
        });
      }
    }

    const records = [];
    let startDateStr = "";
    let endDateStr = "";
    const lookups = getMemberLookups();

    for (let i = 1; i < recordsData.length; i++) {
      const row = recordsData[i];
      if (row[0]) {
        const d = new Date(row[0]);
        const dateStr = Utilities.formatDate(d, "GMT+8", "yyyy-MM-dd");
        if (i === 1) startDateStr = dateStr;
        endDateStr = dateStr;

        // 解析出席與缺席 UIDs 轉回姓名（保留 BEST 姓名）
        const presentUids = _happyParseUidOrNameSet(row[1] || "", lookups);
        const absentUids  = _happyParseUidOrNameSet(row[2] || "", lookups);

        records.push({
          date: dateStr,
          present: Array.from(presentUids),
          absent: Array.from(absentUids),
          newFriends: String(row[3] || "").trim(),
          total: row[4]
        });
      }
    }

    if (!startDateStr) startDateStr = "無紀錄";
    if (!endDateStr) endDateStr = "無紀錄";

    const archiveObj = {
      groupName: groupName,
      startDate: startDateStr,
      endDate: endDateStr,
      members: members,
      records: records
    };

    const folderId = "1yWfpW8CRThJu0DOlxda7xZRvmvUcGXXY";
    const folder = DriveApp.getFolderById(folderId);
    const fileName = `${groupName}_${startDateStr}_${endDateStr}.json`;
    
    // 如果已有同名檔案，先刪除舊檔案以覆蓋
    const existingFiles = folder.getFilesByName(fileName);
    while (existingFiles.hasNext()) {
      existingFiles.next().setTrashed(true);
    }
    
    folder.createFile(fileName, JSON.stringify(archiveObj, null, 2), MimeType.PLAIN_TEXT);

    // 5. 從主日會友大名單中清除該小組的關聯欄位（保留會友姓名與編號）
    try {
      const allMasterMembers = getCachedMembers();
      allMasterMembers.forEach(m => {
        const name = m[0] ? String(m[0]).trim() : "";
        const groupStr = m[8] ? String(m[8]).trim() : "";
        const roleStr = m[9] ? String(m[9]).trim() : "";
        if (name && memberInGroup(groupStr, groupName)) {
          const groupRoles = parseGroupRoles(groupStr, roleStr);
          if (groupRoles[groupName] !== undefined) {
            delete groupRoles[groupName];
            const formatted = formatGroupRoles(groupRoles);
            updateMember(name, {
              group: formatted.groupStr,
              role: formatted.roleStr || '小羊'
            });
          }
        }
      });
    } catch (e) {
      console.log("移除會友名單小組關聯時發生錯誤: " + e.message);
    }

    // 6. 更新小組清單狀態為「結案」
    listSheet.getRange(targetRowIndex, 2).setValue("結案");

    _rebuildGroupsCache();
    firebaseInvalidate(['getGroups', 'getAdminGroupsList', 'ministry_getGroups', 'getStats', 'getAllGroupsStats', 'getWeeklyReport']);

    let upgradeMsg = isHappy ? `已升級 ${upgradeCount} 位新會友，` : "";
    return {
      success: true,
      message: `結案封存成功！${upgradeMsg}點名歷史已保存為 JSON 並寫入雲端硬碟。`
    };

  } catch (e) {
    if (!hasLock) {
      return { success: false, message: "伺服器繁忙，請稍後再試..." };
    }
    return { success: false, message: "結案過程中發生錯誤：" + e.message };
  } finally {
    if (hasLock) {
      lock.releaseLock();
    }
  }
}

function happyGroup_delete(groupName, authCode) {
  var lock = LockService.getScriptLock();
  var hasLock = false;
  try {
    lock.waitLock(10000);
    hasLock = true;

    // 1. 驗證管理員密碼
    const decrypted = decryptGroupCode(authCode).trim().toUpperCase();
    if (decrypted !== ADMIN_CODE) {
      return { success: false, message: "權限不足，只有管理員可以刪除小組" };
    }

    // 2. 找到小組清單列
    const listSheet = getGroupSheet("小組清單");
    if (!listSheet) return { success: false, message: "找不到小組清單" };
    _ensureGroupListSchema(listSheet);

    const listData = listSheet.getDataRange().getValues();
    let targetRowIndex = -1;
    let status = "";
    let uuid = "";
    for (let i = 1; i < listData.length; i++) {
      if (listData[i][0] && String(listData[i][0]).trim() === String(groupName).trim()) {
        targetRowIndex = i + 1;
        status = String(listData[i][1] || "").trim();
        uuid = String(listData[i][4] || "").trim();
        break;
      }
    }

    if (targetRowIndex === -1) return { success: false, message: "找不到該小組" };
    if (status !== "結案") return { success: false, message: "該小組尚未結案封存，請先進行『結案』動作！" };

    // 3. 刪除小組系統中的工作表
    const ss = getGroupSS();
    const mSheet = ss.getSheetByName(groupName + "_名單");
    const rSheet = ss.getSheetByName(groupName + "_點名紀錄");
    if (mSheet) ss.deleteSheet(mSheet);
    if (rSheet) ss.deleteSheet(rSheet);

    // 4. 從小組系統清單中移除
    listSheet.deleteRow(targetRowIndex);

    // 5. 同步刪除事工管理系統中的關聯
    try {
      const minSs = SpreadsheetApp.openById(MINISTRY_SHEET_ID);
      const minConfigSheet = minSs.getSheetByName("Config");
      if (minConfigSheet) {
        const minConfigData = minConfigSheet.getDataRange().getValues();
        let minTargetRow = -1;
        let minGroupName = "";
        
        for (let i = 1; i < minConfigData.length; i++) {
          const rowUuid = minConfigData[i][0] ? String(minConfigData[i][0]).trim() : "";
          const rowName = minConfigData[i][2] ? String(minConfigData[i][2]).trim() : "";
          
          if ((uuid && rowUuid === uuid) || (rowName && rowName === String(groupName).trim())) {
            minTargetRow = i + 1;
            minGroupName = rowName;
            break;
          }
        }
        
        if (minTargetRow !== -1) {
          // 刪除事工管理中的小組分頁
          if (minGroupName) {
            const minSheetToDelete = minSs.getSheetByName(minGroupName);
            if (minSheetToDelete) {
              minSs.deleteSheet(minSheetToDelete);
            }
          }
          // 從 Config 中移除
          minConfigSheet.deleteRow(minTargetRow);
          
          // 讓事工管理快取失效
          invalidateMinistryReportCache();
          _invalidateMinistryGroupsCache();
        }
      }
    } catch (minErr) {
      console.log("同步刪除事工管理分頁失敗: " + minErr.message);
    }

    _rebuildGroupsCache();
    firebaseInvalidate(['getGroups', 'getAdminGroupsList', 'ministry_getGroups', 'getStats', 'getAllGroupsStats', 'getWeeklyReport', 'ministry_getAggregatedReport']);

    return { success: true, message: `小組【${groupName}】及其事工管理分頁已被管理員徹底刪除。` };

  } catch (e) {
    if (!hasLock) {
      return { success: false, message: "伺服器繁忙，請稍後再試..." };
    }
    return { success: false, message: "刪除過程中發生錯誤：" + e.message };
  } finally {
    if (hasLock) {
      lock.releaseLock();
    }
  }
}

function happyGroup_getArchives() {
  try {
    const folderId = "1yWfpW8CRThJu0DOlxda7xZRvmvUcGXXY";
    const folder = DriveApp.getFolderById(folderId);
    const files = folder.getFiles();
    const list = [];
    while (files.hasNext()) {
      const file = files.next();
      const name = file.getName();
      if (name.endsWith(".json")) {
        list.push({
          name: name,
          id: file.getId(),
          created: file.getDateCreated()
        });
      }
    }
    list.sort((a, b) => b.name.localeCompare(a.name));
    return { success: true, files: list };
  } catch (e) {
    return { success: false, message: "讀取歷史檔案失敗：" + e.message };
  }
}

function happyGroup_getArchiveContent(fileId) {
  try {
    const file = DriveApp.getFileById(fileId);
    const contentStr = file.getAs("application/json").getDataAsString();
    const content = JSON.parse(contentStr);
    return { success: true, content: content };
  } catch (e) {
    try {
      const file = DriveApp.getFileById(fileId);
      const contentStr = file.getBlob().getDataAsString("UTF-8");
      const content = JSON.parse(contentStr);
      return { success: true, content: content };
    } catch (ex) {
      return { success: false, message: "讀取檔案內容失敗：" + e.message };
    }
  }
}

function _happyParseUidOrNameSet(listStr, lookups) {
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
      if (uid) {
        set.add(uid);
      } else {
        set.add(cleaned); // Keep BEST name
      }
    }
  });
  return set;
}
