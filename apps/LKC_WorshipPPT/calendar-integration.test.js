const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, 'calendar-integration.js'), 'utf8');

test('shows one non-blocking warning dialog that names missing import sources', () => {
  assert.match(source, /buildMissingSourceReminders\(\{ date, event, model, bulletinResult, libraryResults, profile \}\)/);
  assert.match(source, /reminders\.length[\s\S]{0,120}window\.alert\(/);
  assert.match(source, /formatMissingSourceReminder\(reminders\)/);
  assert.match(source, /status\(`\$\{calendarSummary\}/);
});

test('reports the stage that failed instead of labeling every import error as calendar failure', () => {
  assert.match(source, /let stage = '行事曆'/);
  assert.match(source, /stage = '聖詩／啟應文'/);
  assert.match(source, /status\(`\$\{stage\}帶入失敗：\$\{error\.message\}`\)/);
});

test('keeps partial Bible import errors visible after the remaining import steps finish', () => {
  assert.match(source, /let bibleResult = \{ errors: \[\] \}/);
  assert.match(source, /bibleResult = await window\.generateCalendarContent\(\)/);
  assert.match(source, /bibleResult && Array\.isArray\(bibleResult\.errors\)/);
  assert.match(source, /聖經部分失敗/);
});
