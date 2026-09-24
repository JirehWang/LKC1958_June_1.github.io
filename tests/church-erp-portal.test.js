const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'apps', 'LKC_ChurchERP', 'index.html'), 'utf8');

const modules = [
  ['dashboard.html', '教會幹事 Dashboard'],
  ['../LKC_MinistrySchedule/', '教會事工總表系統'],
  ['../LKC_WorshipPPT/', '禮拜PPT產生器'],
  ['../LKC_SundayserviceAttendance/', '教會主日出席點名系統'],
  ['../LKC_MasterSchedule/', '教會行事曆管理系統'],
  ['../LKC_SundayBulletin/', '教會週報管理系統']
];

test('church ERP exposes the Dashboard and five secretary modules as simple cards', () => {
  for (const [href, label] of modules) {
    assert.ok(html.includes('href="' + href + '" target="_blank" rel="noopener"'), href);
    assert.ok(html.includes('<div class="title">' + label + '</div>'), label);
  }
});

test('church ERP stays a simple card portal and leaves the original admin portal untouched', () => {
  assert.equal((html.match(/class="card"/g) || []).length, 6);
  assert.ok(!html.includes('待辦事項'));
  assert.ok(!html.includes('本週營運'));
  assert.equal(fs.existsSync(path.join(root, 'apps', 'LKC_ChurchERP', 'app.js')), false);
  assert.equal(fs.existsSync(path.join(root, 'apps', 'LKC_ChurchERP', 'styles.css')), false);
});
