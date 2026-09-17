const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  DEFAULT_TEMPLATE_ID,
  getTemplateProfile,
  resolveTemplateId,
  createTemplateModel
} = require('./template-profiles.js');

test('keeps Taiwanese as the default and resolves the joint Mandarin query value', () => {
  assert.equal(DEFAULT_TEMPLATE_ID, 'taiwanese');
  assert.equal(resolveTemplateId('?template=joint-mandarin'), 'joint-mandarin');
  assert.equal(resolveTemplateId('?template=joint-taiwanese'), 'joint-taiwanese');
  assert.equal(resolveTemplateId('?template=unknown'), 'taiwanese');
});

test('clones the Taiwanese flow into a bilingual joint Taiwanese template', () => {
  const taiwanese = getTemplateProfile('taiwanese');
  const profile = getTemplateProfile('joint-taiwanese');

  assert.equal(profile.id, 'joint-taiwanese');
  assert.equal(profile.label, '聯合－台語');
  assert.equal(profile.coverTitle, '台 華 語 聯 合 禮 拜');
  assert.equal(profile.filenamePrefix, '聯合-台語禮拜');
  assert.equal(profile.draftKey, 'lkc-worship-draft-joint-taiwanese');
  assert.deepEqual(profile.calendarSelector, { typeName: '聯合-台語', typeFullName: '講道資訊-聯合-台語' });
  assert.equal(profile.layoutFallbackTemplateId, 'taiwanese');
  assert.deepEqual(profile.layoutFallbackExcludedSections, ['creed', 'lord-prayer']);
  assert.deepEqual(profile.sections.map(([id]) => id), taiwanese.sections.map(([id]) => id));
  assert.deepEqual(profile.fixedLibrary, taiwanese.fixedLibrary);
  assert.deepEqual(profile.librarySections, taiwanese.librarySections);
  assert.deepEqual(profile.hymnTitleSectionIds, ['pre-hymn-1', 'pre-hymn-2', 'hymn-1', 'hymn-2', 'doxology']);
  assert.deepEqual(taiwanese.hymnTitleSectionIds, profile.hymnTitleSectionIds);
  assert.notEqual(profile.sections, taiwanese.sections);

  const bibleSections = Object.fromEntries(profile.bibleSections.map(config => [config.sectionId, config]));
  for (const sectionId of ['call', 'scripture', 'verse']) {
    assert.deepEqual(bibleSections[sectionId].versions, ['tghg', 'unv']);
    assert.deepEqual(bibleSections[sectionId].languageLabels, ['台', '華']);
  }
  assert.equal(bibleSections.verse.prependTitle, '金句');

  const model = createTemplateModel(profile);
  const jointMandarinModel = createTemplateModel(getTemplateProfile('joint-mandarin'));
  assert.equal(model.cover.label, '台華語聯合禮拜');
  assert.equal(model.creed.type, 'dual-fixed');
  assert.equal(model.creed.pptPages.length, 5);
  assert.equal(model['lord-prayer'].type, 'dual-fixed');
  assert.equal(model['lord-prayer'].pptPages.length, 4);
  assert.equal(model.creed.pptPages[0].kind, 'dual-liturgical');
  assert.equal(model.creed.pptPages[0].secondaryLabel, '華');
  assert.deepEqual(model.creed.pptPages, jointMandarinModel.creed.pptPages);
  assert.deepEqual(model['lord-prayer'].pptPages, jointMandarinModel['lord-prayer'].pptPages);
});

test('defines the joint Mandarin flow from the supplied 33-slide template', () => {
  const profile = getTemplateProfile('joint-mandarin');
  assert.equal(profile.label, '聯合－華語');
  assert.equal(profile.eventTypeName, '聯合-華語');
  assert.deepEqual(profile.bibleVersions, ['tghg', 'unv']);
  assert.equal(profile.coverTitle, '台 華 語 聯 合 禮 拜');
  assert.equal(profile.filenamePrefix, '聯合-華語禮拜');
  assert.equal(profile.defaultBackgroundColor, '#ffffff');
  assert.equal(profile.assets.background, undefined);
  assert.match(profile.assets.worshipMoment, /joint-mandarin-worship-moment\.png$/);
  assert.match(profile.assets.offering, /joint-mandarin-offering\.png$/);
  assert.match(profile.assets.thanksgiving, /joint-mandarin-thanksgiving\.png$/);
  assert.deepEqual(profile.externalPresentations || [], []);

  const sectionIds = profile.sections.map(([id]) => id);
  assert.deepEqual(sectionIds, [
    'cover', 'silence', 'prelude', 'call', 'worship-moment', 'creed',
    'scripture', 'prayer-1', 'lord-prayer', 'sermon', 'response-song',
    'announcements', 'offering', 'thanksgiving', 'blessing', 'peace',
    'car-notice'
  ]);

  const sourceImageSections = [
    ['worship-moment', 'worshipMoment'],
    ['offering', 'offering'],
    ['thanksgiving', 'thanksgiving']
  ];
  for (const [sectionId, assetKey] of sourceImageSections) {
    const section = profile.sections.find(([id]) => id === sectionId);
    assert.equal(section[2], 'static');
    assert.equal(section[3].pptPages[0].kind, 'full-image');
    assert.equal(section[3].pptPages[0].assetKey, assetKey);
    assert.equal(section[3].pptPages[0].title, undefined);
    assert.equal(section[3].pptPages[0].body, undefined);
    assert.ok(fs.statSync(path.join(__dirname, profile.assets[assetKey])).size > 10000);
  }
});

test('creates separate Taiwanese and Mandarin text frames for creed and Lord Prayer pages', () => {
  const model = createTemplateModel(getTemplateProfile('joint-mandarin'));
  assert.equal(model.creed.pptPages.length, 5);
  assert.equal(model['lord-prayer'].pptPages.length, 4);

  for (const page of [...model.creed.pptPages, ...model['lord-prayer'].pptPages]) {
    assert.equal(page.kind, 'dual-liturgical');
    assert.ok(page.primaryBody.trim());
    assert.ok(page.secondaryBody.trim());
    assert.notEqual(page.primaryBody, page.secondaryBody);
  }
  assert.equal(model.creed.pptPages[0].primaryLabel, '台');
  assert.equal(model.creed.pptPages[0].secondaryLabel, '華');
  assert.equal(model.creed.pptPages[0].secondaryColor, '#0070C0');
  assert.equal(model.creed.pptPages[1].primaryLabel, '');
  assert.equal(model['lord-prayer'].pptPages[1].secondaryLabel, '');
  assert.equal(model.creed.pptPages[1].layout.lineSpacing, 1.25);
});

test('loads template profiles before app initialization and renders a template selector', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  assert.match(html, /id="template-selector"/);
  assert.match(html, /value="taiwanese"/);
  assert.match(html, /value="joint-taiwanese"/);
  assert.match(html, /value="joint-mandarin"/);
  assert.ok(html.indexOf('template-profiles.js') < html.indexOf('app.js'));

  const preview = fs.readFileSync(path.join(__dirname, 'ppt-format-preview.js'), 'utf8');
  const fullImageBlock = preview.match(/else if \(page\.kind === 'full-image'\)[\s\S]*?else if/)[0];
  assert.match(fullImageBlock, /<img/);
  assert.doesNotMatch(fullImageBlock, /<h1>/);
});
