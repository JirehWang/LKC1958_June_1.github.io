const test = require('node:test');
const assert = require('node:assert/strict');
const library = require('./pptx-library.js');

test('recognizes hymn and responsive-reading database filenames', () => {
  assert.deepEqual(library.parseLibraryFilename('第65首 為著美麗的地面.pptx', 'hymn'), {
    kind: 'hymn', number: '65', title: '為著美麗的地面'
  });
  assert.deepEqual(library.parseLibraryFilename('第306B首 我的生命獻給祢.pptx', 'hymn'), {
    kind: 'hymn', number: '306B', title: '我的生命獻給祢'
  });
  assert.deepEqual(library.parseLibraryFilename('21.pptx', 'response'), {
    kind: 'response', number: '21', title: '啟應文 21'
  });
  assert.equal(library.parseLibraryFilename('說明文件.pptx', 'hymn'), null);
});

test('normalizes calendar numbers without losing a hymn suffix', () => {
  assert.equal(library.normalizeLibraryNumber('第 065 首'), '65');
  assert.equal(library.normalizeLibraryNumber('306b'), '306B');
  assert.equal(library.normalizeLibraryNumber('第 21 篇'), '21');
});

test('matches library entries by kind and normalized number', () => {
  const entries = [
    { kind: 'hymn', number: '65', fileId: 'h65' },
    { kind: 'hymn', number: '306B', fileId: 'h306b' },
    { kind: 'response', number: '21', fileId: 'r21' }
  ];
  assert.equal(library.findLibraryEntry(entries, 'hymn', '第065首').fileId, 'h65');
  assert.equal(library.findLibraryEntry(entries, 'hymn', '306b').fileId, 'h306b');
  assert.equal(library.findLibraryEntry(entries, 'response', '第 21 篇').fileId, 'r21');
});

test('accepts standard wide presentations and rejects non-16:9 presentations', () => {
  assert.equal(library.isSixteenByNine(12192000, 6858000), true);
  assert.equal(library.isSixteenByNine(10240000, 7680000), false);
});

test('composes PowerPoint group transforms into slide coordinates', () => {
  const parent = library.groupTransform({
    offX: 100, offY: 200, extX: 400, extY: 300,
    chOffX: 10, chOffY: 20, chExtX: 200, chExtY: 150
  }, { sx: 1, sy: 1, tx: 0, ty: 0 });
  assert.deepEqual(parent, { sx: 2, sy: 2, tx: 80, ty: 160 });
  assert.deepEqual(library.mapRect({ x: 20, y: 30, w: 50, h: 25 }, parent), {
    x: 120, y: 220, w: 100, h: 50
  });
});

test('turns EMU rectangles into stable percentages', () => {
  assert.deepEqual(
    library.rectToPercent({ x: 0, y: 685800, w: 6096000, h: 3429000 }, 12192000, 6858000),
    { x: 0, y: 10, w: 50, h: 50 }
  );
});

test('parses PowerPoint picture source rectangles without discarding negative crop values', () => {
  const sourceRect = {
    getAttribute: name => ({ l: '1147', t: '11473', r: '-1147', b: '48766' })[name] || null
  };
  const picture = {
    getElementsByTagNameNS: (_namespace, localName) => localName === 'srcRect' ? [sourceRect] : []
  };

  assert.deepEqual(library.parseSourceRect(picture), {
    left: 0.01147,
    top: 0.11473,
    right: -0.01147,
    bottom: 0.48766
  });
});

test('maps hymn 123B positive crop values to the full picture frame', () => {
  assert.deepEqual(library.calculateCroppedImageDraw(
    1000,
    500,
    { x: 100, y: 200, w: 800, h: 400 },
    { left: 0, top: 0.03799, right: 0, bottom: 0.584 }
  ), {
    sourceX: 0,
    sourceY: 18.995,
    sourceWidth: 1000,
    sourceHeight: 189.005,
    targetX: 100,
    targetY: 200,
    targetWidth: 800,
    targetHeight: 400
  });
});

test('maps hymn 515 mixed positive and negative crop values without stretching blank space', () => {
  assert.deepEqual(library.calculateCroppedImageDraw(
    1000,
    500,
    { x: 100, y: 200, w: 800, h: 400 },
    { left: 0.01147, top: 0.11473, right: -0.01147, bottom: 0.48766 }
  ), {
    sourceX: 11.47,
    sourceY: 57.365,
    sourceWidth: 988.53,
    sourceHeight: 198.805,
    targetX: 100,
    targetY: 200,
    targetWidth: 790.824,
    targetHeight: 400
  });
});

