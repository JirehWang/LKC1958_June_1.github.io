(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TaiwaneseWorshipContentGenerators = api;

  if (typeof document !== 'undefined') {
    async function generateBibleSection(config) {
      const sectionId = config.sectionId;
      const label = config.label;
      const errorLabel = sectionId === 'verse' ? '金句' : label;
      const item = model[sectionId];
      if (!item || !item.sourceValue) return { sectionId, label, errors: [] };
      const profile = root.activeWorshipTemplateProfile || {};
      const versions = Array.isArray(config.versions) && config.versions.length
        ? config.versions
        : (profile.bibleVersions || ['tghg']);
      const recordsByVersion = [];
      const errors = [];
      item.bibleErrors = [];
      item.pptPages = [];
      for (let versionIndex = 0; versionIndex < versions.length; versionIndex += 1) {
        const version = versions[versionIndex];
        try {
          recordsByVersion[versionIndex] = await api.queryBibleViaReadApi(
            item.sourceValue,
            root.FhlBibleService,
            root.worshipReadAPI,
            version
          );
        } catch (error) {
          const detail = {
            sectionId,
            label: errorLabel,
            message: error && error.message ? error.message : String(error)
          };
          if (version) detail.version = version;
          errors.push(detail);
        }
      }
      item.pptPages = recordsByVersion.flatMap((records, versionIndex) =>
        Array.isArray(records)
          ? root.TaiwaneseWorshipSlideProduction.buildBiblePages(
              sectionId,
              label,
              item.sourceValue,
              records,
              2,
              {
                languageLabel: Array.isArray(config.languageLabels) ? config.languageLabels[versionIndex] : '',
                bibleVersion: versions[versionIndex]
              }
            )
          : []
      ).map((page, index) => ({ ...page, id: `${sectionId}:${index + 1}` }));
      if (config.prependTitle && item.pptPages.length) {
        item.pptPages.unshift({ id: `${sectionId}:title`, kind: 'section', title: config.prependTitle, body: '', layout: {} });
      }
      item.bibleErrors = errors;
      return { sectionId, label, errors };
    }

    root.generateCalendarContent = async function() {
      const profile = root.activeWorshipTemplateProfile || {};
      const configs = Array.isArray(profile.bibleSections) && profile.bibleSections.length
        ? profile.bibleSections
        : [
            { sectionId: 'call', label: '宣召', versions: ['tghg'] },
            { sectionId: 'scripture', label: '聖經', versions: ['tghg'] },
            { sectionId: 'verse', label: '聖經', versions: ['tghg'], prependTitle: '金句' }
          ];
      return api.loadBibleSectionsSequentially(configs, generateBibleSection);
    };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  function normalizeError(config, error) {
    const detail = {
      sectionId: config && config.sectionId || '',
      label: config && config.label || '',
      message: error && error.message ? error.message : String(error)
    };
    if (config && config.version) detail.version = config.version;
    return detail;
  }

  async function loadBibleSectionsSequentially(configs, loader) {
    const results = [];
    const errors = [];
    for (const config of Array.isArray(configs) ? configs : []) {
      try {
        const result = await loader(config);
        results.push(result);
        if (result && Array.isArray(result.errors)) errors.push(...result.errors);
      } catch (error) {
        errors.push(normalizeError(config, error));
      }
    }
    return { results, errors };
  }

  async function queryBibleViaReadApi(reference, bibleService, readApi, version = 'tghg', options = {}) {
    if (!bibleService || typeof bibleService.parseQuery !== 'function') throw new Error('台語聖經解析器尚未載入');
    if (typeof readApi !== 'function') throw new Error('雲端讀取介面尚未載入');
    const queries = bibleService.parseQuery(reference);
    if (!queries.length) throw new Error(`無法識別經文格式：「${reference}」`);
    const results = await Promise.all(queries.map(async query => ({
      query,
      response: await (async () => {
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const response = await readApi('cal_queryBible', { book: query.short, chap: query.chap, sec: query.sec, version });
            if (!response || response.success === false) throw new Error(response && (response.message || response.error) || '經文服務回應無效');
            const records = response.records || (response.data && response.data.records);
            if (!Array.isArray(records)) throw new Error('經文服務回應格式不完整');
            if (records.length || attempt === 1) return { ...response, records };
          } catch (error) {
            if (attempt === 1 || !/timeout|逾時|network|fetch|連線|回應|暫時|busy|quota|HTTP\s*5|服務/i.test(String(error.message || error))) throw error;
          }
          await new Promise(resolve => setTimeout(resolve, options.retryDelayMs == null ? 500 : options.retryDelayMs));
        }
      })()
    })));
    return results.flatMap(({ query, response }) => (response.records || []).map(record => ({
      ...record,
      bible_text: record.bible_text || record.text || '',
      ...(query.bookName ? {
        queryBookName: query.bookName,
        queryChap: query.chap,
        querySec: query.sec,
        queryGroupKey: `${query.bookName}_${query.chap}_${query.sec}`
      } : {})
    })));
  }

  return { queryBibleViaReadApi, loadBibleSectionsSequentially };
});
