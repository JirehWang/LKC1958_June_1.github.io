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

function setupTestContext() {
  const scriptContent = source.split('<script').find(part => part.includes('allMembersRawData')).split('</script>')[0].replace(/^[^>]*>/, '');

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

  let successCb = null;
  let failureCb = null;
  let getMemberManagementDataCalled = 0;

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
          withSuccessHandler: function(fn) {
            successCb = fn;
            const runner = {
              withFailureHandler: function(fFn) {
                failureCb = fFn;
                return runner;
              },
              getMemberManagementData: function() {
                getMemberManagementDataCalled++;
              }
            };
            return runner;
          }
        }
      }
    },
    alert: () => {},
    confirm: () => true
  };

  vm.createContext(context);
  vm.runInContext(scriptContent, context);

  return {
    context,
    getEl,
    triggerSuccess: (data) => successCb && successCb(data),
    triggerFailure: (err) => failureCb && failureCb(err),
    getApiCallCount: () => getMemberManagementDataCalled
  };
}

test('member search while loading does not wipe table with empty results or fail loading', () => {
  const { context, getEl, triggerSuccess } = setupTestContext();

  // 1. Initial refresh starts loading
  context.refreshMemberTable();
  assert.equal(context.isMembersLoading, true);
  assert.match(getEl('memberTableBody').innerHTML, /資料載入中/);

  // 2. User types into search input while loading is in progress
  getEl('memberSearchInput').value = '余威達';
  context.filterMembers();

  // MUST NOT display "查無資料"
  assert.equal(getEl('memberTableBody').innerHTML.includes('查無資料'), false);
  // MUST retain loading spinner and indicate search keyword will be applied
  assert.match(getEl('memberTableBody').innerHTML, /余威達/);
  assert.match(getEl('memberTableBody').innerHTML, /資料載入中/);

  // 3. Data arrives
  const mockData = {
    members: [
      ['余威達', '男', '2026/08/30', '', false, '', '', 'LK00001', '未分組', '小羊'],
      ['陳大明', '男', '2026/08/30', '', false, '', '', 'LK00002', '喜樂組', '小羊']
    ],
    usageByUid: { LK00001: { effective: true } }
  };
  triggerSuccess(mockData);

  assert.equal(context.isMembersLoading, false);
  // Auto-filters by "余威達" that was typed ahead
  assert.match(getEl('memberTableBody').innerHTML, /余威達/);
  assert.equal(getEl('memberTableBody').innerHTML.includes('陳大明'), false);
  assert.equal(getEl('memberListSummary').textContent, '顯示 1 / 2 位會友');
});

test('concurrent calls to refreshMemberTable while loading are safely ignored', () => {
  const { context, getApiCallCount } = setupTestContext();

  context.refreshMemberTable();
  const countAfterFirst = getApiCallCount();

  // Second call while loading
  context.refreshMemberTable();
  assert.equal(getApiCallCount(), countAfterFirst, 'Duplicate call should be ignored while loading');
});

test('member load failure shows retry button and resets loading state', () => {
  const { context, getEl, triggerFailure } = setupTestContext();

  context.refreshMemberTable();
  assert.equal(context.isMembersLoading, true);

  triggerFailure(new Error('網路連線逾時'));
  assert.equal(context.isMembersLoading, false);
  assert.match(getEl('memberTableBody').innerHTML, /網路連線逾時/);
  assert.match(getEl('memberTableBody').innerHTML, /重新載入/);
  assert.equal(getEl('memberListSummary').textContent, '載入失敗');
});
