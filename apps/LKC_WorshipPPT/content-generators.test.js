const test = require('node:test');
const assert = require('node:assert/strict');
const { queryBibleViaReadApi, loadBibleSectionsSequentially } = require('./content-generators.js');

test('queries parsed Taiwanese Bible references through the GAS read API', async () => {
  const calls = [];
  const bibleService = {
    parseQuery() {
      return [{ short: '太', chap: 13, sec: '1-2' }];
    }
  };
  const readApi = async (action, data) => {
    calls.push({ action, data });
    return { success: true, records: [{ chap: 13, sec: 1, text: '測試經文' }] };
  };
  const records = await queryBibleViaReadApi('馬太福音13:1-2', bibleService, readApi);
  assert.deepEqual(calls, [{
    action: 'cal_queryBible',
    data: { book: '太', chap: 13, sec: '1-2', version: 'tghg' }
  }]);
  assert.deepEqual(records, [{ chap: 13, sec: 1, text: '測試經文', bible_text: '測試經文' }]);
});

test('uses the template Bible version for Mandarin scripture', async () => {
  const calls = [];
  const bibleService = { parseQuery: () => [{ short: '太', chap: 13, sec: '47-50' }] };
  const readApi = async (action, data) => {
    calls.push({ action, data });
    return { records: [{ sec: 47, bible_text: '天國又好像網撒在海裏' }] };
  };
  const records = await queryBibleViaReadApi('馬太福音13:47-50', bibleService, readApi, 'unv');
  assert.equal(calls[0].data.version, 'unv');
  assert.equal(records[0].bible_text, '天國又好像網撒在海裏');
});

test('loads Bible sections sequentially and continues after one section fails', async () => {
  const events = [];
  let active = 0;
  let maxActive = 0;
  const result = await loadBibleSectionsSequentially([
    { sectionId: 'call', label: '宣召' },
    { sectionId: 'scripture', label: '聖經' },
    { sectionId: 'verse', label: '金句' }
  ], async config => {
    events.push(`start:${config.sectionId}`);
    active += 1;
    maxActive = Math.max(maxActive, active);
    await Promise.resolve();
    active -= 1;
    if (config.sectionId === 'call') throw new Error('宣召測試失敗');
    events.push(`done:${config.sectionId}`);
    return { sectionId: config.sectionId, errors: [] };
  });

  assert.equal(maxActive, 1);
  assert.deepEqual(events, [
    'start:call',
    'start:scripture',
    'done:scripture',
    'start:verse',
    'done:verse'
  ]);
  assert.deepEqual(result.errors, [{
    sectionId: 'call',
    label: '宣召',
    message: '宣召測試失敗'
  }]);
});
