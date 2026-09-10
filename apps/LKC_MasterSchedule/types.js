/**
 * 事項類型管理 - Phase 1 前端腳本
 *
 * 使用中央 churchAPI（config.js 提供）
 */

let _calTypesFlat = []; // 平坦清單（含 children）
let _calTypesTree = []; // 樹（root 陣列）
let _currentFieldsRootTypeId = null;
let _currentFieldsList = [];

async function callAPI(action, data) {
  if (window.CalendarSupabaseService && typeof window.CalendarSupabaseService[action] === 'function') {
    return await window.CalendarSupabaseService[action](data || {});
  }
  if (typeof window.churchAPI !== 'function') {
    throw new Error('config.js 尚未載入');
  }
  return await window.churchAPI(action, data || {});
}

// ─── 通用 toast 提示 ───
// type: 'info' | 'success' | 'error'
let _toastEl = null;
function showToast(msg, type = 'success', durationMs = 2200) {
  if (!_toastEl) {
    _toastEl = document.createElement('div');
    _toastEl.id = '__calToast';
    _toastEl.style.cssText = `
      position: fixed; top: 16px; left: 50%; transform: translateX(-50%);
      padding: 10px 22px; border-radius: 24px; color: #fff;
      font-size: 0.92rem; font-weight: 600; z-index: 9999;
      box-shadow: 0 4px 16px rgba(0,0,0,.18); transition: opacity .2s;
      max-width: 92vw; text-align: center;
    `;
    document.body.appendChild(_toastEl);
  }
  const bg = { info: '#0d6efd', success: '#198754', error: '#dc3545' }[type] || '#198754';
  _toastEl.style.background = bg;
  _toastEl.innerText = msg;
  _toastEl.style.opacity = '1';
  _toastEl.style.display = 'block';
  if (showToast._timer) clearTimeout(showToast._timer);
  if (durationMs > 0) {
    showToast._timer = setTimeout(() => {
      _toastEl.style.opacity = '0';
      setTimeout(() => { if (_toastEl) _toastEl.style.display = 'none'; }, 200);
    }, durationMs);
  }
}
function showLoadingToast(msg) { showToast('⏳ ' + msg, 'info', 0); }
function hideToast() {
  if (showToast._timer) clearTimeout(showToast._timer);
  if (_toastEl) { _toastEl.style.opacity = '0'; setTimeout(() => _toastEl.style.display = 'none', 200); }
}

window.addEventListener('DOMContentLoaded', loadTypes);

async function loadTypes() {
  const container = document.getElementById('typesContainer');
  container.innerHTML = `<div class="empty-hint"><div class="spinner-border text-primary mb-2"></div><div>載入中...</div></div>`;
  try {
    const res = await callAPI('cal_getTypes');
    if (!res || !res.success) throw new Error((res && res.message) || '載入失敗');
    _calTypesTree = res.data.types;
    _calTypesFlat = res.data.flat;
    renderTypes();
  } catch (err) {
    container.innerHTML = `<div class="alert alert-danger">❌ 載入失敗：${err.message}
      <hr>若為「找不到分頁」類型錯誤，請先進到 GAS 編輯器手動執行一次 <code>cal_setupSchema</code> 即可建立分頁。</div>`;
  }
}

function renderTypes() {
  const container = document.getElementById('typesContainer');
  if (_calTypesTree.length === 0) {
    container.innerHTML = `<div class="empty-hint">
      還沒有任何類型。<br>
      <button class="btn btn-primary mt-3" onclick="openAddTypeModal('')">＋ 新增第一個頂層類型</button>
    </div>`;
    return;
  }

  container.innerHTML = _calTypesTree.map(t => _renderTypeNode(t, false)).join('');
}

