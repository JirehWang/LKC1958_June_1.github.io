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
