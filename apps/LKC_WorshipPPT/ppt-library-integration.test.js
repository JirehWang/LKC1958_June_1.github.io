const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadIntegration(profile, sourcePages) {
  const model = {
    'worship-moment': { pptPages: [{ kind: 'fallback-worship' }] },
    offering: { pptPages: [{ kind: 'fallback-offering' }] },
    thanksgiving: { pptPages: [{ kind: 'fallback-thanksgiving' }] }
  };
  const requestedEntries = [];
  const window = {
    activeWorshipTemplateProfile: profile,
    JSZip: {},
    worshipReadAPI: async () => ({ data: [] }),
    TaiwaneseWorshipPptxLibrary: {
      downloadAndParse: async entry => {
        requestedEntries.push(entry);
        return sourcePages[entry.id];
      },
      rasterizeImportedPages: async pages => pages.map(page => ({ ...page, rasterized: true }))
    },
    addEventListener() {}
  };
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

test('index.html includes vendor-jszip before pptx-library.js', () => {
  const indexHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const jszipIndex = indexHtml.indexOf('vendor-jszip.min.js');
  const pptxLibraryIndex = indexHtml.indexOf('pptx-library.js');
  assert.ok(jszipIndex !== -1, 'vendor-jszip.min.js must be present in index.html');
  assert.ok(pptxLibraryIndex !== -1, 'pptx-library.js must be present in index.html');
  assert.ok(jszipIndex < pptxLibraryIndex, 'vendor-jszip.min.js must be loaded before pptx-library.js');
});

