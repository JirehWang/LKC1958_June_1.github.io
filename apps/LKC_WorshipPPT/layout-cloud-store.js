(function(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TaiwaneseWorshipLayoutCloud = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(root) {
  const AUTH_EMAIL = 'worship-layout@lkc1958.org';
  const SHARED_LAYOUT_PATH = 'worshipPpt/layoutConfig/shared';

  function layoutPathForTemplate(templateId) {
    const safeTemplateId = String(templateId || 'taiwanese').trim();
    if (!/^[a-z0-9-]+$/i.test(safeTemplateId) || safeTemplateId === 'taiwanese') return SHARED_LAYOUT_PATH;
    return `worshipPpt/layoutConfig/templates/${safeTemplateId}`;
  }

  function jsonObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeLayoutState(value) {
    const source = value && typeof value === 'object' ? value : {};
    const normalized = {
      groups: jsonObject(source.groups),
      pageAssignments: jsonObject(source.pageAssignments)
    };
    const hymnOpacityBySection = {};
    Object.entries(jsonObject(source.hymnOpacityBySection)).forEach(([sectionId, value]) => {
      const opacity = Number(value);
      if (/^[a-z0-9-]+$/i.test(sectionId) && opacity >= 40 && opacity <= 80) {
        hymnOpacityBySection[sectionId] = opacity;
      }
    });
    if (Object.keys(hymnOpacityBySection).length) normalized.hymnOpacityBySection = hymnOpacityBySection;
    const outputScale = {};
    ['text', 'image'].forEach(key => {
      const scale = Number(source.outputScale && source.outputScale[key]);
      if (scale >= 80 && scale <= 120) outputScale[key] = scale;
    });
    if (Object.keys(outputScale).length) normalized.outputScale = outputScale;
    return normalized;
  }

  function chooseLayoutStateForLoad(localLayoutState, cloudLayoutState, localSyncPending) {
    if (localSyncPending) {
      return {
        layoutState: normalizeLayoutState(localLayoutState),
        source: 'local-pending'
      };
    }
    if (cloudLayoutState) {
      return {
        layoutState: normalizeLayoutState(cloudLayoutState),
        source: 'cloud'
      };
    }
    return {
      layoutState: normalizeLayoutState(localLayoutState),
      source: 'local'
    };
  }

  function excludeSectionsFromLayoutState(layoutState, sectionIds) {
    const normalized = normalizeLayoutState(layoutState);
    const excluded = new Set((Array.isArray(sectionIds) ? sectionIds : [])
      .map(value => String(value || '').trim())
      .filter(Boolean));
    if (!excluded.size) return normalized;
    const isExcludedPage = pageId => excluded.has(String(pageId || '').split(':')[0]);

    Object.keys(normalized.pageAssignments).forEach(pageId => {
      if (isExcludedPage(pageId)) delete normalized.pageAssignments[pageId];
    });
    Object.entries(normalized.groups).forEach(([groupId, group]) => {
      if (!Array.isArray(group && group.pageIds)) return;
      group.pageIds = group.pageIds.filter(pageId => !isExcludedPage(pageId));
      if (!group.pageIds.length) delete normalized.groups[groupId];
    });
    return normalized;
  }

  async function defaultFirebaseLoader() {
    const [appSdk, authSdk, databaseSdk] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js'),
      import('https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js')
    ]);
    const bootstrap = root.LKCFirebaseBootstrap;
    if (!bootstrap) throw new Error('Firebase 共用設定尚未載入');
    const app = bootstrap.getOrInitializeApp(appSdk);
    return {
      auth: authSdk.getAuth(app),
      database: databaseSdk.getDatabase(app),
      inMemoryPersistence: authSdk.inMemoryPersistence,
      setPersistence: authSdk.setPersistence,
      signInWithEmailAndPassword: authSdk.signInWithEmailAndPassword,
      signOut: authSdk.signOut,
      ref: databaseSdk.ref,
      get: databaseSdk.get,
      set: databaseSdk.set,
      serverTimestamp: databaseSdk.serverTimestamp
    };
  }

  function createLayoutCloudStore(options = {}) {
    const loadFirebase = options.loadFirebase || defaultFirebaseLoader;
    const layoutPath = layoutPathForTemplate(options.templateId);
    const fallbackLayoutPath = options.fallbackTemplateId
      ? layoutPathForTemplate(options.fallbackTemplateId)
      : '';
    const fallbackExcludedSectionIds = options.fallbackExcludedSectionIds || [];
    let firebasePromise = null;
    const firebase = () => {
      if (!firebasePromise) {
        firebasePromise = Promise.resolve().then(loadFirebase).catch(error => {
          firebasePromise = null;
          throw error;
        });
      }
      return firebasePromise;
    };

    async function loadFromPath(path) {
      const sdk = await firebase();
      const snapshot = await sdk.get(sdk.ref(sdk.database, path));
      if (!snapshot.exists()) return null;
      const value = snapshot.val();
      if (!value || value.schemaVersion !== 1 || !value.layoutState) return null;
      return normalizeLayoutState(value.layoutState);
    }

    async function load() {
      if (root.WorshipPptSupabaseService && typeof root.WorshipPptSupabaseService.loadLayout === 'function') {
        try {
          const sbLayout = await root.WorshipPptSupabaseService.loadLayout(options.templateId || 'taiwanese');
          if (sbLayout) return normalizeLayoutState(sbLayout);
        } catch (err) {
          console.warn('[LayoutCloud] Supabase load failed, falling back to Firebase:', err);
        }
      }

      const templateLayout = await loadFromPath(layoutPath);
      if (templateLayout || !fallbackLayoutPath || fallbackLayoutPath === layoutPath) return templateLayout;
      const fallbackLayout = await loadFromPath(fallbackLayoutPath);
      return fallbackLayout
        ? excludeSectionsFromLayoutState(fallbackLayout, fallbackExcludedSectionIds)
        : null;
    }

    async function isUnlocked() {
      const sdk = await firebase();
      return Boolean(sdk.auth.currentUser && sdk.auth.currentUser.email === AUTH_EMAIL);
    }

    async function unlock(password) {
      const sdk = await firebase();
      try {
        await sdk.setPersistence(sdk.auth, sdk.inMemoryPersistence);
        await sdk.signInWithEmailAndPassword(sdk.auth, AUTH_EMAIL, String(password || ''));
        return isUnlocked();
      } catch (error) {
        const code = String(error && error.code || '');
        const message = String(error && error.message || error || '');
        if (/invalid-credential|wrong-password|invalid-login-credentials|user-not-found/.test(code)) {
          throw new Error('版面配置解鎖密碼錯誤');
        }
        if (/requests-from-referer/i.test(code) || /requests-from-referer/i.test(message)) {
          throw new Error('本機網址 (127.0.0.1) 受到 Firebase 網域限制，請改以 http://localhost:8766/ 網址開啟，或於 Google Cloud 控制台將 127.0.0.1 加入 API 金鑰的已授權 HTTP 參照位址');
        }
        throw error;
      }
    }

    async function save(layoutState) {
      const normalized = normalizeLayoutState(layoutState);
      const sdk = await firebase();
      const user = sdk.auth.currentUser;
      if (!user || user.email !== AUTH_EMAIL) throw new Error('版面配置尚未解鎖');

      // ⚡ 優先儲存至 Supabase
      if (root.WorshipPptSupabaseService && typeof root.WorshipPptSupabaseService.saveLayout === 'function') {
        try {
          await root.WorshipPptSupabaseService.saveLayout(options.templateId || 'taiwanese', normalized, user.uid);
        } catch (err) {
          console.warn('[LayoutCloud] Supabase save error:', err);
        }
      }

      // 同步寫入 Firebase
      await sdk.set(sdk.ref(sdk.database, layoutPath), {
        schemaVersion: 1,
        layoutState: normalized,
        updatedAt: sdk.serverTimestamp(),
        updatedBy: user.uid
      });
    }

    async function lock() {
      const sdk = await firebase();
      await sdk.signOut(sdk.auth);
    }

    return { load, save, unlock, lock, isUnlocked };
  }

  return {
    AUTH_EMAIL,
    SHARED_LAYOUT_PATH,
    layoutPathForTemplate,
    chooseLayoutStateForLoad,
    excludeSectionsFromLayoutState,
    normalizeLayoutState,
    createLayoutCloudStore
  };
});
