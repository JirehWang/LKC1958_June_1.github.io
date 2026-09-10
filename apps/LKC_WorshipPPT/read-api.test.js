const test = require('node:test');
const assert = require('node:assert/strict');
const { buildJsonpUrl, jsonp, read } = require('./read-api.js');

test('builds a JSONP URL for read-only GAS actions from file pages', () => {
  const url = new URL(buildJsonpUrl(
    'https://script.google.com/macros/s/example/exec',
    'cal_getEvents',
    { startDate: '2026-07-12', endDate: '2026-07-12' },
    'ChurchApp-2026',
    '__lkcCallback1'
  ));
  assert.equal(url.searchParams.get('action'), 'cal_getEvents');
  assert.equal(url.searchParams.get('token'), 'ChurchApp-2026');
  assert.equal(url.searchParams.get('callback'), '__lkcCallback1');
  assert.deepEqual(JSON.parse(url.searchParams.get('data')), {
    startDate: '2026-07-12', endDate: '2026-07-12'
  });
});

test('keeps a no-op JSONP callback after timeout for late GAS responses', async () => {
  const previous = {
    GAS_URL: global.GAS_URL,
    AUTH_TOKEN: global.AUTH_TOKEN,
    document: global.document,
    LKC_JSONP_TIMEOUT_MS: global.LKC_JSONP_TIMEOUT_MS,
    LKC_JSONP_LATE_CALLBACK_GRACE_MS: global.LKC_JSONP_LATE_CALLBACK_GRACE_MS
  };
  let callbackName = '';
  global.GAS_URL = 'https://script.google.com/macros/s/example/exec';
  global.AUTH_TOKEN = 'ChurchApp-2026';
  global.LKC_JSONP_TIMEOUT_MS = 5;
  global.LKC_JSONP_LATE_CALLBACK_GRACE_MS = 50;
  global.document = {
    createElement() {
      return { remove() {} };
    },
    head: {
      appendChild(script) {
        callbackName = new URL(script.src).searchParams.get('callback');
      }
    }
  };

  try {
    await assert.rejects(
      jsonp(global.GAS_URL, 'cal_getPptLibraryFile', { fileId: 'late-file' }, global.AUTH_TOKEN),
      error => error.type === 'TIMEOUT' && /逾時/.test(error.message)
    );
    assert.equal(typeof global[callbackName], 'function');
    assert.doesNotThrow(() => global[callbackName]({ success: true, data: [] }));
  } finally {
    delete global[callbackName];
    Object.assign(global, previous);
  }
});

test('does not fall back to direct POST after a JSONP timeout', async () => {
  const previous = {
    WorshipPptSupabaseService: global.WorshipPptSupabaseService,
    ensureAPIReady: global.ensureAPIReady,
    churchAPI: global.churchAPI,
    GAS_URL: global.GAS_URL,
    AUTH_TOKEN: global.AUTH_TOKEN,
    location: global.location,
    document: global.document,
    LKC_JSONP_TIMEOUT_MS: global.LKC_JSONP_TIMEOUT_MS,
    LKC_JSONP_LATE_CALLBACK_GRACE_MS: global.LKC_JSONP_LATE_CALLBACK_GRACE_MS
  };
  let directCalls = 0;
  let callbackName = '';
  global.WorshipPptSupabaseService = undefined;
  global.ensureAPIReady = async () => {};
  global.churchAPI = async () => {
    directCalls += 1;
    return { success: true, data: [{ fileId: 'wrong-fallback' }] };
  };
  global.GAS_URL = 'https://script.google.com/macros/s/example/exec';
  global.AUTH_TOKEN = 'ChurchApp-2026';
  global.location = { protocol: 'https:', hostname: 'jirehwang.github.io' };
  global.LKC_JSONP_TIMEOUT_MS = 5;
  global.LKC_JSONP_LATE_CALLBACK_GRACE_MS = 50;
  global.document = {
    createElement() {
      return { remove() {} };
    },
    head: {
      appendChild(script) {
        callbackName = new URL(script.src).searchParams.get('callback');
      }
    }
  };

  try {
    await assert.rejects(
      read('cal_getPptLibraryFile', { fileId: 'timed-out-file' }),
      error => error.type === 'TIMEOUT' && /逾時/.test(error.message)
    );
    assert.equal(directCalls, 0);
  } finally {
    delete global[callbackName];
    Object.assign(global, previous);
  }
});

