/**
 * FirebaseSync.js — GAS 端寫入 Firebase Realtime Database
 *
 * 認證方式：Service Account（OAuth2 with JWT）— Google 推薦
 *
 * ─── 一次性設定（必做）─────────────────────────────────
 *   1. GAS 編輯器 → ⚙ 專案設定 → 「指令碼屬性」 → 新增屬性：
 *      Key:   FIREBASE_SERVICE_ACCOUNT
 *      Value: <貼上整份 service account JSON 內容>
 *
 *   2. 函式選 setupAllOnEditTriggers → ▶ 執行
 */

const FIREBASE_DB_URL = 'https://lkc1958june1-default-rtdb.asia-southeast1.firebasedatabase.app';
const FIREBASE_CACHE_SCHEMA_VERSION = 2;
const FIREBASE_PENDING_RECONCILE_LIMIT = 20;
const FIREBASE_PENDING_MARKER_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// Mirrors the browser cacheable read contract.  New entries are written only
// by GAS after a successful read; legacy entries without this metadata are a
// safe browser miss and are rebuilt through the normal API path.
const FIREBASE_CACHEABLE_ACTIONS = new Set([
  'getGroups', 'getGroupConfig', 'getGroupRoleCatalog', 'getWeeklyReport', 'getAllMembers',
  'getAdminGroupsList', 'getAllGroupMembers', 'getMemberSuggestions',
  'getSmartAttendanceList', 'checkGroupStatus', 'getStats', 'getAllGroupsStats',
  'getAttendanceStats', 'getAttendanceTrend', 'getCategoryChartData',
  'ministry_getGroups', 'ministry_getTemplates', 'ministry_getAggregatedReport',
  'ministry_getPageConfig', 'ministry_getGroupMembers', 'ministry_getMemberSuggestions',
  'getSchedule', 'getScheduleByDateRange', 'getPositions', 'getTeamMembers', 'getSongs',
  'worship_getSchedule', 'worship_getScheduleByDateRange', 'worship_getPositions',
  'worship_getTeamMembers', 'worship_getSongs', 'worship_getMemberSuggestions',
  'cal_getTypes', 'cal_getFields', 'cal_getEvents', 'cal_getEvent'
]);

function _firebaseGenerationProperty(topic) {
  return 'FB_CACHE_GENERATION_' + String(topic || '').replace(/[^a-zA-Z0-9_]/g, '_');
}

function _firebaseTopicGeneration(topic) {
  try {
    const props = PropertiesService.getScriptProperties();
    const value = Number(props.getProperty(_firebaseGenerationProperty(topic)) || 1);
    return Number.isInteger(value) && value > 0 ? value : 1;
  } catch (e) {
    return 1;
  }
}

// Capture this before a cacheable handler starts its Sheet read.  The value is
// then carried to write-through, rather than being sampled after a slow read
// has already returned an old snapshot.
function firebaseCaptureCacheRevision(topic) {
  return _firebaseTopicGeneration(topic);
}

// Publishing an entry and invalidating a topic must not interleave their RTDB
// requests.  This is intentionally a short publish barrier only: Sheet reads
// run outside it, and the captured revision below is still the stale-read
// guard.  Older/unit-test environments without LockService retain the
// revision check, while deployed GAS uses the shared script lock.
function _withFirebaseCacheRevisionBarrier(callback) {
  let lock = null;
  let acquired = false;
  try {
    if (typeof LockService !== 'undefined' && LockService.getScriptLock) {
      lock = LockService.getScriptLock();
      if (lock && typeof lock.tryLock === 'function') {
        acquired = lock.tryLock(5000);
        if (!acquired) throw new Error('Firebase cache revision barrier busy');
      } else if (lock && typeof lock.waitLock === 'function') {
        lock.waitLock(5000);
        acquired = true;
      }
    }
    return callback();
  } finally {
    if (lock && acquired && typeof lock.releaseLock === 'function') lock.releaseLock();
  }
}

function _bumpFirebaseTopicGeneration(topic) {
  const generation = _firebaseTopicGeneration(topic) + 1;
  try {
    const props = PropertiesService.getScriptProperties();
    if (typeof props.setProperty === 'function') {
      props.setProperty(_firebaseGenerationProperty(topic), String(generation));
    }
  } catch (e) {
    console.log('[firebase] generation bump failed for ' + topic + ': ' + e.message);
  }
  return generation;
}

