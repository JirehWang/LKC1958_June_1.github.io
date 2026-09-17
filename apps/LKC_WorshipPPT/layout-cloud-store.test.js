const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  AUTH_EMAIL,
  SHARED_LAYOUT_PATH,
  layoutPathForTemplate,
  chooseLayoutStateForLoad,
  createLayoutCloudStore,
  normalizeLayoutState
} = require('./layout-cloud-store.js');

function firebaseFixture(initialValue = null) {
  const writes = [];
  const reads = [];
  const auth = { currentUser: null };
  const api = {
    auth,
    database: { name: 'test-db' },
    inMemoryPersistence: { name: 'memory' },
    ref: (_database, path) => ({ path }),
    get: async reference => {
      reads.push(reference);
      const value = typeof initialValue === 'function' ? initialValue(reference.path) : initialValue;
      return {
        exists: () => value !== null,
        val: () => value,
        ref: reference
      };
    },
    set: async (reference, value) => writes.push({ reference, value }),
    serverTimestamp: () => 123456789,
    setPersistence: async (_auth, persistence) => {
      assert.equal(persistence, api.inMemoryPersistence);
    },
    signInWithEmailAndPassword: async (_auth, email, password) => {
      assert.equal(email, AUTH_EMAIL);
      if (password !== 'test-secret') throw Object.assign(new Error('wrong password'), { code: 'auth/invalid-credential' });
      auth.currentUser = { uid: 'editor-1', email };
      return { user: auth.currentUser };
    },
    signOut: async () => { auth.currentUser = null; }
  };
  return { api, reads, writes };
}

test('normalizes shared layout groups and protected score opacity values only', () => {
  assert.deepEqual(normalizeLayoutState({
    groups: { scripture: { id: 'scripture', pageIds: ['scripture:1'], params: { contentSize: 42 } } },
    pageAssignments: { 'scripture:1': 'scripture' },
    hymnOpacityBySection: { 'hymn-1': 68, offering: 52, invalid: 101 },
    outputScale: { text: 95, image: 105, ignored: 88 },
    backgroundImage: 'data:image/png;base64,too-large-for-layout-state'
  }), {
    groups: { scripture: { id: 'scripture', pageIds: ['scripture:1'], params: { contentSize: 42 } } },
    pageAssignments: { 'scripture:1': 'scripture' },
    hymnOpacityBySection: { 'hymn-1': 68, offering: 52 },
    outputScale: { text: 95, image: 105 }
  });
});

test('loads the one church-wide layout from the dedicated RTDB path', async () => {
  const state = { groups: { shared: { id: 'shared' } }, pageAssignments: {} };
  const fixture = firebaseFixture({ schemaVersion: 1, layoutState: state });
  const store = createLayoutCloudStore({ loadFirebase: async () => fixture.api });

  assert.deepEqual(await store.load(), state);
  assert.equal(SHARED_LAYOUT_PATH, 'worshipPpt/layoutConfig/shared');
});

test('isolates the joint Mandarin layout from Taiwanese page assignments', async () => {
  const fixture = firebaseFixture({ schemaVersion: 1, layoutState: { groups: {}, pageAssignments: {} } });
  const store = createLayoutCloudStore({ loadFirebase: async () => fixture.api, templateId: 'joint-mandarin' });
  await store.load();
  assert.equal(layoutPathForTemplate('joint-mandarin'), 'worshipPpt/layoutConfig/templates/joint-mandarin');
  assert.equal(layoutPathForTemplate('taiwanese'), SHARED_LAYOUT_PATH);
});

test('loads Taiwanese layout for joint Taiwanese while preserving joint bilingual liturgy parameters', async () => {
  const sharedState = {
    groups: {
      scripture: { id: 'scripture', pageIds: ['scripture:1'], params: { contentSize: 42 } },
      taiwaneseLiturgy: {
        id: 'taiwaneseLiturgy',
        pageIds: ['creed:1', 'lord-prayer:1'],
        params: { contentX: 20, contentW: 60 }
      }
    },
    pageAssignments: {
      'scripture:1': 'scripture',
      'creed:1': 'taiwaneseLiturgy',
      'lord-prayer:1': 'taiwaneseLiturgy'
    }
  };
  const fixture = firebaseFixture(path => path === SHARED_LAYOUT_PATH
    ? { schemaVersion: 1, layoutState: sharedState }
    : null);
  const store = createLayoutCloudStore({
    loadFirebase: async () => fixture.api,
    templateId: 'joint-taiwanese',
    fallbackTemplateId: 'taiwanese',
    fallbackExcludedSectionIds: ['creed', 'lord-prayer']
  });

  const expectedInitialState = {
    groups: { scripture: sharedState.groups.scripture },
    pageAssignments: { 'scripture:1': 'scripture' }
  };
  assert.deepEqual(await store.load(), expectedInitialState);
  assert.deepEqual(fixture.reads.map(reference => reference.path), [
    'worshipPpt/layoutConfig/templates/joint-taiwanese',
    SHARED_LAYOUT_PATH
  ]);

  await store.unlock('test-secret');
  await store.save(expectedInitialState);
  assert.equal(fixture.writes[0].reference.path, 'worshipPpt/layoutConfig/templates/joint-taiwanese');
});