test('falls back to JSONP when API readiness fails with a network error', async () => {
  const previous = {
    ensureAPIReady: global.ensureAPIReady,
    churchAPI: global.churchAPI,
    GAS_URL: global.GAS_URL,
    AUTH_TOKEN: global.AUTH_TOKEN,
    location: global.location,
    document: global.document
  };

  global.ensureAPIReady = async () => { throw new TypeError('Failed to fetch'); };
  global.churchAPI = async () => { throw new Error('churchAPI should not run'); };
  global.GAS_URL = 'https://script.google.com/macros/s/example/exec';
  global.AUTH_TOKEN = 'ChurchApp-2026';
  global.location = { protocol: 'https:' };
  global.document = {
    createElement() {
      return { remove() {} };
    },
    head: {
      appendChild(script) {
        const callback = new URL(script.src).searchParams.get('callback');
        queueMicrotask(() => global[callback]({ success: true, data: ['fallback'] }));
      }
    }
  };

  try {
    const result = await read('cal_getEvents', { startDate: '2026-07-12' });
    assert.deepEqual(result, { success: true, data: ['fallback'] });
  } finally {
    Object.assign(global, previous);
  }
});

test('uses JSONP on GitHub Pages and falls back after invalid JSON POST responses', async () => {
  const previous = {
    firebaseContent: global.worshipFirebaseContent,
    ensureAPIReady: global.ensureAPIReady,
    churchAPI: global.churchAPI,
    GAS_URL: global.GAS_URL,
    AUTH_TOKEN: global.AUTH_TOKEN,
    location: global.location,
    document: global.document
  };

  global.worshipFirebaseContent = undefined;
  global.ensureAPIReady = async () => {};
  let churchApiCalls = 0;
  global.churchAPI = async () => {
    churchApiCalls += 1;
    throw new SyntaxError("Unexpected token '<', \"<!DOCTYPE ...\" is not valid JSON");
  };
  global.GAS_URL = 'https://script.google.com/macros/s/example/exec';
  global.AUTH_TOKEN = 'ChurchApp-2026';
  global.location = { protocol: 'https:', hostname: 'jirehwang.github.io' };
  global.document = {
    createElement() {
      return { remove() {} };
    },
    head: {
      appendChild(script) {
        const callback = new URL(script.src).searchParams.get('callback');
        queueMicrotask(() => global[callback]({ success: true, data: [{ fileId: 'fallback' }] }));
      }
    }
  };

  try {
    const result = await read('cal_getPptLibraryIndex', {});
    assert.deepEqual(result, { success: true, data: [{ fileId: 'fallback' }] });
    assert.equal(churchApiCalls, 0);

    global.location = { protocol: 'https:', hostname: 'example.com' };
    const fallbackResult = await read('cal_getPptLibraryIndex', {});
    assert.deepEqual(fallbackResult, { success: true, data: [{ fileId: 'fallback' }] });
    assert.equal(churchApiCalls, 1);
  } finally {
    Object.assign(global, previous);
  }
});

test('uses the existing source API instead of a duplicated Firebase content mirror', async () => {
  const previous = {
    firebaseContent: global.worshipFirebaseContent,
    ensureAPIReady: global.ensureAPIReady,
    churchAPI: global.churchAPI,
    GAS_URL: global.GAS_URL,
    AUTH_TOKEN: global.AUTH_TOKEN,
    location: global.location
  };
  let gasCalls = 0;
  global.worshipFirebaseContent = {
    readAction: async () => ({ success: true, records: [{ text: 'firebase' }] })
  };
  global.ensureAPIReady = async () => {};
  global.churchAPI = async () => { gasCalls += 1; return { success: true, records: [{ text: 'gas' }] }; };
  global.GAS_URL = 'https://script.google.com/macros/s/example/exec';
  global.AUTH_TOKEN = 'ChurchApp-2026';
  global.location = { protocol: 'https:' };

  try {
    const result = await read('cal_queryBible', { book: '太', chap: 13, sec: '1-2', version: 'tghg' });
    assert.deepEqual(result, { success: true, records: [{ text: 'gas' }] });
    assert.equal(gasCalls, 1);
  } finally {
    global.worshipFirebaseContent = previous.firebaseContent;
    global.ensureAPIReady = previous.ensureAPIReady;
    global.churchAPI = previous.churchAPI;
    global.GAS_URL = previous.GAS_URL;
    global.AUTH_TOKEN = previous.AUTH_TOKEN;
    global.location = previous.location;
  }
});
