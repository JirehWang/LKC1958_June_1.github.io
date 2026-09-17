// Native PPTX package composition. Source shape XML is never laid out again.
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.WorshipNativePptx = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
  const elements = node => Array.from(node.childNodes || []).filter(n => n.nodeType === 1);
  const children = (node, name) => elements(node).filter(n => n.localName === name);
  const child = (node, name) => children(node, name)[0];
  function resolve(from, target) {
    const result = target.startsWith('/') ? [] : from.split('/').slice(0, -1);
    for (const part of target.split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') {
        if (!result.length) throw new Error('PPTX 關聯路徑超出封裝範圍');
        result.pop();
      } else result.push(part);
    }
    return result.join('/');
  }
  function relative(from, to) {
    const a = from.split('/').slice(0, -1), b = to.split('/');
    while (a.length && b.length && a[0] === b[0]) { a.shift(); b.shift(); }
    return [...a.map(() => '..'), ...b].join('/');
  }
  function relPath(part) {
    const parts = part.split('/'), name = parts.pop();
    return [...parts, '_rels', name + '.rels'].join('/');
  }
  async function merge(zip, entries, getSource, options = {}) {
    const Parser = options.DOMParser || globalThis.DOMParser;
    const Serializer = options.XMLSerializer || globalThis.XMLSerializer;
    const parse = text => {
      const doc = new Parser().parseFromString(text, 'application/xml');
      if (doc.getElementsByTagName('parsererror').length) throw new Error('PPTX XML 格式錯誤');
      return doc;
    };
    const serialize = doc => new Serializer().serializeToString(doc);
    const read = async (archive, path) => {
      const file = archive.file(path);
      if (!file) throw new Error('原生 PPTX 缺少必要檔案：' + path);
      return parse(await file.async('text'));
    };
    const types = await read(zip, '[Content_Types].xml');
    const presentation = await read(zip, 'ppt/presentation.xml');
    const presentationRels = await read(zip, 'ppt/_rels/presentation.xml.rels');
    const targetSize = child(presentation.documentElement, 'sldSz');
    const packages = new Map();
    const addedMasters = new Set();
    let nextMasterId = Math.max(2147483647, ...Array.from(presentation.getElementsByTagNameNS(P, 'sldMasterId')).map(n => Number(n.getAttribute('id')))) + 1;
    // PowerPoint uses one ID space across masters and their layouts.
    for (const name of Object.keys(zip.files).filter(n => /^ppt\/slideMasters\/[^/]+\.xml$/.test(n))) {
      const master = await read(zip, name);
      for (const node of Array.from(master.getElementsByTagNameNS(P, 'sldLayoutId'))) {
        nextMasterId = Math.max(nextMasterId, Number(node.getAttribute('id')) + 1);
      }
    }
    function addType(path, contentType) {
      const n = types.createElementNS(CT, 'Override');
      n.setAttribute('PartName', '/' + path); n.setAttribute('ContentType', contentType);
      types.documentElement.appendChild(n);
    }
    function newRel(doc, type, target) {
      const used = new Set(elements(doc.documentElement).map(n => n.getAttribute('Id')));
      let index = 1;
      while (used.has('native' + index)) index++;
      const node = doc.createElementNS(PKG, 'Relationship');
      node.setAttribute('Id', 'native' + index); node.setAttribute('Type', type); node.setAttribute('Target', target);
      doc.documentElement.appendChild(node);
      return node.getAttribute('Id');
    }
    async function packageFor(ref) {
      if (packages.has(ref.packageId)) return packages.get(ref.packageId);
      const source = getSource(ref);
      if (!source) throw new Error('原始簡報已失效，請重新帶入聖詩／啟應文後匯出');
      const sourceZip = source.zip;
      const sourcePresentation = await read(sourceZip, 'ppt/presentation.xml');
      const size = child(sourcePresentation.documentElement, 'sldSz');
      if (['cx', 'cy'].some(key => Math.abs(Number(size.getAttribute(key)) - Number(targetSize.getAttribute(key))) > 400)) {
        throw new Error('原始簡報尺寸與禮拜簡報不同，無法在不改座標的情況下合併');
      }
      const sourceTypes = await read(sourceZip, '[Content_Types].xml');
      const prefix = 'ppt/native' + (packages.size + 1) + '/';
      const copied = new Map();
      const mappedSlides = new Map();
      entries.forEach((entry, index) => {
        if (entry.nativeExport && entry.nativeSource && entry.nativeSource.packageId === ref.packageId
          && !mappedSlides.has(entry.nativeSource.slidePath)) {
          mappedSlides.set(entry.nativeSource.slidePath, 'ppt/slides/slide' + (index + 1) + '.xml');
        }
      });
      const state = { sourceZip, copied, copy: null };
      packages.set(ref.packageId, state);
      state.copy = async path => {
        if (mappedSlides.has(path)) return mappedSlides.get(path);
        if (copied.has(path)) return copied.get(path);
        const target = prefix + path;
        copied.set(path, target); // Register before traversing cyclic master/layout links.
        const file = sourceZip.file(path);
        if (!file) throw new Error('原始 PPTX 缺少關聯檔案：' + path);
        const typeNode = elements(sourceTypes.documentElement).find(n => n.localName === 'Override' && n.getAttribute('PartName') === '/' + path)
          || elements(sourceTypes.documentElement).find(n => n.localName === 'Default' && n.getAttribute('Extension') === path.split('.').pop());
        if (!typeNode) throw new Error('PPTX 缺少內容類型：' + path);
        addType(target, typeNode.getAttribute('ContentType'));
        const isMaster = typeNode.getAttribute('ContentType').endsWith('.slideMaster+xml');
        if (isMaster) {
          const master = await read(sourceZip, path);
          for (const node of Array.from(master.getElementsByTagNameNS(P, 'sldLayoutId'))) node.setAttribute('id', String(nextMasterId++));
          zip.file(target, serialize(master));
        } else zip.file(target, await file.async('uint8array'));
        const sourceRels = sourceZip.file(relPath(path));
        if (sourceRels) {
          const rels = parse(await sourceRels.async('text'));
          for (const rel of elements(rels.documentElement)) {
            if (rel.getAttribute('TargetMode') === 'External') continue;
            const dependency = await state.copy(resolve(path, rel.getAttribute('Target')));
            rel.setAttribute('Target', relative(target, dependency));
          }
          zip.file(relPath(target), serialize(rels));
        }
        if (typeNode.getAttribute('ContentType').endsWith('.slideMaster+xml') && !addedMasters.has(target)) {
          addedMasters.add(target);
          let list = child(presentation.documentElement, 'sldMasterIdLst');
          if (!list) {
            list = presentation.createElementNS(P, 'p:sldMasterIdLst');
            presentation.documentElement.insertBefore(list, presentation.documentElement.firstChild);
          }
          const id = presentation.createElementNS(P, 'p:sldMasterId');
          id.setAttribute('id', String(nextMasterId++));
          id.setAttributeNS(R, 'r:id', newRel(presentationRels, R + '/slideMaster', relative('ppt/presentation.xml', target)));
          list.appendChild(id);
        }
        if (typeNode.getAttribute('ContentType').endsWith('.notesMaster+xml')) {
          let list = child(presentation.documentElement, 'notesMasterIdLst');
          if (!list) {
            list = presentation.createElementNS(P, 'p:notesMasterIdLst');
            presentation.documentElement.insertBefore(list, child(presentation.documentElement, 'sldSz'));
          }
          const id = presentation.createElementNS(P, 'p:notesMasterId');
          id.setAttributeNS(R, 'r:id', newRel(presentationRels, R + '/notesMaster', relative('ppt/presentation.xml', target)));
          list.appendChild(id);
        }
        return target;
      };
      state.copyNotes = async (path, slidePath, index) => {
        const target = 'ppt/notesSlides/nativeNotes' + index + '.xml';
        addType(target, 'application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml');
        zip.file(target, await sourceZip.file(path).async('uint8array'));
        const rels = await read(sourceZip, relPath(path));
        for (const rel of elements(rels.documentElement)) {
          if (rel.getAttribute('TargetMode') === 'External') continue;
          const dependency = rel.getAttribute('Type') === R + '/slide'
            ? slidePath : await state.copy(resolve(path, rel.getAttribute('Target')));
          rel.setAttribute('Target', relative(target, dependency));
        }
        zip.file(relPath(target), serialize(rels));
        return target;
      };
      return state;
    }
    let merged = 0;
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index];
      if (!entry.nativeExport) continue;
      if (!entry.nativeSource) throw new Error('聖詩／啟應文缺少原始 PPTX，請重新載入');
      const state = await packageFor(entry.nativeSource);
      const sourcePath = entry.nativeSource.slidePath;
      const targetPath = 'ppt/slides/slide' + (index + 1) + '.xml';
      const source = await read(state.sourceZip, sourcePath);
      const target = await read(zip, targetPath);
      const sourceRelsFile = state.sourceZip.file(relPath(sourcePath));
      const sourceRels = parse(sourceRelsFile ? await sourceRelsFile.async('text') : '<Relationships xmlns="' + PKG + '"/>');
      for (const rel of elements(sourceRels.documentElement)) {
        if (rel.getAttribute('TargetMode') === 'External') continue;
        const path = resolve(sourcePath, rel.getAttribute('Target'));
        const dependency = rel.getAttribute('Type') === R + '/notesSlide'
          ? await state.copyNotes(path, targetPath, index + 1) : await state.copy(path);
        rel.setAttribute('Target', relative(targetPath, dependency));
      }
      const sourceCommon = child(source.documentElement, 'cSld');
      const sourceTree = child(sourceCommon, 'spTree');
      const targetCommon = child(target.documentElement, 'cSld');
      const targetTree = child(targetCommon, 'spTree');
      // Generated slide contains only the current background and white overlay.
      const backdrop = child(targetCommon, 'bg');
      const layers = elements(targetTree).filter(n => !['nvGrpSpPr', 'grpSpPr', 'extLst'].includes(n.localName));
      const importedNodes = [backdrop, ...layers].filter(Boolean).map(n => source.importNode(n, true));
      const targetRels = await read(zip, relPath(targetPath));
      const idMap = new Map();
      for (const rel of elements(targetRels.documentElement)) {
        if (['slideLayout', 'notesSlide'].includes(rel.getAttribute('Type').split('/').pop())) continue;
        const id = newRel(sourceRels, rel.getAttribute('Type'), rel.getAttribute('Target'));
        if (rel.hasAttribute('TargetMode')) sourceRels.documentElement.lastChild.setAttribute('TargetMode', rel.getAttribute('TargetMode'));
        idMap.set(rel.getAttribute('Id'), id);
      }
      let shapeId = Math.max(1, ...Array.from(source.getElementsByTagNameNS(P, 'cNvPr')).map(n => Number(n.getAttribute('id')))) + 1;
      for (const node of importedNodes) {
        for (const item of [node, ...Array.from(node.getElementsByTagName('*'))]) {
          for (const attr of Array.from(item.attributes || [])) {
            if (attr.namespaceURI === R && idMap.has(attr.value)) item.setAttributeNS(R, attr.name, idMap.get(attr.value));
          }
          if (item.localName === 'cNvPr') item.setAttribute('id', String(shapeId++));
        }
      }
      const oldBackground = child(sourceCommon, 'bg');
      if (oldBackground) sourceCommon.removeChild(oldBackground);
      if (backdrop) sourceCommon.insertBefore(importedNodes.shift(), sourceTree);
      const firstShape = elements(sourceTree).find(n => !['nvGrpSpPr', 'grpSpPr'].includes(n.localName));
      for (const node of importedNodes) sourceTree.insertBefore(node, firstShape || null);
      zip.file(targetPath, serialize(source));
      zip.file(relPath(targetPath), serialize(sourceRels));
      merged++;
    }
    zip.file('[Content_Types].xml', serialize(types));
    zip.file('ppt/presentation.xml', serialize(presentation));
    zip.file('ppt/_rels/presentation.xml.rels', serialize(presentationRels));
    return { merged };
  }
  return { merge };
});
