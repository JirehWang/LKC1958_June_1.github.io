import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ERROR_LEVELS,
  OBSERVABILITY_SYSTEMS,
  normalizeLogEntry,
  getSystemDefinition,
  getSystemGroup
} from '../firebase/observability-registry.js';

test('registry includes every application system and platform sources', () => {
  const ids = new Set(OBSERVABILITY_SYSTEMS.map(system => system.id));

  for (const id of [
    'LKC_ChildrenAttendance',
    'LKC_Group',
    'LKC_MasterSchedule',
    'LKC_MemberStatus',
    'LKC_MinistrySchedule',
    'LKC_NewFamily',
    'LKC_Offering',
    'LKC_ppt_generator',
    'LKC_PrayerPPT',
    'LKC_SundayBulletin',
    'LKC_SundayserviceAttendance',
    'LKC_TaiwaneseAudioBible',
    'LKC_WhosCar',
    'LKC_worship',
    'LKC_WorshipPPT',
    'qrcodescanner.github.io',
    'firebase',
    'supabase',
    'github-actions'
  ]) {
    assert.equal(ids.has(id), true, `missing registry entry: ${id}`);
  }
});

test('log entries normalize to the shared severity and source contract', () => {
  const event = normalizeLogEntry({
    system: 'LKC_Group',
    level: 'config.js',
    source: 'config.js',
    environment: 'prod',
    errorType: 'GAS_NON_SUCCESS',
    action: 'getGroups',
    message: 'Request failed',
    durationMs: '125',
    meta: { requestId: 'req-1' }
  }, { now: new Date('2026-09-14T01:02:03.000Z') });

  assert.equal(event.schemaVersion, 1);
  assert.equal(event.system, 'LKC_Group');
  assert.equal(event.level, 'info');
  assert.equal(event.source, 'api');
  assert.equal(event.environment, 'production');
  assert.equal(event.durationMs, 125);
  assert.equal(event.time, '2026-09-14T01:02:03.000Z');
  assert.match(event.fingerprint, /^fp_[0-9a-f]{8}$/);
  assert.equal(getSystemDefinition(event.system).group, 'attendance');
  assert.equal(getSystemGroup(event.system).id, 'attendance');
});

test('unknown values remain visible without breaking the dashboard contract', () => {
  const event = normalizeLogEntry({
    system: 'external/new-system',
    level: 'fatal',
    source: 'worker',
    message: 'Unknown failure'
  }, { now: new Date('2026-09-14T01:02:03.000Z') });

  assert.equal(event.system, 'external_new-system');
  assert.equal(event.level, ERROR_LEVELS.info);
  assert.equal(event.source, 'unknown');
  assert.equal(getSystemDefinition(event.system).group, 'unknown');
});

test('system IDs with Firebase-incompatible characters keep a safe storage key', () => {
  const event = normalizeLogEntry({
    system: 'qrcodescanner.github.io',
    level: 'error',
    source: 'ui',
    message: 'Scanner failed'
  });

  assert.equal(event.system, 'qrcodescanner.github.io');
  assert.equal(event.systemStorageKey, 'qrcodescanner_github_io');
  assert.equal(getSystemDefinition('qrcodescanner_github_io').id, 'qrcodescanner.github.io');
});
