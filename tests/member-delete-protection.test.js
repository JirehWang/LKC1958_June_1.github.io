const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const projectRoot = path.resolve(__dirname, '..');
const memberDbPath = 'D:/program/LKC/主日出席_測試版/MemberDB.js';
const corePath = 'D:/program/LKC/主日出席_測試版/Core.js';
const memberUiPath = path.join(
  projectRoot,
  'apps',
  'LKC_SundayserviceAttendance',
  'members.html'
);

function makeSheet(name, values) {
  return {
    name,
    values,
    deletedRows: [],
    getName() {
      return this.name;
    },
    getLastRow() {
      return this.values.length;
    },
    getLastColumn() {
      return this.values.reduce((max, row) => Math.max(max, row.length), 0);
    },
    getDataRange() {
      return {
        getValues: () => this.values.map(row => row.slice()),
      };
    },
    getRange(row, column, rowCount, columnCount) {
      return {
        getValues: () => this.values
          .slice(row - 1, row - 1 + rowCount)
          .map(sourceRow => Array.from(
            { length: columnCount },
            (_, index) => sourceRow[column - 1 + index] ?? ''
          )),
      };
    },
    deleteRow(row) {
      this.deletedRows.push(row);
    },
  };
}

function makeSpreadsheet(sheets) {
  return {
    getSheets() {
      return sheets;
    },
    getSheetByName(name) {
      return sheets.find(sheet => sheet.getName() === name) || null;
    },
  };
}

function memberRow(name, uid, group = '') {
  return [
    name,
    '男',
    '2026/1/1',
    '',
    false,
    '2026/1/1',
    '',
    uid,
    '',
    group,
    '小羊',
  ];
}

function loadMemberDb() {
  const memberSheet = makeSheet('會友名單', [
    ['姓名', '性別', '建立日期', '備註', '不列入統計', '異動日期', '異動紀錄', '系統編號', 'QR Code', '所屬小組', '身分'],
    memberRow('主日已點名', 'LK00001'),
    memberRow('仍在小組', 'LK00002'),
    memberRow('小組出席', 'LK00003'),
    memberRow('小組缺席', 'LK00004'),
    memberRow('主檔有小組', 'LK00005', '恩典小組'),
    memberRow('可刪除', 'LK00006'),
  ]);
  const sundayAttendance = makeSheet('華語點名紀錄', [
    ['日期', '名單', '新朋友(男)', '新朋友(女)'],
    ['2026/7/26', 'LK00001', 0, 0],
  ]);
  const groupList = makeSheet('恩典小組_名單', [
    ['姓名', '建立日期', '身分', '系統編號', '排序', '暱稱'],
    ['仍在小組', '2026/1/1', '小羊', 'LK00002', 1, ''],
  ]);
  const groupAttendance = makeSheet('恩典小組_點名紀錄', [
    ['日期', '出席人員', '缺席人員', '新朋友', '實到人數'],
    ['2026/7/25', 'LK00003', 'LK00004', '', 1],
  ]);
  const mainSs = makeSpreadsheet([memberSheet, sundayAttendance]);
  const groupSs = makeSpreadsheet([groupList, groupAttendance]);
  const cachedMembers = memberSheet.values.slice(1).map(row => [
    row[0],
    row[1],
    row[2],
    row[3],
    row[4],
    row[5],
    row[6],
    row[7],
    row[9],
    row[10],
  ]);
  const context = vm.createContext({
    console,
    MEMBER_SHEET: '會友名單',
    getSS: () => mainSs,
    getGroupSS: () => groupSs,
    getCachedMembers: () => cachedMembers,
    invalidateAndRebuildMemberCache() {},
    firebaseInvalidate() {},
    LockService: {
      getScriptLock() {
        return {
          waitLock() {},
          releaseLock() {},
        };
      },
    },
  });

  vm.runInContext(fs.readFileSync(memberDbPath, 'utf8'), context, {
    filename: memberDbPath,
  });

  return { context, memberSheet };
}

test('usage map protects Sunday attendance and group membership without reading group attendance history', () => {
  const { context } = loadMemberDb();
  const usage = context.getMemberUsageStatusMap();

  assert.equal(usage.LK00001.effective, true);
  assert.equal(usage.LK00001.hasAttendance, true);
  assert.equal(usage.LK00002.inGroup, true);
  assert.equal(usage.LK00003, undefined);
  assert.equal(usage.LK00004, undefined);
  assert.equal(usage.LK00005.inGroup, true);
  assert.equal(usage.LK00006, undefined);
});

test('deleteMember refuses effective members but still deletes an unused member', () => {
  const { context, memberSheet } = loadMemberDb();

  const protectedResult = context.deleteMember('主日已點名');
  assert.match(protectedResult, /無法刪除/);
  assert.match(protectedResult, /不統計/);
  assert.deepEqual(memberSheet.deletedRows, []);

  const deletableResult = context.deleteMember('可刪除');
  assert.match(deletableResult, /成功刪除/);
  assert.deepEqual(memberSheet.deletedRows, [7]);
});

test('member management API returns usage metadata for the UI', () => {
  const { context } = loadMemberDb();
  const result = context.getMemberManagementData();
  const coreSource = fs.readFileSync(corePath, 'utf8');

  assert.equal(result.members.length, 6);
  assert.equal(result.usageByUid.LK00002.effective, true);
  assert.equal(result.usageByUid.LK00006, undefined);
  assert.match(coreSource, /case 'getMemberManagementData'/);
});

test('member list renders effective status and disables delete for protected rows', () => {
  const source = fs.readFileSync(memberUiPath, 'utf8');

  assert.match(source, /\.getMemberManagementData\(\)/);
  assert.match(source, /usage\.effective/);
  assert.match(source, />有效</);
  assert.match(source, /disabled/);
  assert.match(source, /僅可改為不統計/);
});
