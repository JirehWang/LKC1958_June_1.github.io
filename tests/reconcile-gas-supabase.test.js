'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  STATUS,
  buildRequestedWindow,
  normalizeAttendance,
  normalizeMemberGas,
  runAudit
} = require('../scripts/reconcile-gas-supabase.js');

class FakeLedger {
  constructor() {
    this.started = [];
    this.items = [];
    this.repairs = [];
    this.finished = [];
  }

  async startRun(value) {
    this.started.push(value);
  }

  async appendItems(runId, items) {
    this.items.push({ runId, items });
  }

  async enqueueRepairs(runId, items) {
    this.repairs.push({ runId, items });
  }

  async finishRun(runId, summary) {
    this.finished.push({ runId, summary });
  }
}

function identity(value) {
  return value;
}

test('buildRequestedWindow supports an explicit inclusive date range', () => {
  assert.deepEqual(
    buildRequestedWindow({
      from: '2026-01-01',
      to: '2026-01-03'
    }),
    {
      start: '2026-01-01',
      end: '2026-01-03',
      days: 3,
      timeZone: 'Asia/Taipei'
    }
  );
});

test('domain normalizers align GAS array rows with Supabase rows', () => {
  assert.deepEqual(
    normalizeMemberGas(['王小明', '男', '', '備註', 'TRUE', '', '', 'LK0001', 'A組', '核心同工']),
    {
      uid: 'LK0001',
      name: '王小明',
      gender: '男',
      group_name: 'A組',
      role: '核心同工',
      is_excluded: true,
      note: '備註'
    }
  );
  assert.deepEqual(
    normalizeAttendance({
      service_type: '台語',
      date: '2026/09/19',
      present_uids: 'LK0002, LK0001',
      new_friends_male: 0,
      new_friends_female: 1
    }),
    {
      service_type: '台語',
      date: '2026-09-19',
      present_uids: ['LK0001', 'LK0002'],
      new_friends_male: 0,
      new_friends_female: 1
    }
  );
});

test('runAudit writes matched, discrepancy, and source-unavailable records to GAS ledger', async () => {
  const ledger = new FakeLedger();
  const adapters = {
    church_members: {
      domain: 'church_members',
      async load() {
        return {
          gasRecords: [{ id: 'same', value: 'A' }],
          supabaseRecords: [{ id: 'same', value: 'A' }],
          keyOf: row => row.id,
          normalizeGas: identity,
          normalizeSupabase: identity
        };
      }
    },
    attendance_records: {
      domain: 'attendance_records',
      async load() {
        return {
          gasRecords: [{ id: 'gas-only', value: 'A' }],
          supabaseRecords: [],
          keyOf: row => row.id,
          normalizeGas: identity,
          normalizeSupabase: identity
        };
      }
    },
    new_family_cases: {
      domain: 'new_family_cases',
      async load() {
        throw new Error('Supabase timeout');
      }
    }
  };

  const result = await runAudit({
    runId: 'run-test-1',
    window: {
      start: '2025-09-20',
      end: '2026-09-19',
      days: 365,
      timeZone: 'Asia/Taipei'
    },
    domains: ['church_members', 'attendance_records', 'new_family_cases'],
    adapters,
    ledger
  });

  assert.equal(result.summary.matched, 1);
  assert.equal(result.summary.actionable, 1);
  assert.equal(result.summary.sourceUnavailable, 1);
  assert.equal(ledger.started.length, 1);
  assert.equal(ledger.items.length, 1);
  assert.equal(ledger.items[0].items.length, 3);
  assert.equal(ledger.repairs.length, 1);
  assert.equal(ledger.repairs[0].items[0].direction, 'GAS_TO_SUPABASE');
  assert.equal(ledger.finished[0].summary.sourceUnavailable, 1);
  assert.equal(
    result.results.find(item => item.domain === 'new_family_cases').items[0].status,
    STATUS.SOURCE_UNAVAILABLE
  );
});