function _renderTypeNode(type, isChild) {
  const syncPills = [
    type.syncToAttendance ? '<span class="pill sync-pill me-1">📋 主日點名</span>' : '',
    type.syncToMinistry   ? '<span class="pill sync-pill me-1">🧑‍🤝‍🧑 事工</span>'   : '',
    type.syncToWorship    ? '<span class="pill sync-pill me-1">🎵 敬拜團</span>'   : ''
  ].join('');

  const lockPill   = type.hasPassword ? '<span class="pill lock-pill me-1">🔒 有密碼</span>' : '';
  const hiddenPill = type.hidden ? '<span class="pill hidden-pill me-1">👁️ 隱藏</span>' : '';

  const childRender = (type.children && type.children.length > 0)
    ? type.children.map(c => _renderTypeNode(c, true)).join('')
    : '';

  return `
    <div class="card type-card mb-2 ${isChild ? 'type-child' : ''}" style="border-left-color: ${type.color || '#667eea'};">
      <div class="card-body py-2 px-3">
        <div class="d-flex align-items-center flex-wrap gap-2">
          <div class="fs-5 fw-bold" style="color:${type.color || '#333'};">
            ${type.icon || ''} ${type['名稱']}
          </div>
          ${isChild ? '<span class="badge bg-light text-muted">子類型</span>' : ''}
          <div class="ms-auto d-flex gap-1 flex-wrap">
            ${syncPills}${lockPill}${hiddenPill}
          </div>
        </div>
        <div class="mt-2 d-flex gap-2 flex-wrap">
          ${!isChild ? `<button class="btn btn-sm btn-outline-success" onclick="openAddTypeModal('${type.typeId}')">＋ 新增子類型</button>` : ''}
          <button class="btn btn-sm btn-outline-primary" onclick="openFieldsModal('${type.typeId}', '${escapeAttr(type['名稱'])}')">📝 欄位管理${isChild ? '（含繼承）' : ''}</button>
          <button class="btn btn-sm btn-outline-secondary" onclick='openEditTypeModal(${JSON.stringify(type).replace(/'/g, "&#39;")})'>✏️ 編輯</button>
          <button class="btn btn-sm btn-outline-danger" onclick="confirmDeleteType('${type.typeId}', '${escapeAttr(type['名稱'])}')">🗑️ 刪除</button>
        </div>
      </div>
    </div>
    ${childRender}
  `;
}

