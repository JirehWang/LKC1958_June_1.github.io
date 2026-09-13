const test = require('node:test');
const assert = require('node:assert/strict');

const { AttendanceSupabaseService } = require('../apps/LKC_SundayserviceAttendance/attendance-supabase.js');

test('超過一年的出席統計查詢自動導向線上資料庫 (GAS)', async () => {
  let gasCalledWith = null;

  global.window = {
    churchAPI_original: async (action, payload) => {
      gasCalledWith = { action, payload };
      return { presentCount: 42, details: [] };
    },
    churchAPI: async (action, payload) => {
      gasCalledWith = { action, payload };
      return { presentCount: 42, details: [] };
    },
    _SUPABASE_CONFIG: { url: 'https://fake.supabase.co', anonKey: 'fake' },
    supabase: {
      createClient: () => ({
        from: () => ({
          select: () => ({ order: () => Promise.resolve({ data: [] }) })
        })
      })
    }
  };

  // 1. Single mode 查詢 2 年前日期 (例如 2024-05-12)
  const resSingleOld = await AttendanceSupabaseService.getAttendanceStats({
    mode: 'single',
    type: '台語',
    date: '2024-05-12'
  });

  assert.equal(gasCalledWith.action, 'getAttendanceStats');
  assert.equal(gasCalledWith.payload.date, '2024-05-12');
  assert.equal(resSingleOld.presentCount, 42);

  // 2. Range mode 起始日期為超過 1 年前 (例如 2024-01-01)
  gasCalledWith = null;
  const resRangeOld = await AttendanceSupabaseService.getAttendanceStats({
    mode: 'range',
    type: '華語',
    start: '2024-01-01',
    end: '2026-12-31'
  });

  assert.equal(gasCalledWith.action, 'getAttendanceStats');
  assert.equal(gasCalledWith.payload.start, '2024-01-01');
  assert.equal(resRangeOld.presentCount, 42);
});

test('getMemberManagementData 從線上資料庫 (GAS) 判定狀態以維護歷史出席防刪保護', async () => {
  let gasActionCalled = null;

  global.window = {
    churchAPI_original: async (action) => {
      gasActionCalled = action;
      return {
        members: [
          ['郭懷智', '男', '2026/07/28', '', true, '', '', 'LK00390', '', '小羊'],
          ['一般會友', '女', '2026/01/01', '', false, '', '', 'LK00001', '', '小羊']
        ],
        usageByUid: {
          LK00390: { effective: true },
          LK00001: { effective: false }
        }
      };
    },
    churchAPI: async (action) => {
      gasActionCalled = action;
      return {
        members: [
          ['郭懷智', '男', '2026/07/28', '', true, '', '', 'LK00390', '', '小羊'],
          ['一般會友', '女', '2026/01/01', '', false, '', '', 'LK00001', '', '小羊']
        ],
        usageByUid: {
          LK00390: { effective: true },
          LK00001: { effective: false }
        }
      };
    },
    _SUPABASE_CONFIG: { url: 'https://fake.supabase.co', anonKey: 'fake' },
    supabase: {
      createClient: () => ({
        from: (table) => {
          if (table === 'church_members') {
            return {
              select: () => ({
                order: () => Promise.resolve({
                  data: [
                    { uid: 'LK00390', name: '郭懷智', is_excluded: true, group_name: '' },
                    { uid: 'LK00001', name: '一般會友', is_excluded: false, group_name: '' }
                  ]
                })
              })
            };
          }
          return { select: () => Promise.resolve({ data: [] }) };
        }
      })
    }
  };

  const result = await AttendanceSupabaseService.getMemberManagementData();

  assert.equal(gasActionCalled, 'getMemberManagementData', '必須調用線上資料庫判定狀態');
  assert.equal(result.usageByUid.LK00390.effective, true, '郭懷智在線上資料庫具備歷史出席紀錄，狀態應為 effective: true');
  assert.equal(result.usageByUid.LK00001.effective, false);
});

test('deleteMember 檢查線上資料庫狀態，拒絕刪除線上曾有點名紀錄之有效會友', async () => {
  global.window = {
    churchAPI_original: async (action) => {
      return {
        usageByUid: {
          LK00390: { effective: true }
        }
      };
    },
    churchAPI: async (action) => {
      return {
        usageByUid: {
          LK00390: { effective: true }
        }
      };
    },
    _SUPABASE_CONFIG: { url: 'https://fake.supabase.co', anonKey: 'fake' },
    _RESET_SUPABASE_FOR_TEST: true,
    supabase: {
      createClient: () => ({
        from: (table) => {
          if (table === 'church_members') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () => Promise.resolve({
                    data: { uid: 'LK00390', name: '郭懷智', group_name: '', is_official_member: false }
                  })
                })
              }),
              delete: () => ({ eq: () => Promise.resolve({ error: null }) })
            };
          }
          if (table === 'attendance_records') {
            return {
              select: () => ({
                contains: () => ({
                  limit: () => Promise.resolve({ data: [] })
                })
              })
            };
          }
        }
      })
    }
  };

  await assert.rejects(
    async () => {
      await AttendanceSupabaseService.deleteMember('郭懷智');
    },
    /此會友在線上資料庫中曾有點名紀錄或小組關聯，無法直接刪除/
  );
});
