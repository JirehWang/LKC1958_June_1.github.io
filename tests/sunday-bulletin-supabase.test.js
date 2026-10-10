const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const repoRoot = path.join(__dirname, '..');

// Helper to load SundayBulletinSupabaseService in a sandbox
function loadSupabaseService(mockClient, extras = {}) {
  const source = fs.readFileSync(
    path.join(repoRoot, 'apps', 'LKC_SundayBulletin', 'js', 'bulletin-supabase.js'),
    'utf8'
  );
  const context = {
    globalThis: {},
    module: { exports: {} },
    exports: {},
    console,
    URL,
    ...extras
  };
  context.globalThis = context;
  if (mockClient) {
    context._supabase = mockClient;
  }
  vm.createContext(context);
  vm.runInContext(source, context);
  const service = context.module.exports || context.SundayBulletinSupabaseService;
  if (mockClient) {
    service.setClient(mockClient);
  }
  return service;
}

// Helper to create an in-memory mock Supabase client
function createMockSupabaseClient() {
  const store = {
    sunday_bulletins: new Map(),
    sunday_bulletin_reports: new Map(),
    sunday_bulletin_praise: new Map(),
    sunday_bulletin_praise_titles: new Map()
  };

  let nextSongId = 1;
  const newSongId = () => `00000000-0000-0000-0000-${String(nextSongId++).padStart(12, '0')}`;
  const findKey = (table, column, value) => {
    for (const [key, row] of table.entries()) {
      if (String(row?.[column] ?? '') === String(value ?? '')) return key;
    }
    return null;
  };

  const client = {
    _store: store,
    from(tableName) {
      const table = store[tableName] || new Map();
      return {
        upsert(row, opts) {
          const rows = Array.isArray(row) ? row : [row];
          rows.forEach(item => {
            if (tableName === 'sunday_bulletin_praise_titles') {
              const existingKey = findKey(table, 'title', item.title);
              const existing = existingKey == null ? null : table.get(existingKey);
              const stored = {
                ...existing,
                ...item,
                song_id: existing?.song_id || item.song_id || newSongId(),
                deleted_at: item.deleted_at ?? existing?.deleted_at ?? null
              };
              if (existingKey != null) table.delete(existingKey);
              table.set(stored.title, stored);
              return;
            }
            const key = item.date;
            table.set(key, { ...item });
          });
          const storedRows = rows.map(item => {
            const key = tableName === 'sunday_bulletin_praise_titles' ? item.title : item.date;
            return table.get(key);
          });
          return {
            select() {
              return Promise.resolve({ data: storedRows, error: null });
            },
            then(resolve) {
              return Promise.resolve({ data: storedRows, error: null }).then(resolve);
            }
          };
        },
        update(values) {
          return {
            eq(col, val) {
              const existingKey = tableName === 'sunday_bulletin_praise_titles'
                ? findKey(table, col, val)
                : table.has(val) ? val : null;
              const existing = existingKey == null ? null : table.get(existingKey);
              const updated = existing ? { ...existing, ...values } : null;
              if (existing) {
                table.delete(existingKey);
                const nextKey = tableName === 'sunday_bulletin_praise_titles'
                  ? updated.title
                  : updated.date;
                table.set(nextKey, updated);
              }
              return {
                select() {
                  return Promise.resolve({
                    data: updated ? [{ ...updated }] : [],
                    error: null
                  });
                }
              };
            }
          };
        },
        select(fields) {
          return {
            eq(col, val) {
              return {
                async maybeSingle() {
                  const key = tableName === 'sunday_bulletin_praise_titles'
                    ? findKey(table, col, val)
                    : table.has(val) ? val : null;
                  const item = key == null ? null : table.get(key);
                  return { data: item ? { ...item } : null, error: null };
                },
                is(nextCol, nextVal) {
                  const rows = Array.from(table.values()).filter((item) => (
                    item[col] === val && item[nextCol] === nextVal
                  ));
                  return Promise.resolve({ data: rows, error: null });
                },
                then(resolve) {
                  const rows = Array.from(table.values()).filter((item) => item[col] === val);
                  return Promise.resolve({ data: rows, error: null }).then(resolve);
                }
              };
            },
            is(col, val) {
              const items = Array.from(table.values()).filter((item) => item[col] === val);
              return {
                order(orderCol, opts) {
                  items.sort((a, b) => (a[orderCol] || '').localeCompare(b[orderCol] || ''));
                  if (opts && opts.ascending === false) items.reverse();
                  return Promise.resolve({ data: items, error: null });
                },
                then(resolve) {
                  return Promise.resolve({ data: items, error: null }).then(resolve);
                }
              };
            },
            order(col, opts) {
              const items = Array.from(table.values()).filter((item) => item.deleted_at == null);
              if (opts && opts.ascending === false) {
                items.sort((a, b) => (b[col] || '').localeCompare(a[col] || ''));
              } else {
                items.sort((a, b) => (a[col] || '').localeCompare(b[col] || ''));
              }
              return Promise.resolve({ data: items, error: null });
            }
          };
        },
        delete() {
          return {
            eq(col, val) {
              table.delete(val);
              return Promise.resolve({ error: null });
            }
          };
        }
      };
    }
  };

  return client;
}

