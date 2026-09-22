(function() {
  const previousEditor = editor;
  const profile = window.activeWorshipTemplateProfile || {};
  const generatedIds = new Set(Array.isArray(profile.bibleSections)
    ? profile.bibleSections.map(item => item.sectionId)
    : ['call', 'scripture', 'verse']);
  const defaultLibrarySections = [
    ['pre-hymn-1', 'hymn'],
    ['pre-hymn-2', 'hymn'],
    ['hymn-1', 'hymn'],
    ['hymn-2', 'hymn'],
    ['response', 'response'],
    ['prayer-song', 'hymn'],
    ['offering', 'hymn'],
    ['doxology', 'hymn'],
    ['amen', 'hymn']
  ];
  const librarySectionKinds = new Map(Array.isArray(profile.librarySections)
    ? profile.librarySections
    : defaultLibrarySections);
  const portIds = new Set(librarySectionKinds.keys());
  const hymnOpacityIds = new Set(window.hymnOpacitySectionIds || []);

  editor = function() {
    if (!generatedIds.has(active) && !portIds.has(active)) return previousEditor();
    const item = model[active];
    const form = document.getElementById('editor-form');
    const sourceLabel = generatedIds.has(active) ? '行事曆輸入值（經文範圍）' : '行事曆輸入值（資料庫索引）';
    const activeLibraryKind = librarySectionKinds.get(active);
    const note = generatedIds.has(active)
      ? `此值只作為經文查詢條件；投影片內容由${Array.isArray(profile.bibleVersions) && profile.bibleVersions.length > 1 ? '台語／華語' : '台語'}聖經資料產生器建立。`
      : '此值只作為資料庫索引；按下方按鈕後會從雲端下載並解析原始 PPTX。';
    form.innerHTML = `<div class="inline-note">${note}</div>${field(sourceLabel, 'sourceValue', item.sourceValue || '')}`;
    if (generatedIds.has(active)) {
      form.insertAdjacentHTML('beforeend', '<button type="button" class="button" id="regenerate-section">依輸入值重新產生</button>');
    } else {
      const libraryButtonLabel = activeLibraryKind === 'hymn'
        ? '同步聖詩索引並載入'
        : '載入雲端 PPT 資料庫';
      form.insertAdjacentHTML('beforeend', `<button type="button" class="button" id="load-library-section">${libraryButtonLabel}</button>${item.libraryError ? `<p class="inline-note">${item.libraryError}</p>` : ''}`);
      if (active !== 'response') form.insertAdjacentHTML('beforeend', `<label class="field"><span>聖詩頁白色色塊透明度</span><div class="range-wrap"><input id="library-image-opacity" type="range" min="40" max="80" value="${item.opacity || 60}"><output class="range-value">${item.opacity || 60}%</output></div><small>數值越高，背景越淡。</small></label>`);
    }
    form.querySelector('[data-key="sourceValue"]').addEventListener('input', event => {
      item.sourceValue = event.target.value;
    });
    const regenerate = document.getElementById('regenerate-section');
    if (regenerate) regenerate.onclick = async () => {
      try {
        regenerate.disabled = true;
        status('正在依輸入值產生投影片…');
        await window.generateCalendarContent();
        render();
        status('已重新產生投影片內容');
      } catch (error) {
        status(`內容產生失敗：${error.message}`);
      } finally {
        regenerate.disabled = false;
      }
    };
    const loadLibrary = document.getElementById('load-library-section');
    if (loadLibrary) loadLibrary.onclick = async () => {
      try {
        loadLibrary.disabled = true;
        let syncResult = null;
        if (activeLibraryKind === 'hymn') {
          if (typeof window.syncHymnLibraryIndex !== 'function') {
            throw new Error('聖詩索引同步介面尚未載入');
          }
          status('正在掃描並同步聖詩索引…');
          syncResult = await window.syncHymnLibraryIndex();
        }
        status('正在下載並解析雲端 PPTX…');
        const result = await window.reloadCurrentPptLibrarySection();
        if (result && result.state === 'missing') {
          status(result.message);
          return;
        }
        const syncSummary = syncResult
          ? `索引新增 ${syncResult.inserted || 0}、更新 ${syncResult.updated || 0}、未變更 ${syncResult.unchanged || 0}；`
          : '';
        status(`${syncSummary}已載入 ${result && result.pageCount || 0} 頁`);
      } catch (error) {
        status(`資料庫載入失敗：${error.message}`);
      } finally {
        loadLibrary.disabled = false;
      }
    };
    const imageOpacity = document.getElementById('library-image-opacity');
    if (imageOpacity) imageOpacity.oninput = event => {
      window.TaiwaneseWorshipSlideProduction.applyHymnOpacity(model, window.hymnOpacitySectionIds, active, Number(event.target.value), hymnOpacityIds.has(active) && window.isHymnOpacitySyncEnabled());
      imageOpacity.nextElementSibling.textContent = `${item.opacity}%`;
      preview();
    };
  };
  render();
})();
