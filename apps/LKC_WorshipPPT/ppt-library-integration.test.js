const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadIntegration(profile, sourcePages, options = {}) {
  const model = {
    'worship-moment': { pptPages: [{ kind: 'fallback-worship' }] },
    offering: { sourceValue: '306B', pptPages: [{ kind: 'fallback-offering' }] },
    'prayer-song': { sourceValue: '261', pptPages: [{ kind: 'fallback-prayer' }] },
    amen: { sourceValue: '522', pptPages: [{ kind: 'fallback-amen' }] },
    thanksgiving: { pptPages: [{ kind: 'fallback-thanksgiving' }] }
  };
  const requestedEntries = [];
  const downloadAndParse = options.downloadAndParse || (async entry => sourcePages[entry.id]);
  const window = {
    activeWorshipTemplateProfile: profile,
    JSZip: {},
    worshipReadAPI: options.worshipReadAPI || (async () => ({ data: [] })),
    worshipSyncAPI: options.worshipSyncAPI || (async () => ({ success: true, data: {} })),
    TaiwaneseWorshipPptxLibrary: {
      downloadAndParse: async entry => {
        requestedEntries.push(entry);
        return downloadAndParse(entry);
      },
      rasterizeImportedPages: async pages => pages.map(page => ({ ...page, rasterized: true })),
      normalizeLibraryNumber: value => String(value || '').trim().toUpperCase(),
      findLibraryEntry: (entries, kind, number) => entries.find(entry => (
        entry.kind === kind && String(entry.number).trim().toUpperCase() === number
      ))
    },
    addEventListener() {}
  };
  if (options.pptRetryDelayMs !== undefined) {
    window.LKC_PPT_RETRY_DELAY_MS = options.pptRetryDelayMs;
  }
  const context = { window, model, active: 'worship-moment', render() {}, setTimeout, clearTimeout };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, 'ppt-library-integration.js'), 'utf8'),
    context
  );
  return { window, model, requestedEntries };
}

test('loads fixed Google presentations and maps selected slides to their worship sections', async () => {
  const profile = {
    externalPresentations: [
      {
        id: 'worship-moment-source',
        fileId: 'worship-file',
        sourceUrl: 'https://docs.google.com/presentation/d/worship-file/edit',
        mappings: [{ sectionId: 'worship-moment', pageIndexes: [0] }]
      },
      {
        id: 'offering-source',
        fileId: 'offering-file',
        sourceUrl: 'https://docs.google.com/presentation/d/offering-file/edit',
        mappings: [
          { sectionId: 'offering', pageIndexes: [0] },
          { sectionId: 'thanksgiving', pageIndexes: [1] }
        ]
      }
    ]
  };
  const { window, model, requestedEntries } = loadIntegration(profile, {
    'worship-moment-source': [{ objects: [{ type: 'image', src: 'worship' }] }],
    'offering-source': [
      { objects: [{ type: 'text', text: '奉獻說明' }] },
      { objects: [{ type: 'text', text: '獻上感恩' }] }
    ]
  });

  const results = await window.loadExternalPresentationSources();

  assert.equal(results.length, 2);
  assert.deepEqual(requestedEntries.map(entry => entry.fileId), ['worship-file', 'offering-file']);
  assert.equal(model['worship-moment'].pptPages[0].id, 'worship-moment:1');
  assert.equal(model.offering.pptPages[0].objects[0].text, '奉獻說明');
  assert.equal(model.thanksgiving.pptPages[0].objects[0].text, '獻上感恩');
  assert.equal(model.thanksgiving.externalSourceFileId, 'offering-file');
});

test('skips a failed external presentation and keeps its built-in fallback pages', async () => {
  const profile = {
    externalPresentations: [{
      id: 'broken-source',
      fileId: 'broken-file',
      mappings: [{ sectionId: 'worship-moment', pageIndexes: [0] }]
    }]
  };
  const { window, model } = loadIntegration(profile, { 'broken-source': undefined });
  window.TaiwaneseWorshipPptxLibrary.downloadAndParse = async () => {
    throw new Error('download failed');
  };

  assert.equal((await window.loadExternalPresentationSources()).length, 0);
  assert.equal(model['worship-moment'].pptPages[0].kind, 'fallback-worship');
});

