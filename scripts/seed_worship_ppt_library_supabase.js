'use strict';

const { Client } = require('pg');
const { getDatabaseConfig, migrate } = require('./migrate_worship_ppt_library_supabase.js');
const sync = require('./ppt-library-index-sync.js');

function fetchLibraryIndex(gasUrl, fetchImpl = globalThis.fetch, options = {}) {
  return sync.fetchLibraryIndex(gasUrl, fetchImpl, options);
}

async function upsertLibraryRows(client, rows) {
  return sync.upsertLibraryRows(client, rows, { updatedBy: sync.SEED_UPDATED_BY });
}

async function seedLibraryRows(rows, env = process.env) {
  const client = new Client(getDatabaseConfig(env));
  await client.connect();
  try {
    await client.query('BEGIN');
    const count = await upsertLibraryRows(client, rows);
    await client.query('COMMIT');
    return count;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end().catch(() => {});
  }
}

async function main() {
  try {
    require('dotenv').config();
  } catch (error) {
    if (error && error.code !== 'MODULE_NOT_FOUND') throw error;
  }

  const gasUrl = process.env.PPT_LIBRARY_GAS_URL || sync.DEFAULT_LIBRARY_GAS_URL;
  const rows = await fetchLibraryIndex(gasUrl, globalThis.fetch, { env: process.env });
  const counts = rows.reduce((result, row) => {
    result[row.kind] = (result[row.kind] || 0) + 1;
    return result;
  }, {});
  console.log(`從 Library GAS 取得 ${rows.length} 筆索引：${JSON.stringify(counts)}`);

  if (!process.argv.includes('--apply')) {
    console.log('Dry-run：未寫入 Supabase。若確認資料正確，請加上 --apply。');
    return;
  }

  await migrate();
  const count = await seedLibraryRows(rows);
  console.log(`Supabase PPT Library 索引已寫入 ${count} 筆。`);
}

if (require.main === module) {
  main().catch(error => {
    console.error('Supabase PPT Library seed failed:', error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_LIBRARY_GAS_URL: sync.DEFAULT_LIBRARY_GAS_URL,
  extractIndexRows: sync.extractIndexRows,
  fetchLibraryIndex,
  normalizeLibraryNumber: sync.normalizeLibraryNumber,
  normalizeLibraryRow: sync.normalizeLibraryRow,
  normalizeLibraryRows: sync.normalizeLibraryRows,
  parseJsonpPayload: sync.parseJsonpPayload,
  seedLibraryRows,
  upsertLibraryRows
};
