(function(root) {
  const api = root.TaiwaneseWorshipBulletinContent;
  const endpoint = 'https://script.google.com/macros/s/AKfycbyLLQZsz_XZqhWVwaT_8hcvfQc8fSWztAncEmBUk7lnzGr-TcP33uzS-weUG_cavgEn/exec';

  root.loadBulletinPptContent = async function(date) {
    const profile = root.activeWorshipTemplateProfile || {};
    const requirements = profile.sourceRequirements || {};
    const loadRecord = async kind => {
      return api.loadCloudRecord(endpoint, kind, date, root.fetch.bind(root));
    };
    const reportsPromise = requirements.reports === false
      ? Promise.resolve({ state: 'skipped' })
      : loadRecord('reports');
    const praisePromise = requirements.praise === false
      ? Promise.resolve({ state: 'skipped' })
      : loadRecord('praise');
    const [reportsOutcome, praiseOutcome] = await Promise.allSettled([reportsPromise, praisePromise]);
    const toSourceResult = outcome => {
      if (outcome.status === 'fulfilled') return outcome.value;
      const reason = outcome.reason;
      return {
        state: 'error',
        error: reason && reason.message ? reason.message : String(reason || '未知錯誤')
      };
    };
    const reportsResult = toSourceResult(reportsOutcome);
    const praiseResult = toSourceResult(praiseOutcome);
    if (reportsResult.state === 'loaded' && model.announcements) {
      api.applyReportsToModel(model, reportsResult.data);
      if (typeof root.reflowReportPagesForLayout === 'function') root.reflowReportPagesForLayout();
    }
    if (praiseResult.state === 'loaded' && model.praise) api.applyPraiseToModel(model, praiseResult.data);
    return {
      reports: reportsResult,
      praise: praiseResult,
      reportPageCount: reportsResult.state === 'loaded' && model.announcements
        ? (Array.isArray(model.announcements.pptPages) ? model.announcements.pptPages.length : 0) + 1
        : 0,
      praisePageCount: praiseResult.state === 'loaded' && model.praise
        ? 1 + (model.praise.performanceType === 'instrumental' ? 0 : String(model.praise.body || '').split(/\n\s*\n/).filter(Boolean).length)
        : 0
    };
  };

  root.describeBulletinPptContent = function(result) {
    if (!result || result.error) return `週報資料讀取失敗：${result && result.error ? result.error : '未知錯誤'}`;
    const describeSource = (label, source, loadedText, missingText) => {
      if (source.state === 'error') return label + '讀取失敗：' + (source.error || '未知錯誤');
      return source.state === 'loaded' ? loadedText : missingText;
    };
    const parts = [];
    if (result.reports && result.reports.state !== 'skipped') {
      parts.push(describeSource('報告', result.reports, '報告 ' + result.reportPageCount + ' 頁', '報告無資料'));
    }
    if (result.praise && result.praise.state !== 'skipped') {
      parts.push(describeSource('讚美', result.praise, '讚美 ' + result.praisePageCount + ' 頁', '讚美無資料'));
    }
    return parts.join('、');
  };

  const previousEditor = editor;
  editor = function() {
    if (active !== 'announcements') return previousEditor();
    const item = model.announcements;
    const form = document.getElementById('editor-form');
    const reports = api.normalizeReports({ announcements: item.announcements, churchNews: item.churchNews, prayer: item.prayer });
    form.innerHTML = [
      '<div class="inline-note">依禮拜日期從週報系統帶入，並依序分成「本會消息」、「教界消息」與「關懷代禱」。仍可在此手動修改。</div>',
      field('本會消息（每則消息之間空一行）', 'reportAnnouncements', reports.announcements.join('\n\n'), 'textarea'),
      field('教界消息（每則消息之間空一行）', 'reportChurchNews', reports.churchNews.join('\n\n'), 'textarea'),
      '<div class="inline-note">關懷代禱</div>',
      field('在家調養兄姐', 'prayerHomeRest', reports.prayer.homeRest, 'textarea'),
      field('住院', 'prayerHospital', reports.prayer.hospital, 'textarea'),
      field('其他代禱', 'prayerOther', reports.prayer.other, 'textarea')
    ].join('');

    form.querySelectorAll('[data-key]').forEach(element => {
      element.oninput = () => {
        api.applyReportsToModel(model, {
          announcements: form.querySelector('[data-key="reportAnnouncements"]').value.split(/\n\s*\n/),
          churchNews: form.querySelector('[data-key="reportChurchNews"]').value.split(/\n\s*\n/),
          prayer: {
            homeRest: form.querySelector('[data-key="prayerHomeRest"]').value,
            hospital: form.querySelector('[data-key="prayerHospital"]').value,
            other: form.querySelector('[data-key="prayerOther"]').value
          }
        });
        if (typeof root.reflowReportPagesForLayout === 'function') root.reflowReportPagesForLayout();
        preview();
        flow();
      };
    });
  };
  render();
})(window);