function escapeAttr(s) {
  return String(s || '').replace(/'/g, '&#39;').replace(/"/g, '&quot;');
}

// ─── 類型 Modal ───
function openAddTypeModal(parentTypeId) {
  _resetTypeForm();
  document.getElementById('typeModalTitle').innerText = parentTypeId ? '新增子類型' : '新增頂層類型';
  document.getElementById('typeForm_parentTypeId').value = parentTypeId || '';
  // 子類型不顯示「同步/密碼/隱藏」區塊（繼承父）
  document.getElementById('typeForm_parentOnlySection').style.display = parentTypeId ? 'none' : '';
  bootstrap.Modal.getOrCreateInstance(document.getElementById('typeModal')).show();
}

function openEditTypeModal(type) {
  _resetTypeForm();
  document.getElementById('typeModalTitle').innerText = '編輯類型：' + (type['名稱'] || '');
  document.getElementById('typeForm_typeId').value = type.typeId || '';
  document.getElementById('typeForm_parentTypeId').value = type.parentTypeId || '';
  document.getElementById('typeForm_name').value = type['名稱'] || '';
  document.getElementById('typeForm_icon').value = type.icon || '';
  document.getElementById('typeForm_color').value = type.color || '#667eea';
  document.getElementById('typeForm_sortOrder').value = type.sortOrder || 0;
  document.getElementById('typeForm_syncToAttendance').checked = !!type.syncToAttendance;
  document.getElementById('typeForm_syncToMinistry').checked = !!type.syncToMinistry;
  document.getElementById('typeForm_syncToWorship').checked = !!type.syncToWorship;
  document.getElementById('typeForm_hidden').checked = !!type.hidden;
  // 編輯時不顯示密碼（避免被偷看），使用者要改才填新值
  document.getElementById('typeForm_password').value = '';
  document.getElementById('typeForm_password').placeholder = type.hasPassword ? '已設密碼（留空 = 不改 / 輸入空白以外字串才會更新）' : '留空 = 公開';
  document.getElementById('typeForm_parentOnlySection').style.display = type.parentTypeId ? 'none' : '';
  bootstrap.Modal.getOrCreateInstance(document.getElementById('typeModal')).show();
}

function _resetTypeForm() {
  ['typeForm_typeId','typeForm_parentTypeId','typeForm_name','typeForm_icon','typeForm_sortOrder','typeForm_password']
    .forEach(id => document.getElementById(id).value = '');
  document.getElementById('typeForm_color').value = '#667eea';
  ['typeForm_syncToAttendance','typeForm_syncToMinistry','typeForm_syncToWorship','typeForm_hidden']
    .forEach(id => document.getElementById(id).checked = false);
  document.getElementById('typeForm_password').placeholder = '留空 = 公開';
}

async function saveType() {
  const id = document.getElementById('typeForm_typeId').value;
  const isEdit = !!id;
  const data = {
    typeId: id || undefined,
    parentTypeId: document.getElementById('typeForm_parentTypeId').value,
    name: document.getElementById('typeForm_name').value.trim(),
    icon: document.getElementById('typeForm_icon').value.trim(),
    color: document.getElementById('typeForm_color').value,
    sortOrder: parseInt(document.getElementById('typeForm_sortOrder').value) || 0,
    syncToAttendance: document.getElementById('typeForm_syncToAttendance').checked,
    syncToMinistry:   document.getElementById('typeForm_syncToMinistry').checked,
    syncToWorship:    document.getElementById('typeForm_syncToWorship').checked,
    hidden:           document.getElementById('typeForm_hidden').checked
  };
  // 密碼：編輯時若空白則不改；新增則直接套用
  const pwd = document.getElementById('typeForm_password').value;
  if (isEdit) {
    if (pwd.trim() !== '') data.password = pwd; // 含空白也算改成空
  } else {
    if (pwd) data.password = pwd;
  }

  if (!data.name) { alert('請輸入名稱'); return; }

  showLoadingToast(isEdit ? '儲存類型中...' : '新增類型中...');
  try {
    const res = await callAPI(isEdit ? 'cal_updateType' : 'cal_addType', data);
    if (!res.success) throw new Error(res.message || '失敗');
    bootstrap.Modal.getOrCreateInstance(document.getElementById('typeModal')).hide();
    await loadTypes();
    showToast(isEdit ? '✅ 類型已更新' : '✅ 類型已新增', 'success');
  } catch (err) {
    showToast('❌ ' + err.message, 'error', 4000);
  }
}

async function confirmDeleteType(typeId, name) {
  if (!confirm(`確定要刪除「${name}」嗎？\n⚠️ 連同子類型、欄位、事項都會一起刪除（不可復原）`)) return;
  showLoadingToast('刪除中...');
  try {
    const res = await callAPI('cal_deleteType', { typeId });
    if (!res.success) throw new Error(res.message);
    await loadTypes();
    showToast('✅ ' + (res.message || '已刪除'), 'success');
  } catch (err) {
    showToast('❌ ' + err.message, 'error', 4000);
  }
}

// ─── 欄位 Modal（支援頂層 + 子類型分區）───
//
//   _currentFieldsContext = {
//     callerTypeId,  // 使用者按按鈕的那個 typeId（頂層或子類型）
//     callerTypeName,
//     isSubType,
//     rootTypeId,
//     subTypeId,
//     inheritedFields, // 子類型才會有
//     ownFields,
//     excludedFieldIds // 子類型才會有
//   }
let _currentFieldsContext = null;

async function openFieldsModal(typeId, typeName) {
  document.getElementById('fieldsModalTypeName').innerText = typeName;
  _currentFieldsContext = { callerTypeId: typeId, callerTypeName: typeName };
  document.getElementById('fieldsList').innerHTML = '<div class="text-center p-4"><div class="spinner-border spinner-border-sm"></div></div>';
  bootstrap.Modal.getOrCreateInstance(document.getElementById('fieldsModal')).show();
  await reloadFieldsList();
}

async function reloadFieldsList() {
  try {
    const res = await callAPI('cal_getFields', { typeId: _currentFieldsContext.callerTypeId });
    if (!res.success) throw new Error(res.message);
    const d = res.data;
    Object.assign(_currentFieldsContext, {
      rootTypeId:       d.rootTypeId,
      subTypeId:        d.subTypeId,
      isSubType:        !!d.subTypeId,
      inheritedFields:  d.inheritedFields || [],
      ownFields:        d.ownFields || [],
      excludedFieldIds: d.excludedFieldIds || []
    });
    // 保持向後相容：_currentFieldsRootTypeId / _currentFieldsList 給匯出模板用
    _currentFieldsRootTypeId = d.rootTypeId;
    _currentFieldsList = d.fields; // 「有效欄位」for 匯出模板
    renderFieldsList();
  } catch (err) {
    document.getElementById('fieldsList').innerHTML = `<div class="alert alert-danger">❌ ${err.message}</div>`;
  }
}

function renderFieldsList() {
  const container = document.getElementById('fieldsList');
  const ctx = _currentFieldsContext;
  if (!ctx) return;

  let html = '';

  if (ctx.isSubType) {
    // 繼承區
    html += `<div class="mb-3">
      <div class="d-flex align-items-center mb-2">
        <div class="fw-bold text-primary"><span class="badge bg-primary me-1">繼承</span>來自父類型的欄位</div>
        <div class="ms-auto text-muted small">取消勾選 = 此子類型不使用該欄位</div>
      </div>`;
    if (ctx.inheritedFields.length === 0) {
      html += '<div class="text-muted small ps-2">父類型沒有欄位</div>';
    } else {
      html += ctx.inheritedFields.map(f => _renderInheritedFieldRow(f)).join('');
    }
    html += '</div>';

    // 專屬區
    html += `<div class="mb-2 d-flex align-items-center">
      <div class="fw-bold text-success"><span class="badge bg-success me-1">專屬</span>此子類型專用的欄位</div>
      <div class="ms-auto text-muted small">只在此子類型出現，不影響父類型與其他子類型</div>
    </div>`;
    if (ctx.ownFields.length === 0) {
      html += '<div class="text-muted small ps-2 mb-2">尚無專屬欄位（可按下方新增）</div>';
    } else {
      html += ctx.ownFields.map(f => _renderFieldRow(f)).join('');
    }
  } else {
    // 頂層：保留原本的簡單列表
    if (ctx.ownFields.length === 0) {
      html += '<div class="text-muted text-center py-4">此類型還沒有欄位</div>';
    } else {
      html += ctx.ownFields.map(f => _renderFieldRow(f)).join('');
    }
  }

  container.innerHTML = html;
}

// 繼承欄位列（唯讀 + 排除開關）
function _renderInheritedFieldRow(f) {
  const opts = Array.isArray(f['下拉選項']) ? f['下拉選項'].join('，') : '';
  const required = String(f['是否必填']).toUpperCase() === 'TRUE' || f.required;
  return `
    <div class="field-row ${f.excluded ? 'opacity-50 bg-light' : ''}" style="border-left: 4px solid #0d6efd;">
      <div class="row g-2 align-items-center">
        <div class="col-md-1 text-center">
          <div class="form-check form-switch">
            <input type="checkbox" class="form-check-input" ${f.excluded ? '' : 'checked'}
                   onchange="toggleInheritedField('${f.fieldId}', this.checked)" title="是否啟用此欄位">
          </div>
        </div>
        <div class="col-md-3"><b>${escapeAttr(f['顯示名稱'])}</b></div>
        <div class="col-md-3"><span class="badge bg-light text-dark border">${_fieldTypeLabel(f['欄位類型'])}</span></div>
        <div class="col-md-3 small text-muted">${escapeAttr(opts)}</div>
        <div class="col-md-2 text-end small">
          ${required ? '<span class="text-danger fw-bold">必填</span>' : '<span class="text-muted">選填</span>'}
        </div>
      </div>
    </div>
  `;
}

// 樂觀更新版：不 reload，只動本地狀態與該列 DOM
async function toggleInheritedField(fieldId, enabled) {
  const ctx = _currentFieldsContext;
  if (!ctx || !ctx.isSubType) return;

  const f = (ctx.inheritedFields || []).find(x => x.fieldId === fieldId);
  const fname = f ? f['顯示名稱'] : '欄位';
  const wasExcluded = ctx.excludedFieldIds.includes(fieldId);

  // 1️⃣ 樂觀更新：先改本地狀態 + 只動該列 DOM 樣式
  if (enabled) {
    ctx.excludedFieldIds = ctx.excludedFieldIds.filter(x => x !== fieldId);
  } else if (!ctx.excludedFieldIds.includes(fieldId)) {
    ctx.excludedFieldIds.push(fieldId);
  }
  if (f) f.excluded = !enabled;
  const rowDiv = document.querySelector(`input[onchange*="${fieldId}"]`)?.closest('.field-row');
  if (rowDiv) {
    rowDiv.classList.toggle('opacity-50', !enabled);
    rowDiv.classList.toggle('bg-light', !enabled);
  }

  // 2️⃣ 背景送 API
  showLoadingToast((enabled ? '啟用' : '排除') + `「${fname}」中...`);
  try {
    const res = await callAPI('cal_updateType', { typeId: ctx.subTypeId, excludedFieldIds: ctx.excludedFieldIds });
    if (!res.success) throw new Error(res.message);
    showToast((enabled ? '✅ 已啟用「' : '✅ 已排除「') + fname + '」', 'success', 1500);
  } catch (err) {
    // 失敗 → 回復本地狀態 + 視覺
    if (enabled && !ctx.excludedFieldIds.includes(fieldId)) ctx.excludedFieldIds.push(fieldId);
    else ctx.excludedFieldIds = ctx.excludedFieldIds.filter(x => x !== fieldId);
    if (f) f.excluded = wasExcluded;
    if (rowDiv) {
      rowDiv.classList.toggle('opacity-50', wasExcluded);
      rowDiv.classList.toggle('bg-light', wasExcluded);
      const checkbox = rowDiv.querySelector('input[type="checkbox"]');
      if (checkbox) checkbox.checked = !wasExcluded;
    }
    showToast('❌ 儲存失敗：' + err.message, 'error', 4000);
  }
}

function _renderFieldRow(f) {
  const fid = f.fieldId;
  const opts = Array.isArray(f['下拉選項']) ? f['下拉選項'].join('，') : '';
  const isReq = Boolean(f.required || f.isRequired || f.is_required || String(f['是否必填']).toUpperCase() === 'TRUE');
  return `
    <div class="field-row" data-fid="${fid}">
      <div class="row g-2 align-items-center">
        <div class="col-md-3">
          <input type="text" class="form-control form-control-sm" value="${escapeAttr(f['顯示名稱'])}" data-k="name">
        </div>
        <div class="col-md-3">
          <select class="form-select form-select-sm" data-k="type">
            ${['text','longtext','date','time','select','multiselect','number','url']
              .map(t => `<option value="${t}" ${t === f['欄位類型'] ? 'selected' : ''}>${_fieldTypeLabel(t)}</option>`).join('')}
          </select>
        </div>
        <div class="col-md-3">
          <input type="text" class="form-control form-control-sm" placeholder="下拉選項用，逗號分隔" value="${escapeAttr(opts)}" data-k="options">
        </div>
        <div class="col-md-1">
          <div class="form-check pt-1">
            <input type="checkbox" class="form-check-input" ${isReq ? 'checked' : ''} data-k="required" title="必填">
            <label class="form-check-label small">必</label>
          </div>
        </div>
        <div class="col-md-2 text-end">
          <button class="btn btn-sm btn-success me-1" onclick="saveFieldRow('${fid}')">💾</button>
          <button class="btn btn-sm btn-outline-danger" onclick="deleteFieldRow('${fid}', '${escapeAttr(f['顯示名稱'])}')">🗑️</button>
        </div>
      </div>
    </div>
  `;
}

function _fieldTypeLabel(t) {
  return { text:'文字', longtext:'長文字', date:'日期', time:'時間', select:'單選', multiselect:'多選', number:'數字', url:'網址' }[t] || t;
}

function openAddFieldRow() {
  const ctx = _currentFieldsContext;
  if (!ctx) return;
  // 新欄位掛到使用者目前看到的那個類型（頂層 → 頂層；子類型 → 子類型專屬）
  const targetTypeId = ctx.isSubType ? ctx.subTypeId : ctx.rootTypeId;
  const tempId = '_new_' + Date.now();
  // 加到 ownFields 結尾（讓 renderFieldsList 會把它畫進「專屬」區）
  ctx.ownFields.push({
    fieldId: tempId, typeId: targetTypeId,
    '顯示名稱': '', '欄位類型': 'text', required: false, '下拉選項': [],
    sortOrder: (ctx.ownFields.length + ctx.inheritedFields.length) + 1,
    source: 'own'
  });
  renderFieldsList();
  setTimeout(() => {
    const row = document.querySelector(`.field-row[data-fid="${tempId}"]`);
    if (row) row.querySelector('input[data-k="name"]').focus();
  }, 50);
}

async function saveFieldRow(fid) {
  const ctx = _currentFieldsContext;
  if (!ctx) return;
  const row = document.querySelector(`.field-row[data-fid="${fid}"]`);
  if (!row) return;
  const get = k => row.querySelector(`[data-k="${k}"]`);
  const isReq = Boolean(get('required')?.checked);
  const data = {
    name: get('name').value.trim(),
    type: get('type').value,
    fieldType: get('type').value,
    field_type: get('type').value,
    '欄位類型': get('type').value,
    required: isReq,
    isRequired: isReq,
    is_required: isReq,
    '是否必填': isReq,
    options: get('options').value.trim()
  };
  if (!data.name) { alert('請輸入欄位名稱'); return; }

  const isNew = String(fid).startsWith('_new_');
  // 鎖住該列的儲存按鈕，其他列可繼續操作
  const saveBtn = row.querySelector('button.btn-success');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.innerText = '⏳'; }

  showLoadingToast(isNew ? `新增「${data.name}」中...` : `儲存「${data.name}」中...`);
  try {
    let res;
    if (isNew) {
      data.typeId = ctx.isSubType ? ctx.subTypeId : ctx.rootTypeId;
      res = await callAPI('cal_addField', data);
      if (!res.success) throw new Error(res.message);
      // 替換臨時 ID 為真 ID（不 reload）
      const realFieldId = res.fieldId || (res.data && res.data.fieldId) || fid;
      const idx = ctx.ownFields.findIndex(f => f.fieldId === fid);
      if (idx !== -1) {
        Object.assign(ctx.ownFields[idx], {
          fieldId: realFieldId,
          '顯示名稱': data.name,
          '欄位類型': data.type,
          required: isReq,
          isRequired: isReq,
          is_required: isReq,
          '是否必填': isReq,
          '下拉選項': (data.options || '').split(/[,，]/).map(s => s.trim()).filter(Boolean)
        });
      }
      row.dataset.fid = realFieldId;
      const delBtn = row.querySelector('.btn-outline-danger');
      if (delBtn) delBtn.setAttribute('onclick', `deleteFieldRow('${realFieldId}', ${JSON.stringify(data.name)})`);
      if (saveBtn) saveBtn.setAttribute('onclick', `saveFieldRow('${realFieldId}')`);
      showToast(`✅ 已新增「${data.name}」`, 'success', 1500);
    } else {
      data.fieldId = fid;
      res = await callAPI('cal_updateField', data);
      if (!res.success) throw new Error(res.message);
      // 同步更新本地狀態（不 reload）
      const arr = (ctx.ownFields || []).find(f => f.fieldId === fid)
                || (ctx.inheritedFields || []).find(f => f.fieldId === fid);
      if (arr) Object.assign(arr, {
        '顯示名稱': data.name,
        '欄位類型': data.type,
        required: isReq,
        isRequired: isReq,
        is_required: isReq,
        '是否必填': isReq,
        '下拉選項': (data.options || '').split(/[,，]/).map(s => s.trim()).filter(Boolean)
      });
      showToast(`✅ 已更新「${data.name}」`, 'success', 1500);
    }
  } catch (err) {
    showToast('❌ ' + err.message, 'error', 4000);
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.innerText = '💾'; }
  }
}

