(function () {
  'use strict';

  var state = {
    types: [],
    rootTypes: [],
    allTypes: [],
    currentType: null,
    events: [],
    range: { start: '', end: '', preset: 'thisMonth' },
    requestId: 0,
    loading: false,
    hasLoaded: false
  };

  var el = {};

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    [
      'categoryRootSelect', 'categoryChildSelect', 'errorPanel', 'emptyPanel', 'dashboardContent',
      'rangePreset', 'rangeStart', 'rangeEnd', 'applyRangeButton', 'rangeSummary',
      'quarterYear',
      'categoryIcon', 'categoryName', 'categoryPath', 'loadingPanel',
      'categoryData', 'scheduleTable', 'scheduleHead', 'scheduleBody', 'scheduleEmpty',
      'scheduleMeta', 'dataFootnote', 'exportButton',
      'toastMessage'
    ].forEach(function (id) { el[id] = document.getElementById(id); });
    el.quarterButtons = Array.prototype.slice.call(document.querySelectorAll('[data-quarter]'));
    el.quarterYear.textContent = String(parseDate(todayKey()).getFullYear());
    el.quarterButtons.forEach(function (button) {
      button.addEventListener('click', function () {
        setPresetRange('q' + button.getAttribute('data-quarter'), true);
      });
    });
    window.addEventListener('resize', function () {
      if (state.hasLoaded) window.requestAnimationFrame(alignScheduleItems);
    });

    el.categoryRootSelect.addEventListener('change', function () {
      var rootId = el.categoryRootSelect.value;
      var selected = state.rootTypes.find(function (type) { return type.typeId === rootId; });
      if (selected) selectCategory(selected);
    });
    el.categoryChildSelect.addEventListener('change', function () {
      var selected = el.categoryChildSelect.value === '__all__'
        ? state.rootTypes.find(function (type) { return type.typeId === el.categoryRootSelect.value; })
        : state.types.find(function (type) { return type.typeId === el.categoryChildSelect.value; });
      if (selected) selectCategory(selected);
    });
    el.exportButton.addEventListener('click', exportSelectedCategory);
    el.rangePreset.addEventListener('change', function () {
      if (el.rangePreset.value !== 'custom') setPresetRange(el.rangePreset.value, true);
    });
    el.rangeStart.addEventListener('change', markCustomRange);
    el.rangeEnd.addEventListener('change', markCustomRange);
    el.applyRangeButton.addEventListener('click', applyCustomRange);
    initializeRange();
    loadTypes();
  }

  function selectCategory(type) {
    var inputStart = el.rangeStart.value;
    var inputEnd = el.rangeEnd.value;
    if (inputStart !== state.range.start || inputEnd !== state.range.end) {
      if (!isDateKey(inputStart) || !isDateKey(inputEnd) || inputStart > inputEnd) {
        showError('請先選擇有效的開始日期與結束日期。');
        if (state.currentType) syncCategorySelectors(state.currentType);
        return;
      }
      state.range = { start: inputStart, end: inputEnd, preset: 'custom' };
      el.rangePreset.value = 'custom';
      updateQuarterButtons('custom');
      updateRangeSummary();
    }
    loadCategory(type);
  }

  async function callAPI(action, data) {
    if (window.CalendarSupabaseService && typeof window.CalendarSupabaseService[action] === 'function') {
      return window.CalendarSupabaseService[action](data || {});
    }
    if (typeof window.churchAPI !== 'function') {
      throw new Error('行事曆 API 尚未載入，請重新整理後再試。');
    }
    return window.churchAPI(action, data || {});
  }

  function initializeRange() {
    var params = new URLSearchParams(window.location.search);
    var start = params.get('from') || '';
    var end = params.get('to') || '';
    if (!isDateKey(start) || !isDateKey(end) || start > end) {
      try {
        start = window.localStorage.getItem('calendarDashboardRangeStart') || '';
        end = window.localStorage.getItem('calendarDashboardRangeEnd') || '';
      } catch (e) {}
    }
    if (isDateKey(start) && isDateKey(end) && start <= end) {
      state.range = { start: start, end: end, preset: 'custom' };
      el.rangePreset.value = 'custom';
      el.rangeStart.value = start;
      el.rangeEnd.value = end;
      updateRangeSummary();
    } else {
      setPresetRange('thisMonth', false);
    }
  }

  function setPresetRange(preset, shouldLoad) {
    var today = parseDate(todayKey());
    var start = new Date(today);
    var end = new Date(today);
    if (preset === 'last30' || preset === 'last90') {
      start.setDate(start.getDate() - (preset === 'last30' ? 29 : 89));
    } else if (preset === 'thisYear') {
      start = new Date(today.getFullYear(), 0, 1);
      end = new Date(today.getFullYear(), 11, 31);
    } else if (/^q[1-4]$/.test(preset)) {
      var quarterStartMonth = (Number(preset.slice(1)) - 1) * 3;
      start = new Date(today.getFullYear(), quarterStartMonth, 1);
      end = new Date(today.getFullYear(), quarterStartMonth + 3, 0);
    } else {
      preset = 'thisMonth';
      start = new Date(today.getFullYear(), today.getMonth(), 1);
      end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    }
    state.range = { start: dateKey(start), end: dateKey(end), preset: preset };
    el.rangePreset.value = preset;
    updateQuarterButtons(preset);
    el.rangeStart.value = state.range.start;
    el.rangeEnd.value = state.range.end;
    updateRangeSummary();
    if (shouldLoad && state.currentType) {
      rememberCategory(state.currentType.typeId);
      loadCategory(state.currentType);
    }
  }

  function markCustomRange() {
    el.rangePreset.value = 'custom';
    state.range.preset = 'custom';
    updateQuarterButtons('custom');
    el.rangeSummary.textContent = '日期已變更，請套用範圍';
  }

  function updateQuarterButtons(preset) {
    el.quarterButtons.forEach(function (button) {
      var selected = preset === 'q' + button.getAttribute('data-quarter');
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
  }

  function applyCustomRange() {
    var start = el.rangeStart.value;
    var end = el.rangeEnd.value;
    if (!isDateKey(start) || !isDateKey(end)) {
      showError('請選擇開始日期與結束日期。');
      return;
    }
    if (start > end) {
      showError('開始日期不能晚於結束日期。');
      return;
    }
    state.range = { start: start, end: end, preset: 'custom' };
    showError('');
    updateQuarterButtons('custom');
    updateRangeSummary();
    if (state.currentType) {
      rememberCategory(state.currentType.typeId);
      loadCategory(state.currentType);
    }
  }

  function updateRangeSummary() {
    el.rangeSummary.textContent = formatDate(state.range.start) + ' — ' + formatDate(state.range.end);
  }

  async function loadTypes() {
    showError('');
    el.categoryRootSelect.disabled = true;
    el.categoryChildSelect.disabled = true;
    el.categoryRootSelect.innerHTML = '<option value="">載入類別中…</option>';
    el.categoryChildSelect.innerHTML = '<option value="">請先選主類別</option>';
    try {
      var response = await callAPI('cal_getTypes');
      if (!response || !response.success) throw new Error((response && response.message) || '無法載入類別。');
      var typeData = response.data || {};
      var flat = Array.isArray(typeData.flat) ? typeData.flat : [];
      state.allTypes = flat;
      state.rootTypes = sortCategories(flat.filter(function (type) { return !type.parentTypeId; }));
      state.types = sortCategories(flat.filter(function (type) {
        return !flat.some(function (child) { return child.parentTypeId === type.typeId; });
      }));
      if (state.types.length === 0 || state.rootTypes.length === 0) {
        el.dashboardContent.hidden = true;
        el.emptyPanel.hidden = false;
        return;
      }

      populateRootCategorySelect();
      el.dashboardContent.hidden = false;
      el.categoryRootSelect.disabled = false;
      var requestedId = new URLSearchParams(window.location.search).get('type');
      var savedId = '';
      try { savedId = window.localStorage.getItem('calendarDashboardTypeId') || ''; } catch (e) {}
      var initialType = state.allTypes.find(function (type) { return type.typeId === requestedId; })
        || state.allTypes.find(function (type) { return type.typeId === savedId; })
        || state.rootTypes[0];
      updateRangeSummary();
      await loadCategory(initialType);
    } catch (error) {
      showError(error.message || '載入類別時發生錯誤。');
      el.categoryRootSelect.innerHTML = '<option value="">無法載入類別</option>';
      el.categoryChildSelect.innerHTML = '<option value="">無法載入類別</option>';
    }
  }

  function sortCategories(types) {
    return types.slice().sort(function (a, b) {
      var orderA = Number(a.sortOrder);
      var orderB = Number(b.sortOrder);
      if (Number.isFinite(orderA) && Number.isFinite(orderB) && orderA !== orderB) return orderA - orderB;
      return String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hant');
    });
  }

  function populateRootCategorySelect() {
    el.categoryRootSelect.replaceChildren();
    state.rootTypes.forEach(function (type) {
      var option = document.createElement('option');
      option.value = type.typeId;
      option.textContent = type.name || '未命名類別';
      el.categoryRootSelect.appendChild(option);
    });
  }

  function syncCategorySelectors(type) {
    var rootId = type.parentTypeId || type.typeId;
    var children = state.types.filter(function (candidate) { return candidate.parentTypeId === rootId; });
    el.categoryRootSelect.value = rootId;
    el.categoryChildSelect.replaceChildren();
    if (children.length > 0) {
      var allOption = document.createElement('option');
      allOption.value = '__all__';
      allOption.textContent = '全部（含子類別）';
      el.categoryChildSelect.appendChild(allOption);
      children.forEach(function (child) {
        var option = document.createElement('option');
        option.value = child.typeId;
        option.textContent = child.name || '未命名子類別';
        el.categoryChildSelect.appendChild(option);
      });
      el.categoryChildSelect.disabled = false;
      el.categoryChildSelect.value = type.parentTypeId ? type.typeId : '__all__';
    } else {
      var option = document.createElement('option');
      option.value = type.typeId;
      option.textContent = '此類別沒有子類別';
      el.categoryChildSelect.appendChild(option);
      el.categoryChildSelect.value = type.typeId;
      el.categoryChildSelect.disabled = true;
    }
  }

  async function loadCategory(type) {
    var requestId = ++state.requestId;
    state.currentType = type;
    state.events = [];
    state.loading = true;
    state.hasLoaded = false;
    syncCategorySelectors(type);
    el.dashboardContent.hidden = false;
    el.emptyPanel.hidden = true;
    el.categoryData.hidden = true;
    el.loadingPanel.hidden = false;
    el.exportButton.disabled = true;
    showError('');
    rememberCategory(type.typeId);
    renderCategoryHeader(type);

    try {
      var selectedTypeIds = type.parentTypeId ? [type.typeId] : [type.typeId].concat(
        state.types.filter(function (child) { return child.parentTypeId === type.typeId; })
          .map(function (child) { return child.typeId; })
      );
      var selectedTypeIdSet = new Set(selectedTypeIds.map(String));
      var response = await callAPI('cal_getEvents', {
        typeIds: selectedTypeIds,
        startDate: state.range.start,
        endDate: state.range.end
      });
      if (requestId !== state.requestId) return;
      if (!response || !response.success) throw new Error((response && response.message) || '無法載入活動資料。');
      var records = Array.isArray(response.data) ? response.data : [];
      state.events = records.filter(function (event) {
        var date = eventDate(event);
        return selectedTypeIdSet.has(String(event.typeId || ''))
          && date >= state.range.start && date <= state.range.end;
      }).sort(function (a, b) { return eventDate(a).localeCompare(eventDate(b)); });
      state.loading = false;
      state.hasLoaded = true;
      el.loadingPanel.hidden = true;
      el.categoryData.hidden = false;
      el.exportButton.disabled = false;
      renderSchedule(type, state.events);
    } catch (error) {
      if (requestId !== state.requestId) return;
      state.loading = false;
      state.hasLoaded = false;
      el.loadingPanel.hidden = true;
      el.categoryData.hidden = true;
      el.exportButton.disabled = true;
      showError(error.message || '載入活動時發生錯誤。');
    }
  }

  function renderCategoryHeader(type) {
    var color = safeColor(type.color);
    var icon = type.icon || '◷';
    var root = type.parentTypeId && state.allTypes.find(function (candidate) {
      return candidate.typeId === type.parentTypeId;
    });
    var childCount = type.parentTypeId ? 0 : state.types.filter(function (candidate) {
      return candidate.parentTypeId === type.typeId;
    }).length;
    el.categoryIcon.textContent = icon;
    el.categoryIcon.style.color = color;
    el.categoryIcon.style.backgroundColor = color + '18';
    el.categoryIcon.style.borderColor = color + '30';
    el.categoryName.textContent = type.name || '未命名類別';
    el.categoryPath.textContent = root
      ? (root.name || '') + '  /  ' + (type.name || '')
      : (childCount ? '彙整全部 ' + childCount + ' 個子類別' : '此主類別沒有子類別');
    document.documentElement.style.setProperty('--brand', color);
    document.documentElement.style.setProperty('--brand-dark', shadeColor(color, -12));
  }

  function buildScheduleData(events) {
    var grouped = new Map();
    var fieldNames = [];
    var fieldSet = new Set();

    events.forEach(function (event) {
      var date = eventDate(event);
      if (!isDateKey(date)) return;
      if (!grouped.has(date)) grouped.set(date, []);
      grouped.get(date).push(event);
      eventValues(event).forEach(function (field) {
        var name = String(field.fieldName || field.name || '').trim();
        if (name && !fieldSet.has(name)) {
          fieldSet.add(name);
          fieldNames.push(name);
        }
      });
    });

    var dates = Array.from(grouped.keys()).sort().map(function (date) {
      return { date: date, events: grouped.get(date) };
    });
    return {
      fieldNames: fieldNames,
      dates: dates,
      eventCount: dates.reduce(function (total, group) { return total + group.events.length; }, 0)
    };
  }

  function renderSchedule(type, events) {
    var schedule = buildScheduleData(events);
    var showSubcategory = hasSubcategories(type);
    el.scheduleHead.replaceChildren();
    el.scheduleBody.replaceChildren();

    var headerRow = document.createElement('tr');
    var columns = [{ label: '日期', className: 'schedule-date-column' }];
    if (showSubcategory) columns.push({ label: '子類別', className: 'schedule-subcategory-column' });
    columns.push({ label: '行程', className: 'schedule-title-column' });
    schedule.fieldNames.forEach(function (fieldName) {
      columns.push({ label: fieldName, className: '' });
    });
    columns.forEach(function (column) {
      var header = document.createElement('th');
      header.scope = 'col';
      header.className = column.className;
      header.textContent = column.label;
      headerRow.appendChild(header);
    });
    el.scheduleHead.appendChild(headerRow);

    schedule.dates.forEach(function (group) {
      var row = document.createElement('tr');
      var dateCell = document.createElement('td');
      dateCell.className = 'schedule-date-cell schedule-date-column';
      var date = document.createElement('strong');
      date.className = 'schedule-date-main';
      date.textContent = formatDate(group.date);
      var weekday = document.createElement('span');
      weekday.className = 'schedule-date-weekday';
      weekday.textContent = weekdayLabel(group.date);
      dateCell.append(date, weekday);
      row.appendChild(dateCell);

      if (showSubcategory) {
        var subcategoryCell = document.createElement('td');
        subcategoryCell.className = 'schedule-field-values schedule-subcategory-column';
        group.events.forEach(function (event) {
          var item = document.createElement('div');
          var subcategory = eventSubcategoryLabel(event, type);
          item.className = 'schedule-field-item' + (subcategory ? '' : ' is-empty');
          item.textContent = subcategory;
          subcategoryCell.appendChild(item);
        });
        row.appendChild(subcategoryCell);
      }

      var titleCell = document.createElement('td');
      titleCell.className = 'schedule-list-cell schedule-title-column';
      group.events.forEach(function (event) {
        var title = document.createElement('div');
        title.className = 'schedule-list-item';
        title.textContent = eventTitle(event);
        titleCell.appendChild(title);
      });
      row.appendChild(titleCell);

      schedule.fieldNames.forEach(function (fieldName) {
        var cell = document.createElement('td');
        cell.className = 'schedule-field-values';
        var values = fieldValuesForEvents(group.events, fieldName);
        values.forEach(function (value) {
          var item = document.createElement('div');
          item.className = 'schedule-field-item' + (value ? '' : ' is-empty');
          item.textContent = value;
          cell.appendChild(item);
        });
        row.appendChild(cell);
      });
      el.scheduleBody.appendChild(row);
    });

    alignScheduleItems();
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () {
        if (state.hasLoaded) alignScheduleItems();
      });
    }
    el.scheduleEmpty.hidden = schedule.dates.length > 0;
    el.scheduleTable.hidden = schedule.dates.length === 0;
    el.scheduleMeta.textContent = formatNumber(schedule.dates.length) + ' 個日期 · '
      + formatNumber(schedule.eventCount) + ' 筆行程';
    el.dataFootnote.textContent = categoryLabel(type) + ' · ' + formatDate(state.range.start)
      + ' 至 ' + formatDate(state.range.end);
  }

  function alignScheduleItems() {
    var rows = Array.prototype.slice.call(el.scheduleBody.rows);
    rows.forEach(function (row) {
      Array.prototype.forEach.call(row.querySelectorAll('.schedule-list-item, .schedule-field-item'), function (item) {
        item.style.minHeight = '';
      });
    });

    var rowHeights = rows.map(function (row) {
      var cells = Array.prototype.slice.call(row.cells, 1);
      var itemCount = cells.length ? cells[0].children.length : 0;
      var heights = [];
      for (var index = 0; index < itemCount; index++) {
        heights[index] = cells.reduce(function (maximum, cell) {
          var item = cell.children[index];
          return item ? Math.max(maximum, item.getBoundingClientRect().height) : maximum;
        }, 0);
      }
      return { cells: cells, heights: heights };
    });

    rowHeights.forEach(function (row) {
      row.cells.forEach(function (cell) {
        row.heights.forEach(function (height, index) {
          if (cell.children[index]) cell.children[index].style.minHeight = Math.ceil(height) + 'px';
        });
      });
    });
  }

  function eventTitle(event) {
    return String(event.title || event.name || event.typeName || '未命名行程');
  }

  function fieldValuesForEvents(events, fieldName) {
    return events.map(function (event) {
      return fieldValueForEvent(event, fieldName);
    });
  }

  function fieldValueForEvent(event, fieldName) {
    return eventValues(event).map(function (field) {
      var name = String(field.fieldName || field.name || '').trim();
      return name === fieldName ? displayFieldValue(field.value) : '';
    }).filter(Boolean).join('、');
  }

  function displayFieldValue(value) {
    if (value == null) return '';
    if (Array.isArray(value)) {
      return value.map(displayFieldValue).filter(Boolean).join('、');
    }
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value).trim();
  }

  function weekdayLabel(dateKey) {
    var date = parseDate(dateKey);
    return date ? new Intl.DateTimeFormat('zh-TW', { weekday: 'short' }).format(date) : '';
  }

  function hasSubcategories(type) {
    return !!type && !type.parentTypeId && state.types.some(function (candidate) {
      return candidate.parentTypeId === type.typeId;
    });
  }

  async function exportSelectedCategory() {
    if (!state.currentType || state.loading || !state.hasLoaded) return;
    var selectedType = state.currentType;
    var selectedEvents = state.events.slice();
    var selectedRange = { start: state.range.start, end: state.range.end };
    var originalText = el.exportButton.innerHTML;
    el.exportButton.disabled = true;
    el.exportButton.textContent = '準備檔案…';
    try {
      var XLSX = await ensureXLSXReady();
      var schedule = buildScheduleData(selectedEvents);
      var showSubcategory = hasSubcategories(selectedType);
      var headers = ['日期', '星期'].concat(showSubcategory ? ['子類別'] : []).concat(['行程內容'], schedule.fieldNames);
      var columnWidths = [14, 10];
      if (showSubcategory) columnWidths.push(24);
      columnWidths.push(34);
      schedule.fieldNames.forEach(function (fieldName) {
        columnWidths.push(Math.max(14, String(fieldName).length * 2 + 4));
      });
      var rows = [headers];
      selectedEvents.forEach(function (event) {
        var date = eventDate(event);
        var row = [date, weekdayLabel(date)];
        if (showSubcategory) row.push(eventSubcategoryLabel(event, selectedType));
        row.push(eventTitle(event));
        rows.push(row.concat(schedule.fieldNames.map(function (name) { return fieldValueForEvent(event, name); })));
      });

      var sheet = XLSX.utils.aoa_to_sheet(rows);
      sheet['!cols'] = columnWidths.map(function (width) { return { wch: width }; });
      var workbook = XLSX.utils.book_new();
      var sheetName = safeSheetName(selectedType.name || '類別活動');
      XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
      var fileName = '行事曆_' + safeFileName(selectedType.name || '類別')
        + '_' + selectedRange.start + '_' + selectedRange.end + '.xlsx';
      XLSX.writeFile(workbook, fileName);
      showToast('已匯出「' + categoryLabel(selectedType) + '」的 ' + schedule.eventCount
        + ' 筆行程（每筆各一列）。');
    } catch (error) {
      showToast(error.message || 'XLSX 匯出失敗，請稍後再試。');
    } finally {
      el.exportButton.innerHTML = originalText;
      el.exportButton.disabled = state.loading || !state.hasLoaded;
    }
  }

  function eventValues(event) {
    var values = Array.isArray(event.values) ? event.values : (Array.isArray(event.fields) ? event.fields : []);
    if (values.length) return values;
    if (event.field_values && typeof event.field_values === 'object') {
      return Object.keys(event.field_values).map(function (name) {
        return { fieldName: name, value: event.field_values[name] };
      });
    }
    return [];
  }

  function ensureXLSXReady() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    return new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
      script.onload = function () { resolve(window.XLSX); };
      script.onerror = function () { reject(new Error('無法載入 XLSX 匯出元件，請確認網路後重試。')); };
      document.head.appendChild(script);
    });
  }

  function categoryLabel(type) {
    var root = type.parentTypeId && state.allTypes.find(function (candidate) {
      return candidate.typeId === type.parentTypeId;
    });
    return root ? (root.name || '') + ' / ' + (type.name || '') : (type.name || '未命名類別');
  }

  function eventSubcategoryLabel(event, fallbackType) {
    var eventType = state.allTypes.find(function (type) {
      return String(type.typeId) === String(event.typeId);
    });
    var selectedType = eventType || fallbackType;
    return selectedType && selectedType.parentTypeId ? selectedType.name || '' : '';
  }

  function eventDate(event) {
    return String(event.date || '').slice(0, 10);
  }

  function todayKey() {
    var parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date());
    var values = {};
    parts.forEach(function (part) { values[part.type] = part.value; });
    return values.year + '-' + values.month + '-' + values.day;
  }

  function dateKey(date) {
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
  }

  function isDateKey(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
    var parsed = parseDate(value);
    return !!parsed && dateKey(parsed) === value;
  }

  function formatDate(value) {
    var date = parseDate(value);
    return date ? new Intl.DateTimeFormat('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date) : '—';
  }

  function parseDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    var date = new Date(value + 'T00:00:00');
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function safeColor(value) {
    var color = String(value || '');
    if (/^#[0-9a-f]{3}$/i.test(color)) {
      return '#' + color.slice(1).split('').map(function (part) { return part + part; }).join('');
    }
    return /^#[0-9a-f]{6}$/i.test(color) ? color : '#6258d9';
  }

  function shadeColor(hex, amount) {
    var normalized = safeColor(hex);
    var number = parseInt(normalized.slice(1), 16);
    var red = Math.max(0, Math.min(255, (number >> 16) + amount));
    var green = Math.max(0, Math.min(255, ((number >> 8) & 255) + amount));
    var blue = Math.max(0, Math.min(255, (number & 255) + amount));
    return '#' + [red, green, blue].map(function (part) { return part.toString(16).padStart(2, '0'); }).join('');
  }

  function safeSheetName(value) {
    var name = String(value);
    ['\\', '/', '?', '*', '[', ']', ':'].forEach(function (character) {
      name = name.split(character).join(' ');
    });
    return name.trim().slice(0, 31) || '類別活動';
  }

  function safeFileName(value) {
    var name = String(value);
    ['\\', '/', ':', '*', '?', '"', '<', '>', '|'].forEach(function (character) {
      name = name.split(character).join('_');
    });
    return name.trim().slice(0, 80) || '類別';
  }

  function formatNumber(value) {
    return new Intl.NumberFormat('zh-TW').format(value);
  }

  function rememberCategory(typeId) {
    try { window.localStorage.setItem('calendarDashboardTypeId', typeId); } catch (e) {}
    try {
      window.localStorage.setItem('calendarDashboardRangeStart', state.range.start);
      window.localStorage.setItem('calendarDashboardRangeEnd', state.range.end);
    } catch (e) {}
    var url = new URL(window.location.href);
    url.searchParams.set('type', typeId);
    url.searchParams.set('from', state.range.start);
    url.searchParams.set('to', state.range.end);
    window.history.replaceState({}, '', url);
  }

  function showError(message) {
    el.errorPanel.hidden = !message;
    el.errorPanel.textContent = message || '';
  }

  function showToast(message) {
    el.toastMessage.textContent = message;
    el.toastMessage.classList.add('show');
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(function () {
      el.toastMessage.classList.remove('show');
    }, 3200);
  }
})();
