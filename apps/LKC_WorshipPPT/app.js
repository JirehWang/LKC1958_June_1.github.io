const templateProfiles = window.WorshipTemplateProfiles;
const activeTemplateId = templateProfiles.resolveTemplateId(window.location.search);
const activeWorshipTemplateProfile = templateProfiles.getTemplateProfile(activeTemplateId);
const sections = activeWorshipTemplateProfile.sections;
const model = templateProfiles.createTemplateModel(activeWorshipTemplateProfile);
const hymnOpacitySectionIds = activeWorshipTemplateProfile.hymnOpacitySectionIds || [];
const draftKey = activeWorshipTemplateProfile.draftKey;

window.activeWorshipTemplateId = activeTemplateId;
window.activeWorshipTemplateProfile = activeWorshipTemplateProfile;
window.worshipDraftKey = draftKey;
window.hymnOpacitySectionIds = hymnOpacitySectionIds;
window.worshipTemplateAssets = {};
window.model = model;
document.body.dataset.template = activeTemplateId;

let active = activeWorshipTemplateProfile.activeSectionId || sections[0][0];
let backgroundColor = activeWorshipTemplateProfile.defaultBackgroundColor || '#ffffff';
let backgroundImage = '';
let syncHymnOpacity = true;
let hasSavedBackground = false;

try {
  const draft = JSON.parse(localStorage.getItem(draftKey) || '{}');
  backgroundColor = window.TaiwaneseWorshipSlideProduction.normalizeColor(draft.backgroundColor, backgroundColor);
  backgroundImage = window.TaiwaneseWorshipSlideProduction.normalizeBackgroundImageDataUrl(draft.backgroundImage);
  hasSavedBackground = Boolean(backgroundImage);
  syncHymnOpacity = draft.syncHymnOpacity !== false;
  hymnOpacitySectionIds.forEach(id => {
    const saved = Number(draft.model && draft.model[id] && draft.model[id].opacity);
    if (saved >= 40 && saved <= 80 && model[id]) model[id].opacity = saved;
  });
  Object.entries(draft.model || {}).forEach(([id, saved]) => {
    if (!model[id] || !saved || typeof saved !== 'object') return;
    ['title', 'kicker', 'body', 'secondaryBody', 'sourceValue'].forEach(key => {
      if (typeof saved[key] === 'string') model[id][key] = saved[key];
    });
    if (typeof saved.pastorPptApplyBackground === 'boolean') {
      model[id].pastorPptApplyBackground = saved.pastorPptApplyBackground;
    }
    if (typeof saved.includeInExport === 'boolean') {
      model[id].includeInExport = saved.includeInExport;
    }
  });
} catch (error) {
  console.warn('背景、內容與透明度草稿讀取失敗', error);
}

if (syncHymnOpacity && hymnOpacitySectionIds.length) {
  const sourceId = hymnOpacitySectionIds.find(id => model[id]);
  if (sourceId) window.TaiwaneseWorshipSlideProduction.applyHymnOpacity(model, hymnOpacitySectionIds, sourceId, model[sourceId].opacity, true);
}

const blobToDataUrl = blob => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(reader.error || new Error('資產讀取失敗'));
  reader.readAsDataURL(blob);
});

window.worshipTemplateAssetsReady = Promise.all(Object.entries(activeWorshipTemplateProfile.assets || {}).map(async ([key, url]) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  window.worshipTemplateAssets[key] = await blobToDataUrl(await response.blob());
})).then(() => {
  if (!hasSavedBackground && window.worshipTemplateAssets.background) {
    backgroundImage = window.worshipTemplateAssets.background;
  }
  if (typeof render === 'function') render();
  return window.worshipTemplateAssets;
}).catch(error => {
  console.warn('模板資產載入失敗', error);
  return window.worshipTemplateAssets;
});

window.isHymnOpacitySyncEnabled = () => syncHymnOpacity;
window.setHymnOpacitySyncEnabled = value => { syncHymnOpacity = Boolean(value); };

const $ = selector => document.querySelector(selector);
const esc = value => String(value == null ? '' : value).replace(/[&<>]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[character]));

function field(label, key, value = '', type = 'text', hint = '') {
  return `<label class="field"><span>${label}</span>${type === 'textarea'
    ? `<textarea data-key="${key}">${esc(value)}</textarea>`
    : `<input data-key="${key}" value="${esc(value)}">`}${hint ? `<small>${hint}</small>` : ''}</label>`;
}

