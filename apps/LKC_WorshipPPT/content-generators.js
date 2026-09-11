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

  async function queryBibleViaReadApi(reference, bibleService, readApi, version = 'tghg') {
    if (!bibleService || typeof bibleService.parseQuery !== 'function') throw new Error('台語聖經解析器尚未載入');
    if (typeof readApi !== 'function') throw new Error('雲端讀取介面尚未載入');
    const queries = bibleService.parseQuery(reference);
    if (!queries.length) throw new Error(`無法識別經文格式：「${reference}」`);
    const results = await Promise.all(queries.map(async query => ({
      query,
      response: await readApi('cal_queryBible', {
        book: query.short,
        chap: query.chap,
        sec: query.sec,
        version
      })
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
