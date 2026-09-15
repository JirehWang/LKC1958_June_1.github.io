import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  cleanupObservabilityLogs,
  RETENTION_MONTHS,
  getExpiredDateKeys,
  getRetentionCutoffDateKey
} from '../scripts/cleanup-observability-logs.mjs';

const repoRoot = process.cwd();

test('retention policy uses a three-calendar-month cutoff and clamps month ends', () => {
  assert.equal(RETENTION_MONTHS, 3);
  assert.equal(
    getRetentionCutoffDateKey(new Date('2026-09-14T12:00:00.000Z')),
    '2026-06-14'
  );
  assert.equal(
    getRetentionCutoffDateKey(new Date('2026-05-31T12:00:00.000Z')),
    '2026-02-28'
  );
});

test('retention cleanup deletes only strictly older valid date buckets', () => {
  assert.deepEqual(
    getExpiredDateKeys([
      '2026-06-13',
      '2026-06-14',
      '2026-05-31',
      'not-a-date',
      '2026-99-99',
      '2026-10-01'
    ], '2026-06-14'),
    ['2026-05-31', '2026-06-13']
  );
});

test('scheduled cleanup requires a service-account secret and the cleanup script', () => {
  const workflow = fs.readFileSync(
    path.join(repoRoot, '.github', 'workflows', 'cleanup-observability-logs.yml'),
    'utf8'
  );
  assert.match(workflow, /FIREBASE_SERVICE_ACCOUNT_JSON/);
  assert.match(workflow, /FIREBASE_DATABASE_URL/);
  assert.match(workflow, /scripts\/cleanup-observability-logs\.mjs/);
  assert.match(workflow, /cron:/);
});

test('cleanup deletes only expired RTDB date buckets and preserves the cutoff date', async () => {
  const requests = [];
  const response = (body = null) => ({
    ok: true,
    status: 200,
    async json() { return body; }
  });
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(input);
    requests.push({ url, init });
    if (init.method === 'DELETE') return response();
    if (url.pathname === '/logs.json') {
      return response({ LKC_Group: true });
    }
    if (url.pathname === '/logs/LKC_Group.json') {
      return response({
        '2026-06-13': true,
        '2026-06-14': true,
        '2026-09-14': true,
        invalid: true
      });
    }
    throw new Error('unexpected request: ' + url.pathname);
  };

  const result = await cleanupObservabilityLogs({
    now: new Date('2026-09-14T12:00:00.000Z'),
    databaseUrl: 'https://example.test',
    accessToken: 'test-access-token',
    fetchImpl
  });

  assert.deepEqual(result.deleted, [{ system: 'LKC_Group', date: '2026-06-13' }]);
  const deleteRequests = requests.filter(request => request.init.method === 'DELETE');
  assert.equal(deleteRequests.length, 1);
  assert.equal(deleteRequests[0].url.pathname, '/logs/LKC_Group/2026-06-13.json');
  assert.equal(deleteRequests[0].init.headers.authorization, 'Bearer test-access-token');
});
