/**
 * 教會行事曆 - 月曆視圖（Phase 2）
 * 依賴：FullCalendar 6 + 中央 churchAPI
 */

let _calendar = null;
let _types = { tree: [], flat: [] }; // {tree:[]rootTypes(with children), flat:[]allTypes}
let _selectableTypes = []; // 可被選為事項類型的（葉子節點 或 無子的頂層）
let _activeTypeIds = new Set(); // 當前篩選顯示的 typeIds
let _fieldsByType = {}; // typeId → fields (cache)
let _currentDetailEvent = null;
let _isInitialLoad = true;

const SCRIPTURE_FIELD_NAMES = new Set(['經文', '宣召', '金句']);

function formatCalendarFieldValue(fieldName, value) {
  const text = String(value == null ? '' : value);
  const name = String(fieldName || '').trim();
  return SCRIPTURE_FIELD_NAMES.has(name) && window.BibleFormatter
    ? window.BibleFormatter.format(text)
    : text;
}

function formatCalendarEventValues(event) {
  if (!event || !Array.isArray(event.values)) return event;
  return {
    ...event,
    values: event.values.map(value => ({
      ...value,
      value: formatCalendarFieldValue(value.fieldName, value.value)
    }))
  };
}

const _eventsCache = new Map();

function clearEventsCache() {
  _eventsCache.clear();
}

let _loadingCount = 0;
function showLoading(actionName) {
  _loadingCount++;
  const overlay = document.getElementById('loadingOverlay');
  const textEl = document.getElementById('loadingText');
  const subtextEl = document.getElementById('loadingSubtext');
  if (!overlay || !textEl || !subtextEl) return;
  
  if (actionName === 'cal_updateEvent' || actionName === 'cal_addEvent') {
    textEl.innerText = "正在儲存變更...";
    subtextEl.innerText = "正在同步更新試算表與 Firebase 快取";
  } else if (actionName === 'cal_aiParseForType') {
    textEl.innerText = "AI 正在進行排程解析...";
    subtextEl.innerText = "這可能需要數秒時間，請稍候";
  } else if (actionName === 'cal_getEvents') {
    textEl.innerText = "正在讀取行事曆事項...";
    subtextEl.innerText = "正在加載最新行程數據";
  } else if (actionName === 'cal_getTypes') {
    textEl.innerText = "正在載入事項類型...";
    subtextEl.innerText = "正在加載分類設定";
  } else if (actionName === 'cal_getFields') {
    textEl.innerText = "正在載入欄位設定...";
    subtextEl.innerText = "正在讀取欄位定義";
  } else if (actionName === 'cal_deleteEvent') {
    textEl.innerText = "正在刪除事項...";
    subtextEl.innerText = "正在自試算表中移除該行程";
  } else if (actionName === 'cal_addEventsBatch') {
    textEl.innerText = "正在批次寫入事項...";
    subtextEl.innerText = "正在一次性建立多筆行程中";
  } else if (actionName === 'cal_setupSchema') {
    textEl.innerText = "正在升級資料結構...";
    subtextEl.innerText = "正在為您無損升級現有 Google 試算表欄位";
  } else if (actionName === 'excel_parse') {
    textEl.innerText = "正在解析 Excel 內容...";
    subtextEl.innerText = "正在檢查欄位格式與資料";
  } else {
    textEl.innerText = "正在處理中...";
    subtextEl.innerText = "系統正在處理中，請稍候";
  }
  
  overlay.style.display = 'flex';
  overlay.offsetHeight; // 強制重繪
  overlay.classList.add('show');
}

function hideLoading() {
  _loadingCount = Math.max(0, _loadingCount - 1);
  if (_loadingCount > 0) return;
  const overlay = document.getElementById('loadingOverlay');
  if (!overlay) return;
  overlay.classList.remove('show');
  setTimeout(() => {
    if (_loadingCount === 0) {
      overlay.style.display = 'none';
    }
  }, 250);
}

async function callAPI(action, data) {
  showLoading(action);
  try {
    if (window.CalendarSupabaseService && typeof window.CalendarSupabaseService[action] === 'function') {
      return await window.CalendarSupabaseService[action](data || {});
    }
    if (typeof window.churchAPI !== 'function') throw new Error('config.js 尚未載入');
    const res = await window.churchAPI(action, data || {});
    return res;
  } finally {
    hideLoading();
  }
}

function bootstrapCalendar() {
  const typesPromise = loadTypesAndChips();
  initCalendar();
  typesPromise.finally(() => {
    _isInitialLoad = false;
  });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrapCalendar);
  } else {
    bootstrapCalendar();
  }
}

// ─────────────────────────────────────────────────────────────
// 1. 初始化 FullCalendar
// ─────────────────────────────────────────────────────────────
function initCalendar() {
  const el = document.getElementById('calendar');
  _calendar = new FullCalendar.Calendar(el, {
    initialView: 'dayGridMonth',
    locale: 'zh-tw',
    height: 'auto',
    firstDay: 0, // 週日
    headerToolbar: {
      left: 'prev,next today',
      center: 'title',
      right: 'dayGridMonth,timeGridWeek,listMonth'
    },
    buttonText: { today: '今天', month: '月', week: '週', list: '列表' },
    dayMaxEvents: 4,
    moreLinkText: '+ 還有',

    datesSet: function(info) {
      // 翻頁時重新拉
      loadEventsForRange(info.startStr.split('T')[0], info.endStr.split('T')[0]);
    },

    dateClick: function(info) {
      // 點空白日期 → 新增事項，預填日期
      openAddEventModal(info.dateStr);
    },

    eventClick: function(info) {
      openEventDetail(info.event.extendedProps.raw);
    },

    eventContent: function(arg) {
      // 自訂事件渲染：圖示 + 標題 + 子類型 badge
      const ev = arg.event.extendedProps.raw;
      const iconHtml = ev.typeIcon ? `<span class="icon-span">${ev.typeIcon}</span>` : '';
      const color = ev.typeColor || '#6366f1';
      const transparentBg = color + '1f'; // 12% opacity
      return {
        html: `
          <div class="custom-event-card" style="--event-theme-color: ${color}; --card-bg-opacity: ${transparentBg};">
            ${iconHtml}
            <span class="title-text" style="color: #334155;">${escapeHtml(ev.title || ev.typeName)}</span>
          </div>
        `
      };
    }
  });
  _calendar.render();
}

