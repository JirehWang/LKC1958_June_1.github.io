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
      if (!item) return { sectionId, label, errors: [] };
      const profile = root.activeWorshipTemplateProfile || {};
      const versions = Array.isArray(config.versions) && config.versions.length
        ? config.versions
        : (profile.bibleVersions || ['tghg']);
      const recordsByVersion = [];
      const errors = [];
      item.bibleErrors = [];
      item.bibleChecks = [];
      item.pptPages = [];
      if (!String(item.sourceValue || '').trim()) {
        item.bibleChecks = versions.map((version, versionIndex) => ({
          version,
          languageLabel: getBibleLanguageLabel(config, version, versionIndex),
          reference: '',
          status: 'missing',
          message: '行事曆未提供經文範圍'
        }));
        return { sectionId, label, errors };
      }
      const checks = [];
      for (let versionIndex = 0; versionIndex < versions.length; versionIndex += 1) {
        const version = versions[versionIndex];
        const languageLabel = getBibleLanguageLabel(config, version, versionIndex);
        try {
          const records = await api.queryBibleViaReadApi(
            item.sourceValue,
            root.FhlBibleService,
            root.worshipReadAPI,
            version
          );
          recordsByVersion[versionIndex] = records;
          const versionChecks = inspectBibleCoverage(item.sourceValue, records, root.FhlBibleService)
            .map(check => ({ ...check, version, languageLabel }));
          checks.push(...versionChecks);
          versionChecks.filter(check => ['partial', 'missing', 'unverified', 'error'].includes(check.status))
            .forEach(check => errors.push({
              sectionId,
              label: errorLabel,
              version,
              message: `經節核對未完成：${check.reference || item.sourceValue}；${check.message}`
            }));
        } catch (error) {
          recordsByVersion[versionIndex] = [];
          const parsedQueries = root.FhlBibleService && typeof root.FhlBibleService.parseQuery === 'function'
            ? root.FhlBibleService.parseQuery(item.sourceValue)
            : [];
          const message = error && error.message ? error.message : String(error);
          const failedQueries = parsedQueries.length ? parsedQueries : [{ bookName: '', chap: '', sec: '' }];
          failedQueries.forEach(query => checks.push({
            version,
            languageLabel,
            reference: formatBibleReference(query) || item.sourceValue,
            status: 'error',
            message
          }));
          const detail = {
            sectionId,
            label: errorLabel,
            message
          };
          if (version) detail.version = version;
          errors.push(detail);
        }
      }
      item.bibleChecks = checks;
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
                bibleVersion: versions[versionIndex],
                layoutState: typeof root.getWorshipLayoutStateForExport === 'function'
                  ? root.getWorshipLayoutStateForExport()
                  : null,
                item
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

    function getBibleLanguageLabel(config, version, versionIndex) {
      if (Array.isArray(config.languageLabels) && config.languageLabels[versionIndex]) {
        return config.languageLabels[versionIndex];
      }
      if (version === 'tghg') return '台語';
      if (version === 'unv') return '華語';
      return version || `版本 ${versionIndex + 1}`;
    }

    function formatBibleReference(query) {
      if (!query) return '';
      const bookName = query.bookName || query.short || '';
      const chapter = query.chap == null ? '' : String(query.chap);
      const section = String(query.sec || '').trim();
      if (!bookName && !chapter) return '';
      return `${bookName} ${chapter}${section ? `:${section}` : ''}`.trim();
    }

    function parseExpectedVerses(section) {
      const normalized = String(section || '').trim();
      if (!normalized) return { mode: 'whole-chapter', verses: [] };
      const verses = new Set();
      for (const part of normalized.split(',')) {
        const match = part.match(/^(\d+)(?:-(\d+))?$/);
        if (!match) return { mode: 'invalid', verses: [] };
        const start = Number(match[1]);
        const end = Number(match[2] || match[1]);
        if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end - start > 300) {
          return { mode: 'invalid', verses: [] };
        }
        for (let verse = start; verse <= end; verse += 1) verses.add(verse);
      }
      return { mode: 'explicit', verses: [...verses].sort((left, right) => left - right) };
    }

    function inspectBibleCoverage(reference, records, bibleService) {
      const queries = bibleService && typeof bibleService.parseQuery === 'function'
        ? bibleService.parseQuery(reference)
        : [];
      return queries.map(query => {
        const groupKey = `${query.bookName}_${query.chap}_${query.sec || ''}`;
        const queryRecords = (Array.isArray(records) ? records : []).filter(record =>
          record.queryGroupKey === groupKey
          || (record.queryBookName === query.bookName
            && Number(record.queryChap) === Number(query.chap)
            && String(record.querySec || '') === String(query.sec || ''))
        );
        const actualVerses = [...new Set(queryRecords
          .map(record => Number(record.sec))
          .filter(verse => Number.isInteger(verse) && verse > 0))]
          .sort((left, right) => left - right);
        const emptyTextVerses = queryRecords
          .filter(record => !String(record.bible_text || record.text || '').trim())
          .map(record => Number(record.sec))
          .filter(verse => Number.isInteger(verse) && verse > 0);
        const expected = parseExpectedVerses(query.sec);
        const expectedSet = new Set(expected.verses);
        const actualSet = new Set(actualVerses);
        const missingVerses = expected.mode === 'explicit'
          ? expected.verses.filter(verse => !actualSet.has(verse))
          : [];
        const unexpectedVerses = expected.mode === 'explicit'
          ? actualVerses.filter(verse => !expectedSet.has(verse))
          : [];
        const referenceLabel = formatBibleReference(query);
        let status;
        let message;
        if (!actualVerses.length) {
          status = 'missing';
          message = '查詢沒有回傳任何經節';
        } else if (expected.mode === 'invalid') {
          status = 'unverified';
          message = '經節範圍格式無法自動核對';
        } else if (expected.mode === 'whole-chapter') {
          const details = [];
          if (emptyTextVerses.length) details.push(`第 ${[...new Set(emptyTextVerses)].join(',')} 節內容空白`);
          status = details.length ? 'partial' : 'unverified';
          message = details.length
            ? `${details.join('；')}；整章共取得 ${actualVerses.length} 節，請人工確認完整性`
            : `已取得 ${actualVerses.length} 節；整章範圍沒有固定節數可比對，請人工確認完整性`;
        } else {
          const details = [];
          if (missingVerses.length) details.push(`缺少 ${missingVerses.join(',')}`);
          if (unexpectedVerses.length) details.push(`多出 ${unexpectedVerses.join(',')}`);
          if (emptyTextVerses.length) details.push(`第 ${[...new Set(emptyTextVerses)].join(',')} 節內容空白`);
          status = details.length ? 'partial' : 'verified';
          message = details.length
            ? `預期 ${expected.verses.length} 節，實際 ${actualVerses.length} 節（${details.join('；')}）`
            : `範圍完整，共 ${expected.verses.length} 節`;
        }
        return {
          reference: referenceLabel,
          status,
          message,
          expectedVerses: expected.verses,
          actualVerses,
          emptyTextVerses: [...new Set(emptyTextVerses)],
          missingVerses,
          unexpectedVerses
        };
      });
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
        if (query.eng === 'Heb' && typeof bibleService.getFhlBookCode !== 'function') {
          throw new Error('聖經查詢套件版本不相容，請重新載入頁面');
        }
        const book = typeof bibleService.getFhlBookCode === 'function'
          ? bibleService.getFhlBookCode(query)
          : query.short;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const response = await readApi('cal_queryBible', { book, chap: query.chap, sec: query.sec, version });
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
