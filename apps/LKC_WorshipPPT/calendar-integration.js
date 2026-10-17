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
      window.TaiwaneseWorshipCalendarAdapter.applyCalendarEvent(event || {}, model);
      stage = '經文';
      bibleResult = await window.generateCalendarContent();
      stage = '聖詩／啟應文';
      if (Array.isArray(profile.librarySections) && profile.librarySections.length) {
        try {
          libraryResults = await window.loadPptLibraryContent();
        } catch (error) {
          const message = error && error.message ? error.message : String(error);
          libraryResults = profile.librarySections.map(([sectionId]) => {
            const detail = `PPT 資料庫讀取失敗：${message}`;
            if (model[sectionId]) model[sectionId].libraryError = detail;
            return { sectionId, state: 'error', message: detail };
          });
        }
      }
      if (event) {
        calendarSummary = `已帶入「${eventLabel}」：${event.title || date}`;
      }
      stage = '週報';
      const bulletinResult = await bulletinPromise;
      render();
      const loadedPages = libraryResults.reduce((total, item) => total + (item.pageCount || 0), 0);
      const loadedLibraryItems = libraryResults.filter(item => ['loaded', 'cached'].includes(item.state)).length;
      const missing = libraryResults.filter(item => item.state === 'missing');
      const libraryErrors = libraryResults.filter(item => item.state === 'error');
      const usesLibrary = Array.isArray(profile.librarySections) && profile.librarySections.length > 0;
      const librarySummary = usesLibrary
        ? (event
          ? `資料庫 ${loadedPages} 頁，${loadedLibraryItems} 項已載入${missing.length ? `，${missing.length} 項找不到` : ''}${libraryErrors.length ? `，${libraryErrors.length} 項載入失敗` : ''}`
          : `資料庫 ${loadedPages} 頁，${loadedLibraryItems} 項已載入；找不到行事曆資料`)
        : '此模板不使用聖詩／啟應文資料庫';
      const bulletinSummary = window.describeBulletinPptContent(bulletinResult);
      const bibleErrors = bibleResult && Array.isArray(bibleResult.errors) ? bibleResult.errors : [];
      const bibleChecks = (Array.isArray(profile.bibleSections) ? profile.bibleSections : [])
        .flatMap(config => Array.isArray(model[config.sectionId] && model[config.sectionId].bibleChecks)
          ? model[config.sectionId].bibleChecks
          : []);
      const verifiedBibleChecks = bibleChecks.filter(check => check.status === 'verified').length;
      const bibleCheckSummary = event ? `；經節核對 ${verifiedBibleChecks}/${bibleChecks.length} 組範圍完整` : '';
      const bibleSummary = bibleErrors.length
        ? `；聖經核對提醒：${bibleErrors.map(error => `${error.label || error.sectionId || '未知區段'}${error.version ? `(${error.version})` : ''}：${error.message}`).join('；')}`
        : '';
      const reminderApi = window.TaiwaneseWorshipSourceReminders;
      const reminders = reminderApi && typeof reminderApi.buildMissingSourceReminders === 'function'
        ? reminderApi.buildMissingSourceReminders({ date, event, model, bulletinResult, libraryResults, profile })
        : [];
      const sourceCheckSummary = !reminderApi || typeof reminderApi.buildMissingSourceReminders !== 'function'
        ? '；來源核對器未載入，請重新整理頁面'
        : (reminders.length
          ? `；來源核對發現 ${reminders.length} 項缺漏或讀取問題`
          : '；來源核對完成，適用內容均已載入');
      status(`${calendarSummary}；${librarySummary}；${bulletinSummary}${bibleCheckSummary}${bibleSummary}${sourceCheckSummary}`);
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