// ─────────────────────────────────────────────────────────────
// 2. 載入類型 + 渲染篩選 chips
// ─────────────────────────────────────────────────────────────
async function loadTypesAndChips() {
  try {
    const res = await callAPI('cal_getTypes');
    if (!res.success) throw new Error(res.message);
    _types = res.data;
  } catch (err) {
    document.getElementById('typeChipsContainer').innerHTML =
      `<div class="alert alert-danger m-0 p-2 small">類型載入失敗：${err.message}</div>`;
    return;
  }

  // 算出「可被選為事項類型」的清單：葉子節點 OR 無子的頂層
  _selectableTypes = [];
  _types.flat.forEach(t => {
    const hasChildren = _types.flat.some(c => c.parentTypeId === t.typeId);
    if (!hasChildren) _selectableTypes.push(t);
  });

  renderTypeChips();
  populateTypeSelect();
  // 預設全選
  _activeTypeIds = new Set(_selectableTypes.map(t => t.typeId));
}

function renderTypeChips() {
  const container = document.getElementById('typeChipsContainer');
  if (_selectableTypes.length === 0) {
    container.innerHTML = '<span class="text-muted small">尚無可用類型（請先到「事項類型管理」建立）</span>';
    return;
  }
  // 按頂層分組
  const byRoot = {};
  _selectableTypes.forEach(t => {
    let root = t;
    while (root.parentTypeId) {
      root = _types.flat.find(p => p.typeId === root.parentTypeId) || root;
      if (!root.parentTypeId) break;
    }
    const key = root.typeId;
    if (!byRoot[key]) byRoot[key] = { root, items: [] };
    byRoot[key].items.push(t);
  });

  container.innerHTML = Object.values(byRoot).map(group => {
    const chipsHtml = group.items.map(t => {
      const isParent = t.typeId === group.root.typeId;
      const label = isParent ? `${t.icon || ''} ${t['名稱']}` : `${t.icon || ''} ${t['名稱']}`;
      const color = t.color || '#6366f1';
      const bg = color + '14'; // 8% opacity (hex '14')
      const textCol = color;
      const shadow = `0 4px 10px ${color}1f`;
      const hoverShadow = `${color}33`;
      const styleStr = `--chip-color:${color}; --chip-bg:${bg}; --chip-text-color:${textCol}; --chip-shadow:${shadow}; --chip-hover-shadow:${hoverShadow};`;
      return `<span class="badge filter-chip" style="${styleStr}"
                data-tid="${t.typeId}" onclick="toggleChip('${t.typeId}')">${label}</span>`;
    }).join('');
    return `<div class="d-flex align-items-center gap-1 me-3">
              <small class="text-muted">${group.root.icon || ''} ${group.root['名稱']}：</small>
              ${chipsHtml}
            </div>`;
  }).join('');
}

function toggleChip(typeId) {
  if (_activeTypeIds.has(typeId)) _activeTypeIds.delete(typeId);
  else _activeTypeIds.add(typeId);
  document.querySelectorAll(`.filter-chip[data-tid="${typeId}"]`).forEach(el => {
    el.classList.toggle('off', !_activeTypeIds.has(typeId));
  });
  // 重新載當前範圍
  const view = _calendar.view;
  loadEventsForRange(window.formatYMD(view.activeStart), window.formatYMD(view.activeEnd));
}

function toggleAllChips(on) {
  if (on) _activeTypeIds = new Set(_selectableTypes.map(t => t.typeId));
  else    _activeTypeIds.clear();
  document.querySelectorAll('.filter-chip').forEach(el => {
    el.classList.toggle('off', !_activeTypeIds.has(el.dataset.tid));
  });
  const view = _calendar.view;
  loadEventsForRange(window.formatYMD(view.activeStart), window.formatYMD(view.activeEnd));
}

// ─────────────────────────────────────────────────────────────
// 3. 拉事項 → 餵給 FullCalendar
// ─────────────────────────────────────────────────────────────
function renderCalendarEvents(events) {
  if (!_calendar) return;
  _calendar.removeAllEvents();
  (events || []).forEach(ev => {
    const displayEvent = formatCalendarEventValues(ev);
    _calendar.addEvent({
      id: displayEvent.eventId,
      title: displayEvent.title || displayEvent.typeName,
      start: displayEvent.date,
      backgroundColor: 'transparent',
      borderColor: 'transparent',
      textColor: displayEvent.typeColor || '#334155',
      extendedProps: { raw: displayEvent }
    });
  });
}

async function loadEventsForRange(startDate, endDate) {
  const cacheKey = `${startDate}_${endDate}`;
  const isCustomFilter = _activeTypeIds.size > 0 && _activeTypeIds.size < _selectableTypes.length;

  try {
    const req = { startDate, endDate };
    if (isCustomFilter) {
      req.typeIds = Array.from(_activeTypeIds);
    } else if (_activeTypeIds.size === 0 && !_isInitialLoad) {
      // 全不選 → 清空
      _calendar.removeAllEvents();
      return;
    }

    // 快取命中（未自訂篩選時直接秒顯）
    if (!isCustomFilter && _eventsCache.has(cacheKey)) {
      renderCalendarEvents(_eventsCache.get(cacheKey));
      return;
    }

    const res = await callAPI('cal_getEvents', req);
    if (!res.success) throw new Error(res.message);
    const events = res.data || [];

    if (!isCustomFilter) {
      _eventsCache.set(cacheKey, events);
      try { localStorage.setItem('churchEvents', JSON.stringify(events)); } catch (e) {}
    }
    renderCalendarEvents(events);
  } catch (err) {
    console.error('載入事項失敗', err);
    if (window.userNotification) {
      window.userNotification.error('事項載入失敗：' + err.message);
    }
  }
}

// ─────────────────────────────────────────────────────────────
// 4. 事項 Modal — 新增 / 編輯
// ─────────────────────────────────────────────────────────────
function populateTypeSelect() {
  const sel = document.getElementById('evf_typeId');
  if (_selectableTypes.length === 0) {
    sel.innerHTML = '<option value="">尚無可用類型，請先到「事項類型管理」建立</option>';
    return;
  }
  // 按頂層分組
  const byRoot = {};
  _selectableTypes.forEach(t => {
    let root = t;
    while (root.parentTypeId) {
      root = _types.flat.find(p => p.typeId === root.parentTypeId) || root;
      if (!root.parentTypeId) break;
    }
    if (!byRoot[root.typeId]) byRoot[root.typeId] = { root, items: [] };
    byRoot[root.typeId].items.push(t);
  });
  let html = '<option value="">-- 選擇類型 --</option>';
  Object.values(byRoot).forEach(group => {
    if (group.items.length === 1 && group.items[0].typeId === group.root.typeId) {
      // 頂層自己就是葉子
      html += `<option value="${group.root.typeId}">${group.root.icon || ''} ${group.root['名稱']}</option>`;
    } else {
      html += `<optgroup label="${group.root.icon || ''} ${group.root['名稱']}">`;
      group.items.forEach(t => {
        html += `<option value="${t.typeId}">${t.icon || ''} ${t['名稱']}</option>`;
      });
      html += '</optgroup>';
    }
  });
  sel.innerHTML = html;
}

