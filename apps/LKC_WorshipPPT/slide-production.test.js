const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildBiblePages,
  buildDeckEntries,
  paginateFixedText,
  createLayoutGroup,
  updateLayoutGroup,
  detachPagesFromLayoutGroup,
  normalizeColor,
  isSupportedBackgroundImage,
  normalizeBackgroundImageDataUrl,
  toWhiteOverlayOpacity,
  applyHymnOpacity,
  shouldApplyHymnWhiteOverlay,
  pointsToCanvasCqw,
  canvasCqwToPoints,
  wrapTextForBox,
  defaultLayoutForPage,
  resolvedLayoutForPage,
  composeLibraryPages,
  composeSermonPages,
  applyFixedLibraryDefaults
} = require('./slide-production.js');

test('normalizes solid background and text colors to safe hex values', () => {
  assert.equal(normalizeColor('#2f5d50', '#ffffff'), '#2f5d50');
  assert.equal(normalizeColor('#ABC', '#ffffff'), '#aabbcc');
  assert.equal(normalizeColor('not-a-color', '#ffffff'), '#ffffff');
});

test('accepts safe raster background images and rejects unrelated uploads', () => {
  assert.equal(isSupportedBackgroundImage({ type: 'image/png', name: 'background.png' }), true);
  assert.equal(isSupportedBackgroundImage({ type: '', name: 'background.webp' }), true);
  assert.equal(isSupportedBackgroundImage({ type: 'image/svg+xml', name: 'background.svg' }), false);
  assert.equal(isSupportedBackgroundImage({ type: 'application/pdf', name: 'background.pdf' }), false);
  assert.equal(normalizeBackgroundImageDataUrl('data:image/jpeg;base64,YWJj'), 'data:image/jpeg;base64,YWJj');
  assert.equal(normalizeBackgroundImageDataUrl('javascript:alert(1)'), '');
});

test('uses the hymn setting as white overlay opacity, not score opacity', () => {
  assert.equal(toWhiteOverlayOpacity(68), 0.68);
  assert.equal(toWhiteOverlayOpacity(10), 0.4);
  assert.equal(toWhiteOverlayOpacity(100), 0.8);
});

test('synchronizes hymn opacity only when the shared checkbox is enabled', () => {
  const sectionIds = ['pre-hymn-1', 'hymn-1', 'prayer-song', 'offering', 'doxology', 'amen'];
  const model = Object.fromEntries(sectionIds.map((id, index) => [id, { opacity: 40 + index }]));

  applyHymnOpacity(model, sectionIds, 'hymn-1', 68, true);
  assert.deepEqual(sectionIds.map(id => model[id].opacity), [68, 68, 68, 68, 68, 68]);

  applyHymnOpacity(model, sectionIds, 'offering', 52, false);
  assert.equal(model.offering.opacity, 52);
  assert.deepEqual(sectionIds.filter(id => id !== 'offering').map(id => model[id].opacity), [68, 68, 68, 68, 68]);
});

test('applies the hymn white overlay to score content but never to its title page', () => {
  const hymnSections = ['pre-hymn-1', 'hymn-1', 'hymn-2', 'doxology'];
  assert.equal(shouldApplyHymnWhiteOverlay({ sectionId: 'hymn-1', kind: 'section' }, hymnSections), false);
  assert.equal(shouldApplyHymnWhiteOverlay({ sectionId: 'hymn-1', kind: 'ppt-import' }, hymnSections), true);
  assert.equal(shouldApplyHymnWhiteOverlay({ sectionId: 'hymn-1', kind: 'score' }, hymnSections), true);
  assert.equal(shouldApplyHymnWhiteOverlay({ sectionId: 'response', kind: 'ppt-import' }, hymnSections), false);
});

test('resolves one shared layout for both preview and export', () => {
  const state = { groups: {}, pageAssignments: {} };
  const page = { id: 'hymn-1:section', sectionId: 'hymn-1', kind: 'section', sectionLabel: '聖詩一' };
  const item = { title: '聖詩 – 第 65 首', kicker: '為著美麗的地面' };
  const params = resolvedLayoutForPage(state, page, item);
  assert.equal(params.titleSize, 60);
  assert.equal(params.contentSize, 60);
  assert.equal(params.titleY, 24.8);
  assert.equal(params.contentY, 47.9);

  createLayoutGroup(state, 'hymn-title-custom', [page.id], { titleY: 30, contentY: 54 });
  assert.deepEqual(
    { titleY: resolvedLayoutForPage(state, page, item).titleY, contentY: resolvedLayoutForPage(state, page, item).contentY },
    { titleY: 30, contentY: 54 }
  );
});

