(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TaiwaneseWorshipCalendarAdapter = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  const aliases = {
    call: ['宣召'],
    sermonTitle: ['講題', '講道題目', '講道'],
    sermonSpeaker: ['講員', '講道者'],
    scripture: ['經文', '講道經文'],
    verse: ['金句'],
    responsiveReading: ['啟應文', '啟應'],
    responseSong: ['詩歌', '回應詩', '回應詩歌'],
    hymn1: ['聖詩第一首', '聖詩一', '聖詩1'],
    hymn2: ['聖詩第二首', '聖詩二', '聖2'],
    doxology: ['頌榮']
  };
  const clean = value => String(value || '').trim();
  const getValue = (event, names) => {
    const values = Array.isArray(event && event.values) ? event.values : [];
    const found = values.find(item => names.includes(clean(item.fieldName)));
    return found ? clean(found.value) : '';
  };
  const hymnNumber = value => {
    const match = clean(value).toUpperCase().match(/0*(\d+)\s*([A-Z])?/);
    return match ? `${Number(match[1])}${match[2] || ''}` : '';
  };
  function selectSermonEvent(events, date, selector) {
    const expected = selector || { typeName: '台語', typeFullName: '講道資訊-台語' };
    const expectedTypeName = clean(expected.typeName);
    const expectedFullName = clean(expected.typeFullName).replace(/\s+/g, '');
    return (Array.isArray(events) ? events : []).find(event => {
      const eventDate = clean(event && event.date);
      const typeName = clean(event && event.typeName);
      const typeFullName = clean(event && event.typeFullName).replace(/\s+/g, '');
      return (!date || eventDate === date) && typeName === expectedTypeName && typeFullName === expectedFullName;
    }) || null;
  }
  function selectTaiwaneseSermonEvent(events, date) {
    return selectSermonEvent(events, date, { typeName: '台語', typeFullName: '講道資訊-台語' });
  }
  const getCalendarValue = (event, key) => getValue(event, aliases[key] || []);
  function applyCalendarEvent(event, model) {
    ['pre-hymn-1', 'pre-hymn-2', 'hymn-1', 'hymn-2', 'doxology', 'response'].forEach(id => {
      const item = model[id];
      if (!item) return;
      delete item.pptPages;
      delete item.libraryFileId;
      delete item.libraryEntry;
      item.includeSectionTitle = false;
      item.libraryError = '';
    });
    const put = (id, key, value) => {
      if (!model[id]) return;
      model[id][key] = value == null ? '' : value;
    };
    put('call', 'sourceValue', getValue(event, aliases.call));
    put('sermon', 'title', getValue(event, aliases.sermonTitle));
    put('sermon', 'kicker', getValue(event, aliases.sermonSpeaker));
    put('scripture', 'sourceValue', getValue(event, aliases.scripture));
    put('verse', 'sourceValue', getValue(event, aliases.verse));
    put('response', 'sourceValue', getValue(event, aliases.responsiveReading));
    put('response-song', 'title', getValue(event, aliases.responseSong));
    const hymn1 = hymnNumber(getValue(event, aliases.hymn1));
    const hymn2 = hymnNumber(getValue(event, aliases.hymn2));
    put('hymn-1', 'sourceValue', hymn1);
    put('pre-hymn-1', 'sourceValue', hymn1);
    put('hymn-2', 'sourceValue', hymn2);
    put('pre-hymn-2', 'sourceValue', hymn2);
    put('doxology', 'sourceValue', hymnNumber(getValue(event, aliases.doxology)));
    return model;
  }
  return { applyCalendarEvent, selectSermonEvent, selectTaiwaneseSermonEvent, getCalendarValue };
});
