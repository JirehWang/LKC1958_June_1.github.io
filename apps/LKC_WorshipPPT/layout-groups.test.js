const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, 'layout-groups.js'), 'utf8');

function sourceBetween(start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `missing source marker: ${start}`);
  assert.notEqual(endIndex, -1, `missing source marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

test('uses the page row for browsing without making the row a checkbox label', () => {
  assert.match(source, /<div class="deck-page-row[^"`]*" data-deck-page-row=/);
  assert.doesNotMatch(source, /<label data-deck-page-row=/);
  assert.match(source, /querySelectorAll\('\[data-deck-page-row\]'\)[\s\S]*row\.onclick = event =>/);
  assert.match(source, /event\.target\.closest\('input'\)/);
});

test('page checkboxes select for layout editing and may preview the checked page', () => {
  const pageSelectionHandler = sourceBetween(
    "document.querySelectorAll('[data-layout-page]')",
    "document.querySelectorAll('[data-layout-section]')"
  );
  assert.match(pageSelectionHandler, /pendingSelection\.(add|delete)/);
  assert.match(pageSelectionHandler, /showDeckEntry/);
});

test('section checkboxes retain bulk selection and first-page preview behavior', () => {
  const sectionSelectionHandler = sourceBetween(
    "document.querySelectorAll('[data-layout-section]')",
    "document.querySelectorAll('[data-deck-section]').forEach(syncSectionCheckbox)"
  );
  assert.match(sectionSelectionHandler, /pendingSelection\.(add|delete)/);
  assert.match(sectionSelectionHandler, /showDeckEntry/);
});

test('chapter names stay inside the native summary toggle while its checkbox is isolated', () => {
  assert.match(source, /<summary>[\s\S]*?<span><b>[\s\S]*?<\/b>\$\{section\.label\}<\/span><small>/);
  const sectionSelectionHandler = sourceBetween(
    "document.querySelectorAll('[data-layout-section]')",
    "document.querySelectorAll('[data-deck-section]').forEach(syncSectionCheckbox)"
  );
  assert.match(sectionSelectionHandler, /box\.onclick = event => event\.stopPropagation\(\)/);
});

test('keeps failed cloud saves pending locally and retries them after unlock', () => {
  const persistence = sourceBetween(
    'async function persistLayoutState()',
    'function sectionDecks()'
  );
  assert.match(persistence, /layoutSyncPending = true;[\s\S]*persistLocalLayoutState\(\);[\s\S]*await cloudStore\.save\(layoutState\);[\s\S]*layoutSyncPending = false;[\s\S]*persistLocalLayoutState\(\);/);

  const unlockHandler = sourceBetween(
    "document.getElementById('layout-unlock-form').onsubmit",
    "document.getElementById('layout-unlock-cancel')"
  );
  assert.match(unlockHandler, /layoutSyncPending && hasLayoutState\(\)/);
  assert.match(unlockHandler, /await persistLayoutState\(\)/);
});

test('reflows report pagination from effective layout changes and cloud state', () => {
  assert.match(source, /function reflowReportPagesForLayout\(/);
  assert.match(source, /window\.reflowReportPagesForLayout = reflowReportPagesForLayout/);
  assert.match(source, /input\.addEventListener\('input',[\s\S]*reflowReportPagesForLayout\(liveParams\)/);
  assert.match(sourceBetween('async function saveGroup()', 'async function detachSelection()'), /reflowReportPagesForLayout\(group\.params\)/);
  assert.match(sourceBetween('async function saveOutputScale()', 'function computedColor('), /reflowReportPagesForLayout\(\)/);
  assert.match(sourceBetween('async function initializeCloudLayout()', 'function openUnlockDialog()'), /replaceLayoutState\([\s\S]*reflowReportPagesForLayout\(\)/);
});

test('extracts layout form parameters safely when content inputs are absent for car-notice', () => {
  const paramsExtractor = sourceBetween(
    'function paramsFromForm()',
    'function reportPageForLayout()'
  );
  assert.match(paramsExtractor, /inputValue\('lg-title-align'/);
  assert.match(paramsExtractor, /inputValue\('lg-content-align'/);
  assert.match(paramsExtractor, /inputValue\('lg-content-color'/);
  assert.match(paramsExtractor, /currentSelectionKind\(\) === 'car-notice'/);
});

test('chapter summary navigates to first page and car-notice includes quick export toggle', () => {
  assert.match(source, /summary\.onclick = event =>/);
  assert.match(source, /data-export-section="\$\{section\.sectionId\}"/);
  assert.match(source, /model\[sectionId\]\.includeInExport = /);
  assert.match(source, /id="lg-car-notice-export"/);
});
