const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const defaultGasPath = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  'LKC',
  '教會行事曆',
  'PptLibrary.js'
);
const gasPath = process.env.LKC_PPT_LIBRARY_GAS_PATH || defaultGasPath;

if (!fs.existsSync(gasPath)) {
  test('GAS sync plan contract (local GAS source unavailable)', { skip: true }, () => {});
} else {
  const context = { console: { warn() {} } };
  vm.runInNewContext(fs.readFileSync(gasPath, 'utf8'), context, { filename: gasPath });

  test('GAS hymn sync plan only inserts and updates while preserving old rows', () => {
    const plan = context._pptLibraryPlanSync_(
      [
        { kind: 'hymn', number: '247', title: '同一首', fileId: 'drive-247', fileName: '第247首 同一首.pptx' },
        { kind: 'hymn', number: '306B', title: '更新後', fileId: 'drive-306-new', fileName: '第306B首 更新後.pptx' },
        { kind: 'hymn', number: '522', title: '新增', fileId: 'drive-522', fileName: '第522首 新增.pptx' }
      ],
      [
        { kind: 'hymn', number: '247', title: '同一首', file_id: 'drive-247', file_name: '第247首 同一首.pptx' },
        { kind: 'hymn', number: '306B', title: '更新前', file_id: 'drive-306-old', file_name: '第306B首 更新前.pptx' },
        { kind: 'hymn', number: '999', title: '保留舊資料', file_id: 'drive-999', file_name: '第999首 保留舊資料.pptx' }
      ]
    );

    assert.equal(plan.sourceCount, 3);
    assert.equal(plan.existingCount, 3);
    assert.equal(plan.inserted, 1);
    assert.equal(plan.updated, 1);
    assert.equal(plan.unchanged, 1);
    assert.equal(plan.preserved, 1);
    assert.equal(
      JSON.stringify(plan.changes.map(row => row.kind + ':' + row.number).sort()),
      JSON.stringify(['hymn:306B', 'hymn:522'])
    );
  });
}
