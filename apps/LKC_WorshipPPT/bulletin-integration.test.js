const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, 'bulletin-integration.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

test('reflows loaded and manually edited reports with the current effective layout', () => {
  const calls = source.match(/root\.reflowReportPagesForLayout\(\)/g) || [];
  assert.equal(calls.length, 2);
  assert.match(source, /applyReportsToModel\(model, reportsResult\.data\);[\s\S]{0,120}reflowReportPagesForLayout\(\)/);
  assert.match(source, /element\.oninput[\s\S]*applyReportsToModel\(model,[\s\S]*reflowReportPagesForLayout\(\);[\s\S]*preview\(\)/);
});

test('loads reports and praise from the existing bulletin API without a Firebase content mirror', () => {
  assert.doesNotMatch(source, /readServiceRecord/);
  assert.match(source, /loadCloudRecord\(endpoint, kind, date, root\.fetch\.bind\(root\)\)/);
});

test('boots the shared Sunday Bulletin Supabase service before PPT bulletin content', () => {
  const configIndex = indexSource.indexOf('../../supabase/supabase-config.js');
  const serviceIndex = indexSource.indexOf('../LKC_SundayBulletin/js/bulletin-supabase.js');
  const contentIndex = indexSource.indexOf('bulletin-content.js');

  assert.ok(configIndex >= 0, 'Supabase config must be loaded');
  assert.ok(serviceIndex > configIndex, 'Sunday Bulletin service must load after Supabase config');
  assert.ok(contentIndex > serviceIndex, 'PPT bulletin content must load after Sunday Bulletin service');
});
test('imports praise even when the reports draft is missing', async () => {
  const model = {
    announcements: { pptPages: [] },
    praise: { title: '讚美', performanceType: 'vocal', body: '' }
  };
  const praiseData = {
    title: '這是天父世界',
    performanceType: 'instrumental',
    tune: 'Terra Beata、英國傳統曲調、美國靈歌',
    arrangement: 'Brant Adams',
    performers: '長笛 / 黃慈恩\n鋼琴 / 蔡宜婷',
    lyrics: ''
  };
  const context = {
    model,
    active: 'cover',
    activeWorshipTemplateProfile: { sourceRequirements: { reports: true, praise: true } },
    TaiwaneseWorshipBulletinContent: {
      loadCloudRecord: async (_endpoint, kind) => {
        if (kind === 'reports') throw new Error('草稿不存在');
        return { state: 'loaded', data: praiseData };
      },
      applyReportsToModel(target, data) {
        Object.assign(target.announcements, data);
      },
      applyPraiseToModel(target, data) {
        Object.assign(target.praise, data);
      },
      normalizeReports: () => ({ announcements: [], churchNews: [], prayer: {} })
    },
    fetch: async () => {},
    editor() {},
    render() {},
    preview() {},
    flow() {},
    reflowReportPagesForLayout() {}
  };
  context.window = context;
  vm.runInNewContext(source, context);

  const result = await context.loadBulletinPptContent('2026-09-27');

  assert.equal(result.reports.state, 'error');
  assert.equal(result.reports.error, '草稿不存在');
  assert.equal(result.praise.state, 'loaded');
  assert.equal(model.praise.title, '這是天父世界');
  assert.equal(model.praise.performanceType, 'instrumental');
  assert.equal(model.praise.performers, '長笛 / 黃慈恩\n鋼琴 / 蔡宜婷');
  assert.match(context.describeBulletinPptContent(result), /讚美 1 頁/);
  assert.match(context.describeBulletinPptContent(result), /報告讀取失敗：草稿不存在/);
});