// Helper to load DraftManager
function loadDraftManager({ supabaseService, gasSyncUrl, localStore = {} }) {
  const source = fs.readFileSync(
    path.join(repoRoot, 'apps', 'LKC_SundayBulletin', 'js', 'draft.js'),
    'utf8'
  );

  const storage = { ...localStore };
  const mockLocalStorage = {
    getItem(k) { return Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null; },
    setItem(k, v) { storage[k] = String(v); },
    removeItem(k) { delete storage[k]; },
    _store: storage
  };

  const gasCalls = [];
  const mockFetch = async (url, opts) => {
    gasCalls.push({ url, opts });
    return {
      ok: true,
      async json() {
        return { success: true, drafts: [], updatedAt: new Date().toISOString() };
      }
    };
  };

  const context = {
    window: {},
    CONFIG: {
      DRAFT_KEY_PREFIX: 'bulletin_draft_',
      MAX_DRAFTS: 10,
      AUTO_SAVE_INTERVAL: 60000,
      GAS_SYNC_URL: gasSyncUrl || ''
    },
    SundayBulletinSupabaseService: supabaseService,
    localStorage: mockLocalStorage,
    fetch: mockFetch,
    debug() {},
    console,
    module: { exports: {} },
    exports: {}
  };
  context.window = context;

  vm.createContext(context);
  vm.runInContext(source, context);
  const manager = context.module.exports || context.DraftManager;
  return { manager, mockLocalStorage, gasCalls };
}

// Helper to load WorshipPPT bulletin-content
function loadBulletinContentService(mockSupabase) {
  globalThis._supabase = mockSupabase;
  return require(path.join(repoRoot, 'apps', 'LKC_WorshipPPT', 'bulletin-content.js'));
}

// ============================================================
// TESTS
// ============================================================

test('SundayBulletinSupabaseService handles bulletin CRUD operations', async () => {
  const mockClient = createMockSupabaseClient();
  const service = loadSupabaseService(mockClient);

  // Missing date should throw
  await assert.rejects(
    async () => await service.saveBulletin({}),
    /缺少主日日期/
  );

  const testBulletin = {
    date: '2026-09-13',
    serviceType: '台華語',
    taiwanese: { sermonTitle: '主的恩典' },
    mandarin: { sermonTitle: '主的恩典' },
    announcements: ['消息一'],
    churchNews: ['教界一'],
    prayer: { homeRest: '陳弟兄' }
  };

  // 1. Save
  const saveRes = await service.saveBulletin(testBulletin);
  assert.equal(saveRes.success, true);
  assert.equal(saveRes.location, 'supabase');
  assert.equal(saveRes.date, '2026-09-13');

  // 2. Load
  const loaded = await service.loadBulletin('2026-09-13');
  assert.ok(loaded);
  assert.equal(loaded.date, '2026-09-13');
  assert.equal(loaded.taiwanese.sermonTitle, '主的恩典');
  assert.deepEqual(loaded.announcements, ['消息一']);

  // 3. List
  const list = await service.listBulletins();
  assert.equal(list.length, 1);
  assert.equal(list[0].date, '2026-09-13');
  assert.equal(list[0].preview, '主的恩典');

  // 4. Delete
  const delRes = await service.deleteBulletin('2026-09-13');
  assert.equal(delRes.success, true);
  const afterDelete = await service.loadBulletin('2026-09-13');
  assert.equal(afterDelete, null);
});

