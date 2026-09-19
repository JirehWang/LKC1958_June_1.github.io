'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { SyncLedgerClient } = require('../scripts/sync-ledger-client.js');

function response(body) {
  return {
    ok: true,
    status: 200,
    json: async () => body
  };
}

test('SyncLedgerClient posts run records to GAS with the configured token', async () => {
  const calls = [];
  const client = new SyncLedgerClient({
    url: 'https://ledger.example/exec',
    token: 'ledger-token',
    retryAttempts: 1,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response({ success: true, data: { runId: 'run-1' } });
    }
  });

  const result = await client.startRun({
    runId: 'run-1',
    mode: 'audit',
    windowStart: '2025-09-20',
    windowEnd: '2026-09-19'
  });

  assert.deepEqual(result, { runId: 'run-1' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://ledger.example/exec');
  assert.equal(calls[0].options.method, 'POST');
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.action, 'syncLedger_startRun');
  assert.equal(body.token, 'ledger-token');
  assert.equal(body.data.runId, 'run-1');
});

test('SyncLedgerClient retries transient GAS failures', async () => {
  let attempts = 0;
  const client = new SyncLedgerClient({
    url: 'https://ledger.example/exec',
    token: 'ledger-token',
    retryAttempts: 2,
    retryDelayMs: 0,
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('ETIMEDOUT');
      return response({ success: true, data: { accepted: true } });
    }
  });

  const result = await client.finishRun('run-1', { matched: 3 });
  assert.deepEqual(result, { accepted: true });
  assert.equal(attempts, 2);
});

test('SyncLedgerClient sends audit items in bounded batches', async () => {
  const batches = [];
  const client = new SyncLedgerClient({
    url: 'https://ledger.example/exec',
    token: 'ledger-token',
    batchSize: 2,
    retryAttempts: 1,
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      batches.push(body.data.items);
      return response({ success: true, data: { accepted: body.data.items.length } });
    }
  });

  await client.appendItems('run-1', [
    { key: 'a' },
    { key: 'b' },
    { key: 'c' }
  ]);

  assert.deepEqual(batches, [[{ key: 'a' }, { key: 'b' }], [{ key: 'c' }]]);
});

test('SyncLedgerClient records an operation event and can query health', async () => {
  const actions = [];
  const client = new SyncLedgerClient({
    url: 'https://ledger.example/exec',
    token: 'ledger-token',
    retryAttempts: 1,
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      actions.push(body);
      return response({ success: true, data: { success: true } });
    }
  });

  await client.recordEvent({
    operationId: 'op-1',
    domain: 'attendance_records',
    action: 'audit',
    source: 'reconciler',
    status: 'MATCHED'
  });
  await client.getHealth();

  assert.equal(actions[0].action, 'syncLedger_recordEvent');
  assert.equal(actions[0].data.operationId, 'op-1');
  assert.equal(actions[1].action, 'syncLedger_getHealth');
});
