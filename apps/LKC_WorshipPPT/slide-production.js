(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TaiwaneseWorshipSlideProduction = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  const cleanText = value => String(value == null ? '' : value).replace(/<\/?[a-zA-Z0-9]+[^>]*>/g, '').trim();
  const DEFAULT_LAYOUT_PARAMS = {
    titleSize: 60,
    titleX: 10,
    titleY: 6,
    titleW: 80,
    titleH: 16,
    titleAlign: 'center',
    titleColor: '#111111',
    contentSize: 48,
    contentX: 8,
    contentY: 24,
    contentW: 84,
    contentH: 68,
    contentAlign: 'left',
    contentColor: '#111111',
    lineSpacing: 1.5
  };
  const HYMN_TITLE_SECTIONS = new Set(['pre-hymn-1', 'pre-hymn-2', 'hymn-1', 'hymn-2', 'doxology']);

  function normalizeColor(value, fallback = '#111111') {
    const color = String(value || '').trim().toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(color)) return color;
    if (/^#[0-9a-f]{3}$/.test(color)) return `#${color.slice(1).split('').map(char => char + char).join('')}`;
    return normalizeColor(fallback, '#111111');
  }

  function isSupportedBackgroundImage(file) {
    if (!file) return false;
    const type = String(file.type || '').toLowerCase();
    const name = String(file.name || '').toLowerCase();
    return ['image/png', 'image/jpeg', 'image/webp'].includes(type)
      || (!type && /\.(png|jpe?g|webp)$/.test(name));
  }

  function normalizeBackgroundImageDataUrl(value) {
    const dataUrl = String(value || '').trim();
    return /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=\s]+$/i.test(dataUrl) ? dataUrl : '';
  }

  function toWhiteOverlayOpacity(value) {
    return Math.max(0.4, Math.min(0.8, Number(value || 60) / 100));
  }

  function applyHymnOpacity(model, sectionIds, activeSectionId, value, syncAll) {
    const opacity = Math.max(40, Math.min(80, Number(value) || 60));
    const targets = syncAll ? sectionIds : [activeSectionId];
    (targets || []).forEach(sectionId => {
      if (model && model[sectionId]) model[sectionId].opacity = opacity;
    });
    return model;
  }

  function shouldApplyHymnWhiteOverlay(page, sectionIds) {
    return Boolean(page)
      && (page.kind === 'ppt-import' || page.kind === 'score')
      && (sectionIds || []).includes(page.sectionId);
  }

  function pointsToCanvasCqw(value) {
    return Number(value) / 9.6;
  }

  function canvasCqwToPoints(value) {
    return Number(value) * 9.6;
  }

  let textMeasureContext;
  const NATIVE_TEXT_WRAP_SAFETY = 0.92;

  function fallbackTextWidth(value) {
    return Array.from(String(value || '')).reduce((width, char) => {
      if (/\s/.test(char)) return width + 0.35;
      if (/[\u0000-\u00ff]/.test(char)) return width + 0.55;
      if (/[，。；：、？！）》」』]/.test(char)) return width + 0.55;
      return width + 1;
    }, 0);
  }

  function wrapTextForBox(value, options = {}) {
    const text = String(value == null ? '' : value);
    if (!text) return '';
    const fontSize = Math.max(1, Number(options.fontSize) || 48);
    const boxWidth = Math.max(1, Number(options.boxWidth) || 84);
    const fontFamily = String(options.fontFamily || 'Microsoft JhengHei');
    const bold = options.bold !== false;
    const browserMaxWidth = 1280 * boxWidth / 100 * NATIVE_TEXT_WRAP_SAFETY;
    const fallbackMaxWidth = 960 * boxWidth / 100 / fontSize * NATIVE_TEXT_WRAP_SAFETY;
    if (!textMeasureContext && typeof document !== 'undefined' && document.createElement) {
      const canvas = document.createElement('canvas');
      textMeasureContext = canvas.getContext && canvas.getContext('2d');
    }
    if (textMeasureContext) {
      textMeasureContext.font = `${bold ? 700 : 400} ${fontSize * 4 / 3}px "${fontFamily}"`;
    }
    const measure = candidate => textMeasureContext
      ? textMeasureContext.measureText(candidate).width
      : fallbackTextWidth(candidate);
    const maxWidth = textMeasureContext ? browserMaxWidth : fallbackMaxWidth;
    const prohibitedLineStarts = /[，。；：、？！）》」』]/;
    const lines = [];
    text.split('\n').forEach(sourceLine => {
      if (!sourceLine) {
        lines.push('');
        return;
      }
      let line = '';
      Array.from(sourceLine).forEach(char => {
        const candidate = line + char;
        if (line && measure(candidate) > maxWidth && !prohibitedLineStarts.test(char)) {
          lines.push(line);
          line = char;
        } else {
          line = candidate;
        }
      });
      lines.push(line);
    });
    return lines.join('\n');
  }

  function buildBiblePages(sectionId, label, reference, records, versesPerPage = 2, options = {}) {
    const safeRecords = Array.isArray(records) ? records : [];
    const pageSize = Math.max(1, Number(versesPerPage) || 2);
    const recordPages = [];
    let currentPage = [];
    safeRecords.forEach(record => {
      const crossesQueryGroup = currentPage.length > 0
        && currentPage[0].queryGroupKey
        && record.queryGroupKey
        && currentPage[0].queryGroupKey !== record.queryGroupKey;
      if (crossesQueryGroup || currentPage.length >= pageSize) {
        recordPages.push(currentPage);
        currentPage = [];
      }
      currentPage.push(record);
    });
    if (currentPage.length) recordPages.push(currentPage);

    const pages = [];
    recordPages.forEach(pageRecords => {
      const firstRecord = pageRecords[0];
      const hasQueryContext = firstRecord && firstRecord.queryBookName && firstRecord.queryChap != null;
      let titleReference = reference;
      if (hasQueryContext) {
        const requestedRange = String(firstRecord.querySec || '').trim();
        const firstSec = firstRecord.sec;
        const lastSec = pageRecords[pageRecords.length - 1].sec;
        const verseRange = requestedRange || (pageRecords.length === 1 ? firstSec : `${firstSec}-${lastSec}`);
        titleReference = `${firstRecord.queryBookName} ${firstRecord.queryChap}:${verseRange}`;
      }
      pages.push({
        id: `${sectionId}:${pages.length + 1}`,
        kind: 'scripture',
        title: `${label}－${titleReference}`,
        body: pageRecords.map(record => `${record.sec} ${cleanText(record.bible_text || record.text)}`).join('\n\n'),
        languageLabel: options.languageLabel || '',
        bibleVersion: options.bibleVersion || '',
        layout: {}
      });
    });
    return pages;
  }

  function composeLibraryPages(item, sectionId) {
    const pages = (Array.isArray(item && item.pptPages) ? item.pptPages : []).map(page =>
      typeof page === 'string' ? ({ kind: 'liturgical', body: page }) : ({ kind: 'liturgical', ...page })
    );
    if (item && item.includeSectionTitle) {
      const sectionPageId = sectionId ? `${sectionId}:section` : undefined;
      return [{ kind: 'section', id: sectionPageId }, ...pages];
    }
    return pages;
  }

  function composeSermonPages(item, sectionId) {
    const pastorPages = (Array.isArray(item && item.pastorPptPages) ? item.pastorPptPages : []).map((page, index) => ({
      ...page,
      kind: 'ppt-import',
      id: page.id || `${sectionId}:pastor:${index + 1}`,
      applyBackground: item.pastorPptApplyBackground !== false
    }));
    return [{ kind: 'sermon-title' }, ...pastorPages];
  }

  function applyFixedLibraryDefaults(model) {
    const fixed = [
      ['prayer-song', '261', false],
      ['offering', '306B', true],
      ['amen', '522', false]
    ];
    fixed.forEach(([sectionId, sourceValue, includeSectionTitle]) => {
      if (!model || !model[sectionId]) return;
      model[sectionId].sourceValue = sourceValue;
      model[sectionId].includeSectionTitle = includeSectionTitle;
    });
    return model;
  }

  function paginateFixedText(value, pageWeights) {
    const paragraphs = String(value || '').split(/\n\s*\n/).map(part => part.trim()).filter(Boolean);
    const weights = (Array.isArray(pageWeights) && pageWeights.length ? pageWeights : [1]).map(weight => Math.max(1, Number(weight) || 1));
    if (!paragraphs.length) return weights.map(() => ({ body: '' }));
    const pageCount = Math.min(weights.length, paragraphs.length);
    const activeWeights = weights.slice(0, pageCount);
    const totalWeight = activeWeights.reduce((sum, weight) => sum + weight, 0);
    const totalLength = paragraphs.join('\n\n').length;
    const pages = [];
    let paragraphIndex = 0;
    for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
      const remainingPages = pageCount - pageIndex - 1;
      const target = totalLength * activeWeights[pageIndex] / totalWeight;
      const parts = [];
      let length = 0;
      while (paragraphIndex < paragraphs.length - remainingPages) {
        const paragraph = paragraphs[paragraphIndex];
        parts.push(paragraph);
        paragraphIndex += 1;
        length += paragraph.length + (parts.length > 1 ? 2 : 0);
        if (length >= target) break;
      }
      pages.push({ body: parts.join('\n\n') });
    }
    return pages;
  }

  function buildDeckEntries(sectionDecks) {
    let deckNumber = 0;
    return (sectionDecks || []).flatMap((section, sectionIndex) => (section.pages || []).map((page, pageIndex) => ({
      ...page,
      id: page.id || `${section.sectionId}:${pageIndex + 1}`,
      sectionId: section.sectionId,
      sectionLabel: section.label,
      sectionIndex,
      pageIndex,
      deckNumber: ++deckNumber
    })));
  }

  function ensureLayoutState(state) {
    if (!state.groups) state.groups = {};
    if (!state.pageAssignments) state.pageAssignments = {};
    return state;
  }

  function detachPagesFromLayoutGroup(state, pageIds) {
    ensureLayoutState(state);
    (pageIds || []).forEach(pageId => {
      const groupId = state.pageAssignments[pageId];
      if (!groupId || !state.groups[groupId]) return;
      state.groups[groupId].pageIds = state.groups[groupId].pageIds.filter(id => id !== pageId);
      delete state.pageAssignments[pageId];
    });
    return state;
  }

  function createLayoutGroup(state, groupId, pageIds, params) {
    ensureLayoutState(state);
    detachPagesFromLayoutGroup(state, pageIds);
    const previous = state.groups[groupId] || { id: groupId, name: groupId, pageIds: [], params: {} };
    const uniquePageIds = Array.from(new Set([...(previous.pageIds || []), ...(pageIds || [])]));
    state.groups[groupId] = { ...previous, id: groupId, pageIds: uniquePageIds, params: { ...(params || {}) } };
    uniquePageIds.forEach(pageId => { state.pageAssignments[pageId] = groupId; });
    return state.groups[groupId];
  }

  function updateLayoutGroup(state, groupId, params) {
    ensureLayoutState(state);
    if (!state.groups[groupId]) throw new Error(`找不到版面群組：${groupId}`);
    state.groups[groupId].params = { ...(params || {}) };
    return state.groups[groupId];
  }

  function layoutForPage(state, page) {
    ensureLayoutState(state);
    const groupId = state.pageAssignments[page.id];
    const groupParams = groupId && state.groups[groupId] ? state.groups[groupId].params : {};
    return { ...(page.layout || {}), ...groupParams };
  }

  function defaultLayoutForPage(page, item) {
    if (!page || page.kind === 'ppt-import') return {};
    const defaults = { ...DEFAULT_LAYOUT_PARAMS };
    if (page.kind === 'dual-liturgical') {
      return {
        ...defaults,
        titleSize: 60,
        titleX: 6.9,
        titleY: 5.3,
        titleW: 86.2,
        titleH: 19.4,
        titleAlign: 'center',
        titleColor: '#000000',
        contentSize: 48,
        contentX: 5.9,
        contentY: 23.3,
        contentW: 42,
        contentH: 66.5,
        contentAlign: 'left',
        contentColor: '#000000',
        lineSpacing: 1.5,
        secondaryContentSize: 48,
        secondaryContentX: 51.1,
        secondaryContentY: 23.3,
        secondaryContentW: 43,
        secondaryContentH: 66.5,
        secondaryContentAlign: 'left',
        secondaryContentColor: '#0070C0',
        secondaryLineSpacing: 1.5
      };
    }
    if (page.kind === 'cover') {
      return {
        ...defaults,
        titleY: 33.5,
        titleH: 17.8,
        contentSize: 36,
        contentY: 55.8,
        contentH: 10.8,
        contentAlign: 'center',
        lineSpacing: 1.2
      };
    }
    if (page.kind === 'section') {
      const subtitle = page.body || page.kicker || (item && item.kicker) || '';
      if (subtitle && HYMN_TITLE_SECTIONS.has(page.sectionId)) {
        return {
          ...defaults,
          titleX: 4.8,
          titleY: 24.8,
          titleW: 86.3,
          titleH: 12,
          contentSize: 60,
          contentX: 4.8,
          contentY: 47.9,
          contentW: 86.3,
          contentH: 12,
          contentAlign: 'center',
          lineSpacing: 1.2
        };
      }
      return {
        ...defaults,
        titleY: subtitle ? 33.5 : 41,
        titleH: subtitle ? 17.8 : 18,
        contentSize: 36,
        contentY: 55.8,
        contentH: 10.8,
        contentAlign: 'center',
        lineSpacing: 1.2
      };
    }
    if (page.kind === 'car-notice') {
      return {
        ...defaults,
        titleSize: 60,
        titleX: 6.9,
        titleY: 28.9,
        titleW: 86.2,
        titleH: 23.8,
        titleAlign: 'center',
        titleColor: '#111111'
      };
    }
    if (page.kind === 'praise-title') {
      const song = page.title || (item && item.title) || '';
      const performer = page.kicker || (item && item.kicker) || '';
      const songLines = song ? wrapTextForBox(song, { fontSize: 36, boxWidth: 84, bold: true }).split('\n').filter(line => line.trim()).length : 0;
      const performerLines = performer ? wrapTextForBox(performer, { fontSize: 36, boxWidth: 84, bold: true }).split('\n').filter(line => line.trim()).length : 0;
      const hasDetails = Boolean(songLines || performerLines);
      const songH = songLines * 10.8;
      const performerH = performerLines * 10.8;
      const detailH = songH + performerH;
      const titleH = 17.8;
      const titleY = hasDetails
        ? Number(((100 - titleH - 4.5 - detailH) / 2).toFixed(1))
        : 41;
      const contentY = hasDetails
        ? Number((titleY + titleH + 4.5).toFixed(1))
        : 55.8;
      const secondaryContentY = hasDetails
        ? Number((contentY + songH).toFixed(1))
        : 66.6;
      return {
        ...defaults,
        titleY,
        titleH,
        titleAlign: 'center',
        contentSize: 36,
        contentX: 8,
        contentY,
        contentW: 84,
        contentH: songH || 10.8,
        contentAlign: 'center',
        contentColor: '#111111',
        lineSpacing: 1.2,
        secondaryContentSize: 36,
        secondaryContentX: 8,
        secondaryContentY,
        secondaryContentW: 84,
        secondaryContentH: performerH || 10.8,
        secondaryContentAlign: 'center',
        secondaryContentColor: '#111111',
        secondaryLineSpacing: 1.2
      };
    }
    if (page.kind === 'sermon-title') {
      const topic = page.title || (item && item.title) || '';
      const titleText = ['講道', topic].filter(Boolean).join('：');
      const details = [page.kicker || (item && item.kicker), page.body || (item && item.body)];
      const detailText = details.filter(Boolean).join('\n');
      const wrappedTitle = wrapTextForBox(titleText, {
        fontSize: defaults.titleSize,
        boxWidth: defaults.titleW,
        bold: true
      });
      const wrappedDetails = wrapTextForBox(detailText, {
        fontSize: 36,
        boxWidth: defaults.contentW,
        bold: true
      });
      const titleLineCount = Math.max(1, wrappedTitle.split('\n').filter(line => line.trim()).length);
      const lineCount = wrappedDetails ? wrappedDetails.split('\n').filter(line => line.trim()).length : 0;
      const titleH = 17.8 * titleLineCount;
      const contentH = 10.8 * lineCount;
      const titleY = Number(((100 - titleH - (lineCount ? 4.5 + contentH : 0)) / 2).toFixed(1));
      return {
        ...defaults,
        titleY,
        titleH,
        contentSize: 36,
        contentY: lineCount ? Number((titleY + titleH + 4.5).toFixed(1)) : 55.8,
        contentH: lineCount ? contentH : 10.8,
        contentAlign: 'center',
        lineSpacing: 1.2
      };
    }
    if (page.kind === 'praise-lyrics') {
      return {
        ...defaults,
        contentX: 10,
        contentY: 10,
        contentW: 80,
        contentH: 80,
        contentAlign: 'center',
        lineSpacing: 1.55
      };
    }
    if (page.kind === 'report' && item && item.reportLayout) {
      return { ...defaults, ...item.reportLayout };
    }
    return defaults;
  }

  function resolvedLayoutForPage(state, page, item) {
    return { ...defaultLayoutForPage(page, item), ...layoutForPage(state, page) };
  }

  return {
    normalizeColor,
    isSupportedBackgroundImage,
    normalizeBackgroundImageDataUrl,
    toWhiteOverlayOpacity,
    applyHymnOpacity,
    shouldApplyHymnWhiteOverlay,
    pointsToCanvasCqw,
    canvasCqwToPoints,
    wrapTextForBox,
    buildBiblePages,
    composeLibraryPages,
    composeSermonPages,
    applyFixedLibraryDefaults,
    buildDeckEntries,
    paginateFixedText,
    createLayoutGroup,
    updateLayoutGroup,
    detachPagesFromLayoutGroup,
    layoutForPage,
    defaultLayoutForPage,
    resolvedLayoutForPage
  };
});
