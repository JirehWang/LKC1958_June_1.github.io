const test = require('node:test');
const assert = require('node:assert/strict');
const { buildJsonpUrl, jsonp, read, sync } = require('./read-api.js');

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

test('manual hymn index sync posts only to the dedicated Library GAS endpoint', async () => {
  const previous = {
    fetch: global.fetch,
    LKC_WORSHIP_PPT_LIBRARY_GAS_URL: global.LKC_WORSHIP_PPT_LIBRARY_GAS_URL,
    AUTH_TOKEN: global.AUTH_TOKEN,
    location: global.location
  };
  const calls = [];
  global.LKC_WORSHIP_PPT_LIBRARY_GAS_URL = 'https://script.google.com/macros/s/ppt-library/exec';
  global.AUTH_TOKEN = 'ChurchApp-2026';
  global.location = { protocol: 'https:', hostname: 'example.com' };
  global.fetch = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      text: async () => JSON.stringify({
        success: true,
        data: { scope: 'hymn', inserted: 2, updated: 1, unchanged: 40 }
      })
    };
  };

  try {
    const result = await sync('cal_syncPptHymnIndex', { kind: 'hymn' });
    assert.deepEqual(result.data, { scope: 'hymn', inserted: 2, updated: 1, unchanged: 40 });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, global.LKC_WORSHIP_PPT_LIBRARY_GAS_URL);
    assert.equal(calls[0].init.method, 'POST');
    assert.deepEqual(JSON.parse(calls[0].init.body), {
      action: 'cal_syncPptHymnIndex',
      token: 'ChurchApp-2026',
      data: { kind: 'hymn' }
    });
  } finally {
    Object.assign(global, previous);
  }
});

test('does not retry JSONP after the dedicated GAS reports a backend sync error', async () => {
  const previous = {
    fetch: global.fetch,
    LKC_WORSHIP_PPT_LIBRARY_GAS_URL: global.LKC_WORSHIP_PPT_LIBRARY_GAS_URL,
    AUTH_TOKEN: global.AUTH_TOKEN,
    document: global.document
  };
  let postCalls = 0;
  global.LKC_WORSHIP_PPT_LIBRARY_GAS_URL = 'https://script.google.com/macros/s/ppt-library/exec';
  global.AUTH_TOKEN = 'ChurchApp-2026';
  global.document = {
    createElement() {
      throw new Error('backend errors must not fall through to JSONP');
    }
  };
  global.fetch = async () => {
    postCalls += 1;
    return {
      ok: true,
      text: async () => JSON.stringify({
        success: false,
        message: '缺少 Script Property'
      })
    };
  };

  try {
    await assert.rejects(sync('cal_syncPptHymnIndex', { kind: 'hymn' }), /缺少 Script Property/);
    assert.equal(postCalls, 1);
  } finally {
    Object.assign(global, previous);
  }
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
    LKC_WORSHIP_PPT_LIBRARY_GAS_URL: global.LKC_WORSHIP_PPT_LIBRARY_GAS_URL,
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
  global.LKC_WORSHIP_PPT_LIBRARY_GAS_URL = 'https://script.google.com/macros/s/library/exec';
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
        queueMicrotask(() => global[callback]({ success: true, data: ['fallback'] }));
      }
    }
  };

  try {
    const result = await read('cal_getEvents', {});
    assert.deepEqual(result, { success: true, data: ['fallback'] });
    assert.equal(churchApiCalls, 0);

    global.location = { protocol: 'https:', hostname: 'example.com' };
    const fallbackResult = await read('cal_getEvents', {});
    assert.deepEqual(fallbackResult, { success: true, data: ['fallback'] });
    assert.equal(churchApiCalls, 1);
  } finally {
    Object.assign(global, previous);
  }
});

