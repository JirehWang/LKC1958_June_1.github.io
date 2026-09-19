const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildBulletinCloudUrl,
  buildReportPages,
  reportLineCapacity,
  reportLines,
  reflowReportPages,
  applyReportsToModel,
  applyPraiseToModel,
  loadCloudRecord
} = require('./bulletin-content.js');

const june28Announcements = [
  '謝謝李俊佑牧師的信息分享。',
  '下午一點召開定期小會，請相關同工預備心參加。',
  '教會第二屆雙翼門徒訓練畢業名單：出如玉、謝育倫、周倩如、蔡君宜、曾宇璿、劉秀琴、甘淑蘭、林恩予、杜文心、林慧敏、金仕淳、徐聆、陳美如、羅彩珍，共14位。下主日禮拜中舉行畢業典禮，當天為台華語聯合禮拜及聯合成人主日學，會後備有愛餐(芥菜種)，請兄姊自備餐具。',
  '下主日下午一點召開定期長執會請同工預備心參加。',
  '有訂購每日讀經釋義的兄姊，請至辦公室領取第三季的讀本。'
];

test('uses the Sunday bulletin cloud keys for the selected service date', () => {
  assert.match(buildBulletinCloudUrl('https://example.test/exec', 'reports', '2026-07-12'), /key=reports_2026-07-12/);
  assert.match(buildBulletinCloudUrl('https://example.test/exec', 'praise', '2026-07-12'), /key=praise_songs_2026-07-12/);
});

test('prefers the shared Sunday Bulletin Supabase service and preserves its field mapping', async () => {
  const previousService = globalThis.SundayBulletinSupabaseService;
  const previousClient = globalThis._supabase;
  const calls = [];
  let fetchCalls = 0;

  globalThis._supabase = null;
  globalThis.SundayBulletinSupabaseService = {
    async loadReports(date) {
      calls.push(['reports', date]);
      return {
        date,
        announcements: ['本會消息'],
        churchNews: ['教界消息'],
        prayer: { homeRest: '在家調養', hospital: '住院', other: '其他' },
        updatedAt: '2026-10-04T00:00:00.000Z'
      };
    },
    async loadPraise(date) {
      calls.push(['praise', date]);
      return {
        date,
        title: '主恩典',
        kicker: '聖歌隊',
        lyrics: '第一節',
        updatedAt: '2026-10-04T00:00:00.000Z'
      };
    }
  };

  const fetchImpl = async () => {
    fetchCalls += 1;
    throw new Error('GAS fallback should not be used when Supabase returns data');
  };

  try {
    const reports = await loadCloudRecord('https://example.test/gas', 'reports', '2026-10-04', fetchImpl);
    const praise = await loadCloudRecord('https://example.test/gas', 'praise', '2026-10-04', fetchImpl);

    assert.deepEqual(reports, {
      state: 'loaded',
      data: {
        announcements: ['本會消息'],
        churchNews: ['教界消息'],
        prayer: { homeRest: '在家調養', hospital: '住院', other: '其他' }
      }
    });
    assert.deepEqual(praise, {
      state: 'loaded',
      data: { title: '主恩典', kicker: '聖歌隊', lyrics: '第一節' }
    });
    assert.deepEqual(calls, [['reports', '2026-10-04'], ['praise', '2026-10-04']]);
    assert.equal(fetchCalls, 0);
  } finally {
    if (previousService === undefined) delete globalThis.SundayBulletinSupabaseService;
    else globalThis.SundayBulletinSupabaseService = previousService;
    if (previousClient === undefined) delete globalThis._supabase;
    else globalThis._supabase = previousClient;
  }
});

test('retries a stale GAS redirect with a cache-busted request', async () => {
  const requests = [];
  let attempt = 0;
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    attempt += 1;
    if (attempt === 1) return { ok: false, status: 404 };
    return {
      ok: true,
      async json() {
        return {
          success: true,
          data: {
            date: '2026-10-04',
            announcements: ['GAS 備援成功'],
            churchNews: [],
            prayer: {}
          }
        };
      }
    };
  };

  const result = await loadCloudRecord(
    'https://example.test/gas',
    'reports',
    '2026-10-04',
    fetchImpl
  );

  assert.deepEqual(result, {
    state: 'loaded',
    data: {
      date: '2026-10-04',
      announcements: ['GAS 備援成功'],
      churchNews: [],
      prayer: {}
    }
  });
  assert.equal(requests.length, 2);
  assert.notEqual(
    new URL(requests[0].url).searchParams.get('_lkc'),
    new URL(requests[1].url).searchParams.get('_lkc')
  );
  assert.equal(requests[0].options.cache, 'no-store');
  assert.equal(requests[1].options.cache, 'no-store');
});

