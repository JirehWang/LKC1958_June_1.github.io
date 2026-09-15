import { normalizeLogEntry } from './observability-registry.js';
import {
  createEndpointFetch,
  createSupabaseClientOptions
} from './observability-endpoints.js';

const INSTALL_KEY = '__LKC_OBSERVABILITY__';
const MAX_TEXT = 800;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_PER_KEY = 6;
const SENSITIVE_KEY = /token|secret|password|api[_-]?key|authorization|cookie|credential|base64/i;

function text(value, maxLength = MAX_TEXT) {
  if (value === null || value === undefined) return '';
  return String(value).trim().slice(0, maxLength);
}

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return '[unserializable]';
  }
}

export function redactText(value) {
  return text(value)
    .replace(/Bearer\s+[^\s]+/gi, 'Bearer [redacted]')
    .replace(/([?&](?:access_token|token|api[_-]?key|password|secret|authorization)=)[^&#\s]*/gi, '$1[redacted]')
    .replace(/((?:token|password|secret|api[_-]?key|authorization)\s*[:=]\s*)[^\s,;]+/gi, '$1[redacted]')
    .replace(/data:[^,\s]+,[^\s]+/gi, 'data:[redacted]');
}

function redactValue(value, depth = 0) {
  if (value === null || value === undefined) return null;
  if (depth > 3) return '[max-depth]';
  if (typeof value === 'string') return redactText(value, MAX_TEXT);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 20).map(item => redactValue(item, depth + 1));
  if (typeof value !== 'object') return redactText(value);

  const output = {};
  Object.keys(value).slice(0, 30).forEach(key => {
    output[key] = SENSITIVE_KEY.test(key)
      ? '[redacted]'
      : redactValue(value[key], depth + 1);
  });
  return output;
}

function redactEndpoint(value) {
  if (!value) return '';
  const raw = text(value, 1000);
  if (/^(?:data|blob|javascript):/i.test(raw)) {
    return raw.split(':', 1)[0] + ':[redacted]';
  }
  try {
    const base = typeof location !== 'undefined' ? location.href : 'http://localhost/';
    const url = new URL(raw, base);
    return `${url.origin}${url.pathname}`.slice(0, 400);
  } catch {
    return redactText(raw.split(/[?#]/)[0], 400);
  }
}

function getErrorDetails(reason) {
  if (reason instanceof Error) {
    return {
      name: text(reason.name || 'Error', 120),
      message: redactText(reason.message || String(reason)),
      stack: redactText(reason.stack || '', 2000)
    };
  }
  if (reason && typeof reason === 'object') {
    return {
      name: text(reason.name || reason.code || 'Error', 120),
      message: redactText(reason.message || reason.error_description || safeJson(reason)),
      stack: redactText(reason.stack || '', 2000)
    };
  }
  return { name: 'Error', message: redactText(reason), stack: '' };
}

export function detectSystemFromPath(pathname = '') {
  const decoded = text(pathname, 500);
  const match = decoded.match(/\/apps\/([^/]+)/i);
  if (!match) return 'unknown';
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

function detectEnvironment() {
  const pathname = typeof location !== 'undefined' ? location.pathname : '';
  const search = typeof location !== 'undefined' ? location.search : '';
  const host = typeof location !== 'undefined' ? location.hostname : '';
  return host === 'localhost'
    || host === '127.0.0.1'
    || /[?&](?:env=test|test=1)\b/i.test(search)
    || /^file:/i.test(typeof location !== 'undefined' ? location.protocol : '')
    || /\/test(?:\/|$)/i.test(pathname)
    ? 'test'
    : 'production';
}

export function buildObservabilityEvent(input = {}, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const rawMeta = input.meta && typeof input.meta === 'object' ? input.meta : {};
  const normalized = normalizeLogEntry({
    ...input,
    message: redactText(input.message),
    endpoint: redactEndpoint(input.endpoint),
    meta: redactValue(rawMeta)
  }, { now });

  return {
    ...normalized,
    message: redactText(normalized.message),
    endpoint: redactEndpoint(normalized.endpoint),
    meta: redactValue(normalized.meta)
  };
}

function shouldIgnoreConsoleMessage(message) {
  return /^\[(?:firebase-logger|firebase-cache|church-log|LKC observability)\]/i.test(message);
}

function isResourceTarget(target) {
  return target && target !== window && typeof target.tagName === 'string';
}

function createReporter(config) {
  const rateMap = new Map();
  let reporting = false;
  let writing = false;
  let loggerPromise = null;

  function allowed(event) {
    const now = Date.now();
    const key = [event.source, event.errorType, event.action, event.message, event.endpoint]
      .join('|')
      .slice(0, 1200);
    const previous = rateMap.get(key) || { count: 0, startedAt: now };
    if (now - previous.startedAt >= RATE_LIMIT_WINDOW_MS) {
      rateMap.set(key, { count: 1, startedAt: now });
      return true;
    }
    if (previous.count >= RATE_LIMIT_PER_KEY) return false;
    previous.count += 1;
    rateMap.set(key, previous);
    return true;
  }

  function loadLogger() {
    if (!loggerPromise) {
      loggerPromise = import('./firebase-logger.js').catch(() => null);
    }
    return loggerPromise;
  }

  function report(input = {}) {
    if (reporting || writing) return null;
    let event;
    try {
      event = buildObservabilityEvent({
        ...input,
        system: input.system || config.system,
        environment: input.environment || config.environment,
        page: input.page || (typeof location !== 'undefined' ? location.pathname + location.search : '')
      });
    } catch {
      return null;
    }
    if (!event.message && !event.errorType) return event;
    if (!allowed(event)) return event;

    reporting = true;
    const logEntry = {
      ...event,
      meta: {
        ...event.meta,
        collector: 'browser',
        captureFetch: Boolean(config.captureFetch)
      }
    };

    try {
      if (typeof window.churchLog === 'function') {
        const result = window.churchLog(logEntry);
        if (result && typeof result.catch === 'function') result.catch(() => {});
      } else {
        writing = true;
        loadLogger()
          .then(logger => logger && logger.writeLog(logEntry))
          .catch(() => {})
          .finally(() => { writing = false; });
      }
    } catch {
      // Observability must never change the host application's behavior.
    } finally {
      reporting = false;
    }
    return event;
  }

  return {
    report
  };
}

function installConsoleCapture(config, reporter) {
  if (!config.captureConsole || !window.console) return;
  const originalError = typeof window.console.error === 'function'
    ? window.console.error.bind(window.console)
    : () => {};
  window.console.error = (...args) => {
    originalError(...args);
    const details = args.map(arg => arg instanceof Error ? arg.message : typeof arg === 'object' ? safeJson(redactValue(arg)) : String(arg));
    const message = redactText(details.join(' '));
    if (shouldIgnoreConsoleMessage(message)) return;
    reporter.report({
      level: 'error',
      source: 'ui',
      action: 'console.error',
      errorType: 'CONSOLE_ERROR',
      message,
      meta: { arguments: redactValue(args) }
    });
  };
}

function installErrorCapture(config, reporter) {
  if (!config.captureErrors) return;
  window.addEventListener('error', event => {
    if (isResourceTarget(event.target) && (event.target.src || event.target.href)) {
      const target = event.target;
      const tag = target.tagName.toLowerCase();
      const details = tag === 'audio' || tag === 'video'
        ? { source: 'audio', action: 'media.load', errorType: 'MEDIA_RESOURCE_ERROR' }
        : { source: 'ui', action: 'resource.load', errorType: 'RESOURCE_LOAD_ERROR' };
      reporter.report({
        level: 'error',
        ...details,
        message: `${tag} resource failed to load`,
        endpoint: target.src || target.href,
        meta: { tag, id: target.id || '', className: target.className || '' }
      });
      return;
    }

    const error = getErrorDetails(event.error || event.message);
    reporter.report({
      level: 'error',
      source: 'unhandled',
      action: 'window.error',
      errorType: error.name || 'UNCAUGHT_ERROR',
      message: error.message || 'Uncaught browser error',
      meta: {
        stack: error.stack,
        filename: event.filename || '',
        line: event.lineno || null,
        column: event.colno || null
      }
    });
  }, true);

  window.addEventListener('unhandledrejection', event => {
    const error = getErrorDetails(event.reason);
    reporter.report({
      level: 'error',
      source: 'unhandled',
      action: 'unhandledrejection',
      errorType: error.name || 'UNHANDLED_REJECTION',
      message: error.message || 'Unhandled promise rejection',
      meta: { stack: error.stack }
    });
  });
}

function installFetchCapture(config, reporter) {
  if (!config.captureFetch || typeof window.fetch !== 'function' || window.fetch.__lkcObservabilityWrapped) return;
  const originalFetch = window.fetch.bind(window);
  const wrappedFetch = createEndpointFetch({
    source: 'api',
    system: config.system,
    reporter: reporter.report,
    fetchImpl: originalFetch
  });
  if (!wrappedFetch) return;
  window.fetch = wrappedFetch;
}

function flushPendingReports(config, reporter) {
  const pending = Array.isArray(window.__LKC_OBSERVABILITY_PENDING__)
    ? window.__LKC_OBSERVABILITY_PENDING__.splice(0, 50)
    : [];
  pending.forEach(entry => {
    if (entry && typeof entry === 'object') {
      reporter.report({
        ...entry,
        system: entry.system || config.system
      });
    }
  });
}

export function installBrowserObservability(options = {}) {
  if (typeof window === 'undefined') return null;
  if (window[INSTALL_KEY]) return window[INSTALL_KEY];

  const config = {
    system: options.system || window.__LKC_OBSERVABILITY_SYSTEM || detectSystemFromPath(window.location.pathname),
    environment: options.environment || detectEnvironment(),
    captureConsole: options.captureConsole !== false,
    captureErrors: options.captureErrors !== false,
    captureFetch: options.captureFetch !== false
  };
  const reporter = createReporter(config);
  const api = {
    system: config.system,
    environment: config.environment,
    reportError: reporter.report,
    report: reporter.report,
    createSupabaseClientOptions: options => createSupabaseClientOptions({
      ...options,
      system: (options && options.system) || config.system,
      reporter: reporter.report,
      fetchImpl: options && options.fetchImpl
        ? options.fetchImpl
        : typeof window.fetch === 'function' ? window.fetch.bind(window) : undefined
    })
  };

  window[INSTALL_KEY] = api;
  window.LKCObservability = api;
  installConsoleCapture(config, reporter);
  installErrorCapture(config, reporter);
  installFetchCapture(config, reporter);
  flushPendingReports(config, reporter);
  return api;
}

if (typeof window !== 'undefined') {
  installBrowserObservability(window.__LKC_OBSERVABILITY_CONFIG__ || {});
}
