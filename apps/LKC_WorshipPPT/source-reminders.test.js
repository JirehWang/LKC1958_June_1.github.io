const test = require('node:test');
const assert = require('node:assert/strict');
const { buildMissingSourceReminders, formatMissingSourceReminder } = require('./source-reminders.js');

test('lists only empty or unavailable sources after a service import', () => {
  const reminders = buildMissingSourceReminders({
    date: '2026-07-12',
    event: { eventId: 'sermon-1' },
    model: {
      call: { sourceValue: '詩篇 1:1', pptPages: [{ body: '有福的人' }] },
      sermon: { title: '', kicker: '王牧師' },
      scripture: { sourceValue: '馬太福音 1:1', pptPages: [] },
      verse: { sourceValue: '', pptPages: [] },
      response: { sourceValue: '3' },
      'hymn-1': { sourceValue: '65' },
      'hymn-2': { sourceValue: '' },
      doxology: { sourceValue: '510' },
      announcements: {
        announcements: [],
        churchNews: ['教界消息'],
        prayer: { homeRest: '', hospital: '', other: '' }
      },
      praise: { title: '讚美', body: '' }
    },
    bulletinResult: {
      reports: { state: 'loaded' },
      praise: { state: 'loaded' }
    },
    libraryResults: [
      { sectionId: 'hymn-1', state: 'loaded' },
      { sectionId: 'response', state: 'missing' }
    ]
  });

  assert.deepEqual(reminders, [
    '行事曆「講題」欄位空白',
    '行事曆「金句」欄位空白',
    '行事曆「聖詩二」欄位空白',
    '台語聖經「聖經」查無經文：馬太福音 1:1',
    'PPT 資料庫找不到「啟應文」素材',
    '週報「本會消息」空白',
    '週報「關懷代禱」空白',
    '週報「讚美歌詞」空白'
  ]);
});

test('identifies absent date records instead of treating them as an empty field', () => {
  const reminders = buildMissingSourceReminders({
    date: '2026-07-19',
    event: null,
    model: { announcements: {}, praise: {} },
    bulletinResult: {
      reports: { state: 'missing' },
      praise: { state: 'missing' }
    },
    libraryResults: []
  });

  assert.deepEqual(reminders, [
    '行事曆：2026-07-19 的「講道資訊－台語」尚未建立',
    '週報：reports_2026-07-19 尚未建立',
    '週報：praise_songs_2026-07-19 尚未建立'
  ]);
});

test('does not require lyrics for instrumental praise and flags missing performance details', () => {
  const input = {
    date: '2026-07-26',
    event: {},
    model: { praise: { title: '這是天父世界', body: '' } },
    bulletinResult: {
      praise: {
        state: 'loaded',
        data: {
          title: '這是天父世界',
          performanceType: 'instrumental',
          tune: 'Terra Beata',
          arrangement: 'Brant Adams',
          performers: '長笛 / 黃慈恩\n鋼琴 / 蔡宜婷'
        }
      }
    },
    profile: { sourceRequirements: { calendarFields: [], bibleSections: [], reports: false } }
  };

  assert.deepEqual(buildMissingSourceReminders(input), []);
  input.bulletinResult.praise.data.tune = '';
  input.bulletinResult.praise.data.arrangement = '';
  input.bulletinResult.praise.data.performers = '';
  assert.deepEqual(buildMissingSourceReminders(input), ['週報「讚美演奏資訊」空白']);
});

test('formats the popup as a readable source-by-source reminder', () => {
  assert.equal(formatMissingSourceReminder([
    '行事曆「金句」欄位空白',
    '週報「教界消息」空白'
  ]), '提醒：請確認以下來源狀態；讀取失敗可重新帶入，空白欄位請確認當週是否有內容：\n\n• 行事曆「金句」欄位空白\n• 週報「教界消息」空白');
});
