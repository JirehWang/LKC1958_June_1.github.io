let previewPage = 0;
const safeHtml = value => String(value || '').replace(/[&<>]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;' })[char]);
const safeAttr = value => safeHtml(value).replace(/"/g, '&quot;');
function renderReportBody(page) {
  const body = String(page.body || '');
  if (page.listType !== 'ordered') return safeHtml(body);
  const blocks = body.split(/\n\s*\n/).map(block => block.trim()).filter(Boolean);
  if (!blocks.length) return '';
  let start = 1;
  const items = blocks.map((block, index) => {
    const numbered = block.match(/^\s*(\d+)[.．、)]\s*(（續）)?\s*([\s\S]*)$/);
    if (!numbered) return block;
    if (index === 0) start = Number(numbered[1]) || 1;
    return [numbered[2] || '', numbered[3] || ''].filter(Boolean).join(' ');
  });
  const startAttribute = start === 1 ? '' : ` start="${start}"`;
  return `<ol${startAttribute}>${items.map(item => `<li>${safeHtml(item).replace(/\n/g, '<br>')}</li>`).join('')}</ol>`;
}
function renderImportedPptPage(page, item) {
  return `<div class="ppt-import-layer">${(page.objects || []).map((object, objectIndex) => {
    const geometry = `left:${object.x}%;top:${object.y}%;width:${object.w}%;height:${object.h}%`;
    if (object.type === 'image') {
      return `<img class="ppt-object-image" src="${safeAttr(object.src || '')}" alt="" style="${geometry}">`;
    }
    const runs = Array.isArray(object.runs) && object.runs.length ? object.runs : [{ text: object.text || '' }];
    const runHtml = runs.map(run => {
      const styles = [
        run.fontSize ? `font-size:${run.fontSize / 9.6}cqw` : '',
        run.fontFamily ? `font-family:${safeAttr(run.fontFamily)}` : '',
        run.color ? `color:${safeAttr(run.color)}` : '',
        run.bold ? 'font-weight:700' : '',
        run.italic ? 'font-style:italic' : '',
        run.underline ? 'text-decoration:underline' : ''
      ].filter(Boolean).join(';');
      return `<span data-source-font-size="${run.fontSize || object.fontSize || 18}" style="${styles}">${safeHtml(run.text)}</span>`;
    }).join('');
    return `<div class="ppt-object-text" data-ppt-role="${object.role || 'content'}" data-ppt-index="${objectIndex}" data-source-x="${object.x}" data-source-y="${object.y}" data-source-w="${object.w}" data-source-h="${object.h}" data-source-font-size="${object.fontSize || 18}" style="${geometry};text-align:${object.align || 'left'};align-items:${object.verticalAlign || 'start'};font-size:${(object.fontSize || 18) / 9.6}cqw;font-family:${safeAttr(object.fontFamily || 'Microsoft JhengHei')};color:${safeAttr(object.color || '#000000')};font-weight:${object.bold ? 700 : 400}"><span class="ppt-text-runs">${runHtml}</span></div>`;
  }).join('')}</div>`;
}
function formatPraiseInstrumentDetails(item) {
  return [
    item.kicker || '',
    item.tune ? '曲／' + item.tune : '',
    item.arrangement ? '編曲／' + item.arrangement : '',
    item.performers || ''
  ].map(value => String(value || '').trim()).filter(Boolean).join('\n');
}
function slidePages(item, sectionId) {
  if (Array.isArray(item.pptPages)) return window.TaiwaneseWorshipSlideProduction.composeLibraryPages(item, sectionId || active);
  if (item.type === 'fixed') {
    const kind = active === 'creed' || active === 'lord-prayer' ? 'liturgical' : 'content';
    return (item.body || '').split(/\n\s*\n/).filter(Boolean).map(body => ({ kind, body }));
  }
  if (item.type === 'cover') return [{ kind:'cover' }];
  if (item.type === 'praise') {
    const instrumental = item.performanceType === 'instrumental';
    const titlePage = { kind:'praise-title' };
    if (instrumental) titlePage.body = formatPraiseInstrumentDetails(item);
    const lyrics = instrumental ? [] : (item.body || '').split(/\n\s*\n/).filter(Boolean).map(body => ({ kind:'praise-lyrics', body }));
    return [titlePage, ...lyrics];
  }
  if (item.type === 'sermon') return window.TaiwaneseWorshipSlideProduction.composeSermonPages(item, sectionId || active);
  if (item.type === 'manual') {
    const pages = (item.body || '').split(/\n\s*\n/).filter(Boolean).map(body => ({ kind:'content', body }));
    return [{ kind:'section' }, ...pages];
  }
  if (item.type === 'hymn') return [{ kind:'section' }, { kind:'score' }];
  if (item.type === 'fixed-title') return item.includeSectionTitle === false ? [{ kind:'score' }] : [{ kind:'section' }, { kind:'score' }];
  if (item.type === 'title') return [{ kind:'section' }];
  if (item.type === 'car-notice') return [{ kind:'car-notice', title: item.title || '敬請停在車道的車主儘快移車' }];
  return [{ kind:'content', body:item.body || '' }];
}
preview = function() {
  const item = model[active];
  const pages = slidePages(item);
  previewPage = Math.min(previewPage, Math.max(0, pages.length - 1));
  const page = pages[previewPage];
  const frame = document.querySelector('.slide-frame');
  const background = document.querySelector('.slide-background');
  const exportSuffix = item && item.includeInExport === false ? '（不匯出）' : '';
  document.getElementById('preview-name').textContent = `${item.label}${exportSuffix}`;
  document.getElementById('slide-count').textContent = `${previewPage + 1} / ${pages.length}`;
  const isDarkTemplatePage = page.kind === 'offering-guide' || page.kind === 'thanksgiving';
  const applyBackground = page.applyBackground !== false;
  background.style.backgroundImage = !isDarkTemplatePage && applyBackground && backgroundImage ? `url("${backgroundImage}")` : 'none';
  background.style.backgroundColor = isDarkTemplatePage ? '#000000' : applyBackground ? backgroundColor : '#ffffff';
  background.style.opacity = 1;
  const content = document.getElementById('slide-content');
  const previewEntry = { ...page, sectionId: active, sectionLabel: item.label };
  const hasHymnWhiteOverlay = window.TaiwaneseWorshipSlideProduction.shouldApplyHymnWhiteOverlay(
    previewEntry,
    window.hymnOpacitySectionIds || []
  );
  const whiteOverlayOpacity = hasHymnWhiteOverlay
    ? window.TaiwaneseWorshipSlideProduction.toWhiteOverlayOpacity(item.opacity)
    : 0;
  content.style.setProperty('--hymn-white-overlay-opacity', whiteOverlayOpacity);
  const title = safeHtml(page.title || item.title || item.label);
  const kicker = safeHtml(item.kicker || '');
  if (page.kind === 'ppt-import') {
    content.className = `slide-content template-ppt-import${hasHymnWhiteOverlay ? ' has-hymn-white-overlay' : ''}`;
    content.innerHTML = renderImportedPptPage(page, item);
  }
  else if (page.kind === 'cover') {
    const date = document.getElementById('service-date').value;
    const [year, month, day] = date ? date.split('-') : [];
    const formatted = date ? `主後${year}年${month}月${day}日` : '';
    content.className = 'slide-content template-cover';
    content.innerHTML = `<h1>${safeHtml((window.activeWorshipTemplateProfile && window.activeWorshipTemplateProfile.coverTitle) || '台語主日禮拜')}</h1><p>${formatted}</p>`;
  }
  else if (page.kind === 'content') content.className = 'slide-content template-content', content.innerHTML = `<h1>${title}</h1><div class="body">${safeHtml(page.body)}</div>`;
  else if (page.kind === 'report') content.className = 'slide-content template-report', content.innerHTML = `<h1>${title}</h1><div class="body">${renderReportBody(page)}</div>`;
  else if (page.kind === 'scripture') content.className = 'slide-content template-content template-scripture', content.innerHTML = `<h1>${title}</h1><div class="body">${safeHtml([page.languageLabel ? `(${page.languageLabel})` : '', page.body].filter(Boolean).join('\n'))}</div>`;
  else if (page.kind === 'liturgical') {
    const alignment = page.align === 'center' ? ' is-centered' : ' is-left';
    content.className = `slide-content template-liturgical${alignment}${page.showTitle === false ? ' no-title' : ''}`;
    content.innerHTML = `${page.showTitle === false ? '' : `<h1>${title}</h1>`}<div class="body">${safeHtml(page.body)}</div>`;
  }
  else if (page.kind === 'dual-liturgical') {
    content.className = 'slide-content template-dual-liturgical';
    content.innerHTML = `${page.showTitle === false ? '' : `<h1>${title}</h1>`}<div class="body body-primary">${safeHtml([page.primaryLabel ? `(${page.primaryLabel})` : '', page.primaryBody].filter(Boolean).join('\n'))}</div><div class="body body-secondary">${safeHtml([page.secondaryLabel ? `(${page.secondaryLabel})` : '', page.secondaryBody].filter(Boolean).join('\n'))}</div>`;
  }
  else if (page.kind === 'full-image') {
    const profileAssets = window.activeWorshipTemplateProfile && window.activeWorshipTemplateProfile.assets || {};
    const src = window.worshipTemplateAssets && window.worshipTemplateAssets[page.assetKey] || profileAssets[page.assetKey] || '';
    content.className = 'slide-content template-full-image';
    content.innerHTML = `<img src="${safeAttr(src)}" alt="">`;
  }
  else if (page.kind === 'offering-guide') {
    const lines = String(page.body || '').split('\n');
    content.className = 'slide-content template-offering-guide';
    content.innerHTML = `<h1>${title}</h1><div class="body">${lines.map((line, index) => `<span class="offering-line offering-line-${index + 1}">${safeHtml(line)}</span>`).join('')}</div>`;
  }
  else if (page.kind === 'thanksgiving') {
    content.className = 'slide-content template-thanksgiving';
    content.innerHTML = `<div class="body">${safeHtml(page.body)}</div><h1>${title}</h1>`;
  }
  else if (page.kind === 'praise-title') {
    const instrumental = item.performanceType === 'instrumental';
    content.className = 'slide-content template-section' + (instrumental ? ' template-praise-instrumental' : '');
    const title = safeHtml(page.title || item.title || '');
    const secondary = safeHtml(instrumental ? (page.body || formatPraiseInstrumentDetails(item)) : (page.kicker || item.kicker || ''));
    content.innerHTML = '<h1>讚美</h1><div class="body body-primary">' + title + '</div><div class="body body-secondary">' + secondary + '</div>';
  }
  else if (page.kind === 'sermon-title') {
    const sermonTitle = ['講道', page.title || item.title].filter(Boolean).join('：');
    const details = [page.kicker || item.kicker, page.body || item.body].filter(Boolean).join('\n');
    content.className = 'slide-content template-section';
    content.innerHTML = `<h1>${safeHtml(sermonTitle)}</h1><div class="body">${safeHtml(details)}</div>`;
  }
  else if (page.kind === 'praise-lyrics') content.className = 'slide-content template-praise', content.innerHTML = `<div class="body">${safeHtml(page.body)}</div>`;
  else if (page.kind === 'score') content.className = `slide-content template-score${hasHymnWhiteOverlay ? ' has-hymn-white-overlay' : ''}`, content.innerHTML = `<h1>${title}</h1><p>${kicker}</p><div class="score-slot"></div>`;
  else if (page.kind === 'car-notice') {
    content.className = 'slide-content template-section without-subtitle template-car-notice';
    content.innerHTML = `<h1>${title}</h1>`;
  }
  else {
    const subtitles = { '會前領唱':'請準備心今天的禮拜', '靜默一分鐘':'請將手機關機或靜音', '後奏':'請後奏結束後再起身或交談', '平安禮':'請兄弟姊妹互相行平安禮' };
    content.className = 'slide-content template-section';
    content.innerHTML = `<h1>${title}</h1><p>${kicker || subtitles[item.label] || ''}</p>`;
  }
  if (window.applyPageLayoutToPreview) window.applyPageLayoutToPreview(content, previewEntry);
};
document.getElementById('page-prev').onclick = () => window.navigateDeck ? window.navigateDeck(-1) : (previewPage = Math.max(0, previewPage - 1), preview());
document.getElementById('page-next').onclick = () => window.navigateDeck ? window.navigateDeck(1) : (previewPage += 1, preview());
document.addEventListener('keydown', event => {
  const target = event.target;
  if (target && (target.matches('input, textarea, select, button, [contenteditable="true"]'))) return;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
    event.preventDefault();
    if (window.navigateDeck) window.navigateDeck(-1); else { previewPage = Math.max(0, previewPage - 1); preview(); }
  } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
    event.preventDefault();
    if (window.navigateDeck) window.navigateDeck(1); else { previewPage += 1; preview(); }
  }
});
const originalRender = render;
render = function() { previewPage = 0; originalRender(); };
render();
