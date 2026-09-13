const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const projectRoot = path.resolve(__dirname, '..');
const memberUiPath = path.join(
  projectRoot,
  'apps',
  'LKC_SundayserviceAttendance',
  'members.html'
);
const source = fs.readFileSync(memberUiPath, 'utf8');

test('member UI markup includes excluded tab, badges, and info banner', () => {
  assert.match(source, /id="btnViewExcluded"/);
  assert.match(source, /switchMemberView\('EXCLUDED'\)/);
  assert.match(source, /id="badgeGeneralCount"/);
  assert.match(source, /id="badgeExcludedCount"/);
  assert.match(source, /id="excludedInfoBanner"/);
  assert.match(source, /此分頁為「不列入統計」名單/);
});

test('tab switching and filtering isolates regular members from excluded members', () => {
  const scriptContent = source.split('<script')[1].split('</script>')[0].replace(/^[^>]*>/, '');

  const elements = {};
  function getEl(id) {
    if (!elements[id]) {
      elements[id] = {
        id,
        style: {},
        className: '',
        textContent: '',
        innerText: '',
        value: '',
        placeholder: '',
        innerHTML: '',
        checked: false,
        disabled: false
      };
    }
    return elements[id];
  }

  const context = {
    console,
    document: {
      getElementById: getEl,
      querySelector: () => null,
      querySelectorAll: () => []
    },
    window: {},
    google: {
      script: {
        run: {
          withSuccessHandler: () => ({
            withFailureHandler: () => ({
              getMemberManagementData: () => {},
              getOfficialMembers: () => {}
            }),
            getMemberManagementData: () => {},
            getOfficialMembers: () => {}
          })
        }
      }
    },
    alert: () => {},
    confirm: () => true
  };

  vm.createContext(context);
  vm.runInContext(scriptContent, context);

  // Setup test data: 3 active members, 2 excluded members
  context.allMembersRawData = [
    ['常態會友一', '男', '2025/01/01', '', false, '', '', 'LK00001', '喜樂組', '小羊'],
    ['常態會友二', '女', '2025/01/01', '', false, '', '', 'LK00002', '和平組', '小羊'],
    ['不統計會友甲', '男', '2025/01/01', '出國', true, '', '', 'LK00003', '', '小羊'],
    ['常態會友三', '女', '2025/01/01', '', false, '', '', 'LK00004', '仁愛組', '小羊'],
    ['不統計會友乙', '女', '2025/01/01', '長照', true, '', '', 'LK00005', '', '小羊']
  ];
  context.memberUsageByUid = {};

  // 1. Check updateMemberCounts
  context.updateMemberCounts();
  assert.equal(getEl('badgeGeneralCount').textContent, 3);
  assert.equal(getEl('badgeExcludedCount').textContent, 2);

  // 2. Test GENERAL view (Default)
  context.switchMemberView('GENERAL');
  assert.equal(context.currentMemberView, 'GENERAL');
  assert.equal(getEl('viewGeneralMembers').style.display, 'block');
  assert.equal(getEl('excludedInfoBanner').style.display, 'none');
  assert.equal(getEl('memberListSummary').textContent, '共 3 位會友');
  // Check rendered table rows in GENERAL view
  assert.match(getEl('memberTableBody').innerHTML, /常態會友一/);
  assert.match(getEl('memberTableBody').innerHTML, /常態會友二/);
  assert.match(getEl('memberTableBody').innerHTML, /常態會友三/);
  assert.equal(getEl('memberTableBody').innerHTML.includes('不統計會友甲'), false);
  assert.equal(getEl('memberTableBody').innerHTML.includes('不統計會友乙'), false);

  // 3. Test openMemberModal in GENERAL view
  context.openMemberModal();
  assert.equal(getEl('editIsExcluded_Mem').checked, false);
  assert.equal(getEl('memModalHeader').innerText, '新增會友資料');

  // 4. Test EXCLUDED view
  context.switchMemberView('EXCLUDED');
  assert.equal(context.currentMemberView, 'EXCLUDED');
  assert.equal(getEl('viewGeneralMembers').style.display, 'block');
  assert.equal(getEl('excludedInfoBanner').style.display, 'flex');
  assert.equal(getEl('memberListSummary').textContent, '共 2 位會友');
  // Check rendered table rows in EXCLUDED view
  assert.match(getEl('memberTableBody').innerHTML, /不統計會友甲/);
  assert.match(getEl('memberTableBody').innerHTML, /不統計會友乙/);
  assert.equal(getEl('memberTableBody').innerHTML.includes('常態會友一'), false);
  assert.equal(getEl('memberTableBody').innerHTML.includes('常態會友二'), false);
  assert.equal(getEl('memberTableBody').innerHTML.includes('常態會友三'), false);

  // 5. Test openMemberModal in EXCLUDED view
  context.openMemberModal();
  assert.equal(getEl('editIsExcluded_Mem').checked, true);
  assert.equal(getEl('memModalHeader').innerText, '新增不統計會友');
});
