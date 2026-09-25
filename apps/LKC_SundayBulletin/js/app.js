// 主應用控制器 - 教會週報管理系統

const UPLOADED_REPORT_FIELD_COUNT = 10;

function normalizeUploadedText(value) {
  return value == null ? '' : String(value).trim();
}

function normalizeUploadedPraise(data) {
  const source = data && typeof data === 'object' ? data : {};
  return {
    title: normalizeUploadedText(source.title),
    performanceType: source.performanceType === 'instrumental' ? 'instrumental' : 'vocal',
    kicker: normalizeUploadedText(source.kicker),
    tune: normalizeUploadedText(source.tune),
    arrangement: normalizeUploadedText(source.arrangement),
    performers: normalizeUploadedText(source.performers),
    lyrics: normalizeUploadedText(source.lyrics)
  };
}

function hasUploadedPraiseData(praise) {
  return Boolean(praise && [
    praise.title, praise.lyrics, praise.tune, praise.arrangement, praise.performers
  ].some(value => normalizeUploadedText(value)));
}

function normalizeUploadedReports(data) {
  const source = data && typeof data === 'object' ? data : {};
  const prayer = source.prayer && typeof source.prayer === 'object' ? source.prayer : {};
  const normalizeList = value => {
    const list = Array.isArray(value) ? value : [];
    return Array.from({ length: UPLOADED_REPORT_FIELD_COUNT }, (_, index) => normalizeUploadedText(list[index]));
  };

  return {
    announcements: normalizeList(source.announcements),
    churchNews: normalizeList(source.churchNews),
    prayer: {
      homeRest: normalizeUploadedText(prayer.homeRest),
      hospital: normalizeUploadedText(prayer.hospital),
      other: normalizeUploadedText(prayer.other)
    }
  };
}