test('SundayBulletinSupabaseService handles reports and praise upload CRUD', async () => {
  const mockClient = createMockSupabaseClient();
  const service = loadSupabaseService(mockClient);

  // Reports
  await service.saveReports('2026-09-13', {
    announcements: ['報告1', '報告2'],
    churchNews: ['消息1'],
    prayer: { hospital: '林長老' }
  });

  const reports = await service.loadReports('2026-09-13');
  assert.ok(reports);
  assert.equal(reports.date, '2026-09-13');
  assert.deepEqual(reports.announcements, ['報告1', '報告2']);
  assert.equal(reports.prayer.hospital, '林長老');

  // Praise
  await service.savePraise('2026-09-13', {
    title: '奇異恩典',
    kicker: '聖歌隊',
    lyrics: '奇異恩典，何等甘甜'
  });

  const praise = await service.loadPraise('2026-09-13');
  assert.ok(praise);
  assert.equal(praise.date, '2026-09-13');
  assert.equal(praise.title, '奇異恩典');
  assert.equal(praise.kicker, '聖歌隊');
  assert.equal(praise.lyrics, '奇異恩典，何等甘甜');
});

test('SundayBulletinSupabaseService keeps a permanent title-only praise index', async () => {
  const mockClient = createMockSupabaseClient();
  const service = loadSupabaseService(mockClient);

  await service.savePraiseTitles(['早期仍然有效的歌曲', '近期歌曲', '近期歌曲']);

  const songs = await service.listPraiseTitles();
  const storedOldRecord = mockClient._store.sunday_bulletin_praise_titles.get('早期仍然有效的歌曲');

  assert.equal(songs.length, 2);
  assert.deepEqual(songs.map(song => song.title), ['早期仍然有效的歌曲', '近期歌曲']);
  assert.equal('date' in storedOldRecord, false);
  assert.equal('lyrics' in storedOldRecord, false);
  assert.equal('kicker' in storedOldRecord, false);
  assert.equal('raw_data' in storedOldRecord, false);
  assert.equal(typeof songs[0].updatedAt, 'string');
});

test('SundayBulletinSupabaseService renames an existing praise title index row', async () => {
  const mockClient = createMockSupabaseClient();
  mockClient._store.sunday_bulletin_praise_titles.set('錯誤歌名', {
    song_id: '11111111-1111-1111-1111-111111111111',
    title: '錯誤歌名',
    updated_at: '2026-10-10T00:00:00.000Z',
    updated_by: 'test'
  });
  const service = loadSupabaseService(mockClient);

  const result = await service.renamePraiseTitle(
    '11111111-1111-1111-1111-111111111111',
    '正確歌名',
    'test'
  );

  assert.equal(result.success, true);
  assert.equal(mockClient._store.sunday_bulletin_praise_titles.has('錯誤歌名'), false);
  assert.equal(
    mockClient._store.sunday_bulletin_praise_titles.get('正確歌名').title,
    '正確歌名'
  );
  assert.equal(
    mockClient._store.sunday_bulletin_praise_titles.get('正確歌名').song_id,
    '11111111-1111-1111-1111-111111111111'
  );
  assert.equal(mockClient._store.sunday_bulletin_praise_titles.size, 1);
});

test('SundayBulletinSupabaseService returns stable UUIDs and soft-deletes by UUID', async () => {
  const mockClient = createMockSupabaseClient();
  const service = loadSupabaseService(mockClient);

  const requestedSongId = '22222222-2222-4222-8222-222222222222';
  const created = await service.savePraiseTitle('可刪除歌曲', 'test', requestedSongId);
  assert.match(created.songId, /^[0-9a-f-]{36}$/);
  assert.equal(created.songId, requestedSongId);

  const beforeDelete = await service.listPraiseTitles();
  assert.equal(beforeDelete.length, 1);
  assert.equal(beforeDelete[0].songId, created.songId);
  assert.equal(beforeDelete[0].title, '可刪除歌曲');
  assert.equal(typeof beforeDelete[0].updatedAt, 'string');

  const deleted = await service.deletePraiseTitle(created.songId, 'test');
  assert.equal(deleted.success, true);
  assert.equal(deleted.songId, created.songId);
  assert.equal((await service.listPraiseTitles()).length, 0);
  assert.equal(
    mockClient._store.sunday_bulletin_praise_titles.get('可刪除歌曲').deleted_at !== null,
    true
  );
});

test('SundayBulletinSupabaseService calls the GAS date-binding resolver with the selected endpoint', async () => {
  const requests = [];
  const service = loadSupabaseService(null, {
    fetch: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        async json() {
          return {
            ok: true,
            success: true,
            schemaVersion: 2,
            data: {
              date: '2026-10-11',
              songId: '33333333-3333-4333-8333-333333333333',
              title: '日期綁定歌曲',
              lyrics: '第一節'
            }
          };
        }
      };
    }
  });

  const result = await service.loadPraiseByDate(
    '2026-10-11',
    'https://example.test/sunday-gas'
  );
  assert.equal(result.songId, '33333333-3333-4333-8333-333333333333');
  assert.equal(new URL(requests[0].url).searchParams.get('action'), 'loadPraiseByDate');
  assert.equal(new URL(requests[0].url).searchParams.get('date'), '2026-10-11');
  assert.equal(requests[0].options.cache, 'no-store');
});

