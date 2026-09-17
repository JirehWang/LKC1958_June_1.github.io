const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  exportWorshipPPTX,
  getImportedSlideObjects,
  cleanParagraphProperties,
  deduplicatePptxMedia
} = require('./ppt-export.js');

test('exports slides correctly with mock pptxgenjs', async () => {
  const slides = [];
  let createdPptx;
  class MockPptx {
    constructor() {
      createdPptx = this;
      this.layout = '';
    }
    addSlide() {
      const slide = {
        background: null,
        shapes: [],
        images: [],
        texts: [],
        addShape(type, opts) {
          this.shapes.push({ type, opts });
        },
        addImage(opts) {
          this.images.push(opts);
        },
        addText(text, opts) {
          this.texts.push({ text, opts });
        }
      };
      slides.push(slide);
      return slide;
    }
    writeFile(opts) {
      this.writtenFileOpts = opts;
      return Promise.resolve();
    }
  }

  MockPptx.ShapeType = { rect: 'rect' };

  const mockDeck = [
    { kind: 'cover', sectionId: 'cover', sectionLabel: '台語主日禮拜' },
    { kind: 'score', sectionId: 'hymn-1', sectionLabel: '聖詩一', title: '聖詩第1首', kicker: '第一首' },
    { kind: 'ppt-import', sectionId: 'hymn-1', sectionLabel: '聖詩一', objects: [
      { type: 'image', src: 'data:image/png;base64,123', x: 10, y: 10, w: 20, h: 20 },
      { type: 'text', role: 'content', text: '歌詞內容', x: 15, y: 25, w: 70, h: 50, runs: [{ text: '歌詞內容', fontSize: 18 }] }
    ]}
  ];

  const mockLayoutState = { groups: {}, pageAssignments: {} };
  const mockProduction = {
    layoutForPage: () => ({
      titleSize: 60, titleX: 10, titleY: 6, titleW: 80, titleH: 16, titleAlign: 'center', titleColor: '#111111',
      contentSize: 48, contentX: 8, contentY: 24, contentW: 84, contentH: 68, contentAlign: 'left', contentColor: '#111111', lineSpacing: 1.5
    })
  };

  const mockModel = {
    'hymn-1': { opacity: 50 }
  };

  // Run export
  const exportOptions = {
    PptxGenJS: MockPptx,
    getDeckEntries: () => mockDeck,
    layoutState: mockLayoutState,
    production: mockProduction,
    model: mockModel,
    backgroundColor: '#ffffff',
    backgroundImage: '',
    serviceDate: '2026-07-14'
  };

  // Mock global/root variables
  globalThis.hymnOpacitySectionIds = ['hymn-1'];

  await exportWorshipPPTX(exportOptions);

  assert.equal(createdPptx.layout, 'LAYOUT_WIDE');
  assert.equal(slides.length, 3);
  
  // Verify slide 1: cover
  assert.equal(slides[0].texts.length, 2);
  assert.equal(slides[0].texts[0].text, '台語主日禮拜');
  assert.equal(slides[0].texts[1].text, '主後2026年07月14日');

  // Verify slide 2: score (hymn-1) has white overlay shape
  assert.equal(slides[1].shapes.length, 2);
  assert.equal(slides[1].shapes[0].type, 'rect');
  assert.equal(slides[1].shapes[0].opts.fill.transparency, 50); // 100 - opacity(50) = 50
  assert.equal(slides[1].shapes[0].opts.w, 13.333);
  assert.equal(slides[1].shapes[0].opts.h, 7.5);
  assert.equal(slides[1].texts[0].text, '聖詩第1首');

  // Verify slide 3: ppt-import
  assert.equal(slides[2].images.length, 1);
  assert.equal(slides[2].images[0].data, 'data:image/png;base64,123');
  assert.equal(slides[2].texts.length, 1);
  assert.equal(slides[2].texts[0].text[0].text, '歌詞內容');
});

