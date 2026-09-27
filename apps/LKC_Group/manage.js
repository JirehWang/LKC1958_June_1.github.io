let adminGroupsList = [];
let currentEditingGroup = null; // 改為儲存完整的 group 物件（包含 uuid）
let verifiedAdminCode = ""; // 儲存已驗證的管理員代碼
let activeTab = 'regular'; // 'regular' or 'happy'
let globalIsAdmin = false; // 儲存最高管理員權限狀態
let cachedDistricts = [];
let cachedClusters = [];
let myClusterName = ""; // 小組長自己所屬的小組群名稱
let myClusterUuid = ""; // 小組長自己所屬的小組群 UUID

// showLoading / hideLoading / ensureAPIReady 由 config.js 提供。

window.onload = async () => {
    try {
        await ensureAPIReady();
    } catch (e) {
        userNotification.error("系統路由啟動失敗，請重新整理");
    }
    
    // 註冊 Enter 鍵登入管理
    const adminInput = document.getElementById('adminInput');
    if (adminInput) {
        adminInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                verifyAdmin();
            }
        });
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

// 1. 驗證管理員身分
async function verifyAdmin() {
    const code = document.getElementById('adminInput').value.trim();
    if (!code) return userNotification.warning("請輸入代碼");

    showLoading("驗證權限中...");
    try {
        const res = await callAPI('findGroupByCode', { groupCode: code });

        if (res.success) {
            verifiedAdminCode = code;
            document.getElementById('login-panel').style.display = 'none';
            document.getElementById('manage-panel').style.display = 'block';
            await loadGroups();
        } else {
            userNotification.error("❌ 權限不足或代碼錯誤！" + (res.message ? " " + res.message : ""));
        }
    } catch (e) {
        userNotification.error("連線發生錯誤: " + e.message);
    } finally {
        hideLoading();
    }
}

// 2. 載入小組清單
async function loadGroups() {
    showLoading("正在撈取小組資料庫...");
    try {
        // ✅ 傳入已驗證的管理員代碼
        const res = await callAPI('getAdminGroupsList', { authCode: verifiedAdminCode });
        if (res.success) {
            adminGroupsList = res.groups;
            globalIsAdmin = res.isAdmin; // ✅ 儲存權限狀態
            cachedDistricts = res.districts || [];
            cachedClusters = res.clusters || [];
            myClusterName = res.clusterName || ""; // 小組長自己所屬的小組群名稱
            myClusterUuid = res.clusterUuid || ""; // 小組長自己所屬的小組群 UUID

            if (globalIsAdmin) {
                await loadAdminHierarchyFromGas();
            }

            updatePermissionBadge(res.isAdmin); // ✅ 更新權限徽章
            renderTable(res.isAdmin); // ✅ 傳入權限等級
            initClusterManagementPanel(res.isAdmin); // ✅ 初始化小組長專屬管理區
        } else {
            userNotification.error("載入失敗：" + res.message);
        }
    } catch (e) {
        userNotification.error("連線發生錯誤: " + e.message);
    } finally {
        hideLoading();
    }
}

// Supabase 的 getAdminGroupsList 目前沒有牧區／小組群目錄，會回傳空陣列。
// 這兩份清單仍以 GAS 試算表為來源；此 action 也會執行舊欄位回填同步。
async function loadAdminHierarchyFromGas() {
    try {
        const res = await callAPI('getDistrictsAndClusters', { authCode: verifiedAdminCode });
        if (!res || !res.success) {
            throw new Error((res && res.message) || 'GAS 未回傳牧區／小組群資料');
        }

        cachedDistricts = Array.isArray(res.districts) ? res.districts : [];
        cachedClusters = Array.isArray(res.clusters) ? res.clusters : [];

        const hierarchyByUuid = new Map(
            (Array.isArray(res.groups) ? res.groups : [])
                .filter(group => group && group.uuid)
                .map(group => [String(group.uuid), group])
        );
        adminGroupsList = adminGroupsList.map(group => {
            const hierarchy = hierarchyByUuid.get(String(group.uuid));
            if (!hierarchy) return group;
            return {
                ...group,
                districtUuid: hierarchy.districtUuid || '',
                districtName: hierarchy.districtName || '',
                clusterUuid: hierarchy.clusterUuid || '',
                clusterName: hierarchy.clusterName || ''
            };
        });
    } catch (e) {
        console.warn('[GroupHierarchy] GAS 目錄載入失敗，保留目前清單資料：', e);
    }
}

