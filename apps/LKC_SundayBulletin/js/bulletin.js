// 資料模型與狀態管理 - 教會週報管理系統

const NO_DATA_LABEL = '無資料';

const BulletinModel = {

  defaultData() {
    return {
      date: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),

      // 禮拜類型：台華語 / 聯合-台語 / 聯合-華語
      serviceType: '台華語',

      taiwanese: {
        presider: '',
        callToWorship: '', openingHymn: '',
        apostlesCreed: true,
        responsivePsalm: '', prayer1Note: '',
        scripture: '', choirSong: '', choirType: 'vocal', choirKicker: '聖歌隊',
        choirTune: '', choirArrangement: '', choirPerformers: '', choirLyrics: '', sermonTitle: '',
        responseHymn: '', goldenVerse: '', goldenVerseText: '',
        offeringNote: '', doxologyHymn: '',
        bankAccount: CONFIG.BANK_ACCOUNT
      },

      mandarin: {
        presider: '', goldenVerse: '', goldenVerseText: '',
        scripture: '', sermonTitle: '',
        worshipSongs: '',
        upcomingPreview: ''
      },

      ministry: {
        thisWeek: {
          date: '',
          tw: { presider:'', mc:'', pianist:'', usher:'', newcomerCare:'', preMeetingSong:'', choir:'', soundControl:'', sundaySchoolA:'' },
          zh: { presider:'', mc:'', worship:'', usher:'', newcomerCare:'', sundaySchoolB:'' }
        },
        nextWeek: {
          date: '',
          tw: { presider:'', mc:'', pianist:'', usher:'', newcomerCare:'', preMeetingSong:'', choir:'', soundControl:'', sundaySchoolA:'' },
          zh: { presider:'', mc:'', worship:'', usher:'', newcomerCare:'', sundaySchoolB:'' }
        }
      },

      attendance: {
        twService: 0, zhService: 0, choir: 0,
        sundaySchool: { '幼小班':0, '初小班':0, '中小班':0, '高小班':0, '青少年班':0, '成人A班':0, '成人B班':0 },
        sundayPrayer: 0, thursdayPrayer: 0,
        smallGroups: Object.fromEntries(CONFIG.TW_GROUPS.map(g => [g, 0])),
        twOffering: 0, zhOffering: 0, zhOffering2: 0, sundaySchoolOffering: 0
      },

      events: [],
      announcements: ['', '', '', '', '', '', '', '', '', ''],
      churchNews: ['', '', '', '', '', '', '', '', '', ''],
      prayer: { homeRest: '', hospital: '', other: '' },
      offeringReport: { monthlyItems: [], special: '', thanksgiving: '', notes: '' }
    };
  },

  _current: null,

  init(date) {
    this._current = this.defaultData();
    if (date) this._current.date = date;
    return this._current;
  },

  get() {
    if (!this._current) this.init();
    return this._current;
  },

  set(path, value) {
    if (!this._current) this.init();
    const keys = path.split('.');
    let obj = this._current;
    for (let i = 0; i < keys.length - 1; i++) {
      if (!obj[keys[i]]) obj[keys[i]] = {};
      obj = obj[keys[i]];
    }
    obj[keys[keys.length - 1]] = value;
    this._current.updatedAt = new Date().toISOString();
  },

  merge(data) {
    if (!this._current) this.init();
    this._deepMerge(this._current, data);
    this._current.updatedAt = new Date().toISOString();
  },

  _deepMerge(target, source) {
    for (const key of Object.keys(source)) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        if (!target[key]) target[key] = {};
        this._deepMerge(target[key], source[key]);
      } else {
        target[key] = source[key];
      }
    }
  },

  applyAPIData(apiResults) {
    const { calendar, service, worship, worshipSongs, attendance, smallGroups } = apiResults;

    if (calendar?.success) {
      const { taiwanese: tw, mandarin: zh, upcoming } = calendar.data;
      if (tw) {
        this.set('taiwanese.presider',     tw.speaker      || '');
        this.set('taiwanese.sermonTitle',  tw.sermonTitle  || '');
        let scripture = tw.scripture || '';
        if (window.BibleFormatter) scripture = window.BibleFormatter.format(scripture);
        this.set('taiwanese.scripture',    scripture);
        let callToWorship = tw.callToWorship || '';
        if (window.BibleFormatter) callToWorship = window.BibleFormatter.format(callToWorship);
        this.set('taiwanese.callToWorship', callToWorship);

        let goldenVerse = tw.goldenVerse || '';
        if (window.BibleFormatter) goldenVerse = window.BibleFormatter.format(goldenVerse);
        this.set('taiwanese.goldenVerse',  goldenVerse);
        let goldenVerseText = tw.goldenVerseText || '';
        this.set('taiwanese.goldenVerseText', goldenVerseText);
        let hymns = [];
        if (tw.hymn) {
          let separators = /[,，、\/;；\n\t]+/;
          if (!separators.test(tw.hymn) && /\d+\s+\d+/.test(tw.hymn)) {
            separators = /\s+/;
          }
          const hymns = tw.hymn.split(separators)
            .map(h => h.trim())
            .filter(Boolean)
            .map(h => {
              const match = h.match(/\d+/);
              return match ? match[0] : h;
            });
        }
        this.set('taiwanese.openingHymn', hymns[0] || NO_DATA_LABEL);
        this.set('taiwanese.responseHymn', hymns[1] || NO_DATA_LABEL);
        this.set('taiwanese.doxologyHymn', hymns[2] || NO_DATA_LABEL);
        this.set('taiwanese.responsivePsalm', tw.responsivePsalm || NO_DATA_LABEL);
        this.set('ministry.thisWeek.tw.presider', tw.speaker || '');
      } else {
        this.set('taiwanese.openingHymn', NO_DATA_LABEL);
        this.set('taiwanese.responseHymn', NO_DATA_LABEL);
        this.set('taiwanese.doxologyHymn', NO_DATA_LABEL);
        this.set('taiwanese.responsivePsalm', NO_DATA_LABEL);
      }
      if (zh) {
        this.set('mandarin.presider',    zh.speaker      || '');
        this.set('mandarin.sermonTitle', zh.sermonTitle  || '');
        let scripture = zh.scripture || '';
        if (window.BibleFormatter) scripture = window.BibleFormatter.format(scripture);
        this.set('mandarin.scripture',   scripture);
        let goldenVerse = zh.goldenVerse || '';
        if (window.BibleFormatter) goldenVerse = window.BibleFormatter.format(goldenVerse);
        this.set('mandarin.goldenVerse', goldenVerse);

        // Mandarin golden verse text (if available). Keep the fetched prose as-is;
        // BibleFormatter is for references, not the verse content itself.
        let goldenVerseText = zh.goldenVerseText || '';
        this.set('mandarin.goldenVerseText', goldenVerseText);
        this.set('ministry.thisWeek.zh.presider', zh.speaker || '');
      }
      if (upcoming) {
        this.set('events', upcoming.slice(0, 15).map(e => ({
          date: e.date, name: e.name, description: e.notes || e.sermonTitle || ''
        })));
      }
    }

    if (service?.success) {
      const d = service.data;
      this.set('ministry.thisWeek.tw.mc',            d.mc           || '');
      this.set('ministry.thisWeek.tw.pianist',       d.pianist      || '');
      this.set('ministry.thisWeek.tw.choir',         d.choir        || '');
      this.set('ministry.thisWeek.tw.usher',         d.usher        || '');
      this.set('ministry.thisWeek.tw.preMeetingSong',d.songLeader   || '');
      this.set('ministry.thisWeek.tw.soundControl',  d.soundControl || '');
      this.set('ministry.thisWeek.tw.newcomerCare',  d.newcomerCare || '');
      this.set('ministry.thisWeek.zh.mc',            d.zhMc         || '');
    }

    if (worship?.success) {
      this.set('ministry.thisWeek.zh.worship', worship.data.leader || '');
    }

    if (worshipSongs?.success) {
      this.set('mandarin.worshipSongs', worshipSongs.data.songs || '');
    }

    if (attendance?.success) {
      const a = attendance.data;
      this.set('attendance.twService', a.taiwanese?.total || 0);
      this.set('attendance.zhService', a.mandarin?.total  || 0);
    }

    if (smallGroups?.success) {
      // 完全替換 smallGroups（含 API 動態回傳的小組列表）
      this._current.attendance.smallGroups = {};
      for (const [name, info] of Object.entries(smallGroups.data)) {
        this._current.attendance.smallGroups[name] = info.attendance || 0;
      }
    }
  },

  applyNextWeekAPIData(apiResults) {
    const { calendar, service, worship } = apiResults;

    if (calendar?.success) {
      const { taiwanese: tw, mandarin: zh } = calendar.data;
      if (tw) this.set('ministry.nextWeek.tw.presider', tw.speaker || '');
      if (zh) this.set('ministry.nextWeek.zh.presider', zh.speaker || '');
    }

    if (service?.success) {
      const d = service.data;
      this.set('ministry.nextWeek.tw.mc',            d.mc           || '');
      this.set('ministry.nextWeek.tw.pianist',       d.pianist      || '');
      this.set('ministry.nextWeek.tw.choir',         d.choir        || '');
      this.set('ministry.nextWeek.tw.usher',         d.usher        || '');
      this.set('ministry.nextWeek.tw.preMeetingSong',d.songLeader   || '');
      this.set('ministry.nextWeek.tw.soundControl',  d.soundControl || '');
      this.set('ministry.nextWeek.tw.newcomerCare',  d.newcomerCare || '');
      this.set('ministry.nextWeek.zh.mc',            d.zhMc         || '');
    }

    if (worship?.success) {
      this.set('ministry.nextWeek.zh.worship', worship.data.leader || '');
    }
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = BulletinModel;
}