test('uses safe default bounds when an ungrouped page has no stored layout parameters', async () => {
  const slides = [];
  class MockPptx {
    addSlide() {
      const slide = {
        texts: [],
        addText(text, opts) { this.texts.push({ text, opts }); },
        addShape() {},
        addImage() {}
      };
      slides.push(slide);
      return slide;
    }
    writeFile() { return Promise.resolve(); }
  }

  await exportWorshipPPTX({
    PptxGenJS: MockPptx,
    getDeckEntries: () => [{ kind: 'cover', sectionId: 'cover', sectionLabel: '台語主日禮拜' }],
    layoutState: { groups: {}, pageAssignments: {} },
    production: require('./slide-production.js'),
    model: {},
    backgroundColor: '#ffffff',
    serviceDate: '2026-07-12'
  });

  assert.equal(slides[0].texts.length, 2);
  slides[0].texts.forEach(({ opts }) => {
    for (const key of ['x', 'y', 'w', 'h']) assert.equal(Number.isFinite(opts[key]), true, `${key} must be finite`);
    assert.ok(opts.w > 0, 'text width must be positive');
    assert.ok(opts.h > 0, 'text height must be positive');
  });
});

test('exports a fixed full-image page without adding any rebuilt title text', async () => {
  const slides = [];
  class MockPptx {
    addSlide() {
      const slide = {
        images: [], texts: [],
        addImage(opts) { this.images.push(opts); },
        addText(text, opts) { this.texts.push({ text, opts }); },
        addShape() {}
      };
      slides.push(slide);
      return slide;
    }
    writeFile() { return Promise.resolve(); }
  }

  await exportWorshipPPTX({
    PptxGenJS: MockPptx,
    getDeckEntries: () => [{
      kind: 'full-image', sectionId: 'offering', assetKey: 'offering', title: '奉獻'
    }],
    layoutState: { groups: {}, pageAssignments: {} },
    production: require('./slide-production.js'),
    model: {},
    backgroundColor: '#ffffff',
    templateAssets: { offering: 'data:image/png;base64,ORIGINAL' },
    serviceDate: '2026-07-19'
  });

  assert.equal(slides[0].images.length, 1);
  assert.equal(slides[0].images[0].data, 'data:image/png;base64,ORIGINAL');
  assert.equal(slides[0].texts.length, 0);
});

test('reflows report pages before reading the export deck', async () => {
  const calls = [];
  class MockPptx {
    addSlide() {
      return { addText() {}, addShape() {}, addImage() {} };
    }
    writeFile() { return Promise.resolve(); }
  }

  await exportWorshipPPTX({
    PptxGenJS: MockPptx,
    reflowReportPages: () => calls.push('reflow'),
    getDeckEntries: () => {
      calls.push('deck');
      return [{ kind: 'cover', sectionId: 'cover', sectionLabel: '台語主日禮拜' }];
    },
    layoutState: { groups: {}, pageAssignments: {} },
    production: require('./slide-production.js'),
    model: {},
    backgroundColor: '#ffffff',
    serviceDate: '2026-07-12'
  });

  assert.deepEqual(calls, ['reflow', 'deck']);
});

test('does not add the hymn white overlay to a generated hymn title page', async () => {
  const slides = [];
  class MockPptx {
    addSlide() {
      const slide = {
        shapes: [], texts: [],
        addShape(type, opts) { this.shapes.push({ type, opts }); },
        addText(text, opts) { this.texts.push({ text, opts }); },
        addImage() {}
      };
      slides.push(slide);
      return slide;
    }
    writeFile() { return Promise.resolve(); }
  }
  MockPptx.ShapeType = { rect: 'rect' };
  globalThis.hymnOpacitySectionIds = ['hymn-1'];

  await exportWorshipPPTX({
    PptxGenJS: MockPptx,
    getDeckEntries: () => [
      { id: 'hymn-1:section', kind: 'section', sectionId: 'hymn-1', sectionLabel: '聖詩一' },
      { id: 'hymn-1:1', kind: 'ppt-import', sectionId: 'hymn-1', objects: [] }
    ],
    layoutState: { groups: {}, pageAssignments: {} },
    production: require('./slide-production.js'),
    model: { 'hymn-1': { title: '聖詩 – 第 65 首', kicker: '為著美麗的地面', opacity: 60 } },
    backgroundColor: '#ffffff',
    serviceDate: '2026-07-12'
  });

  assert.equal(slides[0].shapes.length, 0);
  assert.equal(slides[1].shapes.length, 1);
  assert.equal(slides[1].shapes[0].opts.fill.transparency, 40);
});

