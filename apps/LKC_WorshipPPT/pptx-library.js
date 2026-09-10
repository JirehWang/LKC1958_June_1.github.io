(function(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TaiwaneseWorshipPptxLibrary = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(root) {
  const PPT_WIDTH_EMU = 12192000;
  const PPT_HEIGHT_EMU = 6858000;
  const PPT_ASPECT_RATIO = 16 / 9;

  function isSixteenByNine(width, height, tolerance = 0.001) {
    const slideWidth = Number(width);
    const slideHeight = Number(height);
    if (!(slideWidth > 0 && slideHeight > 0)) return false;
    return Math.abs(slideWidth / slideHeight - PPT_ASPECT_RATIO) <= tolerance;
  }

  function normalizeLibraryNumber(value) {
    const match = String(value || '').toUpperCase().match(/0*(\d+)\s*([A-Z])?/);
    return match ? `${Number(match[1])}${match[2] || ''}` : '';
  }

  function parseLibraryFilename(fileName, kind) {
    const name = String(fileName || '').trim();
    if (kind === 'hymn') {
      const match = name.match(/^第\s*0*(\d+)\s*([A-Za-z]?)\s*首\s*(.*?)\.pptx$/i);
      if (!match) return null;
      return { kind, number: `${Number(match[1])}${match[2].toUpperCase()}`, title: match[3].trim() };
    }
    if (kind === 'response') {
      const match = name.match(/^0*(\d+)\.pptx$/i);
      if (!match) return null;
      const number = String(Number(match[1]));
      return { kind, number, title: `啟應文 ${number}` };
    }
    return null;
  }

  function findLibraryEntry(entries, kind, sourceValue) {
    const number = normalizeLibraryNumber(sourceValue);
    return (Array.isArray(entries) ? entries : []).find(entry =>
      entry.kind === kind && normalizeLibraryNumber(entry.number) === number
    ) || null;
  }

  function groupTransform(xfrm, parent) {
    const base = parent || { sx: 1, sy: 1, tx: 0, ty: 0 };
    const xScale = (Number(xfrm.extX) || 1) / (Number(xfrm.chExtX) || Number(xfrm.extX) || 1);
    const yScale = (Number(xfrm.extY) || 1) / (Number(xfrm.chExtY) || Number(xfrm.extY) || 1);
    return {
      sx: base.sx * xScale,
      sy: base.sy * yScale,
      tx: base.tx + base.sx * ((Number(xfrm.offX) || 0) - (Number(xfrm.chOffX) || 0) * xScale),
      ty: base.ty + base.sy * ((Number(xfrm.offY) || 0) - (Number(xfrm.chOffY) || 0) * yScale)
    };
  }

  function mapRect(rect, transform) {
    const map = transform || { sx: 1, sy: 1, tx: 0, ty: 0 };
    return {
      x: map.tx + map.sx * (Number(rect.x) || 0),
      y: map.ty + map.sy * (Number(rect.y) || 0),
      w: map.sx * (Number(rect.w) || 0),
      h: map.sy * (Number(rect.h) || 0)
    };
  }

  const round = value => Number(Number(value).toFixed(4));
  function rectToPercent(rect, width, height) {
    const slideWidth = Number(width) || PPT_WIDTH_EMU;
    const slideHeight = Number(height) || PPT_HEIGHT_EMU;
    return {
      x: round(rect.x / slideWidth * 100),
      y: round(rect.y / slideHeight * 100),
      w: round(rect.w / slideWidth * 100),
      h: round(rect.h / slideHeight * 100)
    };
  }

  function base64ToArrayBuffer(base64) {
    const binary = atob(String(base64 || ''));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes.buffer;
  }

  const directChildren = (node, localName) => Array.from(node ? node.childNodes : []).filter(child => child.nodeType === 1 && child.localName === localName);
  const directChild = (node, localName) => directChildren(node, localName)[0] || null;
  const firstDescendant = (node, localName) => Array.from(node ? node.getElementsByTagNameNS('*', localName) : [])[0] || null;

  function parseSourceRect(shape) {
    const sourceRect = firstDescendant(shape, 'srcRect');
    if (!sourceRect) return null;
    const value = name => {
      const parsed = Number(sourceRect.getAttribute(name));
      return Number.isFinite(parsed) ? parsed / 100000 : 0;
    };
    return {
      left: value('l'),
      top: value('t'),
      right: value('r'),
      bottom: value('b')
    };
  }
  const intAttr = (node, name, fallback = 0) => node ? Number(node.getAttribute(name) || fallback) : fallback;

  function parseTransform(node) {
    const off = directChild(node, 'off');
    const ext = directChild(node, 'ext');
    const chOff = directChild(node, 'chOff');
    const chExt = directChild(node, 'chExt');
    return {
      offX: intAttr(off, 'x'), offY: intAttr(off, 'y'),
      extX: intAttr(ext, 'cx'), extY: intAttr(ext, 'cy'),
      chOffX: intAttr(chOff, 'x'), chOffY: intAttr(chOff, 'y'),
      chExtX: intAttr(chExt, 'cx'), chExtY: intAttr(chExt, 'cy')
    };
  }

  function shapeRect(shape, transform) {
    const properties = directChild(shape, 'spPr') || directChild(shape, 'grpSpPr');
    const xfrm = properties && directChild(properties, 'xfrm');
    if (!xfrm) return null;
    const parsed = parseTransform(xfrm);
    return mapRect({ x: parsed.offX, y: parsed.offY, w: parsed.extX, h: parsed.extY }, transform);
  }

  const presetColors = { black: '#000000', white: '#ffffff', red: '#ff0000', blue: '#0000ff', yellow: '#ffff00', green: '#008000' };
  const defaultColorMap = { bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2', accent1: 'accent1', accent2: 'accent2', accent3: 'accent3', accent4: 'accent4', accent5: 'accent5', accent6: 'accent6' };

  function resolveSchemeColor(value, themeColors, colorMap) {
    const mapped = (colorMap && colorMap[value]) || defaultColorMap[value] || value;
    return (themeColors && themeColors[mapped]) || '';
  }

  function parseThemeColors(themeDocument) {
    const scheme = themeDocument && firstDescendant(themeDocument, 'clrScheme');
    const colors = {};
    Array.from(scheme ? scheme.childNodes : []).filter(node => node.nodeType === 1).forEach(node => {
      const valueNode = Array.from(node.childNodes).find(child => child.nodeType === 1);
      if (!valueNode) return;
      const value = valueNode.localName === 'sysClr' ? valueNode.getAttribute('lastClr') : valueNode.getAttribute('val');
      if (value) colors[node.localName] = `#${value}`;
    });
    return colors;
  }

  function parseColorMap(masterDocument) {
    const colorMap = { ...defaultColorMap };
    const node = masterDocument && firstDescendant(masterDocument, 'clrMap');
    if (!node) return colorMap;
    Object.keys(defaultColorMap).forEach(key => {
      if (node.getAttribute(key)) colorMap[key] = node.getAttribute(key);
    });
    return colorMap;
  }

  function parseRunStyle(runProperties, colorContext) {
    if (!runProperties) return {};
    const solidFill = directChild(runProperties, 'solidFill');
    const rgb = solidFill && directChild(solidFill, 'srgbClr');
    const preset = solidFill && directChild(solidFill, 'prstClr');
    const scheme = solidFill && directChild(solidFill, 'schemeClr');
    const eastAsian = directChild(runProperties, 'ea');
    const latin = directChild(runProperties, 'latin');
    const color = rgb
      ? `#${rgb.getAttribute('val')}`
      : presetColors[preset && preset.getAttribute('val')]
        || resolveSchemeColor(scheme && scheme.getAttribute('val'), colorContext && colorContext.themeColors, colorContext && colorContext.colorMap);
    return {
      fontSize: intAttr(runProperties, 'sz') ? intAttr(runProperties, 'sz') / 100 : undefined,
      bold: runProperties.getAttribute('b') === '1',
      italic: runProperties.getAttribute('i') === '1',
      underline: !['', 'none'].includes(runProperties.getAttribute('u') || ''),
      fontFamily: (eastAsian && eastAsian.getAttribute('typeface')) || (latin && latin.getAttribute('typeface')) || undefined,
      color: color || undefined
    };
  }

  function placeholderKey(shape) {
    const nonVisual = directChild(shape, 'nvSpPr');
    const properties = nonVisual && directChild(nonVisual, 'nvPr');
    const placeholder = properties && directChild(properties, 'ph');
    if (!placeholder) return '';
    return `${placeholder.getAttribute('type') || 'body'}:${placeholder.getAttribute('idx') || ''}`;
  }

  function placeholderFontSizes(layoutDocument) {
    const sizes = {};
    Array.from(layoutDocument ? layoutDocument.getElementsByTagNameNS('*', 'sp') : []).forEach(shape => {
      const key = placeholderKey(shape);
      if (!key) return;
      const textBody = directChild(shape, 'txBody');
      const listStyle = textBody && directChild(textBody, 'lstStyle');
      const level = listStyle && directChild(listStyle, 'lvl1pPr');
      const defaultRun = level && directChild(level, 'defRPr');
      const size = intAttr(defaultRun, 'sz') / 100;
      if (size > 0) sizes[key] = size;
    });
    return sizes;
  }

  function inheritRunStyle(style, inheritedFontSize) {
    const size = Number(inheritedFontSize);
    return !style.fontSize && size > 0 ? { ...style, fontSize: size } : style;
  }

  function parseTextShape(shape, transform, slideWidth, slideHeight, colorContext, inheritedFontSizes) {
    const txBody = directChild(shape, 'txBody');
    const rect = shapeRect(shape, transform);
    if (!txBody || !rect) return null;
    const paragraphs = directChildren(txBody, 'p');
    const runs = [];
    const inheritedFontSize = inheritedFontSizes && inheritedFontSizes[placeholderKey(shape)];
    paragraphs.forEach((paragraph, paragraphIndex) => {
      if (paragraphIndex) runs.push({ text: '\n' });
      Array.from(paragraph.childNodes).filter(node => node.nodeType === 1).forEach(run => {
        if (run.localName === 'br') {
          runs.push({ text: '\n' });
          return;
        }
        if (!['r', 'fld'].includes(run.localName)) return;
        const textNode = directChild(run, 't');
        if (textNode) runs.push({ text: textNode.textContent || '', ...inheritRunStyle(parseRunStyle(directChild(run, 'rPr'), colorContext), inheritedFontSize) });
      });
    });
    const text = runs.map(run => run.text).join('');
    if (!text.trim()) return null;
    const paragraphProperties = paragraphs[0] && directChild(paragraphs[0], 'pPr');
    const alignmentMap = { l: 'left', ctr: 'center', r: 'right', just: 'justify', dist: 'justify' };
    const bodyProperties = directChild(txBody, 'bodyPr');
    const firstStyledRun = runs.find(run => run.fontSize || run.fontFamily || run.color || run.bold);
    const percent = rectToPercent(rect, slideWidth, slideHeight);
    return {
      type: 'text', text, runs, ...percent,
      role: percent.y < 18 ? 'title' : 'content',
      align: alignmentMap[paragraphProperties && paragraphProperties.getAttribute('algn')] || 'left',
      verticalAlign: ({ ctr: 'center', b: 'end' })[bodyProperties && bodyProperties.getAttribute('anchor')] || 'start',
      fontSize: (firstStyledRun && firstStyledRun.fontSize) || 18,
      fontFamily: (firstStyledRun && firstStyledRun.fontFamily) || 'Microsoft JhengHei',
      color: (firstStyledRun && firstStyledRun.color) || '#000000',
      bold: Boolean(firstStyledRun && firstStyledRun.bold)
    };
  }

  function parsePicture(shape, transform, slideWidth, slideHeight, relationships) {
    const rect = shapeRect(shape, transform);
    const blip = firstDescendant(shape, 'blip');
    if (!rect || !blip) return null;
    const relationshipId = blip.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'embed') || blip.getAttribute('r:embed');
    const mediaPath = relationships[relationshipId];
    if (!mediaPath) return null;
    const crop = parseSourceRect(shape);
    return { type: 'image', mediaPath, ...rectToPercent(rect, slideWidth, slideHeight), ...(crop ? { crop } : {}) };
  }

  function walkShapes(container, transform, slideWidth, slideHeight, relationships, output, colorContext, inheritedFontSizes) {
    Array.from(container.childNodes).filter(node => node.nodeType === 1).forEach(node => {
      if (node.localName === 'grpSp') {
        const groupProperties = directChild(node, 'grpSpPr');
        const xfrm = groupProperties && directChild(groupProperties, 'xfrm');
        walkShapes(node, xfrm ? groupTransform(parseTransform(xfrm), transform) : transform, slideWidth, slideHeight, relationships, output, colorContext, inheritedFontSizes);
      } else if (node.localName === 'sp') {
        const parsed = parseTextShape(node, transform, slideWidth, slideHeight, colorContext, inheritedFontSizes);
        if (parsed) output.push(parsed);
      } else if (node.localName === 'pic') {
        const parsed = parsePicture(node, transform, slideWidth, slideHeight, relationships);
        if (parsed) output.push(parsed);
      }
    });
  }

  function resolvePartPath(basePath, target) {
    const parts = basePath.split('/');
    parts.pop();
    String(target || '').split('/').forEach(part => {
      if (!part || part === '.') return;
      if (part === '..') parts.pop(); else parts.push(part);
    });
    return parts.join('/');
  }

  function parseRelationships(xmlDocument, slidePath) {
    const result = {};
    Array.from(xmlDocument.getElementsByTagNameNS('*', 'Relationship')).forEach(relationship => {
      result[relationship.getAttribute('Id')] = resolvePartPath(slidePath, relationship.getAttribute('Target'));
    });
    return result;
  }

  const extensionMime = extension => ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', emf: 'image/emf', wmf: 'image/wmf' })[extension] || 'application/octet-stream';

  async function resolveJSZip(JSZipImplementation) {
    if (JSZipImplementation) return JSZipImplementation;
    if (typeof root !== 'undefined' && root.JSZip) return root.JSZip;
    if (typeof globalThis !== 'undefined' && globalThis.JSZip) return globalThis.JSZip;
    if (typeof window !== 'undefined' && window.JSZip) return window.JSZip;
    if (typeof document !== 'undefined') {
      await new Promise((resolve, reject) => {
        const existing = document.querySelector('script[src*="vendor-jszip"]');
        if (existing) {
          if ((typeof root !== 'undefined' && root.JSZip) || (typeof window !== 'undefined' && window.JSZip)) {
            return resolve();
          }
          existing.addEventListener('load', resolve);
          existing.addEventListener('error', () => reject(new Error('無法載入模組: vendor-jszip')));
          return;
        }
        const s = document.createElement('script');
        s.src = 'vendor-jszip.min.js?v=3.10.1';
        s.onload = resolve;
        s.onerror = () => reject(new Error('無法載入模組: vendor-jszip'));
        document.head.appendChild(s);
      });
      return (typeof root !== 'undefined' && root.JSZip) || (typeof window !== 'undefined' ? window.JSZip : null);
    }
    return null;
  }

  async function parsePptx(arrayBuffer, JSZipImplementation, options = {}) {
    const jszip = await resolveJSZip(JSZipImplementation);
    if (!jszip) throw new Error('PPTX 解析元件尚未載入');
    if (typeof DOMParser === 'undefined') throw new Error('目前瀏覽器不支援 XML 解析');
    const zip = await jszip.loadAsync(arrayBuffer);
    const xml = async path => {
      const file = zip.file(path);
      if (!file) throw new Error(`PPTX 缺少必要檔案：${path}`);
      return new DOMParser().parseFromString(await file.async('text'), 'application/xml');
    };
    const presentation = await xml('ppt/presentation.xml');
    const slideSize = firstDescendant(presentation, 'sldSz');
    const slideWidth = intAttr(slideSize, 'cx', PPT_WIDTH_EMU);
    const slideHeight = intAttr(slideSize, 'cy', PPT_HEIGHT_EMU);
    if (options.requireSixteenByNine && !isSixteenByNine(slideWidth, slideHeight)) {
      throw new Error('牧師講道 PPT 必須使用 16:9 格式，這份檔案無法上傳');
    }
    const themePath = Object.keys(zip.files).find(path => /^ppt\/theme\/theme\d+\.xml$/.test(path));
    const masterPath = Object.keys(zip.files).find(path => /^ppt\/slideMasters\/slideMaster\d+\.xml$/.test(path));
    const themeColors = themePath ? parseThemeColors(await xml(themePath)) : {};
    const colorMap = masterPath ? parseColorMap(await xml(masterPath)) : { ...defaultColorMap };
    const colorContext = { themeColors, colorMap };
    const slidePaths = Object.keys(zip.files).filter(path => /^ppt\/slides\/slide\d+\.xml$/.test(path)).sort((a, b) => Number(a.match(/slide(\d+)/)[1]) - Number(b.match(/slide(\d+)/)[1]));
    const mediaCache = {};
    const layoutFontSizeCache = {};
    const pages = [];
    for (let index = 0; index < slidePaths.length; index += 1) {
      const slidePath = slidePaths[index];
      const relationshipPath = slidePath.replace('ppt/slides/', 'ppt/slides/_rels/') + '.rels';
      const relationshipFile = zip.file(relationshipPath);
      const relationships = relationshipFile ? parseRelationships(new DOMParser().parseFromString(await relationshipFile.async('text'), 'application/xml'), slidePath) : {};
      const layoutPath = Object.values(relationships).find(path => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(path));
      if (layoutPath && !layoutFontSizeCache[layoutPath]) {
        layoutFontSizeCache[layoutPath] = placeholderFontSizes(await xml(layoutPath));
      }
      const slide = await xml(slidePath);
      const shapeTree = firstDescendant(slide, 'spTree');
      const objects = [];
      if (shapeTree) walkShapes(shapeTree, { sx: 1, sy: 1, tx: 0, ty: 0 }, slideWidth, slideHeight, relationships, objects, colorContext, layoutFontSizeCache[layoutPath]);
      for (const object of objects.filter(item => item.type === 'image')) {
        if (!mediaCache[object.mediaPath]) {
          const media = zip.file(object.mediaPath);
          if (!media) continue;
          const extension = object.mediaPath.split('.').pop().toLowerCase();
          mediaCache[object.mediaPath] = `data:${extensionMime(extension)};base64,${await media.async('base64')}`;
        }
        object.src = mediaCache[object.mediaPath];
        delete object.mediaPath;
      }
      pages.push({ id: `imported:${index + 1}`, kind: 'ppt-import', objects, sourceWidth: slideWidth, sourceHeight: slideHeight });
    }
    return pages;
  }

  function browserCanvas() {
    if (typeof document === 'undefined') throw new Error('目前環境無法建立投影片圖片');
    return document.createElement('canvas');
  }

  function browserImage(src) {
    if (typeof Image === 'undefined') return Promise.reject(new Error('目前環境無法載入投影片圖片'));
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('投影片內圖片載入失敗'));
      image.src = src;
    });
  }

  function textLines(runs) {
    const lines = [[]];
    (runs || []).forEach(run => {
      String(run.text == null ? '' : run.text).split('\n').forEach((part, index) => {
        if (index) lines.push([]);
        if (part) lines[lines.length - 1].push({ ...run, text: part });
      });
    });
    return lines;
  }

  function canvasFont(run, object, pixelsPerPoint) {
    const size = (Number(run.fontSize) || Number(object.fontSize) || 18) * pixelsPerPoint;
    const family = run.fontFamily || object.fontFamily || 'Microsoft JhengHei';
    return `${run.italic ? 'italic ' : ''}${run.bold || object.bold ? '700 ' : ''}${size}px "${family}"`;
  }

  function drawTextObject(context, object, canvasWidth, canvasHeight, pixelsPerPoint) {
    const x = Number(object.x) / 100 * canvasWidth;
    const y = Number(object.y) / 100 * canvasHeight;
    const width = Number(object.w) / 100 * canvasWidth;
    const height = Number(object.h) / 100 * canvasHeight;
    const lines = textLines(Array.isArray(object.runs) && object.runs.length ? object.runs : [{ text: object.text || '' }]);
    const measured = lines.map(line => {
      const parts = line.map(run => {
        context.font = canvasFont(run, object, pixelsPerPoint);
        return {
          run,
          width: context.measureText(run.text).width,
          size: (Number(run.fontSize) || Number(object.fontSize) || 18) * pixelsPerPoint
        };
      });
      const maxSize = Math.max(...parts.map(part => part.size), (Number(object.fontSize) || 18) * pixelsPerPoint);
      return { parts, width: parts.reduce((sum, part) => sum + part.width, 0), height: maxSize * 1.15, maxSize };
    });
    const totalHeight = measured.reduce((sum, line) => sum + line.height, 0);
    let top = y;
    if (object.verticalAlign === 'center') top += Math.max(0, (height - totalHeight) / 2);
    if (object.verticalAlign === 'end') top += Math.max(0, height - totalHeight);
    context.textBaseline = 'alphabetic';
    measured.forEach(line => {
      let cursorX = x;
      if (object.align === 'center') cursorX += Math.max(0, (width - line.width) / 2);
      if (object.align === 'right') cursorX += Math.max(0, width - line.width);
      const baseline = top + line.maxSize;
      line.parts.forEach(part => {
        context.font = canvasFont(part.run, object, pixelsPerPoint);
        context.fillStyle = part.run.color || object.color || '#000000';
        context.fillText(part.run.text, cursorX, baseline);
        if (part.run.underline && context.beginPath) {
          context.beginPath();
          context.moveTo(cursorX, baseline + Math.max(1, part.size * 0.06));
          context.lineTo(cursorX + part.width, baseline + Math.max(1, part.size * 0.06));
          context.strokeStyle = context.fillStyle;
          context.lineWidth = Math.max(1, part.size * 0.04);
          context.stroke();
        }
        cursorX += part.width;
      });
      top += line.height;
    });
  }

  function rasterObject(object, options = {}) {
    if (object && object.type === 'text' && object.role === 'title' && options.titleVerticalAlign) {
      return { ...object, verticalAlign: options.titleVerticalAlign };
    }
    return object;
  }

  function calculateCroppedImageDraw(imageWidth, imageHeight, target, crop) {
    const sourcePixelWidth = Number(imageWidth);
    const sourcePixelHeight = Number(imageHeight);
    const targetX = Number(target && target.x);
    const targetY = Number(target && target.y);
    const targetWidth = Number(target && target.w);
    const targetHeight = Number(target && target.h);
    if (!(sourcePixelWidth > 0 && sourcePixelHeight > 0 && targetWidth > 0 && targetHeight > 0)) return null;

    const cropValue = name => {
      const value = Number(crop && crop[name]);
      return Number.isFinite(value) ? value : 0;
    };
    const virtualLeft = cropValue('left');
    const virtualTop = cropValue('top');
    const virtualRight = 1 - cropValue('right');
    const virtualBottom = 1 - cropValue('bottom');
    const virtualWidth = virtualRight - virtualLeft;
    const virtualHeight = virtualBottom - virtualTop;
    if (!(virtualWidth > 0 && virtualHeight > 0)) return null;

    const sourceLeft = Math.max(0, Math.min(1, virtualLeft));
    const sourceTop = Math.max(0, Math.min(1, virtualTop));
    const sourceRight = Math.max(0, Math.min(1, virtualRight));
    const sourceBottom = Math.max(0, Math.min(1, virtualBottom));
    if (!(sourceRight > sourceLeft && sourceBottom > sourceTop)) return null;

    const clean = value => Number(value.toFixed(6));
    return {
      sourceX: clean(sourceLeft * sourcePixelWidth),
      sourceY: clean(sourceTop * sourcePixelHeight),
      sourceWidth: clean((sourceRight - sourceLeft) * sourcePixelWidth),
      sourceHeight: clean((sourceBottom - sourceTop) * sourcePixelHeight),
      targetX: clean(targetX + (sourceLeft - virtualLeft) / virtualWidth * targetWidth),
      targetY: clean(targetY + (sourceTop - virtualTop) / virtualHeight * targetHeight),
      targetWidth: clean((sourceRight - sourceLeft) / virtualWidth * targetWidth),
      targetHeight: clean((sourceBottom - sourceTop) / virtualHeight * targetHeight)
    };
  }

  async function rasterizeImportedPages(pages, options = {}) {
    const width = Math.max(640, Number(options.width) || 1600);
    const createCanvas = options.createCanvas || browserCanvas;
    const loadImage = options.loadImage || browserImage;
    const result = [];
    for (const page of pages || []) {
      const sourceWidth = Number(page.sourceWidth) || PPT_WIDTH_EMU;
      const sourceHeight = Number(page.sourceHeight) || PPT_HEIGHT_EMU;
      const height = Math.round(width * sourceHeight / sourceWidth);
      const pixelsPerPoint = width / (sourceWidth / 914400) / 72;
      const canvas = createCanvas();
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      context.clearRect(0, 0, width, height);
      for (const sourceObject of page.objects || []) {
        const object = rasterObject(sourceObject, options);
        if (object.type === 'image' && object.src) {
          const image = await loadImage(object.src);
          const target = {
            x: Number(object.x) / 100 * width,
            y: Number(object.y) / 100 * height,
            w: Number(object.w) / 100 * width,
            h: Number(object.h) / 100 * height
          };
          if (object.crop) {
            const draw = calculateCroppedImageDraw(
              Number(image.naturalWidth) || Number(image.width),
              Number(image.naturalHeight) || Number(image.height),
              target,
              object.crop
            );
            if (draw) {
              context.drawImage(
                image,
                draw.sourceX,
                draw.sourceY,
                draw.sourceWidth,
                draw.sourceHeight,
                draw.targetX,
                draw.targetY,
                draw.targetWidth,
                draw.targetHeight
              );
            }
          } else {
            context.drawImage(image, target.x, target.y, target.w, target.h);
          }
        } else if (object.type === 'text') {
          drawTextObject(context, object, width, height, pixelsPerPoint);
        }
      }
      result.push({
        ...page,
        rasterized: true,
        objects: [{ type: 'image', src: canvas.toDataURL('image/png'), x: 0, y: 0, w: 100, h: 100 }]
      });
    }
    return result;
  }

  function isFirebaseStorageUrl(value) {
    try {
      const hostname = new URL(String(value || '')).hostname.toLowerCase();
      return hostname === 'firebasestorage.googleapis.com'
        || hostname === 'storage.googleapis.com'
        || hostname.endsWith('.firebasestorage.app');
    } catch (_) {
      return false;
    }
  }

  async function downloadAndParse(entry, JSZipImplementation, readApi) {
    if (!entry || !entry.fileId) throw new Error('找不到對應的雲端 PPTX');
    const jszip = await resolveJSZip(JSZipImplementation);
    const storageUrl = entry.downloadUrl || entry.storageUrl;
    if (storageUrl && isFirebaseStorageUrl(storageUrl)) {
      let response;
      try {
        response = await fetch(storageUrl);
      } catch (error) {
        throw new Error(`PPTX 下載失敗：${error && error.message ? error.message : error}`);
      }
      if (!response.ok) throw new Error(`PPTX 下載失敗（${response.status}）`);
      return parsePptx(await response.arrayBuffer(), jszip);
    }
    if (typeof readApi === 'function') {
      const result = await readApi('cal_getPptLibraryFile', { fileId: entry.fileId });
      const payload = result && result.data;
      if (!payload || !payload.base64) throw new Error('PPTX 雲端代理未回傳檔案內容');
      return parsePptx(base64ToArrayBuffer(payload.base64), jszip);
    }
    const url = `https://drive.usercontent.google.com/download?id=${encodeURIComponent(entry.fileId)}&export=download&confirm=t`;
    let response;
    try {
      response = await fetch(url);
    } catch (error) {
      throw new Error(`PPTX 下載失敗：${error && error.message ? error.message : error}`);
    }
    if (!response.ok) throw new Error(`PPTX 下載失敗（${response.status}）`);
    return parsePptx(await response.arrayBuffer(), jszip);
  }

  return {
    isSixteenByNine,
    normalizeLibraryNumber,
    parseLibraryFilename,
    findLibraryEntry,
    groupTransform,
    mapRect,
    rectToPercent,
    parseSourceRect,
    calculateCroppedImageDraw,
    resolveSchemeColor,
    inheritRunStyle,
    base64ToArrayBuffer,
    ensureJSZip: resolveJSZip,
    parsePptx,
    rasterObject,
    rasterizeImportedPages,
    isFirebaseStorageUrl,
    downloadAndParse
  };
});
