import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

import {
  OBSERVABILITY_FETCH_MARKER,
  createEndpointFetch,
  createSupabaseClientOptions,
  getEndpointFailureLevel,
  sanitizeEndpoint
} from '../firebase/observability-endpoints.js';

const repoRoot = process.cwd();
const SUPABASE_CLIENT_FILES = [
  'apps/LKC_worship/worship-supabase.js',
  'apps/LKC_MasterSchedule/calendar-supabase.js',
  'apps/LKC_SundayserviceAttendance/attendance-supabase.js',
  'apps/LKC_Group/group-supabase.js',
  'apps/LKC_MinistrySchedule/ministry-supabase.js',
  'apps/LKC_NewFamily/new-family-supabase.js',
  'apps/LKC_SundayBulletin/js/bulletin-supabase.js',
  'apps/LKC_WorshipPPT/worship-ppt-supabase.js'
];

test('endpoint sanitizer strips query, fragments, and credential-like data', () => {
  assert.equal(
    sanitizeEndpoint('https://ioxlptzwpmczsxboggct.supabase.co/rest/v1/groups?select=*&apikey=secret#private'),
    'https://ioxlptzwpmczsxboggct.supabase.co/rest/v1/groups'
  );
  assert.equal(sanitizeEndpoint('data:text/plain,secret'), 'data:[redacted]');
});

test('observed Supabase fetch reports failed responses and preserves the response', async () => {
  const events = [];
  const response = { ok: false, status: 503 };
  const fetcher = createEndpointFetch({
    source: 'supabase',
    system: 'LKC_Group',
    reporter: event => events.push(event),
    fetchImpl: async (input, init) => {
      assert.equal(init[OBSERVABILITY_FETCH_MARKER], 'supabase');
      assert.equal(input, 'https://example.test/rest/v1/groups?select=*&apikey=secret');
      return response;
    }
  });

  const actual = await fetcher(
    'https://example.test/rest/v1/groups?select=*&apikey=secret',
    { method: 'POST' }
  );

  assert.equal(actual, response);
  assert.equal(events.length, 1);
  assert.equal(events[0].system, 'LKC_Group');
  assert.equal(events[0].source, 'supabase');
  assert.equal(events[0].level, 'error');
  assert.equal(events[0].errorType, 'HTTP_503');
  assert.equal(events[0].action, 'supabase.fetch.post');
  assert.equal(events[0].endpoint, 'https://example.test/rest/v1/groups');
  assert.doesNotMatch(JSON.stringify(events[0]), /secret/);
});

test('observed endpoint fetch rethrows network failures and records a safe error', async () => {
  const events = [];
  const failure = new Error('Failed to fetch https://example.test?token=secret');
  const fetcher = createEndpointFetch({
    source: 'gas',
    system: 'LKC_NewFamily',
    reporter: event => events.push(event),
    fetchImpl: async () => { throw failure; }
  });

  await assert.rejects(() => fetcher('https://example.test/exec?token=secret'), failure);
  assert.equal(events.length, 1);
  assert.equal(events[0].source, 'gas');
  assert.equal(events[0].level, 'error');
  assert.equal(events[0].errorType, 'Error');
  assert.doesNotMatch(JSON.stringify(events[0]), /secret/);
});

test('endpoint severity treats retryable 404/429 responses as warnings', () => {
  assert.equal(getEndpointFailureLevel(404), 'warn');
  assert.equal(getEndpointFailureLevel(429), 'warn');
  assert.equal(getEndpointFailureLevel(500), 'error');
});

test('Supabase client options use the shared observed fetch', async () => {
  const events = [];
  const options = createSupabaseClientOptions({
    system: 'LKC_worship',
    reporter: event => events.push(event),
    fetchImpl: async () => ({ ok: false, status: 401 })
  });

  assert.equal(typeof options.global.fetch, 'function');
  await options.global.fetch('https://example.test/rest/v1/schedule');
  assert.equal(events[0].source, 'supabase');
  assert.equal(events[0].system, 'LKC_worship');
  assert.equal(events[0].errorType, 'HTTP_401');
});

test('all Supabase adapters request the shared observability client options', () => {
  for (const relativePath of SUPABASE_CLIENT_FILES) {
    const source = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
    assert.match(source, /__LKC_OBSERVABILITY_SUPABASE_OPTIONS__/,
      `missing observability options hook: ${relativePath}`);
  }
});

test('Supabase config bootstraps options before the async browser collector is ready', () => {
  const source = fs.readFileSync(path.join(repoRoot, 'supabase/supabase-config.js'), 'utf8');
  assert.match(source, /__LKC_OBSERVABILITY_SUPABASE_OPTIONS__/);
  assert.match(source, /source:\s*['"]supabase['"]/);
  assert.match(source, /global:\s*\{\s*fetch:/);
});

test('synchronous Supabase bootstrap reports a failure after the browser observer arrives', async () => {
  const source = fs.readFileSync(path.join(repoRoot, 'supabase/supabase-config.js'), 'utf8');
  let capturedOptions;
  const context = {
    URL,
    console,
    window: {
      location: { href: 'https://example.test/apps/LKC_Group/index.html', pathname: '/apps/LKC_Group/index.html' },
      fetch: async () => ({ ok: false, status: 503 }),
      supabase: {
        createClient(...args) {
          capturedOptions = args[2];
          return {};
        }
      }
    }
  };

  vm.runInNewContext(source, context);
  assert.equal(typeof capturedOptions.global.fetch, 'function');

  const events = [];
  context.window.LKCObservability = {
    reportError(event) {
      events.push(event);
    }
  };
  await capturedOptions.global.fetch('https://example.test/rest/v1/groups?apikey=secret');

  assert.equal(events.length, 1);
  assert.equal(events[0].source, 'supabase');
  assert.equal(events[0].system, 'LKC_Group');
  assert.equal(events[0].errorType, 'HTTP_503');
  assert.equal(events[0].endpoint, 'https://example.test/rest/v1/groups');
  assert.doesNotMatch(JSON.stringify(events[0]), /secret/);
});

test('central GAS logging records its source and endpoint', () => {
  const source = fs.readFileSync(path.join(repoRoot, 'config.js'), 'utf8');
  assert.match(source, /source:\s*['"]gas['"]/);
  assert.match(source, /endpoint:\s*window\.GAS_URL/);
});
