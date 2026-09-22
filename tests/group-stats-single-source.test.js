const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('小組統計使用主日點名的單一統計服務', () => {
  const groupHtml = readRepoFile('apps/LKC_Group/group.html');
  const groupSupabase = readRepoFile('apps/LKC_Group/group-supabase.js');
  const groupGas = readRepoFile('scratch_gas_sunday/GroupStatistics.js').replace(/\r\n/g, '\n');

  assert.match(
    groupHtml,
    /LKC_SundayserviceAttendance[\\/]attendance-supabase\.js/,
    '小組頁面應載入主日點名統計服務'
  );
  assert.match(
    groupSupabase,
    /AttendanceSupabaseService\.getAttendanceStats/,
    'Supabase 小組統計應委派給主日統計服務'
  );

  const statsStart = groupSupabase.indexOf('async getStats(payload = {})');
  const statsEnd = groupSupabase.indexOf('async getAllGroupsStats', statsStart);
  assert.ok(statsStart >= 0 && statsEnd > statsStart, '找不到小組 getStats 實作');
  const statsSource = groupSupabase.slice(statsStart, statsEnd);
  assert.doesNotMatch(
    statsSource,
    /from\(['"]attendance_records['"]\)/,
    '小組 getStats 不應自行查詢主日點名資料'
  );

  const gasStart = groupGas.indexOf('function _grpFetchSundayDataEngine');
  const gasEnd = groupGas.indexOf('/**\n * 取得單一小組統計', gasStart);
  assert.ok(gasStart >= 0 && gasEnd > gasStart, '找不到 GAS 小組主日統計函式');
  const gasSource = groupGas.slice(gasStart, gasEnd);
  assert.match(gasSource, /getAttendanceStats/, 'GAS 備援路徑應委派給主日統計服務');
  assert.doesNotMatch(gasSource, /getSheets\(\)/, 'GAS 備援路徑不應自行掃描主日工作表');
});
