(function(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TaiwaneseWorshipReadApi = api;
  root.worshipReadAPI = api.read;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(root) {
  let callbackSequence = 0;
  const JSONP_TIMEOUT_MS = 45000;
  const JSONP_LATE_CALLBACK_GRACE_MS = 10000;
  const JSONP_READ_ACTIONS = new Set([
    'cal_getEvents',
    'cal_getPptLibraryIndex',
    'cal_getPptLibraryFile',
    'cal_queryBible'
  ]);

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
      const graceMs = Number(root.LKC_JSONP_LATE_CALLBACK_GRACE_MS) >= 0
        ? Number(root.LKC_JSONP_LATE_CALLBACK_GRACE_MS)
        : JSONP_LATE_CALLBACK_GRACE_MS;
      let settled = false;
      let timer;
      const removeCallback = () => {
        try { delete root[callbackName]; } catch (_) { root[callbackName] = undefined; }
      };
      const cleanup = ({ keepCallback = false } = {}) => {
        clearTimeout(timer);
        script.remove();
        if (!keepCallback) removeCallback();
      };
      const fail = (error, { keepCallback = false } = {}) => {
        if (settled) return;
        settled = true;
        cleanup({ keepCallback });
        if (keepCallback) {
          root[callbackName] = () => {};
          setTimeout(removeCallback, graceMs);
        }
        reject(error);
      };
      timer = setTimeout(() => {
        const error = new Error('雲端行事曆讀取逾時');
        error.type = 'TIMEOUT';
        fail(error, { keepCallback: true });
      }, timeoutMs);
      root[callbackName] = result => {
        if (settled) return;
        settled = true;
        cleanup();
        if (result && result.success === false) reject(new Error(result.message || '雲端資料讀取失敗'));
        else resolve(result);
      };
      script.async = true;
      script.onerror = () => {
        fail(new Error('無法連線至雲端行事曆'));
      };
      script.src = buildJsonpUrl(endpoint, action, data, token, callbackName);
      document.head.appendChild(script);
    });
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
    if (error.name === 'SyntaxError' || ['INVALID_RESPONSE', 'TIMEOUT', 'GAS_TIMEOUT'].includes(error.type)) return true;
    const message = String(error.message || error).toLowerCase();
    return /failed to fetch|network|load failed|unexpected token|not valid json|http\s+4\d\d|http\s+5\d\d/.test(message);
  }

  function isTimeoutError(error) {
    if (!error) return false;
    if (error.type === 'TIMEOUT' || error.type === 'GAS_TIMEOUT') return true;
    return /timeout|timed out|逾時/i.test(String(error.message || error));
  }

  async function read(action, data) {
    if (root.WorshipPptSupabaseService && typeof root.WorshipPptSupabaseService[action] === 'function') {
      try {
        const res = await root.WorshipPptSupabaseService[action](data || {});
        if (res !== null) return res;
      } catch (err) {
        console.warn(`[WorshipSupabase] Error calling ${action}, falling back:`, err);
      }
    }

    if (!root.GAS_URL) throw new Error('行事曆雲端網址尚未就緒');
    const useJsonpFirst = shouldPreferJsonp(action);
    let jsonpError = null;
    if (useJsonpFirst) {
      try {
        return await jsonp(root.GAS_URL, action, data || {}, root.AUTH_TOKEN || 'ChurchApp-2026');
      } catch (error) {
        jsonpError = error;
        if (isTimeoutError(error)) throw error;
        if (root.location && root.location.protocol === 'file:') throw error;
      }
    }
    if (!useJsonpFirst || jsonpError) {
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
    return jsonp(root.GAS_URL, action, data || {}, root.AUTH_TOKEN || 'ChurchApp-2026');
  }

  return { buildJsonpUrl, jsonp, read };
});