async function deleteFieldRow(fid, name) {
  const ctx = _currentFieldsContext;
  if (!ctx) return;
  const row = document.querySelector(`.field-row[data-fid="${fid}"]`);

  // 新增中還沒儲存 → 純前端移除
  if (String(fid).startsWith('_new_')) {
    ctx.ownFields = ctx.ownFields.filter(f => f.fieldId !== fid);
    if (row) row.remove();
    return;
  }
  if (!confirm(`確定刪除欄位「${name}」？\n⚠️ 所有事項中此欄位的值也會一併清除`)) return;

  // 樂觀刪除：先移 DOM 與本地，失敗才還原
  const backup = ctx.ownFields.find(f => f.fieldId === fid);
  ctx.ownFields = ctx.ownFields.filter(f => f.fieldId !== fid);
  if (row) row.remove();

  showLoadingToast(`刪除「${name}」中...`);
  try {
    const res = await callAPI('cal_deleteField', { fieldId: fid });
    if (!res.success) throw new Error(res.message);
    showToast(`✅ 已刪除「${name}」`, 'success');
  } catch (err) {
    // 失敗 → 還原（重 render 比較簡單，因為列已經被移掉了）
    if (backup) ctx.ownFields.push(backup);
    renderFieldsList();
    showToast('❌ 刪除失敗：' + err.message, 'error', 4000);
  }
}

