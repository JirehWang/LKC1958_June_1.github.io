const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const scriptPath = path.join(__dirname, '..', 'apps', 'LKC_MinistrySchedule', 'script.js');
const source = fs.readFileSync(scriptPath, 'utf8');
const functionStart = source.indexOf('function _ms_getVisibleScheduleMatrix()');
const functionEnd = source.indexOf('\n\n// ============================================================', functionStart);
const bulletinBoardSource = source.slice(functionStart, functionEnd);

function createElement(id = '') {
  const classes = new Set();
  const element = {
    id,
    children: [],
    parentNode: null,
    _innerHTML: '',
    classList: {
      contains: name => classes.has(name),
      add: name => classes.add(name),
      remove: name => classes.delete(name)
    }
  };
  Object.defineProperty(element, 'firstChild', { get() { return this.children[0] || null; } });
  element.insertBefore = (child, reference) => {
    if (child.parentNode) {
      const previousIndex = child.parentNode.children.indexOf(child);
      if (previousIndex >= 0) child.parentNode.children.splice(previousIndex, 1);
    }
    const index = reference ? element.children.indexOf(reference) : -1;
    element.children.splice(index < 0 ? element.children.length : index, 0, child);
    child.parentNode = element;
    return child;
  };
  element.appendChild = child => element.insertBefore(child, null);
  element.removeChild = child => {
    const index = element.children.indexOf(child);
    if (index >= 0) element.children.splice(index, 1);
    child.parentNode = null;
    return child;
  };
  element.remove = () => element.parentNode?.removeChild(element);
  return element;
}

function createRow(values, hidden) {
  let isHidden = hidden;
  return {
    classList: { contains: className => className === 'hidden' && isHidden },
    setHidden(value) { isHidden = value; },
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
  const dateFilterSticky = createElement('dateFilterSticky');
  const dateFilterHome = createElement('dateFilterHome');
  dateFilterHome.appendChild(dateFilterSticky);
  const bulletinCards = createElement('bulletinCards');
  const bulletinContent = createElement('bulletinContent');
  Object.defineProperty(bulletinContent, 'innerHTML', {
    get() { return this._innerHTML; },
    set(value) {
      this._innerHTML = value;
      this.children = [bulletinCards];
      bulletinCards.parentNode = this;
    }
  });
  const elements = {
    dateFilterSticky,
    bulletinContent,
    bulletinCards,
    bulletinModalLabel: { innerText: '' },
    modalCloseBtn: { innerText: '', classList: { replace() {} } },
    bulletinModal: {
      listeners: {},
      addEventListener(type, callback) { this.listeners[type] = callback; },
      removeEventListener(type) { delete this.listeners[type]; }
    }
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
      getElementById: id => elements[id],
      querySelector: selector => selector === '#bulletinContent #bulletinCards' ? bulletinCards : null,
      createComment: () => createElement('date-filter-home-marker')
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
    'let _bulletinDateFilterPlaceholder = null;',
    bulletinBoardSource,
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
  assert.equal(elements.dateFilterSticky.parentNode, elements.bulletinContent, 'the shared date controls move into the bulletin board');
  assert.match(elements.bulletinContent.innerHTML, /id="bulletinCards"/);

  rows[1].setHidden(true);
  context._ms_refreshBulletinCards();
  const refreshedMatrix = [
    ['日期', '主題'],
    ['2027/01/14', '一月聚會'],
    ['2027/09/09', '九月聚會']
  ];
  assert.deepEqual(JSON.parse(JSON.stringify(renderedMatrix)), refreshedMatrix, 'changing the shared filter refreshes bulletin cards');
  assert.deepEqual(JSON.parse(JSON.stringify(context._currentBulletinFiltered)), refreshedMatrix);

  let expandedOnClose = false;
  dateFilterSticky.classList.add('is-collapsed');
  context.toggleDateFilterToolbar = () => {
    expandedOnClose = true;
    dateFilterSticky.classList.remove('is-collapsed');
  };
  elements.bulletinModal.listeners['hidden.bs.modal']();
  assert.equal(expandedOnClose, true, 'a mobile-collapsed toolbar is expanded before it returns to the main table');
  assert.equal(elements.dateFilterSticky.parentNode, dateFilterHome, 'the shared date controls return to the main table after closing');
});

test('main date filter actions refresh bulletin cards while the board is open', () => {
  const filterStart = source.indexOf('function filterByDate(');
  const clearStart = source.indexOf('function clearDateFilter()', filterStart);
  const processAiStart = source.indexOf('async function processAI()', clearStart);
  const filterSources = source.slice(filterStart, clearStart) + source.slice(clearStart, processAiStart);

  assert.match(filterSources, /_ms_refreshBulletinCards\(\)/);
  assert.equal((filterSources.match(/_ms_refreshBulletinCards\(\)/g) || []).length, 2, 'both apply and clear update the bulletin view');
});
