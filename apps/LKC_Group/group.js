// --- 基礎變數設定 ---
const urlParams = new URLSearchParams(window.location.search);
const groupName = urlParams.get('name');
const groupCode = urlParams.get('code');

let currentMembers = []; // [{ name, uid, role }]
let editingMembers = [];
let recentRecordsData = [];
let nameDirectory = {};  // uid → name 反查表（從後端 RAW_MODE 回傳）
let isInitializingMemberList = false;
let groupType = '一般小組';


// 共用：UID 反查姓名（找不到就直接回傳原字串）
function resolveDisplayName(uidOrName) {
  if (!uidOrName) return "";
  const s = String(uidOrName).trim();
  if (/^LK\d+$/i.test(s)) return nameDirectory[s.toUpperCase()] || s;
  return s; // 不是 UID 格式（可能是新朋友）就直接顯示
}

// --- 📦 網頁載入啟動流程 ---
window.onload = async () => {
    try {
        showLoading("🚀 正在啟動安全通道...");
        await ensureAPIReady();
        document.getElementById('displayGroupName').innerText = groupName || '未知名組別';
        document.getElementById('attendanceDate').valueAsDate = new Date();
        await checkGroupStatus();
    } catch (e) {
        console.error(e);
        userNotification.error("系統啟動失敗：" + e.message);
        hideLoading();
    }
};

async function callAPI(action, data = {}) {
    if (window.GroupSupabaseService && typeof window.GroupSupabaseService[action] === 'function') {
        try {
            const res = await window.GroupSupabaseService[action](data);
            if (res !== null && typeof res === 'object') return res;
        } catch (e) {
            console.warn('[GroupSupabase] Direct call error, fallback:', e);
        }
    }
    if (typeof window.churchAPI !== 'function') throw new Error("安全路由尚未載入");
    return await window.churchAPI(action, data);
}

// 💡 更新：加入陪伴同工與 BEST 的 CSS Class
function getRoleClass(role) {
    if (role === '核心同工' || role === '福長' || role === '同工') return 'role-core';
    if (role === '一般同工') return 'role-general';
    if (role === '小羊') return 'role-sheep';
    if (role === '陪伴同工') return 'role-companion'; 
    if (role === 'BEST' || role === '慕道友') return 'role-best';
    return 'role-default';
}

function normalizeNames(inputString) {
    if (!inputString) return "";
    const splitRegex = /[^\u4e00-\u9fa5a-zA-Z0-9\s]+/; 
    return inputString.split(splitRegex).map(s => s.trim()).filter(n => n).join(',');
}

async function checkGroupStatus() {
    showLoading("正在載入點名單與聚會紀錄...");
    try {
        const res = await callAPI('checkGroupStatus', { groupName });
        groupType = res.type || '一般小組';
        
        // 根據小組類型動態調整 UI 標誌與按鈕
        if (groupType === '幸福小組') {
            document.getElementById('happyGroupBadge').style.display = 'inline-block';
            document.getElementById('concludeBtn').style.display = 'inline-block';
        } else {
            document.getElementById('happyGroupBadge').style.display = 'none';
            document.getElementById('concludeBtn').style.display = 'none';
        }

        const isInit = res.isInitialized || (res.success && Array.isArray(res.members) && res.members.length > 0);

        if (isInit) {
            currentMembers = res.members || [];
            document.getElementById('attendance-panel').style.display = 'block';
            document.getElementById('init-panel').style.display = 'none'; 
            renderMemberList(currentMembers);
            
            if (groupCode) {
                document.getElementById('scheduleBtn').style.display = 'inline-block';
                await loadGroupProgress();
            }
        } else {
            document.getElementById('init-panel').style.display = 'block';
            document.getElementById('attendance-panel').style.display = 'none'; 
        }
    } catch (e) {
        userNotification.error("載入失敗，請重新整理頁面。");
    } finally {
        hideLoading();
    }
}

function goToSchedule() {
    if (!groupCode) return userNotification.warning("未取得小組編號，無法跳轉。");
    window.open(`https://jirehwang.github.io/LKC1958_June_1.github.io/apps/LKC_MinistrySchedule/?id=${groupCode}&from=group`, '_blank');
}

function goToFullStats() {
    window.open(`https://jirehwang.github.io/LKC1958_June_1.github.io/apps/LKC_Group/stats.html?id=${groupCode || ''}`, '_blank');
}