test('serializes PPT library downloads so only one GAS file request is active', async () => {
  const entries = [
    { kind: 'hymn', number: '261', title: '祈禱詩', fileId: 'file-261', fileName: '261.pptx' },
    { kind: 'hymn', number: '306B', title: '奉獻', fileId: 'file-306B', fileName: '306B.pptx' },
    { kind: 'hymn', number: '522', title: '阿們頌', fileId: 'file-522', fileName: '522.pptx' }
  ];
  const events = [];
  let activeDownloads = 0;
  let maxConcurrentDownloads = 0;
  const { window, model, requestedEntries } = loadIntegration({
    librarySections: [
      ['prayer-song', 'hymn'],
      ['offering', 'hymn'],
      ['amen', 'hymn']
    ]
  }, {}, {
    worshipReadAPI: async () => ({ data: entries }),
    downloadAndParse: async entry => {
      events.push(`start:${entry.fileId}`);
      activeDownloads += 1;
      maxConcurrentDownloads = Math.max(maxConcurrentDownloads, activeDownloads);
      await new Promise(resolve => setTimeout(resolve, 5));
      activeDownloads -= 1;
      events.push(`end:${entry.fileId}`);
      return [{ objects: [{ type: 'text', text: entry.fileId }] }];
    }
  });

  const result = await window.loadPptLibraryContent(['prayer-song', 'offering', 'amen']);

  assert.equal(maxConcurrentDownloads, 1);
  assert.deepEqual(events, [
    'start:file-261', 'end:file-261',
    'start:file-306B', 'end:file-306B',
    'start:file-522', 'end:file-522'
  ]);
  assert.deepEqual(requestedEntries.map(entry => entry.fileId), ['file-261', 'file-306B', 'file-522']);
  assert.deepEqual(Array.from(result, item => item.state), ['loaded', 'loaded', 'loaded']);
  assert.equal(model['prayer-song'].pptPages[0].objects[0].text, 'file-261');
});

test('retries a timed-out PPTX once, removes stale hymn pages, and continues the queue', async () => {
  const entries = [
    { kind: 'hymn', number: '261', title: '祈禱詩', fileId: 'file-261', fileName: '261.pptx' },
    { kind: 'hymn', number: '306B', title: '奉獻', fileId: 'file-306B', fileName: '306B.pptx' },
    { kind: 'hymn', number: '522', title: '阿們頌', fileId: 'file-522', fileName: '522.pptx' }
  ];
  const attempts = new Map();
  const { window, model, requestedEntries } = loadIntegration({
    librarySections: [
      ['prayer-song', 'hymn'],
      ['offering', 'hymn'],
      ['amen', 'hymn']
    ]
  }, {}, {
    pptRetryDelayMs: 0,
    worshipReadAPI: async () => ({ data: entries }),
    downloadAndParse: async entry => {
      attempts.set(entry.fileId, (attempts.get(entry.fileId) || 0) + 1);
      if (entry.fileId === 'file-261') {
        const error = new Error('雲端行事曆讀取逾時');
        error.type = 'TIMEOUT';
        throw error;
      }
      return [{ objects: [{ type: 'text', text: entry.fileId }] }];
    }
  });

  const result = await window.loadPptLibraryContent(['prayer-song', 'offering', 'amen']);

  assert.deepEqual(Array.from(result, item => item.state), ['error', 'loaded', 'loaded']);
  assert.equal(attempts.get('file-261'), 2);
  assert.equal(attempts.get('file-306B'), 1);
  assert.equal(attempts.get('file-522'), 1);
  assert.deepEqual(
    requestedEntries.map(entry => entry.fileId),
    ['file-261', 'file-261', 'file-306B', 'file-522']
  );
  assert.equal(model['prayer-song'].pptPages, undefined);
  assert.match(model['prayer-song'].libraryError, /雲端行事曆讀取逾時/);
});