function openAddEventModal(dateStr) {
  document.getElementById('eventModalTitle').innerText = '新增事項';
  document.getElementById('evf_eventId').value = '';
  document.getElementById('evf_typeId').value = '';
  
  // 確保日期欄位為 YYYY-MM-DD 格式以正確在 input[type=date] 顯示
  let dateVal = dateStr || window.formatYMD(new Date());
  if (typeof dateVal === 'string') {
    const match = dateVal.trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (match) {
      dateVal = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
    }
  }
  document.getElementById('evf_date').value = dateVal;
  
  document.getElementById('evf_title').value = '';
  document.getElementById('evf_fieldsContainer').innerHTML =
    '<div class="text-muted text-center py-4">請先選擇事項類型，下方會顯示對應欄位</div>';
  document.getElementById('evf_deleteBtn').style.display = 'none';
  bootstrap.Modal.getOrCreateInstance(document.getElementById('eventModal')).show();
}

async function openEditEventModal(event) {
  document.getElementById('eventModalTitle').innerText = '編輯事項';
  document.getElementById('evf_eventId').value = event.eventId;
  document.getElementById('evf_typeId').value = event.typeId;
  
  // 確保日期欄位為 YYYY-MM-DD 格式以正確在 input[type=date] 顯示，防止時區偏移
  let dateVal = event.date;
  if (typeof dateVal === 'string') {
    const match = dateVal.trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (match) {
      dateVal = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
    } else {
      dateVal = window.formatYMD(dateVal);
    }
  } else {
    dateVal = window.formatYMD(dateVal);
  }
  document.getElementById('evf_date').value = dateVal;
  
  document.getElementById('evf_title').value = event.title || '';
  document.getElementById('evf_deleteBtn').style.display = '';

  // 載入欄位 + 預填值
  await renderFieldsForType(event.typeId, event.values);
  bootstrap.Modal.getOrCreateInstance(document.getElementById('eventModal')).show();
}

async function onTypeChanged() {
  const tid = document.getElementById('evf_typeId').value;
  if (!tid) {
    document.getElementById('evf_fieldsContainer').innerHTML =
      '<div class="text-muted text-center py-4">請先選擇事項類型</div>';
    return;
  }
  await renderFieldsForType(tid, []);
}

async function renderFieldsForType(typeId, existingValues) {
  const container = document.getElementById('evf_fieldsContainer');
  container.innerHTML = '<div class="text-center py-3"><div class="spinner-border spinner-border-sm"></div></div>';

  let fields;
  if (_fieldsByType[typeId]) {
    fields = _fieldsByType[typeId];
  } else {
    try {
      const res = await callAPI('cal_getFields', { typeId });
      if (!res.success) throw new Error(res.message);
      fields = res.data.fields;
      _fieldsByType[typeId] = fields;
    } catch (err) {
      container.innerHTML = `<div class="alert alert-danger">欄位載入失敗：${err.message}</div>`;
      return;
    }
  }

  if (fields.length === 0) {
    container.innerHTML = '<div class="alert alert-light border text-muted">此類型沒有定義任何欄位</div>';
    return;
  }

  // existingValues: array of {fieldId, value} or object of { [fieldId]: value }
  const valMap = {};
  if (Array.isArray(existingValues)) {
    existingValues.forEach(v => {
      if (v && v.fieldId) valMap[v.fieldId] = (v.value !== undefined ? v.value : v['值']) || '';
    });
  } else if (existingValues && typeof existingValues === 'object') {
    Object.entries(existingValues).forEach(([fid, v]) => {
      valMap[fid] = (typeof v === 'object' && v !== null && v.value !== undefined ? v.value : v) || '';
    });
  }

  container.innerHTML = fields.map(f => _renderFieldInput(f, valMap[f.fieldId] || '')).join('');
}

