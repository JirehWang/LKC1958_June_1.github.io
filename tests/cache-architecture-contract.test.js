const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const repoRoot = path.join(__dirname, '..');
const configSource = fs.readFileSync(path.join(repoRoot, 'config.js'), 'utf8');
const firebaseCacheSource = fs.readFileSync(path.join(repoRoot, 'firebase', 'firebase-cache.js'), 'utf8');
const gasSyncSource = fs.readFileSync(path.join(repoRoot, 'scratch_gas_sunday', 'FirebaseSync.js'), 'utf8');
const coreSource = fs.readFileSync(path.join(repoRoot, 'scratch_gas_sunday', 'Core.js'), 'utf8');
const groupCoreSource = fs.readFileSync(path.join(repoRoot, 'scratch_gas_sunday', 'GroupCore.js'), 'utf8');

function loadChurchApiWithFirebaseCache(firebaseCache, fetchImpl, windowOverrides = {}) {
  const source = configSource
    .replace(
      "import('https://jirehwang.github.io/LKC1958_June_1.github.io/firebase/firebase-cache.js')",
      'Promise.resolve(window.__firebaseCacheMock)'
    )
    .replace(
      "import('https://jirehwang.github.io/LKC1958_June_1.github.io/firebase/firebase-logger.js')",
      'Promise.resolve(null)'
    );
  const storage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  const window = {
    _GAS_KEY: 'LKC_Group',
    _FORCE_PRODUCTION_GAS: true,
    __firebaseCacheMock: firebaseCache,
    location: {
      pathname: '/LKC_Group/',
      hostname: 'example.github.io',
      protocol: 'https:',
      search: '',
      href: 'https://example.github.io/LKC_Group/'
    },
    localStorage: storage,
    addEventListener: () => {}
  };
  Object.assign(window, windowOverrides);
  const document = {
    getElementById: () => null,
    createElement: () => ({ style: {}, appendChild: () => {}, remove: () => {} }),
    head: { appendChild: () => {} },
    body: { appendChild: () => {} },
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {}
  };
  vm.runInNewContext(source, {
    window,
    document,
    navigator: {},
    sessionStorage: storage,
    fetch: fetchImpl,
    console: { log: () => {}, warn: () => {}, error: () => {} },
    Event: function Event(type) { this.type = type; },
    URL,
    Promise,
    Date,
    Math,
    JSON,
    Object,
    Array,
    Set,
    RegExp,
    Error,
    String,
    Number,
    Boolean,
    encodeURIComponent,
    unescape,
    btoa: value => Buffer.from(value, 'binary').toString('base64'),
    AbortController,
    setTimeout,
    clearTimeout
  }, { filename: 'config.js' });
  return window.churchAPI;
}

test('browser cache flow is read-through only and does not retry GAS after a Firebase failure', () => {
  assert.match(configSource, /cacheGetOrFetchWithMeta/);
  assert.match(configSource, /firebase cache read failed, direct GAS once/);
  assert.match(configSource, /let gasAttempted = false/);
  assert.match(configSource, /if \(gasAttempted\) throw e/);
  assert.match(configSource, /_EXTERNAL_CACHE_V2_PENDING_RE/);
  assert.match(configSource, /memberStatus_\|children_/);
  assert.match(configSource, /ttl && !_requiresExternalCacheV2\(realAction\)/);
  assert.doesNotMatch(configSource, /fallback GAS completed after invalid cache/);
  assert.doesNotMatch(configSource, /cache invalidated after write/);
  assert.match(firebaseCacheSource, /Client cache writes are disabled/);
  assert.doesNotMatch(firebaseCacheSource, /await cacheSet\(topic, subkey, fresh, ttlSeconds\)/);
});

test('churchAPI calls GAS once when a Firebase cache read fails and its loader rejects', async () => {
  let firebaseReads = 0;
  let gasCalls = 0;
  const firebaseCache = {
    cacheGetOrFetchWithMeta: async (_topic, _subkey, loader) => {
      firebaseReads += 1;
      try {
        throw new Error('Firebase read failed');
      } catch (_firebaseReadError) {
        return loader();
      }
    },
    cacheGetOrFetch: async () => {
      throw new Error('unexpected legacy cache path');
    }
  };
  const churchAPI = loadChurchApiWithFirebaseCache(firebaseCache, async () => {
    gasCalls += 1;
    return {
      status: 200,
      json: async () => { throw new Error('GAS JSON failure'); }
    };
  });

  await assert.rejects(churchAPI('getGroups'), /GAS JSON failure/);
  assert.equal(firebaseReads, 1);
  assert.equal(gasCalls, 1);
});

test('churchAPI classifies a non-JSON GAS health response as an invalid API response', async () => {
  const churchAPI = loadChurchApiWithFirebaseCache(null, async () => ({
    status: 200,
    text: async () => '✅ 行事曆系統 API 運作中...'
  }));

  await assert.rejects(
    churchAPI('getGroups'),
    error => error.name === 'APIError'
      && error.type === 'INVALID_RESPONSE'
      && /健康檢查|JSON/.test(error.message)
  );
});

test('churchAPI aborts a hanging GAS request with a typed timeout error', async () => {
  let receivedSignal = false;
  const churchAPI = loadChurchApiWithFirebaseCache(null, async (_url, options) => {
    if (!options || !options.signal) throw new Error('fetch signal was not provided');
    receivedSignal = true;
    return new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const error = new Error('The operation was aborted');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    });
  }, { LKC_GAS_REQUEST_TIMEOUT_MS: 5 });

  await assert.rejects(
    churchAPI('getGroups'),
    error => error.name === 'APIError'
      && error.type === 'GAS_TIMEOUT'
      && /逾時/.test(error.message)
  );
  assert.equal(receivedSignal, true);
});

test('GAS owns cache write-through and preserves successful responses when Firebase write-back fails', () => {
  assert.match(gasSyncSource, /function firebaseCacheWriteThrough\(/);
  assert.match(gasSyncSource, /schemaVersion/);
  assert.match(gasSyncSource, /generation/);
  assert.match(gasSyncSource, /cacheRefreshPending/);
  assert.match(gasSyncSource, /return \{ ok: false/);
  assert.match(gasSyncSource, /FIREBASE_PENDING_RECONCILE_LIMIT/);
  assert.match(gasSyncSource, /FIREBASE_PENDING_MARKER_MAX_AGE_MS/);
  assert.match(gasSyncSource, /function firebaseCaptureCacheRevision\(/);
  assert.match(gasSyncSource, /function _withFirebaseCacheRevisionBarrier\(/);
  assert.match(coreSource, /function _captureServerCacheRevision\(/);
  assert.match(coreSource, /firebaseCacheWriteThrough\(action, requestData \|\| \{\}, result, sourceRevision\)/);
});

test('backend keep-warm is a low-frequency consistency reconciliation', () => {
  assert.match(groupCoreSource, /everyDays\(1\)/);
  assert.match(groupCoreSource, /cacheReconcile/);
});
