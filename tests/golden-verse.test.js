const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const repoRoot = path.join(__dirname, '..');

function loadFormatter() {
  const source = fs.readFileSync(
    path.join(repoRoot, 'apps', 'LKC_SundayBulletin', 'js', 'bible-formatter.js'),
    'utf8'
  );
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context.window.BibleFormatter;
}

function loadBulletinModel(formatter) {
  const source = fs.readFileSync(
    path.join(repoRoot, 'apps', 'LKC_SundayBulletin', 'js', 'bulletin.js'),
    'utf8'
  );
  const context = {
    CONFIG: {
      BANK_ACCOUNT: '',
      TW_GROUPS: [],
      SUNDAY_SCHOOL_CLASSES: []
    },
    window: { BibleFormatter: formatter },
    module: { exports: {} },
    exports: {}
  };
  vm.createContext(context);
  vm.runInContext(`${source}\nmodule.exports = BulletinModel;`, context);
  return context.module.exports;
}

function loadChurchApi(formatter) {
  const source = fs.readFileSync(
    path.join(repoRoot, 'apps', 'LKC_SundayBulletin', 'js', 'api.js'),
    'utf8'
  );
  const context = {
    window: { BibleFormatter: formatter },
    CONFIG: { LKCSCHEDULE_GAS_URL: 'https://example.test' },
    debug() {},
    console,
    module: { exports: {} },
    exports: {}
  };
  vm.createContext(context);
  vm.runInContext(`${source}\nmodule.exports = ChurchAPI;`, context);
  return context.module.exports;
}

function loadCalendarFormatter(formatter) {
  const source = fs.readFileSync(
    path.join(repoRoot, 'apps', 'LKC_MasterSchedule', 'calendar.js'),
    'utf8'
  );
  const context = {
    window: { BibleFormatter: formatter, addEventListener() {} },
    module: { exports: {} },
    exports: {}
  };
  vm.createContext(context);
  vm.runInContext(`${source}\nmodule.exports = { formatCalendarFieldValue, formatCalendarEventValues };`, context);
  return context.module.exports;
}

function loadApp(formatter, model, api, fields) {
  const source = fs.readFileSync(
    path.join(repoRoot, 'apps', 'LKC_SundayBulletin', 'js', 'app.js'),
    'utf8'
  );
  const context = {
    window: { BibleFormatter: formatter },
    document: {
      addEventListener() {},
      querySelector(selector) { return fields[selector] || null; }
    },
    BulletinModel: model,
    ChurchAPI: api,
    module: { exports: {} },
    exports: {}
  };
  vm.createContext(context);
  vm.runInContext(`${source}\nmodule.exports = App;`, context);
  return context.module.exports;
}

test('formats abbreviated golden-verse references for calendar-style values', () => {
  const formatter = loadFormatter();
  const calendar = loadCalendarFormatter(formatter);
  assert.equal(calendar.formatCalendarFieldValue('\u91d1\u53e5', '\u592a 3:16'), '\u99ac\u592a\u798f\u97f33:16');
  assert.equal(calendar.formatCalendarFieldValue('\u5ba3\u53ec', '\u592a 3:16'), '\u99ac\u592a\u798f\u97f33:16');
});

test('formats traditional Chinese aliases for First John in multi-reference input', () => {
  const formatter = loadFormatter();
  assert.equal(
    formatter.format('\u7d04\u7ff0\u798f\u97f33:16\uff1b\u7d04\u58f9\u56db9~10'),
    '\u7d04\u7ff0\u798f\u97f33:16\uff1b\u7d04\u7ff0\u4e00\u66f84:9-10'
  );
  assert.equal(formatter.format('\u7d04\u58f9\u66f84:9~10'), '\u7d04\u7ff0\u4e00\u66f84:9-10');
  assert.equal(formatter.format('\u7d04\u7ff0\u58f9\u66f84:9~10'), '\u7d04\u7ff0\u4e00\u66f84:9-10');
});

test('weekly bulletin keeps both languages\' golden-verse references and fetched text', () => {
  const formatter = loadFormatter();
  const model = loadBulletinModel(formatter);
  model.init('2026-08-09');
  model.applyAPIData({
    calendar: {
      success: true,
      data: {
        taiwanese: {
          goldenVerse: '\u592a 3:16',
          goldenVerseText: '\u53f0\u8a9e\u91d1\u53e5'
        },
        mandarin: {
          goldenVerse: '\u592a 3:16',
          goldenVerseText: '\u83ef\u8a9e\u91d1\u53e5'
        },
        upcoming: []
      }
    }
  });

  const data = model.get();
  assert.equal(data.taiwanese.goldenVerse, '\u99ac\u592a\u798f\u97f33:16');
  assert.equal(data.taiwanese.goldenVerseText, '\u53f0\u8a9e\u91d1\u53e5');
  assert.equal(data.mandarin.goldenVerse, '\u99ac\u592a\u798f\u97f33:16');
  assert.equal(data.mandarin.goldenVerseText, '\u83ef\u8a9e\u91d1\u53e5');
});

test('calendar API normalization expands the golden-verse book before downstream use', async () => {
  const formatter = loadFormatter();
  const api = loadChurchApi(formatter);
  api.callGAS = async () => ({
    success: true,
    events: [{
      date: '2026-08-09',
      sermons: [{ type: '\u53f0\u8a9e', goldenVerse: '\u592a 3:16', callToWorship: '\u8a69 23:1' }]
    }]
  });

  const result = await api.fetchCalendar();
  assert.equal(result.data[0].goldenVerse, '\u99ac\u592a\u798f\u97f33:16');
  assert.equal(result.data[0].callToWorship, '\u8a69\u7bc723:1');
});

test('weekly bulletin fills the fetched verse text after expanding a manual abbreviation', async () => {
  const formatter = loadFormatter();
  const data = {
    serviceType: '台華語',
    taiwanese: { goldenVerse: '\u592a 3:16', goldenVerseText: '' },
    mandarin: { goldenVerse: '', goldenVerseText: '' }
  };
  const model = {
    get() { return data; },
    set(path, value) {
      const [section, field] = path.split('.');
      data[section][field] = value;
    }
  };
  const fields = {
    '[data-field="taiwanese.goldenVerse"]': { value: '\u592a 3:16' },
    '[data-field="taiwanese.goldenVerseText"]': { value: '' }
  };
  let query;
  const api = {
    async queryBible(book, chap, sec, version) {
      query = { book, chap, sec, version };
      return { success: true, records: [{ text: '<b>台語金句全文</b>' }] };
    }
  };
  const app = loadApp(formatter, model, api, fields);

  await app._autoFillGoldenVerseTextFor('taiwanese', 'tghg');

  assert.deepEqual(query, { book: '\u99ac\u592a\u798f\u97f3', chap: '3', sec: '16', version: 'tghg' });
  assert.equal(data.taiwanese.goldenVerse, '\u99ac\u592a\u798f\u97f33:16');
  assert.equal(data.taiwanese.goldenVerseText, '\u53f0\u8a9e\u91d1\u53e5\u5168\u6587');
  assert.equal(fields['[data-field="taiwanese.goldenVerseText"]'].value, '\u53f0\u8a9e\u91d1\u53e5\u5168\u6587');
});
