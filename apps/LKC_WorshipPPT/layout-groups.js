(function() {
  const production = window.TaiwaneseWorshipSlideProduction || window.PrayerSlideProduction;
  const layoutState = { groups: {}, pageAssignments: {}, hymnOpacityBySection: {}, outputScale: { text: 100, image: 100 } };
  const pendingSelection = new Set();
  const templateId = window.activeWorshipTemplateId || 'taiwanese';
  const templateProfile = window.activeWorshipTemplateProfile || {};
  const draftKey = window.worshipDraftKey || 'lkc-taiwanese-worship-draft';
  const cloudStore = window.TaiwaneseWorshipLayoutCloud.createLayoutCloudStore({
    templateId,
    fallbackTemplateId: templateProfile.layoutFallbackTemplateId,
    fallbackExcludedSectionIds: templateProfile.layoutFallbackExcludedSections
  });
  let liveParams = null;
  let activeLayoutTab = 'title';
  let layoutUnlocked = false;
  let cloudLayoutFound = false;
  let cloudLayoutLoadPromise = null;
  let layoutSyncPending = false;
  window.worshipLayoutState = layoutState;
  window.isWorshipLayoutUnlocked = () => layoutUnlocked;
  window.setWorshipLayoutUnlocked = val => { layoutUnlocked = Boolean(val); applyLayoutLockUI(); };

  const html = value => String(value == null ? '' : value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[character]));

  try {
    const draft = JSON.parse(localStorage.getItem(draftKey) || '{}');
    layoutSyncPending = draft.layoutSyncPending === true;
    if (draft.layoutState) {
      replaceLayoutState(draft.layoutState);
    }
  } catch (error) {
    console.warn('版面群組草稿讀取失敗', error);
  }

  function replaceLayoutState(nextState) {
    const normalized = window.TaiwaneseWorshipLayoutCloud.normalizeLayoutState(nextState);
    layoutState.groups = normalized.groups;
    layoutState.pageAssignments = normalized.pageAssignments;
    if (normalized.hymnOpacityBySection) {
      layoutState.hymnOpacityBySection = normalized.hymnOpacityBySection;
      Object.entries(normalized.hymnOpacityBySection).forEach(([sectionId, opacity]) => {
        if (model[sectionId]) model[sectionId].opacity = opacity;
      });
    }
    if (normalized.outputScale) {
      layoutState.outputScale = { text: 100, image: 100, ...normalized.outputScale };
    }
  }

  function captureHymnOpacity() {
    layoutState.hymnOpacityBySection = Object.fromEntries((window.hymnOpacitySectionIds || [])
      .filter(sectionId => model[sectionId])
      .map(sectionId => [sectionId, Math.max(40, Math.min(80, Number(model[sectionId].opacity) || 60))]));
  }

  function hasLayoutState() {
    return Object.keys(layoutState.groups).length > 0
      || Object.keys(layoutState.pageAssignments).length > 0
      || Object.keys(layoutState.hymnOpacityBySection || {}).length > 0
      || Number(layoutState.outputScale && layoutState.outputScale.text) !== 100
      || Number(layoutState.outputScale && layoutState.outputScale.image) !== 100;
  }

  function persistLocalLayoutState() {
    try {
      const draft = JSON.parse(localStorage.getItem(draftKey) || '{}');
      localStorage.setItem(draftKey, JSON.stringify({ ...draft, layoutState, layoutSyncPending }));
    } catch (error) {
      console.warn('版面群組保存失敗', error);
    }
  }

  async function persistLayoutState() {
    captureHymnOpacity();
    layoutSyncPending = true;
    persistLocalLayoutState();
    if (!layoutUnlocked) throw new Error('版面配置尚未解鎖');
    await cloudStore.save(layoutState);
    cloudLayoutFound = true;
    layoutSyncPending = false;
    persistLocalLayoutState();
  }

  function sectionDecks() {
    return sections.map(([sectionId, label]) => {
      const item = model[sectionId];
      const generatedPages = slidePages(item, sectionId);
      const pages = generatedPages.length ? generatedPages : [{ kind: 'section', body: '' }];
      const includeInExport = item ? item.includeInExport !== false : true;
      return {
        sectionId,
        label,
        includeInExport,
        pages: pages.map((page, index) => ({
          ...page,
          id: page.id || `${sectionId}:${index + 1}`,
          includeInExport
        }))
      };
    });
  }

  function deckEntries() {
    return production.buildDeckEntries(sectionDecks());
  }

  function currentDeckEntry() {
    return deckEntries().find(entry => entry.sectionId === active && entry.pageIndex === previewPage) || deckEntries()[0];
  }

  function selectedIds() {
    return Array.from(pendingSelection);
  }

  function currentSelectionKind() {
    const selected = selectedIds();
    const allEntries = deckEntries();
    if (selected.length > 0) {
      const match = allEntries.find(entry => selected.includes(entry.id));
      if (match) return match.kind;
    }
    const current = currentDeckEntry();
    return current ? current.kind : '';
  }

  function showDeckEntry(entry) {
    if (!entry) return;
    active = entry.sectionId;
    render();
    previewPage = entry.pageIndex;
    preview();
    updateDeckNavigator();
    const panel = document.getElementById('layout-floating-panel');
    if (panel && !panel.classList.contains('is-hidden') && !liveParams) {
      renderFloatingPanel();
      populateForm(canvasParams());
    }
  }

  window.navigateDeck = function(delta) {
    const deck = deckEntries();
    const current = currentDeckEntry();
    const index = Math.max(0, deck.findIndex(entry => entry.id === current.id));
    showDeckEntry(deck[Math.max(0, Math.min(deck.length - 1, index + delta))]);
  };

  function groupLabel(pageId) {
    const groupId = layoutState.pageAssignments[pageId];
    const group = groupId && layoutState.groups[groupId];
    return group ? (group.name || group.id) : '未分組';
  }

  function renderDeckNavigator() {
    const decks = sectionDecks();
    document.getElementById('flow-list').innerHTML = `<div class="deck-chapters">${decks.map((section, sectionIndex) => `
      <details class="deck-chapter" data-deck-section="${section.sectionId}" ${section.sectionId === active ? 'open' : ''}>
        <summary><input type="checkbox" data-layout-section="${section.sectionId}" aria-label="勾選 ${section.label} 全章" ${section.pages.every(page => pendingSelection.has(page.id)) ? 'checked' : ''}><span><b>${String(sectionIndex + 1).padStart(2, '0')}</b>${section.label}</span><small>${section.sectionId === 'car-notice' ? `<button type="button" class="deck-export-toggle" data-export-section="${section.sectionId}" style="border:1px solid ${section.includeInExport === false ? '#c93b2b' : '#315f4c'};background:${section.includeInExport === false ? '#fdf2f2' : '#edf5f0'};color:${section.includeInExport === false ? '#c93b2b' : '#234a3b'};border-radius:4px;padding:1px 6px;font-size:11px;cursor:pointer;" title="點擊切換是否匯出">${section.includeInExport === false ? '✕ 不匯出' : '✓ 匯出'}</button>` : (section.includeInExport === false ? '<span style="color:#a12d27">不匯出</span>' : `${section.pages.length} 頁`)}</small></summary>
        <div class="deck-page-list">${section.pages.map((page, pageIndex) => `<div class="deck-page-row${pendingSelection.has(page.id) ? ' is-selected' : ''}" data-deck-page-row="${page.id}"><input type="checkbox" data-layout-page="${page.id}" aria-label="選取 ${html(section.label)}第 ${pageIndex + 1} 頁進行版面調整" ${pendingSelection.has(page.id) ? 'checked' : ''}><button type="button" data-deck-page="${page.id}" aria-label="預覽 ${html(section.label)}第 ${pageIndex + 1} 頁">第 ${pageIndex + 1} 頁</button><small>${html(groupLabel(page.id))}</small></div>`).join('')}</div>
      </details>`).join('')}</div>`;

    document.querySelectorAll('[data-deck-page-row]').forEach(row => row.onclick = event => {
      if (event.target.closest('input')) return;
      showDeckEntry(deckEntries().find(entry => entry.id === row.dataset.deckPageRow));
    });
    document.querySelectorAll('.deck-chapter summary').forEach(summary => summary.onclick = event => {
      if (event.target.closest('input') || event.target.closest('button')) return;
      const chapter = summary.closest('[data-deck-section]');
      const sectionId = chapter && chapter.dataset.deckSection;
      if (sectionId) {
        const first = deckEntries().find(entry => entry.sectionId === sectionId);
        if (first) showDeckEntry(first);
      }
    });
    document.querySelectorAll('[data-export-section]').forEach(button => button.onclick = event => {
      event.stopPropagation();
      event.preventDefault();
      const sectionId = button.dataset.exportSection;
      if (model[sectionId]) {
        model[sectionId].includeInExport = model[sectionId].includeInExport === false;
        const centerToggle = document.getElementById('car-notice-export-toggle');
        if (centerToggle) centerToggle.checked = model[sectionId].includeInExport;
        const floatingToggle = document.getElementById('lg-car-notice-export');
        if (floatingToggle) floatingToggle.checked = model[sectionId].includeInExport;
        renderDeckNavigator();
        preview();
        status(model[sectionId].includeInExport ? `已設定匯出「${model[sectionId].label || sectionId}」` : `已設定不匯出「${model[sectionId].label || sectionId}」`);
      }
    });
    document.querySelectorAll('[data-layout-page]').forEach(box => box.onchange = () => {
      if (box.checked) pendingSelection.add(box.dataset.layoutPage); else pendingSelection.delete(box.dataset.layoutPage);
      box.closest('[data-deck-page-row]').classList.toggle('is-selected', box.checked);
      syncSectionCheckbox(box.closest('[data-deck-section]'));
      if (box.checked) {
        showDeckEntry(deckEntries().find(entry => entry.id === box.dataset.layoutPage));
      }
    });
    document.querySelectorAll('[data-layout-section]').forEach(box => {
      box.onclick = event => event.stopPropagation();
      box.onchange = () => {
        const chapter = box.closest('[data-deck-section]');
        chapter.querySelectorAll('[data-layout-page]').forEach(pageBox => {
          pageBox.checked = box.checked;
          pageBox.closest('[data-deck-page-row]').classList.toggle('is-selected', box.checked);
          if (box.checked) pendingSelection.add(pageBox.dataset.layoutPage); else pendingSelection.delete(pageBox.dataset.layoutPage);
        });
        if (box.checked) {
          chapter.open = true;
          const first = chapter.querySelector('[data-deck-page]');
          if (first) showDeckEntry(deckEntries().find(entry => entry.id === first.dataset.deckPage));
        }
      };
    });
    document.querySelectorAll('[data-deck-section]').forEach(syncSectionCheckbox);
    updateDeckNavigator();
  }

  function syncSectionCheckbox(chapter) {
    if (!chapter) return;
    const sectionBox = chapter.querySelector('[data-layout-section]');
    const pageBoxes = Array.from(chapter.querySelectorAll('[data-layout-page]'));
    sectionBox.checked = pageBoxes.length > 0 && pageBoxes.every(box => box.checked);
    sectionBox.indeterminate = pageBoxes.some(box => box.checked) && !sectionBox.checked;
  }

  function updateDeckNavigator() {
    const deck = deckEntries();
    const current = currentDeckEntry();
    document.querySelectorAll('[data-deck-page-row]').forEach(row => row.classList.toggle('is-current', row.dataset.deckPageRow === current.id));
    document.querySelectorAll('[data-deck-section]').forEach(chapter => chapter.classList.toggle('is-current', chapter.dataset.deckSection === current.sectionId));
    const count = document.getElementById('slide-count');
    if (count && current) count.textContent = `${current.deckNumber} / ${deck.length}`;
    const chapterName = document.getElementById('preview-name');
    if (chapterName && current) chapterName.textContent = `${current.sectionLabel}・第 ${current.pageIndex + 1} 頁`;
  }

  function numberValue(id, fallback) {
    const input = document.getElementById(id);
    if (!input || input.value === '') return fallback;
    return Number(input.value);
  }

  function inputValue(id, fallback) {
    const input = document.getElementById(id);
    if (!input || input.value === '') return fallback;
    return input.value;
  }

  function paramsFromForm() {
    const isCar = currentSelectionKind() === 'car-notice';
    const params = {
      titleSize: numberValue('lg-title-size', 60),
      titleX: numberValue('lg-title-x', isCar ? 6.9 : 10),
      titleY: numberValue('lg-title-y', isCar ? 28.9 : 6),
      titleW: numberValue('lg-title-w', isCar ? 86.2 : 80),
      titleH: numberValue('lg-title-h', isCar ? 23.8 : 16),
      titleAlign: inputValue('lg-title-align', 'center'),
      titleColor: production.normalizeColor(inputValue('lg-title-color', '#111111'), '#111111'),
      contentSize: numberValue('lg-content-size', 48),
      contentX: numberValue('lg-content-x', 8),
      contentY: numberValue('lg-content-y', 24),
      contentW: numberValue('lg-content-w', 84),
      contentH: numberValue('lg-content-h', 68),
      contentAlign: inputValue('lg-content-align', 'left'),
      contentColor: production.normalizeColor(inputValue('lg-content-color', '#111111'), '#111111'),
      lineSpacing: numberValue('lg-line-spacing', 1.5)
    };
    if (document.getElementById('lg-secondary-content-size')) {
      Object.assign(params, {
        secondaryContentSize: numberValue('lg-secondary-content-size', 48),
        secondaryContentX: numberValue('lg-secondary-content-x', 51.1),
        secondaryContentY: numberValue('lg-secondary-content-y', 23.3),
        secondaryContentW: numberValue('lg-secondary-content-w', 43),
        secondaryContentH: numberValue('lg-secondary-content-h', 66.5),
        secondaryContentAlign: inputValue('lg-secondary-content-align', 'left'),
        secondaryContentColor: production.normalizeColor(inputValue('lg-secondary-content-color', '#0070C0'), '#0070C0'),
        secondaryLineSpacing: numberValue('lg-secondary-line-spacing', 1.5)
      });
    }
    return params;
  }

  function reportPageForLayout() {
    const reportPages = deckEntries().filter(entry => entry.sectionId === 'announcements' && entry.kind === 'report');
    return reportPages.find(entry => layoutState.pageAssignments[entry.id])
      || reportPages.find(entry => entry.id === (currentDeckEntry() || {}).id)
      || reportPages[0];
  }

  function effectiveReportLayout(override) {
    const page = reportPageForLayout();
    const stored = page && production.resolvedLayoutForPage
      ? production.resolvedLayoutForPage(layoutState, page, model.announcements)
      : {};
    const outputScale = { text: 100, ...(layoutState.outputScale || {}) };
    return {
      ...stored,
      ...(override || {}),
      textScale: Math.max(80, Math.min(120, Number(outputScale.text) || 100)) / 100
    };
  }

  function reflowReportPagesForLayout(override) {
    const api = window.TaiwaneseWorshipBulletinContent;
    if (!api || typeof api.reflowReportPages !== 'function' || !model.announcements) return;
    api.reflowReportPages(model, effectiveReportLayout(override));
    if (active === 'announcements') {
      const pageCount = slidePages(model.announcements, 'announcements').length;
      previewPage = Math.min(previewPage, Math.max(0, pageCount - 1));
    }
  }

  function selectionAffectsReports() {
    return active === 'announcements' || selectedIds().some(id => id.startsWith('announcements:'));
  }

  window.reflowReportPagesForLayout = reflowReportPagesForLayout;

  function outputScaleFromForm() {
    const normalize = value => Math.max(80, Math.min(120, Number(value) || 100));
    return {
      text: normalize(numberValue('lg-output-text-scale', 100)),
      image: normalize(numberValue('lg-output-image-scale', 100))
    };
  }

  function populateOutputScaleForm() {
    const scale = { text: 100, image: 100, ...(layoutState.outputScale || {}) };
    const textInput = document.getElementById('lg-output-text-scale');
    const imageInput = document.getElementById('lg-output-image-scale');
    if (textInput) textInput.value = scale.text;
    if (imageInput) imageInput.value = scale.image;
  }

  async function saveOutputScale() {
    if (!layoutUnlocked) return status('輸出比例已鎖定，請先輸入密碼解鎖');
    layoutState.outputScale = outputScaleFromForm();
    reflowReportPagesForLayout();
    populateOutputScaleForm();
    renderDeckNavigator();
    preview();
    status('正在儲存輸出比例…');
    try {
      await persistLayoutState();
      status(`輸出比例已儲存：文字 ${layoutState.outputScale.text}%、圖片 ${layoutState.outputScale.image}%`);
    } catch (error) {
      status(`輸出比例雲端儲存失敗：${error.message}`);
    }
  }

  function computedColor(value, fallback = '#111111') {
    const match = String(value || '').match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (!match) return production.normalizeColor(value, fallback);
    return `#${match.slice(1, 4).map(channel => Math.max(0, Math.min(255, Number(channel))).toString(16).padStart(2, '0')).join('')}`;
  }

  function canvasParams() {
    const frame = document.querySelector('.slide-frame');
    const content = document.getElementById('slide-content');
    if (!frame || !content) return null;
    const frameRect = frame.getBoundingClientRect();
    if (!frameRect.width || !frameRect.height) return null;
    const measure = (element, prefix, fallback) => {
      if (!element) return fallback;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const fontPx = parseFloat(style.fontSize) || 0;
      const linePx = parseFloat(style.lineHeight) || fontPx;
      const rawX = (rect.left - frameRect.left) / frameRect.width * 100;
      const rawW = rect.width / frameRect.width * 100;
      const edgeBuffer = 1.2;
      const bufferedX = style.textAlign === 'right' ? rawX - edgeBuffer * 2 : style.textAlign === 'center' ? rawX - edgeBuffer : rawX;
      const stableX = Math.max(0, bufferedX);
      const stableW = Math.min(100 - stableX, rawW + edgeBuffer * 2);
      return {
        [`${prefix}Size`]: Number(production.canvasCqwToPoints(fontPx / frameRect.width * 100).toFixed(1)),
        [`${prefix}X`]: Number(stableX.toFixed(1)),
        [`${prefix}Y`]: Number(((rect.top - frameRect.top) / frameRect.height * 100).toFixed(1)),
        [`${prefix}W`]: Number(stableW.toFixed(1)),
        [`${prefix}H`]: Number((rect.height / frameRect.height * 100).toFixed(1)),
        [`${prefix}Align`]: style.textAlign || fallback[`${prefix}Align`],
        [`${prefix}Color`]: computedColor(style.color, fallback[`${prefix}Color`]),
        ...(prefix === 'content'
          ? { lineSpacing: Number((linePx / Math.max(fontPx, 1)).toFixed(2)) }
          : prefix === 'secondaryContent'
            ? { secondaryLineSpacing: Number((linePx / Math.max(fontPx, 1)).toFixed(2)) }
            : {})
      };
    };
    const isCarNotice = currentSelectionKind() === 'car-notice';
    const isPraise = currentSelectionKind() === 'praise-title';
    const titleFallback = isCarNotice
      ? { titleSize: 60, titleX: 6.9, titleY: 28.9, titleW: 86.2, titleH: 23.8, titleAlign: 'center', titleColor: '#111111' }
      : isPraise
        ? { titleSize: 60, titleX: 10, titleY: 28.1, titleW: 80, titleH: 17.8, titleAlign: 'center', titleColor: '#111111' }
        : { titleSize: 60, titleX: 10, titleY: 6, titleW: 80, titleH: 16, titleAlign: 'center', titleColor: '#111111' };
    const contentFallback = isPraise
      ? { contentSize: 36, contentX: 8, contentY: 50.4, contentW: 84, contentH: 10.8, contentAlign: 'center', contentColor: '#111111', lineSpacing: 1.2 }
      : { contentSize: 48, contentX: 8, contentY: 24, contentW: 84, contentH: 68, contentAlign: 'left', contentColor: '#111111', lineSpacing: 1.5 };
    const importedObjects = Array.from(content.querySelectorAll('.ppt-object-text'));
    if (importedObjects.length) {
      const measureImported = (role, prefix, fallback) => {
        const objects = importedObjects.filter(element => element.dataset.pptRole === role);
        if (!objects.length) return fallback;
        const rects = objects.map(element => element.getBoundingClientRect());
        const left = Math.min(...rects.map(rect => rect.left));
        const top = Math.min(...rects.map(rect => rect.top));
        const right = Math.max(...rects.map(rect => rect.right));
        const bottom = Math.max(...rects.map(rect => rect.bottom));
        const style = getComputedStyle(objects[0]);
        const fontPx = parseFloat(style.fontSize) || 0;
        return {
          [`${prefix}Size`]: Number(production.canvasCqwToPoints(fontPx / frameRect.width * 100).toFixed(1)),
          [`${prefix}X`]: Number(((left - frameRect.left) / frameRect.width * 100).toFixed(1)),
          [`${prefix}Y`]: Number(((top - frameRect.top) / frameRect.height * 100).toFixed(1)),
          [`${prefix}W`]: Number(((right - left) / frameRect.width * 100).toFixed(1)),
          [`${prefix}H`]: Number(((bottom - top) / frameRect.height * 100).toFixed(1)),
          [`${prefix}Align`]: style.textAlign || fallback[`${prefix}Align`],
          [`${prefix}Color`]: computedColor(style.color, fallback[`${prefix}Color`]),
          ...(prefix === 'content' ? { lineSpacing: Number((parseFloat(style.lineHeight) / Math.max(fontPx, 1)).toFixed(2)) || 1.05 } : {})
        };
      };
      return {
        ...measureImported('title', 'title', titleFallback),
        ...measureImported('content', 'content', contentFallback)
      };
    }
    const primaryBody = content.querySelector('.body-primary, .body, p');
    const secondaryBody = content.querySelector('.body-secondary');
    const secondaryFallback = isPraise ? {
      secondaryContentSize: 36, secondaryContentX: 8, secondaryContentY: 61.2,
      secondaryContentW: 84, secondaryContentH: 10.8, secondaryContentAlign: 'center',
      secondaryContentColor: '#111111', secondaryLineSpacing: 1.2
    } : {
      secondaryContentSize: 48, secondaryContentX: 51.1, secondaryContentY: 23.3,
      secondaryContentW: 43, secondaryContentH: 66.5, secondaryContentAlign: 'left',
      secondaryContentColor: '#0070C0', secondaryLineSpacing: 1.5
    };
    return {
      ...measure(content.querySelector('h1'), 'title', titleFallback),
      ...measure(primaryBody, 'content', contentFallback),
      ...(secondaryBody ? measure(secondaryBody, 'secondaryContent', secondaryFallback) : {})
    };
  }

  function populateForm(params) {
    Object.entries(params || {}).forEach(([key, value]) => {
      const input = document.getElementById('lg-' + key.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase()));
      if (input && value != null && value !== '') input.value = value;
    });
  }

  function parameterFields() {
    const kind = currentSelectionKind();
    const isCarNotice = kind === 'car-notice';
    const isPraise = kind === 'praise-title';
    const isDual = templateId === 'joint-mandarin' || kind === 'dual-liturgical';
    const hasSecondary = isPraise || isDual;

    if (isCarNotice) {
      const isExported = model['car-notice'] ? model['car-notice'].includeInExport !== false : true;
      return `<div class="layout-parameter-tabs"><button type="button" class="is-active" data-layout-tab="title">標題</button></div>
      <div class="layout-params" data-layout-pane="title"><label>字級<input id="lg-title-size" type="number" value="60"></label><label>X<input id="lg-title-x" type="number" value="6.9"></label><label>Y<input id="lg-title-y" type="number" value="28.9"></label><label>寬<input id="lg-title-w" type="number" value="86.2"></label><label>高<input id="lg-title-h" type="number" value="23.8"></label><label>對齊<select id="lg-title-align"><option value="center">置中</option><option value="left">靠左</option><option value="right">靠右</option></select></label><label>文字顏色<input id="lg-title-color" type="color" value="#111111"></label></div>
      <div style="margin-top:12px;padding:9px 12px;background:#f4f7f5;border:1px solid #cbd8cf;border-radius:6px;display:flex;align-items:center;justify-content:space-between;font-size:13px;">
        <span style="font-weight:600;color:#243a30;">PPTX 匯出設定</span>
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin:0;font-weight:normal;">
          <input id="lg-car-notice-export" type="checkbox" ${isExported ? 'checked' : ''}> 包含此頁
        </label>
      </div>`;
    }

    const contentTabLabel = isPraise ? '歌名' : isDual ? '台語內文' : '內文';
    const secondaryTabLabel = isPraise ? '演唱者' : '華語內文';

    const secondaryColorDefault = isPraise ? '#111111' : '#0070c0';
    const secondaryAlignDefault = isPraise ? 'center' : 'left';
    const secondaryXDefault = isPraise ? '8' : '51.1';
    const secondaryYDefault = isPraise ? '61.2' : '23.3';
    const secondaryWDefault = isPraise ? '84' : '43';
    const secondaryHDefault = isPraise ? '10.8' : '66.5';
    const secondarySizeDefault = isPraise ? '36' : '48';
    const secondarySpacingDefault = isPraise ? '1.2' : '1.5';

    return `<div class="layout-parameter-tabs"><button type="button" class="is-active" data-layout-tab="title">標題</button><button type="button" data-layout-tab="content">${contentTabLabel}</button>${hasSecondary ? `<button type="button" data-layout-tab="secondary-content">${secondaryTabLabel}</button>` : ''}</div>
      <div class="layout-params" data-layout-pane="title"><label>字級<input id="lg-title-size" type="number" value="60"></label><label>X<input id="lg-title-x" type="number" value="10"></label><label>Y<input id="lg-title-y" type="number" value="6"></label><label>寬<input id="lg-title-w" type="number" value="80"></label><label>高<input id="lg-title-h" type="number" value="16"></label><label>對齊<select id="lg-title-align"><option value="center">置中</option><option value="left">靠左</option><option value="right">靠右</option></select></label><label>文字顏色<input id="lg-title-color" type="color" value="#111111"></label></div>
      <div class="layout-params is-hidden" data-layout-pane="content"><label>字級<input id="lg-content-size" type="number" value="${isPraise ? '36' : '48'}"></label><label>X<input id="lg-content-x" type="number" value="8"></label><label>Y<input id="lg-content-y" type="number" value="${isPraise ? '50.4' : '24'}"></label><label>寬<input id="lg-content-w" type="number" value="84"></label><label>高<input id="lg-content-h" type="number" value="${isPraise ? '10.8' : '68'}"></label><label>對齊<select id="lg-content-align"><option value="${isPraise ? 'center' : 'left'}">${isPraise ? '置中' : '靠左'}</option><option value="${isPraise ? 'left' : 'center'}">${isPraise ? '靠左' : '置中'}</option><option value="right">靠右</option></select></label><label>行距<input id="lg-line-spacing" type="number" value="${isPraise ? '1.2' : '1.5'}" step="0.1"></label><label>文字顏色<input id="lg-content-color" type="color" value="#111111"></label></div>${hasSecondary ? `<div class="layout-params is-hidden" data-layout-pane="secondary-content"><label>字級<input id="lg-secondary-content-size" type="number" value="${secondarySizeDefault}"></label><label>X<input id="lg-secondary-content-x" type="number" value="${secondaryXDefault}"></label><label>Y<input id="lg-secondary-content-y" type="number" value="${secondaryYDefault}"></label><label>寬<input id="lg-secondary-content-w" type="number" value="${secondaryWDefault}"></label><label>高<input id="lg-secondary-content-h" type="number" value="${secondaryHDefault}"></label><label>對齊<select id="lg-secondary-content-align"><option value="${secondaryAlignDefault}">${secondaryAlignDefault === 'center' ? '置中' : '靠左'}</option><option value="${secondaryAlignDefault === 'center' ? 'left' : 'center'}">${secondaryAlignDefault === 'center' ? '靠左' : '置中'}</option><option value="right">靠右</option></select></label><label>行距<input id="lg-secondary-line-spacing" type="number" value="${secondarySpacingDefault}" step="0.1"></label><label>文字顏色<input id="lg-secondary-content-color" type="color" value="${secondaryColorDefault}"></label></div>` : ''}`;
  }

  function renderFloatingPanel() {
    const panel = document.getElementById('layout-floating-panel');
    const groups = Object.values(layoutState.groups);
    panel.innerHTML = `<header><div><small>版面參數</small><strong>調整勾選頁面</strong></div><button type="button" id="layout-panel-close" aria-label="關閉版面參數">×</button></header>
      <p class="layout-lock-note" data-layout-lock-note>${layoutUnlocked ? '已解鎖：變更會寫入全教會共用雲端配置。' : '目前已鎖定；解鎖後才能修改全教會共用配置。'}</p>
      <div class="floating-group-fields"><label>群組名稱<input id="layout-group-name" placeholder="例如：經文頁"></label><label>載入群組<select id="layout-group-existing"><option value="">新增群組</option>${groups.map(group => `<option value="${html(group.id)}">${html(group.name || group.id)}</option>`).join('')}</select></label></div>
      ${parameterFields()}
      <footer><button type="button" class="button quiet" id="layout-detach">解除群組</button><button type="button" class="button primary" id="layout-save-group">儲存參數組</button></footer>`;

    document.getElementById('layout-panel-close').onclick = () => panel.classList.add('is-hidden');
    enablePanelDragging(panel);
    let targetTab = activeLayoutTab;
    if (targetTab === 'secondary-content' && !panel.querySelector('[data-layout-tab="secondary-content"]')) {
      targetTab = 'title';
    }
    if (targetTab === 'content' && !panel.querySelector('[data-layout-tab="content"]')) {
      targetTab = 'title';
    }
    const targetButton = panel.querySelector(`[data-layout-tab="${targetTab}"]`);
    if (targetButton) {
      panel.querySelectorAll('[data-layout-tab]').forEach(item => item.classList.toggle('is-active', item === targetButton));
      panel.querySelectorAll('[data-layout-pane]').forEach(pane => pane.classList.toggle('is-hidden', pane.dataset.layoutPane !== targetTab));
    }
    panel.querySelectorAll('[data-layout-tab]').forEach(button => button.onclick = () => {
      activeLayoutTab = button.dataset.layoutTab;
      panel.querySelectorAll('[data-layout-tab]').forEach(item => item.classList.toggle('is-active', item === button));
      panel.querySelectorAll('[data-layout-pane]').forEach(pane => pane.classList.toggle('is-hidden', pane.dataset.layoutPane !== button.dataset.layoutTab));
    });
    document.querySelectorAll('.layout-params input, .layout-params select').forEach(input => input.addEventListener('input', () => {
      liveParams = paramsFromForm();
      if (selectionAffectsReports()) {
        reflowReportPagesForLayout(liveParams);
        renderDeckNavigator();
      }
      preview();
    }));
    document.getElementById('layout-group-existing').onchange = event => loadGroup(event.target.value);
    document.getElementById('layout-save-group').onclick = saveGroup;
    document.getElementById('layout-detach').onclick = detachSelection;
    const floatingExportToggle = document.getElementById('lg-car-notice-export');
    if (floatingExportToggle) {
      floatingExportToggle.onchange = event => {
        if (model['car-notice']) {
          model['car-notice'].includeInExport = event.target.checked;
          const centerToggle = document.getElementById('car-notice-export-toggle');
          if (centerToggle) centerToggle.checked = event.target.checked;
          renderDeckNavigator();
          preview();
          status(event.target.checked ? '已設定匯出此移車提醒頁' : '已設定不匯出此移車提醒頁');
        }
      };
    }
    applyLayoutLockUI();
  }

  function applyLayoutLockUI() {
    const panel = document.getElementById('layout-floating-panel');
    const toggle = document.getElementById('layout-lock-toggle');
    if (toggle) {
      toggle.textContent = layoutUnlocked ? '鎖定版面設定' : '版面設定已鎖定';
      toggle.setAttribute('aria-pressed', String(layoutUnlocked));
    }
    document.querySelectorAll('#opacity, #sync-hymn-opacity-global, #lg-output-text-scale, #lg-output-image-scale, #layout-save-output-scale').forEach(control => {
      control.disabled = !layoutUnlocked;
    });
    if (!panel) return;
    panel.classList.toggle('is-layout-locked', !layoutUnlocked);
    panel.querySelectorAll('.floating-group-fields input, .floating-group-fields select, .layout-params input, .layout-params select, #layout-save-group, #layout-detach').forEach(control => {
      control.disabled = !layoutUnlocked;
    });
    const note = panel.querySelector('[data-layout-lock-note]');
    if (note) note.textContent = layoutUnlocked ? '已解鎖：變更會寫入全教會共用雲端配置。' : '目前已鎖定；解鎖後才能修改全教會共用配置。';
  }

  function openFloatingPanel(syncWithCanvas = true) {
    renderFloatingPanel();
    const panel = document.getElementById('layout-floating-panel');
    panel.classList.remove('is-hidden');
    if (syncWithCanvas) {
      liveParams = null;
      populateForm(canvasParams());
    }
  }

  function enablePanelDragging(panel) {
    const handle = panel.querySelector('header');
    handle.onpointerdown = event => {
      if (event.target.closest('button')) return;
      event.preventDefault();
      const rect = panel.getBoundingClientRect();
      const offsetX = event.clientX - rect.left;
      const offsetY = event.clientY - rect.top;
      panel.style.left = `${rect.left}px`;
      panel.style.top = `${rect.top}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      handle.setPointerCapture(event.pointerId);
      handle.onpointermove = moveEvent => {
        const maxLeft = Math.max(0, window.innerWidth - panel.offsetWidth);
        const maxTop = Math.max(0, window.innerHeight - panel.offsetHeight);
        panel.style.left = `${Math.max(0, Math.min(maxLeft, moveEvent.clientX - offsetX))}px`;
        panel.style.top = `${Math.max(0, Math.min(maxTop, moveEvent.clientY - offsetY))}px`;
      };
      handle.onpointerup = endEvent => {
        handle.releasePointerCapture(endEvent.pointerId);
        handle.onpointermove = null;
        handle.onpointerup = null;
      };
    };
  }

  function loadGroup(groupId) {
    const group = layoutState.groups[groupId];
    if (!group) return;
    document.getElementById('layout-group-name').value = group.name || group.id;
    pendingSelection.clear();
    group.pageIds.forEach(pageId => pendingSelection.add(pageId));
    renderDeckNavigator();
    showDeckEntry(deckEntries().find(entry => entry.id === group.pageIds[0]));
    openFloatingPanel(false);
    populateForm(group.params || {});
    liveParams = { ...(group.params || {}) };
    preview();
  }

  async function saveGroup() {
    if (!layoutUnlocked) return status('版面配置已鎖定，請先輸入密碼解鎖');
    const pageIds = selectedIds();
    const existingId = document.getElementById('layout-group-existing').value;
    const name = document.getElementById('layout-group-name').value.trim();
    if (!name || pageIds.length === 0) return status('請輸入群組名稱並勾選至少一頁');
    const group = production.createLayoutGroup(layoutState, existingId || `layout-${Date.now()}`, pageIds, paramsFromForm());
    group.name = name;
    if (pageIds.some(id => id.startsWith('announcements:'))) reflowReportPagesForLayout(group.params);
    liveParams = null;
    let cloudSaved = true;
    let cloudSaveError = null;
    status(`正在儲存全教會共用版面群組：${name}…`);
    try {
      await persistLayoutState();
    } catch (error) {
      cloudSaved = false;
      cloudSaveError = error;
      console.error('共用版面配置雲端保存失敗', error);
    }
    renderDeckNavigator();
    renderFloatingPanel();
    openFloatingPanel();
    preview();
    status(cloudSaved ? `已儲存全教會共用版面群組：${name}` : `雲端保存失敗：${cloudSaveError.message}；本機版面已保留，重新解鎖後會自動重試`);
  }

  async function detachSelection() {
    if (!layoutUnlocked) return status('版面配置已鎖定，請先輸入密碼解鎖');
    production.detachPagesFromLayoutGroup(layoutState, selectedIds());
    liveParams = null;
    let cloudSaved = true;
    let cloudSaveError = null;
    status('正在更新全教會共用版面群組…');
    try {
      await persistLayoutState();
    } catch (error) {
      cloudSaved = false;
      cloudSaveError = error;
      console.error('共用版面配置雲端保存失敗', error);
    }
    renderDeckNavigator();
    preview();
    status(cloudSaved ? '已解除所選頁面的共用版面群組' : `雲端解除群組失敗：${cloudSaveError.message}；本機變更已保留，重新解鎖後會自動重試`);
  }

  window.applyPageLayoutToPreview = function(content, page) {
    if (!page.id) page.id = `${active}:${previewPage + 1}`;
    const entry = { ...page, sectionId: page.sectionId || active, sectionLabel: page.sectionLabel || model[active].label };
    const stored = production.resolvedLayoutForPage
      ? production.resolvedLayoutForPage(layoutState, entry, model[active])
      : production.layoutForPage(layoutState, entry);
    const params = selectedIds().includes(page.id) && liveParams ? { ...stored, ...liveParams } : stored;
    const outputScale = { text: 100, image: 100, ...(layoutState.outputScale || {}) };
    const textScale = Math.max(80, Math.min(120, Number(outputScale.text) || 100)) / 100;
    const imageScale = Math.max(80, Math.min(120, Number(outputScale.image) || 100)) / 100;
    const importedLayer = content.querySelector('.ppt-import-layer');
    if (importedLayer && page.rasterized) {
      importedLayer.style.transformOrigin = 'center center';
      importedLayer.style.transform = `scale(${imageScale})`;
    }
    const importedObjects = Array.from(content.querySelectorAll('.ppt-object-text'));
    if (importedObjects.length) {
      const applyImportedRole = (role, prefix) => {
        const objects = importedObjects.filter(element => element.dataset.pptRole === role);
        if (!objects.length || params[`${prefix}X`] == null) return;
        const sourceRects = objects.map(element => ({
          element,
          x: Number(element.dataset.sourceX), y: Number(element.dataset.sourceY),
          w: Number(element.dataset.sourceW), h: Number(element.dataset.sourceH)
        }));
        const sourceX = Math.min(...sourceRects.map(rect => rect.x));
        const sourceY = Math.min(...sourceRects.map(rect => rect.y));
        const sourceRight = Math.max(...sourceRects.map(rect => rect.x + rect.w));
        const sourceBottom = Math.max(...sourceRects.map(rect => rect.y + rect.h));
        const scaleX = Number(params[`${prefix}W`]) / Math.max(sourceRight - sourceX, 0.01);
        const scaleY = Number(params[`${prefix}H`]) / Math.max(sourceBottom - sourceY, 0.01);
        sourceRects.forEach(rect => {
          rect.element.style.left = `${Number(params[`${prefix}X`]) + (rect.x - sourceX) * scaleX}%`;
          rect.element.style.top = `${Number(params[`${prefix}Y`]) + (rect.y - sourceY) * scaleY}%`;
          rect.element.style.width = `${rect.w * scaleX}%`;
          rect.element.style.height = `${rect.h * scaleY}%`;
          rect.element.style.textAlign = params[`${prefix}Align`] || rect.element.style.textAlign;
          if (prefix === 'content' && params.lineSpacing) rect.element.style.lineHeight = params.lineSpacing;
          rect.element.querySelectorAll('[data-source-font-size]').forEach(run => {
            const sourceBaseSize = Number(rect.element.dataset.sourceFontSize) || 18;
            const relativeSize = (Number(run.dataset.sourceFontSize) || sourceBaseSize) / sourceBaseSize;
            run.style.fontSize = `${production.pointsToCanvasCqw(Number(params[`${prefix}Size`]) * textScale * relativeSize)}cqw`;
            if (params[`${prefix}Color`]) run.style.color = production.normalizeColor(params[`${prefix}Color`], '#111111');
          });
        });
      };
      applyImportedRole('title', 'title');
      applyImportedRole('content', 'content');
      return;
    }
    const title = content.querySelector('h1');
    const body = content.querySelector('.body-primary, .body, p');
    const secondaryBody = content.querySelector('.body-secondary');
    const wrap = (element, prefix, boxWidthMultiplier = 1) => {
      if (!element || !production.wrapTextForBox || params[`${prefix}Size`] == null) return;
      const sourceText = element.dataset.unwrappedText == null ? element.textContent : element.dataset.unwrappedText;
      element.dataset.unwrappedText = sourceText;
      element.textContent = production.wrapTextForBox(sourceText, {
        fontSize: Number(params[`${prefix}Size`]) * textScale,
        boxWidth: Number(params[`${prefix}W`]) * boxWidthMultiplier,
        bold: true
      });
      element.style.whiteSpace = 'pre-wrap';
    };
    wrap(title, 'title');
    const dualWidthMultiplier = content.classList.contains('template-dual-liturgical') ? 1 / 0.92 : 1;
    wrap(body, 'content', dualWidthMultiplier);
    wrap(secondaryBody, 'secondaryContent', dualWidthMultiplier);
    const place = (element, prefix) => {
      if (!element) return;
      if (params[`${prefix}Color`]) element.style.color = production.normalizeColor(params[`${prefix}Color`], '#111111');
      if (params[`${prefix}X`] == null) return;
      element.style.position = 'absolute';
      element.style.left = `${params[`${prefix}X`]}%`;
      element.style.top = `${params[`${prefix}Y`]}%`;
      element.style.width = `${params[`${prefix}W`]}%`;
      element.style.height = `${params[`${prefix}H`]}%`;
      element.style.margin = '0';
      element.style.textAlign = params[`${prefix}Align`] || '';
      if (params[`${prefix}Size`]) element.style.fontSize = `${production.pointsToCanvasCqw(params[`${prefix}Size`] * textScale)}cqw`;
    };
    place(title, 'title');
    place(body, 'content');
    place(secondaryBody, 'secondaryContent');
    if (body && params.lineSpacing) body.style.lineHeight = params.lineSpacing;
    if (secondaryBody && params.secondaryLineSpacing) secondaryBody.style.lineHeight = params.secondaryLineSpacing;
  };

  const basePreview = preview;
  preview = function() { basePreview(); updateDeckNavigator(); };

  async function initializeCloudLayout() {
    status('正在載入全教會共用版面配置…');
    try {
      const sharedLayout = await cloudStore.load();
      const resolved = window.TaiwaneseWorshipLayoutCloud.chooseLayoutStateForLoad(
        layoutState,
        sharedLayout,
        layoutSyncPending && hasLayoutState()
      );
      if (resolved.source === 'local-pending') {
        cloudLayoutFound = Boolean(sharedLayout);
        replaceLayoutState(resolved.layoutState);
        reflowReportPagesForLayout();
        populateOutputScaleForm();
        renderDeckNavigator();
        renderFloatingPanel();
        preview();
        status('偵測到尚未同步的本機版面；解鎖後會自動重試 Firebase 儲存');
        return;
      }
      if (!sharedLayout) {
        status(hasLayoutState() ? '已載入本機版面備份；首次解鎖後會遷移至全教會雲端配置' : '雲端尚無共用版面配置');
        return;
      }
      replaceLayoutState(resolved.layoutState);
      reflowReportPagesForLayout();
      cloudLayoutFound = true;
      layoutSyncPending = false;
      persistLocalLayoutState();
      populateOutputScaleForm();
      renderDeckNavigator();
      renderFloatingPanel();
      preview();
      status('已載入全教會共用版面配置');
    } catch (error) {
      console.warn('全教會共用版面配置載入失敗，改用本機備份', error);
      status('雲端版面載入失敗，目前使用本機備份');
    }
  }

  function openUnlockDialog() {
    const dialog = document.getElementById('layout-unlock-dialog');
    const password = document.getElementById('layout-unlock-password');
    const error = document.getElementById('layout-unlock-error');
    password.value = '';
    error.textContent = '';
    if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
    setTimeout(() => password.focus(), 0);
  }

  window.saveSharedHymnOpacity = async function() {
    if (!layoutUnlocked) {
      applyLayoutLockUI();
      return status('透明度設定已鎖定，請先輸入密碼解鎖');
    }
    status('正在儲存樂譜透明度…');
    try {
      await persistLayoutState();
      status('樂譜透明度已儲存為全教會共用參數');
    } catch (error) {
      status(`樂譜透明度雲端儲存失敗：${error.message}`);
    }
  };

  function closeUnlockDialog() {
    const dialog = document.getElementById('layout-unlock-dialog');
    if (typeof dialog.close === 'function') dialog.close(); else dialog.removeAttribute('open');
  }

  document.getElementById('layout-unlock-form').onsubmit = async event => {
    event.preventDefault();
    const password = document.getElementById('layout-unlock-password');
    const error = document.getElementById('layout-unlock-error');
    const submit = event.currentTarget.querySelector('[type="submit"]');
    submit.disabled = true;
    error.textContent = '';
    status('正在驗證版面設定密碼…');
    try {
      if (cloudLayoutLoadPromise) await cloudLayoutLoadPromise;
      await cloudStore.unlock(password.value);
      layoutUnlocked = true;
      if (layoutSyncPending && hasLayoutState()) await persistLayoutState();
      else if (!cloudLayoutFound && hasLayoutState()) await persistLayoutState();
      closeUnlockDialog();
      renderFloatingPanel();
      status(cloudLayoutFound ? '版面配置已解鎖' : '版面配置已解鎖；雲端尚無共用設定');
    } catch (unlockError) {
      console.warn('版面配置解鎖失敗', unlockError);
      const msg = String(unlockError && (unlockError.message || unlockError.code) || '解鎖失敗，請稍後再試');
      if (/requests-from-referer|127\.0\.0\.1/i.test(msg)) {
        const localhostUrl = window.location.href.replace('//127.0.0.1:', '//localhost:');
        error.innerHTML = `本機網址 (127.0.0.1) 受到 Firebase 網域限制，請改用 <a href="${localhostUrl}" style="color:#0070c0;font-weight:bold;text-decoration:underline;">localhost 網址 (點此切換)</a> 開啟，即可正常解鎖雲端設定。`;
        status('解鎖失敗：受到 Firebase 網域限制，請切換至 localhost');
      } else {
        error.textContent = msg;
        status(`版面配置解鎖失敗：${msg}`);
      }
    } finally {
      submit.disabled = false;
    }
  };

  document.getElementById('layout-unlock-cancel').onclick = closeUnlockDialog;
  document.getElementById('layout-lock-toggle').onclick = async () => {
    if (!layoutUnlocked) return openUnlockDialog();
    status('正在鎖定版面設定…');
    try {
      await cloudStore.lock();
      layoutUnlocked = false;
      renderFloatingPanel();
      status('版面配置已鎖定');
    } catch (error) {
      status(`鎖定失敗：${error.message}`);
    }
  };

  document.getElementById('save-draft').onclick = async () => {
    localStorage.setItem(draftKey, JSON.stringify({ model, backgroundColor, backgroundImage, syncHymnOpacity: window.isHymnOpacitySyncEnabled(), layoutState, layoutSyncPending }));
    if (!layoutUnlocked) return status('內容已儲存至此瀏覽器；共用版面仍為鎖定狀態');
    status('正在儲存內容與全教會共用版面…');
    try {
      await persistLayoutState();
      status('內容已存於此瀏覽器，版面配置已存至全教會雲端');
    } catch (error) {
      status(`內容已存於此瀏覽器，但雲端版面保存失敗：${error.message}`);
    }
  };

  document.getElementById('layout-panel-open').onclick = openFloatingPanel;
  document.getElementById('layout-save-output-scale').onclick = saveOutputScale;
  window.getDeckEntries = deckEntries;

  flow = renderDeckNavigator;
  populateOutputScaleForm();
  renderFloatingPanel();
  render();
  cloudLayoutLoadPromise = initializeCloudLayout();
})();
