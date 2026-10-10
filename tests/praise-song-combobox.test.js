const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.join(__dirname, '..');
const praisePage = fs.readFileSync(
  path.join(repoRoot, 'apps', 'LKC_SundayBulletin', 'praise.html'),
  'utf8'
);

test('praise page uses one keyword-searchable song title combobox', () => {
  const titleInput = praisePage.match(/<input[^>]+id="songTitle"[^>]*>/)?.[0] || '';

  assert.match(titleInput, /role="combobox"/);
  assert.match(titleInput, /aria-controls="songHistoryListbox"/);
  assert.match(praisePage, /id="songHistoryListbox"/);
  assert.match(praisePage, /handleSongTitleInput/);
  assert.match(praisePage, /getMatchingPraiseHistorySongs/);
  assert.match(praisePage, /\.includes\(normalizedKeyword\)/);
  assert.doesNotMatch(praisePage, /id="songHistorySearch"/);
  assert.doesNotMatch(praisePage, /id="songHistorySelect"/);
});

test('praise upload preserves the selected source when correcting a song title', () => {
  assert.match(praisePage, /songId: ''/);
  assert.match(praisePage, /sourceDate: ''/);
  assert.match(praisePage, /state\.sourceDate = data\.sourceDate \|\| \(/);
  assert.match(praisePage, /const hasExistingSource = \(/);
  assert.match(praisePage, /const titleChangedFromSource = \(/);
  assert.match(praisePage, /titleIndexMode === 'rename'/);
  assert.match(praisePage, /sbService\.renamePraiseTitle\(state\.songId, state\.title\)/);
  assert.match(praisePage, /action', 'praise_saveSong'/);
  assert.match(praisePage, /action', 'praise_bindDate'/);
  assert.match(praisePage, /id="btnDeleteSong"/);
  assert.match(praisePage, /id="btnBindPraiseDate"/);
  assert.match(praisePage, /儲存／更新歌曲/);
  assert.match(praisePage, /指定為本日歌曲/);
  assert.match(praisePage, /清除本日歌曲/);
  assert.match(praisePage, /async function bindSelectedPraiseDate/);
  assert.match(praisePage, /日期歌曲不會變更/);
  assert.match(praisePage, /confirm\(/);
  assert.match(praisePage, /loadPraiseByDate/);
});
