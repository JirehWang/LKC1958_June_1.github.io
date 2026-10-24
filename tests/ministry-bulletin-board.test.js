const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const scriptPath = path.join(__dirname, '..', 'apps', 'LKC_MinistrySchedule', 'script.js');
const source = fs.readFileSync(scriptPath, 'utf8');
const functionStart = source.indexOf('function showBulletinBoard()');
const functionEnd = source.indexOf('\n\n// ============================================================', functionStart);
const showBulletinBoardSource = source.slice(functionStart, functionEnd);

function createRow(values, hidden) {
  return {
    classList: { contains: className => className === 'hidden' && hidden },
    querySelectorAll: selector => selector === '.grid-input'
      ? values.map(value => ({ value }))
      : []
  };
}

test('bulletin board renders only the records currently visible in the main table', () => {
  const rows = [
    createRow(['2027/01/14', '一月聚會'], false),
    createRow(['2027/05/13', '五月聚會'], false),
    createRow(['2027/09/09', '九月聚會'], false),
    createRow(['2026/12/24', '前一年度'], true)
  ];
  const elements = {
    bulletinContent: { innerHTML: '' },
    bulletinModalLabel: { innerText: '' },
    modalCloseBtn: { innerText: '', classList: { replace() {} } },
    bulletinModal: { addEventListener() {}, removeEventListener() {} }
  };
  let renderedMatrix;
  const context = {
    window: { event: null },
    currentTableHeaders: ['日期', '主題'],
    activeGroupName: '松年團契',
    isEditorUnlocked: false,
    bulletinModalInstance: null,
    _currentBulletinFiltered: [],
    document: {
      querySelectorAll: selector => selector === '.record-row' ? rows : [],
      getElementById: id => elements[id]
    },
    _ms_buildCardsHtml: matrix => {
      renderedMatrix = matrix;
      return '<div class="bulletin-cards"></div>';
    },
    _ms_renderFilterableTable: () => assert.fail('bulletin board must not apply a second date filter'),
    isMeetingTemplate: () => true,
    bootstrap: {
      Modal: class {
        show() {}
      }
    },
    setTimeout() {}
  };

  vm.createContext(context);
  vm.runInContext([
    'let bulletinModalInstance = null;',
    showBulletinBoardSource,
    'showBulletinBoard()'
  ].join(String.fromCharCode(10)), context);

  const expectedMatrix = [
    ['日期', '主題'],
    ['2027/01/14', '一月聚會'],
    ['2027/05/13', '五月聚會'],
    ['2027/09/09', '九月聚會']
  ];
  assert.deepEqual(JSON.parse(JSON.stringify(renderedMatrix)), expectedMatrix);
  assert.deepEqual(JSON.parse(JSON.stringify(context._currentBulletinFiltered)), expectedMatrix);
  assert.equal(elements.bulletinContent.innerHTML, '<div class="bulletin-cards"></div>');
});
