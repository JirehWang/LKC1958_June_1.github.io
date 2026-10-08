const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function editorFixture(options = {}) {
  const statuses = [];
  const loadedSections = [];
  const button = { disabled: false };
  const form = { innerHTML: '', insertAdjacentHTML() {}, querySelector() { return { addEventListener() {} }; } };
  const context = {
    active: 'hymn-1', model: { 'hymn-1': { sourceValue: '242' }, 'hymn-2': { sourceValue: '513' } },
    document: { getElementById(id) { return id === 'editor-form' ? form : id === 'load-library-section' ? button : null; } },
    field() { return ''; }, status(message) { statuses.push(message); }, editor() {},
    render() { context.editor(); },
    window: {
      activeWorshipTemplateProfile: { bibleSections: [], librarySections: [['hymn-1', 'hymn'], ['hymn-2', 'hymn']] },
      syncHymnLibraryIndex: options.sync || (async () => ({ inserted: 1 })),
      reloadCurrentPptLibrarySection: async sectionId => {
        loadedSections.push(sectionId);
        if (options.load) return options.load(sectionId);
        return { state: 'loaded', pageCount: 3 };
      }
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'production-editor.js'), 'utf8'), context);
  return { context, button, statuses, loadedSections };
}

test('a sync failure still attempts to load an available indexed hymn and keeps the warning', async () => {
  const fixture = editorFixture({ sync: async () => { throw new Error('同步回應逾時'); } });
  await fixture.button.onclick();
  assert.deepEqual(fixture.loadedSections, ['hymn-1']);
  assert.match(fixture.statuses.at(-1), /同步.*逾時/);
  assert.match(fixture.statuses.at(-1), /已載入 3 頁/);
  assert.equal(fixture.button.disabled, false);
});

for (const [state, message] of [['missing', '資料庫找不到 聖詩 242'], ['error', 'PPTX 載入失敗：檔案損毀']]) {
  test(`a ${state} result keeps the sync summary and cannot claim a successful load`, async () => {
    const fixture = editorFixture({ load: async () => ({ state, message }) });
    await fixture.button.onclick();
    assert.match(fixture.statuses.at(-1), /索引新增 1/);
    assert.ok(fixture.statuses.at(-1).includes(message));
    assert.doesNotMatch(fixture.statuses.at(-1), /已載入/);
    assert.equal(fixture.button.disabled, false);
  });
}

test('switching sections during a sync cannot redirect the original hymn load', async () => {
  let finishSync;
  const fixture = editorFixture({ sync: () => new Promise(resolve => { finishSync = resolve; }) });
  const clicking = fixture.button.onclick();
  fixture.context.active = 'hymn-2';
  finishSync({ inserted: 1 });
  await clicking;
  assert.deepEqual(fixture.loadedSections, ['hymn-1']);
});

test('an index read failure keeps the completed sync summary and re-enables the button', async () => {
  const fixture = editorFixture({ load: async () => { throw new Error('索引讀取失敗'); } });
  await fixture.button.onclick();
  assert.match(fixture.statuses.at(-1), /索引新增 1.*索引讀取失敗/);
  assert.equal(fixture.button.disabled, false);
});
