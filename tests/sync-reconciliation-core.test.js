'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  STATUS,
  buildDateWindow,
  compareRecords,
  fingerprint,
  normalizeValue
} = require('../scripts/sync-reconciliation-core.js');

test('buildDateWindow returns an inclusive Taiwan 365-day window', () => {
  const window = buildDateWindow({
    now: new Date('2026-09-19T00:30:00.000Z'),
    days: 365,
    timeZone: 'Asia/Taipei'
  });

  assert.deepEqual(window, {
    start: '2025-09-20',
    end: '2026-09-19',
    days: 365,
    timeZone: 'Asia/Taipei'
  });
});

test('normalizeValue makes object key order and configured array order deterministic', () => {
  const normalized = normalizeValue({
    z: [' b ', 'a'],
    a: { y: ' 2 ', x: null }
  }, { sortArrays: true });

  assert.deepEqual(normalized, {
    a: { x: null, y: '2' },
    z: ['a', 'b']
  });
  assert.equal(
    fingerprint({ a: 1, b: 2 }),
    fingerprint({ b: 2, a: 1 })
  );
});

test('compareRecords classifies matched, one-sided, and content differences', () => {
  const result = compareRecords({
    domain: 'demo',
    gasRecords: [
      { id: 'same', value: 'A' },
      { id: 'gas-only', value: 'G' },
      { id: 'different', value: 'gas' }
    ],
    supabaseRecords: [
      { id: 'same', value: 'A' },
      { id: 'supabase-only', value: 'S' },
      { id: 'different', value: 'supabase' }
    ],
    keyOf: row => row.id
  });

  assert.equal(result.counts[STATUS.MATCHED], 1);
  assert.equal(result.counts[STATUS.GAS_ONLY], 1);
  assert.equal(result.counts[STATUS.SUPABASE_ONLY], 1);
  assert.equal(result.counts[STATUS.CONTENT_MISMATCH], 1);
  assert.equal(result.counts[STATUS.DELETE_MISMATCH] || 0, 0);
  assert.equal(result.counts[STATUS.INVALID_IDENTITY] || 0, 0);
  assert.equal(result.items.find(item => item.key === 'same').status, STATUS.MATCHED);
  assert.equal(result.items.find(item => item.key === 'gas-only').status, STATUS.GAS_ONLY);
  assert.equal(result.items.find(item => item.key === 'supabase-only').status, STATUS.SUPABASE_ONLY);
  assert.equal(result.items.find(item => item.key === 'different').status, STATUS.CONTENT_MISMATCH);
});

test('compareRecords rejects duplicate identities instead of silently choosing one', () => {
  const result = compareRecords({
    domain: 'demo',
    gasRecords: [
      { id: 'duplicate', value: 'A' },
      { id: 'duplicate', value: 'B' }
    ],
    supabaseRecords: [{ id: 'duplicate', value: 'A' }],
    keyOf: row => row.id
  });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].status, STATUS.INVALID_IDENTITY);
  assert.equal(result.items[0].duplicateCounts.gas, 2);
});

test('source-unavailable records are never treated as missing rows', () => {
  const result = compareRecords({
    domain: 'demo',
    sourceStatus: STATUS.SOURCE_UNAVAILABLE,
    sourceError: 'GAS timeout',
    gasRecords: [],
    supabaseRecords: [{ id: 'existing', value: 'S' }],
    keyOf: row => row.id
  });

  assert.equal(result.counts[STATUS.SOURCE_UNAVAILABLE], 1);
  assert.equal(result.items[0].key, '__source__');
  assert.equal(result.items[0].error, 'GAS timeout');
});
