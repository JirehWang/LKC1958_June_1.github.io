const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const projectRoot = path.resolve(__dirname, '..');
const memberPagePath = path.join(
  projectRoot,
  'apps',
  'LKC_SundayserviceAttendance',
  'members.html'
);
const memberPage = fs.readFileSync(memberPagePath, 'utf8');
const inlineScript = memberPage.split('<script').slice(1)[0]
  .split('</script>')[0]
  .replace(/^[^>]*>/, '');

function loadOfficialSourceHelpers() {
  const start = inlineScript.indexOf('function normalizeOfficialMember');
  const end = inlineScript.indexOf('function updateOfficialCategoryCounts', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const context = {
    window: {
      INITIAL_OFFICIAL_MEMBERS: [
        { name: '預置甲', category_code: 'CAT_1', category_name: '1. 應到會員', voting_rights: true, is_resident: true },
        { name: '預置乙', category_code: 'CAT_6', category_name: '6. 未陪餐籍在人不在', voting_rights: false, is_resident: false }
      ]
    }
  };
  vm.createContext(context);
  vm.runInContext(inlineScript.slice(start, end), context, { filename: memberPagePath });
  return context;
}

test('official member API results remain the source of truth', () => {
  const context = loadOfficialSourceHelpers();
  const merged = context.mergeOfficialMemberSources([
    { rowIndex: 2, name: '預置甲', categoryCode: 'CAT_1', categoryName: '1. 應到會員', uid: 'LK00001' },
    { rowIndex: 3, name: '伺服器新增', categoryCode: 'CAT_2', categoryName: '2. 準會員' }
  ]);

  assert.equal(merged.length, 2);
  assert.equal(merged.every(member => member.rowIndex > 0), true);
});

test('member list UI uses seven columns and data-driven official category counts', () => {
  assert.match(memberPage, /<tbody id="officialMemberTableBody">\s*<tr><td colspan="7"/);
  assert.match(memberPage, /data-category="ALL"/);
  assert.match(memberPage, /function updateOfficialCategoryCounts/);
  assert.match(memberPage, /共 \$\{total\} 位會友/);
});

test('member list UI maps small group to row[8] from cached members schema', () => {
  assert.match(memberPage, /const groupStr = String\(row\[8\] \|\| ''\)\.trim\(\);/);
  assert.match(memberPage, /const group = \(row\[8\] \|\| ""\)\.toString\(\)\.toLowerCase\(\);/);
});