// 2.7 切換分頁
function switchTab(tabName) {
    activeTab = tabName;
    const regTab = document.getElementById('btn-tab-regular');
    const happyTab = document.getElementById('btn-tab-happy');
    if (regTab) regTab.classList.toggle('active', tabName === 'regular');
    if (happyTab) happyTab.classList.toggle('active', tabName === 'happy');
    renderTable(globalIsAdmin);
}

// 2.5 更新權限徽章顯示
function updatePermissionBadge(isAdmin) {
    const badge = document.getElementById('permission-badge');
    if (isAdmin) {
        badge.innerHTML = '👑 最高權限 - 系統管理員';
        badge.style.background = '#c62828';
    } else {
        badge.innerHTML = '👤 小組權限 - 小組管理員';
        badge.style.background = '#FF9800';
    }
}

// 3. 渲染表格
function renderTable(isAdmin) {
    const tbody = document.querySelector('#groupsTable tbody');
    const dateColumn = document.getElementById('dateColumn');
    const adminCols = document.querySelectorAll('.admin-only-col');
    
    // ✅ 根據權限動態調整欄位顯示
    if (isAdmin) {
        dateColumn.style.display = ''; // 顯示日期欄
        adminCols.forEach(col => col.style.display = '');
    } else {
        dateColumn.style.display = 'none'; // 隱藏日期欄
        adminCols.forEach(col => col.style.display = 'none');
    }
    
    const filteredGroups = adminGroupsList.filter(g => {
        if (activeTab === 'happy') {
            return g.type === '幸福小組';
        } else {
            return g.type !== '幸福小組';
        }
    });
    
    if (filteredGroups.length === 0) {
        const colspan = isAdmin ? '7' : '4';
        tbody.innerHTML = `<tr><td colspan="${colspan}" style="color: #999;">目前沒有小組資料</td></tr>`;
        return;
    }

    tbody.innerHTML = filteredGroups.map((g) => {
        // 找出在原始名單中的 index，以便傳給編輯 Modal
        const originalIndex = adminGroupsList.findIndex(orig => orig.uuid === g.uuid);

        // 狀態顯示樣式 (支援幸福小組結案狀態)
        let statusBadge = '';
        if (g.status === '顯示') {
            statusBadge = '<span style="background: #4CAF50; color: white; padding: 4px 10px; border-radius: 12px; font-size: 12px;">✅ 顯示</span>';
        } else if (g.status === '結案') {
            statusBadge = '<span style="background: #E91E63; color: white; padding: 4px 10px; border-radius: 12px; font-size: 12px;">🍀 結案</span>';
        } else {
            statusBadge = '<span style="background: #9E9E9E; color: white; padding: 4px 10px; border-radius: 12px; font-size: 12px;">🚫 隱藏</span>';
        }
        
        // 日期格式化
        const dateDisplay = g.date ? formatDate(g.date) : '-';
        
        // ✅ 根據權限決定顯示的欄位
        const dateCell = isAdmin ? `<td style="color: #666; font-size: 14px;">${dateDisplay}</td>` : '';
        const districtCell = isAdmin ? `<td style="color: #555; font-size: 14px;">${g.districtName || '-'}</td>` : '';
        const clusterCell = isAdmin ? `<td style="color: #555; font-size: 14px;">${g.clusterName || '-'}</td>` : '';
        
        // 幸福小組標示
        const groupTypeBadge = g.type === '幸福小組'
            ? ' <span class="role-badge role-best" style="font-size:11px; padding:2px 6px; width:auto; border-radius:4px; vertical-align:middle; background: #fff3e0; color: #ef6c00;">幸福</span>'
            : '';

        // 結案按鈕 (限管理員且未結案)
        const concludeBtn = (isAdmin && g.status !== '結案')
            ? `<button class="btn" style="background: #e91e63; padding: 6px 12px; font-size: 13px; margin-left: 8px;" onclick="concludeGroup('${g.name}')">🍀 結案</button>`
            : '';

        // 徹底刪除按鈕 (限管理員且已結案)
        const deleteBtn = (isAdmin && g.status === '結案')
            ? `<button class="btn" style="background: #f44336; padding: 6px 12px; font-size: 13px; margin-left: 8px;" onclick="deleteGroup('${g.name}')">🗑️ 徹底刪除</button>`
            : '';
        
        return `
            <tr>
                <td style="font-weight: bold; font-size: 16px;">${g.name}${groupTypeBadge}</td>
                <td><span style="background: #eee; padding: 4px 10px; border-radius: 12px; font-family: monospace;">${g.code}</span></td>
                <td>${statusBadge}</td>
                ${districtCell}
                ${clusterCell}
                ${dateCell}
                <td>
                    <button class="btn" style="background: #2196F3; padding: 6px 12px; font-size: 13px;" onclick="openEditModal(${originalIndex})">✏️ 編輯</button>${concludeBtn}${deleteBtn}
                </td>
            </tr>
        `;
    }).join('');
}