function _renderFieldInput(f, value) {
  const fid = f.fieldId;
  const label = escapeHtml(f['顯示名稱']);
  const req = f.required ? '<span class="text-danger">*</span>' : '';
  
  // 載入顯示時，經文、宣召、金句共用同一套書卷展開規則。
  const fieldName = String(f['顯示名稱'] || '').trim();
  const isScriptureField = SCRIPTURE_FIELD_NAMES.has(fieldName);
  value = formatCalendarFieldValue(fieldName, value);
  const v = escapeAttr(value);

  // 經文/宣召/金句欄位加上 blur 自動標準化屬性
  const onblurAttr = isScriptureField
    ? 'onblur="if(window.BibleFormatter) this.value = window.BibleFormatter.format(this.value)"'
    : '';

  let inputHtml = '';
  switch (f['欄位類型']) {
    case 'longtext':
      inputHtml = `<textarea class="form-control field-input" rows="3" data-fid="${fid}" data-req="${f.required}" ${onblurAttr}>${escapeHtml(value)}</textarea>`;
      break;
    case 'date':
      inputHtml = `<input type="date" class="form-control field-input" value="${v}" data-fid="${fid}" data-req="${f.required}">`;
      break;
    case 'time':
      inputHtml = `<input type="time" class="form-control field-input" value="${v}" data-fid="${fid}" data-req="${f.required}">`;
      break;
    case 'number':
      inputHtml = `<input type="number" class="form-control field-input" value="${v}" data-fid="${fid}" data-req="${f.required}">`;
      break;
    case 'url':
      inputHtml = `<input type="url" class="form-control field-input" value="${v}" data-fid="${fid}" data-req="${f.required}" placeholder="https://...">`;
      break;
    case 'select': {
      const opts = (Array.isArray(f['下拉選項']) ? f['下拉選項'] : []);
      inputHtml = `<select class="form-select field-input" data-fid="${fid}" data-req="${f.required}">
        <option value="">-- 請選擇 --</option>
        ${opts.map(o => `<option value="${escapeAttr(o)}" ${o === value ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('')}
      </select>`;
      break;
    }
    case 'multiselect': {
      const opts = (Array.isArray(f['下拉選項']) ? f['下拉選項'] : []);
      const selected = String(value || '').split(',').map(s => s.trim());
      inputHtml = `<div class="border rounded p-2 bg-light" data-fid="${fid}" data-req="${f.required}" data-multi="1">
        ${opts.map(o => `
          <div class="form-check form-check-inline">
            <input class="form-check-input" type="checkbox" value="${escapeAttr(o)}" id="ms_${fid}_${escapeAttr(o)}" ${selected.includes(o) ? 'checked' : ''}>
            <label class="form-check-label" for="ms_${fid}_${escapeAttr(o)}">${escapeHtml(o)}</label>
          </div>
        `).join('')}
      </div>`;
      break;
    }
    case 'text':
    default:
      inputHtml = `<input type="text" class="form-control field-input" value="${v}" data-fid="${fid}" data-req="${f.required}" ${onblurAttr}>`;
  }

  return `<div class="mb-2">
    <label class="form-label fw-bold small mb-1">${label} ${req}</label>
    ${inputHtml}
  </div>`;
}

async function saveEvent() {
  const eventId = document.getElementById('evf_eventId').value;
  const typeId = document.getElementById('evf_typeId').value;
  const date = document.getElementById('evf_date').value;
  const title = document.getElementById('evf_title').value.trim();

  if (!typeId) { alert('請選擇事項類型'); return; }
  if (!date)   { alert('請選擇日期'); return; }

  // 收集欄位值
  const valuesObj = {};
  const inputs = document.querySelectorAll('#evf_fieldsContainer [data-fid]');
  let missing = null;
  inputs.forEach(el => {
    const fid = el.dataset.fid;
    const field = (_fieldsByType[typeId] || []).find(item => String(item.fieldId) === String(fid));
    const required = el.dataset.req === 'true';
    let val;
    if (el.dataset.multi === '1') {
      val = Array.from(el.querySelectorAll('input[type="checkbox"]:checked')).map(c => c.value).join(',');
    } else {
      val = el.value;
    }
    val = formatCalendarFieldValue(field && field['顯示名稱'], val);
    if (required && !val.toString().trim()) missing = el;
    if (val) valuesObj[fid] = val;
  });
  if (missing) {
    missing.focus();
    alert('有必填欄位尚未填寫');
    return;
  }

  const data = { typeId, date, title, values: valuesObj };
  try {
    let res;
    if (eventId) {
      data.eventId = eventId;
      res = await callAPI('cal_updateEvent', data);
    } else {
      res = await callAPI('cal_addEvent', data);
    }
    if (!res.success) throw new Error(res.message);
    clearEventsCache();
    bootstrap.Modal.getOrCreateInstance(document.getElementById('eventModal')).hide();
    // 重新拉當前範圍
    const view = _calendar.view;
    loadEventsForRange(window.formatYMD(view.activeStart), window.formatYMD(view.activeEnd));
  } catch (err) {
    alert('❌ ' + err.message);
  }
}

async function deleteEvent() {
  const eventId = document.getElementById('evf_eventId').value;
  if (!eventId) return;
  if (!confirm('確定刪除此事項？')) return;
  try {
    const res = await callAPI('cal_deleteEvent', { eventId });
    if (!res.success) throw new Error(res.message);
    clearEventsCache();
    bootstrap.Modal.getOrCreateInstance(document.getElementById('eventModal')).hide();
    const view = _calendar.view;
    loadEventsForRange(window.formatYMD(view.activeStart), window.formatYMD(view.activeEnd));
  } catch (err) {
    alert('❌ ' + err.message);
  }
}

// ─────────────────────────────────────────────────────────────
// 5. 事項詳情 Modal（點月曆 chip 開啟）
// ─────────────────────────────────────────────────────────────
function openEventDetail(event) {
  _currentDetailEvent = event;
  const header = document.getElementById('eventDetailHeader');
  header.style.background = event.typeColor + '20';
  header.style.borderBottom = `3px solid ${event.typeColor}`;
  document.getElementById('eventDetailTitle').innerHTML = `${event.typeIcon || ''} ${escapeHtml(event.title || event.typeName)}`;

  const valuesHtml = event.values && event.values.length > 0
    ? event.values.map(v => `<div class="field-row-display">
        <span class="label">${escapeHtml(v.fieldName)}：</span>
        <span>${v.fieldType === 'longtext'
          ? escapeHtml(formatCalendarFieldValue(v.fieldName, v.value)).replace(/\n/g, '<br>')
          : escapeHtml(formatCalendarFieldValue(v.fieldName, v.value))}</span>
      </div>`).join('')
    : '<div class="text-muted text-center py-2">沒有填寫任何欄位</div>';

  document.getElementById('eventDetailBody').innerHTML = `
    <div class="event-meta mb-3">
      📅 <b>${event.date}</b>
      🏷️ <span class="badge" style="background:${event.typeColor};">${event.typeFullName}</span>
    </div>
    ${valuesHtml}
  `;
  bootstrap.Modal.getOrCreateInstance(document.getElementById('eventDetailModal')).show();
}

function editFromDetail() {
  bootstrap.Modal.getOrCreateInstance(document.getElementById('eventDetailModal')).hide();
  setTimeout(() => openEditEventModal(_currentDetailEvent), 300);
}

async function confirmDeleteFromDetail() {
  if (!_currentDetailEvent) return;
  if (!confirm(`確定刪除「${_currentDetailEvent.title || _currentDetailEvent.typeName}」？`)) return;
  try {
    const res = await callAPI('cal_deleteEvent', { eventId: _currentDetailEvent.eventId });
    if (!res.success) throw new Error(res.message);
    clearEventsCache();
    bootstrap.Modal.getOrCreateInstance(document.getElementById('eventDetailModal')).hide();
    const view = _calendar.view;
    loadEventsForRange(window.formatYMD(view.activeStart), window.formatYMD(view.activeEnd));
  } catch (err) {
    alert('❌ ' + err.message);
  }
}

// ═════════════════════════════════════════════════════════════
// 📅 批量新增（手動）
// ═════════════════════════════════════════════════════════════
let _batchDates = []; // ['2026-01-05', ...]

function openBatchModal() {
  _batchDates = [];
  document.getElementById('batch_startDate').value = '';
  document.getElementById('batch_endDate').value = '';
  document.querySelectorAll('.batch-wd').forEach(b => b.classList.remove('active', 'btn-info', 'text-white'));
  document.getElementById('batch_dateChips').innerHTML = '<span class="text-muted small">尚未產生</span>';
  document.getElementById('batch_summary').innerText = '';
  // 重用單筆 modal 的類型 select
  document.getElementById('batch_typeId').innerHTML = document.getElementById('evf_typeId').innerHTML;
  document.getElementById('batch_typeId').value = '';
  document.getElementById('batch_fieldsContainer').innerHTML = '<div class="text-muted text-center py-3">請先選擇類型</div>';

  // 星期幾按鈕互動
  document.querySelectorAll('.batch-wd').forEach(btn => {
    btn.onclick = () => {
      btn.classList.toggle('active');
      btn.classList.toggle('btn-info');
      btn.classList.toggle('text-white');
    };
  });

  bootstrap.Modal.getOrCreateInstance(document.getElementById('batchModal')).show();
}

function batchGenerateDates() {
  const start = document.getElementById('batch_startDate').value;
  const end = document.getElementById('batch_endDate').value;
  if (!start || !end) { alert('請選擇起訖日期'); return; }
  if (start > end) { alert('開始日期不可大於結束日期'); return; }

  const selectedWds = Array.from(document.querySelectorAll('.batch-wd.active')).map(b => parseInt(b.dataset.wd));
  const sd = new Date(start), ed = new Date(end);
  const dates = [];
  for (let d = new Date(sd); d <= ed; d.setDate(d.getDate() + 1)) {
    if (selectedWds.length === 0 || selectedWds.includes(d.getDay())) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      dates.push(`${y}-${m}-${day}`);
    }
  }
  _batchDates = dates;
  renderBatchDateChips();
}

function renderBatchDateChips() {
  const c = document.getElementById('batch_dateChips');
  if (_batchDates.length === 0) {
    c.innerHTML = '<span class="text-muted small">尚未產生</span>';
    document.getElementById('batch_summary').innerText = '';
    return;
  }
  c.innerHTML = _batchDates.map((d, i) =>
    `<span class="badge bg-info text-white">${d} <button class="btn-close btn-close-white ms-1" style="font-size:.5rem;" onclick="removeBatchDate(${i})"></button></span>`
  ).join('');
  document.getElementById('batch_summary').innerText = `將建立 ${_batchDates.length} 筆事項`;
}

function removeBatchDate(idx) {
  _batchDates.splice(idx, 1);
  renderBatchDateChips();
}

async function onBatchTypeChanged() {
  const tid = document.getElementById('batch_typeId').value;
  const container = document.getElementById('batch_fieldsContainer');
  if (!tid) {
    container.innerHTML = '<div class="text-muted text-center py-3">請先選擇類型</div>';
    return;
  }
  container.innerHTML = '<div class="text-center py-3"><div class="spinner-border spinner-border-sm"></div></div>';
  let fields;
  if (_fieldsByType[tid]) fields = _fieldsByType[tid];
  else {
    try {
      const res = await callAPI('cal_getFields', { typeId: tid });
      if (!res.success) throw new Error(res.message);
      fields = res.data.fields;
      _fieldsByType[tid] = fields;
    } catch (err) {
      container.innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
      return;
    }
  }
  if (fields.length === 0) {
    container.innerHTML = '<div class="alert alert-light border text-muted">此類型沒有欄位</div>';
    return;
  }
  // 給 batch 用，特別前綴 fid 避免與單筆 modal 衝突
  container.innerHTML = fields.map(f => _renderFieldInput(f, ''))
    .join('').replace(/data-fid="/g, 'data-bfid="');
}

async function confirmBatchAdd() {
  if (_batchDates.length === 0) { alert('請先產生日期'); return; }
  const typeId = document.getElementById('batch_typeId').value;
  if (!typeId) { alert('請選擇類型'); return; }

  // 收集欄位值（套用到每一筆）
  const valuesObj = {};
  const inputs = document.querySelectorAll('#batch_fieldsContainer [data-bfid]');
  let missing = null;
  inputs.forEach(el => {
    const fid = el.dataset.bfid;
    const field = (_fieldsByType[typeId] || []).find(item => String(item.fieldId) === String(fid));
    const required = el.dataset.req === 'true';
    let val;
    if (el.dataset.multi === '1') {
      val = Array.from(el.querySelectorAll('input[type="checkbox"]:checked')).map(c => c.value).join(',');
    } else {
      val = el.value;
    }
    val = formatCalendarFieldValue(field && field['顯示名稱'], val);
    if (required && !val.toString().trim()) missing = el;
    if (val) valuesObj[fid] = val;
  });
  if (missing) { missing.focus(); alert('有必填欄位尚未填寫'); return; }

  const events = _batchDates.map(d => ({ typeId, date: d, values: valuesObj, title: '' }));

  try {
    const res = await callAPI('cal_addEventsBatch', { events });
    if (!res.success) throw new Error(res.message || '建立失敗');
    alert(`✅ ${res.message}`);
    clearEventsCache();
    bootstrap.Modal.getOrCreateInstance(document.getElementById('batchModal')).hide();
    const view = _calendar.view;
    loadEventsForRange(view.activeStart.toISOString().substring(0,10), view.activeEnd.toISOString().substring(0,10));
  } catch (err) {
    alert('❌ ' + err.message);
  }
}

// ═════════════════════════════════════════════════════════════
// 🤖 AI 解析
// ═════════════════════════════════════════════════════════════
let _aiParseResult = null;

function openAiModal() {
  // 只列頂層類型（AI 會自動判斷子類型）
  const sel = document.getElementById('ai_rootTypeId');
  // 後端回傳 data.types（不是 .tree）；同時 fallback 從 flat 過濾頂層
  const roots = (_types && (_types.types || _types.tree)) ||
                ((_types && _types.flat) ? _types.flat.filter(t => !t.parentTypeId) : []);
  sel.innerHTML = '<option value="">-- 選擇頂層類型 --</option>' +
    roots.map(t => `<option value="${t.typeId}">${t.icon || ''} ${t['名稱']}</option>`).join('');
  document.getElementById('ai_rawText').value = '';
  document.getElementById('ai_resultPreview').innerHTML = '';
  document.getElementById('ai_confirmBtn').style.display = 'none';
  _aiParseResult = null;
  bootstrap.Modal.getOrCreateInstance(document.getElementById('aiModal')).show();
}

async function runAiParse() {
  const rootTypeId = document.getElementById('ai_rootTypeId').value;
  const rawText = document.getElementById('ai_rawText').value.trim();
  if (!rootTypeId) { alert('請選擇預期類型'); return; }
  if (!rawText) { alert('請貼上要解析的文字'); return; }

  const preview = document.getElementById('ai_resultPreview');
  preview.innerHTML = '<div class="text-center py-3"><div class="spinner-border text-warning"></div><div class="small text-muted mt-2">AI 解析中...（可能需要 5-15 秒）</div></div>';

  try {
    const res = await callAPI('cal_aiParseForType', { rootTypeId, rawText, allowMultiple: true });
    if (!res.success) throw new Error(res.message || 'AI 解析失敗');
    _aiParseResult = res;
    renderAiPreview(res);
  } catch (err) {
    preview.innerHTML = `<div class="alert alert-danger">❌ ${err.message}</div>`;
  }
}

async function renderAiPreview(res) {
  const events = res.events || [];
  const container = document.getElementById('ai_resultPreview');

  if (events.length === 0) {
    container.innerHTML = '<div class="alert alert-warning">AI 沒有解析出任何事項，請檢查貼上的文字</div>';
    document.getElementById('ai_confirmBtn').style.display = 'none';
    return;
  }

  // 先取頂層類型的欄位（每張卡片渲染輸入用）
  const rootTypeId = res.rootTypeId;
  let fields;
  if (_fieldsByType[rootTypeId]) {
    fields = _fieldsByType[rootTypeId];
  } else {
    container.innerHTML = '<div class="text-center py-3"><div class="spinner-border spinner-border-sm"></div> 載入欄位定義...</div>';
    try {
      const fr = await callAPI('cal_getFields', { typeId: rootTypeId });
      if (!fr.success) throw new Error(fr.message);
      fields = fr.data.fields;
      _fieldsByType[rootTypeId] = fields;
    } catch (err) {
      container.innerHTML = `<div class="alert alert-danger">欄位載入失敗：${err.message}</div>`;
      return;
    }
  }

  const rootType = _types.flat.find(t => t.typeId === rootTypeId);
  const subTypes = _types.flat.filter(t => t.parentTypeId === rootTypeId);

  let html = `<div class="alert alert-success py-2 mb-3">
    ✅ AI 解析出 <b>${events.length}</b> 個事項，請逐筆檢查並修改，按下方「批量建立」即建檔
    <button class="btn btn-sm btn-outline-secondary float-end" onclick="addAiEventCard()" title="手動再加一筆">＋ 加一筆</button>
  </div>`;

  events.forEach((ev, i) => {
    html += _renderAiCard(ev, i, rootType, subTypes, fields);
  });
  container.innerHTML = html;
  document.getElementById('ai_confirmBtn').style.display = '';
  document.getElementById('ai_confirmBtn').innerText = `💾 批量建立 (${events.length})`;
}

function _renderAiCard(ev, i, rootType, subTypes, fields) {
  const color = (rootType && rootType.color) || '#667eea';
  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(ev.date);
  const fieldsHtml = fields.map(f => _renderFieldInput(f, (ev.values || {})[f.fieldId] || '')).join('');
  const subTypeOpts = subTypes.map(s =>
    `<option value="${s.typeId}" ${s.typeId === ev.subTypeId ? 'selected' : ''}>${s.icon || ''} ${s['名稱']}</option>`
  ).join('');
  const rootName = rootType ? rootType['名稱'] : '';
  const rootIcon = rootType ? (rootType.icon || '') : '';

  return `<div class="card mb-2 ai-event-card" data-aiidx="${i}" style="border-left: 4px solid ${color};">
    <div class="card-body py-2 px-3">
      <div class="d-flex align-items-center mb-2">
        <span class="badge bg-secondary me-2">#${i+1}</span>
        <strong style="color:${color}">${rootIcon} ${escapeHtml(rootName)}</strong>
        ${dateValid ? '' : '<span class="badge bg-warning text-dark ms-2">⚠ 日期格式有問題</span>'}
        <button class="btn btn-sm btn-outline-danger ms-auto" onclick="removeAiEventCard(${i})" title="從清單移除此筆">✕ 移除</button>
      </div>
      <div class="row g-2 mb-2">
        <div class="col-md-${subTypes.length > 0 ? '4' : '6'}">
          <label class="form-label small mb-1 fw-bold">📅 日期</label>
          <input type="date" class="form-control form-control-sm ai-date" value="${escapeAttr(ev.date)}">
        </div>
        ${subTypes.length > 0 ? `
        <div class="col-md-4">
          <label class="form-label small mb-1 fw-bold">📂 子類型</label>
          <select class="form-select form-select-sm ai-subtype">
            ${subTypeOpts}
          </select>
        </div>` : ''}
        <div class="col-md-${subTypes.length > 0 ? '4' : '6'}">
          <label class="form-label small mb-1 fw-bold">🏷️ 行程標題（選填）</label>
          <input type="text" class="form-control form-control-sm ai-title" value="${escapeAttr(ev.title || '')}" placeholder="留空 = 自動取第一個欄位">
        </div>
      </div>
      <div class="ai-card-fields">
        ${fieldsHtml}
      </div>
    </div>
  </div>`;
}

function removeAiEventCard(idx) {
  if (!_aiParseResult || !_aiParseResult.events) return;
  _syncAiEventsFromDom(); // 先把現在 DOM 上的所有編輯寫回，避免其他卡片的修改遺失
  _aiParseResult.events.splice(idx, 1);
  renderAiPreview(_aiParseResult);
}

function addAiEventCard() {
  if (!_aiParseResult || !_aiParseResult.events) return;
  _syncAiEventsFromDom();
  const subTypes = _types.flat.filter(t => t.parentTypeId === _aiParseResult.rootTypeId);
  _aiParseResult.events.push({
    date: new Date().toISOString().substring(0, 10),
    subTypeId: subTypes[0] ? subTypes[0].typeId : '',
    subTypeName: subTypes[0] ? subTypes[0]['名稱'] : '',
    title: '',
    values: {}
  });
  renderAiPreview(_aiParseResult);
}

// 把所有卡片目前 DOM 上的值寫回 _aiParseResult.events
function _syncAiEventsFromDom() {
  if (!_aiParseResult) return;
  const cards = document.querySelectorAll('#ai_resultPreview .ai-event-card');
  cards.forEach(card => {
    const idx = parseInt(card.dataset.aiidx);
    if (isNaN(idx) || !_aiParseResult.events[idx]) return;
    const ev = _aiParseResult.events[idx];
    ev.date = card.querySelector('.ai-date').value;
    ev.title = card.querySelector('.ai-title').value;
    const sub = card.querySelector('.ai-subtype');
    if (sub) {
      ev.subTypeId = sub.value;
      ev.subTypeName = sub.options[sub.selectedIndex] ? sub.options[sub.selectedIndex].text : '';
    }
    ev.values = {};
    const fields = _fieldsByType[_aiParseResult.rootTypeId] || [];
    card.querySelectorAll('.ai-card-fields [data-fid]').forEach(el => {
      const fid = el.dataset.fid;
      const field = fields.find(item => String(item.fieldId) === String(fid));
      let val;
      if (el.dataset.multi === '1') {
        val = Array.from(el.querySelectorAll('input[type="checkbox"]:checked')).map(c => c.value).join(',');
      } else {
        val = el.value;
      }
      val = formatCalendarFieldValue(field && field['顯示名稱'], val);
      if (val) ev.values[fid] = val;
    });
  });
}

async function confirmAiBatchAdd() {
  if (!_aiParseResult || !_aiParseResult.events) return;
  _syncAiEventsFromDom();

  const fields = _fieldsByType[_aiParseResult.rootTypeId] || [];
  const requiredFids = fields.filter(f => f.required).map(f => f.fieldId);

  const errors = [];
  const payload = [];
  _aiParseResult.events.forEach((ev, i) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ev.date)) { errors.push(`第 ${i+1} 筆：日期格式錯`); return; }
    const typeId = ev.subTypeId || _aiParseResult.rootTypeId;
    const miss = requiredFids.filter(fid => !ev.values || !ev.values[fid]);
    if (miss.length > 0) {
      const names = miss.map(fid => {
        const f = fields.find(x => x.fieldId === fid);
        return f ? f['顯示名稱'] : fid;
      }).join('、');
      errors.push(`第 ${i+1} 筆：必填欄位「${names}」未填`);
      return;
    }
    payload.push({ typeId, date: ev.date, title: ev.title || '', values: ev.values || {} });
  });

  if (payload.length === 0) {
    alert('❌ 沒有有效事項可建立\n\n' + errors.join('\n'));
    return;
  }
  if (errors.length > 0) {
    if (!confirm(`⚠️ 有 ${errors.length} 筆有問題，將被跳過：\n\n${errors.join('\n')}\n\n仍要建立其他 ${payload.length} 筆嗎？`)) return;
  }

  try {
    const res = await callAPI('cal_addEventsBatch', { events: payload });
    if (!res.success) throw new Error(res.message);
    alert(`✅ ${res.message}`);
    clearEventsCache();
    bootstrap.Modal.getOrCreateInstance(document.getElementById('aiModal')).hide();
    const view = _calendar.view;
    loadEventsForRange(view.activeStart.toISOString().substring(0,10), view.activeEnd.toISOString().substring(0,10));
  } catch (err) {
    alert('❌ ' + err.message);
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

// ═════════════════════════════════════════════════════════════
// 📤 Excel 上傳 → 預覽 → 建立
// ═════════════════════════════════════════════════════════════
let _excelImportRows = null; // [{typeId, date, title, values, errors}]

async function handleExcelUpload(ev) {
  const file = ev.target.files[0];
  if (!file) return;

  try {
    await ensureXLSXReady();
    const data = await file.arrayBuffer();
    const wb = XLSX.read(data);
    const sheetName = wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
    ev.target.value = ''; // reset，方便重傳同一檔

    if (rows.length === 0) { alert('Excel 沒有資料'); return; }

    // 找對應類型（sheet 名稱可能是頂層或子類型）
    const matchedType = _types.flat.find(t => t['名稱'] === sheetName);
    if (!matchedType) {
      alert(`❌ 找不到對應的類型「${sheetName}」\n請確認 Excel sheet 名稱與某個類型（頂層或子類型）完全相符\n（建議使用「欄位管理」→「匯出模板」下載的範本）`);
      return;
    }
    const isSubTypeSheet = !!matchedType.parentTypeId;
    const rootType = isSubTypeSheet
      ? _types.flat.find(t => t.typeId === matchedType.parentTypeId)
      : matchedType;

    // 用「sheet 對應的那個類型」拉有效欄位（會自動包含繼承+專屬-排除）
    let fields;
    if (_fieldsByType[matchedType.typeId]) fields = _fieldsByType[matchedType.typeId];
    else {
      const res = await callAPI('cal_getFields', { typeId: matchedType.typeId });
      if (!res.success) throw new Error(res.message);
      fields = res.data.fields;
      _fieldsByType[matchedType.typeId] = fields;
    }
    // 子類型對應（只有頂層 sheet 才需要看「子類型」欄）
    const subTypesByName = {};
    if (!isSubTypeSheet) {
      _types.flat.filter(t => t.parentTypeId === rootType.typeId).forEach(t => subTypesByName[t['名稱']] = t.typeId);
    }

    // 欄位名 → fieldId
    const fieldByName = {};
    fields.forEach(f => fieldByName[f['顯示名稱']] = f);
    const requiredFieldNames = fields.filter(f => f.required).map(f => f['顯示名稱']);

    // 逐列轉換
    _excelImportRows = rows.map((row, idx) => {
      const errors = [];
      // 日期
      let date = row['日期'] || row['date'];
      if (date instanceof Date) {
        date = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
      } else if (typeof date === 'number') {
        // Excel 序列日期
        const d = XLSX.SSF.parse_date_code(date);
        if (d) date = `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
      } else {
        date = String(date || '').trim();
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.push('日期格式錯');

      // 子類型
      let typeId;
      let subTypeName = '';
      if (isSubTypeSheet) {
        // 子類型 sheet：所有列都用該子類型
        typeId = matchedType.typeId;
        subTypeName = matchedType['名稱'];
      } else {
        // 頂層 sheet：每列「子類型」欄決定
        typeId = rootType.typeId;
        subTypeName = String(row['子類型'] || '').trim();
        if (subTypeName) {
          if (subTypesByName[subTypeName]) typeId = subTypesByName[subTypeName];
          else if (Object.keys(subTypesByName).length > 0) errors.push(`子類型「${subTypeName}」不存在`);
        }
      }

      // 標題（新版用「行程標題」，舊版相容「顯示標題」/「標題」）
      const title = String(row['行程標題'] || row['顯示標題'] || row['標題'] || '').trim();

      // 欄位值
      const values = {};
      Object.entries(row).forEach(([col, v]) => {
        if (['日期', 'date', '子類型', '行程標題', '顯示標題', '標題'].indexOf(col) !== -1) return;
        const f = fieldByName[col];
        if (f && v !== '' && v !== null && v !== undefined) {
          let val = (v instanceof Date) ? v.toISOString().substring(0,10) : String(v);
          val = formatCalendarFieldValue(col, val);
          values[f.fieldId] = val;
        }
      });

      // 必填檢查
      requiredFieldNames.forEach(fn => {
        const f = fieldByName[fn];
        if (f && !values[f.fieldId]) errors.push(`欠必填「${fn}」`);
      });

      return { idx: idx + 2, typeId, date, title, values, errors, subTypeName };
    });

    renderExcelPreview(matchedType, isSubTypeSheet);
    bootstrap.Modal.getOrCreateInstance(document.getElementById('excelPreviewModal')).show();
  } catch (err) {
    alert('❌ Excel 解析失敗：' + err.message);
  }
}

