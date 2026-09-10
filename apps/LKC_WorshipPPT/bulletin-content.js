(function(root, factory) {
  const production = typeof module === 'object' && module.exports
    ? require('./slide-production.js')
    : root.TaiwaneseWorshipSlideProduction;
  const api = factory(production || {}, root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TaiwaneseWorshipBulletinContent = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(production, root) {
  const clean = value => String(value == null ? '' : value).trim();
  const DEFAULT_REPORT_LAYOUT = Object.freeze({
    contentSize: 48,
    contentW: 84,
    contentH: 68,
    lineSpacing: 1.5,
    textScale: 1
  });
  const SLIDE_HEIGHT_PX = 720;

  function buildBulletinCloudUrl(endpoint, kind, date) {
    const prefix = kind === 'praise' ? 'praise_songs_' : 'reports_';
    const separator = String(endpoint).includes('?') ? '&' : '?';
    return `${endpoint}${separator}action=load&key=${encodeURIComponent(prefix + clean(date))}`;
  }

  function normalizeReports(data) {
    const source = data && typeof data === 'object' ? data : {};
    const prayer = source.prayer && typeof source.prayer === 'object' ? source.prayer : {};
    return {
      announcements: (Array.isArray(source.announcements) ? source.announcements : []).map(clean).filter(Boolean),
      churchNews: (Array.isArray(source.churchNews) ? source.churchNews : []).map(clean).filter(Boolean),
      prayer: {
        homeRest: clean(prayer.homeRest),
        hospital: clean(prayer.hospital),
        other: clean(prayer.other)
      }
    };
  }

  function positiveNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
  }

  function normalizeReportLayout(params) {
    const source = params && typeof params === 'object' ? params : {};
    return {
      contentSize: positiveNumber(source.contentSize, DEFAULT_REPORT_LAYOUT.contentSize),
      contentW: Math.min(100, positiveNumber(source.contentW, DEFAULT_REPORT_LAYOUT.contentW)),
      contentH: Math.min(100, positiveNumber(source.contentH, DEFAULT_REPORT_LAYOUT.contentH)),
      lineSpacing: positiveNumber(source.lineSpacing, DEFAULT_REPORT_LAYOUT.lineSpacing),
      textScale: positiveNumber(source.textScale, DEFAULT_REPORT_LAYOUT.textScale)
    };
  }

  function reportLineCapacity(params) {
    const layout = normalizeReportLayout(params);
    const fontHeightPx = layout.contentSize * layout.textScale * 4 / 3;
    const availableHeightPx = SLIDE_HEIGHT_PX * layout.contentH / 100;
    return Math.max(1, Math.floor(availableHeightPx / (fontHeightPx * layout.lineSpacing)));
  }

  function reportLineSegments(value, params) {
    const text = clean(value);
    if (!text) return [];
    const layout = normalizeReportLayout(params);
    const segments = [];
    text.split('\n').forEach((sourceLine, sourceIndex) => {
      const wrapped = typeof production.wrapTextForBox === 'function'
        ? production.wrapTextForBox(sourceLine, {
          fontSize: layout.contentSize * layout.textScale,
          boxWidth: layout.contentW,
          bold: true
        })
        : sourceLine;
      String(wrapped).split('\n').forEach((line, lineIndex) => {
        segments.push({ text: line, hardBreakBefore: sourceIndex > 0 && lineIndex === 0 });
      });
    });
    return segments;
  }

  function segmentsToText(segments) {
    return (segments || []).reduce((text, segment, index) => {
      const separator = index && segment.hardBreakBefore ? '\n' : '';
      return `${text}${separator}${segment.text}`;
    }, '');
  }

  function reportLines(value, params) {
    return reportLineSegments(value, params).map(segment => segment.text);
  }

  function takeSingleLineContinuation(segments, continuation, layout) {
    const characters = Array.from(segmentsToText(segments));
    let consumed = 0;
    for (let index = 1; index <= characters.length; index += 1) {
      if (reportLineSegments(`${continuation}${characters.slice(0, index).join('')}`, layout).length > 1) break;
      consumed = index;
    }
    if (!consumed) consumed = 1;
    const text = `${continuation}${characters.slice(0, consumed).join('')}`;
    const remainder = characters.slice(consumed).join('');
    segments.splice(0, segments.length, ...reportLineSegments(remainder, layout));
    return text;
  }

  function paginateReportEntries(entries, title, params) {
    const layout = normalizeReportLayout(params);
    const lineCapacity = reportLineCapacity(layout);
    const pages = [];
    let currentParts = [];
    let usedLines = 0;
    const flush = () => {
      if (!currentParts.length) return;
      pages.push({
        kind: 'report',
        title,
        body: currentParts.join('\n\n'),
        estimatedLines: usedLines,
        lineCapacity
      });
      currentParts = [];
      usedLines = 0;
    };

    (entries || []).forEach(entry => {
      let segments = reportLineSegments(entry.text, layout);
      if (!segments.length) return;
      const gap = currentParts.length ? 1 : 0;
      if (segments.length + gap <= lineCapacity - usedLines) {
        currentParts.push(segmentsToText(segments));
        usedLines += segments.length + gap;
        return;
      }

      flush();
      if (segments.length <= lineCapacity) {
        currentParts.push(segmentsToText(segments));
        usedLines = segments.length;
        return;
      }

      currentParts.push(segmentsToText(segments.splice(0, lineCapacity)));
      usedLines = lineCapacity;
      flush();
      while (segments.length) {
        const continuation = entry.continuation || '（續）';
        if (lineCapacity === 1) {
          currentParts.push(takeSingleLineContinuation(segments, continuation, layout));
          usedLines = 1;
          if (segments.length) flush();
          continue;
        }
        const chunk = segments.splice(0, Math.max(1, lineCapacity - 1));
        currentParts.push(`${continuation}\n${segmentsToText(chunk)}`);
        usedLines = 1 + chunk.length;
        if (segments.length) flush();
      }
    });
    flush();
    return pages;
  }

  function buildReportPages(data, params) {
    const reports = normalizeReports(data);
    const pages = [];
    const appendNumberedPages = (items, title) => {
      pages.push(...paginateReportEntries(items.map((text, index) => ({
        text: `${index + 1}. ${text}`,
        continuation: `${index + 1}.（續）`
      })), title, params));
    };
    appendNumberedPages(reports.announcements, '報告－本會消息');
    appendNumberedPages(reports.churchNews, '報告－教界消息');
    const prayerParts = [
      ['在家調養兄姐：', reports.prayer.homeRest],
      ['住院：', reports.prayer.hospital],
      ['其他代禱：', reports.prayer.other]
    ].filter(([, value]) => value).map(([label, value]) => `${label}${value}`);
    if (prayerParts.length) {
      pages.push(...paginateReportEntries(prayerParts.map(text => ({ text, continuation: '（續）' })), '報告－關懷代禱', params));
    }
    return pages;
  }

  function reflowReportPages(model, params) {
    if (!model || !model.announcements) return model;
    const reports = normalizeReports(model.announcements);
    const layout = normalizeReportLayout(params || model.announcements.reportLayout);
    model.announcements.reportLayout = layout;
    model.announcements.pptPages = buildReportPages(reports, layout);
    model.announcements.includeSectionTitle = true;
    return model;
  }

  function applyReportsToModel(model, data, params) {
    if (!model || !model.announcements) return model;
    const reports = normalizeReports(data);
    model.announcements.announcements = reports.announcements;
    model.announcements.churchNews = reports.churchNews;
    model.announcements.prayer = reports.prayer;
    return reflowReportPages(model, params);
  }

  function applyPraiseToModel(model, data) {
    if (!model || !model.praise || !data) return model;
    model.praise.title = clean(data.title) || '讚美';
    model.praise.kicker = clean(data.kicker) || '聖歌隊';
    model.praise.body = clean(data.lyrics);
    return model;
  }

  async function loadCloudRecord(endpoint, kind, date, fetchImpl) {
    const bulletinService = (typeof root !== 'undefined' && root && root.SundayBulletinSupabaseService) ||
                             (typeof window !== 'undefined' && window && window.SundayBulletinSupabaseService);
    const loaderName = kind === 'praise' ? 'loadPraise' : 'loadReports';
    if (bulletinService && typeof bulletinService[loaderName] === 'function') {
      try {
        const data = await bulletinService[loaderName](date);
        if (data) {
          const mappedData = kind === 'praise'
            ? { title: data.title, kicker: data.kicker, lyrics: data.lyrics }
            : { announcements: data.announcements, churchNews: data.churchNews, prayer: data.prayer };
          return { state: 'loaded', data: mappedData };
        }
      } catch (e) {
        // Fallback to the existing GAS endpoint
      }
    }

    const sb = (typeof root !== 'undefined' && root && root._supabase) ||
               (typeof window !== 'undefined' && window && window._supabase) ||
               (typeof globalThis !== 'undefined' && globalThis && globalThis._supabase);
    if (!bulletinService && sb && typeof sb.from === 'function') {
      try {
        const table = kind === 'praise' ? 'sunday_bulletin_praise' : 'sunday_bulletin_reports';
        const { data, error } = await sb.from(table).select('*').eq('date', clean(date)).maybeSingle();
        if (!error && data) {
          const mappedData = kind === 'praise'
            ? { title: data.title, kicker: data.kicker, lyrics: data.lyrics }
            : { announcements: data.announcements, churchNews: data.church_news, prayer: data.prayer };
          return { state: 'loaded', data: mappedData };
        }
      } catch (e) {
        // Fallback to fetchImpl
      }
    }
    const response = await fetchImpl(buildBulletinCloudUrl(endpoint, kind, date));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const json = await response.json();
    return json && json.success && json.data
      ? { state: 'loaded', data: json.data }
      : { state: 'missing', data: null };
  }

  return {
    buildBulletinCloudUrl,
    normalizeReports,
    normalizeReportLayout,
    reportLineCapacity,
    reportLines,
    paginateReportEntries,
    buildReportPages,
    reflowReportPages,
    applyReportsToModel,
    applyPraiseToModel,
    loadCloudRecord
  };
});