// 3.5 日期格式化：優先用 config.js 的 formatYMD，無法解析時顯示原值
function formatDate(dateValue) {
    if (!dateValue) return '-';
    return window.formatYMD(dateValue) || String(dateValue);
}

// 4. 開啟編輯彈窗
function openEditModal(index) {
    const group = adminGroupsList[index];
    currentEditingGroup = group; // ✅ 儲存完整的 group 物件（包含 uuid）
    
    document.getElementById('editOldName').value = group.name;
    document.getElementById('editNewName').value = group.name;
    document.getElementById('editNewCode').value = group.code;
    
    const statusSelect = document.getElementById('editNewStatus');
    // 先移除之前動態補上的結案選項
    const concludeOpt = statusSelect.querySelector('option[value="結案"]');
    if (concludeOpt) concludeOpt.remove();

    // 如果該組已結案，動態加入唯讀結案選項並停用下拉選單
    if (group.status === '結案') {
        const opt = document.createElement('option');
        opt.value = '結案';
        opt.innerHTML = '🍀 結案 (已封存，不可修改狀態)';
        statusSelect.appendChild(opt);
        statusSelect.value = '結案';
        statusSelect.disabled = true;
    } else {
        statusSelect.value = group.status || '顯示';
        statusSelect.disabled = false;
    }

    // 處理牧區與小組群下拉選單 (最高管理權限專屬)
    const editRows = document.querySelectorAll('.admin-only-edit-row');
    if (globalIsAdmin) {
        editRows.forEach(row => row.style.display = 'block');

        // 填充牧區
        const distSelect = document.getElementById('editDistrict');
        distSelect.innerHTML = '<option value="">-- 無歸屬 --</option>';
        cachedDistricts.forEach(d => {
            const opt = document.createElement('option');
            opt.value = d.uuid;
            opt.innerText = d.name;
            distSelect.appendChild(opt);
        });
        distSelect.value = group.districtUuid || '';

        // 填充小組群
        const clustSelect = document.getElementById('editCluster');
        clustSelect.innerHTML = '<option value="">-- 無歸屬 --</option>';
        cachedClusters.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.uuid;
            opt.innerText = c.name;
            clustSelect.appendChild(opt);
        });
        clustSelect.value = group.clusterUuid || '';
    } else {
        editRows.forEach(row => row.style.display = 'none');
    }
    
    document.getElementById('edit-group-modal').style.display = 'block';
}

function closeEditModal() {
    document.getElementById('edit-group-modal').style.display = 'none';
}