test('DraftManager prioritizes Supabase and mirrors to GAS in background', async () => {
  const mockClient = createMockSupabaseClient();
  const supabaseService = loadSupabaseService(mockClient);

  const { manager, mockLocalStorage, gasCalls } = loadDraftManager({
    supabaseService,
    gasSyncUrl: 'https://example.test/gas-sync'
  });

  const draftData = {
    date: '2026-09-20',
    serviceType: '台華語',
    taiwanese: { sermonTitle: '生命之糧' }
  };

  // Save draft
  const saveRes = await manager.save(draftData);
  assert.equal(saveRes.success, true);
  assert.equal(saveRes.location, 'supabase');

  // Verify stored in localStorage (cache)
  assert.ok(mockLocalStorage._store['bulletin_draft_2026-09-20']);

  // Verify stored in Supabase
  const sbLoaded = await supabaseService.loadBulletin('2026-09-20');
  assert.ok(sbLoaded);
  assert.equal(sbLoaded.taiwanese.sermonTitle, '生命之糧');

  // Load draft
  const loadRes = await manager.load('2026-09-20');
  assert.equal(loadRes.success, true);
  assert.equal(loadRes.location, 'supabase');
  assert.equal(loadRes.data.taiwanese.sermonTitle, '生命之糧');

  // List drafts
  const listRes = await manager.list();
  assert.equal(listRes.success, true);
  assert.equal(listRes.location, 'supabase');
  assert.equal(listRes.drafts.length, 1);
  assert.equal(listRes.drafts[0].date, '2026-09-20');

  // Delete draft
  const delRes = await manager.delete('2026-09-20');
  assert.equal(delRes.success, true);
  assert.equal(await supabaseService.loadBulletin('2026-09-20'), null);
});

test('DraftManager falls back to GAS and localStorage when Supabase is unavailable', async () => {
  // No Supabase service
  const { manager, mockLocalStorage, gasCalls } = loadDraftManager({
    supabaseService: null,
    gasSyncUrl: 'https://example.test/gas-sync'
  });

  const draftData = {
    date: '2026-09-27',
    serviceType: '華語',
    mandarin: { sermonTitle: '信心生活' }
  };

  // Save draft without Supabase -> falls back to cloud (GAS)
  const saveRes = await manager.save(draftData);
  assert.equal(saveRes.success, true);
  assert.equal(saveRes.location, 'cloud');
  assert.ok(mockLocalStorage._store['bulletin_draft_2026-09-27']);
  assert.equal(gasCalls.length, 1);
});

test('WorshipPPT loadCloudRecord reads directly from Supabase tables', async () => {
  const mockClient = createMockSupabaseClient();
  const service = loadSupabaseService(mockClient);

  // Populate Supabase praise & reports
  await service.savePraise('2026-10-04', {
    title: '主正是大牧者',
    kicker: '聖歌隊',
    lyrics: '第一節歌詞'
  });
  await service.saveReports('2026-10-04', {
    announcements: ['消息A'],
    churchNews: ['教界B'],
    prayer: { hospital: '張姊妹' }
  });

  const pptContentService = loadBulletinContentService(mockClient);

  let fetchCalled = false;
  const mockFetch = async () => {
    fetchCalled = true;
    return { ok: true, json: async () => ({ success: true, data: {} }) };
  };

  // Load Praise via Supabase
  const praiseRes = await pptContentService.loadCloudRecord(
    'https://example.test/gas',
    'praise',
    '2026-10-04',
    mockFetch
  );
  assert.equal(praiseRes.state, 'loaded');
  assert.equal(praiseRes.data.title, '主正是大牧者');
  assert.equal(praiseRes.data.lyrics, '第一節歌詞');
  assert.equal(fetchCalled, false); // Did NOT hit GAS

  // Load Reports via Supabase
  const reportsRes = await pptContentService.loadCloudRecord(
    'https://example.test/gas',
    'reports',
    '2026-10-04',
    mockFetch
  );
  assert.equal(reportsRes.state, 'loaded');
  assert.deepEqual(reportsRes.data.announcements, ['消息A']);
  assert.equal(reportsRes.data.prayer.hospital, '張姊妹');
  assert.equal(fetchCalled, false); // Did NOT hit GAS
});