test('serializes concurrent external PPTX source downloads through the shared queue', async () => {
  const events = [];
  let activeDownloads = 0;
  let maxConcurrentDownloads = 0;
  const { window } = loadIntegration({
    externalPresentations: [
      {
        id: 'external-source-a',
        fileId: 'file-external-a',
        mappings: [{ sectionId: 'worship-moment', pageIndexes: [0] }]
      },
      {
        id: 'external-source-b',
        fileId: 'file-external-b',
        mappings: [{ sectionId: 'offering', pageIndexes: [0] }]
      }
    ]
  }, {}, {
    downloadAndParse: async entry => {
      events.push(`start:${entry.fileId}`);
      activeDownloads += 1;
      maxConcurrentDownloads = Math.max(maxConcurrentDownloads, activeDownloads);
      await new Promise(resolve => setTimeout(resolve, 5));
      activeDownloads -= 1;
      events.push(`end:${entry.fileId}`);
      return [{ objects: [] }];
    }
  });

  await window.loadExternalPresentationSources();

  assert.equal(maxConcurrentDownloads, 1);
  assert.deepEqual(events, [
    'start:file-external-a', 'end:file-external-a',
    'start:file-external-b', 'end:file-external-b'
  ]);
});

test('index.html includes vendor-jszip before pptx-library.js', () => {
  const indexHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const jszipIndex = indexHtml.indexOf('vendor-jszip.min.js');
  const pptxLibraryIndex = indexHtml.indexOf('pptx-library.js');
  assert.ok(jszipIndex !== -1, 'vendor-jszip.min.js must be present in index.html');
  assert.ok(pptxLibraryIndex !== -1, 'pptx-library.js must be present in index.html');
  assert.ok(jszipIndex < pptxLibraryIndex, 'vendor-jszip.min.js must be loaded before pptx-library.js');
  assert.match(indexHtml, /ppt-library-integration\.js\?v=20261009a/);
});