test('anchors standard-page titles to the top of their configured box like the browser preview', async () => {
  const slides = [];
  class MockPptx {
    addSlide() {
      const slide = {
        texts: [],
        addText(text, opts) { this.texts.push({ text, opts }); },
        addShape() {},
        addImage() {}
      };
      slides.push(slide);
      return slide;
    }
    writeFile() { return Promise.resolve(); }
  }

  await exportWorshipPPTX({
    PptxGenJS: MockPptx,
    getDeckEntries: () => [{
      kind: 'liturgical',
      sectionId: 'creed',
      title: '信仰告白—使徒信經',
      body: '我信上帝'
    }],
    layoutState: { groups: {}, pageAssignments: {} },
    production: {
      layoutForPage: () => ({
        titleX: 8,
        titleY: 8,
        titleW: 83,
        titleH: 39.1,
        contentX: 5,
        contentY: 23,
        contentW: 95,
        contentH: 73.5
      })
    },
    model: {},
    backgroundColor: '#ffffff',
    serviceDate: '2026-07-15'
  });

  assert.equal(slides[0].texts[0].text, '信仰告白—使徒信經');
  assert.equal(slides[0].texts[0].opts.valign, 'top');
});

test('exports bilingual liturgy as two independent content text boxes', async () => {
  const slides = [];
  class MockPptx {
    addSlide() {
      const slide = {
        texts: [],
        addText(text, opts) { this.texts.push({ text, opts }); },
        addShape() {},
        addImage() {}
      };
      slides.push(slide);
      return slide;
    }
    writeFile() { return Promise.resolve(); }
  }

  await exportWorshipPPTX({
    PptxGenJS: MockPptx,
    getDeckEntries: () => [{
      kind: 'dual-liturgical', sectionId: 'creed', title: '信仰告白 – 使徒信經',
      primaryLabel: '台', primaryBody: '我信上帝，全能的父。',
      secondaryLabel: '華', secondaryBody: '我信上帝，全能的父。'
    }],
    layoutState: { groups: {}, pageAssignments: {} },
    production: require('./slide-production.js'),
    model: {},
    backgroundColor: '#ffffff',
    serviceDate: '2026-07-19'
  });

  assert.equal(slides[0].texts.length, 3);
  assert.equal(slides[0].texts[1].text.replace(/\n/g, ''), '(台)我信上帝，全能的父。');
  assert.equal(slides[0].texts[2].text.replace(/\n/g, ''), '(華)我信上帝，全能的父。');
  assert.equal(slides[0].texts[1].opts.color, '000000');
  assert.equal(slides[0].texts[2].opts.color, '0070C0');
  assert.ok(slides[0].texts[1].opts.x + slides[0].texts[1].opts.w <= slides[0].texts[2].opts.x);
});

test('keeps the language marker on exported joint Mandarin scripture pages', async () => {
  const slides = [];
  class MockPptx {
    addSlide() {
      const slide = {
        texts: [],
        addText(text, opts) { this.texts.push({ text, opts }); },
        addShape() {},
        addImage() {}
      };
      slides.push(slide);
      return slide;
    }
    writeFile() { return Promise.resolve(); }
  }

  await exportWorshipPPTX({
    PptxGenJS: MockPptx,
    getDeckEntries: () => [{
      kind: 'scripture', sectionId: 'scripture', title: '聖經－約翰福音 3:16',
      languageLabel: '華', body: '16 神愛世人'
    }],
    layoutState: { groups: {}, pageAssignments: {} },
    production: require('./slide-production.js'),
    model: {},
    backgroundColor: '#ffffff',
    serviceDate: '2026-07-19'
  });

  assert.equal(slides[0].texts[1].text.replace(/\n+/g, '\n'), '(華)\n16 神愛世人');
});

