const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.join(__dirname, '..');
const dashboardSource = fs.readFileSync(path.join(repoRoot, 'logs.html'), 'utf8');
const loggerSource = fs.readFileSync(path.join(repoRoot, 'firebase', 'firebase-logger.js'), 'utf8');

test('dashboard uses the shared observability registry and grouped view', () => {
  assert.match(dashboardSource, /firebase\/observability-registry\.js/);
  assert.match(dashboardSource, /id="groupSelect"/);
  assert.match(dashboardSource, /id="systemSelect"/);
  assert.match(dashboardSource, /id="sourceSelect"/);
  assert.match(dashboardSource, /id="searchInput"/);
  assert.match(dashboardSource, /class="system-groups hidden"/);
  assert.match(dashboardSource, /function renderGroups\(logs\)/);
  assert.match(dashboardSource, /ERROR_LEVEL_META/);
  assert.doesNotMatch(dashboardSource, /const systems = \[/);
});

test('logger writes the shared event schema without removing legacy observability fields', () => {
  assert.match(loggerSource, /normalizeLogEntry/);
  assert.match(loggerSource, /schemaVersion/);
  assert.match(loggerSource, /fingerprint/);
  assert.match(loggerSource, /cache:/);
  assert.match(loggerSource, /payload:/);
  assert.match(loggerSource, /invalidation:/);
});
