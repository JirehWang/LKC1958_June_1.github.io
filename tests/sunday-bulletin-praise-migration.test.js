const assert = require('node:assert/strict');
const test = require('node:test');

const { buildMigrationSql } = require('../scripts/migrate_sunday_bulletin_praise_uuid.js');

test('praise UUID migration preserves title data and switches identity to song_id', () => {
  const sql = buildMigrationSql();

  assert.match(sql, /add column if not exists song_id uuid/i);
  assert.match(sql, /gen_random_uuid\(\)/i);
  assert.match(sql, /set not null/i);
  assert.match(sql, /primary key \(song_id\)/i);
  assert.match(sql, /deleted_at timestamptz/i);
  assert.match(sql, /deleted_by text/i);
  assert.match(sql, /unique index[\s\S]+lower\(btrim\(title\)\)[\s\S]+where deleted_at is null/i);
  assert.doesNotMatch(sql, /create policy/i);
  assert.doesNotMatch(sql, /grant select, insert, update/i);
  assert.doesNotMatch(sql, /delete from public\.sunday_bulletin_praise_titles/i);
});
