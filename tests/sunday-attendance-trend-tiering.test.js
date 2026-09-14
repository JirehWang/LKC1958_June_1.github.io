const test = require('node:test');
const assert = require('node:assert/strict');

const { AttendanceSupabaseService } = require('../apps/LKC_SundayserviceAttendance/attendance-supabase.js');

test('getAttendanceTrend 一年內查詢走純熱路徑 (Supabase <50ms) 且不呼叫 GAS', async () => {
  let gasCalled = false;

  const mockMembers = [
    { uid: 'LK00001', name: '張全勤', gender: '男', group_name: '提摩太小組', is_excluded: false, is_official_member: true },
    { uid: 'LK00002', name: '李衰退', gender: '女', group_name: '芥菜種組', is_excluded: false, is_official_member: true },
    { uid: 'LK00003', name: '王新加入', gender: '男', group_name: '', is_excluded: false, is_official_member: false }
  ];

  // 構造 12 場主日紀錄（每週一場，近 12 週，完全在一年內）
  const now = Date.now();
  const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  const mockRecords = [];

  for (let i = 11; i >= 0; i--) {
    const d = new Date(now - i * ONE_WEEK_MS);
    const y = d.getFullYear();
    const m = ('0' + (d.getMonth() + 1)).slice(-2);
    const day = ('0' + d.getDate()).slice(-2);
    const dateStr = `${y}-${m}-${day}`;

    // 張全勤每場都到
    const uids = ['LK00001'];
    // 李衰退前 9 場都到，近 3 場沒到 (衰退)
    if (i >= 3) {
      uids.push('LK00002');
    }

    mockRecords.push({
      service_type: '台語',
      date: dateStr,
      present_uids: uids,
      new_friends_male: 0,
      new_friends_female: 0
    });
  }

  global.window = {
    _RESET_SUPABASE_FOR_TEST: true,
    churchAPI_original: async (action, payload) => {
      gasCalled = true;
      return null;
    },
    churchAPI: async (action, payload) => {
      gasCalled = true;
      return null;
    },
    _SUPABASE_CONFIG: { url: 'https://fake.supabase.co', anonKey: 'fake' },
    supabase: {
      createClient: () => ({
        from: (table) => {
          if (table === 'church_members') {
            return {
              select: () => Promise.resolve({ data: mockMembers, error: null })
            };
          }
          if (table === 'attendance_records') {
            return {
              select: () => ({
                in: () => ({
                  gte: () => ({
                    lte: () => Promise.resolve({ data: mockRecords, error: null })
                  })
                })
              })
            };
          }
          return {};
        }
      })
    }
  };

  const sixMonthsAgo = new Date(now - 120 * 24 * 60 * 60 * 1000);
  const startStr = sixMonthsAgo.toISOString().slice(0, 10);
  const endStr = new Date(now + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const res = await AttendanceSupabaseService.getAttendanceTrend({
    type: '台語',
    start: startStr,
    end: endStr,
    recentWeeks: 3,
    baseSheet: '會友名單'
  });

  assert.equal(gasCalled, false, '純熱路徑不應呼叫 GAS');
  assert.ok(res.details, '回傳結果必須包含 details 陣列');
  assert.equal(res.sessionsRecent, 3, '近期場次數應為 3 場');
  assert.ok(res.sessionsHistory >= 8, '歷史場次數應至少 8 場');

  // 李衰退應該出現在第一位（衰退指數最高）
  const topDrop = res.details[0];
  assert.equal(topDrop.uid, 'LK00002');
  assert.equal(topDrop.name, '李衰退');
  assert.equal(topDrop.recentRate, 0);
  assert.ok(topDrop.historyRate > 80);
  assert.ok(topDrop.dropScore > 80);
  assert.equal(topDrop.consecutiveMisses, 3);
  assert.equal(topDrop.missingThreeWeeks, true);
  assert.equal(topDrop.warningDesc, '⚠️ 已連續三週未出席');
});

test('getAttendanceTrend 跨年份查詢走冷熱路徑資料彙集 (GAS 冷端 + Supabase 熱端)', async () => {
  let gasActionCalled = null;
  let gasPayloadCalled = null;

  const mockMembers = [
    { uid: 'LK00001', name: '周歷史會友', gender: '男', group_name: '提摩太小組', is_excluded: false, is_official_member: true }
  ];

  // 1. 冷端紀錄（例如 2024 年）
  const coldRecords = [
    { service_type: '華語', date: '2024-03-03', present_uids: ['LK00001'], new_friends_male: 0, new_friends_female: 0 },
    { service_type: '華語', date: '2024-03-10', present_uids: ['LK00001'], new_friends_male: 0, new_friends_female: 0 },
    { service_type: '華語', date: '2024-03-17', present_uids: ['LK00001'], new_friends_male: 0, new_friends_female: 0 }
  ];

  // 2. 熱端紀錄（近 1 年）
  const now = Date.now();
  const hotRecords = [
    { service_type: '華語', date: new Date(now - 14 * 24 * 3600 * 1000).toISOString().slice(0, 10), present_uids: ['LK00001'], new_friends_male: 0, new_friends_female: 0 },
    { service_type: '華語', date: new Date(now - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10), present_uids: ['LK00001'], new_friends_male: 0, new_friends_female: 0 },
    { service_type: '華語', date: new Date(now).toISOString().slice(0, 10), present_uids: ['LK00001'], new_friends_male: 0, new_friends_female: 0 }
  ];

  global.window = {
    _RESET_SUPABASE_FOR_TEST: true,
    churchAPI_original: async (action, payload) => {
      gasActionCalled = action;
      gasPayloadCalled = payload;
      if (action === 'getAttendanceRecords') {
        return coldRecords;
      }
      return null;
    },
    churchAPI: async (action, payload) => {
      gasActionCalled = action;
      gasPayloadCalled = payload;
      if (action === 'getAttendanceRecords') {
        return coldRecords;
      }
      return null;
    },
    _SUPABASE_CONFIG: { url: 'https://fake.supabase.co', anonKey: 'fake' },
    supabase: {
      createClient: () => ({
        from: (table) => {
          if (table === 'church_members') {
            return {
              select: () => Promise.resolve({ data: mockMembers, error: null })
            };
          }
          if (table === 'attendance_records') {
            return {
              select: () => ({
                in: () => ({
                  gte: () => ({
                    lte: () => Promise.resolve({ data: hotRecords, error: null })
                  })
                })
              })
            };
          }
          return {};
        }
      })
    }
  };

  const res = await AttendanceSupabaseService.getAttendanceTrend({
    type: '華語',
    start: '2024-01-01',
    end: '2027-12-31',
    recentWeeks: 3,
    baseSheet: '會友名單'
  });

  assert.equal(gasActionCalled, 'getAttendanceRecords', '跨年份查詢應向 GAS 請求冷紀錄');
  assert.equal(gasPayloadCalled.start, '2024-01-01');
  assert.ok(res, '應成功回傳彙集運算結果');
  assert.ok(res.details, '應包含 details 清單');
});

test('getAttendanceTrend 在 Supabase 未初始化或離線時透明降級調用 GAS getAttendanceTrend', async () => {
  let gasActionCalled = null;

  global.window = {
    _RESET_SUPABASE_FOR_TEST: true,
    churchAPI_original: async (action, payload) => {
      gasActionCalled = action;
      return {
        periodHistory: '2024/01/01 ~ 2024/12/31',
        periodRecent: '2025/01/01 ~ 2025/01/21',
        sessionsHistory: 40,
        sessionsRecent: 3,
        details: []
      };
    },
    churchAPI: async (action, payload) => {
      gasActionCalled = action;
      return {
        periodHistory: '2024/01/01 ~ 2024/12/31',
        periodRecent: '2025/01/01 ~ 2025/01/21',
        sessionsHistory: 40,
        sessionsRecent: 3,
        details: []
      };
    },
    _SUPABASE_CONFIG: null // 模擬 Supabase 離線
  };

  const res = await AttendanceSupabaseService.getAttendanceTrend({
    type: '台語',
    start: '2025-01-01',
    end: '2026-09-15'
  });

  assert.equal(gasActionCalled, 'getAttendanceTrend', 'Supabase 離線時必須透明回退調用 GAS getAttendanceTrend');
  assert.equal(res.sessionsHistory, 40);
  assert.equal(res.sessionsRecent, 3);
});
