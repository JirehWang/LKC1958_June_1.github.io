const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const dashboardPath = path.join(root, 'apps', 'LKC_ChurchERP', 'dashboard.html');
const dashboard = fs.readFileSync(dashboardPath, 'utf8');
const portal = fs.readFileSync(path.join(root, 'apps', 'LKC_ChurchERP', 'index.html'), 'utf8');

test('church ERP Dashboard prototype exposes the secretary workflow areas', () => {
  for (const marker of [
    '本週服事進度',
    '出席狀況',
    '行事曆進度',
    '週報與 PPT 準備度',
    '資料來源'
  ]) {
    assert.ok(dashboard.includes(marker), marker);
  }

  assert.match(dashboard, /dashboard\.css/);
  assert.match(dashboard, /dashboard\.js/);
  assert.match(dashboard, /示範資料/);
});

test('Dashboard prototype stays separate from the simple ERP entry cards', () => {
  assert.match(portal, /href="dashboard.html"/);
  assert.equal((portal.match(/class="card"/g) || []).length, 6);
});