test('uses the shared preview bounds for ungrouped cover and section pages', async () => {
  const slides = [];
  class MockPptx {
    addSlide() {
      const slide = {
        texts: [],
        addText(text, opts) { this.texts.push({ text, opts }); },
        addShape() {},
        addImage() {}
      };
      slides.push(slide);
      return slide;
    }
    writeFile() { return Promise.resolve(); }
  }

  await exportWorshipPPTX({
    PptxGenJS: MockPptx,
    getDeckEntries: () => [
      { kind: 'cover', sectionId: 'cover', sectionLabel: '台語主日禮拜' },
      { kind: 'section', sectionId: 'prelude', sectionLabel: '序樂' },
      { kind: 'section', sectionId: 'postlude', sectionLabel: '後奏' }
    ],
    layoutState: { groups: {}, pageAssignments: {} },
    production: { layoutForPage: () => ({}) },
    model: {},
    backgroundColor: '#ffffff',
    serviceDate: '2026-07-15'
  });

  assert.equal(slides[0].texts[0].opts.y, 2.5125);
  assert.equal(slides[0].texts[1].opts.y, 4.185);
  assert.equal(slides[0].texts[1].opts.fontSize, 36);

  assert.equal(slides[1].texts[0].text, '序樂');
  assert.ok(Math.abs(slides[1].texts[0].opts.y - 3.075) < 0.000001);

  assert.equal(slides[2].texts[0].opts.y, 2.5125);
  assert.equal(slides[2].texts[1].text, '請後奏結束後再起身或交談');
  assert.equal(slides[2].texts[1].opts.y, 4.185);
  assert.equal(slides[2].texts[1].opts.fontSize, 36);
  assert.equal(slides[2].texts[1].opts.valign, 'top');
});

test('exports hymn names from the loaded model and uses the preview anchor for praise lyrics', async () => {
  const slides = [];
  class MockPptx {
    addSlide() {
      const slide = {
        texts: [],
        addText(text, opts) { this.texts.push({ text, opts }); },
        addShape() {},
        addImage() {}
      };
      slides.push(slide);
      return slide;
    }
    writeFile() { return Promise.resolve(); }
  }

  await exportWorshipPPTX({
    PptxGenJS: MockPptx,
    getDeckEntries: () => [
      { kind: 'section', sectionId: 'hymn-1', sectionLabel: '聖詩一' },
      { kind: 'praise-lyrics', sectionId: 'praise', body: '求你互我之一生\n可奉獻尊主做聖' }
    ],
    layoutState: { groups: {}, pageAssignments: {} },
    production: { layoutForPage: () => ({}) },
    model: {
      'hymn-1': { title: '聖詩 – 第 65 首', kicker: '為著美麗的地面' },
      praise: {}
    },
    backgroundColor: '#ffffff',
    serviceDate: '2026-07-12'
  });

  assert.equal(slides[0].texts[0].text, '聖詩 – 第 65 首');
  assert.equal(slides[0].texts[1].text, '為著美麗的地面');
  assert.equal(slides[0].texts[0].opts.bold, true);
  assert.equal(slides[0].texts[1].opts.bold, true);
  assert.equal(slides[1].texts[0].opts.y, 0.75);
  assert.equal(slides[1].texts[0].opts.h, 6);
  assert.equal(slides[1].texts[0].opts.valign, 'top');
  assert.equal(slides[1].texts[0].opts.bold, true);
});

test('exports the same deterministic native-text line breaks used by the preview', async () => {
  const slides = [];
  class MockPptx {
    addSlide() {
      const slide = {
        texts: [],
        addText(text, opts) { this.texts.push({ text, opts }); },
        addShape() {},
        addImage() {}
      };
      slides.push(slide);
      return slide;
    }
    writeFile() { return Promise.resolve(); }
  }

  await exportWorshipPPTX({
    PptxGenJS: MockPptx,
    getDeckEntries: () => [{
      kind: 'report',
      sectionId: 'announcements',
      title: '報告',
      body: '甲乙丙丁',
      layout: { contentSize: 48, contentW: 11 }
    }],
    layoutState: { groups: {}, pageAssignments: {} },
    production: require('./slide-production.js'),
    model: {},
    backgroundColor: '#ffffff',
    serviceDate: '2026-07-12'
  });

  assert.equal(slides[0].texts[1].text, '甲乙\n丙丁');
});

