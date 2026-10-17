const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const scriptPath = path.join(__dirname, '..', 'apps', 'LKC_MinistrySchedule', 'script.js');
const source = fs.readFileSync(scriptPath, 'utf8');
const mainDateRangeSource = source.slice(
  source.indexOf('function formatDateInputValue'),
  source.indexOf('function applyRecentThreeMonthsDateFilter')
);
const reportDateRangeSource = source.slice(
  source.indexOf('function _ms_parseLocalDate'),
  source.indexOf('function _ms_buildTableHtml')
);

function createContext(template, year = 2026, month = 9, day = 17) {
  const nativeDate = Date;
  const fixedNow = new nativeDate(year, month, day, 12).getTime();
  class FixedDate extends nativeDate {
    constructor(...args) {
      super(...(args.length ? args : [fixedNow]));
    }

    static now() {
      return fixedNow;
    }
  }

  const elements = {
    startDate: { value: '' },
    endDate: { value: '' }
  };
  const context = {
    currentTemplate: template,
    Date: FixedDate,
    document: { getElementById: id => elements[id] },
    isMeetingTemplate: value => [
      '聚會型模板',
      '小組聚會表模板',
      '團契聚會表模板',
      'gathering'
    ].includes(value)
  };

  vm.createContext(context);
  vm.runInContext(
    `${mainDateRangeSource}\n${reportDateRangeSource}\n` +
      'this.__dateFilterApi = { setRecentThreeMonthsDateRange, _ms_rollingWindow, _ms_applyDateFilter };',
    context,
    { filename: scriptPath }
  );

  return { api: context.__dateFilterApi, elements };
}

test('meeting template defaults to today through three calendar months ahead', () => {
  const { api, elements } = createContext('聚會型模板');

  api.setRecentThreeMonthsDateRange();

  assert.equal(elements.startDate.value, '2026-10-17');
  assert.equal(elements.endDate.value, '2027-01-17');
});

test('upcoming meeting range clamps to the last valid day of the target month', () => {
  const { api, elements } = createContext('聚會型模板', 2026, 10, 30);

  api.setRecentThreeMonthsDateRange();

  assert.equal(elements.startDate.value, '2026-11-30');
  assert.equal(elements.endDate.value, '2027-02-28');
});

test('other ministry templates keep their prior three-month history range', () => {
  const { api, elements } = createContext('事工型模板');

  api.setRecentThreeMonthsDateRange();

  assert.equal(elements.startDate.value, '2026-07-17');
  assert.equal(elements.endDate.value, '2026-10-17');
});

test('upcoming report filter includes today and the three-month boundary only', () => {
  const { api } = createContext('聚會型模板');
  const matrix = [
    ['日期', '項目'],
    ['2026/10/16', '昨天'],
    ['2026/10/17', '今天'],
    ['2027/01/17', '三個月邊界'],
    ['2027/01/18', '範圍外']
  ];

  const filtered = api._ms_applyDateFilter(matrix, 0, 'rolling', 2026, 4, 'upcoming');

  assert.deepEqual(JSON.parse(JSON.stringify(filtered)), [
    ['日期', '項目'],
    ['2026/10/17', '今天'],
    ['2027/01/17', '三個月邊界']
  ]);
});

test('the general report window remains one month back and two months ahead', () => {
  const { api } = createContext('事工型模板');
  const [start, end] = api._ms_rollingWindow();

  assert.equal(`${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`, '2026-09-17');
  assert.equal(`${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`, '2026-12-17');
});
