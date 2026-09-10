const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildGasLoadUrl,
  getKeyKind,
  selectGasKeys,
  buildSupabaseRow,
  syncItems
} = require('../scripts/sync_sunday_bulletin_gas_to_supabase.js');

test('builds GAS load URLs and classifies supported weekly bulletin keys', () => {
  assert.equal(
    buildGasLoadUrl('https://example.test/exec?source=sync', 'praise_songs_2026-07-12'),
    'https://example.test/exec?source=sync&action=load&key=praise_songs_2026-07-12'
  );
  assert.equal(getKeyKind('bulletin_draft_2026-07-12'), 'bulletins');
  assert.equal(getKeyKind('reports_2026-07-12'), 'reports');
  assert.equal(getKeyKind('praise_songs_2026-07-12'), 'praise');
  assert.equal(getKeyKind('unrelated_2026-07-12'), null);
});

test('selects only supported GAS keys inside the requested date and kind range', () => {
  const selected = selectGasKeys([
    'reports_2026-06-21',
    'praise_songs_2026-06-28',
    'bulletin_draft_2026-07-12',
    'reports_2026-07-19',
    'other_2026-07-12'
  ], { from: '2026-06-28', to: '2026-07-12', kinds: ['praise', 'bulletins'] });

  assert.deepEqual(selected, [
    'praise_songs_2026-06-28',
    'bulletin_draft_2026-07-12'
  ]);
});

test('maps GAS report, praise, and full bulletin records to Supabase columns', () => {
  const updatedAt = '2026-07-12T01:02:03.000Z';
  const reports = buildSupabaseRow({
    key: 'reports_2026-07-12',
    data: {
      date: '2026-07-12',
      announcements: ['本會消息'],
      churchNews: ['教界消息'],
      prayer: { homeRest: '安慰', hospital: '代禱', other: '' },
      updatedAt
    }
  });
  assert.equal(reports.table, 'sunday_bulletin_reports');
  assert.deepEqual(reports.row, {
    date: '2026-07-12',
    announcements: ['本會消息'],
    church_news: ['教界消息'],
    prayer: { homeRest: '安慰', hospital: '代禱', other: '' },
    raw_data: {
      date: '2026-07-12',
      announcements: ['本會消息'],
      churchNews: ['教界消息'],
      prayer: { homeRest: '安慰', hospital: '代禱', other: '' },
      updatedAt
    },
    updated_at: updatedAt,
    updated_by: 'gas-migration'
  });

  const praise = buildSupabaseRow({
    key: 'praise_songs_2026-07-12',
    data: { date: '2026-07-12', title: '奇異恩典', kicker: '聖歌隊', lyrics: '第一節', updatedAt }
  });
  assert.equal(praise.table, 'sunday_bulletin_praise');
  assert.equal(praise.row.title, '奇異恩典');
  assert.equal(praise.row.lyrics, '第一節');
  assert.equal(praise.row.updated_at, updatedAt);

  const bulletin = buildSupabaseRow({
    key: 'bulletin_draft_2026-07-12',
    data: {
      date: '2026-07-12',
      serviceType: '台華語',
      taiwanese: { sermonTitle: '主的恩典' },
      mandarin: {},
      ministry: {},
      attendance: {},
      events: [],
      announcements: ['本會消息'],
      churchNews: ['教界消息'],
      prayer: { homeRest: '安慰' },
      offeringReport: {},
      updatedAt
    }
  });
  assert.equal(bulletin.table, 'sunday_bulletins');
  assert.equal(bulletin.row.service_type, '台華語');
  assert.deepEqual(bulletin.row.church_news, ['教界消息']);
  assert.equal(bulletin.row.data.updatedAt, updatedAt);
});

test('dry-run never calls Supabase, while write mode upserts each item', async () => {
  const calls = [];
  const client = {
    from(table) {
      return {
        async upsert(row, options) {
          calls.push({ table, row, options });
          return { error: null };
        }
      };
    }
  };
  const items = [
    { key: 'reports_2026-07-12', kind: 'reports', date: '2026-07-12', data: { date: '2026-07-12' } },
    { key: 'praise_songs_2026-07-12', kind: 'praise', date: '2026-07-12', data: { date: '2026-07-12' } }
  ];

  const dryRun = await syncItems(items, { client, dryRun: true });
  assert.equal(dryRun.upserted, 0);
  assert.equal(dryRun.planned, 2);
  assert.equal(calls.length, 0);

  const written = await syncItems(items, { client, dryRun: false });
  assert.equal(written.upserted, 2);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(call => call.table), [
    'sunday_bulletin_reports',
    'sunday_bulletin_praise'
  ]);
  assert.equal(calls[0].options.onConflict, 'date');
});