function _firebaseCacheSubkey(requestData) {
  if (!requestData || typeof requestData !== 'object' || Object.keys(requestData).length === 0) {
    return '_default';
  }
  const json = JSON.stringify(requestData);
  // Matches config.js _makeSubkey: UTF-8 base64, then remove RTDB-unsafe chars.
  return Utilities.base64Encode(json, Utilities.Charset.UTF_8).replace(/[^a-zA-Z0-9]/g, '');
}

function _firebaseResponseIsCacheable(response) {
  if (!response || typeof response !== 'object') return true;
  if (response.status && response.status !== 'success') return false;
  if (response.success === false || response.error) return false;
  if (response.data && typeof response.data === 'object' && response.data.success === false) return false;
  return true;
}

function _recordFirebaseSyncFailure(topic, error) {
  try {
    const props = PropertiesService.getScriptProperties();
    if (typeof props.setProperty === 'function') {
      props.setProperty('FB_CACHE_REFRESH_PENDING_' + String(topic || '').replace(/[^a-zA-Z0-9_]/g, '_'),
        JSON.stringify({ topic: String(topic || ''), updatedAt: Date.now(), error: String(error || '') }));
    }
  } catch (e) {
    console.log('[firebase] unable to record pending refresh: ' + e.message);
  }
}

function _clearFirebaseSyncFailure(topic) {
  try {
    const props = PropertiesService.getScriptProperties();
    if (typeof props.deleteProperty === 'function') {
      props.deleteProperty('FB_CACHE_REFRESH_PENDING_' + String(topic || '').replace(/[^a-zA-Z0-9_]/g, '_'));
    }
  } catch (e) {
    console.log('[firebase] unable to clear pending refresh: ' + e.message);
  }
}

// A Firebase failure must not make the request reread Sheets. Instead, retain
// a small server-side repair marker; the low-frequency reconciliation trigger
// retries the affected topics without using browser traffic as a warm-up job.
function firebaseReconcilePendingTopics() {
  try {
    const props = PropertiesService.getScriptProperties();
    if (typeof props.getProperties !== 'function') return { attempted: 0, repaired: 0 };
    const pendingPrefix = 'FB_CACHE_REFRESH_PENDING_';
    const now = Date.now();
    const uniqueByTopic = {};
    Object.keys(props.getProperties())
      .filter(key => key.indexOf(pendingPrefix) === 0)
      .forEach(key => {
        let marker;
        try { marker = JSON.parse(props.getProperty(key) || '{}'); } catch (e) { marker = {}; }
        const topic = marker.topic || '';
        const updatedAt = Number(marker.updatedAt || 0);
        const isAllowed = FIREBASE_CACHEABLE_ACTIONS.has(topic);
        const isExpired = !updatedAt || now - updatedAt > FIREBASE_PENDING_MARKER_MAX_AGE_MS;
        if (!isAllowed || isExpired) {
          if (typeof props.deleteProperty === 'function') props.deleteProperty(key);
          return;
        }
        const previous = uniqueByTopic[topic];
        if (!previous || updatedAt > previous.updatedAt) uniqueByTopic[topic] = { key: key, updatedAt: updatedAt };
      });

    const selectedTopics = Object.keys(uniqueByTopic).slice(0, FIREBASE_PENDING_RECONCILE_LIMIT);
    if (selectedTopics.length === 0) return { attempted: 0, repaired: 0 };
    const pendingKeys = selectedTopics.map(topic => uniqueByTopic[topic].key);
    const topics = selectedTopics.map(topic => {
      try {
        const marker = JSON.parse(props.getProperty(uniqueByTopic[topic].key) || '{}');
        return marker.topic || topic;
      } catch (e) {
        return topic;
      }
    }).filter(Boolean);
    const result = firebaseInvalidate(topics);
    if (result.mode === 'batch' && typeof props.deleteProperty === 'function') {
      pendingKeys.forEach(key => props.deleteProperty(key));
      return { attempted: topics.length, repaired: topics.length };
    }
    return { attempted: topics.length, repaired: 0 };
  } catch (e) {
    console.log('[firebase] pending reconciliation failed: ' + e.message);
    return { attempted: 0, repaired: 0, error: e.message };
  }
}

