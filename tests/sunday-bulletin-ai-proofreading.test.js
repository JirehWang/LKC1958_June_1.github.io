const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const proofreader = require('../apps/LKC_SundayBulletin/js/reports-ai.js');

test('proofreading payload keeps field ids and excludes blank fields', () => {
  assert.deepEqual(
    proofreader.buildProofreadingPayload([
      { id: 'announcements.0', text: '  主日聚會提醒  ' },
      { id: 'announcements.1', text: '   ' },
      { id: 'prayer.homeRest', text: '請為病中的家人代禱' }
    ]),
    [
      { id: 'announcements.0', text: '主日聚會提醒' },
      { id: 'prayer.homeRest', text: '請為病中的家人代禱' }
    ]
  );
});

test('proofreading response is limited to requested fields and never mutates source text', () => {
  const requested = [{ id: 'announcements.0', text: '請按時到教會' }];
  const result = proofreader.normalizeProofreadingResponse({
    suggestions: [
      { id: 'announcements.0', suggestion: '請按時到教會。', changed: true },
      { id: 'unknown', suggestion: '不應顯示' }
    ]
  }, requested);

  assert.deepEqual(result, [{
    id: 'announcements.0',
    text: '請按時到教會',
    suggestion: '請按時到教會。',
    changed: true,
    note: ''
  }]);
  assert.equal(requested[0].text, '請按時到教會');
});

test('applying one suggestion updates only the original field and emits an input event', () => {
  const events = [];
  const textarea = {
    value: '請按時到教會',
    dataset: {},
    _aiSuggestionInput: { value: '請按時到教會。' },
    _aiSuggestionNote: { textContent: '請人工確認後再採用' },
    _aiSuggestionLayout: {
      classList: {
        added: [],
        removed: [],
        add(name) { this.added.push(name); },
        remove(name) { this.removed.push(name); }
      }
    },
    _aiSuggestionCheckbox: { checked: true, disabled: false },
    _aiApplyButton: { disabled: false, textContent: '套用這項' },
    dispatchEvent(event) { events.push(event.type); }
  };

  assert.equal(proofreader.applySuggestionToField(textarea), true);
  assert.equal(textarea.value, '請按時到教會。');
  assert.deepEqual(events, ['input']);
  assert.equal(textarea._aiSuggestionInput.value, '');
  assert.equal(textarea._aiSuggestionCheckbox.checked, false);
  assert.equal(textarea._aiSuggestionCheckbox.disabled, true);
  assert.equal(textarea._aiApplyButton.disabled, true);
  assert.equal(textarea._aiApplyButton.textContent, '已套用');
});

test('batch selection keeps only checked suggestions that contain a real change', () => {
  assert.deepEqual(
    proofreader.selectSuggestionIds([
      { id: 'announcements.0', text: '請按時到教會', suggestion: '請按時到教會。', changed: true },
      { id: 'announcements.1', text: '聚會時間不變', suggestion: '聚會時間不變', changed: false },
      { id: 'prayer.other', text: '請代禱', suggestion: '請代禱。', changed: true }
    ], ['announcements.1', 'prayer.other', 'unknown']),
    ['prayer.other']
  );
});

test('report page includes the AI proofreading entry point and shared ministry API config', () => {
  const reportPath = path.join(__dirname, '..', 'apps', 'LKC_SundayBulletin', 'reports.html');
  const html = fs.readFileSync(reportPath, 'utf8');
  assert.match(html, /id=["']btnAiProofread["']/);
  assert.match(html, /id=["']btnAiApplySelected["']/);
  assert.match(html, /id=["']btnAiApplyAll["']/);
  assert.match(html, /reports-ai\.js/);
  assert.match(html, /_GAS_KEY\s*=\s*["']LKC_MinistrySchedule["']/);
});

test('GAS route exposes a proofreading action backed by MinistryCore', () => {
  const corePath = path.join(__dirname, '..', 'scratch_gas_sunday', 'Core.js');
  const ministryPath = path.join(__dirname, '..', 'scratch_gas_sunday', 'MinistryCore.js');
  const core = fs.readFileSync(corePath, 'utf8');
  const ministry = fs.readFileSync(ministryPath, 'utf8');
  assert.match(core, /ministry_proofreadFields/);
  assert.match(ministry, /function ministry_proofreadFields\s*\(/);
  assert.match(ministry, /callGemini\(systemPrompt, userText, \{ useCache: true \}\)/);
});
