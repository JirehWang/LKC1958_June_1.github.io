(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TaiwaneseWorshipSourceReminders = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
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
          reminders.push(`${bibleLabel}「${label}」讀取失敗，請重新帶入：${item.bibleErrors.map(error => error.message).join('；')}`);
        } else if (clean(item && item.sourceValue) && !hasPages(item)) {
          reminders.push(`${bibleLabel}「${label}」查無經文：${clean(item.sourceValue)}`);
        }
      });
    }

    (Array.isArray(libraryResults) ? libraryResults : []).forEach(result => {
      if (result && result.state === 'missing') {
        reminders.push(`PPT 資料庫找不到「${librarySectionLabels[result.sectionId] || result.sectionId}」素材`);
      }
    });

    if (requirements.reports !== false) {
      const reports = bulletinResult && bulletinResult.reports;
      if (reports && reports.state === 'missing') {
        reminders.push(`週報：reports_${clean(date)} 尚未建立`);
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
      } else if (praise && praise.state === 'loaded') {
        const praiseData = praise.data && typeof praise.data === 'object' ? praise.data : null;
        const instrumental = praiseData && praiseData.performanceType === 'instrumental';
        if (praiseData && !clean(praiseData.title)) reminders.push('週報「讚美歌名」空白');
        if (instrumental) {
          const hasInstrumentalDetails = [praiseData.tune, praiseData.arrangement, praiseData.performers, praiseData.kicker].some(clean);
          if (!hasInstrumentalDetails) reminders.push('週報「讚美演奏資訊」空白');
        } else if (!clean(items.praise && items.praise.body)) {
          reminders.push('週報「讚美歌詞」空白');
        }
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