// ═══════════════════════════════════════════════════════════
//  OAuth2 token 取得（含 cache，1 小時內共用同一個 token）
// ═══════════════════════════════════════════════════════════
function _getFirebaseAccessToken() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('FB_ACCESS_TOKEN');
  if (cached) return cached;

  const props = PropertiesService.getScriptProperties();
  const saJson = props.getProperty('FIREBASE_SERVICE_ACCOUNT');
  if (!saJson) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT 未設定（指令碼屬性）');
  }

  let sa;
  try {
    sa = JSON.parse(saJson);
  } catch (e) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT JSON 格式錯誤：' + e.message);
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email',
    aud: sa.token_uri || 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  };

  // Base64URL encode (Web-safe，去掉尾端 =)
  const b64url = (s) => Utilities.base64EncodeWebSafe(s).replace(/=+$/, '');
  const encHeader = b64url(JSON.stringify(header));
  const encClaim = b64url(JSON.stringify(claim));
  const toSign = encHeader + '.' + encClaim;

  // 用 service account 私鑰簽 RS256
  const signature = Utilities.computeRsaSha256Signature(toSign, sa.private_key);
  const encSig = Utilities.base64EncodeWebSafe(signature).replace(/=+$/, '');
  const jwt = toSign + '.' + encSig;

  // 換 access token
  const resp = UrlFetchApp.fetch(claim.aud, {
    method: 'post',
    payload: {
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    },
    muteHttpExceptions: true
  });

  const result = JSON.parse(resp.getContentText());
  if (result.error) {
    throw new Error('Firebase OAuth 失敗：' + JSON.stringify(result));
  }

  const token = result.access_token;
  // Token 有效 1 小時，cache 存 58 分鐘留 buffer
  cache.put('FB_ACCESS_TOKEN', token, 3500);
  return token;
}

// ═══════════════════════════════════════════════════════════
//  Firebase RTDB 寫/刪 API
// ═══════════════════════════════════════════════════════════

/**
 * 寫入 Firebase cache 路徑：cache/{topic}/{subkey}
 */
function firebaseCacheSet(topic, subkey, value, ttlSeconds, metadata) {
  try {
    const sourceRevision = Number(metadata && metadata.sourceRevision);
    const currentRevision = _firebaseTopicGeneration(topic);
    if (Number.isInteger(sourceRevision) && sourceRevision > 0 && sourceRevision !== currentRevision) {
      const error = 'stale source revision ' + sourceRevision + ' (current ' + currentRevision + ')';
      _recordFirebaseSyncFailure(topic, error);
      return { ok: true, skipped: true, stale: true, cacheRefreshPending: true };
    }
    const token = _getFirebaseAccessToken();
    const sk = subkey || '_default';
    const url = FIREBASE_DB_URL + '/cache/' + encodeURIComponent(topic) + '/' + encodeURIComponent(sk) + '.json';
    const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : null;
    const now = Date.now();
    const response = UrlFetchApp.fetch(url, {
      method: 'put',
      contentType: 'application/json',
      headers: { 'Authorization': 'Bearer ' + token },
      payload: JSON.stringify({
        value: value,
        expiresAt: expiresAt,
        updatedAt: now,
        schemaVersion: (metadata && metadata.schemaVersion) || FIREBASE_CACHE_SCHEMA_VERSION,
        generation: (metadata && metadata.generation) || currentRevision,
        sourceRevision: (metadata && metadata.sourceRevision) || currentRevision
      }),
      muteHttpExceptions: true
    });
    const status = response.getResponseCode();
    if (status < 200 || status >= 300) {
      throw new Error('RTDB write HTTP ' + status + ': ' + response.getContentText());
    }
    _clearFirebaseSyncFailure(topic);
    return { ok: true, cacheRefreshPending: false };
  } catch (e) {
    _recordFirebaseSyncFailure(topic, e.message);
    console.log('[firebase] set(' + topic + ') 失敗: ' + e.message);
    return { ok: false, cacheRefreshPending: true, error: e.message };
  }
}

/**
 * The one allowed shared-cache writer.  It never throws into the API response
 * path, so a Firebase outage cannot cause this request to reread Sheets.
 */
function firebaseCacheWriteThrough(topic, requestData, response, sourceRevision) {
  if (!FIREBASE_CACHEABLE_ACTIONS.has(topic) || !_firebaseResponseIsCacheable(response)) {
    return { ok: true, skipped: true, cacheRefreshPending: false };
  }
  // The optional fallback keeps direct legacy callers compatible; Core.js
  // always supplies a revision captured before its handler reads Sheets.
  const snapshotRevision = Number(sourceRevision) || firebaseCaptureCacheRevision(topic);
  try {
    return _withFirebaseCacheRevisionBarrier(() => {
      const currentRevision = _firebaseTopicGeneration(topic);
      if (snapshotRevision !== currentRevision) {
        const error = 'stale source revision ' + snapshotRevision + ' (current ' + currentRevision + ')';
        _recordFirebaseSyncFailure(topic, error);
        return { ok: true, skipped: true, stale: true, cacheRefreshPending: true };
      }
      return firebaseCacheSet(topic, _firebaseCacheSubkey(requestData), response, null, {
        schemaVersion: FIREBASE_CACHE_SCHEMA_VERSION,
        generation: currentRevision,
        sourceRevision: snapshotRevision
      });
    });
  } catch (e) {
    _recordFirebaseSyncFailure(topic, e.message);
    console.log('[firebase] write-through barrier failed for ' + topic + ': ' + e.message);
    return { ok: false, cacheRefreshPending: true, error: e.message };
  }
}

