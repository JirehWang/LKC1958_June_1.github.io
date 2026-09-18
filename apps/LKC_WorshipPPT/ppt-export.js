(function(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TaiwaneseWorshipPptExport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(root) {

  const DEFAULT_LAYOUT_PARAMS = {
    titleSize: 60,
    titleX: 10,
    titleY: 6,
    titleW: 80,
    titleH: 16,
    titleColor: '#111111',
    contentSize: 48,
    contentX: 8,
    contentY: 24,
    contentW: 84,
    contentH: 68,
    contentColor: '#111111',
    lineSpacing: 1.5
  };
  const SECTION_SUBTITLES = {
    '會前領唱': '請準備心今天的禮拜',
    '靜默一分鐘': '請將手機關機或靜音',
    '後奏': '請後奏結束後再起身或交談',
    '平安禮': '請兄弟姊妹互相行平安禮'
  };
  const SLIDE_WIDTH = 13.333;
  const SLIDE_HEIGHT = 7.5;
  const slideX = percent => (Number(percent) / 100) * SLIDE_WIDTH;
  const slideY = percent => (Number(percent) / 100) * SLIDE_HEIGHT;

  function cleanParagraphProperties(xmlString) {
    return xmlString.replace(/<a:p>([\s\S]*?)<\/a:p>/g, (pMatch, pContent) => {
      let firstPPr = null;
      const cleanedContent = pContent.replace(/<a:pPr([\s\S]*?)<\/a:pPr>/g, (pprMatch) => {
        if (!firstPPr) {
          firstPPr = pprMatch;
          return pprMatch;
        } else {
          return '';
        }
      });
      return `<a:p>${cleanedContent}</a:p>`;
    });
  }

  const PPTX_MEDIA_PATTERN = /^ppt\/media\/[^/]+\.(?:png|jpe?g|gif|svg|webp|emf|wmf)$/i;

  function normalizePackagePath(parts) {
    const normalized = [];
    for (const part of parts) {
      if (!part || part === '.') continue;
      if (part === '..') normalized.pop();
      else normalized.push(part);
    }
    return normalized.join('/');
  }

  function relationshipSourceDirectory(relationshipName) {
    if (relationshipName === '_rels/.rels') return '';
    const sourcePartName = relationshipName
      .replace(/\/_rels\//, '/')
      .replace(/\.rels$/i, '');
    return sourcePartName.split('/').slice(0, -1).join('/');
  }

  function resolveRelationshipTarget(relationshipName, target) {
    if (!target || target.startsWith('/')) return target.replace(/^\//, '');
    const sourceDirectory = relationshipSourceDirectory(relationshipName);
    return normalizePackagePath([...sourceDirectory.split('/'), ...target.split('/')]);
  }

  function relativePackagePath(fromDirectory, targetPath) {
    const fromParts = fromDirectory ? fromDirectory.split('/') : [];
    const targetParts = targetPath.split('/');
    let commonLength = 0;
    while (commonLength < fromParts.length
      && commonLength < targetParts.length
      && fromParts[commonLength] === targetParts[commonLength]) {
      commonLength += 1;
    }
    const parentParts = new Array(fromParts.length - commonLength).fill('..');
    return [...parentParts, ...targetParts.slice(commonLength)].join('/');
  }

  function rewriteMediaRelationships(xml, relationshipName, duplicateMedia) {
    let changed = false;
    const sourceDirectory = relationshipSourceDirectory(relationshipName);
    const rewritten = xml.replace(/(<Relationship\b[^>]*\bTarget\s*=\s*["'])([^"']+)(["'])/g, (match, prefix, target, suffix) => {
      const packageTarget = resolveRelationshipTarget(relationshipName, target);
      const canonicalTarget = duplicateMedia.get(packageTarget);
      if (!canonicalTarget) return match;
      changed = true;
      return `${prefix}${relativePackagePath(sourceDirectory, canonicalTarget)}${suffix}`;
    });
    return { xml: rewritten, changed };
  }

  function fallbackMediaHash(bytes) {
    let first = 2166136261;
    let second = 2246822519;
    for (let index = 0; index < bytes.length; index += 1) {
      first = Math.imul(first ^ bytes[index], 16777619);
      second = Math.imul(second ^ (bytes[index] + index), 3266489917);
    }
    return `${bytes.length}:${first >>> 0}:${second >>> 0}`;
  }

  async function mediaContentSignature(mediaFile) {
    const bytes = await mediaFile.async('uint8array');
    const cryptoApi = root.crypto;
    if (cryptoApi && cryptoApi.subtle && typeof cryptoApi.subtle.digest === 'function') {
      const digest = new Uint8Array(await cryptoApi.subtle.digest('SHA-256', bytes));
      const digestHex = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
      return `${bytes.length}:${digestHex}`;
    }
    return fallbackMediaHash(bytes);
  }

  async function deduplicatePptxMedia(zip) {
    const mediaNames = Object.keys(zip.files || {}).filter(name => PPTX_MEDIA_PATTERN.test(name));
    const canonicalByContent = new Map();
    const duplicateMedia = new Map();

    for (const mediaName of mediaNames) {
      const mediaFile = zip.file(mediaName);
      if (!mediaFile || typeof mediaFile.async !== 'function') continue;
      const extension = mediaName.slice(mediaName.lastIndexOf('.')).toLowerCase();
      const contentKey = `${extension}:${await mediaContentSignature(mediaFile)}`;
      const canonicalName = canonicalByContent.get(contentKey);
      if (canonicalName) duplicateMedia.set(mediaName, canonicalName);
      else canonicalByContent.set(contentKey, mediaName);
    }

    if (!duplicateMedia.size) return { removed: 0, relationshipsUpdated: 0 };

    let relationshipsUpdated = 0;
    const relationshipNames = Object.keys(zip.files || {}).filter(name => name.endsWith('.rels'));
    for (const relationshipName of relationshipNames) {
      const relationshipFile = zip.file(relationshipName);
      if (!relationshipFile || typeof relationshipFile.async !== 'function') continue;
      const originalXml = await relationshipFile.async('text');
      const result = rewriteMediaRelationships(originalXml, relationshipName, duplicateMedia);
      if (result.changed) {
        zip.file(relationshipName, result.xml);
        relationshipsUpdated += 1;
      }
    }

    for (const duplicateName of duplicateMedia.keys()) zip.remove(duplicateName);
    return { removed: duplicateMedia.size, relationshipsUpdated };
  }

  async function ensurePptxExportReady(options = {}) {
    if (options.PptxGenJS || root.PptxGenJS) return;
    if (typeof document === 'undefined') return;
    const loadScript = src => new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('無法載入模組: ' + src));
      document.head.appendChild(s);
    });
    if (!root.JSZip) await loadScript('vendor-jszip.min.js?v=3.10.1');
    if (!root.PptxGenJS) await loadScript('https://cdn.jsdelivr.net/gh/gitbrent/PptxGenJS@3.12.0/dist/pptxgen.bundle.js');
  }

  async function exportWorshipPPTX(options = {}) {
    await ensurePptxExportReady(options);
    const PptxGenJSClass = options.PptxGenJS || root.PptxGenJS;
    const getDeckEntriesFn = options.getDeckEntries || root.getDeckEntries;
    const layoutState = options.layoutState || root.worshipLayoutState;
    const production = options.production || root.TaiwaneseWorshipSlideProduction;
    const model = options.model || root.model;
    const backgroundColor = options.backgroundColor || root.backgroundColor;
    const backgroundImage = options.backgroundImage || root.backgroundImage;
    const templateProfile = options.templateProfile || root.activeWorshipTemplateProfile || {};
    const templateAssets = options.templateAssets || root.worshipTemplateAssets || {};
    const reflowReportPagesFn = options.reflowReportPages || root.reflowReportPagesForLayout;
    const nativePptx = options.nativePptx || root.WorshipNativePptx;
    const pptxLibrary = options.pptxLibrary || root.TaiwaneseWorshipPptxLibrary;
    const serviceDate = options.serviceDate || (document.getElementById('service-date') && document.getElementById('service-date').value) || '';
    const outputScale = layoutState && layoutState.outputScale || {};
    const normalizeScale = value => Math.max(80, Math.min(120, Number(value) || 100));
    const textScale = normalizeScale(outputScale.text) / 100;
    const imageScale = normalizeScale(outputScale.image) / 100;
    const scaledFont = value => Number(value) * textScale;
    const wrapNativeText = (value, params, prefix, boxWidthMultiplier = 1) => production.wrapTextForBox
      ? production.wrapTextForBox(value, {
          fontSize: scaledFont(params[`${prefix}Size`]),
          boxWidth: Number(params[`${prefix}W`]) * boxWidthMultiplier,
          bold: true
        })
      : value;

    if (!PptxGenJSClass) throw new Error('找不到 PptxGenJS 簡報庫');
    if (!getDeckEntriesFn) throw new Error('找不到 getDeckEntries 函式');
    if (!layoutState) throw new Error('找不到 layoutState');

    const pptx = new PptxGenJSClass();
    pptx.layout = 'LAYOUT_WIDE';

    if (typeof reflowReportPagesFn === 'function') reflowReportPagesFn();
    const rawDeck = getDeckEntriesFn();
    const deck = (rawDeck || []).filter(entry => {
      if (entry && entry.includeInExport === false) return false;
      const modelEntry = model && model[entry.sectionId];
      if (modelEntry && modelEntry.includeInExport === false) return false;
      return true;
    });
    if (!deck || !deck.length) {
      throw new Error('沒有可匯出的投影片');
    }
    const hasNativeEntries = deck.some(entry => entry && entry.nativeExport);

    const bgFill = (backgroundColor || '#ffffff').replace('#', '');
    
    // Resolve rect shape type
    let rectShapeType = null;
    if (pptx.ShapeType && typeof pptx.ShapeType.rect !== 'undefined') {
      rectShapeType = pptx.ShapeType.rect;
    } else if (pptx.shapes && typeof pptx.shapes.RECTANGLE !== 'undefined') {
      rectShapeType = pptx.shapes.RECTANGLE;
    } else {
      rectShapeType = 'rect';
    }

    deck.forEach(entry => {
      const slide = pptx.addSlide();

      // 1. Background
      const isDarkTemplatePage = entry.kind === 'offering-guide' || entry.kind === 'thanksgiving';
      const applyBackground = entry.applyBackground !== false;
      const standardBackground = applyBackground ? backgroundImage || templateAssets.background : '';
      if (isDarkTemplatePage) {
        slide.background = { fill: '000000' };
      } else if (standardBackground) {
        slide.background = { data: standardBackground };
      } else {
        slide.background = { fill: applyBackground ? bgFill : 'FFFFFF' };
      }

      // 2. White Overlay for hymns
      const hasHymnWhiteOverlay = production.shouldApplyHymnWhiteOverlay
        ? production.shouldApplyHymnWhiteOverlay(entry, root.hymnOpacitySectionIds || [])
        : (entry.kind === 'ppt-import' || entry.kind === 'score') && (root.hymnOpacitySectionIds || []).includes(entry.sectionId);
      if (hasHymnWhiteOverlay && model && model[entry.sectionId]) {
        const opacityVal = model[entry.sectionId].opacity || 60;
        const transparency = 100 - opacityVal; // 60% opacity -> 40% transparency
        slide.addShape(rectShapeType, {
          x: 0,
          y: 0,
          w: SLIDE_WIDTH,
          h: SLIDE_HEIGHT,
          fill: { color: 'FFFFFF', transparency: transparency }
        });
      }

      // 3. Layout Parameters
      const storedParams = production.layoutForPage(layoutState, entry) || {};
      const modelEntry = model && model[entry.sectionId];
      const titlePageTopic = entry.title || (modelEntry && modelEntry.title) || '';
      const titlePageTitle = entry.kind === 'praise-title'
        ? '讚美'
        : entry.kind === 'sermon-title'
          ? ['講道', titlePageTopic].filter(Boolean).join('：')
          : '';
      const titlePageDetails = entry.kind === 'praise-title'
        ? [titlePageTopic, entry.kicker || (modelEntry && modelEntry.kicker)].filter(Boolean)
        : entry.kind === 'sermon-title'
          ? [entry.kicker || (modelEntry && modelEntry.kicker), entry.body || (modelEntry && modelEntry.body)].filter(Boolean)
          : [];
      const centeredBody = titlePageDetails.join('\n') || entry.body || entry.kicker || (modelEntry && modelEntry.kicker) || SECTION_SUBTITLES[entry.sectionLabel] || '';
      const usesCenteredTemplate = ['cover', 'section', 'praise-title', 'sermon-title'].includes(entry.kind);
      const hasCenteredSubtitle = entry.kind === 'cover' || Boolean(centeredBody);
      const centeredLineCount = hasCenteredSubtitle
        ? Math.max(1, String(centeredBody).split('\n').filter(line => line.trim()).length)
        : 0;
      const centeredContentH = 10.8 * centeredLineCount;
      const centeredTitleY = Number(((100 - 17.8 - 4.5 - centeredContentH) / 2).toFixed(1));
      const centeredTemplateDefaults = usesCenteredTemplate ? {
        titleY: hasCenteredSubtitle ? centeredTitleY : 41,
        titleH: hasCenteredSubtitle ? 17.8 : 18,
        titleAlign: 'center',
        contentSize: 36,
        contentY: hasCenteredSubtitle ? Number((centeredTitleY + 17.8 + 4.5).toFixed(1)) : 55.8,
        contentH: hasCenteredSubtitle ? centeredContentH : 10.8,
        contentAlign: 'center',
        lineSpacing: 1.2
      } : {};
      const praiseLyricsDefaults = entry.kind === 'praise-lyrics' ? {
        contentX: 10,
        contentY: 10,
        contentW: 80,
        contentH: 80,
        contentAlign: 'center',
        lineSpacing: 1.55
      } : {};
      const params = production.resolvedLayoutForPage
        ? production.resolvedLayoutForPage(layoutState, entry, modelEntry)
        : entry.kind === 'ppt-import'
          ? storedParams
          : { ...DEFAULT_LAYOUT_PARAMS, ...centeredTemplateDefaults, ...praiseLyricsDefaults, ...storedParams };
      const hasStoredTitleBounds = ['titleX', 'titleY', 'titleW', 'titleH']
        .some(key => Object.prototype.hasOwnProperty.call(storedParams, key));
      const hasStoredContentBounds = ['contentX', 'contentY', 'contentW', 'contentH']
        .some(key => Object.prototype.hasOwnProperty.call(storedParams, key));

      const titleColor = (params.titleColor || '#111111').replace('#', '');
      const contentColor = (params.contentColor || '#111111').replace('#', '');

      // 4. Render Slide Content by kind
      if (entry.nativeExport) {
        // The original slide XML is merged back after PptxGenJS creates the
        // surrounding package. Do not rebuild source objects from the preview.
      } else if (entry.kind === 'ppt-import') {
        const finalObjects = getImportedSlideObjects(entry, params, production);
        finalObjects.forEach(obj => {
          if (obj.type === 'image' && obj.src) {
            const scaledObject = entry.rasterized ? {
              ...obj,
              x: Number(obj.x) + Number(obj.w) * (1 - imageScale) / 2,
              y: Number(obj.y) + Number(obj.h) * (1 - imageScale) / 2,
              w: Number(obj.w) * imageScale,
              h: Number(obj.h) * imageScale
            } : obj;
            slide.addImage({
              data: obj.src,
              x: slideX(scaledObject.x),
              y: slideY(scaledObject.y),
              w: slideX(scaledObject.w),
              h: slideY(scaledObject.h)
            });
          } else if (obj.type === 'text' && Array.isArray(obj.runs)) {
            const runsArray = obj.runs.map(run => ({
              text: run.text,
              options: {
                fontSize: scaledFont(run.fontSize),
                color: (run.color || obj.color || '#000000').replace('#', ''),
                bold: run.bold,
                italic: run.italic,
                underline: run.underline,
                fontFace: run.fontFamily || obj.fontFamily
              }
            }));
            const verticalAlignMap = { start: 'top', center: 'middle', end: 'bottom' };
            slide.addText(runsArray, {
              x: slideX(obj.x),
              y: slideY(obj.y),
              w: slideX(obj.w),
              h: slideY(obj.h),
              align: obj.align || 'left',
              valign: verticalAlignMap[obj.verticalAlign] || 'top',
              lineSpacing: obj.lineSpacing ? scaledFont(obj.lineSpacing) : undefined,
              margin: 0
            });
          }
        });
      } else if (entry.kind === 'cover') {
        const [year, month, day] = serviceDate ? serviceDate.split('-') : [];
        const formattedDate = serviceDate ? `主後${year}年${month}月${day}日` : '';
        // Title
        slide.addText(templateProfile.coverTitle || '台語主日禮拜', {
          x: slideX(params.titleX),
          y: slideY(params.titleY),
          w: slideX(params.titleW),
          h: slideY(params.titleH),
          fontSize: scaledFont(params.titleSize || 60),
          color: titleColor,
          fontFace: 'Microsoft JhengHei',
          align: params.titleAlign || 'center',
          valign: 'top',
          bold: true,
          margin: 0
        });
        // Date
        slide.addText(formattedDate, {
          x: slideX(params.contentX),
          y: slideY(params.contentY),
          w: slideX(params.contentW),
          h: slideY(params.contentH),
          fontSize: scaledFont(params.contentSize || 48),
          color: contentColor,
          fontFace: 'Microsoft JhengHei',
          align: params.contentAlign || 'center',
          valign: 'top',
          bold: true,
          margin: 0
        });
      } else if (entry.kind === 'dual-liturgical') {
        const primaryText = [entry.primaryLabel ? `(${entry.primaryLabel})` : '', entry.primaryBody || ''].filter(Boolean).join('\n');
        const secondaryText = [entry.secondaryLabel ? `(${entry.secondaryLabel})` : '', entry.secondaryBody || ''].filter(Boolean).join('\n');
        const showTitle = entry.showTitle !== false;
        if (showTitle && (entry.title || entry.sectionLabel)) {
          slide.addText(wrapNativeText(entry.title || entry.sectionLabel, params, 'title'), {
            x: slideX(params.titleX), y: slideY(params.titleY),
            w: slideX(params.titleW), h: slideY(params.titleH),
            fontSize: scaledFont(params.titleSize || 60),
            color: (params.titleColor || '#000000').replace('#', ''),
            fontFace: 'Microsoft JhengHei', align: params.titleAlign || 'center',
            valign: 'top', bold: true, margin: 0
          });
        }
        slide.addText(wrapNativeText(primaryText, params, 'content', 1 / 0.92), {
          x: slideX(params.contentX), y: slideY(params.contentY),
          w: slideX(params.contentW), h: slideY(params.contentH),
          fontSize: scaledFont(params.contentSize || 48),
          color: (params.contentColor || entry.primaryColor || '#000000').replace('#', ''),
          fontFace: 'Microsoft JhengHei', align: params.contentAlign || 'left',
          valign: 'top', bold: true,
          lineSpacing: Math.round(scaledFont(params.contentSize || 48) * (params.lineSpacing || 1.5)),
          margin: 0
        });
        slide.addText(wrapNativeText(secondaryText, params, 'secondaryContent', 1 / 0.92), {
          x: slideX(params.secondaryContentX), y: slideY(params.secondaryContentY),
          w: slideX(params.secondaryContentW), h: slideY(params.secondaryContentH),
          fontSize: scaledFont(params.secondaryContentSize || 48),
          color: (params.secondaryContentColor || entry.secondaryColor || '#0070C0').replace('#', ''),
          fontFace: 'Microsoft JhengHei', align: params.secondaryContentAlign || 'left',
          valign: 'top', bold: true,
          lineSpacing: Math.round(scaledFont(params.secondaryContentSize || 48) * (params.secondaryLineSpacing || 1.5)),
          margin: 0
        });
      } else if (entry.kind === 'full-image') {
        const imageData = templateAssets[entry.assetKey] || entry.src;
        if (imageData) slide.addImage({ data: imageData, x: 0, y: 0, w: SLIDE_WIDTH, h: SLIDE_HEIGHT });
      } else if (entry.kind === 'offering-guide') {
        slide.addText(entry.title || '【奉獻】', {
          x: 0, y: 0.35, w: SLIDE_WIDTH, h: 0.85,
          fontSize: scaledFont(66.7), color: 'FFFFFF', fontFace: 'Microsoft JhengHei',
          align: 'center', valign: 'middle', bold: true, margin: 0
        });
        const lines = String(entry.body || '').split('\n');
        lines.forEach((line, index) => {
          const color = index === 2 || index === 3 ? 'FF6699' : 'FFFFFF';
          slide.addText(line, {
            x: 0.6, y: 1.45 + index * 0.78, w: 12.1, h: 0.72,
            fontSize: scaledFont(50.7), color, fontFace: 'Microsoft JhengHei',
            align: 'center', valign: 'middle', bold: index === 2 || index === 3, margin: 0
          });
        });
      } else if (entry.kind === 'thanksgiving') {
        slide.addText(entry.body || '', {
          x: 0.25, y: 0.12, w: 12.83, h: 6.35,
          fontSize: scaledFont(50.7), color: 'FFFFFF', fontFace: 'Microsoft JhengHei',
          align: 'center', valign: 'top', bold: true, lineSpacing: scaledFont(58), margin: 0
        });
        slide.addText(entry.title || '獻上感恩', {
          x: 4.22, y: 6.45, w: 4.89, h: 0.7,
          fontSize: scaledFont(58.7), color: 'FFFFFF', fontFace: 'Microsoft JhengHei',
          align: 'center', valign: 'middle', bold: true, underline: true, margin: 0
        });
      } else if (entry.kind === 'praise-title' || entry.kind === 'sermon-title') {
        slide.addText(wrapNativeText(titlePageTitle, params, 'title'), {
          x: slideX(params.titleX),
          y: slideY(params.titleY),
          w: slideX(params.titleW),
          h: slideY(params.titleH),
          fontSize: scaledFont(params.titleSize || 60),
          color: titleColor,
          fontFace: 'Microsoft JhengHei',
          align: params.titleAlign || 'center',
          valign: 'top',
          bold: true,
          margin: 0
        });
        const titlePageContent = entry.kind === 'praise-title' ? titlePageTopic : titlePageDetails.join('\n');
        if (titlePageContent) slide.addText(wrapNativeText(titlePageContent, params, 'content'), {
          x: slideX(params.contentX),
          y: slideY(params.contentY),
          w: slideX(params.contentW),
          h: slideY(params.contentH),
          fontSize: scaledFont(params.contentSize || 48),
          color: contentColor,
          fontFace: 'Microsoft JhengHei',
          align: params.contentAlign || 'center',
          valign: 'top',
          bold: true,
          lineSpacing: params.lineSpacing ? Math.round(scaledFont(params.contentSize) * params.lineSpacing) : undefined,
          margin: 0
        });
        if (entry.kind === 'praise-title') {
          const performer = entry.kicker || (modelEntry && modelEntry.kicker) || '';
          if (performer) slide.addText(wrapNativeText(performer, params, 'secondaryContent'), {
            x: slideX(params.secondaryContentX == null ? 8 : params.secondaryContentX),
            y: slideY(params.secondaryContentY == null ? Number(params.contentY) + 10.8 : params.secondaryContentY),
            w: slideX(params.secondaryContentW || 84), h: slideY(params.secondaryContentH || 10.8),
            fontSize: scaledFont(params.secondaryContentSize || 36),
            color: (params.secondaryContentColor || '#111111').replace('#', ''),
            fontFace: 'Microsoft JhengHei', align: params.secondaryContentAlign || 'center',
            valign: 'top', bold: true, margin: 0
          });
        }
      } else if (entry.kind === 'praise-lyrics') {
        slide.addText(wrapNativeText(entry.body || '', params, 'content'), {
          x: slideX(params.contentX),
          y: slideY(params.contentY),
          w: slideX(params.contentW),
          h: slideY(params.contentH),
          fontSize: scaledFont(params.contentSize || 48),
          color: contentColor,
          fontFace: 'Microsoft JhengHei',
          align: params.contentAlign || 'center',
          valign: 'top',
          bold: true,
          lineSpacing: params.lineSpacing ? Math.round(scaledFont(params.contentSize) * params.lineSpacing) : undefined,
          margin: 0
        });
      } else if (entry.kind === 'car-notice') {
        const noticeText = entry.title || (modelEntry && modelEntry.title) || '敬請停在車道的車主儘快移車';
        slide.addText(wrapNativeText(noticeText, params, 'title', 1 / 0.92), {
          x: slideX(params.titleX != null ? params.titleX : 6.9),
          y: slideY(params.titleY != null ? params.titleY : 28.9),
          w: slideX(params.titleW != null ? params.titleW : 86.2),
          h: slideY(params.titleH != null ? params.titleH : 23.8),
          fontSize: scaledFont(params.titleSize || 60),
          color: (params.titleColor || '#111111').replace('#', ''),
          fontFace: 'Microsoft JhengHei',
          align: params.titleAlign || 'center',
          valign: 'middle',
          bold: true,
          margin: 0
        });
      } else if (entry.kind === 'score') {
        const titleText = entry.title || (model && model[entry.sectionId] && model[entry.sectionId].title) || entry.sectionLabel || '';
        const kicker = entry.kicker || (model && model[entry.sectionId] && model[entry.sectionId].kicker) || '';
        // Title
        slide.addText(wrapNativeText(titleText, params, 'title'), {
          x: slideX(params.titleX),
          y: slideY(params.titleY),
          w: slideX(params.titleW),
          h: slideY(params.titleH),
          fontSize: scaledFont(params.titleSize || 60),
          color: titleColor,
          fontFace: 'Microsoft JhengHei',
          align: params.titleAlign || 'center',
          valign: 'top',
          bold: true,
          margin: 0
        });
        // Kicker/Sub
        if (kicker) {
          slide.addText(wrapNativeText(kicker, params, 'content'), {
            x: slideX(params.contentX),
            y: slideY(params.contentY || 24),
            w: slideX(params.contentW),
            h: 1.3333,
            fontSize: scaledFont(params.contentSize || 48),
            color: contentColor,
            fontFace: 'Microsoft JhengHei',
            align: params.contentAlign || 'center',
            valign: 'top',
            bold: true,
            margin: 0
          });
        }
        // Score slot dashed box
        slide.addShape(rectShapeType, {
          x: 1.3333,
          y: 4.2667,
          w: 10.6664,
          h: 2.6667,
          fill: { color: 'FFFFFF', transparency: 30 },
          line: { color: '999999', width: 1, dashType: 'dash' }
        });
      } else {
        // Standard page: title and content
        const showTitle = entry.showTitle !== false;
        const titleText = entry.title || (model && model[entry.sectionId] && model[entry.sectionId].title) || entry.sectionLabel || '';
        
        if (showTitle && titleText) {
          slide.addText(wrapNativeText(titleText, params, 'title'), {
            x: slideX(params.titleX),
            y: slideY(params.titleY),
            w: slideX(params.titleW),
            h: slideY(params.titleH),
            fontSize: scaledFont(params.titleSize || 60),
            color: titleColor,
            fontFace: 'Microsoft JhengHei',
            align: params.titleAlign || 'center',
            // The browser preview anchors text at the top of an explicitly
            // positioned title box. Centering it vertically in PowerPoint
            // moves tall shared-layout titles down into the body box.
            valign: 'top',
            bold: true,
            margin: 0
          });
        }

        // Subtitles mapping
        const defaultBody = entry.kicker || (modelEntry && modelEntry.kicker) || SECTION_SUBTITLES[entry.sectionLabel] || '';
        const bodyText = entry.kind === 'scripture' && entry.languageLabel
          ? [`(${entry.languageLabel})`, entry.body || defaultBody].filter(Boolean).join('\n')
          : entry.body || defaultBody;

        if (bodyText) {
          slide.addText(wrapNativeText(bodyText, params, 'content'), {
            x: slideX(params.contentX),
            y: slideY(params.contentY),
            w: slideX(params.contentW),
            h: slideY(params.contentH),
            fontSize: scaledFont(params.contentSize || 48),
            color: contentColor,
            fontFace: 'Microsoft JhengHei',
            align: params.contentAlign || (entry.kind === 'section' ? 'center' : 'left'),
            valign: 'top',
            bold: true,
            lineSpacing: params.lineSpacing ? Math.round(scaledFont(params.contentSize) * params.lineSpacing) : undefined,
            margin: 0
          });
        }
      }
    });

    const fileDate = serviceDate || new Date().toISOString().split('T')[0];
    const fileName = `${templateProfile.filenamePrefix || '台語主日禮拜'}_${fileDate}.pptx`;

    if (typeof pptx.write === 'function' && typeof document !== 'undefined') {
      return pptx.write({ outputType: 'blob', compression: true }).then(async (blob) => {
        const JSZipLib = options.JSZip || root.JSZip;
        if (!JSZipLib) {
          if (hasNativeEntries) throw new Error('原生 PPTX 匯出元件尚未載入');
          return options.returnBlob ? blob : pptx.writeFile({ fileName: fileName });
        }

        const zip = await JSZipLib.loadAsync(blob);
        if (hasNativeEntries) {
          if (!nativePptx || typeof nativePptx.merge !== 'function') {
            throw new Error('原生 PPTX 合併元件尚未載入');
          }
          if (!pptxLibrary || typeof pptxLibrary.getNativeSource !== 'function') {
            throw new Error('原始 PPTX 來源尚未載入');
          }
          await nativePptx.merge(zip, deck, ref => pptxLibrary.getNativeSource(ref));
        }

        const files = Object.keys(zip.files);
        for (const name of files) {
          if (name.startsWith('ppt/slides/slide') && name.endsWith('.xml')) {
            const originalXml = await zip.file(name).async('text');
            const cleanedXml = cleanParagraphProperties(originalXml);
            zip.file(name, cleanedXml);
          }
        }
        await deduplicatePptxMedia(zip);
        const cleanedBlob = await zip.generateAsync({
          type: 'blob',
          mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          compression: 'DEFLATE'
        });
        if (options.returnBlob) return cleanedBlob;
        const url = URL.createObjectURL(cleanedBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          URL.revokeObjectURL(url);
          document.body.removeChild(a);
        }, 100);
        return;
      });
    }

    return pptx.writeFile({ fileName: fileName });
  }

  function getImportedSlideObjects(page, params, production) {
    const objects = page.objects || [];
    const textObjects = objects.filter(obj => obj.type === 'text');
    
    const computeRoleBounds = (role) => {
      const roleObjects = textObjects.filter(obj => obj.role === role);
      if (!roleObjects.length) return null;
      const x = Math.min(...roleObjects.map(obj => obj.x));
      const y = Math.min(...roleObjects.map(obj => obj.y));
      const right = Math.max(...roleObjects.map(obj => obj.x + obj.w));
      const bottom = Math.max(...roleObjects.map(obj => obj.y + obj.h));
      return { x, y, w: right - x, h: bottom - y };
    };

    const titleBounds = computeRoleBounds('title');
    const contentBounds = computeRoleBounds('content');

    return objects.map(obj => {
      if (obj.type === 'image') {
        return { ...obj };
      }
      
      const prefix = obj.role === 'title' ? 'title' : 'content';
      const bounds = obj.role === 'title' ? titleBounds : contentBounds;
      if (!bounds || params[`${prefix}X`] == null) {
        return { ...obj };
      }
      
      const scaleX = Number(params[`${prefix}W`]) / Math.max(bounds.w, 0.01);
      const scaleY = Number(params[`${prefix}H`]) / Math.max(bounds.h, 0.01);

      const finalX = Number(params[`${prefix}X`]) + (obj.x - bounds.x) * scaleX;
      const finalY = Number(params[`${prefix}Y`]) + (obj.y - bounds.y) * scaleY;
      const finalW = obj.w * scaleX;
      const finalH = obj.h * scaleY;

      const mappedRuns = (obj.runs || []).map(run => {
        const sourceBaseSize = Number(obj.fontSize) || 18;
        const relativeSize = (Number(run.fontSize) || sourceBaseSize) / sourceBaseSize;
        const finalFontSize = (Number(params[`${prefix}Size`]) * relativeSize); 
        const finalColor = params[`${prefix}Color`] || run.color || obj.color || '#000000';

        return {
          ...run,
          fontSize: Number(finalFontSize.toFixed(1)),
          color: finalColor
        };
      });

      return {
        ...obj,
        x: finalX,
        y: finalY,
        w: finalW,
        h: finalH,
        align: params[`${prefix}Align`] || obj.align || 'left',
        runs: mappedRuns,
        lineSpacing: params.lineSpacing ? Math.round((Number(params[`${prefix}Size`]) || 18) * params.lineSpacing) : undefined
      };
    });
  }

  return {
    exportWorshipPPTX,
    getImportedSlideObjects,
    cleanParagraphProperties,
    deduplicatePptxMedia
  };
});