test('manual hymn index sync requests a full GAS hymn scan before loading a section', async () => {
  const calls = [];
  const { window } = loadIntegration({
    librarySections: [['prayer-song', 'hymn']]
  }, {}, {
    worshipSyncAPI: async (...args) => {
      calls.push(args);
      return { success: true, data: { scope: 'hymn', inserted: 1 } };
    }
  });

  const result = await window.syncHymnLibraryIndex();

  assert.deepEqual(result, { scope: 'hymn', inserted: 1 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'cal_syncPptHymnIndex');
  assert.equal(calls[0][1].kind, 'hymn');
});

test('retries a GAS_HTML_ERROR PPTX once and recovers if second attempt succeeds', async () => {
  const entries = [
    { kind: 'hymn', number: '261', title: '祈禱詩', fileId: 'file-261', fileName: '261.pptx' }
  ];
  let attempt = 0;
  const { window, model } = loadIntegration({
    librarySections: [['prayer-song', 'hymn']]
  }, {}, {
    pptRetryDelayMs: 0,
    worshipReadAPI: async () => ({ data: entries }),
    downloadAndParse: async () => {
      attempt += 1;
      if (attempt === 1) {
        const error = new Error('後端服務 (GAS) 回傳 HTML 頁面，可能是權限不足或後端執行逾時');
        error.type = 'GAS_HTML_ERROR';
        throw error;
      }
      return [{ objects: [{ type: 'text', text: 'recovered' }] }];
    }
  });

  const result = await window.loadPptLibraryContent(['prayer-song']);
  assert.equal(attempt, 2);
  assert.equal(result[0].state, 'loaded');
  assert.equal(model['prayer-song'].pptPages[0].objects[0].text, 'recovered');
});

test('accepts the legacy GAS index envelope and normalizes snake_case file metadata', async () => {
  const { window, model, requestedEntries } = loadIntegration({
    librarySections: [['prayer-song', 'hymn']]
  }, {}, {
    worshipReadAPI: async () => ({
      success: true,
      records: [{
        kind: 'hymn',
        number: '261',
        file_id: 'file-261',
        title: '祈禱詩',
        file_name: '第261首 祈禱詩.pptx'
      }]
    }),
    downloadAndParse: async entry => [{ objects: [{ type: 'text', text: entry.fileId }] }]
  });

  const result = await window.loadPptLibraryContent(['prayer-song']);

  assert.equal(result[0].state, 'loaded');
  assert.equal(requestedEntries[0].fileId, 'file-261');
  assert.equal(model['prayer-song'].pptPages[0].objects[0].text, 'file-261');
});

test('loads a newly indexed hymn without refreshing a page that already cached a missing index', async () => {
  let entries = [];
  let reads = 0;
  const { window, model } = loadIntegration({ librarySections: [['prayer-song', 'hymn']] }, {}, {
    worshipReadAPI: async () => { reads += 1; return { data: entries }; },
    worshipSyncAPI: async (action, data) => {
      assert.equal(data.number, '242');
      entries = [{ kind: 'hymn', number: '242', fileId: 'file-242', fileName: '第242首 祈禱.pptx' }];
      return { success: true, data: { inserted: 1 } };
    },
    downloadAndParse: async () => [{ objects: [{ type: 'text', text: '242' }] }]
  });
  model['prayer-song'].sourceValue = '242';
  assert.equal((await window.loadPptLibraryContent())[0].state, 'missing');
  await window.syncHymnLibraryIndex('242');
  assert.equal((await window.loadPptLibraryContent())[0].state, 'loaded');
  assert.equal(reads, 2);
  assert.equal(model['prayer-song'].libraryFileId, 'file-242');
});

test('rechecks the index when GAS committed a sync but its response timed out', async () => {
  let entries = [];
  const { window, model } = loadIntegration({ librarySections: [['prayer-song', 'hymn']] }, {}, {
    worshipReadAPI: async () => ({ data: entries }),
    worshipSyncAPI: async () => {
      entries = [{ kind: 'hymn', number: '242', fileId: 'file-242', fileName: '第242首 祈禱.pptx' }];
      const error = new Error('同步回應逾時');
      error.type = 'TIMEOUT';
      throw error;
    },
    downloadAndParse: async () => [{ objects: [] }]
  });
  model['prayer-song'].sourceValue = '242';
  assert.equal((await window.loadPptLibraryContent())[0].state, 'missing');
  await assert.rejects(window.syncHymnLibraryIndex('242'), /同步回應逾時/);
  assert.equal((await window.loadPptLibraryContent())[0].state, 'loaded');
});

test('a rejected index read can recover on the next load', async () => {
  let reads = 0;
  const { window } = loadIntegration({ librarySections: [['prayer-song', 'hymn']] }, {}, {
    worshipReadAPI: async () => {
      if (++reads === 1) throw new Error('network unavailable');
      return { data: [{ kind: 'hymn', number: '261', fileId: 'file-261' }] };
    },
    downloadAndParse: async () => [{ objects: [] }]
  });
  await assert.rejects(window.loadPptLibraryContent(), /network unavailable/);
  assert.equal((await window.loadPptLibraryContent())[0].state, 'loaded');
});

test('an empty PPTX reports an error and does not block the following hymn', async () => {
  const { window, model } = loadIntegration({ librarySections: [['prayer-song', 'hymn'], ['amen', 'hymn']] }, {}, {
    worshipReadAPI: async () => ({ data: [
      { kind: 'hymn', number: '261', fileId: 'empty-file' },
      { kind: 'hymn', number: '513', fileId: 'file-513' }
    ] }),
    downloadAndParse: async entry => entry.fileId === 'empty-file' ? [] : [{ objects: [] }]
  });
  model.amen.sourceValue = '513';
  const result = await window.loadPptLibraryContent();
  assert.deepEqual(Array.from(result, item => item.state), ['error', 'loaded']);
  assert.match(result[0].message, /沒有可用的投影片/);
  assert.equal(model.amen.libraryFileId, 'file-513');
});

test('a preview rasterization failure preserves the original hymn for native export', async () => {
  const { window, model } = loadIntegration({ librarySections: [['prayer-song', 'hymn']] }, {}, {
    worshipReadAPI: async () => ({ data: [{ kind: 'hymn', number: '261', fileId: 'file-261' }] }),
    downloadAndParse: async () => [{ objects: [], nativeSource: { packageId: 'file-261' } }]
  });
  window.TaiwaneseWorshipPptxLibrary.rasterizeImportedPages = async () => { throw new Error('preview image failed'); };
  assert.equal((await window.loadPptLibraryContent())[0].state, 'loaded');
  assert.equal(model['prayer-song'].pptPages[0].nativeExport, true);
  assert.match(model['prayer-song'].pptPages[0].previewError, /preview image failed/);
});

