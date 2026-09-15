import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  buildObservabilityEvent,
  detectSystemFromPath,
  installBrowserObservability
} from '../firebase/observability-browser.js';

const repoRoot = path.join(process.cwd());
const DIRECT_BROWSER_PAGES = [
  'apps/LKC_ChildrenAttendance/attendance.html',
  'apps/LKC_ChildrenAttendance/Chart.html',
  'apps/LKC_ChildrenAttendance/members.html',
  'apps/LKC_ChildrenAttendance/STATS.html',
  'apps/LKC_MasterSchedule/board.html',
  'apps/LKC_MasterSchedule/index.html',
  'apps/LKC_MinistrySchedule/ministry-schedule-simple-architecture.html',
  'apps/LKC_MinistrySchedule/verse_view.html',
  'apps/LKC_ppt_generator/index.html',
  'apps/LKC_SundayBulletin/index.html',
  'apps/LKC_SundayBulletin/praise.html',
  'apps/LKC_SundayserviceAttendance/agm_attendance.html',
  'apps/LKC_SundayserviceAttendance/agm_viewer.html',
  'apps/LKC_SundayserviceAttendance/attendance.html',
  'apps/LKC_SundayserviceAttendance/Chart.html',
  'apps/LKC_SundayserviceAttendance/members.html',
  'apps/LKC_SundayserviceAttendance/STATS.html',
  'apps/LKC_TaiwaneseAudioBible/index.html',
  'apps/qrcodescanner.github.io/index.html'
];

test('browser event builder redacts secrets from messages, endpoints, and metadata', () => {
  const event = buildObservabilityEvent({
    system: 'LKC_Group',
    level: 'error',
    source: 'unhandled',
    action: 'unhandledrejection',
    message: 'Bearer super-secret token=abc123',
    endpoint: 'https://example.test/data?access_token=abc123&name=group',
    meta: {
      password: 'hidden-password',
      nested: { apiKey: 'hidden-api-key' }
    }
  }, { now: new Date('2026-09-14T01:02:03.000Z') });

  const serialized = JSON.stringify(event);
  assert.equal(event.system, 'LKC_Group');
  assert.equal(event.source, 'unhandled');
  assert.equal(event.level, 'error');
  assert.equal(event.time, '2026-09-14T01:02:03.000Z');
  assert.match(event.endpoint, /https:\/\/example\.test\/data/);
  assert.doesNotMatch(serialized, /super-secret|abc123|hidden-password|hidden-api-key/);
  assert.equal(buildObservabilityEvent({ endpoint: 'data:text/plain,secret-value' }).endpoint, 'data:[redacted]');
});

test('system detection uses the app directory and supports qrcode app paths', () => {
  assert.equal(
    detectSystemFromPath('/LKC1958_June_1.github.io/apps/LKC_Group/index.html'),
    'LKC_Group'
  );
  assert.equal(
    detectSystemFromPath('/LKC1958_June_1.github.io/apps/qrcodescanner.github.io/index.html'),
    'qrcodescanner.github.io'
  );
  assert.equal(detectSystemFromPath('/logs.html'), 'unknown');
});

test('direct browser pages load the collector exactly once', () => {
  for (const relativePath of DIRECT_BROWSER_PAGES) {
    const source = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
    const matches = source.match(/firebase\/observability-browser\.js/g) || [];
    assert.equal(matches.length, 1, `collector injection mismatch: ${relativePath}`);
  }
});

test('central config enables global capture without wrapping churchAPI fetches', () => {
  const source = fs.readFileSync(path.join(repoRoot, 'config.js'), 'utf8');
  assert.match(source, /__LKC_OBSERVABILITY_CONFIG__/);
  assert.match(source, /captureFetch: false/);
  assert.match(source, /observability-browser\.js/);
  assert.match(source, /source: meta\.source \|\| 'config\.js'/);
});

test('direct collector reports failed fetches while preserving the original response', async () => {
  const events = [];
  const listeners = {};
  const originalWindow = globalThis.window;
  const originalLocation = globalThis.location;
  const response = { ok: false, status: 503 };

  globalThis.window = {
    location: { pathname: '/apps/LKC_Group/index.html', search: '', hostname: 'example.test', protocol: 'https:' },
    console: { error() {}, warn() {} },
    addEventListener(type, handler) { listeners[type] = handler; },
    churchLog(event) { events.push(event); },
    fetch: async () => response
  };
  globalThis.location = globalThis.window.location;

  try {
    const api = installBrowserObservability({ system: 'LKC_Group', captureConsole: false, captureFetch: true });
    const actual = await globalThis.window.fetch('https://api.example.test/groups?access_token=secret');
    assert.equal(actual, response);
    assert.equal(events.length, 1);
    assert.equal(events[0].source, 'api');
    assert.equal(events[0].level, 'error');
    assert.match(events[0].endpoint, /https:\/\/api\.example\.test\/groups/);
    assert.doesNotMatch(JSON.stringify(events[0]), /secret/);
    assert.equal(api.system, 'LKC_Group');
    assert.equal(typeof listeners.error, 'function');
    assert.equal(typeof listeners.unhandledrejection, 'function');
  } finally {
    globalThis.window = originalWindow;
    globalThis.location = originalLocation;
  }
});

test('collector rate-limits repeated equivalent events', () => {
  const events = [];
  const originalWindow = globalThis.window;
  const originalLocation = globalThis.location;

  globalThis.window = {
    location: { pathname: '/apps/LKC_Group/index.html', search: '', hostname: 'example.test', protocol: 'https:' },
    console: { error() {}, warn() {} },
    addEventListener() {},
    churchLog(event) { events.push(event); }
  };
  globalThis.location = globalThis.window.location;

  try {
    const api = installBrowserObservability({ system: 'LKC_Group', captureConsole: false, captureFetch: false });
    for (let index = 0; index < 10; index += 1) {
      api.reportError({ source: 'api', action: 'retry', errorType: 'HTTP_503', level: 'error', message: 'Supabase unavailable' });
    }
    assert.equal(events.length, 6);
  } finally {
    globalThis.window = originalWindow;
    globalThis.location = originalLocation;
  }
});
