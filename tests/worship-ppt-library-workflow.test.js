const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workflowPath = path.join(__dirname, '..', '.github', 'workflows', 'sync-worship-ppt-library.yml');

test('PPT Library sync workflow is scheduled and manually triggerable', () => {
  const source = fs.existsSync(workflowPath) ? fs.readFileSync(workflowPath, 'utf8') : '';
  assert.ok(source, 'sync workflow must exist');
  assert.match(source, /schedule:/);
  assert.match(source, /cron:/);
  assert.match(source, /workflow_dispatch:/);
  assert.match(source, /sync_worship_ppt_library_index\.js\s+--apply/);
});

test('PPT Library sync workflow uses secrets and does not run migration', () => {
  const source = fs.readFileSync(workflowPath, 'utf8');
  assert.match(source, /PPT_LIBRARY_GAS_URL:\s*\$\{\{\s*secrets\.PPT_LIBRARY_GAS_URL\s*\}\}/);
  assert.match(source, /PPT_LIBRARY_GAS_TOKEN:\s*\$\{\{\s*secrets\.PPT_LIBRARY_GAS_TOKEN\s*\}\}/);
  assert.match(source, /SUPABASE_DB_URL:\s*\$\{\{\s*secrets\.SUPABASE_DB_URL\s*\}\}/);
  assert.doesNotMatch(source, /migrate_worship_ppt_library_supabase/);
});