/**
 * 清除整個 topic 下所有 subkey
 */
function firebaseCacheDeleteAll(topic) {
  try {
    const token = _getFirebaseAccessToken();
    const url = FIREBASE_DB_URL + '/cache/' + encodeURIComponent(topic) + '.json';
    UrlFetchApp.fetch(url, {
      method: 'delete',
      headers: { 'Authorization': 'Bearer ' + token },
      muteHttpExceptions: true
    });
  } catch (e) { console.log('[firebase] deleteAll(' + topic + ') 失敗: ' + e.message); }
}

/**
 * 清除單一 subkey
 */
function firebaseCacheDelete(topic, subkey) {
  try {
    const token = _getFirebaseAccessToken();
    const sk = subkey || '_default';
    const url = FIREBASE_DB_URL + '/cache/' + encodeURIComponent(topic) + '/' + encodeURIComponent(sk) + '.json';
    UrlFetchApp.fetch(url, {
      method: 'delete',
      headers: { 'Authorization': 'Bearer ' + token },
      muteHttpExceptions: true
    });
  } catch (e) { console.log('[firebase] delete(' + topic + ',' + sk + ') 失敗: ' + e.message); }
}

/**
 * 批次清除多個 topic
 */
function firebaseInvalidate(topics) {
  if (!topics || !topics.length) return { invalidatedCount: 0, mode: 'none' };
  const uniqueTopics = Array.from(new Set(topics.map(t => String(t || '').trim()).filter(Boolean)));

  try {
    return _withFirebaseCacheRevisionBarrier(() => {
      // Bump before the RTDB delete. A slow writer that already validated and
      // publishes first is subsequently deleted; one that waits sees the new
      // revision and is rejected as stale.
      uniqueTopics.forEach(_bumpFirebaseTopicGeneration);
      const token = _getFirebaseAccessToken();
      const updates = {};
      uniqueTopics.forEach(topic => { updates[topic] = null; });
      const response = UrlFetchApp.fetch(FIREBASE_DB_URL + '/cache.json', {
        method: 'patch',
        contentType: 'application/json',
        headers: { 'Authorization': 'Bearer ' + token },
        payload: JSON.stringify(updates),
        muteHttpExceptions: true
      });
      const status = response.getResponseCode();
      if (status < 200 || status >= 300) {
        throw new Error('RTDB batch invalidation HTTP ' + status + ': ' + response.getContentText());
      }
      return { invalidatedCount: uniqueTopics.length, mode: 'batch' };
    });
  } catch (e) {
    console.log('[firebase] batch invalidate 失敗，改用逐筆刪除: ' + e.message);
    uniqueTopics.forEach(topic => firebaseCacheDeleteAll(topic));
    uniqueTopics.forEach(topic => _recordFirebaseSyncFailure(topic, e.message));
    return { invalidatedCount: uniqueTopics.length, mode: 'fallback' };
  }
}

// ═══════════════════════════════════════════════════════════
//  📊 onEdit triggers — 偵測手動 Sheet 編輯，自動 invalidate
// ═══════════════════════════════════════════════════════════

function onEditMain(e) {
  const sheetName = e.range.getSheet().getName();
  try {
    if (sheetName === '會友名單') {
      invalidateAndRebuildMemberCache();
      firebaseInvalidate(['getAllMembers', 'getAllGroupMembers', 'getMemberSuggestions', 'getStats', 'getAllGroupsStats', 'getAdminGroupsList', 'ministry_getPageConfig', 'ministry_getGroupMembers', 'getAttendanceStats']);
    } else if (sheetName === '點名系統清單') {
      invalidateAndRebuildGroupConfigCache();
      firebaseInvalidate(['getGroupConfig']);
    } else if (/點名紀錄$/.test(sheetName)) {
      firebaseInvalidate(['getAttendanceStats', 'getAttendanceTrend', 'getWeeklyReport']);
    }
  } catch (err) { console.log('[onEditMain] ' + err); }
}