test('keeps announcements, church news, and pastoral prayer in report-page order', () => {
  const pages = buildReportPages({
    announcements: ['消息一', '消息二', '消息三', '消息四'],
    churchNews: ['教界一', '教界二', '教界三'],
    prayer: { homeRest: '王小明', hospital: '陳小華', other: '為社區代禱' }
  });

  assert.equal(pages.length, 4);
  assert.equal(pages[0].kind, 'report');
  assert.equal(pages[0].title, '報告－本會消息');
  assert.equal(pages[0].listType, 'ordered');
  assert.match(pages[0].body, /1\. 消息一/);
  assert.match(pages[1].body, /4\. 消息四/);
  assert.equal(pages[2].title, '報告－教界消息');
  assert.equal(pages[2].listType, 'ordered');
  assert.match(pages[2].body, /1\. 教界一/);
  assert.match(pages[2].body, /3\. 教界三/);
  assert.equal(pages[3].title, '報告－關懷代禱');
  assert.equal(pages[3].listType, undefined);
  assert.match(pages[3].body, /為社區代禱/);
  assert.match(pages[3].body, /在家調養兄姐：王小明/);
  assert.match(pages[3].body, /住院：陳小華/);
  assert.ok(pages[3].body.indexOf('為社區代禱') < pages[3].body.indexOf('在家調養兄姐：王小明'));
  assert.ok(pages[3].body.indexOf('在家調養兄姐：王小明') < pages[3].body.indexOf('住院：陳小華'));
  assert.doesNotMatch(pages[3].body, /其他代禱：/);
});

test('paginates the 2026-06-28 announcements by rendered line capacity', () => {
  const pages = buildReportPages({
    announcements: june28Announcements,
    churchNews: [],
    prayer: {}
  });

  assert.equal(pages.length, 4);
  assert.match(pages[0].body, /1\. 謝謝/);
  assert.match(pages[0].body, /2\. 下午一點/);
  assert.doesNotMatch(pages[0].body, /3\./);
  assert.match(pages[1].body, /^3\. /);
  assert.doesNotMatch(pages[1].body, /4\./);
  assert.match(pages[2].body, /^3\.（續）/);
  assert.doesNotMatch(pages[2].body, /4\./);
  assert.match(pages[3].body, /4\. 下主日/);
  assert.match(pages[3].body, /5\. 有訂購/);
  pages.forEach(page => assert.ok(page.body.split('\n').length <= 5));
});

test('reflows report pages when the effective font size changes without preserving estimated line breaks', () => {
  const model = {
    announcements: {
      announcements: june28Announcements,
      churchNews: [],
      prayer: {}
    }
  };

  reflowReportPages(model, { contentSize: 36, contentW: 84, contentH: 68, lineSpacing: 1.5 });
  assert.equal(model.announcements.pptPages.length, 3);
  assert.equal(model.announcements.reportLayout.contentSize, 36);
  assert.ok(model.announcements.pptPages.every(page => page.estimatedLines <= page.lineCapacity));
  assert.doesNotMatch(model.announcements.pptPages.map(page => page.body).join('\n'), /3\.（續）/);
  assert.ok(model.announcements.pptPages.some(page => page.body.includes(june28Announcements[2])));

  reflowReportPages(model, { contentSize: 60, contentW: 84, contentH: 68, lineSpacing: 1.5 });
  assert.ok(model.announcements.pptPages.length > 3);
  assert.equal(model.announcements.reportLayout.contentSize, 60);
  assert.match(model.announcements.pptPages.map(page => page.body).join('\n'), /3\.（續）/);
});

test('recalculates capacity from height, line spacing, width, and output text scale', () => {
  assert.equal(reportLineCapacity({ contentSize: 48, contentH: 68, lineSpacing: 1.5 }), 5);
  assert.equal(reportLineCapacity({ contentSize: 36, contentH: 68, lineSpacing: 1.5 }), 6);
  assert.equal(reportLineCapacity({ contentSize: 48, contentH: 40, lineSpacing: 1.5 }), 3);
  assert.equal(reportLineCapacity({ contentSize: 48, contentH: 68, lineSpacing: 1.2 }), 6);
  assert.equal(reportLineCapacity({ contentSize: 48, contentH: 68, lineSpacing: 1.5, textScale: 1.2 }), 4);
  assert.ok(
    reportLines(june28Announcements[2], { contentSize: 48, contentW: 60 }).length
      > reportLines(june28Announcements[2], { contentSize: 48, contentW: 95 }).length
  );
});

test('keeps continuation pages inside a one-line-high report box', () => {
  const pages = buildReportPages({
    announcements: [june28Announcements[2]],
    churchNews: [],
    prayer: {}
  }, { contentSize: 48, contentW: 95, contentH: 10.8, lineSpacing: 1.1 });

  assert.ok(pages.length > 1);
  assert.ok(pages.every(page => page.estimatedLines <= page.lineCapacity));
  assert.ok(pages.every(page => page.body.split('\n').length <= 1));
  assert.match(pages.map(page => page.body).join('\n'), /1\.（續）/);
});

test('applies report pages and praise fields without treating cloud values as a single report string', () => {
  const model = {
    announcements: { title: '報告', body: '' },
    praise: { title: '讚美', kicker: '', body: '' }
  };

  applyReportsToModel(model, {
    announcements: ['消息一', '', '消息二'],
    churchNews: ['教界一', '', '教界二'],
    prayer: { homeRest: '在家調養名單', hospital: '', other: '' }
  });
  applyPraiseToModel(model, {
    title: '讚美無停',
    kicker: '聖歌隊',
    lyrics: '第一段\n\n第二段'
  });

  assert.deepEqual(model.announcements.announcements, ['消息一', '消息二']);
  assert.deepEqual(model.announcements.churchNews, ['教界一', '教界二']);
  assert.equal(model.announcements.includeSectionTitle, true);
  assert.equal(model.announcements.pptPages.length, 3);
  assert.equal(model.praise.title, '讚美無停');
  assert.equal(model.praise.kicker, '聖歌隊');
  assert.equal(model.praise.body, '第一段\n\n第二段');
});