test('uses Supabase for the PPT Library index and GAS for PPTX bytes', async () => {
  const previous = {
    WorshipPptSupabaseService: global.WorshipPptSupabaseService,
    ensureAPIReady: global.ensureAPIReady,
    churchAPI: global.churchAPI,
    GAS_URL: global.GAS_URL,
    LKC_WORSHIP_PPT_LIBRARY_GAS_URL: global.LKC_WORSHIP_PPT_LIBRARY_GAS_URL,
    AUTH_TOKEN: global.AUTH_TOKEN,
    location: global.location,
    document: global.document
  };
  const directEndpoints = [];
  const jsonpEndpoints = [];
  let supabaseIndexCalls = 0;
  global.WorshipPptSupabaseService = {
    async cal_getPptLibraryIndex() {
      supabaseIndexCalls += 1;
      return { success: true, data: [{ fileId: 'library-entry' }] };
    }
  };
  global.ensureAPIReady = async () => {};
  global.churchAPI = async action => {
    directEndpoints.push(action);
    return { success: true, records: [{ text: 'main-gas' }] };
  };
  global.GAS_URL = 'https://script.google.com/macros/s/unified-main/exec';
  global.LKC_WORSHIP_PPT_LIBRARY_GAS_URL = 'https://script.google.com/macros/s/master-schedule/exec';
  global.AUTH_TOKEN = 'ChurchApp-2026';
  global.location = { protocol: 'https:', hostname: 'example.com' };
  global.document = {
    createElement() {
      return { remove() {} };
    },
    head: {
      appendChild(script) {
        const url = new URL(script.src);
        jsonpEndpoints.push({ action: url.searchParams.get('action'), endpoint: url.origin + url.pathname });
        const callback = url.searchParams.get('callback');
        queueMicrotask(() => global[callback]({ success: true, data: { base64: 'payload' } }));
      }
    }
  };

  try {
    const index = await read('cal_getPptLibraryIndex', {});
    const file = await read('cal_getPptLibraryFile', { fileId: 'library-entry' });
    const bible = await read('cal_queryBible', { book: '太', chap: 13, sec: '1-2', version: 'tghg' });
    assert.deepEqual(index, { success: true, data: [{ fileId: 'library-entry' }] });
    assert.deepEqual(file, { success: true, data: { base64: 'payload' } });
    assert.deepEqual(bible, { success: true, records: [{ text: 'main-gas' }] });
    assert.equal(supabaseIndexCalls, 1);
    assert.deepEqual(jsonpEndpoints, [{
      action: 'cal_getPptLibraryFile',
      endpoint: 'https://script.google.com/macros/s/master-schedule/exec'
    }]);
    assert.deepEqual(directEndpoints, ['cal_queryBible']);
  } finally {
    Object.assign(global, previous);
  }
});

test('uses the same PPT Library GAS bridge for index fallback and file retrieval', async () => {
  const previous = {
    WorshipPptSupabaseService: global.WorshipPptSupabaseService,
    GAS_URL: global.GAS_URL,
    LKC_WORSHIP_PPT_LIBRARY_GAS_URL: global.LKC_WORSHIP_PPT_LIBRARY_GAS_URL,
    AUTH_TOKEN: global.AUTH_TOKEN,
    location: global.location,
    document: global.document
  };
  const jsonpRequests = [];
  global.WorshipPptSupabaseService = {
    async cal_getPptLibraryIndex() { return null; }
  };
  global.GAS_URL = 'https://script.google.com/macros/s/unified-main/exec';
  global.LKC_WORSHIP_PPT_LIBRARY_GAS_URL = 'https://script.google.com/macros/s/ppt-library/exec';
  global.AUTH_TOKEN = 'ChurchApp-2026';
  global.location = { protocol: 'https:', hostname: 'example.com' };
  global.document = {
    createElement() { return { remove() {} }; },
    head: {
      appendChild(script) {
        const url = new URL(script.src);
        const callback = url.searchParams.get('callback');
        jsonpRequests.push({
          action: url.searchParams.get('action'),
          endpoint: url.origin + url.pathname,
          data: JSON.parse(url.searchParams.get('data'))
        });
        queueMicrotask(() => global[callback](
          jsonpRequests.at(-1).action === 'cal_getPptLibraryIndex'
            ? { success: true, data: [{ fileId: 'library-entry', kind: 'hymn', number: '247' }] }
            : { success: true, data: { base64: 'payload' } }
        ));
      }
    }
  };

  try {
    const index = await read('cal_getPptLibraryIndex', {});
    const file = await read('cal_getPptLibraryFile', { fileId: index.data[0].fileId });
    assert.equal(file.data.base64, 'payload');
    assert.deepEqual(jsonpRequests, [
      {
        action: 'cal_getPptLibraryIndex',
        endpoint: 'https://script.google.com/macros/s/ppt-library/exec',
        data: {}
      },
      {
        action: 'cal_getPptLibraryFile',
        endpoint: 'https://script.google.com/macros/s/ppt-library/exec',
        data: { fileId: 'library-entry' }
      }
    ]);
  } finally {
    Object.assign(global, previous);
  }
});