function ensureXLSXReady() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    s.onload = () => resolve(window.XLSX);
    s.onerror = () => reject(new Error('無法載入 Excel 解析模組 (XLSX)'));
    document.head.appendChild(s);
  });
}

// ─── Excel 模板匯出（支援頂層 + 子類型）───
async function exportFieldsTemplate() {
  const ctx = _currentFieldsContext;
  if (!ctx || !_currentFieldsList) { alert('還沒載入欄位'); return; }

  await ensureXLSXReady();

  // 用「使用者按進來的那個類型」當模板主角
  const callerType = _calTypesFlat.find(t => t.typeId === ctx.callerTypeId);
  if (!callerType) { alert('找不到類型'); return; }

  const isSubType = !!ctx.isSubType;
  // 子類型清單（僅頂層模板才需要）
  const subTypes = isSubType ? [] : _calTypesFlat.filter(t => t.parentTypeId === ctx.rootTypeId);

  // Sheet 1：資料填寫
  // 「行程標題」= 月曆 chip 上顯示的文字（選填；留空 = 自動取第一個欄位的值當標題）
  // 頂層模板：日期 + 子類型 + 行程標題 + 各欄位
  // 子類型模板：日期 + 行程標題 + 各欄位
  const headers = isSubType
    ? ['日期', '行程標題'].concat(_currentFieldsList.map(f => f['顯示名稱']))
    : ['日期', '子類型', '行程標題'].concat(_currentFieldsList.map(f => f['顯示名稱']));

  // 構造範例列的「範例值」邏輯
  const fieldExample = f => {
    if (f['欄位類型'] === 'select' || f['欄位類型'] === 'multiselect') {
      const opts = Array.isArray(f['下拉選項']) ? f['下拉選項'] : [];
      return opts.length > 0 ? opts[0] : '（範例值）';
    }
    if (f['欄位類型'] === 'date') return '2026-01-05';
    if (f['欄位類型'] === 'number') return '0';
    return f.required ? '（必填）' : '（選填）';
  };

  const titleExample = '（留空 = 自動取第一個欄位）';
  const exampleRow = isSubType
    ? ['2026-01-05', titleExample, ..._currentFieldsList.map(fieldExample)]
    : ['2026-01-05', subTypes.length > 0 ? subTypes[0]['名稱'] : '', titleExample, ..._currentFieldsList.map(fieldExample)];

  const dataSheet = XLSX.utils.aoa_to_sheet([headers, exampleRow]);
  dataSheet['!cols'] = headers.map(h => ({ wch: Math.max(12, h.length * 2 + 2) }));

  // Sheet 2：使用說明
  const titlePrefix = isSubType
    ? `${callerType.icon || ''} ${callerType['名稱']}（子類型，繼承自父）`
    : `${callerType.icon || ''} ${callerType['名稱']}`;

  const instructions = [
    ['📖 教會行事曆 - Excel 模板使用說明'],
    [''],
    [`類型：${titlePrefix}`],
    [''],
    ['【填寫規則】'],
    ['1. 第一列「資料填寫」分頁的第 1 列為標題，請勿修改'],
    ['2. 第 2 列是範例，請刪除後再填入實際資料'],
    ['3. 從第 3 列起填入實際資料，每列 = 一個事項'],
    ['4. 日期格式：YYYY-MM-DD（例 2026-01-05）；或 Excel 日期格式'],
    [''],
    ['【欄位說明】'],
    ['欄位名稱', '型別', '是否必填', '說明'],
    ['日期', 'date', '必填', '事項日期']
  ];
  if (!isSubType && subTypes.length > 0) {
    instructions.push(['子類型', 'text', '選填', `每列可填不同子類型；必須是：${subTypes.map(s => s['名稱']).join(' / ')}`]);
  }
  instructions.push(['行程標題', 'text', '選填', '月曆上顯示的文字；留空 = 自動取第一個欄位的值；想用不同顯示文字（例如縮短講題）才填']);
  _currentFieldsList.forEach(f => {
    let desc = '';
    if (f['欄位類型'] === 'select' || f['欄位類型'] === 'multiselect') {
      const opts = Array.isArray(f['下拉選項']) ? f['下拉選項'] : [];
      desc = '選項：' + opts.join(' / ');
      if (f['欄位類型'] === 'multiselect') desc += '（多選用逗號分隔）';
    } else if (f['欄位類型'] === 'longtext') desc = '長文字，可換行';
    else if (f['欄位類型'] === 'url') desc = '網址';
    else if (f['欄位類型'] === 'number') desc = '數字';
    instructions.push([
      f['顯示名稱'], f['欄位類型'], f.required ? '必填' : '選填', desc
    ]);
  });
  instructions.push(['']);
  instructions.push(['【匯入方式】']);
  instructions.push(['1. 填好後存檔']);
  instructions.push(['2. 到「📅 行事曆月曆」頁面右上「📤 上傳 Excel」']);
  instructions.push(['3. 系統會解析並預覽，確認後一鍵建立']);
  if (isSubType) {
    instructions.push(['']);
    instructions.push(['ℹ️ 此模板專屬子類型「' + callerType['名稱'] + '」，匯入時每列都會建為此子類型']);
  }

  const guideSheet = XLSX.utils.aoa_to_sheet(instructions);
  guideSheet['!cols'] = [{wch:20},{wch:12},{wch:10},{wch:50}];

  const wb = XLSX.utils.book_new();
  // 第 1 個 Sheet 名稱 = 此模板所代表的類型名（頂層或子類型都行）
  // 上傳時系統會用 sheet 名稱在所有類型中比對
  XLSX.utils.book_append_sheet(wb, dataSheet, callerType['名稱']);
  XLSX.utils.book_append_sheet(wb, guideSheet, '使用說明');

  const fileName = `行事曆模板_${callerType['名稱']}_${new Date().toISOString().substring(0,10)}.xlsx`;
  XLSX.writeFile(wb, fileName);
  showToast(`📥 已下載：${fileName}`, 'success', 2500);
}

// ─── 遷移 ───
async function runMigration() {
  if (!confirm(`即將進行：
1. 把舊「聚會資料 / 事工細項 / 講道資訊」備份成 _Backup_* 分頁
2. 依新結構轉成事項

舊資料不會被刪除，可以重複跑。是否繼續？`)) return;
  try {
    const res = await callAPI('cal_migrateOldData');
    if (!res.success) throw new Error(res.message);
    alert(res.message + '\n\n備份分頁：\n' + (res.backups || []).join('\n') + '\n\n' + (res.note || ''));
  } catch (err) {
    alert('❌ ' + err.message);
  }
}
