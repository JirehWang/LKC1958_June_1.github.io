const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const repoRoot = path.join(__dirname, '..');

// Helper to load SundayBulletinSupabaseService in a sandbox
function loadSupabaseService(mockClient) {
  const source = fs.readFileSync(
    path.join(repoRoot, 'apps', 'LKC_SundayBulletin', 'js', 'bulletin-supabase.js'),
    'utf8'
  );
  const context = {
    globalThis: {},
    module: { exports: {} },
    exports: {},
    console
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
    sunday_bulletin_praise: new Map()
  };

  const client = {
    _store: store,
    from(tableName) {
      const table = store[tableName] || new Map();
      return {
        upsert(row, opts) {
          const key = row.date;
          table.set(key, { ...row });
          return {
            select() {
              return Promise.resolve({ data: [table.get(key)], error: null });
            },
            then(resolve) {
              return Promise.resolve({ data: [table.get(key)], error: null }).then(resolve);
            }
          };
        },
        select(fields) {
          return {
            eq(col, val) {
              return {
                async maybeSingle() {
                  const item = table.get(val);
                  return { data: item ? { ...item } : null, error: null };
                }
              };
            },
            order(col, opts) {
              const items = Array.from(table.values());
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
