(function(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TaiwaneseWorshipReadApi = api;
  root.worshipReadAPI = api.read;
  root.worshipSyncAPI = api.sync;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(root) {
  let callbackSequence = 0;
  const JSONP_TIMEOUT_MS = 45000;
  const JSONP_READ_ACTIONS = new Set([
    'cal_getEvents',
    'cal_getPptLibraryIndex',
    'cal_getPptLibraryFile',
    'cal_queryBible'
  ]);
  const PPT_LIBRARY_ACTIONS = new Set([
    'cal_getPptLibraryIndex',
    'cal_getPptLibraryFile'
  ]);
  const PPT_LIBRARY_SYNC_ACTIONS = new Set([
    'cal_syncPptHymnIndex'
  ]);

  function timeoutFor(setting, fallback) {
    const value = Number(root[setting]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  function withTimeout(operation, timeoutMs, message, onTimeout) {
    let timer;
    const deadline = new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        const error = new Error(message);
        error.type = 'TIMEOUT';
        reject(error);
        if (onTimeout) onTimeout();
      }, timeoutMs);
    });
    return Promise.race([Promise.resolve().then(operation), deadline])
      .finally(() => clearTimeout(timer));
  }

  function fetchText(url, options, timeoutMs, message) {
    const controller = typeof root.AbortController === 'function' ? new root.AbortController() : null;
    return withTimeout(async () => {
      const response = await root.fetch(url, {
        ...options,
        ...(controller ? { signal: controller.signal } : {})
      });
      if (!response || !response.ok) {
        const error = new Error(`GAS 回傳 HTTP ${response && response.status || 0}`);
        error.type = 'INVALID_RESPONSE';
        throw error;
      }
      return response.text();
    }, timeoutMs, message, () => { if (controller) controller.abort(); });
  }

  function endpointForAction(action) {
    if (PPT_LIBRARY_ACTIONS.has(action) || PPT_LIBRARY_SYNC_ACTIONS.has(action)) {
      return root.LKC_WORSHIP_PPT_LIBRARY_GAS_URL || null;
    }
    return root.GAS_URL;
  }

  function buildJsonpUrl(endpoint, action, data, token, callbackName) {
    const url = new URL(endpoint);
    url.searchParams.set('action', action);
    url.searchParams.set('token', token || '');
    url.searchParams.set('data', JSON.stringify(data || {}));
    url.searchParams.set('callback', callbackName);
    url.searchParams.set('_lkc', `${Date.now()}_${callbackName}`);
    return url.toString();
  }

  function jsonp(endpoint, action, data, token) {
    if (typeof document === 'undefined') return Promise.reject(new Error('JSONP 只能在瀏覽器執行'));
    return new Promise((resolve, reject) => {
      const callbackName = `__lkcWorshipJsonp_${Date.now()}_${++callbackSequence}`;
      const script = document.createElement('script');
      const timeoutMs = Number(root.LKC_JSONP_TIMEOUT_MS) > 0
        ? Number(root.LKC_JSONP_TIMEOUT_MS)
        : JSONP_TIMEOUT_MS;
      let settled = false;
      let timer;
      const removeCallback = () => {
        try { delete root[callbackName]; } catch (_) { root[callbackName] = undefined; }
      };
      const cleanup = ({ keepCallback = false, keepScript = false } = {}) => {
        clearTimeout(timer);
        if (!keepScript) script.remove();
        if (!keepCallback) removeCallback();
      };
      const fail = (error, { keepCallback = false, keepScript = false } = {}) => {
        if (settled) return;
        settled = true;
        cleanup({ keepCallback, keepScript });
        if (keepCallback) root[callbackName] = () => {};
        reject(error);
      };
      timer = setTimeout(() => {
        const error = new Error('雲端行事曆讀取逾時');
        error.type = 'TIMEOUT';
        fail(error, { keepCallback: true, keepScript: true });
      }, timeoutMs);
      root[callbackName] = result => {
        if (settled) return;
        settled = true;
        cleanup();
        if (result && result.success === false) reject(new Error(result.message || '雲端資料讀取失敗'));
        else resolve(result);
      };
      script.async = true;
      script.onload = () => {
        if (settled) {
          cleanup();
          return;
        }
        const error = new Error('GAS 已回傳頁面，但未提供 JSONP 資料');
        error.type = 'INVALID_RESPONSE';
        fail(error);
      };
      script.onerror = () => {
        if (settled) {
          cleanup();
          return;
        }
        fail(new Error('無法連線至雲端行事曆'));
      };
      script.src = buildJsonpUrl(endpoint, action, data, token, callbackName);
      document.head.appendChild(script);
    });
  }

  function parseJsonpPayload(body, callbackName) {
    const text = String(body || '').trim();
    if (text.startsWith('{')) return JSON.parse(text);
    const prefix = `${callbackName}(`;
    const start = text.indexOf(prefix);
    const end = text.lastIndexOf(')');
    if (start < 0 || end <= start) {
      const error = new Error('GAS 回應不是可解析的 JSONP');
      error.type = 'INVALID_RESPONSE';
      throw error;
    }
    return JSON.parse(text.slice(start + prefix.length, end).replace(/;\s*$/, '').trim());
  }

  async function fetchJsonp(endpoint, action, data, token) {
    if (typeof root.fetch !== 'function') throw new Error('瀏覽器 fetch 尚未載入');
    const callbackName = `__lkcWorshipFetch_${Date.now()}_${++callbackSequence}`;
    const body = await fetchText(
      buildJsonpUrl(endpoint, action, data, token, callbackName),
      { credentials: 'omit' },
      timeoutFor('LKC_GAS_FETCH_TIMEOUT_MS', JSONP_TIMEOUT_MS),
      'PPT 資料庫備援讀取逾時'
    );
    const result = parseJsonpPayload(body, callbackName);
    if (result && result.success === false) throw new Error(result.message || '雲端資料讀取失敗');
    return result;
  }

  async function postJson(endpoint, action, data, token) {
    if (typeof root.fetch !== 'function') throw new Error('瀏覽器 fetch 尚未載入');
    const body = await fetchText(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      credentials: 'omit',
      body: JSON.stringify({ action, token: token || '', data: data || {} })
    }, timeoutFor('LKC_PPT_SYNC_POST_TIMEOUT_MS', 15000), '聖詩索引同步 POST 逾時');
    let result;
    try {
      result = JSON.parse(body);
    } catch (error) {
      const parseError = new Error('GAS 回應不是可解析 JSON');
      parseError.type = 'INVALID_RESPONSE';
      parseError.cause = error;
      throw parseError;
    }
    if (result && result.success === false) {
      const error = new Error(result.message || 'PPT Library 同步失敗');
      error.type = 'BACKEND_ERROR';
      throw error;
    }
    return result;
  }

  function isGithubPages() {
    const hostname = String(root.location && root.location.hostname || '').toLowerCase();
    return hostname === 'github.io' || hostname.endsWith('.github.io');
  }

  function shouldPreferJsonp(action) {
    if (!JSONP_READ_ACTIONS.has(action) || !root.location) return false;
    return root.location.protocol === 'file:' || isGithubPages();
  }

  function isJsonTransportError(error) {
    if (!error) return false;
    if (error.name === 'SyntaxError' || ['INVALID_RESPONSE', 'TIMEOUT', 'GAS_TIMEOUT', 'GAS_HTML_ERROR'].includes(error.type)) return true;
    const message = String(error.message || error).toLowerCase();
    return /failed to fetch|network|load failed|unexpected token|not valid json|http\s+4\d\d|http\s+5\d\d|html|健康檢查|gas/.test(message);
  }

  function isTimeoutError(error) {
    if (!error) return false;
    if (error.type === 'TIMEOUT' || error.type === 'GAS_TIMEOUT') return true;
    return /timeout|timed out|逾時/i.test(String(error.message || error));
  }

  function isBrowserWindow() {
    return typeof root.window !== 'undefined' && root.window === root;
  }

  async function read(action, data) {
    if (root.WorshipPptSupabaseService && typeof root.WorshipPptSupabaseService[action] === 'function') {
      try {
        const operation = () => root.WorshipPptSupabaseService[action](data || {});
        const res = action === 'cal_getPptLibraryIndex'
          ? await withTimeout(operation, timeoutFor('LKC_PPT_INDEX_READ_TIMEOUT_MS', 10000), 'PPT 資料庫索引讀取逾時')
          : await operation();
        if (res !== null) return res;
      } catch (err) {
        console.warn(`[WorshipSupabase] Error calling ${action}, falling back:`, err);
      }
    }

    const endpoint = endpointForAction(action);
    if (!endpoint) {
      throw new Error(PPT_LIBRARY_ACTIONS.has(action)
        ? 'PPT Library GAS 備援網址尚未就緒'
        : '行事曆雲端網址尚未就緒');
    }
    // PPT Library 是獨立的唯讀 GAS 橋接服務；不要用 URL 相等與否推斷路由，
    // 否則未來兩個部署暫時共用網址時，索引／檔案可能誤落到主 GAS POST。
    const usesDedicatedEndpoint = PPT_LIBRARY_ACTIONS.has(action);
    const useJsonpFirst = usesDedicatedEndpoint || shouldPreferJsonp(action);
    let jsonpError = null;
    if (useJsonpFirst) {
      try {
        return await jsonp(endpoint, action, data || {}, root.AUTH_TOKEN || 'ChurchApp-2026');
      } catch (error) {
        jsonpError = error;
        if (isTimeoutError(error)) throw error;
        if (usesDedicatedEndpoint && isBrowserWindow()
          && !(root.location && root.location.protocol === 'file:')) {
          try {
            // GAS 的 JSONP 端點原生以 script tag 服務；Fetch 追蹤 GAS 302
            // 到 googleusercontent echo 時，部分瀏覽器會收到 404，故只作備援。
            return await fetchJsonp(endpoint, action, data || {}, root.AUTH_TOKEN || 'ChurchApp-2026');
          } catch (fetchError) {
            fetchError.cause = error;
            jsonpError = fetchError;
          }
        }
        if (root.location && root.location.protocol === 'file:') throw error;
      }
    }
    if (!usesDedicatedEndpoint && (!useJsonpFirst || jsonpError)) {
      try {
        if (root.ensureAPIReady) await root.ensureAPIReady();
        if (typeof root.churchAPI === 'function') {
          return await root.churchAPI(action, data || {});
        }
      } catch (error) {
        if (!isJsonTransportError(error)) throw error;
        if (jsonpError) throw jsonpError;
      }
    }
    if (jsonpError) throw jsonpError;
    return jsonp(endpoint, action, data || {}, root.AUTH_TOKEN || 'ChurchApp-2026');
  }

  async function sync(action, data) {
    if (!PPT_LIBRARY_SYNC_ACTIONS.has(action)) {
      throw new Error('不支援的 PPT Library 同步 action');
    }
    const endpoint = endpointForAction(action);
    if (!endpoint) throw new Error('PPT Library GAS 同步網址尚未就緒');
    const token = root.AUTH_TOKEN || 'ChurchApp-2026';
    let postError;
    try {
      return await postJson(endpoint, action, data || {}, token);
    } catch (error) {
      if (error && error.type === 'BACKEND_ERROR') throw error;
      postError = error;
    }
    try {
      return await jsonp(endpoint, action, data || {}, token);
    } catch (error) {
      error.cause = postError;
      throw error;
    }
  }

  return { buildJsonpUrl, jsonp, fetchJsonp, postJson, parseJsonpPayload, read, sync };
});