test('keeps praise and sermon title pages vertically centered and identical to the canvas geometry', async () => {
  const slides = [];
  class MockPptx {
    addSlide() {
      const slide = {
        texts: [],
        addText(text, opts) { this.texts.push({ text, opts }); },
        addShape() {},
        addImage() {}
      };
      slides.push(slide);
      return slide;
    }
    writeFile() { return Promise.resolve(); }
  }

  await exportWorshipPPTX({
    PptxGenJS: MockPptx,
    getDeckEntries: () => [
      { kind: 'praise-title', sectionId: 'praise', sectionLabel: '讚美' },
      { kind: 'sermon-title', sectionId: 'sermon', sectionLabel: '講道' }
    ],
    layoutState: { groups: {}, pageAssignments: {} },
    production: require('./slide-production.js'),
    model: {
      praise: { title: '新的事將要成就', kicker: '聖歌隊' },
      sermon: { title: '建造百倍成長的生命', kicker: '陳志聰牧師', body: '路加福音八章' }
    },
    backgroundColor: '#ffffff',
    serviceDate: '2026-07-19'
  });

  assert.deepEqual(slides[0].texts.map(item => item.text), ['讚美', '新的事將要成就', '聖歌隊']);
  assert.deepEqual(slides[1].texts.map(item => item.text), ['講道：建造百倍成長的生命', '陳志聰牧師\n路加福音八章']);
  const praiseTop = slides[0].texts[0].opts.y;
  const praiseBottom = slides[0].texts[2].opts.y + slides[0].texts[2].opts.h;
  assert.ok(Math.abs((praiseTop + praiseBottom) / 2 - 3.75) < 0.01);
  assert.equal(slides[0].texts[1].opts.fontSize, 36);
  assert.equal(slides[0].texts[2].opts.fontSize, 36);

  const sermonTop = slides[1].texts[0].opts.y;
  const sermonBottom = slides[1].texts[1].opts.y + slides[1].texts[1].opts.h;
  assert.ok(Math.abs((sermonTop + sermonBottom) / 2 - 3.75) < 0.01);
  assert.equal(slides[1].texts[1].opts.fontSize, 36);
  assert.equal(slides[1].texts[1].opts.valign, 'top');
  assert.equal(slides[1].texts[1].opts.h, slides[0].texts[1].opts.h + slides[0].texts[2].opts.h);

  const previewSource = fs.readFileSync(path.join(__dirname, 'ppt-format-preview.js'), 'utf8');
  assert.match(previewSource, /item\.type === 'sermon'.*composeSermonPages/s);
  assert.match(previewSource, /page\.kind === 'praise-title'.*template-section.*class="body"/s);
  assert.match(previewSource, /page\.kind === 'sermon-title'.*template-section.*class="body"/s);
  assert.match(previewSource, /const sermonTitle = \['講道', page\.title \|\| item\.title\][^;]+\.join\('：'\)/);
});

test('preserves source bounds for an ungrouped imported PowerPoint slide', async () => {
  const slides = [];
  class MockPptx {
    addSlide() {
      const slide = {
        texts: [],
        addText(text, opts) { this.texts.push({ text, opts }); },
        addShape() {},
        addImage() {}
      };
      slides.push(slide);
      return slide;
    }
    writeFile() { return Promise.resolve(); }
  }

  await exportWorshipPPTX({
    PptxGenJS: MockPptx,
    getDeckEntries: () => [{
      kind: 'ppt-import',
      sectionId: 'hymn-1',
      objects: [{
        type: 'text',
        role: 'content',
        text: 'source text',
        x: 15,
        y: 25,
        w: 70,
        h: 50,
        fontSize: 18,
        runs: [{ text: 'source text', fontSize: 18 }]
      }]
    }],
    layoutState: { groups: {}, pageAssignments: {} },
    production: { layoutForPage: () => ({}) },
    model: {},
    backgroundColor: '#ffffff',
    serviceDate: '2026-07-12'
  });

  const [{ text, opts }] = slides[0].texts;
  assert.equal(opts.x, 1.99995);
  assert.equal(opts.y, 1.875);
  assert.equal(opts.w, 9.3331);
  assert.equal(opts.h, 3.75);
  assert.equal(text[0].options.fontSize, 18);
});

test('uses a white slide background when a pastor slide opts out of the worship background', async () => {
  const slides = [];
  class MockPptx {
    addSlide() {
      const slide = {
        background: null,
        images: [],
        texts: [],
        addImage(options) { this.images.push(options); },
        addText(text, options) { this.texts.push({ text, options }); },
        addShape() {}
      };
      slides.push(slide);
      return slide;
    }
    writeFile() { return Promise.resolve(); }
  }

  await exportWorshipPPTX({
    PptxGenJS: MockPptx,
    getDeckEntries: () => [{
      kind: 'ppt-import',
      sectionId: 'sermon',
      applyBackground: false,
      rasterized: true,
      objects: [{ type: 'image', src: 'data:image/png;base64,pastor', x: 0, y: 0, w: 100, h: 100 }]
    }],
    layoutState: { groups: {}, pageAssignments: {} },
    production: { layoutForPage: () => ({}) },
    model: {},
    backgroundColor: '#123456',
    backgroundImage: 'data:image/png;base64,worship-background',
    serviceDate: '2026-07-12'
  });

  assert.deepEqual(slides[0].background, { fill: 'FFFFFF' });
});