function renderExcelPreview(matchedType, isSubTypeSheet) {
  const ok = _excelImportRows.filter(r => r.errors.length === 0).length;
  const bad = _excelImportRows.length - ok;
  document.getElementById('excelPreviewSummary').innerText = `共 ${_excelImportRows.length} 列：可建立 ${ok}，問題 ${bad}`;
  const typeBadge = isSubTypeSheet
    ? `<b>${escapeHtml(matchedType['名稱'])}</b> <span class="badge bg-info">子類型專用</span>`
    : `<b>${escapeHtml(matchedType['名稱'])}</b> <span class="badge bg-secondary">頂層（每列依「子類型」欄分配）</span>`;
  let html = `<div class="alert alert-info py-2 mb-2">📂 對應類型：${typeBadge}　🟢 可建立 ${ok} 筆，🟡 問題 ${bad} 筆（有問題的列不會建立）</div>`;
  html += '<div class="table-responsive"><table class="table table-sm table-bordered"><thead class="table-light"><tr>';
  html += '<th>Excel 列</th><th>日期</th><th>子類型</th><th>標題</th><th>欄位值（前 3 個）</th><th>檢查</th></tr></thead><tbody>';
  _excelImportRows.forEach(r => {
    const valuesPreview = Object.entries(r.values).slice(0, 3)
      .map(([fid, v]) => escapeHtml(String(v).substring(0,30))).join(' / ');
    const cls = r.errors.length > 0 ? 'table-warning' : '';
    const errs = r.errors.length > 0
      ? `<span class="text-danger small">⚠ ${r.errors.join('，')}</span>`
      : '<span class="text-success small">✓</span>';
    html += `<tr class="${cls}">
      <td class="text-center">${r.idx}</td>
      <td>${escapeHtml(r.date)}</td>
      <td>${escapeHtml(r.subTypeName || '(root)')}</td>
      <td>${escapeHtml(r.title)}</td>
      <td><small>${valuesPreview}</small></td>
      <td>${errs}</td>
    </tr>`;
  });
  html += '</tbody></table></div>';
  document.getElementById('excelPreviewBody').innerHTML = html;
  document.getElementById('excelConfirmBtn').disabled = ok === 0;
}