test('keeps blank frame space when a PowerPoint crop extends beyond the source image', () => {
  assert.deepEqual(library.calculateCroppedImageDraw(
    1000,
    500,
    { x: 100, y: 200, w: 800, h: 400 },
    { left: -0.1, top: 0.1, right: 0.1, bottom: 0.5 }
  ), {
    sourceX: 0,
    sourceY: 50,
    sourceWidth: 900,
    sourceHeight: 200,
    targetX: 180,
    targetY: 200,
    targetWidth: 720,
    targetHeight: 400
  });
});

test('rejects crop rectangles that leave no drawable source area', () => {
  assert.equal(library.calculateCroppedImageDraw(
    1000,
    500,
    { x: 0, y: 0, w: 800, h: 400 },
    { left: 0.6, top: 0, right: 0.4, bottom: 0 }
  ), null);
});

test('reports the PPTX download stage when the browser fetch fails', async () => {
  const previousFetch = global.fetch;
  global.fetch = async () => { throw new TypeError('Failed to fetch'); };
  try {
    await assert.rejects(
      library.downloadAndParse({ fileId: 'test-file' }, {}),
      /PPTX 下載失敗.*Failed to fetch/
    );
  } finally {
    global.fetch = previousFetch;
  }
});

test('decodes a GAS Base64 PPTX response without using Drive fetch', async () => {
  const bytes = library.base64ToArrayBuffer(Buffer.from([80, 75, 3, 4]).toString('base64'));
  assert.deepEqual(Array.from(new Uint8Array(bytes)), [80, 75, 3, 4]);
});

test('resolves PowerPoint theme text colors so responsive-reading roles stay distinct', () => {
  const theme = { dk1: '#000000', dk2: '#0E2841' };
  const colorMap = { tx1: 'dk1', tx2: 'dk2' };
  assert.equal(library.resolveSchemeColor('tx1', theme, colorMap), '#000000');
  assert.equal(library.resolveSchemeColor('tx2', theme, colorMap), '#0E2841');
});

test('prefers a Firebase Storage download URL over the GAS Base64 endpoint', async () => {
  const previousFetch = global.fetch;
  let fetchedUrl = '';
  let gasCalls = 0;
  global.fetch = async url => {
    fetchedUrl = url;
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(4) };
  };
  const jszip = { loadAsync: async () => { throw new Error('storage payload reached parser'); } };
  try {
    await assert.rejects(
      library.downloadAndParse(
        { fileId: 'h65', downloadUrl: 'https://firebasestorage.googleapis.com/example.pptx' },
        jszip,
        async () => { gasCalls += 1; throw new Error('GAS must not run'); }
      )
    );
    assert.equal(fetchedUrl, 'https://firebasestorage.googleapis.com/example.pptx');
    assert.equal(gasCalls, 0);
  } finally {
    global.fetch = previousFetch;
  }
});

test('routes Google Drive download URLs through the GAS Base64 proxy', async () => {
  const previousFetch = global.fetch;
  let directFetchCalls = 0;
  let gasCalls = 0;
  global.fetch = async () => {
    directFetchCalls += 1;
    throw new TypeError('Drive CORS blocked');
  };
  const jszip = { loadAsync: async () => { throw new Error('GAS payload reached parser'); } };
  try {
    await assert.rejects(
      library.downloadAndParse(
        {
          fileId: 'h65',
          downloadUrl: 'https://drive.usercontent.google.com/download?id=h65&export=download&confirm=t'
        },
        jszip,
        async () => {
          gasCalls += 1;
          return { data: { base64: Buffer.from([80, 75, 3, 4]).toString('base64') } };
        }
      )
    );
    assert.equal(directFetchCalls, 0);
    assert.equal(gasCalls, 1);
  } finally {
    global.fetch = previousFetch;
  }
});