async function loadGroupProgress() {
    const tbody = document.getElementById('progressTableBody');
    if (!tbody) return;
    document.getElementById('progressSection').style.display = 'block';

    try {
        const res = await callAPI('getStats', { 
            groupName: groupName, 
            groupCode: groupCode, 
            startDate: "RAW_MODE", 
            endDate: "" 
        });
        
        if (res.success && res.data.length > 0) {
            // \u63a5\u6536 nameDirectory \u7528\u65bc UID \u53cd\u67e5
            if (res.nameDirectory) nameDirectory = res.nameDirectory;

            const sortedData = res.data.slice().sort((a, b) => {
                return new Date(b[0]).getTime() - new Date(a[0]).getTime();
            });
            recentRecordsData = sortedData.slice(0, 3);

            const splitRegex = /[^\u4e00-\u9fa5a-zA-Z0-9\s]+/;

            tbody.innerHTML = recentRecordsData.map((row, index) => {
                const dateObj = new Date(row[0]);
                const dateStr = `${dateObj.getMonth() + 1}/${dateObj.getDate()}`;

                const fullDateStr = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}`;
                row.fullDateStr = fullDateStr;

                const presentRaw = row[1] ? row[1].toString().split(splitRegex).map(s=>s.trim()).filter(n=>n) : [];
                const present = presentRaw.map(resolveDisplayName);  // UID \u2192 \u59d3\u540d
                const newFriends = row[3] ? row[3].toString().split(splitRegex).map(s=>s.trim()).filter(n=>n) : [];
                const totalCount = present.length + newFriends.length;
                
                let namesHtml = present.join('、');
                if (newFriends.length > 0) {
                    namesHtml += ` <span style="color:#ef6c00; font-size:12px; font-weight:bold;">(+新朋友: ${newFriends.join('、')})</span>`;
                }

                return `
                    <tr>
                        <td><span style="background: #e3f2fd; padding: 3px 8px; border-radius: 12px; font-weight: bold; font-size: 12px;">${dateStr}</span></td>
                        <td style="font-weight: bold; font-size: 16px;">${totalCount} 人</td>
                        <td style="text-align: left; font-size: 13px; color: #555;">
                            ${namesHtml || '無出席紀錄'}
                            <button class="edit-record-btn" onclick="openEditAttendanceModal(${index})">✏️</button>
                        </td>
                    </tr>
                `;
            }).join('');
        } else {
            tbody.innerHTML = '<tr><td colspan="3" style="color: #999; padding: 20px;">目前尚無聚會紀錄</td></tr>';
        }
    } catch (e) {
        tbody.innerHTML = '<tr><td colspan="3" style="color: red;">讀取紀錄失敗</td></tr>';
    }
}

// 💡 更新：歷史紀錄修改時，同樣照常顯示所有人
function openEditAttendanceModal(index) {
    const row = recentRecordsData[index];
    const originalDate = row.fullDateStr;
    const splitRegex = /[^\u4e00-\u9fa5a-zA-Z0-9\s]+/; 
    const presentUidArr = row[1] ? row[1].toString().split(splitRegex).map(s=>s.trim()).filter(n=>n) : [];
    const presentUidSet = new Set(presentUidArr.map(s => s.toUpperCase()));
    const newFriendsStr = row[3] ? row[3].toString().split(splitRegex).map(s=>s.trim()).filter(n=>n).join(',') : '';

    document.getElementById('editOriginalDate').value = originalDate;
    document.getElementById('editAttendanceDate').value = originalDate;
    document.getElementById('editNewFriends').value = newFriendsStr;

    const listDiv = document.getElementById('editAttendanceMemberList');

    // checkbox value 用 UID 或姓名 (對於 BEST)；顯示「姓名 (暱稱)」
    listDiv.innerHTML = currentMembers.map(m => {
        const uid = m.uid || '';
        const isChecked = (uid && presentUidSet.has(uid.toUpperCase())) || (!uid && presentUidSet.has(m.name.toUpperCase())) ? 'checked' : '';
        const roleClass = getRoleClass(m.role);
        const nickname = (m.nickname || '').trim();
        const nicknameTag = nickname
            ? ` <small style="color:#999; font-weight:normal; margin-left:2px;">(${nickname})</small>`
            : '';
        return `
            <div class="member-item">
                <input type="checkbox" class="edit-attendance-check" value="${uid || m.name}" data-name="${m.name}" ${isChecked}>
                <span class="role-badge ${roleClass}">${m.role}</span>
                <span style="font-size: 16px; font-weight: bold; color: #333;">${m.name}${nicknameTag}</span>
            </div>
        `;
    }).join('');

    document.getElementById('edit-attendance-modal').style.display = 'block';
}

function closeEditAttendanceModal() {
    document.getElementById('edit-attendance-modal').style.display = 'none';
}

async function submitAttendanceEdit() {
    const originalDate = document.getElementById('editOriginalDate').value;
    const newDate = document.getElementById('editAttendanceDate').value;
    const newFriends = normalizeNames(document.getElementById('editNewFriends').value);

    // 都送 UID（cb.value 已是 UID）；篩掉空字串
    const present = Array.from(document.querySelectorAll('.edit-attendance-check:checked')).map(cb => cb.value).filter(v => v);
    const absent = Array.from(document.querySelectorAll('.edit-attendance-check:not(:checked)')).map(cb => cb.value).filter(v => v);

    if (present.length === 0 && !newFriends) {
        if (!confirm("修改後出席人數為 0，確定要儲存嗎？")) return;
    }

    showLoading("正在更新點名紀錄...");
    try {
        const res = await callAPI('updateAttendanceRecord', { groupName, originalDate, newDate, present, absent, newFriends });
        if (res.success) {
            userNotification.success('修改成功！');
            closeEditAttendanceModal();
            if (groupCode) await loadGroupProgress();
        } else { userNotification.error('修改失敗：' + res.message); }
    } finally { hideLoading(); }
}

async function deleteAttendanceRecord() {
    const originalDate = document.getElementById('editOriginalDate').value;
    if (!confirm(`確定要將【${originalDate}】的點名紀錄完全刪除嗎？刪除後無法復原喔！`)) return;

    showLoading("正在刪除紀錄...");
    try {
        const res = await callAPI('deleteAttendanceRecord', { groupName, originalDate });
        if (res.success) {
            userNotification.success('紀錄已刪除！');
            closeEditAttendanceModal();
            if (groupCode) await loadGroupProgress();
        } else { userNotification.error('刪除失敗：' + res.message); }
    } finally { hideLoading(); }
}

// 點名介面：checkbox value 用 UID 或姓名 (對於 BEST)，顯示「姓名 (暱稱)」
//   - 有暱稱：王小明 (明哥)
//   - 沒暱稱：王小明
function renderMemberList(members) {
    const list = document.getElementById('memberList');
    if (members.length === 0) {
        list.innerHTML = '<div style="color:#999; padding: 10px;">目前名單為空</div>';
        return;
    }
    list.innerHTML = members.map(m => {
        const roleClass = getRoleClass(m.role);
        const uid = m.uid || '';
        const nickname = (m.nickname || '').trim();
        const nicknameTag = nickname
            ? ` <small style="color:#999; font-weight:normal; margin-left:2px;">(${nickname})</small>`
            : '';
        return `
            <div class="member-item">
                <input type="checkbox" class="attendance-check" value="${uid || m.name}" data-name="${m.name}">
                <span class="role-badge ${roleClass}">${m.role}</span>
                <span style="font-size: 16px; font-weight: bold; color: #333;">${m.name}${nicknameTag}</span>
            </div>
        `;
    }).join('');
}

async function toggleEditMode() {
    const modal = document.getElementById('edit-modal');
    if (modal.style.display === 'block') {
        closeMemberManagerModal();
    } else {
        isInitializingMemberList = false;
        editingMembers = currentMembers.map(m => ({...m}));
        await prepareMemberManagerModal();
        modal.style.display = 'block';
    }
}

async function openInitMemberManager() {
    isInitializingMemberList = true;
    editingMembers = [];
    await prepareMemberManagerModal();
    document.getElementById('edit-modal').style.display = 'block';
}

const GROUP_ROLE_CATALOG_DEFAULTS = {
    '幸福小組': ['BEST', '同工', '福長', '陪伴同工'],
    '一般小組': ['小羊', '一般同工', '核心同工', '陪伴同工']
};

function getGroupRoleCatalogCache() {
    if (!window._groupRoleCatalogCache) window._groupRoleCatalogCache = {};
    return window._groupRoleCatalogCache;
}

function getCurrentGroupRoleCatalog() {
    const type = String(groupType || '一般小組');
    const catalog = getGroupRoleCatalogCache()[type];
    if (Array.isArray(catalog) && catalog.length) return catalog;
    return GROUP_ROLE_CATALOG_DEFAULTS[type] || GROUP_ROLE_CATALOG_DEFAULTS['一般小組'];
}

function escapeGroupRoleHtml(value) {
    return String(value || '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
}

async function loadGroupRoleCatalogForEditor() {
    const type = String(groupType || '一般小組');
    try {
        const res = await callAPI('getGroupRoleCatalog', { groupType: type });
        if (res && res.success && Array.isArray(res.roles) && res.roles.length) {
            getGroupRoleCatalogCache()[type] = res.roles.map(role => String(role).trim()).filter(Boolean);
        }
    } catch (e) {
        console.warn('[GroupRoleCatalog] 載入失敗，先使用預設身分清單：', e);
    }
}

function renderGroupRoleCatalogDraft() {
    const list = document.getElementById('groupRoleCatalogEntries');
    if (!list) return;
    const draft = window._groupRoleCatalogDraft || [];
    list.innerHTML = draft.map((role, index) => `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 0;border-bottom:1px solid #eee;">
            <span>${escapeGroupRoleHtml(role)}</span>
            <button type="button" data-role-index="${index}" style="border:0;background:#fff1f0;color:#b42318;border-radius:6px;padding:5px 9px;">移除</button>
        </div>
    `).join('') || '<div style="padding:8px 0;color:#777;">目前沒有身分選項</div>';
    list.querySelectorAll('button[data-role-index]').forEach(button => {
        button.addEventListener('click', () => {
            const draftRoles = window._groupRoleCatalogDraft || [];
            draftRoles.splice(Number(button.dataset.roleIndex), 1);
            window._groupRoleCatalogDraft = draftRoles;
            renderGroupRoleCatalogDraft();
        });
    });
}

function ensureGroupRoleCatalogSettingsPanel() {
    const list = document.getElementById('editMemberList');
    if (!list || !list.parentNode || document.getElementById('groupRoleCatalogSettings')) return;
    const panel = document.createElement('section');
    panel.id = 'groupRoleCatalogSettings';
    panel.style.cssText = 'margin:14px 0;padding:12px;border:1px solid #d9e2f0;border-radius:10px;background:#f8fbff;';
    panel.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
            <div><strong>身分清單設定</strong><div style="font-size:12px;color:#667085;margin-top:3px;">依小組類型共用，僅管理者可修改</div></div>
            <button type="button" id="toggleGroupRoleCatalogPanel" style="border:1px solid #c8d5e6;background:#fff;border-radius:7px;padding:7px 10px;">管理身分</button>
        </div>
        <div id="groupRoleCatalogAdminPanel" hidden style="margin-top:12px;padding-top:12px;border-top:1px solid #d9e2f0;">
            <div style="font-size:13px;margin-bottom:8px;">目前類型：<strong id="groupRoleCatalogTypeLabel"></strong></div>
            <div style="display:flex;gap:7px;">
                <input type="password" id="groupRoleCatalogAdminCode" autocomplete="current-password" placeholder="管理者代碼" style="min-width:0;flex:1;padding:8px;border:1px solid #ccd5e0;border-radius:7px;">
                <button type="button" id="verifyGroupRoleCatalogAdmin" style="border:0;background:#2f5e9e;color:#fff;border-radius:7px;padding:8px 11px;">驗證並載入</button>
            </div>
            <div id="groupRoleCatalogEditor" hidden>
                <div id="groupRoleCatalogEntries" style="margin-top:8px;"></div>
                <div style="display:flex;gap:7px;margin-top:10px;">
                    <input type="text" id="newGroupRoleCatalogEntry" maxlength="40" placeholder="新增身分名稱" style="min-width:0;flex:1;padding:8px;border:1px solid #ccd5e0;border-radius:7px;">
                    <button type="button" id="addGroupRoleCatalogEntry" style="border:1px solid #c8d5e6;background:#fff;border-radius:7px;padding:8px 11px;">新增</button>
                </div>
                <button type="button" id="saveGroupRoleCatalog" style="width:100%;margin-top:10px;border:0;background:#2f5e9e;color:#fff;border-radius:7px;padding:9px;">儲存身分清單</button>
            </div>
            <div id="groupRoleCatalogStatus" role="status" style="font-size:13px;margin-top:8px;color:#667085;"></div>
        </div>
    `;
    list.parentNode.insertBefore(panel, list);
    document.getElementById('groupRoleCatalogTypeLabel').textContent = String(groupType || '一般小組');
    document.getElementById('toggleGroupRoleCatalogPanel').addEventListener('click', () => {
        const adminPanel = document.getElementById('groupRoleCatalogAdminPanel');
        adminPanel.hidden = !adminPanel.hidden;
    });
    document.getElementById('verifyGroupRoleCatalogAdmin').addEventListener('click', unlockGroupRoleCatalogSettings);
    document.getElementById('addGroupRoleCatalogEntry').addEventListener('click', addGroupRoleCatalogEntry);
    document.getElementById('saveGroupRoleCatalog').addEventListener('click', saveGroupRoleCatalog);
}

async function unlockGroupRoleCatalogSettings() {
    const status = document.getElementById('groupRoleCatalogStatus');
    const editor = document.getElementById('groupRoleCatalogEditor');
    const adminCode = (document.getElementById('groupRoleCatalogAdminCode').value || '').trim();
    if (!adminCode) {
        status.textContent = '請輸入管理者代碼。';
        return;
    }
    status.textContent = '正在驗證並載入身分清單…';
    try {
        const auth = await callAPI('verifyGroupRoleAdmin', { adminCode });
        if (!auth || !auth.success || !auth.isAdmin) {
            editor.hidden = true;
            status.textContent = '管理者驗證未通過。';
            return;
        }
        const res = await callAPI('getGroupRoleCatalog', { groupType: String(groupType || '一般小組') });
        if (!res || !res.success || !Array.isArray(res.roles)) {
            editor.hidden = true;
            status.textContent = (res && res.message) || '無法載入身分清單，請確認資料庫設定已完成。';
            return;
        }
        window._groupRoleCatalogDraft = [...res.roles];
        editor.hidden = false;
        status.textContent = '已載入。修改後按「儲存身分清單」。';
        renderGroupRoleCatalogDraft();
    } catch (e) {
        editor.hidden = true;
        status.textContent = '載入失敗，請稍後再試。';
    }
}

function addGroupRoleCatalogEntry() {
    const input = document.getElementById('newGroupRoleCatalogEntry');
    const status = document.getElementById('groupRoleCatalogStatus');
    const role = String(input.value || '').trim();
    const draft = window._groupRoleCatalogDraft || [];
    if (!role) { status.textContent = '請先輸入身分名稱。'; return; }
    if (draft.some(item => String(item).toLocaleLowerCase() === role.toLocaleLowerCase())) {
        status.textContent = '這個身分已經存在。';
        return;
    }
    if (draft.length >= 30) { status.textContent = '身分選項最多可設定 30 個。'; return; }
    draft.push(role);
    window._groupRoleCatalogDraft = draft;
    input.value = '';
    status.textContent = '';
    renderGroupRoleCatalogDraft();
}

async function saveGroupRoleCatalog() {
    const status = document.getElementById('groupRoleCatalogStatus');
    const adminCode = (document.getElementById('groupRoleCatalogAdminCode').value || '').trim();
    const roles = window._groupRoleCatalogDraft || [];
    if (!roles.length) { status.textContent = '至少保留一個身分選項。'; return; }
    status.textContent = '正在儲存…';
    try {
        const res = await callAPI('saveGroupRoleCatalog', {
            adminCode,
            groupType: String(groupType || '一般小組'),
            roles
        });
        if (!res || !res.success) {
            status.textContent = (res && res.message) || '儲存失敗，請稍後再試。';
            return;
        }
        getGroupRoleCatalogCache()[String(groupType || '一般小組')] = [...roles];
        applyGroupRoleCatalogToEditor();
        status.textContent = '身分清單已儲存並套用。';
    } catch (e) {
        status.textContent = '儲存失敗，請稍後再試。';
    }
}

function applyGroupRoleCatalogToEditor() {
    const roleSelect = document.getElementById('newMemberRole');
    if (roleSelect) {
        const currentValue = roleSelect.value;
        const roles = getCurrentGroupRoleCatalog();
        roleSelect.innerHTML = roles.map(role => `<option value="${escapeGroupRoleHtml(role)}">${escapeGroupRoleHtml(role)}</option>`).join('');
        roleSelect.value = roles.includes(currentValue) ? currentValue : roles[0];
    }
    renderEditList();
}

async function prepareMemberManagerModal() {
    const title = document.getElementById('editModalTitle');
    const saveBtn = document.getElementById('saveMemberListBtn');
    if (title) {
        title.innerText = isInitializingMemberList ? '🚀 建立成員名單與身分' : '📝 管理名單與身分';
    }
    if (saveBtn) {
        saveBtn.innerText = isInitializingMemberList ? '🚀 建立名單' : '💾 儲存變更';
    }
    const input = document.getElementById('newMemberInput');
    const roleSelect = document.getElementById('newMemberRole');
    if (input) input.value = "";
    
    await loadGroupRoleCatalogForEditor();
    if (roleSelect) {
        const roles = getCurrentGroupRoleCatalog();
        roleSelect.innerHTML = roles.map(role => `<option value="${escapeGroupRoleHtml(role)}">${escapeGroupRoleHtml(role)}</option>`).join('');
        roleSelect.value = roles[0];
    }
    ensureGroupRoleCatalogSettingsPanel();
    renderEditList();
    loadMemberSuggestions();    // 載入主日所有會友到 datalist
}

function closeMemberManagerModal() {
    document.getElementById('edit-modal').style.display = 'none';
    isInitializingMemberList = false;
    const adminCodeInput = document.getElementById('groupRoleCatalogAdminCode');
    const adminPanel = document.getElementById('groupRoleCatalogAdminPanel');
    const roleEditor = document.getElementById('groupRoleCatalogEditor');
    if (adminCodeInput) adminCodeInput.value = '';
    if (adminPanel) adminPanel.hidden = true;
    if (roleEditor) roleEditor.hidden = true;
    window._groupRoleCatalogDraft = [];
}

async function initGroupWithMembers() {
    if (editingMembers.length === 0) return userNotification.warning('請先新增至少一位成員');
    if (!confirm('確定要用這份名單建立小組成員與身分嗎？')) return;

    showLoading("正在建立雲端分頁，這可能需要幾秒鐘...");
    try {
        const res = await callAPI('initGroup', { groupName, members: editingMembers });
        if (res.success) {
            const syncRes = await callAPI('updateMemberList', { groupName, members: editingMembers });
            if (!syncRes.success) {
                userNotification.warning('名單分頁已建立，但同步主日名單失敗：' + syncRes.message);
                closeMemberManagerModal();
                await checkGroupStatus();
                return;
            }
            userNotification.success('名單建立成功！');
            closeMemberManagerModal();
            await checkGroupStatus();
        } else {
            userNotification.error(res.message);
        }
    } catch (e) {
        userNotification.error("連線發生錯誤，請稍後再試。");
    } finally {
        hideLoading();
    }
}

// 從主日載入所有會友，填 datalist
//   - 單一同名者：直接顯示姓名（最簡潔）
//   - 同名 2 個以上：顯示「姓名 (LK00001)」做區別（無暱稱時的最後手段）
let _memberSuggestionsCache = null;
async function loadMemberSuggestions() {
    const datalist = document.getElementById('memberSuggestionsList');
    if (!datalist) return;

    const buildOptions = (data) => {
        // 先排除已在名單中的（同 name+uid 才算重複，避免擋掉同名不同人）
        const existingKey = new Set(editingMembers.map(m => `${m.name}__${m.uid || ''}`));
        const candidates = data.filter(m => !existingKey.has(`${m.name}__${m.uid}`));

        // 計算每個 name 的出現次數，決定 datalist 顯示格式
        const nameCount = {};
        candidates.forEach(m => { nameCount[m.name] = (nameCount[m.name] || 0) + 1; });

        datalist.innerHTML = candidates.map(m => {
            const label = nameCount[m.name] > 1
                ? `${m.name} (${m.uid})`   // 同名多人 → 標 UID 區分
                : m.name;                  // 唯一 → 純姓名
            return `<option value="${label}"></option>`;
        }).join('');
    };

    if (_memberSuggestionsCache) {
        buildOptions(_memberSuggestionsCache);
        return;
    }

    try {
        const res = await callAPI('getMemberSuggestions', {});
        const list = (res && res.success && (res.data || res.members)) || null;
        if (list) {
            _memberSuggestionsCache = list;
            buildOptions(list);
        }
    } catch (e) {
        console.warn('載入會友建議清單失敗', e);
    }
}

// 💡 更新：編輯名單可拖曳排序，順序會套用到小組點名介面
//    為了避免拖曳後 index 失準，所有事件改用 data-name 對應
let _editSortableInstance = null;
function renderEditList() {
    const container = document.getElementById('editMemberList');
    if (editingMembers.length === 0) {
        container.innerHTML = '<div class="empty-hint">目前名單為空</div>';
        if (_editSortableInstance) { _editSortableInstance.destroy(); _editSortableInstance = null; }
        return;
    }
    
    const roleOptions = getCurrentGroupRoleCatalog();

    container.innerHTML = editingMembers.map(m => {
        const safeName = (m.name || '').replace(/'/g, "&#39;");
        const nickname = (m.nickname || '').replace(/"/g, '&quot;');
        
        // 生成對應身分的 selected 屬性
        const curRole = m.role || (groupType === '幸福小組' ? 'BEST' : '小羊');
        const memberRoles = roleOptions.includes(curRole) ? roleOptions : [curRole, ...roleOptions];
        const roleOptionsWithSelected = memberRoles.map(role => `
            <option value="${escapeGroupRoleHtml(role)}"${role === curRole ? ' selected' : ''}>${escapeGroupRoleHtml(role)}</option>
        `).join('');

        return `
            <div class="edit-member-item" data-name="${safeName}">
                <div style="display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0; flex-wrap: wrap;">
                    <span class="drag-handle" title="按住拖曳排序"
                          style="cursor: grab; color:#999; font-size:18px; padding:0 4px; user-select:none; touch-action:none;">⋮⋮</span>
                    <span style="font-weight:bold; white-space:nowrap;">${m.name}</span>
                    <select class="edit-role-select" onchange="updateMemberRoleByName('${safeName}', this.value)">
                        ${roleOptionsWithSelected}
                    </select>
                    <input type="text"
                           placeholder="暱稱"
                           value="${nickname}"
                           onchange="updateMemberNicknameByName('${safeName}', this.value)"
                           style="width: 90px; padding: 4px 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 13px;">
                </div>
                <button class="btn-remove" onclick="removeEditMemberByName('${safeName}')">🗑️</button>
            </div>
        `;
    }).join('');

    // 初始化拖曳（每次 render 都重建）
    if (_editSortableInstance) { _editSortableInstance.destroy(); }
    if (typeof Sortable !== 'undefined') {
        _editSortableInstance = Sortable.create(container, {
            animation: 200,
            handle: '.drag-handle',
            ghostClass: 'sortable-ghost',
            chosenClass: 'sortable-chosen',
            forceFallback: true, // 啟用 Fallback 機制，確保手機端觸控拖曳順暢
            fallbackTolerance: 3, // 容許微小位移，避免誤點擊
            onEnd: function() {
                // 依 DOM 當前順序重排 editingMembers
                const newOrder = Array.from(container.children)
                    .map(el => el.dataset.name)
                    .filter(n => n);
                editingMembers.sort((a, b) => {
                    const ia = newOrder.indexOf(a.name);
                    const ib = newOrder.indexOf(b.name);
                    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
                });
            }
        });
    }
}

// 新增成員：支援兩種輸入
//   1. 從下拉選擇 → 純姓名（同名者下拉會自動標註區別 UID）
//   2. 直接輸入新名字 → 純文字（uid 留空，後端會自動建檔產生新 UID）
//
//   為了區分同名，下拉的 value 仍可能含 "(LK00001)" 後綴 → 自動解析
function addEditMember() {
    const input = document.getElementById('newMemberInput');
    const roleSelect = document.getElementById('newMemberRole');

    const raw = (input.value || '').trim();
    const newRole = roleSelect ? roleSelect.value : getCurrentGroupRoleCatalog()[0];
    if (!raw) return userNotification.warning("請輸入要新增的姓名！");

    // 解析「名字 (LKxxxxx)」格式（同名情況下會看到）
    const m = raw.match(/^(.+?)\s*\((LK\d+)\)\s*$/i);
    let newName = m ? m[1].trim() : raw;
    let newUid  = m ? m[2].trim().toUpperCase() : '';

    // 若使用者只打了姓名，且主日剛好有 唯一一個 同名會友 → 自動帶入 UID
    if (!newUid && _memberSuggestionsCache) {
        const matched = _memberSuggestionsCache.filter(x => x.name === newName);
        if (matched.length === 1) newUid = matched[0].uid;
    }

    // 同名 + 同 UID 才視為重複（容許多個同名但 UID 不同的人）
    const dup = editingMembers.some(em =>
        em.name === newName && (em.uid || '') === newUid
    );
    if (dup) return userNotification.warning("此人已經在名單中了！");

    editingMembers.push({ name: newName, uid: newUid, role: newRole, nickname: '' });
    input.value = "";
    renderEditList();
    loadMemberSuggestions();
}

// 舊版（保留向下相容，依 index）
function updateMemberRole(index, newRole) { if (editingMembers[index]) editingMembers[index].role = newRole; }
function removeEditMember(index) {
    const nameToRemove = editingMembers[index] && editingMembers[index].name;
    if (!nameToRemove) return;
    if (confirm(`確定要將【${nameToRemove}】從名單中移除嗎？`)) {
        editingMembers.splice(index, 1);
        renderEditList();
    }
}

// 新版（不受拖曳影響，依姓名查找）
function updateMemberRoleByName(name, newRole) {
    const m = editingMembers.find(x => x.name === name);
    if (m) m.role = newRole;
}
function updateMemberNicknameByName(name, newNickname) {
    const m = editingMembers.find(x => x.name === name);
    if (m) m.nickname = (newNickname || '').trim();
}
function removeEditMemberByName(name) {
    if (confirm(`確定要將【${name}】從名單中移除嗎？`)) {
        editingMembers = editingMembers.filter(m => m.name !== name);
        renderEditList();
    }
}

async function saveUpdatedList() {
    if (isInitializingMemberList) {
        await initGroupWithMembers();
        return;
    }

    if (editingMembers.length === 0) {
        if (!confirm('目前名單為空，確定要清空整個小組名單嗎？')) return;
    } else {
        if (!confirm('確定要儲存這份新名單嗎？')) return;
    }
    showLoading("正在更新雲端名單...");
    try {
        const res = await callAPI('updateMemberList', { groupName, members: editingMembers });
        if (res.success) {
            userNotification.success('名單更新成功！');
            currentMembers = [...editingMembers];
            renderMemberList(currentMembers);
            closeMemberManagerModal();
        }
        else { userNotification.error('更新失敗：' + res.message); }
    } catch (e) { userNotification.error("連線發生錯誤，請稍後再試。"); } finally { hideLoading(); }
}

async function submitAttendance() {
    const date = document.getElementById('attendanceDate').value;
    // 送 UID 列表（cb.value 已是 UID）；篩掉空字串避免主日尚未綁定 UID 的會友造成髒資料
    const present = Array.from(document.querySelectorAll('.attendance-check:checked')).map(cb => cb.value).filter(v => v);
    const absent = Array.from(document.querySelectorAll('.attendance-check:not(:checked)')).map(cb => cb.value).filter(v => v);

    const newFriends = normalizeNames(document.getElementById('newFriends').value);

    if (present.length === 0 && !newFriends) {
        if (!confirm("目前出席人數為 0，確定要送出嗎？")) return;
    }

    showLoading("正在存入點名資料，請勿關閉網頁...");
    try {
        const res = await callAPI('submitAttendance', { groupName, date, present, absent, newFriends });
        if (res.success) {
            userNotification.success('點名成功！');
            document.querySelectorAll('.attendance-check').forEach(cb => cb.checked = false);
            document.getElementById('newFriends').value = '';
            if (groupCode) await loadGroupProgress();
        }
        else { userNotification.error('失敗：' + res.message); }
    } finally { hideLoading(); }
}

// ── 幸福小組結案封存功能 ──────────────────────────

function toggleConcludeModal(show) {
    document.getElementById('concludeModal').style.display = show ? 'block' : 'none';
}

async function openConcludeModal() {
    toggleConcludeModal(true);
    const container = document.getElementById('concludeBestList');
    container.innerHTML = '<p style="color: #999; text-align: center; padding: 15px 0;">正在載入小組名單與會友資料...</p>';

    try {
        const res = await callAPI('getGroups');
        if (!res.success) {
            container.innerHTML = `<p style="color: red; text-align: center;">載入小組清單失敗：${res.message}</p>`;
            return;
        }

        const regularGroups = res.groups.filter(g => g.type !== '幸福小組' && g.status !== '隱藏');
        const bests = currentMembers.filter(m => m.role === 'BEST' || m.role === '慕道友');

        if (bests.length === 0) {
            container.innerHTML = '<p style="color: #2e7d32; font-weight: bold; text-align: center; padding: 20px 0;">🎉 本組目前無 BEST 成員，可直接結案！</p>';
            return;
        }

        const groupOptionsHtml = regularGroups.map(g => `<option value="${g.name}">${g.name}</option>`).join('');

        container.innerHTML = bests.map(b => {
            return `
                <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #eee;">
                    <label style="display: flex; align-items: center; gap: 8px; font-weight: bold; cursor: pointer; flex: 1; margin: 0;">
                        <input type="checkbox" class="conclude-best-upgrade" value="${b.name}" onchange="toggleBestTargetSelect('${b.name}', this.checked)">
                        <span style="font-size: 15px; color: #333;">${b.name}</span>
                    </label>
                    <select id="targetGroup_${b.name}" class="conclude-best-target-group" disabled style="padding: 6px; border: 1px solid #ccc; border-radius: 6px; width: 160px; font-size: 13px; background: #eee;">
                        <option value="">-- 轉入常規小組 --</option>
                        ${groupOptionsHtml}
                    </select>
                </div>
            `;
        }).join('');
    } catch (e) {
        container.innerHTML = '<p style="color: red; text-align: center;">載入失敗，請稍候重試。</p>';
    }
}

function toggleBestTargetSelect(bestName, checked) {
    const select = document.getElementById(`targetGroup_${bestName}`);
    if (select) {
        select.disabled = !checked;
        select.style.background = checked ? 'white' : '#eee';
        if (!checked) select.value = '';
    }
}

async function submitHappyConclude() {
    const bestToUpgrade = [];
    const checkBoxes = document.querySelectorAll('.conclude-best-upgrade:checked');
    let hasError = false;

    checkBoxes.forEach(cb => {
        const name = cb.value;
        const select = document.getElementById(`targetGroup_${name}`);
        const targetGroup = select ? select.value : '';
        if (!targetGroup) {
            userNotification.warning(`請為勾選的 BEST【${name}】指派一個一般小組！`);
            hasError = true;
            return;
        }
        bestToUpgrade.push({ name: name, targetGroup: targetGroup });
    });

    if (hasError) return;
    if (!confirm('確定要執行結案封存嗎？結案後將無法對本組再進行點名與名單修改，同工出席亦會同步寫回其所屬常規小組。')) return;

    showLoading("正在進行幸福小組結案與封存處理，請勿關閉網頁...");
    try {
        const res = await callAPI('happyGroup_conclude', {
            groupName: groupName,
            bestToUpgrade: bestToUpgrade,
            authCode: groupCode
        });

        if (res.success) {
            userNotification.success(res.message);
            toggleConcludeModal(false);
            // 清除 localStorage 密碼快取
            localStorage.removeItem(`group_code_${groupName}`);
            setTimeout(() => {
                window.location.href = 'index.html';
            }, 1500);
        } else {
            userNotification.error('結案失敗：' + res.message);
        }
    } catch (e) {
        userNotification.error("連線發生錯誤，結案失敗");
    } finally {
        hideLoading();
    }
}