function setEphemeralModelValue(item, key, value) {
  Object.defineProperty(item, key, {
    value,
    writable: true,
    configurable: true,
    enumerable: false
  });
}

async function handlePastorPptUpload(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  const item = model.sermon;
  try {
    if (!/\.pptx$/i.test(file.name)) {
      throw new Error('牧師講道 PPT 僅支援 .pptx，且必須是 16:9 格式');
    }
    status('正在驗證牧師講道 PPT 格式…');
    const pages = await window.TaiwaneseWorshipPptxLibrary.parsePptx(
      await file.arrayBuffer(),
      window.JSZip,
      { requireSixteenByNine: true }
    );
    if (!pages.length) throw new Error('牧師講道 PPT 沒有可匯入的投影片');
    status('正在處理牧師講道 PPT 投影片…');
    const rasterizedPages = await window.TaiwaneseWorshipPptxLibrary.rasterizeImportedPages(pages);
    setEphemeralModelValue(item, 'pastorPptPages', rasterizedPages);
    setEphemeralModelValue(item, 'pastorPptFileName', file.name);
    if (typeof item.pastorPptApplyBackground !== 'boolean') item.pastorPptApplyBackground = true;
    render();
    status(`已載入牧師講道 PPT：${file.name}（${rasterizedPages.length} 張）`);
  } catch (error) {
    event.target.value = '';
    status(`牧師講道 PPT 無法上傳：${error.message}`);
    console.error(error);
  }
}

function flow() {
  $('#flow-list').innerHTML = sections.map(([id, label], index) => `<button class="flow-item ${id === active ? 'active' : ''}" data-id="${id}"><span class="flow-number">${String(index + 1).padStart(2, '0')}</span>${label}</button>`).join('');
  document.querySelectorAll('[data-id]').forEach(button => {
    button.onclick = () => { active = button.dataset.id; render(); };
  });
}

