const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const appDirectory = path.join(__dirname, '..', 'apps', 'LKC_MinistrySchedule');
const html = fs.readFileSync(path.join(appDirectory, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(appDirectory, 'style.css'), 'utf8');
const script = fs.readFileSync(path.join(appDirectory, 'script.js'), 'utf8');

function createClassList() {
  const classes = new Set();
  return {
    contains: name => classes.has(name),
    toggle(name, force) {
      const shouldAdd = force === undefined ? !classes.has(name) : Boolean(force);
      if (shouldAdd) classes.add(name);
      else classes.delete(name);
      return shouldAdd;
    }
  };
}

test('date filter stays sticky and can collapse while showing its selected range', () => {
  assert.match(html, /class="date-filter-sticky"/);
  assert.match(html, /id="dateFilterToggle"[^>]*aria-controls="dateFilterToolbar"/);
  assert.doesNotMatch(html, /id="dateFilterToolbar"[^>]*aria-hidden=/, 'toolbar remains accessible if desktop CSS reopens a mobile-collapsed toolbar');
  const baseStickyRule = css.match(/\.date-filter-sticky\s*\{([^}]*)\}/);
  assert.ok(baseStickyRule, 'date filter shell has a base style');
  assert.match(baseStickyRule[1], /position:\s*static/);
  assert.ok(/\.date-filter-sticky-header\s*\{[^}]*display:\s*none/s.test(css), 'desktop hides the collapse header');
  assert.ok(/@media \(max-width: 768px\) \{[\s\S]*?\.date-filter-sticky\s*\{[^}]*position:\s*sticky/s.test(css), 'mobile keeps the filter sticky');
  assert.ok(/@media \(min-width: 769px\) \{[\s\S]*?#dateFilterToolbar\.hidden\s*\{[^}]*display:\s*flex\s*!important/s.test(css), 'desktop shows the toolbar even if it was collapsed on mobile');

  const functionStart = script.indexOf('function toggleDateFilterToolbar()');
  assert.notEqual(functionStart, -1, 'date filter collapse handler exists');
  const functionEnd = script.indexOf('\nfunction ', functionStart + 1);
  const toggleSource = script.slice(functionStart, functionEnd);

  const elements = {
    dateFilterSticky: { classList: createClassList() },
    dateFilterToolbar: { classList: createClassList() },
    dateFilterToggle: {
      classList: createClassList(),
      attributes: { 'aria-expanded': 'true' },
      getAttribute(name) { return this.attributes[name] ?? null; },
      setAttribute(name, value) { this.attributes[name] = String(value); }
    },
    dateFilterToggleLabel: { textContent: '' },
    dateFilterToggleIcon: { textContent: '' },
    dateFilterSummary: { textContent: '', hidden: true, classList: createClassList() },
    startDate: { value: '2027-01-01' },
    endDate: { value: '2027-12-31' }
  };
  const context = { document: { getElementById: id => elements[id] || null } };
  vm.createContext(context);
  vm.runInContext(`${toggleSource}\nthis.toggleDateFilterToolbar = toggleDateFilterToolbar;`, context);

  context.toggleDateFilterToolbar();
  assert.equal(elements.dateFilterToolbar.classList.contains('hidden'), true);
  assert.equal('aria-hidden' in elements.dateFilterToolbar, false);
  assert.equal(elements.dateFilterToggle.getAttribute('aria-expanded'), 'false');
  assert.equal(elements.dateFilterToggleLabel.textContent, '展開日期設定');
  assert.equal(elements.dateFilterToggleIcon.textContent, '▾');
  assert.equal(elements.dateFilterSummary.textContent, '2027-01-01 ~ 2027-12-31');
  assert.equal(elements.dateFilterSummary.hidden, false);
  assert.equal(elements.dateFilterSticky.classList.contains('is-collapsed'), true);

  context.toggleDateFilterToolbar();
  assert.equal(elements.dateFilterToolbar.classList.contains('hidden'), false);
  assert.equal(elements.dateFilterToggle.getAttribute('aria-expanded'), 'true');
  assert.equal(elements.dateFilterToggleIcon.textContent, '▴');
  assert.equal(elements.dateFilterSummary.hidden, true);
  assert.equal(elements.dateFilterSticky.classList.contains('is-collapsed'), false);
});
