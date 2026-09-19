'use strict';

const fs = require('node:fs');
const { Client } = require('pg');
const { getDatabaseConfig } = require('./migrate_worship_ppt_library_supabase.js');
const {
  DEFAULT_LIBRARY_GAS_URL,
  DEFAULT_RETRY_ATTEMPTS,
  DEFAULT_RETRY_DELAY_MS,
  applyLibrarySync,
  fetchLibraryIndex,
  planLibrarySync,
  readLibraryRows
} = require('./ppt-library-index-sync.js');

function parseArgs(argv) {
  const options = {
    apply: false,
    gasUrl: '',
    retryAttempts: DEFAULT_RETRY_ATTEMPTS,
    retryDelayMs: DEFAULT_RETRY_DELAY_MS
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      if (index + 1 >= argv.length) throw new Error(`${arg} 缺少參數`);
      index += 1;
      return argv[index];
    };

    if (arg === '--apply') options.apply = true;
    else if (arg === '--dry-run') options.apply = false;
    else if (arg === '--gas-url') options.gasUrl = next();
    else if (arg === '--retry-attempts') options.retryAttempts = Number(next());
    else if (arg === '--retry-delay-ms') options.retryDelayMs = Number(next());
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`不認識的參數：${arg}`);
  }

  if (!Number.isInteger(options.retryAttempts) || options.retryAttempts < 1) {
    throw new Error('--retry-attempts 必須是正整數');
  }
  if (!Number.isFinite(options.retryDelayMs) || options.retryDelayMs < 0) {
    throw new Error('--retry-delay-ms 必須是非負數');
  }
  return options;
}

function formatPlan(plan) {
  return [
    `來源索引：${plan.sourceCount} 筆；目前索引：${plan.existingCount} 筆`,
    `新增：${plan.inserted}；更新：${plan.updated}；未變更：${plan.unchanged}；保留舊資料：${plan.preserved}`,
    `同步後預計索引：${plan.projectedCount} 筆`
  ].join('\n');
}

function writeGithubSummary(plan, options = {}, env = process.env, fsImpl = fs) {
  const summaryPath = String(env.GITHUB_STEP_SUMMARY || '').trim();
  if (!summaryPath) return false;
  const mode = options.apply ? 'apply' : 'dry-run';
  fsImpl.appendFileSync(summaryPath, [
    '## PPT Library 索引同步',
    '',
    `執行模式：${mode}`,
    '',
    '| 項目 | 數量 |',
    '| --- | ---: |',
    `| 來源索引 | ${plan.sourceCount} |`,
    `| 新增 | ${plan.inserted} |`,
    `| 更新 | ${plan.updated} |`,
    `| 未變更 | ${plan.unchanged} |`,
    `| 保留舊資料 | ${plan.preserved} |`,
    `| 同步後預計筆數 | ${plan.projectedCount} |`,
    ''
  ].join('\n'));
  return true;
}

function isRetryableDatabaseError(error) {
  const code = String(error && error.code || '').toUpperCase();
  if (/^(08|40|53|57)/.test(code)) return true;
  return /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|connection|temporar|timeout/i.test(
    String(error && error.message || error || '')
  );
}

async function runDatabaseSync(options, env, dependencies = {}, sourceRows) {
  const ClientClass = dependencies.ClientClass || Client;
  const databaseConfig = getDatabaseConfig(env);
  const attempts = Math.max(1, Number(options.retryAttempts || DEFAULT_RETRY_ATTEMPTS));
  const retryDelayMs = Math.max(0, Number(options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS));
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const client = new ClientClass(databaseConfig);
    try {
      await client.connect();
      return options.apply
        ? await applyLibrarySync(client, sourceRows)
        : planLibrarySync(sourceRows, await readLibraryRows(client));
    } catch (error) {
      lastError = error;
      if (!isRetryableDatabaseError(error) || attempt >= attempts) throw error;
      if (retryDelayMs > 0) await new Promise(resolve => setTimeout(resolve, retryDelayMs * attempt));
    } finally {
      await client.end().catch(() => {});
    }
  }

  throw lastError;
}

function printUsage() {
  console.log([
    '用法：node scripts/sync_worship_ppt_library_index.js [選項]',
    '',
    '預設為 dry-run；排程執行時使用 --apply 才會寫入 Supabase。',
    '--apply                 執行只新增／更新的 upsert，不執行刪除',
    '--dry-run               只讀取 GAS 與現有索引並顯示差異（預設）',
    '--gas-url URL           覆寫 Library GAS endpoint',
    '--retry-attempts N      GAS 失敗時的最大嘗試次數（預設 3）',
    '--retry-delay-ms N      重試間隔毫秒數（預設 1000）'
  ].join('\n'));
}

async function main(argv = process.argv.slice(2), dependencies = {}) {
  try {
    require('dotenv').config();
  } catch (error) {
    if (error && error.code !== 'MODULE_NOT_FOUND') throw error;
  }

  const env = dependencies.env || process.env;
  const options = parseArgs(argv);
  if (options.help) {
    printUsage();
    return { options };
  }

  const gasUrl = options.gasUrl || env.PPT_LIBRARY_GAS_URL || DEFAULT_LIBRARY_GAS_URL;
  const rows = await fetchLibraryIndex(
    gasUrl,
    dependencies.fetchImpl || globalThis.fetch,
    {
      env,
      retryAttempts: options.retryAttempts,
      retryDelayMs: options.retryDelayMs
    }
  );

  const plan = await runDatabaseSync(options, env, dependencies, rows);
  console.log(`PPT Library 索引同步（${options.apply ? 'apply' : 'dry-run'}）完成。`);
  console.log(formatPlan(plan));
  writeGithubSummary(plan, options, env, dependencies.fsImpl || fs);
  return { options, rows, plan };
}

if (require.main === module) {
  main().catch(error => {
    console.error(`PPT Library 索引同步失敗：${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  formatPlan,
  isRetryableDatabaseError,
  main,
  parseArgs,
  printUsage,
  runDatabaseSync,
  writeGithubSummary
};