function onEditGroup(e) {
  const sheetName = e.range.getSheet().getName();
  try {
    if (sheetName === '小組清單') {
      _rebuildGroupsCache();
      firebaseInvalidate(['getGroups', 'getAdminGroupsList', 'ministry_getGroups']);
    } else if (sheetName === 'Districts' || sheetName === 'GroupClusters') {
      firebaseInvalidate(['getGroups', 'getAdminGroupsList', 'ministry_getGroups']);
    } else if (/_點名紀錄$/.test(sheetName)) {
      firebaseInvalidate(['getStats', 'getAllGroupsStats', 'getWeeklyReport']);
    } else if (/_名單$/.test(sheetName)) {
      firebaseInvalidate(['getStats', 'ministry_getPageConfig']);
    }
  } catch (err) { console.log('[onEditGroup] ' + err); }
}

function onEditMinistry(e) {
  const sheetName = e.range.getSheet().getName();
  try {
    if (sheetName === 'Config') {
      _invalidateMinistryGroupsCache();
      _invalidateConfigDataCache();
      firebaseInvalidate(['ministry_getGroups', 'ministry_getPageConfig']);
    } else if (sheetName === '模板名稱') {
      firebaseInvalidate(['ministry_getTemplates']);
    } else if (sheetName !== '審計日誌') {
      firebaseInvalidate(['ministry_getPageConfig', 'ministry_getAggregatedReport']);
    }
  } catch (err) { console.log('[onEditMinistry] ' + err); }
}

/**
 * 一次性設定：為 4 個試算表建立 onEdit trigger
 * 在 GAS 編輯器手動執行一次即可
 */
function setupAllOnEditTriggers() {
  ScriptApp.getProjectTriggers().forEach(t => {
    const fn = t.getHandlerFunction();
    if (fn === 'onEditMain' || fn === 'onEditGroup' || fn === 'onEditMinistry' || fn === 'onEditWorshipSheet') {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('onEditMain').forSpreadsheet(getSS()).onEdit().create();
  ScriptApp.newTrigger('onEditGroup').forSpreadsheet(getGroupSS()).onEdit().create();
  ScriptApp.newTrigger('onEditMinistry').forSpreadsheet(getMinistrySS()).onEdit().create();
  try {
    ScriptApp.newTrigger('onEditWorshipSheet').forSpreadsheet(getWorshipSS()).onEdit().create();
    Logger.log('✅ 已建立 4 個 onEdit trigger（主日 / 小組 / 事工 / 敬拜團）');
  } catch (err) {
    Logger.log('⚠️ 建立敬拜團 onEdit trigger 失敗（可能尚未宣告 getWorshipSS 或無權限）：' + err.message);
  }
}

// ═══════════════════════════════════════════════════════════
//  測試 / 維運工具
// ═══════════════════════════════════════════════════════════

/**
 * 測試 Service Account 是否設定正確
 * 在 GAS 編輯器選此函式 ▶ 執行，看 Logger 結果
 */
function testFirebaseAuth() {
  try {
    const token = _getFirebaseAccessToken();
    Logger.log('✅ OAuth token 取得成功（前 30 字元）：' + token.substring(0, 30) + '...');

    // 試寫一筆測試資料
    firebaseCacheSet('_test', 'gas-ping', { msg: 'hello from GAS', ts: new Date().toISOString() }, 60);
    Logger.log('✅ 已寫入測試資料到 cache/_test/gas-ping');
    Logger.log('   去 https://lkc1958june1-default-rtdb.asia-southeast1.firebasedatabase.app/cache/_test/gas-ping.json 看看');
  } catch (e) {
    Logger.log('❌ 認證或寫入失敗：' + e.message);
  }
}

/**
 * 清空所有 Firebase cache（緊急用）
 */
function firebaseCacheClearAll() {
  try {
    const token = _getFirebaseAccessToken();
    UrlFetchApp.fetch(FIREBASE_DB_URL + '/cache.json', {
      method: 'delete',
      headers: { 'Authorization': 'Bearer ' + token },
      muteHttpExceptions: true
    });
    Logger.log('✅ 已清空所有 Firebase cache');
  } catch (e) { Logger.log('❌ 清空失敗：' + e.message); }
}

/**
 * 重新初始化並建立全系統所有觸發器（4小時 keepWarm + 4個編輯快取失效觸發器）
 * 在 GAS 編輯器選擇此函數執行即可。
 */
function setupAllTriggers() {
  setupKeepWarmTrigger();
  setupAllOnEditTriggers();
  Logger.log('🎉 測試版主 GAS 系統所有觸發器已重新初始化設定完成！');
}
