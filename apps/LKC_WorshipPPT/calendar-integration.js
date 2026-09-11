(function() {
  const button = document.getElementById('calendar-load');
  button.onclick = async function() {
    const date = document.getElementById('service-date').value;
    const profile = window.activeWorshipTemplateProfile || {};
    const eventLabel = profile.calendarSelector && profile.calendarSelector.typeFullName || '講道資訊-台語';
    if (!date) return status('請先選擇禮拜日期');
    let stage = '行事曆';
    try {
      button.disabled = true;
      status('正在讀取行事曆與週報資料…');
      const bulletinPromise = window.loadBulletinPptContent
        ? window.loadBulletinPptContent(date).catch(error => ({ error: error.message }))
        : Promise.resolve({ error: '週報讀取模組未載入' });
      const result = await window.worshipReadAPI('cal_getEvents', { startDate: date, endDate: date });
      const events = Array.isArray(result && result.data) ? result.data : [];
      const event = window.TaiwaneseWorshipCalendarAdapter.selectSermonEvent(events, date, profile.calendarSelector);
      let calendarSummary = `找不到 ${date} 的「${eventLabel}」資料`;
      let libraryResults = [];
      let bibleResult = { errors: [] };
      if (event) {
        window.TaiwaneseWorshipCalendarAdapter.applyCalendarEvent(event, model);
        stage = '經文';
        bibleResult = await window.generateCalendarContent();
        stage = '聖詩／啟應文';
        libraryResults = Array.isArray(profile.librarySections) && profile.librarySections.length
          ? await window.loadPptLibraryContent()
          : [];
        calendarSummary = `已帶入「${eventLabel}」：${event.title || date}`;
      }
      stage = '週報';
      const bulletinResult = await bulletinPromise;
      render();
      const loadedPages = libraryResults.reduce((total, item) => total + (item.pageCount || 0), 0);
      const missing = libraryResults.filter(item => item.state === 'missing');
      const usesLibrary = Array.isArray(profile.librarySections) && profile.librarySections.length > 0;
      const librarySummary = usesLibrary
        ? (event ? `資料庫 ${loadedPages} 頁${missing.length ? `，${missing.length} 項找不到` : ''}` : '未載入聖詩／啟應文')
        : '此模板不使用聖詩／啟應文資料庫';
      const bulletinSummary = window.describeBulletinPptContent(bulletinResult);
      const bibleErrors = bibleResult && Array.isArray(bibleResult.errors) ? bibleResult.errors : [];
      const bibleSummary = bibleErrors.length
        ? `；聖經部分失敗：${bibleErrors.map(error => `${error.label || error.sectionId || '未知區段'}${error.version ? `(${error.version})` : ''}：${error.message}`).join('；')}`
        : '';
      status(`${calendarSummary}；${librarySummary}；${bulletinSummary}${bibleSummary}`);
      const reminderApi = window.TaiwaneseWorshipSourceReminders;
      const reminders = reminderApi && typeof reminderApi.buildMissingSourceReminders === 'function'
        ? reminderApi.buildMissingSourceReminders({ date, event, model, bulletinResult, libraryResults, profile })
        : [];
      if (reminders.length && typeof window.alert === 'function') {
        window.alert(reminderApi.formatMissingSourceReminder(reminders));
      }
    } catch (error) {
      status(`${stage}帶入失敗：${error.message}`);
    } finally {
      button.disabled = false;
    }
  };
})();
