// Word 文件匯出 - 教會週報管理系統
// 使用 docx@8.5.0 生成符合模板結構的 Word 文件

const BulletinExport = {

  // 字型設定
  FONT_CN: '標楷體',
  FONT_EN: 'Times New Roman',
  PAGE_WIDTH: 11906,  // A4 寬度 (twips)
  PAGE_HEIGHT: 16838, // A4 高度 (twips)
  MARGIN: 720,        // ~0.5 inch

  async ensureDocxReady() {
    if (window.docx && window.saveAs) return;
    const loadScript = src => new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('無法載入模組: ' + src));
      document.head.appendChild(s);
    });
    if (!window.docx) await loadScript('https://unpkg.com/docx@8.5.0/build/index.js');
    if (!window.saveAs) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/FileSaver.js/2.0.5/FileSaver.min.js');
  },

  // 共用樣式創建函數
  _para(text, opts = {}) {
    const { docx } = window;
    const runs = [];
    const lines = String(text || '').split('\n');
    lines.forEach((line, idx) => {
      runs.push(new docx.TextRun({
        text: line,
        font: { name: opts.font || this.FONT_CN },
        size: opts.size || 20,
        bold: opts.bold || false,
        color: opts.color || '000000',
        break: idx > 0 ? 1 : undefined
      }));
    });
    return new docx.Paragraph({
      children: runs,
      alignment: opts.align || docx.AlignmentType.LEFT,
      spacing: { before: opts.spaceBefore || 40, after: opts.spaceAfter || 40 },
      indent: opts.indent ? { left: opts.indent } : undefined
    });
  },

  _heading(text, level = 1) {
    const sizes = [32, 28, 24, 22];
    return this._para(text, {
      size: sizes[level - 1] || 22,
      bold: true,
      spaceBefore: 100,
      spaceAfter: 60
    });
  },

  _cell(text, opts = {}) {
    const { docx } = window;
    const runs = [];
    const lines = String(text || '').split('\n');
    lines.forEach((line, idx) => {
      runs.push(new docx.TextRun({
        text: line,
        font: { name: opts.font || this.FONT_CN },
        size: opts.size || 18,
        bold: opts.bold || false,
        break: idx > 0 ? 1 : undefined
      }));
    });
    return new docx.TableCell({
      children: [new docx.Paragraph({
        children: runs,
        alignment: opts.align || docx.AlignmentType.LEFT,
        spacing: { before: 20, after: 20 }
      })],
      width: opts.width ? { size: opts.width, type: docx.WidthType.DXA } : undefined,
      columnSpan: opts.colSpan || 1,
      rowSpan: opts.rowSpan || 1,
      shading: opts.shading ? { fill: opts.shading } : undefined,
      borders: opts.noBorder ? {
        top: { style: docx.BorderStyle.NONE },
        bottom: { style: docx.BorderStyle.NONE },
        left: { style: docx.BorderStyle.NONE },
        right: { style: docx.BorderStyle.NONE }
      } : undefined
    });
  },

  _row(cells) {
    const { docx } = window;
    return new docx.TableRow({ children: cells });
  },

  _table(rows, opts = {}) {
    const { docx } = window;
    return new docx.Table({
      rows,
      width: { size: opts.width || 9000, type: docx.WidthType.DXA },
      borders: opts.noBorder ? {
        top: { style: docx.BorderStyle.NONE },
        bottom: { style: docx.BorderStyle.NONE },
        left: { style: docx.BorderStyle.NONE },
        right: { style: docx.BorderStyle.NONE },
        insideH: { style: docx.BorderStyle.NONE },
        insideV: { style: docx.BorderStyle.NONE }
      } : undefined
    });
  },

  _pageBreak() {
    const { docx } = window;
    return new docx.Paragraph({
      children: [new docx.PageBreak()]
    });
  },

  // ============================================================
  // 第一頁: 禮拜程序（依 serviceType 決定布局）
  //   台華語     → 台語 + 華語 兩欄並列
  //   聯合-台語  → 聯合主日禮拜 (以台語程序)，單欄滿版
  //   聯合-華語  → 聯合主日禮拜 (以華語程序)，單欄滿版
  // ============================================================
  _buildPage1(data) {
    const { docx } = window;
    const tw = data.taiwanese;
    const zh = data.mandarin;
    const dateStr = this._formatDate(data.date);
    const serviceType = data.serviceType || '台華語';

    const twHeader = (serviceType === '聯合-台語')
      ? [
          { label: '', value: `聯合主日禮拜  ${dateStr}`, bold: true, size: 22 },
          { label: '', value: '（以台語程序）', bold: false, size: 18 }
        ]
      : [
          { label: '', value: `台語主日禮拜  ${dateStr}`, bold: true, size: 22 },
          { label: '', value: '一樓', bold: false, size: 18 }
        ];

    let twGoldenVerseFull = tw.goldenVerse || '___';
    if (tw.goldenVerseText && !/[(（)）]/.test(twGoldenVerseFull)) {
      twGoldenVerseFull = `${twGoldenVerseFull}（${tw.goldenVerseText}）`;
    }
    let zhGoldenVerseFull = zh.goldenVerse || '___';
    if (zh.goldenVerseText && !/[(（)）]/.test(zhGoldenVerseFull)) {
      zhGoldenVerseFull = `${zhGoldenVerseFull}（${zh.goldenVerseText}）`;
    }

    const instrumentalPraise = tw.choirType === 'instrumental';
    const praisePerformer = tw.choirKicker || (instrumentalPraise ? '器樂演奏' : '聖歌隊');
    const choirDisplay = [
      tw.choirSong ? tw.choirSong + ' (' + praisePerformer + ')' : '',
      tw.choirTune ? '曲／' + tw.choirTune : '',
      tw.choirArrangement ? '編曲／' + tw.choirArrangement : '',
      tw.choirPerformers || '',
      instrumentalPraise ? '' : (tw.choirLyrics || '')
    ].filter(Boolean).join('\n') || '(聖歌隊)';

    // 左欄 - 台語程序
    const twLines = [
      ...twHeader,
      { label: '主理者：', value: tw.presider },
      { label: '', value: '' },
      { label: '「等候上帝的話」', value: '', bold: true },
      { label: '序樂', value: '(司琴者)' },
      { label: '宣召', value: `${tw.callToWorship || '___'} (司會者)` },
      { label: `聖詩 ${tw.openingHymn || '___'} 首`, value: '(會眾)' },
      { label: '使徒信經', value: '(會眾)' },
      { label: '', value: '' },
      { label: '「領受上帝的話」', value: '', bold: true },
      { label: `啟應文第 ${tw.responsivePsalm || '___'} 篇`, value: '(聖詩後面)(會眾)' },
      { label: `祈禱${tw.prayer1Note ? ' ' + tw.prayer1Note : ''}`, value: '(司會者)' },
      { label: `聖經 ${tw.scripture || '___'}`, value: '(司會者)' },
      { label: '讚美', value: choirDisplay },
      { label: `講道「${tw.sermonTitle || '___'}」`, value: '(主理者)' },
      { label: '祈禱', value: '(主理者)' },
      { label: '', value: '' },
      { label: '「回應上帝的話」', value: '', bold: true },
      { label: `聖詩 ${tw.responseHymn || '___'} 首`, value: '(會眾)' },
      { label: '報告', value: '(司會者)' },
      { label: `金句 ${twGoldenVerseFull}`, value: '(會眾)' },
      { label: `奉獻${tw.offeringNote ? ' ' + tw.offeringNote : ''}`, value: '(會眾)' },
      { label: `頌榮 ${tw.doxologyHymn || '___'} 首`, value: '(會眾)' },
      { label: '祝禱', value: '(主理者)' },
      { label: '阿們頌', value: '(會眾)' },
      { label: '後奏', value: '(司琴者)' },
      { label: '平安禮', value: '(會眾)' },
      { label: '', value: '' },
      { label: '「實行上帝的話」', value: '', bold: true },
      { label: tw.bankAccount || '', value: '', size: 16 }
    ];

    // 右欄 - 華語程序
    const zhHeader = (serviceType === '聯合-華語')
      ? [
          { label: '', value: `聯合主日禮拜  ${dateStr}`, bold: true, size: 22 },
          { label: '', value: '（以華語程序）', bold: false, size: 18 }
        ]
      : [
          { label: '', value: `華語主日禮拜  ${dateStr}`, bold: true, size: 22 },
          { label: '', value: '三樓', bold: false, size: 18 }
        ];

    const zhLines = [
      ...zhHeader,
      { label: '主理者：', value: zh.presider },
      { label: '', value: '' },
      { label: '「等候上帝的話」', value: '', bold: true },
      { label: '序樂', value: '(敬拜團)' },
      { label: '宣召', value: '(司會者)' },
      { label: '敬拜讚美', value: zh.worshipSongs ? `${zh.worshipSongs} (敬拜團)` : '(敬拜團)' },
      { label: '使徒信經', value: '(會眾)' },
      { label: '', value: '' },
      { label: '「領受上帝的話」', value: '', bold: true },
      { label: `聖經 ${zh.scripture || '___'}`, value: '(司會者)' },
      { label: '祈禱(+主禱文)', value: '(司會者)' },
      { label: `講道「${zh.sermonTitle || '___'}」`, value: '(主理者)' },
      { label: '', value: '' },
      { label: '「回應上帝的話」', value: '', bold: true },
      { label: '回應詩(平安禮)', value: '(敬拜團)' },
      { label: '報告', value: '(司會者)' },
      { label: `金句 ${zhGoldenVerseFull}`, value: '(會眾)' },
      { label: '奉獻', value: '(會眾)' },
      { label: '祝禱', value: '(主理者)' },
      { label: '', value: '' },
      { label: '「實行上帝的話」', value: '', bold: true },
      { label: zh.upcomingPreview || '活動預告請見第二頁', value: '', size: 16 }
    ];

    const buildCellContent = (lines) => {
      return lines.map(line => {
        const text = line.label + (line.value ? '　' + line.value : '');
        const runs = [];
        const splitLines = String(text.trim() || ' ').split('\n');
        splitLines.forEach((sLine, idx) => {
          runs.push(new docx.TextRun({
            text: sLine,
            font: { name: this.FONT_CN },
            size: line.size || 18,
            bold: line.bold || false,
            break: idx > 0 ? 1 : undefined
          }));
        });
        return new docx.Paragraph({
          children: runs,
          spacing: { before: 30, after: 30 }
        });
      });
    };

    const noBorder = {
      top:    { style: docx.BorderStyle.NONE },
      bottom: { style: docx.BorderStyle.NONE },
      left:   { style: docx.BorderStyle.NONE },
      right:  { style: docx.BorderStyle.NONE }
    };

    let table;
    if (serviceType === '聯合-台語') {
      // 單欄滿版：台語程序
      table = new docx.Table({
        rows: [new docx.TableRow({
          children: [new docx.TableCell({
            children: buildCellContent(twLines),
            width: { size: 9000, type: docx.WidthType.DXA },
            borders: noBorder
          })]
        })],
        width: { size: 9000, type: docx.WidthType.DXA }
      });
    } else if (serviceType === '聯合-華語') {
      // 單欄滿版：華語程序
      table = new docx.Table({
        rows: [new docx.TableRow({
          children: [new docx.TableCell({
            children: buildCellContent(zhLines),
            width: { size: 9000, type: docx.WidthType.DXA },
            borders: noBorder
          })]
        })],
        width: { size: 9000, type: docx.WidthType.DXA }
      });
    } else {
      // 預設：台語 + 華語 兩欄並列
      table = new docx.Table({
        rows: [new docx.TableRow({
          children: [
            new docx.TableCell({
              children: buildCellContent(twLines),
              width: { size: 4500, type: docx.WidthType.DXA },
              borders: {
                right:  { style: docx.BorderStyle.SINGLE, size: 2, color: '888888' },
                top:    { style: docx.BorderStyle.NONE },
                bottom: { style: docx.BorderStyle.NONE },
                left:   { style: docx.BorderStyle.NONE }
              }
            }),
            new docx.TableCell({
              children: buildCellContent(zhLines),
              width: { size: 4500, type: docx.WidthType.DXA },
              borders: noBorder
            })
          ]
        })],
        width: { size: 9000, type: docx.WidthType.DXA }
      });
    }

    return [table];
  },

  // ============================================================
  // 第二頁: 活動預告 + 服事人員
  // ============================================================
  _buildPage2(data) {
    const { docx } = window;
    const children = [];

    // 活動預告
    children.push(this._heading('活動預告', 2));

    const eventRows = [
      this._row([
        this._cell('日期', { bold: true, shading: 'EEEEEE', width: 1500 }),
        this._cell('活動名稱', { bold: true, shading: 'EEEEEE', width: 2500 }),
        this._cell('說明', { bold: true, shading: 'EEEEEE', width: 5000 })
      ])
    ];

    const events = data.events || [];
    if (events.length === 0) {
      eventRows.push(this._row([
        this._cell('', { width: 1500 }),
        this._cell('', { width: 2500 }),
        this._cell('', { width: 5000 })
      ]));
    } else {
      events.forEach(ev => {
        eventRows.push(this._row([
          this._cell(ev.date || '', { width: 1500 }),
          this._cell(ev.name || '', { width: 2500 }),
          this._cell(ev.description || '', { width: 5000 })
        ]));
      });
    }

    children.push(this._table(eventRows));
    children.push(this._para(''));

    // 台語禮拜週服事人員
    children.push(this._heading('台語禮拜週服事人員', 2));

    const tw = data.ministry;
    const twRows = [
      this._row([
        this._cell('分工', { bold: true, shading: 'EEEEEE', width: 1500 }),
        this._cell(`本週 (${tw?.thisWeek?.date || ''})`, { bold: true, shading: 'EEEEEE', width: 3500 }),
        this._cell(`下週 (${tw?.nextWeek?.date || ''})`, { bold: true, shading: 'EEEEEE', width: 3500 })
      ]),
      ...[
        ['主理/司會', 'presider', 'mc'],
        ['司琴', 'pianist', 'pianist'],
        ['招待.司獻', 'usher', 'usher'],
        ['新家人關懷', 'newcomerCare', 'newcomerCare'],
        ['會前領唱', 'preMeetingSong', 'preMeetingSong'],
        ['獻詩(聖歌隊)', 'choir', 'choir'],
        ['音控', 'soundControl', 'soundControl'],
        ['成人主日學A', 'sundaySchoolA', 'sundaySchoolA']
      ].map(([label, thisKey, nextKey]) => this._row([
        this._cell(label, { width: 1500 }),
        this._cell(tw?.thisWeek?.tw?.[thisKey] || '', { width: 3500 }),
        this._cell(tw?.nextWeek?.tw?.[nextKey] || '', { width: 3500 })
      ]))
    ];

    children.push(this._table(twRows));
    children.push(this._para(''));

    // 華語禮拜週服事人員
    children.push(this._heading('華語禮拜週服事人員', 2));

    const zhRows = [
      this._row([
        this._cell('分工', { bold: true, shading: 'EEEEEE', width: 1500 }),
        this._cell(`本週 (${tw?.thisWeek?.date || ''})`, { bold: true, shading: 'EEEEEE', width: 3500 }),
        this._cell(`下週 (${tw?.nextWeek?.date || ''})`, { bold: true, shading: 'EEEEEE', width: 3500 })
      ]),
      ...[
        ['主理', 'presider', 'presider'],
        ['司會', 'mc', 'mc'],
        ['敬拜', 'worship', 'worship'],
        ['招待.司獻', 'usher', 'usher'],
        ['新家人關懷', 'newcomerCare', 'newcomerCare'],
        ['成人主日學B', 'sundaySchoolB', 'sundaySchoolB']
      ].map(([label, thisKey, nextKey]) => this._row([
        this._cell(label, { width: 1500 }),
        this._cell(tw?.thisWeek?.zh?.[thisKey] || '', { width: 3500 }),
        this._cell(tw?.nextWeek?.zh?.[nextKey] || '', { width: 3500 })
      ]))
    ];

    children.push(this._table(zhRows));

    return children;
  },

  // ============================================================
  // 第三頁: 聚會人數及奉獻 + 本會消息
  // ============================================================
  _buildPage3(data) {
    const { docx } = window;
    const children = [];
    const att = data.attendance;

    children.push(this._heading('聚會人數及奉獻', 2));

    const attRows = [
      this._row([
        this._cell('聚會類別', { bold: true, shading: 'EEEEEE', width: 2000 }),
        this._cell('人數', { bold: true, shading: 'EEEEEE', width: 2000 }),
        this._cell('聚會類別', { bold: true, shading: 'EEEEEE', width: 2000 }),
        this._cell('人數', { bold: true, shading: 'EEEEEE', width: 2000 })
      ]),
      // 主日禮拜
      this._row([
        this._cell('主日禮拜：台語', { width: 2000 }),
        this._cell(String(att.twService || 0), { width: 2000 }),
        this._cell('主日禮拜：華語', { width: 2000 }),
        this._cell(String(att.zhService || 0), { width: 2000 })
      ]),
      this._row([
        this._cell('聖歌隊', { width: 2000 }),
        this._cell(String(att.choir || 0), { width: 2000 }),
        this._cell('查經班', { width: 2000 }),
        this._cell(String(att.bibleStudy || 0), { width: 2000 })
      ]),
      this._row([
        this._cell('週間聚會', { width: 2000 }),
        this._cell(String(att.weeklyMeeting || 0), { width: 2000 }),
        this._cell('早禱會', { width: 2000 }),
        this._cell(String(att.morningPrayer || 0), { width: 2000 })
      ]),
      // 主日學標題
      this._row([
        this._cell('主日學', { bold: true, colSpan: 4, shading: 'F5F5F5' })
      ]),
      ...Object.entries(att.sundaySchool || {}).map(([cls, count]) =>
        this._row([
          this._cell(cls, { width: 2000 }),
          this._cell(String(count || 0), { width: 2000 }),
          this._cell('', { width: 2000 }),
          this._cell('', { width: 2000 })
        ])
      ),
      // 小組標題
      this._row([
        this._cell('各小組', { bold: true, colSpan: 4, shading: 'F5F5F5' })
      ]),
      ...Object.entries(att.smallGroups || {}).reduce((rows, [name, count], idx, arr) => {
        if (idx % 2 === 0) {
          const next = arr[idx + 1];
          rows.push(this._row([
            this._cell(name, { width: 2000 }),
            this._cell(String(count || 0), { width: 2000 }),
            this._cell(next ? next[0] : '', { width: 2000 }),
            this._cell(next ? String(next[1] || 0) : '', { width: 2000 })
          ]));
        }
        return rows;
      }, []),
      // 奉獻
      this._row([
        this._cell('奉獻金額', { bold: true, colSpan: 4, shading: 'F5F5F5' })
      ]),
      this._row([
        this._cell('台語奉獻', { width: 2000 }),
        this._cell(att.twOffering ? `NT$${att.twOffering}` : '', { width: 2000 }),
        this._cell('華語奉獻', { width: 2000 }),
        this._cell(att.zhOffering ? `NT$${att.zhOffering}` : '', { width: 2000 })
      ]),
      this._row([
        this._cell('主日學奉獻', { width: 2000 }),
        this._cell(att.sundaySchoolOffering ? `NT$${att.sundaySchoolOffering}` : '', { width: 2000 }),
        this._cell('', { width: 2000 }),
        this._cell('', { width: 2000 })
      ])
    ];

    children.push(new docx.Table({
      rows: attRows,
      width: { size: 8500, type: docx.WidthType.DXA }
    }));

    children.push(this._para(''));

    // 本會消息
    children.push(this._heading('本會消息', 2));

    const announcements = data.announcements || [];
    announcements.forEach((ann, idx) => {
      if (ann && ann.trim()) {
        children.push(this._para(`${idx + 1}. ${ann}`, { indent: 200 }));
      }
    });

    if (!announcements.some(a => a && a.trim())) {
      children.push(this._para('(尚未填入)', { color: '999999' }));
    }

    children.push(this._para(''));

    // 教界消息
    children.push(this._heading('教界消息', 2));

    const churchNews = data.churchNews || [];
    churchNews.forEach((item, idx) => {
      if (item && item.trim()) {
        children.push(this._para(`${idx + 1}. ${item}`, { indent: 200 }));
      }
    });

    if (!churchNews.some(item => item && item.trim())) {
      children.push(this._para('(尚未填入)', { color: '999999' }));
    }

    return children;
  },

  // ============================================================
  // 第四頁: 關懷代禱 + 奉獻報告
  // ============================================================
  _buildPage4(data) {
    const { docx } = window;
    const children = [];
    const prayer = data.prayer || {};
    const offering = data.offeringReport || {};

    children.push(this._heading('關懷代禱', 2));

    if (prayer.homeRest) {
      children.push(this._para('在家調養：', { bold: true }));
      children.push(this._para(prayer.homeRest, { indent: 400 }));
    }

    if (prayer.hospital) {
      children.push(this._para('住院：', { bold: true }));
      children.push(this._para(prayer.hospital, { indent: 400 }));
    }

    if (prayer.other) {
      children.push(this._para('其他代禱：', { bold: true }));
      children.push(this._para(prayer.other, { indent: 400 }));
    }

    if (!prayer.homeRest && !prayer.hospital && !prayer.other) {
      children.push(this._para('(尚未填入)', { color: '999999' }));
    }

    children.push(this._para(''));

    // 奉獻報告
    children.push(this._heading('奉獻報告', 2));

    const items = offering.monthlyItems || [];
    if (items.length > 0) {
      children.push(this._para('月定奉獻：', { bold: true }));
      const offeringRows = [
        this._row([
          this._cell('姓名', { bold: true, shading: 'EEEEEE', width: 3000 }),
          this._cell('金額', { bold: true, shading: 'EEEEEE', width: 3000 }),
          this._cell('備註', { bold: true, shading: 'EEEEEE', width: 3000 })
        ]),
        ...items.map(item => this._row([
          this._cell(item.name || '', { width: 3000 }),
          this._cell(item.amount || '', { width: 3000 }),
          this._cell(item.note || '', { width: 3000 })
        ]))
      ];
      children.push(this._table(offeringRows));
    }

    if (offering.special) {
      children.push(this._para(''));
      children.push(this._para('特別奉獻：', { bold: true }));
      children.push(this._para(offering.special, { indent: 400 }));
    }

    if (offering.thanksgiving) {
      children.push(this._para(''));
      children.push(this._para('感恩奉獻：', { bold: true }));
      children.push(this._para(offering.thanksgiving, { indent: 400 }));
    }

    if (offering.notes) {
      children.push(this._para(''));
      children.push(this._para(offering.notes));
    }

    return children;
  },

  // ============================================================
  // 日期格式化
  // ============================================================
  _formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d)) return dateStr;
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  },

  // ============================================================
  // 主要匯出函數
  // ============================================================
  async generate(data) {
    await this.ensureDocxReady();
    if (!window.docx) {
      throw new Error('docx 函式庫尚未載入');
    }

    const { docx } = window;

    const page1 = this._buildPage1(data);
    const page2 = this._buildPage2(data);
    const page3 = this._buildPage3(data);
    const page4 = this._buildPage4(data);

    const doc = new docx.Document({
      creator: CONFIG.CHURCH_NAME,
      title: `週報 ${data.date}`,
      description: '樂迦拼基督長老教會週報',
      styles: {
        default: {
          document: {
            run: {
              font: { name: this.FONT_CN },
              size: 20
            }
          }
        }
      },
      sections: [{
        properties: {
          page: {
            size: {
              width: this.PAGE_WIDTH,
              height: this.PAGE_HEIGHT,
              orientation: docx.PageOrientation.PORTRAIT
            },
            margin: {
              top: this.MARGIN,
              right: this.MARGIN,
              bottom: this.MARGIN,
              left: this.MARGIN
            }
          }
        },
        children: [
          // 頁首標題
          new docx.Paragraph({
            children: [new docx.TextRun({
              text: CONFIG.CHURCH_NAME + '  週報',
              font: { name: this.FONT_CN },
              size: 36,
              bold: true
            })],
            alignment: docx.AlignmentType.CENTER,
            spacing: { before: 0, after: 120 }
          }),
          new docx.Paragraph({
            children: [new docx.TextRun({
              text: this._formatDate(data.date),
              font: { name: this.FONT_CN },
              size: 24
            })],
            alignment: docx.AlignmentType.CENTER,
            spacing: { before: 0, after: 200 }
          }),

          // 第一頁
          ...page1,
          this._pageBreak(),

          // 第二頁
          ...page2,
          this._pageBreak(),

          // 第三頁
          ...page3,
          this._pageBreak(),

          // 第四頁
          ...page4
        ]
      }]
    });

    const blob = await docx.Packer.toBlob(doc);
    const filename = `週報_${data.date}.docx`;
    saveAs(blob, filename);
    return filename;
  }
};