async function confirmExcelImport() {
  if (!_excelImportRows) return;
  const events = _excelImportRows
    .filter(r => r.errors.length === 0)
    .map(r => ({ typeId: r.typeId, date: r.date, title: r.title, values: r.values }));
  if (events.length === 0) { alert('沒有可建立的列'); return; }

  try {
    const res = await callAPI('cal_addEventsBatch', { events });
    if (!res.success) throw new Error(res.message);
    alert(`✅ ${res.message}`);
    clearEventsCache();
    bootstrap.Modal.getOrCreateInstance(document.getElementById('excelPreviewModal')).hide();
    const view = _calendar.view;
    loadEventsForRange(view.activeStart.toISOString().substring(0,10), view.activeEnd.toISOString().substring(0,10));
  } catch (err) {
    alert('❌ ' + err.message);
  }
}

// ─────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function escapeAttr(s) {
  return String(s == null ? '' : s).replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

async function downloadSermonTemplate(typeName) {
  // 關閉 Modal
  const modalEl = document.getElementById('sermonTemplateModal');
  if (modalEl) {
    bootstrap.Modal.getOrCreateInstance(modalEl).hide();
  }

  await ensureXLSXReady();

  // 找對應類型
  if (!_types || !_types.flat) {
    alert('正在載入類型資料，請稍候重試');
    return;
  }
  const matchedType = _types.flat.find(t => t['名稱'] === typeName);
  if (!matchedType) {
    alert(`找不到「${typeName}」類型，請確認系統中是否存在。`);
    return;
  }

  // 取得欄位
  let fields;
  if (_fieldsByType[matchedType.typeId]) {
    fields = _fieldsByType[matchedType.typeId];
  } else {
    try {
      const res = await callAPI('cal_getFields', { typeId: matchedType.typeId });
      if (!res.success) throw new Error(res.message);
      fields = res.data.fields;
      _fieldsByType[matchedType.typeId] = fields;
    } catch (err) {
      alert(`欄位載入失敗：${err.message}`);
      return;
    }
  }

  // 構造 Sheet 1: 資料填寫
  const headers = ['日期', '行程標題'].concat(fields.map(f => f['顯示名稱']));
  
  const fieldExample = f => {
    if (f['顯示名稱'] === '講員') return '張三牧師';
    if (f['顯示名稱'] === '講題') return '和平的福音';
    if (f['顯示名稱'] === '經文') return '約翰福音 3:16';
    if (f['顯示名稱'] === '宣召') return '詩篇 23:1-6';
    if (f['顯示名稱'] === '金句') return '神愛世人...';
    if (f['顯示名稱'] === '啟應文') return '第 3 篇';
    if (f['顯示名稱'] === '詩歌') return '讚美詩 101 首';
    if (f['顯示名稱'] === '備註') return '無';
    return f.required ? '（必填）' : '（選填）';
  };
  
  const exampleRow = ['2026-06-07', '（留空 = 自動取第一個欄位的值）', ...fields.map(fieldExample)];
  
  const dataSheet = XLSX.utils.aoa_to_sheet([headers, exampleRow]);
  dataSheet['!cols'] = headers.map(h => ({ wch: Math.max(12, h.length * 2 + 2) }));

  // Sheet 2: 使用說明
  const instructions = [
    [`📖 教會行事曆 - ${typeName}講道匯入模板使用說明`],
    [''],
    ['【填寫規則】'],
    ['1. 「資料填寫」分頁的第 1 列為欄位標題，請勿修改其內容或順序'],
    ['2. 第 2 列是範例，填寫前請先將其刪除'],
    ['3. 從第 2 列起填入您的講道排程，每列代表一次聚會'],
    ['4. 日期格式：YYYY-MM-DD（例 2026-06-07）；或直接設為 Excel 的日期格式'],
    [''],
    ['【欄位說明】'],
    ['欄位名稱', '型別', '是否必填', '說明'],
    ['日期', 'date', '必填', '講道日期（如：2026-06-07）'],
    ['行程標題', 'text', '選填', '月曆上顯示的文字；留空 = 自動取第一個欄位（講題）的值']
  ];
  
  fields.forEach(f => {
    instructions.push([
      f['顯示名稱'], f['欄位類型'], f.required ? '必填' : '選填', ''
    ]);
  });

  const guideSheet = XLSX.utils.aoa_to_sheet(instructions);
  guideSheet['!cols'] = [{wch:20},{wch:12},{wch:10},{wch:50}];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, dataSheet, typeName); // Sheet 名稱為 "台語" / "華語" / "聯合"
  XLSX.utils.book_append_sheet(wb, guideSheet, '使用說明');

  const fileName = `講道資訊模板_${typeName}_${new Date().toISOString().substring(0,10)}.xlsx`;
  XLSX.writeFile(wb, fileName);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { formatCalendarFieldValue, formatCalendarEventValues };
}
