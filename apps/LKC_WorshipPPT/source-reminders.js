(function(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TaiwaneseWorshipSourceReminders = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(root) {
  const clean = value => String(value == null ? '' : value).trim();
  const calendarFields = [
    ['sermon', 'title', '講題'],
    ['sermon', 'kicker', '講員'],
    ['call', 'sourceValue', '宣召'],
    ['scripture', 'sourceValue', '經文'],
    ['verse', 'sourceValue', '金句'],
    ['response', 'sourceValue', '啟應文'],
    ['hymn-1', 'sourceValue', '聖詩一'],
    ['hymn-2', 'sourceValue', '聖詩二'],
    ['doxology', 'sourceValue', '頌榮']
  ];
  const bibleSections = [
    ['call', '宣召'],
    ['scripture', '聖經'],
    ['verse', '金句']
  ];
  const librarySectionLabels = {
    'pre-hymn-1': '會前聖詩一',
    'pre-hymn-2': '會前聖詩二',
    'hymn-1': '聖詩一',
    'hymn-2': '聖詩二',
    response: '啟應文',
    'prayer-song': '祈禱詩',
    offering: '奉獻詩',
    doxology: '頌榮',
    amen: '阿們頌'
  };

  function hasPages(item) {
    return Array.isArray(item && item.pptPages) && item.pptPages.length > 0;
  }

  function hasPrayerContent(prayer) {
    const source = prayer && typeof prayer === 'object' ? prayer : {};
    return ['homeRest', 'hospital', 'other'].some(key => clean(source[key]));
  }

  function normalizeLibraryNumber(value) {
    const library = root && root.TaiwaneseWorshipPptxLibrary;
    if (library && typeof library.normalizeLibraryNumber === 'function') {
      return library.normalizeLibraryNumber(value);
    }
    const match = clean(value).toUpperCase().match(/0*(\d+)\s*([A-Z])?/);
    return match ? `${Number(match[1])}${match[2] || ''}` : '';
  }

  function checkLibraryResult(result, items, reminders) {
    const sectionId = result.sectionId;
    const label = librarySectionLabels[sectionId] || sectionId;
    const item = items[sectionId];
    if (result.state === 'missing') {
      reminders.push(`PPT 資料庫找不到「${label}」素材${result.message ? `：${result.message}` : ''}`);
      return;
    }
    if (result.state === 'error') {
      reminders.push(`PPT 資料庫「${label}」載入失敗：${clean(result.message || item && item.libraryError) || '原因不明'}`);
      return;
    }
    if (result.state === 'empty') {
      if (clean(item && item.sourceValue)) reminders.push(`PPT 資料庫「${label}」有輸入編號但沒有載入素材`);
      return;
    }
    if (!['loaded', 'cached'].includes(result.state)) {
      reminders.push(`PPT 資料庫「${label}」回傳未知狀態：${clean(result.state) || '空白'}`);
      return;
    }

    const pages = Array.isArray(item && item.pptPages) ? item.pptPages : [];
    if (!pages.length) {
      reminders.push(`PPT 資料庫「${label}」回報已載入，但實際投影片不存在`);
      return;
    }
    if (Number.isFinite(Number(result.pageCount)) && Number(result.pageCount) !== pages.length) {
      reminders.push(`PPT 資料庫「${label}」頁數不一致：回報 ${result.pageCount} 頁，實際 ${pages.length} 頁`);
    }
    const expectedNumber = normalizeLibraryNumber(item && item.sourceValue);
    const loadedNumber = normalizeLibraryNumber(result.entry && result.entry.number || item && item.libraryEntry && item.libraryEntry.number);
    if (expectedNumber && !loadedNumber) {
      reminders.push(`PPT 資料庫「${label}」已載入，但無法確認實際素材編號`);
    } else if (expectedNumber && expectedNumber !== loadedNumber) {
      reminders.push(`PPT 資料庫「${label}」載入編號不一致：預期 ${expectedNumber}，實際 ${loadedNumber}`);
    }
  }

  function buildMissingSourceReminders({ date, event, model, bulletinResult, libraryResults, profile } = {}) {
    const items = model && typeof model === 'object' ? model : {};
    const requirements = profile && profile.sourceRequirements || {};
    const requiredCalendarFields = requirements.calendarFields || calendarFields;
    const requiredBibleSections = requirements.bibleSections || bibleSections;
    const eventLabel = profile && profile.calendarSelector && profile.calendarSelector.typeFullName || '講道資訊－台語';
    const bibleLabel = profile && Array.isArray(profile.bibleVersions) && profile.bibleVersions.length > 1 ? '台語／華語聖經' : '台語聖經';
    const reminders = [];
    if (!event) {
      reminders.push(`行事曆：${clean(date)} 的「${eventLabel}」尚未建立`);
    } else {
      requiredCalendarFields.forEach(([sectionId, key, label]) => {
        if (!clean(items[sectionId] && items[sectionId][key])) reminders.push(`行事曆「${label}」欄位空白`);
      });
      requiredBibleSections.forEach(([sectionId, label]) => {
        const item = items[sectionId];
        if (item && Array.isArray(item.bibleErrors) && item.bibleErrors.length) {
          reminders.push(`${bibleLabel}「${label}」讀取或核對失敗：${item.bibleErrors.map(error => `${error.languageLabel || error.version ? `（${error.languageLabel || error.version}）` : ''}${error.message}`).join('；')}`);
        } else if (clean(item && item.sourceValue) && Array.isArray(item && item.bibleChecks)) {
          const failedChecks = item.bibleChecks.filter(check => ['partial', 'missing', 'unverified', 'error'].includes(check.status));
          if (failedChecks.length) {
            failedChecks.forEach(check => reminders.push(`${bibleLabel}「${label}」${check.languageLabel || check.version ? `（${check.languageLabel || check.version}）` : ''}經節核對未完成：${check.reference || clean(item.sourceValue)}；${check.message || '查詢結果與輸入範圍不一致'}`));
          } else if (!hasPages(item)) {
            reminders.push(`${bibleLabel}「${label}」查無經文：${clean(item.sourceValue)}`);
          }
        } else if (clean(item && item.sourceValue) && !hasPages(item)) {
          reminders.push(`${bibleLabel}「${label}」查無經文：${clean(item.sourceValue)}`);
        }
      });
    }

    const results = Array.isArray(libraryResults) ? libraryResults.filter(Boolean) : [];
    const targets = profile && Array.isArray(profile.librarySections) ? profile.librarySections : null;
    if (event && targets && targets.length) {
      const resultsBySection = new Map(results.map(result => [result.sectionId, result]));
      targets.forEach(([sectionId]) => {
        const result = resultsBySection.get(sectionId);
        if (!result) {
          reminders.push(`PPT 資料庫「${librarySectionLabels[sectionId] || sectionId}」沒有帶入結果`);
          return;
        }
        checkLibraryResult(result, items, reminders);
      });
    } else {
      results.forEach(result => {
        if (result.state === 'missing' || result.state === 'error') checkLibraryResult(result, items, reminders);
      });
    }

    if (bulletinResult && bulletinResult.error) {
      reminders.push(`週報內容讀取失敗：${clean(bulletinResult.error)}`);
    }

    if (requirements.reports !== false) {
      const reports = bulletinResult && bulletinResult.reports;
      if (reports && reports.state === 'missing') {
        reminders.push(`週報：reports_${clean(date)} 尚未建立`);
      } else if (reports && reports.state === 'error') {
        reminders.push(`週報「本會消息／教界消息／關懷代禱」讀取失敗：${clean(reports.message) || '原因不明'}`);
      } else if (reports && reports.state === 'loaded') {
        const reportData = items.announcements || {};
        if (!Array.isArray(reportData.announcements) || !reportData.announcements.some(clean)) reminders.push('週報「本會消息」空白');
        if (!Array.isArray(reportData.churchNews) || !reportData.churchNews.some(clean)) reminders.push('週報「教界消息」空白');
        if (!hasPrayerContent(reportData.prayer)) reminders.push('週報「關懷代禱」空白');
      }
    }

    if (requirements.praise !== false) {
      const praise = bulletinResult && bulletinResult.praise;
      if (praise && praise.state === 'missing') {
        reminders.push(`週報：praise_songs_${clean(date)} 尚未建立`);
      } else if (praise && praise.state === 'error') {
        reminders.push(`週報「讚美」讀取失敗：${clean(praise.message) || '原因不明'}`);
      } else if (praise && praise.state === 'loaded') {
        const praiseData = praise.data && typeof praise.data === 'object' ? praise.data : null;
        if (praiseData && !clean(praiseData.title)) reminders.push('週報「讚美歌名」空白');
      }
    }
    return reminders;
  }

  function formatMissingSourceReminder(reminders) {
    const items = Array.isArray(reminders) ? reminders.filter(clean) : [];
    if (!items.length) return '';
    return `提醒：請確認以下來源狀態；讀取失敗可重新帶入，空白欄位請確認當週是否有內容：\n\n${items.map(item => `• ${item}`).join('\n')}`;
  }

  return { buildMissingSourceReminders, formatMissingSourceReminder };
});