// 5. 儲存修改
async function saveGroupEdit() {
    const newName = document.getElementById('editNewName').value.trim();
    const newCode = document.getElementById('editNewCode').value.trim();
    const newStatus = document.getElementById('editNewStatus').value;
    const editDistrictVal = globalIsAdmin ? document.getElementById('editDistrict').value : (currentEditingGroup.districtName || '');
    const editClusterVal = globalIsAdmin ? document.getElementById('editCluster').value : (currentEditingGroup.clusterName || '');

    if (!newName) return userNotification.warning("名稱不可為空！");
    if (newCode.length < 4) return userNotification.warning("代碼至少需要 4 碼！");

    const hasChanges =
        newName !== currentEditingGroup.name ||
        newCode !== currentEditingGroup.code ||
        newStatus !== currentEditingGroup.status ||
        editDistrictVal !== (currentEditingGroup.districtName || '') ||
        editClusterVal !== (currentEditingGroup.clusterName || '');

    if (!hasChanges) return userNotification.warning("⚠️ 您沒有做任何修改！");

    if (newName !== currentEditingGroup.name) {
        if (!confirm(`⚠️ 警告：您即將把【${currentEditingGroup.name}】改名為【${newName}】\n\n系統將會同步重新命名資料庫中的分頁，此動作需要幾秒鐘，確定要執行嗎？`)) {
            return;
        }
    }

    showLoading("正在更新資料庫與同步分頁名稱，請勿關閉網頁...");
    try {
        const res = await callAPI('updateGroupInfo', { 
            uuid: currentEditingGroup.uuid,
            oldName: currentEditingGroup.name,
            newName: newName, 
            newCode: newCode,
            newStatus: newStatus,
            districtUuid: editDistrictVal,
            clusterUuid: editClusterVal
        });

        if (res.success) {
            userNotification.success('✅ 修改成功！分頁名稱已同步更新。');
            closeEditModal();
            if (newCode !== currentEditingGroup.code) {
                verifiedAdminCode = newCode;
            }
            await loadGroups();
        } else {
            userNotification.error('❌ 修改失敗：' + res.message);
        }
    } catch (e) {
        userNotification.error("連線發生錯誤: " + e.message);
    } finally {
        hideLoading();
    }
}

async function concludeGroup(groupName) {
    if (!confirm(`🍀 確定要將小組【${groupName}】結案嗎？\n\n此動作將會進行雲端封存，且會移除所有同工與成員的此小組關聯（但保留其在會友名單的名字），確定要執行嗎？`)) {
        return;
    }
    showLoading(`正在將小組【${groupName}】結案中...`);
    try {
        const res = await callAPI('happyGroup_conclude', { 
            groupName: groupName, 
            bestToUpgrade: [], 
            authCode: verifiedAdminCode 
        });
        if (res.success) {
            userNotification.success('✅ 小組已成功結案！');
            await loadGroups();
        } else {
            userNotification.error('❌ 結案失敗：' + res.message);
        }
    } catch (e) {
        userNotification.error("連線發生錯誤: " + e.message);
    } finally {
        hideLoading();
    }
}

async function deleteGroup(groupName) {
    if (!confirm(`⚠️ 警告：確定要徹底刪除小組【${groupName}】嗎？\n\n此動作將永久刪除該組在試算表中的所有分頁（名單與點名紀錄），且不可復原！`)) {
        return;
    }
    showLoading(`正在徹底刪除【${groupName}】...`);
    try {
        const res = await callAPI('happyGroup_delete', { groupName: groupName, authCode: verifiedAdminCode });
        if (res.success) {
            userNotification.success('✅ 小組已被徹底刪除！');
            await loadGroups();
        } else {
            userNotification.error('❌ 刪除失敗：' + res.message);
        }
    } catch (e) {
        userNotification.error("連線發生錯誤: " + e.message);
    } finally {
        hideLoading();
    }
}

// ============================================================
//  👥 小組長管理自己小組群的面板邏輯 (分區小組群)
// ============================================================

