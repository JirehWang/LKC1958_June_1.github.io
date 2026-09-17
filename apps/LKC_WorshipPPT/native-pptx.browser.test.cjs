// Run with NODE_PATH pointing to the installed playwright/pptxgenjs packages.
// Optional real source decks: node native-pptx.browser.test.cjs file1.pptx file2.pptx
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const PptxGenJS = require('pptxgenjs');
const JSZip = require('./vendor-jszip.min.js');

(async () => {
  const ppt = new PptxGenJS();
  ppt.layout = 'LAYOUT_WIDE';
  for (const text of ['應：原生文字，保留字級與座標', '啟：第二頁']) {
    const s = ppt.addSlide();
    s.addText(text, { x: 1.23, y: 2.34, w: 9, h: 1.25, fontSize: 37, color: '123456',
      margin: [1, 2, 3, 4], breakLine: false, hyperlink: { url: 'https://example.com/' } });
  }
  const fixture = await JSZip.loadAsync(await ppt.write({ outputType: 'nodebuffer' }));
  // Exercise presentation order independently from numeric slide filenames.
  const pres = await fixture.file('ppt/presentation.xml').async('string');
  const ids = pres.match(/<p:sldId\b[^>]*\/>/g);
  fixture.file('ppt/presentation.xml', pres.replace(ids.join(''), ids.slice().reverse().join('')));
  const sources = [{ name: 'response-fixture', data: await fixture.generateAsync({ type: 'base64' }) },
    ...process.argv.slice(2).map(file => ({ name: path.basename(file), data: fs.readFileSync(file).toString('base64') }))];
  const browser = await chromium.launch({ channel: process.env.PPT_TEST_BROWSER || 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<html><body></body></html>');
    const bundle = path.join(path.dirname(require.resolve('pptxgenjs')), 'pptxgen.bundle.js');
    for (const script of [bundle, 'vendor-jszip.min.js', 'pptx-library.js', 'native-pptx.js', 'slide-production.js', 'ppt-export.js']) {
      await page.addScriptTag({ path: path.isAbsolute(script) ? script : path.join(__dirname, script) });
    }
    const result = await page.evaluate(async sources => {
      const check = (condition, message) => { if (!condition) throw new Error(message); };
      const parser = new DOMParser(), serializer = new XMLSerializer();
      const parse = text => parser.parseFromString(text, 'application/xml');
      const children = n => Array.from(n.children);
      const find = (n, name) => children(n).find(c => c.localName === name);
      const shapes = doc => children(doc.getElementsByTagNameNS('*', 'spTree')[0]).filter(n => !['nvGrpSpPr', 'grpSpPr'].includes(n.localName));
      const fingerprint = node => JSON.stringify([node.namespaceURI, node.localName,
        Array.from(node.attributes).filter(a => a.namespaceURI !== 'http://www.w3.org/2000/xmlns/').map(a => [a.namespaceURI, a.localName, a.value]).sort(),
        Array.from(node.childNodes).filter(n => n.nodeType === 1 || n.nodeType === 3).map(n => n.nodeType === 1 ? fingerprint(n) : n.nodeValue)]);
      const entries = [{ kind: 'section', title: '測試起點', sectionId: 'cover', id: 'intro' }];
      const originals = [];
      for (const [sourceIndex, source] of sources.entries()) {
        const pages = await TaiwaneseWorshipPptxLibrary.parsePptx(TaiwaneseWorshipPptxLibrary.base64ToArrayBuffer(source.data), JSZip);
        if (!sourceIndex) check(pages[0].nativeSource.slidePath === 'ppt/slides/slide2.xml', 'source presentation order was lost');
        for (const pg of pages) {
          originals.push({ entryIndex: entries.length, page: pg });
          entries.push({ ...pg, nativeExport: true, sectionId: !sourceIndex || /^\d+\.pptx$/.test(source.name) ? 'response' : 'hymn-1',
            objects: [{ type: 'image', src: 'INVALID_PREVIEW_MUST_NOT_BE_EXPORTED' }] });
        }
      }
      const repeat = { ...entries[1], sectionId: 'doxology' };
      originals.push({ entryIndex: entries.length, page: repeat });
      entries.push(repeat, { kind: 'section', title: '測試終點', sectionId: 'end', id: 'end' });
      const bg = document.createElement('canvas'); bg.width = 8; bg.height = 8;
      const ctx = bg.getContext('2d'); ctx.fillStyle = '#b0d0e0'; ctx.fillRect(0, 0, 8, 8);
      window.hymnOpacitySectionIds = ['hymn-1', 'doxology'];
      const blob = await TaiwaneseWorshipPptExport.exportWorshipPPTX({
        PptxGenJS: window.PptxGenJS || window.pptxgen, JSZip, returnBlob: true,
        getDeckEntries: () => entries, serviceDate: '2026-09-20',
        layoutState: { groups: {}, pageAssignments: {}, outputScale: { text: 80, image: 80 } },
        production: TaiwaneseWorshipSlideProduction,
        model: { 'hymn-1': { opacity: 60 }, doxology: { opacity: 70 } }, backgroundImage: bg.toDataURL(), backgroundColor: '#ffffff'
      });
      const bytes = await blob.arrayBuffer();
      const zip = await JSZip.loadAsync(bytes);
      let checkedShapes = 0;
      for (const { entryIndex, page: pg } of originals) {
        const sourceZip = TaiwaneseWorshipPptxLibrary.getNativeSource(pg.nativeSource).zip;
        const before = parse(await sourceZip.file(pg.nativeSource.slidePath).async('text'));
        const after = parse(await zip.file('ppt/slides/slide' + (entryIndex + 1) + '.xml').async('text'));
        const oldShapes = shapes(before), newShapes = shapes(after);
        const overlay = ['hymn-1', 'doxology'].includes(entries[entryIndex].sectionId);
        check(newShapes.length === oldShapes.length + Number(overlay), 'unexpected rebuilt or missing objects');
        oldShapes.forEach((shape, i) => check(fingerprint(shape) === fingerprint(newShapes[i + Number(overlay)]), 'source XML changed: ' + pg.nativeSource.slidePath));
        checkedShapes += oldShapes.length;
        check(after.getElementsByTagNameNS('*', 'bg')[0].getElementsByTagNameNS('*', 'blip').length === 1, 'configured background missing');
        if (overlay) {
          const alpha = newShapes[0].getElementsByTagNameNS('*', 'alpha')[0].getAttribute('val');
          check(alpha === (entries[entryIndex].sectionId === 'doxology' ? '70000' : '60000'), 'white overlay opacity changed');
        }
        const ids = Array.from(after.getElementsByTagNameNS('*', 'cNvPr')).map(n => n.getAttribute('id'));
        check(new Set(ids).size === ids.length, 'shape ID collision');
      }
      // Every internal relationship must resolve, including cyclic layouts/masters.
      let checkedRelationships = 0;
      const layoutIds = [];
      for (const n of Object.keys(zip.files).filter(n => n.includes('/slideMasters/') && n.endsWith('.xml'))) {
        const doc = parse(await zip.file(n).async('text'));
        layoutIds.push(...Array.from(doc.getElementsByTagNameNS('*', 'sldLayoutId')).map(n => n.getAttribute('id')));
      }
      const outPresentation = parse(await zip.file('ppt/presentation.xml').async('text'));
      layoutIds.push(...Array.from(outPresentation.getElementsByTagNameNS('*', 'sldMasterId')).map(n => n.getAttribute('id')));
      check(new Set(layoutIds).size === layoutIds.length, 'master/layout ID collision prevents PowerPoint opening');
      const noteTargets = new Set();
      for (const { entryIndex } of originals) {
        const part = 'ppt/slides/slide' + (entryIndex + 1) + '.xml';
        const rels = parse(await zip.file('ppt/slides/_rels/slide' + (entryIndex + 1) + '.xml.rels').async('text'));
        const notes = children(rels.documentElement).find(n => n.getAttribute('Type').endsWith('/notesSlide'));
        if (!notes) continue;
        const notePath = 'ppt/' + notes.getAttribute('Target').replace(/^\.\.\//, '');
        check(!noteTargets.has(notePath), 'repeated slide shares notes');
        noteTargets.add(notePath);
        const noteRels = parse(await zip.file(notePath.replace('/notesSlides/', '/notesSlides/_rels/') + '.rels').async('text'));
        const backlink = children(noteRels.documentElement).find(n => n.getAttribute('Type').endsWith('/slide'));
        check(backlink.getAttribute('Target') === '../slides/slide' + (entryIndex + 1) + '.xml', 'notes backlink does not point to inserted page');
      }
      for (const filename of Object.keys(zip.files).filter(n => n.endsWith('.rels'))) {
        const doc = parse(await zip.file(filename).async('text'));
        const part = filename === '_rels/.rels' ? '' : filename.replace('/_rels/', '/').replace(/\.rels$/, '');
        for (const rel of children(doc.documentElement)) {
          if (rel.getAttribute('TargetMode') === 'External') continue;
          const target = rel.getAttribute('Target');
          const parts = target.startsWith('/') ? [] : part.split('/').slice(0, -1);
          for (const s of target.split('/')) { if (s === '..') parts.pop(); else if (s && s !== '.') parts.push(s); }
          check(!!zip.file(parts.join('/')), 'broken relationship: ' + filename + ' => ' + target);
          checkedRelationships++;
        }
      }
      let failed = false;
      try { await WorshipNativePptx.merge(zip, [{ nativeExport: true, nativeSource: { packageId: 'expired' } }], () => null); }
      catch (e) { failed = /原始簡報已失效/.test(e.message); }
      check(failed, 'expired source must fail instead of exporting preview');
      const data = await new Promise(resolve => { const r = new FileReader(); r.onload = () => resolve(r.result.split(',')[1]); r.readAsDataURL(blob); });
      return { slides: entries.length, nativeSlides: originals.length, checkedShapes, checkedRelationships, data };
    }, sources);
    assert.ok(result.nativeSlides >= 3);
    const output = process.env.PPT_NATIVE_TEST_OUTPUT;
    if (output) fs.writeFileSync(output, Buffer.from(result.data, 'base64'));
    delete result.data;
    console.log(JSON.stringify(result));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