test('falls back to the indexed Drive URL when the GAS PPTX proxy returns a health response', async () => {
  const previousFetch = global.fetch;
  const previousDOMParser = global.DOMParser;
  const directUrl = 'https://drive.usercontent.google.com/download?id=h65&export=download&confirm=t';
  const fetchedUrls = [];
  let gasCalls = 0;
  global.fetch = async url => {
    fetchedUrls.push(url);
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(4) };
  };
  global.DOMParser = class {};
  const jszip = { loadAsync: async () => { throw new Error('direct payload reached parser'); } };
  try {
    await assert.rejects(
      library.downloadAndParse(
        { fileId: 'h65', downloadUrl: directUrl },
        jszip,
        async () => {
          gasCalls += 1;
          const error = new Error('後端服務回傳健康檢查文字');
          error.type = 'INVALID_RESPONSE';
          throw error;
        }
      ),
      /direct payload reached parser/
    );
    assert.equal(gasCalls, 1);
    assert.deepEqual(fetchedUrls, [directUrl]);
  } finally {
    global.fetch = previousFetch;
    if (previousDOMParser === undefined) delete global.DOMParser;
    else global.DOMParser = previousDOMParser;
  }
});

test('uses an inherited slide-layout font size when a placeholder run omits sz', () => {
  assert.deepEqual(library.inheritRunStyle({ bold: true }, 60), { bold: true, fontSize: 60 });
  assert.deepEqual(library.inheritRunStyle({ fontSize: 48 }, 60), { fontSize: 48 });
});

test('preserves PowerPoint text auto-fit and body margins', () => {
  const bodyProperties = {
    childNodes: [{ nodeType: 1, localName: 'spAutoFit' }],
    getAttribute: name => ({ wrap: 'none', lIns: '91440', tIns: '45720', rIns: '91440', bIns: '45720' }[name] || null)
  };
  const result = library.parseTextBodyProperties(bodyProperties, 12192000, 6858000);

  assert.equal(result.autoFit, 'shape');
  assert.equal(result.wrap, 'none');
  assert.equal(result.fitText, true);
  assert.deepEqual(result.textInsets, { left: 0.75, top: 0.6667, right: 0.75, bottom: 0.6667 });
});

test('rasterizes an imported library page into one transparent full-slide image', async () => {
  const calls = [];
  const context = {
    clearRect: (...args) => calls.push(['clearRect', ...args]),
    drawImage: (...args) => calls.push(['drawImage', ...args]),
    fillText: (...args) => calls.push(['fillText', ...args]),
    measureText: text => ({ width: String(text).length * 20 }),
    save() {}, restore() {},
    set font(value) { calls.push(['font', value]); },
    set fillStyle(value) { calls.push(['fillStyle', value]); },
    set textBaseline(value) { calls.push(['textBaseline', value]); }
  };
  const canvas = {
    width: 0, height: 0,
    getContext: () => context,
    toDataURL: type => `data:${type};base64,rasterized`
  };
  const pages = [{
    id: 'imported:1', kind: 'ppt-import', sourceWidth: 12192000, sourceHeight: 6858000,
    objects: [
      { type: 'image', src: 'data:image/png;base64,score', x: 5, y: 10, w: 90, h: 35 },
      { type: 'text', x: 10, y: 50, w: 80, h: 20, align: 'center', verticalAlign: 'center', fontSize: 36, runs: [{ text: '歌詞', fontSize: 36, color: '#ff0000' }] }
    ]
  }];

  const result = await library.rasterizeImportedPages(pages, {
    width: 1600,
    createCanvas: () => canvas,
    loadImage: async src => ({ src })
  });

  assert.equal(canvas.width, 1600);
  assert.equal(canvas.height, 900);
  assert.deepEqual(result[0].objects, [{
    type: 'image', src: 'data:image/png;base64,rasterized', x: 0, y: 0, w: 100, h: 100
  }]);
  assert.equal(result[0].rasterized, true);
  assert.ok(calls.some(call => call[0] === 'drawImage'));
  assert.ok(calls.some(call => call[0] === 'fillText' && call[1] === '歌詞'));
});

test('fits imported text inside its source box before rasterizing', async () => {
  const fills = [];
  let currentFont = '';
  const context = {
    clearRect() {},
    fillText: (text, x, y) => fills.push({ text, x, y, font: currentFont }),
    measureText: text => {
      const size = Number((currentFont.match(/([0-9.]+)px/) || [])[1]) || 0;
      return { width: String(text).length * size * 1.2 };
    },
    set font(value) { currentFont = value; },
    get font() { return currentFont; },
    set fillStyle(_) {},
    set textBaseline(_) {}
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => context,
    toDataURL: () => 'data:image/png;base64,rasterized'
  };

  await library.rasterizeImportedPages([{
    sourceWidth: 12192000,
    sourceHeight: 6858000,
    objects: [{
      type: 'text',
      x: 10,
      y: 10,
      w: 10,
      h: 12,
      align: 'left',
      verticalAlign: 'start',
      fitText: true,
      fontSize: 36,
      runs: [{ text: '超長歌詞', fontSize: 36 }]
    }]
  }], {
    width: 1600,
    createCanvas: () => canvas
  });

  assert.equal(fills.length, 1);
  const renderedSize = Number((fills[0].font.match(/([0-9.]+)px/) || [])[1]);
  const renderedWidth = fills[0].text.length * renderedSize * 1.2;
  assert.ok(fills[0].x + renderedWidth <= 320.01, 'text must stay inside the source box');
});