test('uses the report reflow layout as the default for newly generated report pages', () => {
  const params = resolvedLayoutForPage(
    { groups: {}, pageAssignments: {} },
    { id: 'announcements:2', sectionId: 'announcements', kind: 'report' },
    { reportLayout: { contentSize: 36, contentW: 92, contentH: 72, lineSpacing: 1.2 } }
  );

  assert.equal(params.contentSize, 36);
  assert.equal(params.contentW, 92);
  assert.equal(params.contentH, 72);
  assert.equal(params.lineSpacing, 1.2);
});

test('keeps independent bounds and colors for the two liturgical content frames', () => {
  const params = resolvedLayoutForPage(
    { groups: {}, pageAssignments: {} },
    { id: 'creed:1', sectionId: 'creed', kind: 'dual-liturgical' },
    {}
  );
  assert.ok(params.contentX < params.secondaryContentX);
  assert.ok(params.contentX + params.contentW <= params.secondaryContentX);
  assert.equal(params.contentColor, '#000000');
  assert.equal(params.secondaryContentColor, '#0070C0');
  assert.equal(params.contentSize, 48);
  assert.equal(params.secondaryContentSize, 48);
});

test('uses supplied per-page template geometry before shared layout overrides', () => {
  const page = {
    id: 'creed:1',
    kind: 'dual-liturgical',
    layout: { contentX: 6.25, secondaryContentX: 52.5, titleY: 4.75 }
  };
  assert.deepEqual(
    resolvedLayoutForPage({ groups: {}, pageAssignments: {} }, page, {}),
    {
      ...defaultLayoutForPage(page, {}),
      ...page.layout
    }
  );
  assert.equal(resolvedLayoutForPage({
    groups: { adjusted: { id: 'adjusted', params: { contentX: 9 } } },
    pageAssignments: { 'creed:1': 'adjusted' }
  }, page, {}).contentX, 9);
});

test('vertically centers praise and sermon title groups by their detail line count', () => {
  const state = { groups: {}, pageAssignments: {} };
  const praise = resolvedLayoutForPage(
    state,
    { id: 'praise:1', sectionId: 'praise', kind: 'praise-title' },
    { title: '新的事將要成就', kicker: '聖歌隊' }
  );
  const sermon = resolvedLayoutForPage(
    state,
    { id: 'sermon:1', sectionId: 'sermon', kind: 'sermon-title' },
    { title: '建造百倍成長的生命', kicker: '陳志聰牧師', body: '路加福音八章' }
  );

  const praiseCenter = (praise.titleY + praise.secondaryContentY + praise.secondaryContentH) / 2;
  assert.ok(Math.abs(praiseCenter - 50) < 0.1);
  assert.equal(praise.contentSize, 36);
  assert.equal(praise.contentAlign, 'center');
  assert.equal(praise.lineSpacing, 1.2);
  assert.equal(praise.secondaryContentSize, 36);
  assert.equal(praise.secondaryContentAlign, 'center');

  const sermonCenter = (sermon.titleY + sermon.contentY + sermon.contentH) / 2;
  assert.ok(Math.abs(sermonCenter - 50) < 0.1);
  assert.equal(sermon.contentSize, 36);
  assert.equal(sermon.contentAlign, 'center');
  assert.equal(sermon.lineSpacing, 1.2);
  assert.equal(sermon.contentH, praise.contentH + praise.secondaryContentH);
});

test('converts PowerPoint points to the 16:9 canvas without enlarging text', () => {
  assert.equal(pointsToCanvasCqw(60), 6.25);
  assert.equal(pointsToCanvasCqw(48), 5);
  assert.equal(canvasCqwToPoints(6.25), 60);
  assert.equal(canvasCqwToPoints(pointsToCanvasCqw(36)), 36);
});

test('inserts deterministic native-text line breaks for preview and export', () => {
  assert.equal(
    wrapTextForBox('甲乙丙丁\n\n戊己', { fontSize: 48, boxWidth: 11 }),
    '甲乙\n丙丁\n\n戊己'
  );
  assert.equal(wrapTextForBox('甲乙丙', { fontSize: 48, boxWidth: 10 }), '甲\n乙\n丙');
});

test('flattens PPT chapters into one continuous deck order', () => {
  const deck = buildDeckEntries([
    { sectionId: 'cover', label: '首頁', pages: [{ id: 'cover:1' }] },
    { sectionId: 'creed', label: '使徒信經', pages: [{ id: 'creed:1' }, { id: 'creed:2' }] }
  ]);
  assert.deepEqual(deck.map(item => item.id), ['cover:1', 'creed:1', 'creed:2']);
  assert.deepEqual(deck.map(item => item.deckNumber), [1, 2, 3]);
  assert.equal(deck[2].sectionLabel, '使徒信經');
});