const App = {
  _autoSaveTimer: null,
  _els: null,  // 啟動時一次性快取常用 DOM 節點

  async init() {
    debug('[App] 初始化教會週報管理系統...');

    // 快取熱點 DOM，避免反覆 getElementById
    this._els = {
      bulletinDate:               document.getElementById('bulletinDate'),
      dateDisplay:                document.getElementById('dateDisplay'),
      serviceTypePrimary:         document.getElementById('serviceTypePrimary'),
      serviceTypeSecondary:       document.getElementById('serviceTypeSecondary'),
      serviceTypeSecondaryWrap:   document.getElementById('serviceTypeSecondaryWrap')
    };

    const today = new Date();
    const daysToSunday = today.getDay() === 0 ? 0 : 7 - today.getDay();
    const nextSunday = new Date(today);
    nextSunday.setDate(today.getDate() + daysToSunday);
    const sundayStr = formatYMD(nextSunday);

    this._els.bulletinDate.value = sundayStr;
    BulletinModel.init(sundayStr);

    this._els.bulletinDate.addEventListener('change', e => {
      BulletinModel.set('date', e.target.value);
      this.updateDateDisplay();
    });

    this.initTabs();
    this.initFormFields();
    if (window.AnnouncementReorder) window.AnnouncementReorder.init(document);
    this.initButtons();
    this.initServiceTypeSelector();
    this.updateDateDisplay();
    this.syncFormFromModel();
    this.updateSupabaseBadge();
    DraftManager.startAutoSave(() => BulletinModel.get());
    this.showToast('系統已就緒，歡迎使用教會週報管理系統', 'success');
  },

  updateDateDisplay() {
    const date = this._els.bulletinDate.value;
    if (date) {
      const d = new Date(date + 'T00:00:00');
      this._els.dateDisplay.textContent =
        `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日`;

      const nextD = new Date(d);
      nextD.setDate(d.getDate() + 7);
      BulletinModel.set('ministry.thisWeek.date', date);
      BulletinModel.set('ministry.nextWeek.date', formatYMD(nextD));
    }
  },

  updateSupabaseBadge() {
    const badge = document.getElementById('supabaseStatusBadge');
    if (!badge) return;
    const sb = (typeof window !== 'undefined' && window.SundayBulletinSupabaseService && window.SundayBulletinSupabaseService.getClient());
    if (sb) {
      badge.textContent = '⚡ Supabase 已連線';
      badge.style.background = 'rgba(39, 174, 96, 0.2)';
      badge.style.borderColor = '#27ae60';
      badge.style.color = '#dcfce7';
      badge.title = 'Supabase 雲端資料庫已就緒 (<50ms)';
    } else {
      badge.textContent = '☁️ 本地/GAS 模式';
      badge.style.background = 'rgba(234, 179, 8, 0.2)';
      badge.style.borderColor = '#eab308';
      badge.style.color = '#fef08a';
      badge.title = '尚未載入 Supabase 設定，使用本地快取與 GAS';
    }
  },

  initTabs() {
    document.querySelectorAll('.tab-btn').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(`tab-${tab.dataset.tab}`)?.classList.add('active');
      });
    });
  },

  initFormFields() {
    document.addEventListener('input', e => {
      const f = e.target.dataset.field;
      if (!f) return;
      BulletinModel.set(f, e.target.value);
      if (f === 'taiwanese.goldenVerse' || f === 'mandarin.goldenVerse') {
        const textField = f.replace('.goldenVerse', '.goldenVerseText');
        BulletinModel.set(textField, '');
        const textEl = document.querySelector(`[data-field="${textField}"]`);
        if (textEl) textEl.value = '';
      }
    });
    document.addEventListener('change', e => { const f = e.target.dataset.field; if (f) BulletinModel.set(f, e.target.value); });
    
    // 經文輸入框失去焦點時自動標準化格式
    document.addEventListener('blur', async e => {
      const f = e.target.dataset.field;
      if (f && (f === 'taiwanese.scripture' || f === 'mandarin.scripture' || f === 'taiwanese.callToWorship' || f === 'taiwanese.goldenVerse' || f === 'mandarin.goldenVerse')) {
        if (window.BibleFormatter) {
          const formatted = window.BibleFormatter.format(e.target.value);
          if (formatted !== e.target.value) {
            e.target.value = formatted;
            BulletinModel.set(f, formatted);
            this.showToast('經文格式已自動轉換為標準格式', 'success');
          }
          if (f === 'taiwanese.goldenVerse' || f === 'mandarin.goldenVerse') {
            await this.autoFillGoldenVerseText();
          }
        }
      }
    }, true);
  },

  // 禮拜類型選擇器：台華語 / 聯合(台語程序) / 聯合(華語程序)
  initServiceTypeSelector() {
    const { serviceTypePrimary: primary, serviceTypeSecondary: secondary, serviceTypeSecondaryWrap: secWrap } = this._els;
    if (!primary || !secondary || !secWrap) return;

    const onChange = async () => {
      secWrap.style.display = (primary.value === '聯合') ? '' : 'none';
      const t = this.computeServiceType();
      BulletinModel.set('serviceType', t);
      this.applyServiceMode(t);
      await this.autoFillGoldenVerseText();
    };
    primary.addEventListener('change', onChange);
    secondary.addEventListener('change', onChange);
  },

  computeServiceType() {
    const { serviceTypePrimary: p, serviceTypeSecondary: s } = this._els;
    if (!p) return '台華語';
    if (p.value === '台華語') return '台華語';
    return '聯合-' + (s?.value || '台語');
  },

  applyServiceMode(t) {
    const grid = document.querySelector('.service-grid');
    if (grid) {
      grid.classList.remove('mode-tw-zh', 'mode-united-tw', 'mode-united-zh');
      if (t === '聯合-台語')      grid.classList.add('mode-united-tw');
      else if (t === '聯合-華語') grid.classList.add('mode-united-zh');
      else                         grid.classList.add('mode-tw-zh');
    }

    const twTitle = document.querySelector('.tw-column h4');
    const zhTitle = document.querySelector('.zh-column h4');
    if (t === '聯合-台語') {
      if (twTitle) twTitle.textContent = '聯合主日禮拜（以台語程序）';
    } else if (t === '聯合-華語') {
      if (zhTitle) zhTitle.textContent = '聯合主日禮拜（以華語程序）';
    } else {
      if (twTitle) twTitle.textContent = '台語主日禮拜（一樓）';
      if (zhTitle) zhTitle.textContent = '華語主日禮拜（三樓）';
    }
  },

  // 從模型同步選擇器狀態（載入草稿時呼叫）
  syncServiceTypeFromModel(t) {
    const { serviceTypePrimary: primary, serviceTypeSecondary: secondary, serviceTypeSecondaryWrap: secWrap } = this._els;
    if (!primary || !secondary || !secWrap) return;
    if (t === '聯合-台語') {
      primary.value = '聯合';   secondary.value = '台語'; secWrap.style.display = '';
    } else if (t === '聯合-華語') {
      primary.value = '聯合';   secondary.value = '華語'; secWrap.style.display = '';
    } else {
      primary.value = '台華語'; secondary.value = '台語'; secWrap.style.display = 'none';
    }
    this.applyServiceMode(t || '台華語');
  },

  initButtons() {
    document.getElementById('btnFetchAll')   ?.addEventListener('click', () => this.fetchAll());
    document.getElementById('btnSaveDraft')  ?.addEventListener('click', () => this.saveDraft());
    document.getElementById('btnLoadDraft')  ?.addEventListener('click', () => this.showDraftModal());
    document.getElementById('btnExportWord') ?.addEventListener('click', () => this.exportWord());
    document.getElementById('btnAddOffering')?.addEventListener('click', () => this.addOfferingRow());
    document.getElementById('btnAddEvent')   ?.addEventListener('click', () => this.addEventRow());
    document.getElementById('modalClose')    ?.addEventListener('click', () => this.hideDraftModal());
    document.getElementById('modalOverlay')  ?.addEventListener('click', e => { if (e.target === e.currentTarget) this.hideDraftModal(); });
  },

  // 全部帶入：依序觸發每一個分頁的自動帶入按鈕
  async fetchAll() {
    const date = this._els.bulletinDate.value;
    if (!date) { this.showToast('請先選擇日期', 'error'); return; }
    this.showLoading(true);
    this.showToast('正在觸發各分頁的自動帶入...', 'info');

    const tasks = [
      { name: '主日程序', fn: () => this.fetchServiceProgram({ silent: true }) },
      { name: '服事人員', fn: () => this.fetchMinistry      ({ silent: true }) },
      { name: '聚會人數', fn: () => this.fetchAttendanceTab ({ silent: true }) },
      { name: '上傳讚美', fn: () => this.loadUploadedChoirSong({ silent: true }) },
      { name: '上傳報告', fn: () => this.loadUploadedReports  ({ silent: true }) }
      // 活動預告：fetchServiceProgram 已透過 fetchCalendarForDate 帶入未來活動，無須重複呼叫
    ];

    try {
      const results = await Promise.allSettled(tasks.map(t => t.fn()));
      const failed = results
        .map((r, i) => (r.status === 'rejected' || (r.value && r.value.failed && r.value.failed.length))
          ? `${tasks[i].name}（${r.status === 'rejected' ? r.reason?.message : r.value.failed.join('、')}）`
          : null)
        .filter(Boolean);
      this.showToast(
        failed.length ? `帶入完成，下列項目需手動確認：${failed.join('；')}` : '全部資料帶入完成',
        failed.length ? 'warning' : 'success'
      );
    } catch (err) {
      this.showToast('帶入失敗：' + err.message, 'error');
    } finally {
      this.showLoading(false);
    }
  },

  async fetchServiceProgram(opts = {}) {
    const silent = opts.silent === true;
    const date = this._els.bulletinDate.value;
    if (!date) { if (!silent) this.showToast('請先選擇日期', 'error'); return { failed: ['未選擇日期'] }; }
    if (!silent) { this.showLoading(true); this.showToast('正在帶入主日程序資料...', 'info'); }
    try {
      const [calR, svcR, songsR] = await Promise.allSettled([
        ChurchAPI.fetchCalendarForDate(date),
        ChurchAPI.fetchServiceSchedule(date),
        ChurchAPI.fetchWorshipSongs(date)
      ]);
      const v = s => s.status === 'fulfilled' ? s.value : { success: false, error: s.reason?.message };
      const calResult   = v(calR);
      const svcResult   = v(svcR);
      const songsResult = v(songsR);

      BulletinModel.applyAPIData({ calendar: calResult, service: svcResult, worshipSongs: songsResult });
      
      if (calResult.success && calResult.data) {
        const tw = calResult.data.taiwanese;
        const zh = calResult.data.mandarin;
        const isUnited = (tw && (String(tw.category || '').includes('聯合') || String(tw.name || '').includes('聯合')))
                      || (zh && (String(zh.category || '').includes('聯合') || String(zh.name || '').includes('聯合')));
        if (isUnited) {
          const currentType = BulletinModel.get().serviceType;
          const targetType = currentType?.startsWith('聯合') ? currentType : '聯合-台語';
          BulletinModel.set('serviceType', targetType);
        } else {
          const currentType = BulletinModel.get().serviceType;
          if (currentType?.startsWith('聯合')) {
            BulletinModel.set('serviceType', '台華語');
          }
        }
      }

      this.syncFormFromModel();
      await this.autoFillGoldenVerseText();
      const msgs = [];
      if (!calResult.success) msgs.push(`行事曆失敗: ${calResult.error}`);
      else if (!calResult.data?.taiwanese && !calResult.data?.mandarin) msgs.push(`找不到 ${date} 的講道資訊`);
      if (!svcResult.success) msgs.push(`服事排班失敗: ${svcResult.error}`);
      if (!songsResult.success) msgs.push(`敬拜曲目失敗: ${songsResult.error}`);
      if (!silent) this.showToast(msgs.length ? msgs.join('；') : '主日程序資料帶入完成', msgs.length ? 'warning' : 'success');
      return { failed: msgs };
    } catch (err) {
      if (!silent) this.showToast('帶入失敗：' + err.message, 'error');
      return { failed: [err.message] };
    } finally {
      if (!silent) this.showLoading(false);
    }
  },

  async fetchMinistry(opts = {}) {
    const silent = opts.silent === true;
    const date = this._els.bulletinDate.value;
    if (!date) { if (!silent) this.showToast('請先選擇日期', 'error'); return { failed: ['未選擇日期'] }; }

    const nextD = new Date(date + 'T00:00:00');
    nextD.setDate(nextD.getDate() + 7);
    const nextDate = formatYMD(nextD);

    if (!silent) { this.showLoading(true); this.showToast('正在帶入服事人員資料（本週 + 下週）...', 'info'); }
    try {
      const [calS, svcS, worS, nextCalS, nextSvcS, nextWorS] = await Promise.allSettled([
        ChurchAPI.fetchCalendarForDate(date),
        ChurchAPI.fetchServiceSchedule(date),
        ChurchAPI.fetchWorshipSchedule(date),
        ChurchAPI.fetchCalendarForDate(nextDate),
        ChurchAPI.fetchServiceSchedule(nextDate, true),
        ChurchAPI.fetchWorshipSchedule(nextDate, true)
      ]);
      const v = s => s.status === 'fulfilled' ? s.value : { success: false, error: s.reason?.message };

      BulletinModel.applyAPIData(      { calendar: v(calS),     service: v(svcS),     worship: v(worS)     });
      BulletinModel.applyNextWeekAPIData({ calendar: v(nextCalS), service: v(nextSvcS), worship: v(nextWorS) });
      this.syncFormFromModel();

      const failed = [
        !v(svcS).success    && `本週服事排班（${v(svcS).error    || ''}）`,
        !v(worS).success    && `本週敬拜團（${v(worS).error      || ''}）`,
        !v(nextSvcS).success && `下週服事排班（${v(nextSvcS).error || ''}）`,
        !v(nextWorS).success && `下週敬拜團（${v(nextWorS).error  || ''}）`
      ].filter(Boolean);
      if (!silent) this.showToast(
        failed.length ? `帶入完成，請手動確認：${failed.join('、')}` : '服事人員資料帶入完成（本週＋下週）',
        failed.length ? 'warning' : 'success'
      );
      return { failed };
    } catch (err) {
      if (!silent) this.showToast('帶入失敗：' + err.message, 'error');
      return { failed: [err.message] };
    } finally {
      if (!silent) this.showLoading(false);
    }
  },

  async fetchSection(section, opts = {}) {
    const silent = opts.silent === true;
    const date = this._els.bulletinDate.value;
    if (!date) { if (!silent) this.showToast('請先選擇日期', 'error'); return { failed: ['未選擇日期'] }; }
    if (!silent) this.showLoading(true);
    try {
      const map = {
        calendar:    () => ChurchAPI.fetchCalendarForDate(date),
        service:     () => ChurchAPI.fetchServiceSchedule(date),
        worship:     () => ChurchAPI.fetchWorshipSchedule(date),
        attendance:  () => ChurchAPI.fetchAttendance(date),
        smallGroups: () => ChurchAPI.fetchSmallGroups(date)
      };
      const result = await map[section]();
      if (result.success) {
        BulletinModel.applyAPIData({ [section]: result });
        this.syncFormFromModel();
        if (!silent) this.showToast('資料帶入完成', 'success');
        return { failed: [] };
      } else {
        const msg = result.error || '未知錯誤';
        if (!silent) this.showToast('帶入失敗：' + msg, 'error');
        return { failed: [msg] };
      }
    } catch (err) {
      if (!silent) this.showToast('帶入失敗：' + err.message, 'error');
      return { failed: [err.message] };
    } finally {
      if (!silent) this.showLoading(false);
    }
  },

  // 聚會統計 tab：同時帶入出席人數 + 小組人數，皆以主日日期為參照
  async fetchAttendanceTab(opts = {}) {
    const silent = opts.silent === true;
    const date = this._els.bulletinDate.value;
    if (!date) { if (!silent) this.showToast('請先選擇日期', 'error'); return { failed: ['未選擇日期'] }; }
    if (!silent) { this.showLoading(true); this.showToast(`正在帶入聚會人數（參照主日 ${date}）...`, 'info'); }
    try {
      const [attR, sgR] = await Promise.allSettled([
        ChurchAPI.fetchAttendance(date),
        ChurchAPI.fetchSmallGroups(date)
      ]);
      const v = s => s.status === 'fulfilled' ? s.value : { success: false, error: s.reason?.message };
      const attendance  = v(attR);
      const smallGroups = v(sgR);

      BulletinModel.applyAPIData({ attendance, smallGroups });
      this.syncFormFromModel();

      const failed = [
        !attendance.success  && `出席人數（${attendance.error  || '未知錯誤'}）`,
        !smallGroups.success && `小組人數（${smallGroups.error || '未知錯誤'}）`
      ].filter(Boolean);
      if (!silent) this.showToast(
        failed.length ? `帶入完成，請手動確認：${failed.join('、')}` : '聚會人數資料帶入完成',
        failed.length ? 'warning' : 'success'
      );
      return { failed };
    } catch (err) {
      if (!silent) this.showToast('帶入失敗：' + err.message, 'error');
      return { failed: [err.message] };
    } finally {
      if (!silent) this.showLoading(false);
    }
  },

  async saveDraft() {
    try {
      const saved = await DraftManager.save(BulletinModel.get());
      this.showToast(saved ? '草稿已儲存' : '儲存失敗，請確認已選擇日期', saved ? 'success' : 'error');
    } catch (err) {
      this.showToast('草稿儲存失敗：' + err.message, 'error');
    }
  },

  async showDraftModal() {
    const list = document.getElementById('draftList');
    list.innerHTML = '<div class="empty-state">載入中...</div>';
    document.getElementById('modalOverlay').classList.add('show');
    try {
      const drafts = await DraftManager.list();
      list.innerHTML = '';
      if (!drafts || drafts.length === 0) {
        list.innerHTML = '<div class="empty-state">尚無已儲存的草稿</div>';
        return;
      }
      drafts.forEach(draft => {
        const item = document.createElement('div');
        item.className = 'draft-item';
        item.innerHTML = `
          <div class="draft-info">
            <strong>${draft.date}</strong>
            <span class="draft-preview">${draft.preview || ''}</span>
            <small>最後儲存：${new Date(draft.updatedAt).toLocaleString('zh-TW')}</small>
          </div>
          <div class="draft-actions">
            <button class="btn-sm btn-primary" onclick="App.loadDraft('${draft.date}')"> 載入</button>
            <button class="btn-sm btn-danger"  onclick="App.deleteDraft('${draft.date}')"> 刪除</button>
          </div>`;
        list.appendChild(item);
      });
    } catch (err) {
      list.innerHTML = `<div class="empty-state">載入失敗：${err.message}</div>`;
    }
  },

  hideDraftModal() { document.getElementById('modalOverlay').classList.remove('show'); },

  async loadDraft(date) {
    try {
      const data = await DraftManager.load(date);
      if (!data) { this.showToast('載入失敗', 'error'); return; }
      BulletinModel._current = data;
      this._els.bulletinDate.value = data.date;
      this.syncFormFromModel();
      await this.autoFillGoldenVerseText();
      this.hideDraftModal();
      this.showToast(`草稿 ${date} 已載入`, 'success');
    } catch (err) { this.showToast('載入草稿失敗：' + err.message, 'error'); }
  },

  async deleteDraft(date) {
    if (!confirm(`確定要刪除 ${date} 的草稿？`)) return;
    try {
      await DraftManager.delete(date);
      this.showDraftModal();
      this.showToast('草稿已刪除', 'success');
    } catch (err) { this.showToast('刪除失敗：' + err.message, 'error'); }
  },

  async exportWord() {
    const data = BulletinModel.get();
    if (!data.date) { this.showToast('請先選擇日期', 'error'); return; }
    this.showLoading(true);
    this.showToast('正在產生 Word 文件...', 'info');
    try {
      const filename = await BulletinExport.generate(data);
      this.showToast(`Word 文件已下載：${filename}`, 'success');
    } catch (err) {
      this.showToast('匯出失敗：' + err.message, 'error');
    } finally {
      this.showLoading(false);
    }
  },

  syncFormFromModel() {
    const data = BulletinModel.get();
    document.querySelectorAll('[data-field]').forEach(el => {
      const v = el.dataset.field.split('.').reduce((o, k) => o?.[k], data);
      if (v !== undefined && v !== null) el.value = String(v);
    });
    this.syncServiceTypeFromModel(data.serviceType || '台華語');
    this.syncSmallGroupsUI(data.attendance?.smallGroups || {});
    this.syncEventsUI(data.events || []);
    this.syncOfferingUI(data.offeringReport?.monthlyItems || []);
  },

  async autoFillGoldenVerseText() {
    await Promise.all([
      this._autoFillGoldenVerseTextFor('taiwanese', 'tghg'),
      this._autoFillGoldenVerseTextFor('mandarin', 'unv')
    ]);
  },

  async _autoFillGoldenVerseTextFor(language, defaultVersion) {
    const inputEl = document.querySelector(`[data-field="${language}.goldenVerse"]`);
    const textEl = document.querySelector(`[data-field="${language}.goldenVerseText"]`);
    const service = BulletinModel.get()[language] || {};
    const rawValue = (inputEl?.value || service.goldenVerse || '').trim();

    if (!rawValue) {
      BulletinModel.set(`${language}.goldenVerseText`, '');
      if (textEl) textEl.value = '';
      return;
    }

    const inlineTextMatch = rawValue.match(/^([^（(]+)[（(]([^)）]+)[)）]$/);
    const rawReference = inlineTextMatch ? inlineTextMatch[1].trim() : rawValue;
    const inlineText = inlineTextMatch ? inlineTextMatch[2].trim() : '';
    const reference = window.BibleFormatter
      ? window.BibleFormatter.format(rawReference).trim()
      : rawReference;

    if (inputEl && inputEl.value !== reference) inputEl.value = reference;
    BulletinModel.set(`${language}.goldenVerse`, reference);
    if (inlineText) {
      BulletinModel.set(`${language}.goldenVerseText`, inlineText);
      if (textEl) textEl.value = inlineText;
      return;
    }

    if (service.goldenVerseText && service.goldenVerseText.trim()) {
      if (textEl) textEl.value = service.goldenVerseText;
      return;
    }

    let bookRegexPart = null;
    if (window.BibleFormatter && typeof window.BibleFormatter.bookRegexPart === 'string') {
      bookRegexPart = window.BibleFormatter.bookRegexPart;
    }
    const refPattern = bookRegexPart
      ? new RegExp(`^(${bookRegexPart})\\s*(\\d+):(\\d+)(?:-(\\d+))?$`)
      : /^([^\d\s:]+)\s*(\d+):(\d+)(?:-(\d+))?$/;
    const match = reference.match(refPattern);
    if (!match) return;

    const book = match[1];
    const chap = match[2];
    const startSec = match[3];
    const sec = match[4] ? `${startSec}-${match[4]}` : startSec;

    try {
      const isUnited = BulletinModel.get().serviceType?.startsWith('聯合');
      const versions = isUnited ? ['tghg', 'unv'] : [defaultVersion];
      const results = await Promise.all(versions.map(version => ChurchAPI.queryBible(book, chap, sec, version)));
      const texts = results
        .filter(result => result?.success && Array.isArray(result.records))
        .map(result => result.records.map(record => String(record.text || '').replace(/<[^>]+>/g, '').trim()).join(' '))
        .filter(Boolean);
      const text = isUnited && texts.length > 1
        ? `台：${texts[0]}\n華：${texts[1]}`
        : (texts[0] || '');
      if (text) {
        BulletinModel.set(`${language}.goldenVerseText`, text);
        if (textEl) textEl.value = text;
        if (language === 'taiwanese') this.showToast('金句全文已自動填入！', 'success');
      }
    } catch (err) {
      console.error('[autoFillGoldenVerseText]', err);
    }
  },

  // 動態渲染小組欄位（內容由 API 或 model 決定）
  syncSmallGroupsUI(groups) {
    const container = document.getElementById('smallGroupsContainer');
    if (!container) return;
    const entries = Object.entries(groups);
    if (entries.length === 0) {
      container.innerHTML = '<div style="padding:16px;color:#999;text-align:center;width:100%">點擊「⬇ 自動帶入」從 LKC_Attendance 與 LKGroup 自動載入</div>';
      return;
    }
    container.innerHTML = '';
    entries.forEach(([name, count]) => {
      const div = document.createElement('div');
      div.className = 'small-group-item';
      const displayValue = count === null || count === undefined || count === '' ? '無資料' : String(count);
      div.innerHTML = `<label>${name}</label><input type="text" inputmode="numeric" data-group="${name}" value="${displayValue}" onchange="App._updateGroup('${name}', this.value)">`;
      container.appendChild(div);
    });
  },

  syncEventsUI(events) {
    const c = document.getElementById('eventsContainer'); if (!c) return;
    c.innerHTML = ''; events.forEach((ev, i) => this.addEventRow(ev, i));
  },

  syncOfferingUI(items) {
    const c = document.getElementById('offeringContainer'); if (!c) return;
    c.innerHTML = ''; items.forEach((item, i) => this.addOfferingRow(item, i));
  },

  addEventRow(ev = null, idx = null) {
    const c = document.getElementById('eventsContainer'); if (!c) return;
    const i = idx !== null ? idx : c.children.length;
    const div = document.createElement('div'); div.className = 'dynamic-row'; div.dataset.idx = i;
    div.innerHTML = `
      <input type="date" class="form-input" value="${ev?.date||""}" onchange="App._updateEvent(${i},'date',this.value)">
      <input type="text" class="form-input" value="${ev?.name||""}" oninput="App._updateEvent(${i},'name',this.value)">
      <input type="text" class="form-input flex-2" value="${ev?.description||""}" oninput="App._updateEvent(${i},'description',this.value)">
      <button class="btn-icon btn-danger" onclick="App._removeEvent(${i})">&#x2715;</button>`;
    c.appendChild(div);
  },
  _updateEvent(i, f, v) { const d = BulletinModel.get(); if (!d.events[i]) d.events[i]={}; d.events[i][f]=v; },
  _removeEvent(i) { const d = BulletinModel.get(); d.events.splice(i,1); this.syncEventsUI(d.events); },

  addOfferingRow(item = null, idx = null) {
    const c = document.getElementById('offeringContainer'); if (!c) return;
    const i = idx !== null ? idx : c.children.length;
    const div = document.createElement('div'); div.className = 'dynamic-row'; div.dataset.idx = i;
    div.innerHTML = `
      <input type="text" class="form-input" value="${item?.name||""}"   oninput="App._updateOffering(${i},'name',this.value)">
      <input type="text" class="form-input" value="${item?.amount||""}" oninput="App._updateOffering(${i},'amount',this.value)">
      <input type="text" class="form-input" value="${item?.note||""}"   oninput="App._updateOffering(${i},'note',this.value)">
      <button class="btn-icon btn-danger" onclick="App._removeOffering(${i})">&#x2715;</button>`;
    c.appendChild(div);
  },
  _updateOffering(i, f, v) { const d = BulletinModel.get(); if (!d.offeringReport.monthlyItems[i]) d.offeringReport.monthlyItems[i]={}; d.offeringReport.monthlyItems[i][f]=v; },
  _removeOffering(i) { const d = BulletinModel.get(); d.offeringReport.monthlyItems.splice(i,1); this.syncOfferingUI(d.offeringReport.monthlyItems); },

  async loadUploadedChoirSong(opts = {}) {
    const isEvent = opts && typeof opts.preventDefault === 'function';
    if (isEvent) opts.preventDefault();
    const silent = (opts && opts.silent === true);
    
    const date = this._els.bulletinDate.value;
    if (!date) { if (!silent) this.showToast('請先選擇週報日期', 'error'); return { failed: ['未選擇日期'] }; }
    
    if (!silent) {
      this.showLoading(true);
      this.showToast('正在載入上傳的讚美詩名與歌詞...', 'info');
    }

    // 1. 優先自 Supabase 載入 (<50ms 熱響應)
    const sbService = (typeof window !== 'undefined' && window.SundayBulletinSupabaseService) || (typeof SundayBulletinSupabaseService !== 'undefined' && SundayBulletinSupabaseService);
    if (sbService && typeof sbService.loadPraise === 'function') {
      try {
        const sbRes = await sbService.loadPraise(date);
        if (hasUploadedPraiseData(sbRes)) {
          const praise = normalizeUploadedPraise(sbRes);
          BulletinModel.set('taiwanese.choirSong', praise.title);
          BulletinModel.set('taiwanese.choirType', praise.performanceType);
          BulletinModel.set('taiwanese.choirKicker', praise.kicker || (praise.performanceType === 'instrumental' ? '' : '聖歌隊'));
          BulletinModel.set('taiwanese.choirTune', praise.tune);
          BulletinModel.set('taiwanese.choirArrangement', praise.arrangement);
          BulletinModel.set('taiwanese.choirPerformers', praise.performers);
          BulletinModel.set('taiwanese.choirLyrics', praise.lyrics);
          this.syncFormFromModel();
          if (!silent) this.showToast('🎉 成功載入上傳的讚美詩名與歌詞！', 'success');
          return { failed: [] };
        }
      } catch (sbErr) {
        console.warn('[App] Supabase loadPraise 失敗，嘗試 GAS 備援:', sbErr.message);
      }
    }
    
    // 2. GAS 備援查詢
    const key = `praise_songs_${date}`;
    const url = `${CONFIG.GAS_SYNC_URL}?action=load&key=${encodeURIComponent(key)}`;
    
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.success && json.data) {
        const praise = normalizeUploadedPraise(json.data);
        if (hasUploadedPraiseData(praise)) {
          BulletinModel.set('taiwanese.choirSong', praise.title);
          BulletinModel.set('taiwanese.choirType', praise.performanceType);
          BulletinModel.set('taiwanese.choirKicker', praise.kicker || (praise.performanceType === 'instrumental' ? '' : '聖歌隊'));
          BulletinModel.set('taiwanese.choirTune', praise.tune);
          BulletinModel.set('taiwanese.choirArrangement', praise.arrangement);
          BulletinModel.set('taiwanese.choirPerformers', praise.performers);
          BulletinModel.set('taiwanese.choirLyrics', praise.lyrics);
          this.syncFormFromModel();
          if (!silent) this.showToast('🎉 成功載入上傳的讚美詩名與歌詞！', 'success');
          return { failed: [] };
        } else {
          if (!silent) this.showToast('ℹ️ 該日期上傳記錄中無讚美詩名或歌詞', 'warning');
          return { failed: [] };
        }
      } else {
        if (!silent) this.showToast('ℹ️ 該日期雲端尚無讚美上傳記錄', 'warning');
        return { failed: [] };
      }
    } catch (err) {
      console.error(err);
      if (!silent) this.showToast(`❌ 載入失敗：${err.message}`, 'error');
      return { failed: [err.message] };
    } finally {
      if (!silent) this.showLoading(false);
    }
  },

  async loadUploadedReports(opts = {}) {
    const isEvent = opts && typeof opts.preventDefault === 'function';
    if (isEvent) opts.preventDefault();
    const silent = (opts && opts.silent === true);
    
    const date = this._els.bulletinDate.value;
    if (!date) { if (!silent) this.showToast('請先選擇週報日期', 'error'); return { failed: ['未選擇日期'] }; }
    
    if (!silent) {
      this.showLoading(true);
      this.showToast('正在載入上傳的消息與代禱...', 'info');
    }

    // 1. 優先自 Supabase 載入 (<50ms 熱響應)
    const sbService = (typeof window !== 'undefined' && window.SundayBulletinSupabaseService) || (typeof SundayBulletinSupabaseService !== 'undefined' && SundayBulletinSupabaseService);
    if (sbService && typeof sbService.loadReports === 'function') {
      try {
        const sbRes = await sbService.loadReports(date);
        const hasAnn = Array.isArray(sbRes?.announcements) && sbRes.announcements.some(Boolean);
        const hasNews = Array.isArray(sbRes?.churchNews) && sbRes.churchNews.some(Boolean);
        const hasPrayer = sbRes?.prayer && (sbRes.prayer.homeRest || sbRes.prayer.hospital || sbRes.prayer.other);
        if (sbRes && (hasAnn || hasNews || hasPrayer)) {
          const reports = normalizeUploadedReports(sbRes);
          BulletinModel.set('announcements', reports.announcements);
          BulletinModel.set('churchNews', reports.churchNews);
          BulletinModel.set('prayer', reports.prayer);

          this.syncFormFromModel();
          if (!silent) this.showToast('🎉 成功載入上傳的消息與代禱事項！', 'success');
          return { failed: [] };
        }
      } catch (sbErr) {
        console.warn('[App] Supabase loadReports 失敗，嘗試 GAS 備援:', sbErr.message);
      }
    }
    
    // 2. GAS 備援查詢
    const key = `reports_${date}`;
    const url = `${CONFIG.GAS_SYNC_URL}?action=load&key=${encodeURIComponent(key)}`;
    
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.success && json.data) {
        const reports = normalizeUploadedReports(json.data);
        BulletinModel.set('announcements', reports.announcements);
        BulletinModel.set('churchNews', reports.churchNews);
        BulletinModel.set('prayer', reports.prayer);
        
        this.syncFormFromModel();
        if (!silent) this.showToast('🎉 成功載入上傳的消息與代禱事項！', 'success');
        return { failed: [] };
      } else {
        if (!silent) this.showToast('ℹ️ 該日期雲端尚無消息/代禱上傳記錄', 'warning');
        return { failed: [] };
      }
    } catch (err) {
      console.error(err);
      if (!silent) this.showToast(`❌ 載入失敗：${err.message}`, 'error');
      return { failed: [err.message] };
    } finally {
      if (!silent) this.showLoading(false);
    }
  },

  showToast(message, type = 'info') {
    const c = document.getElementById('toastContainer'); if (!c) return;
    const t = document.createElement('div'); t.className = `toast toast-${type}`; t.textContent = message; c.appendChild(t);
    setTimeout(() => t.classList.add('show'), 10);
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 4500);
  },

  showLoading(show) {
    const o = document.getElementById('loadingOverlay');
    if (o) o.style.display = show ? 'flex' : 'none';
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = App;
}

document.addEventListener('DOMContentLoaded', () => App.init());
