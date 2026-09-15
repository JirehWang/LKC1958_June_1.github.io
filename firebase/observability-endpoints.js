/**
 * Shared endpoint observation helpers.
 *
 * This module is transport-agnostic. It reports a sanitized event and then
 * returns the original response or rethrows the original error unchanged.
 */

export const OBSERVABILITY_FETCH_MARKER = '__lkcObservabilityDelegatedSource';

const MAX_TEXT = 800;
const SENSITIVE_QUERY = /([?&](?:access_token|token|api[_-]?key|password|secret|authorization)=)[^&#\s]*/gi;

function text(value, maxLength = MAX_TEXT) {
  if (value === null || value === undefined) return '';
  return String(value).trim().slice(0, maxLength);
}

function redactText(value) {
  return text(value)
    .replace(/Bearer\s+[^\s]+/gi, 'Bearer [redacted]')
    .replace(SENSITIVE_QUERY, '$1[redacted]')
    .replace(/((?:token|password|secret|api[_-]?key|authorization)\s*[:=]\s*)[^\s,;]+/gi, '$1[redacted]');
}

export function sanitizeEndpoint(value) {
  if (!value) return '';
  const raw = text(value, 1200);
  if (/^(?:data|blob|javascript):/i.test(raw)) {
    return raw.split(':', 1)[0] + ':[redacted]';
  }
  try {
    const base = typeof location !== 'undefined' ? location.href : 'http://localhost/';
    const url = new URL(raw, base);
    return (url.origin + url.pathname).slice(0, 400);
  } catch {
    return redactText(raw.split(/[?#]/)[0]).slice(0, 400);
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

function errorDetails(reason) {
  if (reason instanceof Error) {
    return {
      name: text(reason.name || 'Error', 120) || 'Error',
      message: redactText(reason.message || String(reason)),
      stack: redactText(reason.stack || '').slice(0, 2000)
    };
  }
  if (reason && typeof reason === 'object') {
    return {
      name: text(reason.name || reason.code || 'Error', 120) || 'Error',
      message: redactText(reason.message || reason.error_description || '[endpoint failure]'),
      stack: redactText(reason.stack || '').slice(0, 2000)
    };
  }
  return {
    name: 'Error',
    message: redactText(reason),
    stack: ''
  };
}

export function getEndpointFailureLevel(status) {
  const numericStatus = Number(status);
  if (numericStatus === 404 || numericStatus === 408 || numericStatus === 429) return 'warn';
  return 'error';
}

function withObservabilityMarker(init, source) {
  const nextInit = init && typeof init === 'object' ? { ...init } : {};
  nextInit[OBSERVABILITY_FETCH_MARKER] = source;
  return nextInit;
}

function notify(reporter, event) {
  if (typeof reporter !== 'function') return;
  try {
    const result = reporter(event);
    if (result && typeof result.catch === 'function') result.catch(() => {});
  } catch {
    // Observability must never alter the application request path.
  }
}

export function createEndpointFetch({
  source = 'api',
  system = 'unknown',
  reporter,
  fetchImpl
} = {}) {
  const baseFetch = typeof fetchImpl === 'function'
    ? fetchImpl
    : typeof globalThis !== 'undefined' && typeof globalThis.fetch === 'function'
      ? globalThis.fetch.bind(globalThis)
      : null;

  if (!baseFetch) return null;

  const observedFetch = async (input, init) => {
    const details = requestDetails(input, init);
    const delegatedSource = init && init[OBSERVABILITY_FETCH_MARKER];
    try {
      const response = await baseFetch(input, withObservabilityMarker(init, source));
      if (response && response.ok === false && !delegatedSource) {
        const status = Number(response.status) || null;
        notify(reporter, {
          system,
          source,
          level: getEndpointFailureLevel(status),
          action: source + '.fetch.' + details.method.toLowerCase(),
          errorType: status ? 'HTTP_' + status : 'HTTP_REQUEST_FAILED',
          message: 'HTTP request returned ' + (status || 'an unsuccessful response'),
          endpoint: sanitizeEndpoint(details.url),
          meta: {
            method: details.method,
            status,
            ok: Boolean(response.ok)
          }
        });
      }
      return response;
    } catch (error) {
      if (!delegatedSource) {
        const detailsOfError = errorDetails(error);
        notify(reporter, {
          system,
          source,
          level: 'error',
          action: source + '.fetch.' + details.method.toLowerCase(),
          errorType: detailsOfError.name || 'FETCH_FAILED',
          message: detailsOfError.message || 'Endpoint request failed',
          endpoint: sanitizeEndpoint(details.url),
          meta: {
            method: details.method,
            stack: detailsOfError.stack
          }
        });
      }
      throw error;
    }
  };

  if (source === 'api') observedFetch.__lkcObservabilityWrapped = true;
  observedFetch.__lkcObservabilitySource = source;
  observedFetch.__lkcOriginalFetch = baseFetch;
  return observedFetch;
}

export function createSupabaseClientOptions({ system = 'unknown', reporter, fetchImpl } = {}) {
  const observedFetch = createEndpointFetch({
    source: 'supabase',
    system,
    reporter,
    fetchImpl
  });
  return observedFetch ? { global: { fetch: observedFetch } } : {};
}
