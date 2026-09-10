const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'scripts', 'migrate_sunday_bulletin_supabase.js'),
  'utf8'
);
const migration = require(path.join(__dirname, '..', 'scripts', 'migrate_sunday_bulletin_supabase.js'));

test('Supabase migration reads database credentials only from environment variables', () => {
  assert.match(source, /env\s*=\s*process\.env/);
  assert.match(source, /env\.SUPABASE_DB_USER/);
  assert.match(source, /env\.SUPABASE_DB_PASSWORD/);
  assert.match(source, /env\.SUPABASE_DB_HOST/);
  assert.doesNotMatch(source, /password\s*:\s*["'][^"']+["']/i);
  assert.doesNotMatch(source, /user\s*:\s*["']postgres\./i);
});

test('Supabase migration does not connect when imported as a module', () => {
  assert.match(source, /if\s*\(require\.main\s*===\s*module\)\s*migrate\(\)/);
});

test('Supabase migration validates and builds the connection config from supplied environment values', () => {
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
