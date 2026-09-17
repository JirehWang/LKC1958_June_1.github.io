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
  const context = { window, model, active: 'worship-moment', render() {} };
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

test('keeps the built-in fallback pages when an external presentation cannot load', async () => {
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

  await assert.rejects(window.loadExternalPresentationSources(), /download failed/);
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

test('retries a timed-out PPTX once, preserves fallback, and continues the queue', async () => {
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
  assert.equal(model['prayer-song'].pptPages[0].kind, 'fallback-prayer');
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

