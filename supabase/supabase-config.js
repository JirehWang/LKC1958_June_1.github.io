// ⚡ Supabase 前端設定檔 (供 GitHub Pages 前端使用)
// Project URL 與公開 anon public key 是安全公開於前端的

const SUPABASE_URL = "https://ioxlptzwpmczsxboggct.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_By6SrH7lHFwdOCgw8srvUg_swLAM3cz";

// Phase 3 endpoint observability bootstrap. This file is synchronous, while
// the browser collector is an async module on some pages. Keep a small
// compatibility wrapper here so the first Supabase client is observed too.
(function installSupabaseObservabilityBridge(root) {
  if (!root || typeof root !== 'object') return;

  const marker = '__lkcObservabilityDelegatedSource';
  const optionsCache = Object.create(null);

  function text(value, maxLength) {
    if (value === null || value === undefined) return '';
    return String(value).trim().slice(0, maxLength || 800);
  }

  function redact(value) {
    return text(value)
      .replace(/Bearer\s+[^\s]+/gi, 'Bearer [redacted]')
      .replace(/([?&](?:access_token|token|api[_-]?key|password|secret|authorization)=)[^&#\s]*/gi, '$1[redacted]')
      .replace(/((?:token|password|secret|api[_-]?key|authorization)\s*[:=]\s*)[^\s,;]+/gi, '$1[redacted]');
  }

  function sanitizeEndpoint(value) {
    const raw = text(value, 1200);
    if (!raw) return '';
    if (/^(?:data|blob|javascript):/i.test(raw)) {
      return raw.split(':', 1)[0] + ':[redacted]';
    }
    try {
      const base = root.location && root.location.href ? root.location.href : 'http://localhost/';
      const url = new URL(raw, base);
      return (url.origin + url.pathname).slice(0, 400);
    } catch (error) {
      return redact(raw.split(/[?#]/)[0]).slice(0, 400);
    }
  }

  function requestDetails(input, init) {
    const url = typeof input === 'string'
      ? input
      : input && typeof input.url === 'string' ? input.url : '';
    const method = (init && init.method) || (input && input.method) || 'GET';
    return {
      url,
      method: text(method, 20).toUpperCase() || 'GET'
    };
  }

  function detectSystem() {
    const configured = root.__LKC_OBSERVABILITY_CONFIG__ && root.__LKC_OBSERVABILITY_CONFIG__.system;
    if (configured) return configured;
    const pathname = root.location && root.location.pathname ? root.location.pathname : '';
    const match = pathname.match(/\/apps\/([^/]+)/i);
    if (!match) return 'unknown';
    try {
      return decodeURIComponent(match[1]);
    } catch (error) {
      return match[1];
    }
  }

  function failureLevel(status) {
    return status === 404 || status === 408 || status === 429 ? 'warn' : 'error';
  }

  function publish(event) {
    const observer = root.LKCObservability && typeof root.LKCObservability.reportError === 'function'
      ? root.LKCObservability.reportError
      : typeof root.churchLog === 'function' ? root.churchLog : null;
    if (observer) {
      try {
        const result = observer(event);
        if (result && typeof result.catch === 'function') result.catch(() => {});
        return;
      } catch (error) {
        // The host request must continue even if logging is unavailable.
      }
    }
    const pending = Array.isArray(root.__LKC_OBSERVABILITY_PENDING__)
      ? root.__LKC_OBSERVABILITY_PENDING__
      : (root.__LKC_OBSERVABILITY_PENDING__ = []);
    if (pending.length < 50) pending.push(event);
  }

  function createFallbackFetch(system) {
    if (typeof root.fetch !== 'function') return null;
    const baseFetch = root.fetch.bind(root);
    const observedFetch = async function(input, init) {
      const details = requestDetails(input, init);
      const delegatedSource = init && init[marker];
      const nextInit = Object.assign({}, init || {});
      nextInit[marker] = 'supabase';
      try {
        const response = await baseFetch(input, nextInit);
        if (response && response.ok === false && !delegatedSource) {
          const status = Number(response.status) || null;
          publish({
            system,
            source: 'supabase',
            level: failureLevel(status),
            action: 'supabase.fetch.' + details.method.toLowerCase(),
            errorType: status ? 'HTTP_' + status : 'HTTP_REQUEST_FAILED',
            message: 'HTTP request returned ' + (status || 'an unsuccessful response'),
            endpoint: sanitizeEndpoint(details.url),
            meta: { method: details.method, status, ok: Boolean(response.ok) }
          });
        }
        return response;
      } catch (error) {
        if (!delegatedSource) {
          const name = text(error && error.name ? error.name : 'Error', 120) || 'Error';
          const message = redact(error && error.message ? error.message : String(error));
          publish({
            system,
            source: 'supabase',
            level: 'error',
            action: 'supabase.fetch.' + details.method.toLowerCase(),
            errorType: name,
            message: message || 'Supabase request failed',
            endpoint: sanitizeEndpoint(details.url),
            meta: { method: details.method }
          });
        }
        throw error;
      }
    };
    observedFetch.__lkcObservabilitySupabaseWrapped = true;
    observedFetch.__lkcOriginalFetch = baseFetch;
    return observedFetch;
  }

  root.__LKC_OBSERVABILITY_SUPABASE_OPTIONS__ = function(options) {
    const settings = options || {};
    const system = settings.system || detectSystem();
    if (root.LKCObservability && typeof root.LKCObservability.createSupabaseClientOptions === 'function') {
      return root.LKCObservability.createSupabaseClientOptions({ system });
    }
    if (!optionsCache[system]) {
      const fetchImpl = createFallbackFetch(system);
      optionsCache[system] = fetchImpl ? { global: { fetch: fetchImpl } } : {};
    }
    return optionsCache[system];
  };
})(typeof window !== 'undefined' ? window : null);

if (typeof window !== 'undefined') {
  window._SUPABASE_CONFIG = {
    url: SUPABASE_URL,
    anonKey: SUPABASE_ANON_KEY
  };
  window.SUPABASE_CONFIG = window._SUPABASE_CONFIG;
  if (window.supabase && typeof window.supabase.createClient === 'function') {
    const options = typeof window.__LKC_OBSERVABILITY_SUPABASE_OPTIONS__ === 'function'
      ? window.__LKC_OBSERVABILITY_SUPABASE_OPTIONS__({})
      : undefined;
    window._supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, options);
  }
}

if (typeof exports !== 'undefined') {
  exports.SUPABASE_URL = SUPABASE_URL;
  exports.SUPABASE_ANON_KEY = SUPABASE_ANON_KEY;
}
