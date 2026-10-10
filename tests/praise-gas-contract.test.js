const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'scratch_gas_sunday', 'PraiseSongs.js'),
  'utf8'
);
const {
  praiseDate_,
  praiseUuid_,
  praiseOk_,
  praiseError_,
  praiseActionIsRead_,
  praiseSaveSong_,
  praiseListSongs_,
  praiseBindDate_,
  praiseLoadByDate_,
  praiseUnbindDate_,
  praiseArchiveSong_
} = require('../scratch_gas_sunday/PraiseSongs.js');

test('GAS praise API exposes UUID song and date-binding contract', () => {
  assert.equal(praiseDate_('2026-10-11'), '2026-10-11');
  assert.equal(praiseDate_('not-a-date'), '');
  assert.equal(praiseUuid_('11111111-1111-4111-8111-111111111111'), '11111111-1111-4111-8111-111111111111');
  assert.equal(praiseUuid_('legacy-title'), '');

  assert.deepEqual(praiseOk_({ date: '2026-10-11' }), {
    ok: true,
    success: true,
    schemaVersion: 2,
    data: { date: '2026-10-11' }
  });
  assert.equal(praiseError_('UNAUTHORIZED', '拒絕').code, 'UNAUTHORIZED');
  assert.equal(praiseActionIsRead_('praise_loadByDate'), true);
  assert.equal(praiseActionIsRead_('praise_saveSong'), false);
});

test('GAS praise source keeps separate song and date-binding sheets', () => {
  assert.match(source, /const PRAISE_SONG_SHEET_NAME = '讚美歌曲'/);
  assert.match(source, /const PRAISE_BINDING_SHEET_NAME = '讚美日期綁定'/);
  assert.match(source, /case 'praise_saveSong'/);
  assert.match(source, /case 'praise_bindDate'/);
  assert.match(source, /case 'praise_unbindDate'/);
  assert.match(source, /case 'praise_archiveSong'/);
  assert.match(source, /loadPraiseByDate: 'praise_loadByDate'/);
  assert.match(source, /songDeletedAt/);
});

test('GAS song writes keep UUID stable while date binding remains separate', () => {
  class FakeSheet {
    constructor() { this.rows = []; }
    getLastRow() { return this.rows.length; }
    getLastColumn() { return this.rows[0]?.length || 0; }
    getRange(row, column, rowCount, columnCount) {
      return {
        getValues: () => this.rows.slice(row - 1, row - 1 + rowCount)
          .map(values => values.slice(column - 1, column - 1 + columnCount)),
        setValues: values => {
          values.forEach((nextRow, rowIndex) => {
            this.rows[row - 1 + rowIndex] = nextRow.slice();
          });
        }
      };
    }
  }
  class FakeSpreadsheet {
    constructor() { this.sheets = new Map(); }
    getSheetByName(name) { return this.sheets.get(name) || null; }
    insertSheet(name) {
      const sheet = new FakeSheet();
      this.sheets.set(name, sheet);
      return sheet;
    }
  }

  const previousGetSS = global.getSS;
  const previousUtilities = global.Utilities;
  const previousSession = global.Session;
  const spreadsheet = new FakeSpreadsheet();
  let uuidCounter = 1;
  global.getSS = () => spreadsheet;
  global.Utilities = {
    getUuid: () => `11111111-1111-4111-8111-${String(uuidCounter++).padStart(12, '0')}`,
    formatDate: date => date.toISOString().slice(0, 10)
  };
  global.Session = { getScriptTimeZone: () => 'Asia/Taipei' };

  try {
    const created = praiseSaveSong_({
      title: '穩定身份歌曲',
      lyrics: '舊歌詞',
      date: '2026-10-11',
      updatedBy: 'test'
    });
    const songId = created.song.songId;
    assert.match(songId, /^[0-9a-f-]{36}$/i);
    assert.equal(created.binding, undefined);
    assert.equal(praiseListSongs_().length, 1);
    assert.throws(() => praiseLoadByDate_('2026-10-11'), error => error.code === 'PRAISE_DATE_NOT_BOUND');
    praiseBindDate_('2026-10-11', songId, { updatedBy: 'test' });
    assert.equal(praiseLoadByDate_('2026-10-11').lyrics, '舊歌詞');

    praiseSaveSong_({
      songId,
      title: '穩定身份歌曲（修正）',
      lyrics: '新歌詞',
      date: '2026-10-11',
      updatedBy: 'test'
    });
    assert.equal(praiseListSongs_()[0].songId, songId);
    assert.equal(praiseListSongs_()[0].title, '穩定身份歌曲（修正）');
    assert.equal(praiseLoadByDate_('2026-10-11').lyrics, '新歌詞');

    const unbound = praiseUnbindDate_('2026-10-11', 'test');
    assert.equal(unbound.songId, '');
    assert.equal(unbound.status, 'inactive');
    assert.throws(() => praiseLoadByDate_('2026-10-11'), error => error.code === 'PRAISE_DATE_NOT_BOUND');
    praiseBindDate_('2026-10-11', songId, { updatedBy: 'test' });
    praiseArchiveSong_(songId, 'test');
    assert.throws(() => praiseLoadByDate_('2026-10-11'), error => error.code === 'PRAISE_SONG_ARCHIVED');
  } finally {
    if (previousGetSS === undefined) delete global.getSS;
    else global.getSS = previousGetSS;
    if (previousUtilities === undefined) delete global.Utilities;
    else global.Utilities = previousUtilities;
    if (previousSession === undefined) delete global.Session;
    else global.Session = previousSession;
  }
});