function editor() {
  const item = model[active];
  const form = $('#editor-form');
  let html = '';
  if (item.type === 'fixed') {
    html = `<div class="inline-note">內容依提供的台語禮拜 PPT 固定保留。</div>${field('內容', 'body', item.body, 'textarea')}`;
  } else if (item.type === 'dual-fixed') {
    html = '<div class="inline-note">台語與華語使用兩個獨立內文框，系統會分別排版。</div>';
  } else if (item.type === 'static') {
    html = '<div class="inline-note">此頁沿用來源模板的固定版面與內容。</div>';
  } else if (item.type === 'fixed-title') {
    html = '<div class="inline-note">此段落在提供的 PPT 中為固定格式。歌詞或樂譜不在此頁自行產生。</div>';
  } else if (item.type === 'port') {
    html = `<div class="inline-note">保留啟應文資料庫端口。資料庫尚未串接前，請依本週資料手動貼入。</div>${field('標題', 'title', item.title)}${field('內容', 'body', item.body, 'textarea')}`;
  } else if (item.type === 'hymn') {
    html = `${field('聖詩編號與名稱', 'title', item.title, 'text', '聖詩資料庫端口保留。')}${field('樂譜／歌詞內容', 'body', item.body, 'textarea')}`;
  } else if (item.type === 'calendar') {
    html = `<div class="inline-note">此值會作為經文查詢條件，再依目前模板的聖經版本產生投影片。</div>${field('標題', 'title', item.title)}${field('內容', 'body', item.body, 'textarea')}`;
  } else if (item.type === 'praise') {
    html = `${field('詩歌名稱', 'title', item.title)}${field('演唱者／團體（選填）', 'kicker', item.kicker)}${field('歌詞（以空白行分頁）', 'body', item.body, 'textarea', '依你貼入的歌詞分頁，不自動生成歌詞。')}`;
  } else if (item.type === 'sermon') {
    const pastorPptPages = Array.isArray(item.pastorPptPages) ? item.pastorPptPages : [];
    const pastorPptStatus = pastorPptPages.length
      ? `<small class="file-name-hint">已載入：${esc(item.pastorPptFileName || '牧師講道 PPT')}（${pastorPptPages.length} 張）</small>`
      : '<small>僅接受 16:9 的 .pptx；不符合比例的檔案無法上傳。</small>';
    html = `${field('講道題目', 'title', item.title)}<div class="form-row">${field('講員', 'kicker', item.kicker)}${field('經文', 'body', item.body)}</div><label class="field"><span>牧師講道 PPT（選填）</span><input id="pastor-ppt-upload" type="file" accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation">${pastorPptStatus}</label><label class="field checkbox-field"><span>牧師 PPT 背景</span><span><input id="pastor-ppt-apply-background" type="checkbox" ${item.pastorPptApplyBackground !== false ? 'checked' : ''}> 套用禮拜背景</span></label>`;
  } else if (item.type === 'manual') {
    html = `${field('標題', 'title', item.title)}${field('報告內容', 'body', item.body, 'textarea', '請直接貼入報告內容。')}`;
  } else if (item.type === 'car-notice') {
    html = `<label class="field checkbox-field" style="margin-bottom:12px;padding:10px 12px;background:var(--card-bg,#f4f7f5);border:1px solid var(--border-color,#d3ded7);border-radius:8px;"><span>匯出設定</span><span><input id="car-notice-export-toggle" type="checkbox" ${item.includeInExport !== false ? 'checked' : ''}> 匯出 PPTX 時包含此頁</span></label>${field('提醒文字', 'title', item.title, 'text', '預設為「敬請停在車道的車主儘快移車」，可依需要自行修改')}`;
  } else {
    html = `${field('標題', 'title', item.title)}${field('副標題（選填）', 'kicker', item.kicker)}${field('內容（選填）', 'body', item.body, 'textarea')}`;
  }

  if (hymnOpacitySectionIds.includes(active)) {
    const unlocked = Boolean(window.isWorshipLayoutUnlocked && window.isWorshipLayoutUnlocked());
    html += `<label class="field"><span>樂譜白底透明度（全教會共用）</span><div class="range-wrap"><input id="opacity" type="range" min="40" max="80" value="${item.opacity}" ${unlocked ? '' : 'disabled'}><output class="range-value">${item.opacity}%</output></div><small>${unlocked ? '放開滑桿後自動儲存至雲端' : '需先以版面設定密碼解鎖'}</small></label>`;
  }

  form.innerHTML = html;
  form.querySelectorAll('[data-key]').forEach(element => {
    element.oninput = event => { item[event.target.dataset.key] = event.target.value; preview(); };
  });
  const carNoticeExportToggle = $('#car-notice-export-toggle');
  if (carNoticeExportToggle) carNoticeExportToggle.onchange = event => {
    item.includeInExport = event.target.checked;
    const floatingExportToggle = document.getElementById('lg-car-notice-export');
    if (floatingExportToggle) floatingExportToggle.checked = event.target.checked;
    flow();
    preview();
    status(item.includeInExport ? '已設定匯出此移車提醒頁' : '已設定不匯出此移車提醒頁');
  };
  const pastorPptUpload = $('#pastor-ppt-upload');
  if (pastorPptUpload) pastorPptUpload.onchange = handlePastorPptUpload;
  const pastorPptApplyBackground = $('#pastor-ppt-apply-background');
  if (pastorPptApplyBackground) pastorPptApplyBackground.onchange = event => {
    item.pastorPptApplyBackground = event.target.checked;
    preview();
  };
  const opacity = $('#opacity');
  if (opacity) {
    opacity.oninput = event => {
      window.TaiwaneseWorshipSlideProduction.applyHymnOpacity(model, hymnOpacitySectionIds, active, event.target.value, syncHymnOpacity);
      $('.range-value').textContent = `${event.target.value}%`;
      preview();
    };
    opacity.onchange = () => { if (window.saveSharedHymnOpacity) window.saveSharedHymnOpacity(); };
  }
}

function preview() {
  const item = model[active];
  const pages = item.type === 'praise' && item.body ? item.body.split(/\n\s*\n/).filter(Boolean).length : 1;
  const setText = (selector, value) => { const element = $(selector); if (element) element.textContent = value; };
  setText('#preview-name', item.label);
  setText('#preview-kicker', item.kicker);
  setText('#preview-title', item.title);
  setText('#preview-body', item.body);
  setText('#slide-count', `${pages} 頁`);
  const background = $('.slide-background');
  if (background) {
    background.style.backgroundImage = backgroundImage ? `url("${backgroundImage}")` : 'none';
    background.style.backgroundColor = backgroundColor;
    background.style.opacity = item.type === 'hymn' ? (100 - Number(item.opacity)) / 100 : 1;
  }
}