function initClusterManagementPanel(isAdmin) {
    const panel = document.getElementById('cluster-management-panel');
    if (!panel) return;

    if (isAdmin || !myClusterUuid) {
        panel.style.display = 'none';
        return;
    }

    panel.style.display = 'block';
    panel.querySelector('h3').innerText = `👥 【${myClusterName}】小組群成員管理`;
    renderMyClusterGroups();
}

function renderMyClusterGroups() {
    const listDiv = document.getElementById('myClusterGroupsList');
    const select = document.getElementById('unassignedGroupsSelect');
    if (!listDiv || !select) return;

    // 篩選屬於當前小組群的小組
    const myGroups = adminGroupsList.filter(g => g.clusterUuid === myClusterUuid);
    
    // 渲染當前成員
    if (myGroups.length === 0) {
        listDiv.innerHTML = '<span style="color:#999; font-size:13px;">目前群內無其他小組</span>';
    } else {
        listDiv.innerHTML = myGroups.map(g => {
            const isSelf = g.code === verifiedAdminCode;
            const removeBtn = isSelf 
                ? `<span style="color:#888; font-size:11px; margin-left:5px;">(您的小組)</span>`
                : `<button class="btn" style="background:#f44336; padding:2px 8px; font-size:12px; margin-left:8px; height:auto; width:auto;" onclick="removeGroupFromMyCluster('${g.uuid}')">移除</button>`;
            
            return `
                <div style="background:#fff; border:1px solid #ddd; padding:6px 12px; border-radius:6px; display:inline-flex; align-items:center; font-size:14px; font-weight:bold; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                    ⛪ ${g.name}${removeBtn}
                </div>
            `;
        }).join('');
    }

    // 填充無歸屬小組下拉選單
    const unassigned = adminGroupsList.filter(g => !g.clusterUuid && g.type !== '幸福小組');
    select.innerHTML = '<option value="">-- 請選擇小組 --</option>';
    unassigned.forEach(g => {
        const opt = document.createElement('option');
        opt.value = g.uuid;
        opt.innerText = g.name;
        select.appendChild(opt);
    });
}

// 移除小組
async function removeGroupFromMyCluster(groupUuid) {
    if (!confirm('確定要將該小組移出您的小組群嗎？')) return;

    const myGroups = adminGroupsList.filter(g => g.clusterUuid === myClusterUuid);
    const targetUuids = myGroups
        .map(g => g.uuid)
        .filter(uuid => uuid !== groupUuid);

    showLoading('正在移出小組...');
    try {
        const res = await callAPI('updateClusterGroups', {
            clusterUuid: myClusterUuid,
            groupUuids: targetUuids,
            authCode: verifiedAdminCode
        });
        if (res.success) {
            userNotification.success('✅ 已成功將小組移出群組！');
            await loadGroups();
        } else {
            userNotification.warning(res.message || '操作失敗');
        }
    } catch (e) {
        userNotification.error('連線異常，操作失敗');
    } finally {
        hideLoading();
    }
}

// 加入小組
async function addSetupGroupToMyCluster() {
    const select = document.getElementById('unassignedGroupsSelect');
    const groupUuid = select.value;
    if (!groupUuid) return userNotification.warning('請先選擇一個小組');

    const myGroups = adminGroupsList.filter(g => g.clusterUuid === myClusterUuid);
    const targetUuids = myGroups.map(g => g.uuid);
    if (!targetUuids.includes(groupUuid)) {
        targetUuids.push(groupUuid);
    }

    showLoading('正在拉入小組...');
    try {
        const res = await callAPI('updateClusterGroups', {
            clusterUuid: myClusterUuid,
            groupUuids: targetUuids,
            authCode: verifiedAdminCode
        });
        if (res.success) {
            userNotification.success('✅ 已成功將小組拉入群組！');
            await loadGroups();
        } else {
            userNotification.warning(res.message || '操作失敗');
        }
    } catch (e) {
        userNotification.error('連線異常，操作失敗');
    } finally {
        hideLoading();
    }
}

// 暴露全域
window.addSetupGroupToMyCluster = addSetupGroupToMyCluster;
window.removeGroupFromMyCluster = removeGroupFromMyCluster;
