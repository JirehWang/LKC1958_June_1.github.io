const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');
const scriptPath = path.join(repoRoot, 'scripts', 'seed_worship_ppt_library_supabase.js');
const sharedScriptPath = path.join(repoRoot, 'scripts', 'ppt-library-index-sync.js');
const source = [scriptPath, sharedScriptPath]
  .filter(filePath => fs.existsSync(filePath))
  .map(filePath => fs.readFileSync(filePath, 'utf8'))
  .join('\n');
const seed = fs.existsSync(scriptPath) ? require(scriptPath) : null;

test('PPT Library seed only writes index metadata, never PPTX payloads or URLs', () => {
  assert.ok(seed, 'seed script must exist');
  assert.doesNotMatch(source, /base64/i);
  assert.doesNotMatch(source, /download_url|storage_url/i);
  assert.match(source, /worship_ppt_library_index/);
});

test('normalizes the current GAS index rows and preserves partial hymn inventory', () => {
  const rows = seed.normalizeLibraryRows({
    success: true,
    data: [
      { kind: 'hymn', number: '047', title: '我的上帝我的君王', fileId: 'h47', fileName: '第047首 我的上帝我的君王.pptx' },
      { kind: 'response', number: 1, title: '啟應文 1', file_id: 'r1', file_name: '1.pptx' }
    ]
  });

  assert.deepEqual(rows, [
    { kind: 'hymn', number: '47', title: '我的上帝我的君王', fileId: 'h47', fileName: '第047首 我的上帝我的君王.pptx' },
    { kind: 'response', number: '1', title: '啟應文 1', fileId: 'r1', fileName: '1.pptx' }
  ]);
});

test('rejects conflicting duplicate logical keys instead of choosing a random PPTX', () => {
  assert.throws(
    () => seed.normalizeLibraryRows({ data: [
      { kind: 'hymn', number: '47', fileId: 'first' },
      { kind: 'hymn', number: '47', fileId: 'second' }
    ] }),
    /重複索引/
  );
});

test('upserts only the five index columns for each available row', async () => {
  const queries = [];
  const client = {
    async query(text, values) {
      queries.push({ text, values });
    }
  };

  const count = await seed.upsertLibraryRows(client, [{
    kind: 'response', number: '1', title: '啟應文 1', fileId: 'r1', fileName: '1.pptx'
  }]);

  assert.equal(count, 1);
  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0].values, ['response', '1', 'r1', '啟應文 1', '1.pptx']);
  assert.match(queries[0].text, /ON CONFLICT\s*\(kind, number\)/i);
  assert.doesNotMatch(queries[0].text, /base64|download_url|storage_url/i);
});