test('applies separate centered image and text output percentages', async () => {
  const slides = [];
  class MockPptx {
    addSlide() {
      const slide = {
        images: [], texts: [],
        addImage(opts) { this.images.push(opts); },
        addText(text, opts) { this.texts.push({ text, opts }); },
        addShape() {}
      };
      slides.push(slide);
      return slide;
    }
    writeFile() { return Promise.resolve(); }
  }

  await exportWorshipPPTX({
    PptxGenJS: MockPptx,
    getDeckEntries: () => [
      {
        kind: 'ppt-import', rasterized: true, id: 'hymn-1:1', sectionId: 'hymn-1',
        objects: [{ type: 'image', src: 'data:image/png;base64,page', x: 0, y: 0, w: 100, h: 100 }]
      },
      { kind: 'report', id: 'announcements:1', sectionId: 'announcements', title: '報告', body: '可編輯內容' }
    ],
    layoutState: { groups: {}, pageAssignments: {}, outputScale: { text: 90, image: 90 } },
    production: { layoutForPage: () => ({}) },
    model: {},
    backgroundColor: '#ffffff',
    serviceDate: '2026-07-12'
  });

  assert.ok(Math.abs(slides[0].images[0].x - 13.333 * 0.05) < 1e-9);
  assert.ok(Math.abs(slides[0].images[0].y - 7.5 * 0.05) < 1e-9);
  assert.ok(Math.abs(slides[0].images[0].w - 13.333 * 0.9) < 1e-9);
  assert.ok(Math.abs(slides[0].images[0].h - 7.5 * 0.9) < 1e-9);
  assert.equal(slides[1].texts[0].opts.fontSize, 54);
  assert.equal(slides[1].texts[1].opts.fontSize, 43.2);
});

test('the export button forwards the active background and model state', () => {
  const appSource = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8').replace(/\s+/g, '');
  assert.match(
    appSource,
    /await\(window\.worshipExternalPresentationsReady\|\|Promise\.resolve\(\[\]\)\)/,
    'export must wait for the fixed Google presentations before composing the deck'
  );
  assert.match(
    appSource,
    /exportWorshipPPTX\(\{model,backgroundColor,backgroundImage\}\)/,
    'app.js must pass its lexical state to the standalone exporter'
  );
  assert.match(appSource, /pastor-ppt-upload/);
  assert.match(appSource, /requireSixteenByNine/);
  assert.match(appSource, /parsePptx/);
  assert.match(appSource, /pastor-ppt-apply-background/);
});

test('cleanParagraphProperties removes duplicate a:pPr tags from a:p paragraphs', () => {
  const originalXml = `
    <a:p>
      <a:pPr indent="0" marL="0"><a:buNone/></a:pPr>
      <a:r><a:t>聖詩 </a:t></a:r>
      <a:pPr indent="0" marL="0"><a:buNone/></a:pPr>
      <a:r><a:t>065</a:t></a:r>
      <a:pPr indent="0" marL="0"><a:buNone/></a:pPr>
      <a:r><a:t> 首</a:t></a:r>
    </a:p>
  `;
  const expectedXml = `
    <a:p>
      <a:pPr indent="0" marL="0"><a:buNone/></a:pPr>
      <a:r><a:t>聖詩 </a:t></a:r>
      
      <a:r><a:t>065</a:t></a:r>
      
      <a:r><a:t> 首</a:t></a:r>
    </a:p>
  `;
  const result = cleanParagraphProperties(originalXml);
  assert.equal(result.replace(/\s+/g, ''), expectedXml.replace(/\s+/g, ''));
});