test('rasterizes cropped score images with Canvas source and target rectangles', async () => {
  const calls = [];
  const context = {
    clearRect() {},
    drawImage: (...args) => calls.push(args)
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => context,
    toDataURL: () => 'data:image/png;base64,rasterized'
  };
  const pages = [{
    sourceWidth: 12192000,
    sourceHeight: 6858000,
    objects: [{
      type: 'image',
      src: 'data:image/png;base64,score',
      x: 10,
      y: 20,
      w: 80,
      h: 40,
      crop: { left: -0.1, top: 0.1, right: 0.1, bottom: 0.5 }
    }]
  }];

  await library.rasterizeImportedPages(pages, {
    width: 1000,
    createCanvas: () => canvas,
    loadImage: async () => ({ naturalWidth: 1000, naturalHeight: 500 })
  });

  assert.deepEqual(calls[0].slice(1), [
    0, 50, 900, 200,
    180, 112.6, 720, 225.2
  ]);
});

test('normalizes responsive-reading titles to the same centered vertical alignment before rasterizing', () => {
  const firstPageTitle = { type: 'text', role: 'title', verticalAlign: 'start' };
  const laterPageTitle = { type: 'text', role: 'title', verticalAlign: 'end' };
  assert.equal(library.rasterObject(firstPageTitle, { titleVerticalAlign: 'center' }).verticalAlign, 'center');
  assert.equal(library.rasterObject(laterPageTitle, { titleVerticalAlign: 'center' }).verticalAlign, 'center');
  assert.equal(library.rasterObject({ type: 'text', role: 'content', verticalAlign: 'end' }, { titleVerticalAlign: 'center' }).verticalAlign, 'end');
});

test('resolves global JSZip fallback when JSZipImplementation is not provided', async () => {
  const previousJSZip = global.JSZip;
  const previousDOMParser = global.DOMParser;
  let loadAsyncCalled = false;
  global.JSZip = {
    loadAsync: async () => {
      loadAsyncCalled = true;
      throw new Error('global JSZip successfully reached');
    }
  };
  global.DOMParser = class {};
  try {
    await assert.rejects(
      library.parsePptx(new ArrayBuffer(4)),
      /global JSZip successfully reached/
    );
    assert.equal(loadAsyncCalled, true);
  } finally {
    global.JSZip = previousJSZip;
    if (previousDOMParser === undefined) delete global.DOMParser;
    else global.DOMParser = previousDOMParser;
  }
});

test('throws PPTX 解析元件尚未載入 when no JSZip implementation is available', async () => {
  const previousJSZip = global.JSZip;
  delete global.JSZip;
  try {
    await assert.rejects(
      library.parsePptx(new ArrayBuffer(4)),
      /PPTX 解析元件尚未載入/
    );
  } finally {
    global.JSZip = previousJSZip;
  }
});

test('resolves relative and root-relative OPC part paths correctly', () => {
  assert.equal(library.resolvePartPath('ppt/slides/slide1.xml', '../slideLayouts/slideLayout1.xml'), 'ppt/slideLayouts/slideLayout1.xml');
  assert.equal(library.resolvePartPath('ppt/slides/slide1.xml', '/ppt/slideLayouts/slideLayout14.xml'), 'ppt/slideLayouts/slideLayout14.xml');
  assert.equal(library.resolvePartPath('ppt/presentation.xml', '/ppt/slides/slide1.xml'), 'ppt/slides/slide1.xml');
  assert.equal(library.resolvePartPath('ppt/presentation.xml', 'ppt/slides/slide1.xml'), 'ppt/slides/slide1.xml');
  assert.equal(library.resolvePartPath('ppt/presentation.xml', 'slides/slide1.xml'), 'ppt/slides/slide1.xml');
});

