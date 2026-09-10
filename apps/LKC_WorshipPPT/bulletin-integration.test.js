const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, 'bulletin-integration.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

test('reflows loaded and manually edited reports with the current effective layout', () => {
  const calls = source.match(/root\.reflowReportPagesForLayout\(\)/g) || [];
  assert.equal(calls.length, 2);
  assert.match(source, /applyReportsToModel\(model, reportsResult\.data\);[\s\S]{0,120}reflowReportPagesForLayout\(\)/);
  assert.match(source, /element\.oninput[\s\S]*applyReportsToModel\(model,[\s\S]*reflowReportPagesForLayout\(\);[\s\S]*preview\(\)/);
});

test('loads reports and praise from the existing bulletin API without a Firebase content mirror', () => {
  assert.doesNotMatch(source, /readServiceRecord/);
  assert.match(source, /loadCloudRecord\(endpoint, kind, date, root\.fetch\.bind\(root\)\)/);
});

test('boots the shared Sunday Bulletin Supabase service before PPT bulletin content', () => {
  const configIndex = indexSource.indexOf('../../supabase/supabase-config.js');
  const serviceIndex = indexSource.indexOf('../LKC_SundayBulletin/js/bulletin-supabase.js');
  const contentIndex = indexSource.indexOf('bulletin-content.js');

  assert.ok(configIndex >= 0, 'Supabase config must be loaded');
  assert.ok(serviceIndex > configIndex, 'Sunday Bulletin service must load after Supabase config');
  assert.ok(contentIndex > serviceIndex, 'PPT bulletin content must load after Sunday Bulletin service');
});