test('deduplicates identical PPTX media without changing slide relationships', async () => {
  const entries = new Map([
    ['ppt/media/image1.png', 'same-image'],
    ['ppt/media/image2.png', 'same-image'],
    ['ppt/media/image3.png', 'different-image'],
    ['ppt/slides/_rels/slide1.xml.rels', '<Relationships><Relationship Id="rId1" Target="../media/image2.png"/></Relationships>']
  ]);
  const zip = {
    files: Object.fromEntries([...entries.keys()].map(name => [name, {}])),
    file(name, value) {
      if (arguments.length === 1) {
        const content = entries.get(name);
        if (content == null) return null;
        return {
          async: async type => type === 'uint8array'
            ? Uint8Array.from([...content].map(character => character.charCodeAt(0)))
            : content
        };
      }
      entries.set(name, value);
      this.files[name] = {};
      return this;
    },
    remove(name) {
      entries.delete(name);
      delete this.files[name];
    }
  };

  const result = await deduplicatePptxMedia(zip);

  assert.equal(result.removed, 1);
  assert.equal(entries.has('ppt/media/image2.png'), false);
  assert.match(entries.get('ppt/slides/_rels/slide1.xml.rels'), /Target="\.\.\/media\/image1\.png"/);
});

test('exports car-notice slide when includeInExport is true and excludes it when false', async () => {
  const slides = [];
  class MockPptx {
    addSlide() {
      const slide = {
        texts: [],
        addText(text, opts) { this.texts.push({ text, opts }); },
        addShape() {},
        addImage() {}
      };
      slides.push(slide);
      return slide;
    }
    writeFile() { return Promise.resolve(); }
  }

  // 1. When included in export
  await exportWorshipPPTX({
    PptxGenJS: MockPptx,
    getDeckEntries: () => [
      { kind: 'cover', sectionId: 'cover', sectionLabel: '封面' },
      { kind: 'car-notice', sectionId: 'car-notice', sectionLabel: '移車提醒', title: '敬請停在車道的車主儘快移車', includeInExport: true }
    ],
    layoutState: { groups: {}, pageAssignments: {} },
    production: require('./slide-production.js'),
    model: {
      'car-notice': { title: '敬請停在車道的車主儘快移車', includeInExport: true }
    },
    backgroundColor: '#ffffff',
    serviceDate: '2026-09-13'
  });

  assert.equal(slides.length, 2);
  const carSlide = slides[1];
  assert.equal(carSlide.texts.length, 1);
  assert.equal(carSlide.texts[0].text, '敬請停在車道的車主儘快移車');
  assert.equal(carSlide.texts[0].opts.fontSize, 60);
  assert.equal(carSlide.texts[0].opts.bold, true);
  assert.equal(carSlide.texts[0].opts.align, 'center');
  assert.equal(carSlide.texts[0].opts.valign, 'middle');
  assert.equal(carSlide.texts[0].opts.fontFace, 'Microsoft JhengHei');

  // 2. When excluded via model.includeInExport: false
  slides.length = 0;
  await exportWorshipPPTX({
    PptxGenJS: MockPptx,
    getDeckEntries: () => [
      { kind: 'cover', sectionId: 'cover', sectionLabel: '封面' },
      { kind: 'car-notice', sectionId: 'car-notice', sectionLabel: '移車提醒', title: '敬請停在車道的車主儘快移車' }
    ],
    layoutState: { groups: {}, pageAssignments: {} },
    production: require('./slide-production.js'),
    model: {
      'car-notice': { title: '敬請停在車道的車主儘快移車', includeInExport: false }
    },
    backgroundColor: '#ffffff',
    serviceDate: '2026-09-13'
  });

  assert.equal(slides.length, 1);
  assert.equal(slides[0].texts[0].text, '台語主日禮拜');

  // 3. When excluded via entry.includeInExport: false
  slides.length = 0;
  await exportWorshipPPTX({
    PptxGenJS: MockPptx,
    getDeckEntries: () => [
      { kind: 'cover', sectionId: 'cover', sectionLabel: '封面' },
      { kind: 'car-notice', sectionId: 'car-notice', sectionLabel: '移車提醒', title: '敬請停在車道的車主儘快移車', includeInExport: false }
    ],
    layoutState: { groups: {}, pageAssignments: {} },
    production: require('./slide-production.js'),
    model: {
      'car-notice': { title: '敬請停在車道的車主儘快移車' }
    },
    backgroundColor: '#ffffff',
    serviceDate: '2026-09-13'
  });

  assert.equal(slides.length, 1);
});