test('uses script JSONP before fetch for the GAS Library bridge in a browser', async () => {
  const previous = {
    window: global.window,
    fetch: global.fetch,
    WorshipPptSupabaseService: global.WorshipPptSupabaseService,
    GAS_URL: global.GAS_URL,
    LKC_WORSHIP_PPT_LIBRARY_GAS_URL: global.LKC_WORSHIP_PPT_LIBRARY_GAS_URL,
    AUTH_TOKEN: global.AUTH_TOKEN,
    location: global.location,
    document: global.document
  };
  global.window = global;
  global.WorshipPptSupabaseService = undefined;
  global.GAS_URL = 'https://script.google.com/macros/s/unified-main/exec';
  global.LKC_WORSHIP_PPT_LIBRARY_GAS_URL = 'https://script.google.com/macros/s/ppt-library/exec';
  global.AUTH_TOKEN = 'ChurchApp-2026';
  global.location = { protocol: 'http:', hostname: 'localhost' };
  let fetchCalls = 0;
  global.document = {
    createElement() {
      return { remove() {} };
    },
    head: {
      appendChild(script) {
        const callback = new URL(script.src).searchParams.get('callback');
        queueMicrotask(() => global[callback]({
          success: true,
          data: { base64: 'script-payload' }
        }));
      }
    }
  };
  global.fetch = async () => {
    fetchCalls += 1;
    throw new Error('fetch should be the fallback, not the first transport');
  };

  try {
    const result = await read('cal_getPptLibraryFile', { fileId: 'library-entry' });
    assert.deepEqual(result, { success: true, data: { base64: 'script-payload' } });
    assert.equal(fetchCalls, 0);
  } finally {
    if (previous.window === undefined) delete global.window;
    else global.window = previous.window;
    Object.assign(global, previous);
  }
});

test('does not silently send a PPT Library action to the main GAS when its bridge is missing', async () => {
  const previous = {
    WorshipPptSupabaseService: global.WorshipPptSupabaseService,
    GAS_URL: global.GAS_URL,
    LKC_WORSHIP_PPT_LIBRARY_GAS_URL: global.LKC_WORSHIP_PPT_LIBRARY_GAS_URL
  };
  global.WorshipPptSupabaseService = {
    async cal_getPptLibraryIndex() { return null; }
  };
  global.GAS_URL = 'https://script.google.com/macros/s/unified-main/exec';
  delete global.LKC_WORSHIP_PPT_LIBRARY_GAS_URL;

  try {
    await assert.rejects(
      read('cal_getPptLibraryIndex', {}),
      /PPT Library GAS 備援網址尚未就緒/
    );
  } finally {
    Object.assign(global, previous);
  }
});

test('falls back to JSONP when churchAPI throws GAS_HTML_ERROR', async () => {
  const previous = {
    ensureAPIReady: global.ensureAPIReady,
    churchAPI: global.churchAPI,
    GAS_URL: global.GAS_URL,
    AUTH_TOKEN: global.AUTH_TOKEN,
    location: global.location,
    document: global.document
  };

  global.ensureAPIReady = async () => {};
  let churchApiCalls = 0;
  global.churchAPI = async () => {
    churchApiCalls += 1;
    const err = new Error('後端服務 (GAS) 回傳 HTML 頁面，可能是權限不足或後端執行逾時');
    err.type = 'GAS_HTML_ERROR';
    err.status = 200;
    throw err;
  };
  global.GAS_URL = 'https://script.google.com/macros/s/example/exec';
  global.AUTH_TOKEN = 'ChurchApp-2026';
  global.location = { protocol: 'http:', hostname: '127.0.0.1' };
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
    const result = await read('cal_getEvents', { startDate: '2026-09-20', endDate: '2026-09-20' });
    assert.deepEqual(result, { success: true, data: ['fallback'] });
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