test('declares matching Firebase rules for template-specific layout paths', () => {
  const rulesPath = path.resolve(__dirname, '..', '..', 'firebase', 'database.rules.worship-layout.json');
  const rules = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
  const templates = rules.rules.worshipPpt.layoutConfig.templates;
  assert.ok(templates.$templateId);
  assert.equal(templates.$templateId['.read'], true);
  assert.match(templates.$templateId['.write'], /worship-layout@lkc1958\.org/);
});

test('keeps a pending local layout instead of replacing it with older cloud data', () => {
  const local = {
    groups: { pending: { id: 'pending', name: '尚未同步' } },
    pageAssignments: { 'scripture:1': 'pending' }
  };
  const cloud = {
    groups: { existing: { id: 'existing', name: '雲端舊資料' } },
    pageAssignments: { 'creed:1': 'existing' }
  };

  assert.deepEqual(chooseLayoutStateForLoad(local, cloud, true), {
    layoutState: local,
    source: 'local-pending'
  });
});

test('uses the shared cloud layout when the local backup has no pending changes', () => {
  const local = {
    groups: { local: { id: 'local' } },
    pageAssignments: {}
  };
  const cloud = {
    groups: { shared: { id: 'shared' } },
    pageAssignments: {}
  };

  assert.deepEqual(chooseLayoutStateForLoad(local, cloud, false), {
    layoutState: cloud,
    source: 'cloud'
  });
});

test('refuses cloud writes while the layout editor is locked', async () => {
  const fixture = firebaseFixture();
  const store = createLayoutCloudStore({ loadFirebase: async () => fixture.api });

  await assert.rejects(() => store.save({ groups: {}, pageAssignments: {} }), /尚未解鎖/);
  assert.equal(fixture.writes.length, 0);
});

test('passes the entered password to Firebase Auth and keeps auth in memory', async () => {
  const fixture = firebaseFixture();
  const store = createLayoutCloudStore({ loadFirebase: async () => fixture.api });

  await assert.rejects(() => store.unlock('wrong'), /密碼錯誤/);

  fixture.api.signInWithEmailAndPassword = async () => {
    throw Object.assign(new Error('requests from referer http://127.0.0.1:8766 are blocked'), {
      code: 'auth/requests-from-referer-http://127.0.0.1:8766-are-blocked.'
    });
  };
  await assert.rejects(() => store.unlock('any'), /本機網址 \(127\.0\.0\.1\) 受到 Firebase 網域限制/);

  fixture.api.signInWithEmailAndPassword = async (_auth, email, password) => {
    if (password !== 'test-secret') throw Object.assign(new Error('wrong password'), {
      code: 'auth/invalid-credential'
    });
    fixture.api.auth.currentUser = { uid: 'editor-1', email };
    return { user: fixture.api.auth.currentUser };
  };
  assert.equal(await store.unlock('test-secret'), true);
  assert.equal(await store.isUnlocked(), true);

  await store.save({ groups: { shared: { id: 'shared' } }, pageAssignments: {} });
  assert.deepEqual(fixture.writes, [{
    reference: { path: SHARED_LAYOUT_PATH },
    value: {
      schemaVersion: 1,
      layoutState: { groups: { shared: { id: 'shared' } }, pageAssignments: {} },
      updatedAt: 123456789,
      updatedBy: 'editor-1'
    }
  }]);

  await store.lock();
  assert.equal(await store.isUnlocked(), false);
});

test('allows a Firebase dependency load to be retried after a temporary failure', async () => {
  const fixture = firebaseFixture();
  let attempts = 0;
  const store = createLayoutCloudStore({
    loadFirebase: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('temporary network failure');
      return fixture.api;
    }
  });

  await assert.rejects(() => store.load(), /temporary network failure/);
  assert.equal(await store.load(), null);
  assert.equal(attempts, 2);
});

test('loads the cloud store before the locked layout UI and uses a password field', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
  const layoutGroups = fs.readFileSync(path.join(__dirname, 'layout-groups.js'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');
  assert.ok(html.indexOf('layout-cloud-store.js') < html.indexOf('layout-groups.js'));
  assert.match(html, /id="layout-unlock-password" type="password"/);
  assert.match(html, /id="layout-lock-toggle"/);
  assert.match(app, /hymnOpacitySectionIds\.includes\(active\)/);
  assert.match(app, /saveSharedHymnOpacity/);
  assert.match(layoutGroups, /isWorshipLayoutUnlocked/);
  assert.match(layoutGroups, /#opacity, #sync-hymn-opacity-global/);
  assert.match(html, /class="output-scale-toolbar"/);
  assert.match(html, /id="lg-output-text-scale"/);
  assert.match(html, /id="lg-output-image-scale"/);
  assert.match(html, /id="layout-save-output-scale"/);
  assert.doesNotMatch(layoutGroups, /data-layout-tab="output"/);
  assert.match(styles, /\.output-scale-toolbar/);
  assert.match(layoutGroups, /saveOutputScale/);
});
