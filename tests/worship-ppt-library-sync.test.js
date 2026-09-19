const test = require('node:test');
const assert = require('node:assert/strict');

const sync = require('../scripts/ppt-library-index-sync.js');
const cli = require('../scripts/sync_worship_ppt_library_index.js');

const SOURCE_ROWS = [
  { kind: 'hymn', number: '047', fileId: 'h47', title: '我的上帝我的君王', fileName: '第047首 我的上帝我的君王.pptx' },
  { kind: 'response', number: '1', fileId: 'r1-new', title: '啟應文 1', fileName: '1.pptx' },
  { kind: 'hymn', number: '306B', fileId: 'h306b', title: '新聖詩', fileName: '第306B首 新聖詩.pptx' }
];

test('plans additive and update-only changes without deleting rows missing from GAS', () => {
  const plan = sync.planLibrarySync(SOURCE_ROWS, [
    { kind: 'hymn', number: '47', file_id: 'h47', title: '我的上帝我的君王', file_name: '第047首 我的上帝我的君王.pptx' },
    { kind: 'response', number: '1', file_id: 'r1-old', title: '啟應文 1', file_name: '1-old.pptx' },
    { kind: 'hymn', number: '999', file_id: 'h999', title: '尚存的舊索引', file_name: '999.pptx' }
  ]);

  assert.deepEqual({
    inserted: plan.inserted,
    updated: plan.updated,
    unchanged: plan.unchanged,
    preserved: plan.preserved
  }, {
    inserted: 1,
    updated: 1,
    unchanged: 1,
    preserved: 1
  });
  assert.equal(plan.projectedCount, 4);
  assert.deepEqual(plan.changes.map(change => change.key), ['response:1', 'hymn:306B']);
});

test('rejects duplicate logical keys before a sync transaction can write', () => {
  assert.throws(
    () => sync.planLibrarySync([
      { kind: 'hymn', number: '47', fileId: 'first' },
      { kind: 'hymn', number: '047', fileId: 'second' }
    ], []),
    /重複索引/
  );
});

test('applies the complete plan in one transaction and keeps missing source rows', async () => {
  const queries = [];
  const client = {
    async query(text, values) {
      queries.push({ text, values });
      if (/SELECT\s+kind/i.test(text)) {
        return {
          rows: [{
            kind: 'hymn',
            number: '47',
            fileId: 'h47',
            title: '我的上帝我的君王',
            fileName: '第047首 我的上帝我的君王.pptx'
          }, {
            kind: 'response',
            number: '1',
            fileId: 'r1-old',
            title: '啟應文 1',
            fileName: '1-old.pptx'
          }]
        };
      }
      return { rows: [] };
    }
  };

  const result = await sync.applyLibrarySync(client, SOURCE_ROWS);

  assert.equal(result.inserted, 1);
  assert.equal(result.updated, 1);
  assert.equal(result.unchanged, 1);
  assert.equal(result.preserved, 0);
  assert.equal(queries[0].text, 'BEGIN');
  assert.equal(queries.at(-1).text, 'COMMIT');
  assert.equal(queries.filter(query => /INSERT INTO/i.test(query.text)).length, 2);
  assert.ok(queries.filter(query => /INSERT INTO/i.test(query.text)).every(query => /ppt-library-sync/.test(query.text)));
});

test('rolls back when an upsert fails', async () => {
  const queries = [];
  const client = {
    async query(text) {
      queries.push(text);
      if (/SELECT\s+kind/i.test(text)) return { rows: [] };
      if (/INSERT INTO/i.test(text)) throw new Error('database unavailable');
      return { rows: [] };
    }
  };

  await assert.rejects(() => sync.applyLibrarySync(client, SOURCE_ROWS), /database unavailable/);
  assert.equal(queries[0], 'BEGIN');
  assert.equal(queries.at(-1), 'ROLLBACK');
  assert.doesNotMatch(queries.join('\n'), /COMMIT/);
});

test('fetches the GAS index with the configured token and retries transient failures', async () => {
  let attempts = 0;
  const cacheKeys = [];
  const fetchImpl = async url => {
    attempts += 1;
    const parsedUrl = new URL(url);
    assert.equal(parsedUrl.searchParams.get('token'), 'test-token');
    cacheKeys.push(parsedUrl.searchParams.get('_lkc'));
    if (attempts === 1) return { ok: false, status: 503, text: async () => 'temporarily unavailable' };
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        success: true,
        data: [{ kind: 'hymn', number: '047', fileId: 'h47' }]
      })
    };
  };

  const rows = await sync.fetchLibraryIndex('https://example.test/library', fetchImpl, {
    token: 'test-token',
    retryAttempts: 2,
    retryDelayMs: 0
  });

  assert.equal(attempts, 2);
  assert.notEqual(cacheKeys[0], cacheKeys[1]);
  assert.deepEqual(rows, [{ kind: 'hymn', number: '47', title: '', fileId: 'h47', fileName: '' }]);
});

test('requires a runtime token instead of embedding the shared GAS token in the sync script', () => {
  assert.throws(
    () => sync.getLibraryGasToken({}),
    /PPT_LIBRARY_GAS_TOKEN/
  );
});

test('retries a transient database connection before failing the sync run', async () => {
  let attempts = 0;
  class RetryClient {
    constructor() { this.closed = false; }
    async connect() {
      attempts += 1;
      if (attempts === 1) {
        const error = new Error('connection reset by peer');
        error.code = 'ECONNRESET';
        throw error;
      }
    }
    async query(text) {
      if (/SELECT\s+kind/i.test(text)) return { rows: [] };
      return { rows: [] };
    }
    async end() { this.closed = true; }
  }

  const result = await cli.runDatabaseSync(
    { apply: false, retryAttempts: 2, retryDelayMs: 0 },
    { SUPABASE_DB_URL: 'postgres://example.test/db' },
    { ClientClass: RetryClient },
    [{ kind: 'hymn', number: '47', fileId: 'h47' }]
  );

  assert.equal(attempts, 2);
  assert.equal(result.inserted, 1);
});
