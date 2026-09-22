const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appDir = __dirname;
const repoRoot = path.resolve(appDir, '..', '..');
const indexHtml = fs.readFileSync(path.join(appDir, 'index.html'), 'utf8');
const configJs = fs.readFileSync(path.join(repoRoot, 'config.js'), 'utf8');

test('禮拜PPT uses the unified main GAS route for Bible queries', () => {
  assert.match(indexHtml, /window\._GAS_KEY\s*=\s*['"]LKC_WorshipPPT['"]/);
  assert.match(indexHtml, /window\._WORSHIP_PPT_LIBRARY_GAS_KEY\s*=\s*['"]LKC_WorshipPPT_LIBRARY['"]/);
  assert.match(indexHtml, /worship-ppt-supabase\.js\?v=20260918c/);
  assert.match(indexHtml, /read-api\.js\?v=20260922a/);
  assert.match(
    configJs,
    /"LKC_WorshipPPT"\s*:\s*"https:\/\/script\.google\.com\/macros\/s\/AKfycbxBOFeLiXu23kBMGU8iSvRyJci6fruTfk7HdahhcQFY777sCPSgasuNM7Z1CeuzuS-r\/exec"/
  );
  assert.match(
    configJs,
    /"LKC_WorshipPPT_LIBRARY"\s*:\s*"https:\/\/script\.google\.com\/macros\/s\/AKfycbwiYYWgKxmLRAEaE_pbp_kWyAzlRPcwYVQfvmJVamRJvosvt5wTTkvwebbFBkP8rMqX\/exec"/
  );
});
