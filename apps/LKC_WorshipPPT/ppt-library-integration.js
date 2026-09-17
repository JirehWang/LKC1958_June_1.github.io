(function() {
  const library = window.TaiwaneseWorshipPptxLibrary;
  const fileCache = new Map();
  let indexPromise = null;
  let fileLoadQueue = Promise.resolve();
  const PPT_MAX_ATTEMPTS = 2;
  const PPT_RETRY_DELAY_MS = 1500;

  function isRetryablePptError(error) {
    if (!error) return false;
    if (['TIMEOUT', 'GAS_TIMEOUT', 'INVALID_RESPONSE', 'GAS_HTML_ERROR'].includes(error.type)) return true;
    const message = String(error.message || error).toLowerCase();
    return /逾時|timeout|timed out|failed to fetch|network|(?:^|[^a-z])load failed|無法連線|not valid json|gas|html/.test(message);
  }

  function waitForPptRetry() {
    const configuredDelay = Number(window.LKC_PPT_RETRY_DELAY_MS);
    const delay = Number.isFinite(configuredDelay) && configuredDelay >= 0
      ? configuredDelay
      : PPT_RETRY_DELAY_MS;
    if (!delay) return Promise.resolve();
    return new Promise(resolve => setTimeout(resolve, delay));
  }

  async function downloadAndRasterize(entry) {
    let lastError;
    for (let attempt = 1; attempt <= PPT_MAX_ATTEMPTS; attempt += 1) {
      try {
        const pages = await library.downloadAndParse(entry, window.JSZip, window.worshipReadAPI);
        const nativeExport = entry.kind === 'hymn' || entry.kind === 'response';
        let previewPages;
        try {
          previewPages = await library.rasterizeImportedPages(pages);
        } catch (error) {
          if (!nativeExport) throw error;
          // Preview support must not prevent exporting a valid original deck.
          previewPages = pages.map(page => ({ ...page, previewError: String(error.message || error) }));
        }
        return previewPages.map(page => ({ ...page, nativeExport }));
      } catch (error) {
        lastError = error;
        if (attempt >= PPT_MAX_ATTEMPTS || !isRetryablePptError(error)) throw error;
        await waitForPptRetry();
      }
    }
    throw lastError;
  }

  async function getIndex() {
    if (!indexPromise) {
      indexPromise = (async function() {
        const result = await window.worshipReadAPI('cal_getPptLibraryIndex', {});
        if (!result || !Array.isArray(result.data)) throw new Error('PPT 資料庫索引格式不正確');
        return result.data;
      })().catch(error => {
        indexPromise = null;
        throw error;
      });
    }
    return indexPromise;
  }

  function pagesForEntry(entry) {
    if (!fileCache.has(entry.fileId)) {
      const loadPromise = fileLoadQueue.then(() => downloadAndRasterize(entry)).catch(error => {
        fileCache.delete(entry.fileId);
        throw error;
      });
      fileLoadQueue = loadPromise.catch(() => undefined);
      fileCache.set(entry.fileId, loadPromise);
    }
    return fileCache.get(entry.fileId);
  }

  async function loadExternalPresentationSource(source) {
    if (!source || !source.id || !source.fileId) throw new Error('固定簡報來源設定不完整');
    const pages = await pagesForEntry({
      id: source.id,
      kind: 'external-presentation',
      title: source.title || '',
      fileId: source.fileId,
      sourceUrl: source.sourceUrl || ''
    });
    const mappings = Array.isArray(source.mappings) ? source.mappings : [];
    const prepared = mappings.map(mapping => {
      const item = model[mapping.sectionId];
      if (!item) throw new Error(`固定簡報找不到流程段落：${mapping.sectionId}`);
      const pageIndexes = Array.isArray(mapping.pageIndexes) ? mapping.pageIndexes : [];
      const selectedPages = pageIndexes.map(index => pages[index]);
      if (!selectedPages.length || selectedPages.some(page => !page)) {
        throw new Error(`${source.title || source.id} 的投影片頁碼設定不正確`);
      }
      return { mapping, item, selectedPages };
    });

    prepared.forEach(({ mapping, item, selectedPages }) => {
      item.pptPages = selectedPages.map((page, index) => ({
        ...page,
        id: `${mapping.sectionId}:${index + 1}`
      }));
      item.externalSourceId = source.id;
      item.externalSourceFileId = source.fileId;
      item.externalSourceUrl = source.sourceUrl || '';
      item.libraryError = '';
    });
    return {
      sourceId: source.id,
      fileId: source.fileId,
      sectionIds: prepared.map(({ mapping }) => mapping.sectionId)
    };
  }

  async function loadSection(sectionId, kind, entries) {
    const item = model[sectionId];
    const profile = window.activeWorshipTemplateProfile || {};
    if (item && (profile.hymnTitleSectionIds || []).includes(sectionId)) {
      item.includeSectionTitle = true;
    }
    const number = library.normalizeLibraryNumber(item && item.sourceValue);
    if (!item || !number) return { sectionId, state: 'empty' };
    const entry = library.findLibraryEntry(entries, kind, number);
    if (!entry) {
      delete item.pptPages;
      item.libraryError = `資料庫找不到 ${kind === 'hymn' ? '聖詩' : '啟應文'} ${number}`;
      return { sectionId, state: 'missing', message: item.libraryError };
    }
    if (item.libraryFileId === entry.fileId && Array.isArray(item.pptPages) && item.pptPages.length
      && item.pptPages.every(page => page.nativeExport && library.getNativeSource && library.getNativeSource(page.nativeSource))) {
      return { sectionId, state: 'cached', pageCount: item.pptPages.length };
    }
    let pages;
    try {
      pages = await pagesForEntry(entry);
    } catch (error) {
      item.libraryError = 'PPTX 載入失敗：' + String(error && error.message || error);
      return { sectionId, state: 'error', message: item.libraryError };
    }
    item.pptPages = pages.map((page, index) => ({ ...page, id: `${sectionId}:${index + 1}` }));
    item.libraryFileId = entry.fileId;
    item.libraryEntry = { kind: entry.kind, number: entry.number, title: entry.title, fileName: entry.fileName };
    if (sectionId === 'offering') {
      item.title = '奉獻';
      item.kicker = '';
    } else if (sectionId === 'amen') {
      item.title = '阿們頌';
      item.kicker = '';
    } else if (sectionId === 'prayer-song') {
      item.title = entry.fileName.replace(/\.pptx$/i, '');
      item.kicker = '';
    } else if (sectionId === 'doxology') {
      item.title = `頌榮 – 第${entry.number}首`;
      item.kicker = entry.title || '';
    } else if (kind === 'hymn') {
      item.title = `聖詩 – 第 ${entry.number} 首`;
      item.kicker = entry.title || '';
    } else {
      item.title = entry.title;
    }
    item.libraryError = '';
    return { sectionId, state: 'loaded', pageCount: pages.length, entry };
  }

  window.loadPptLibraryContent = async function(sectionIds) {
    const profile = window.activeWorshipTemplateProfile || {};
    const defaultTargets = [
      ['pre-hymn-1', 'hymn'],
      ['pre-hymn-2', 'hymn'],
      ['hymn-1', 'hymn'],
      ['hymn-2', 'hymn'],
      ['doxology', 'hymn'],
      ['response', 'response'],
      ['prayer-song', 'hymn'],
      ['offering', 'hymn'],
      ['amen', 'hymn']
    ];
    const targets = (Array.isArray(profile.librarySections) ? profile.librarySections : defaultTargets)
      .filter(([sectionId]) => !sectionIds || sectionIds.includes(sectionId));
    if (!targets.length) return [];
    const entries = await getIndex();
    const results = [];
    for (const [sectionId, kind] of targets) {
      results.push(await loadSection(sectionId, kind, entries));
    }
    return results;
  };

  window.loadExternalPresentationSources = async function(sourceIds) {
    const profile = window.activeWorshipTemplateProfile || {};
    const sources = (Array.isArray(profile.externalPresentations) ? profile.externalPresentations : [])
      .filter(source => !sourceIds || sourceIds.includes(source.id));
    return Promise.all(sources.map(loadExternalPresentationSource));
  };

  window.worshipExternalPresentationsReady = Promise.resolve([]);

  window.ensureNativeLibrarySources = async function() {
    const results = await window.loadPptLibraryContent();
    const failed = results.filter(result => ['error', 'missing'].includes(result.state));
    if (failed.length) throw new Error(failed.map(result => result.message).join('；'));
    return results;
  };

  window.reloadCurrentPptLibrarySection = async function() {
    const result = await window.loadPptLibraryContent([active]);
    render();
    return result[0];
  };

  window.addEventListener('load', () => {
    const profile = window.activeWorshipTemplateProfile || {};
    const fixedSections = Array.isArray(profile.fixedLibrary)
      ? profile.fixedLibrary.map(item => item.sectionId)
      : ['prayer-song', 'offering', 'amen'];
    if (!fixedSections.length) return;
    window.loadPptLibraryContent(fixedSections)
      .then(() => render())
      .catch(error => console.warn('固定聖詩載入失敗：', error));
  });

  window.addEventListener('load', () => {
    const profile = window.activeWorshipTemplateProfile || {};
    if (!Array.isArray(profile.externalPresentations) || !profile.externalPresentations.length) return;
    window.worshipExternalPresentationsReady = window.loadExternalPresentationSources()
      .then(result => {
        render();
        return result;
      })
      .catch(error => {
        console.warn('固定 Google 簡報載入失敗，保留內建備援頁面：', error);
        return [];
      });
  });
})();