test('keeps fixed liturgy as one source field while rebuilding the original page count', () => {
  const source = '第一段。\n\n第二段較長，仍應完整保留。\n\n第三段。\n\n第四段結束。';
  const pages = paginateFixedText(source, [20, 35, 45]);
  assert.equal(pages.length, 3);
  assert.equal(pages.map(page => page.body).join('\n\n'), source);
  assert.ok(pages.every(page => page.body.length > 0));
});

test('turns a scripture query result into two-verses-per-slide pages', () => {
  const pages = buildBiblePages('scripture', '聖經', '馬太福音13:1-5', [
    { chap: 13, sec: 1, bible_text: '第一節' },
    { chap: 13, sec: 2, bible_text: '第二節' },
    { chap: 13, sec: 3, bible_text: '第三節' },
    { chap: 13, sec: 4, bible_text: '第四節' },
    { chap: 13, sec: 5, bible_text: '第五節' }
  ]);
  assert.equal(pages.length, 3);
  assert.equal(pages[0].id, 'scripture:1');
  assert.equal(pages[0].title, '聖經－馬太福音13:1-5');
  assert.equal(pages[0].body, '1 第一節\n\n2 第二節');
  assert.equal(pages[2].body, '5 第五節');
});

test('keeps source-deck title pages only for sections that actually have them', () => {
  const imported = [{ id: 'hymn-1:1', kind: 'ppt-import' }];
  const pages = composeLibraryPages({ pptPages: imported, includeSectionTitle: true }, 'hymn-1');
  assert.deepEqual(pages.map(page => page.kind), ['section', 'ppt-import']);
  assert.equal(pages[0].id, 'hymn-1:section');
  assert.deepEqual(composeLibraryPages({ pptPages: imported, includeSectionTitle: false }).map(page => page.kind), ['ppt-import']);
});

test('places an uploaded pastor presentation after the sermon title page', () => {
  const pages = composeSermonPages({
    title: '信息主題',
    pastorPptApplyBackground: false,
    pastorPptPages: [{ kind: 'ppt-import', objects: [] }]
  }, 'sermon');

  assert.deepEqual(pages.map(page => page.kind), ['sermon-title', 'ppt-import']);
  assert.equal(pages[1].id, 'sermon:pastor:1');
  assert.equal(pages[1].applyBackground, false);
});

test('sets the three fixed library songs required by the source deck', () => {
  const model = { 'prayer-song': {}, offering: {}, amen: {} };
  applyFixedLibraryDefaults(model);
  assert.equal(model['prayer-song'].sourceValue, '261');
  assert.equal(model.offering.sourceValue, '306B');
  assert.equal(model.amen.sourceValue, '522');
  assert.equal(model.offering.includeSectionTitle, true);
  assert.equal(model['prayer-song'].includeSectionTitle, false);
  assert.equal(model.amen.includeSectionTitle, false);
});

test('remembers named layout groups and keeps different batches independent', () => {
  const state = { groups: {}, pageAssignments: {} };
  createLayoutGroup(state, 'scripture-layout', ['scripture:1', 'scripture:2'], { contentSize: 42 });
  createLayoutGroup(state, 'liturgy-layout', ['creed:1'], { contentSize: 48, contentAlign: 'left' });
  updateLayoutGroup(state, 'scripture-layout', { contentSize: 40, contentAlign: 'center' });
  assert.deepEqual(state.groups['scripture-layout'].params, { contentSize: 40, contentAlign: 'center' });
  assert.deepEqual(state.groups['liturgy-layout'].params, { contentSize: 48, contentAlign: 'left' });
  assert.equal(state.pageAssignments['scripture:2'], 'scripture-layout');
  assert.equal(state.pageAssignments['creed:1'], 'liturgy-layout');
});

test('reassigns checked pages to the latest group and supports detaching for single-page tuning', () => {
  const state = { groups: {}, pageAssignments: {} };
  createLayoutGroup(state, 'group-a', ['scripture:1', 'scripture:2'], { contentSize: 42 });
  createLayoutGroup(state, 'group-b', ['scripture:2'], { contentSize: 36 });
  assert.deepEqual(state.groups['group-a'].pageIds, ['scripture:1']);
  assert.equal(state.pageAssignments['scripture:2'], 'group-b');
  detachPagesFromLayoutGroup(state, ['scripture:2']);
  assert.equal(state.pageAssignments['scripture:2'], undefined);
  assert.deepEqual(state.groups['group-b'].pageIds, []);
});
