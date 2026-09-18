const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.join(__dirname, '..');
const scriptPath = path.join(repoRoot, 'scripts', 'migrate_worship_ppt_library_supabase.js');
const source = fs.readFileSync(scriptPath, 'utf8');
const migration = require(scriptPath);

test('PPT Library migration only stores index metadata and grants read access', () => {
  assert.match(source, /worship_ppt_library_index/);
  assert.match(source, /file_id\s+TEXT\s+NOT NULL/);
  assert.match(source, /PRIMARY KEY \(kind, number\)/);
  assert.match(source, /FOR SELECT TO anon, authenticated/);
  assert.doesNotMatch(source, /base64/i);
  assert.doesNotMatch(source, /download_url|storage_url/i);
});

test('PPT Library migration reads database credentials only from supplied environment values', () => {
  assert.throws(
    () => migration.getDatabaseConfig({ SUPABASE_DB_USER: 'user' }),
    /SUPABASE_DB_PASSWORD/
  );
  assert.deepEqual(migration.getDatabaseConfig({
    SUPABASE_DB_USER: 'user',
    SUPABASE_DB_PASSWORD: 'test-only-value',
    SUPABASE_DB_HOST: 'db.example.test',
    SUPABASE_DB_PORT: '6543',
    SUPABASE_DB_NAME: 'postgres'
  }), {
    user: 'user',
    password: 'test-only-value',
    host: 'db.example.test',
    port: 6543,
    database: 'postgres',
    ssl: { rejectUnauthorized: false }
  });
});

test('PPT Library migration accepts the existing Supabase database URL format', () => {
  assert.deepEqual(migration.getDatabaseConfig({
    SUPABASE_DB_URL: 'postgresql://migration-user:migration-password@db.example.test:6543/postgres'
  }), {
    connectionString: 'postgresql://migration-user:migration-password@db.example.test:6543/postgres',
    ssl: { rejectUnauthorized: false }
  });
});

test('PPT Library migration does not connect when imported as a module', () => {
  assert.match(source, /if \(require\.main === module\)/);
});