function render() {
  flow();
  editor();
  preview();
  const item = model[active];
  $('#section-kind').textContent = ['fixed', 'fixed-title', 'dual-fixed', 'static'].includes(item.type)
    ? '固定內容'
    : item.type === 'calendar' ? '行事曆帶入端口' : '流程內容';
  $('#section-title').textContent = item.label;
}

function status(message) {
  const target = $('#save-state');
  const text = String(message || '');
  const state = /正在|讀取中|載入中|下載中|解析中|產生中|儲存中|驗證中|更新中/.test(text)
    ? 'busy'
    : /失敗|錯誤|無法|PERMISSION_DENIED|找不到/.test(text) ? 'error' : /已|成功/.test(text) ? 'success' : 'idle';
  target.textContent = text;
  target.dataset.state=state;
  target.setAttribute('aria-busy', String(state === 'busy'));
  document.body.classList.toggle('is-busy',state==='busy');
  document.body.setAttribute('aria-busy', String(state === 'busy'));
}

const templateSelector = $('#template-selector');
templateSelector.value = activeTemplateId;
templateSelector.onchange = event => {
  const url = new URL(window.location.href);
  url.searchParams.set('template', event.target.value);
  window.location.assign(url.toString());
};
$('#template-name').textContent = activeWorshipTemplateProfile.label;

const backgroundInput = $('#background-color');
backgroundInput.value = backgroundColor;
backgroundInput.oninput = event => {
  backgroundColor = window.TaiwaneseWorshipSlideProduction.normalizeColor(event.target.value, '#ffffff');
  preview();
  status(`已套用純色背景：${backgroundColor}`);
};

const backgroundImageUpload = $('#background-image-upload');
backgroundImageUpload.onchange = event => {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  if (!window.TaiwaneseWorshipSlideProduction.isSupportedBackgroundImage(file)) {
    status('背景圖僅支援 PNG、JPG 或 WebP');
    event.target.value = '';
    return;
  }
  const reader = new FileReader();
  status('正在讀取背景圖片…');
  reader.onload = () => {
    backgroundImage = window.TaiwaneseWorshipSlideProduction.normalizeBackgroundImageDataUrl(reader.result);
    hasSavedBackground = true;
    preview();
    status(`已套用背景圖：${file.name}`);
    event.target.value = '';
  };
  reader.onerror = () => status('背景圖讀取失敗，請重新選擇');
  reader.readAsDataURL(file);
};

$('#save-draft').onclick = () => {
  localStorage.setItem(draftKey, JSON.stringify({ model, backgroundColor, backgroundImage, syncHymnOpacity }));
  status('已儲存至此瀏覽器');
};
$('#calendar-load').onclick = () => status('行事曆端口已保留，等待資料欄位映射後帶入');
$('#export-ppt').onclick = async () => {
  try {
    status('正在匯出 PPTX 簡報檔…');
    await window.worshipTemplateAssetsReady;
    await (window.worshipExternalPresentationsReady || Promise.resolve([]));
    await window.ensureNativeLibrarySources();
    const exportOptions = { model, backgroundColor, backgroundImage };
    if (typeof window.getWorshipLayoutStateForExport === 'function') {
      exportOptions.layoutState = window.getWorshipLayoutStateForExport();
    }
    const reportLayout = typeof window.getWorshipReportLayoutForExport === 'function'
      ? window.getWorshipReportLayoutForExport()
      : null;
    if (reportLayout && typeof window.reflowReportPagesForLayout === 'function') {
      exportOptions.reflowReportPages = () => window.reflowReportPagesForLayout(reportLayout);
    }
    await window.TaiwaneseWorshipPptExport.exportWorshipPPTX(exportOptions);
    status('PPTX 簡報檔已成功下載！');
  } catch (error) {
    status(`簡報匯出失敗：${error.message}`);
    console.error(error);
  }
};

const localIsoDate = () => new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit'
}).format(new Date());
$('#service-date').value = localIsoDate();
$('#service-date').addEventListener('input', () => { if (model[active].type === 'cover') preview(); });
$('#service-date').addEventListener('change', () => { if (model[active].type === 'cover') preview(); });
render();
