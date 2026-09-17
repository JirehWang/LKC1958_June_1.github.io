(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.WorshipTemplateProfiles = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  const DEFAULT_TEMPLATE_ID = 'taiwanese';

  const taiwaneseCreed = `我信上帝，全能的父，創造天地的主宰。我信耶穌基督，上帝的獨生子，咱的主。祂由聖神投胎，由在室女馬利亞出世；佇本丟彼拉多任內受苦，

釘十字架，死，埋葬，落陰府；第三日由死人中復活，升天，今坐佇全能的父上帝的大傍；祂要自彼再來審判活人及死人。

我信聖神，聖閣公同的教會，聖徒的相通，罪的赦免；肉體的復活；永遠的活命。阿們。`;
  const taiwaneseLordPrayer = `阮在天裡的父。願祢的名聖；祢的國臨到，祢的旨意得成，在地裡親像在天裡。

阮的日食，今仔日給阮。赦免阮的辜負，親像阮亦有赦免辜負阮的人。

勿得導阮入於試，著救阮脫離彼個惡的。因為國、權能、榮光攏是祢所有，代代無盡。阿們。`;

  const taiwaneseCreedPages = [
    { title: '信仰告白—使徒信經', body: '我信上帝，全能的父，創造天地的主宰。我信耶穌基督，上帝的獨生子，咱的主。祂由聖神投胎，由在室女馬利亞出世；佇本丟彼拉多任內受苦，', align: 'left', showTitle: true },
    { title: '信仰告白—使徒信經', body: '釘十字架，死，埋葬，落陰府；\n第三日由死人中復活，升天，\n今坐佇全能的父上帝的大傍；\n祂要自彼再來審判活人及死人。', align: 'left', showTitle: true },
    { title: '信仰告白—使徒信經', body: '我信聖神，聖閣公同的教會，\n聖徒的相通，罪的赦免；肉體的復活；\n永遠的活命。阿們。', align: 'left', showTitle: true }
  ];
  const taiwaneseLordPrayerPages = [
    { title: '主禱文', body: '阮在天裡的父。願祢的名聖；\n祢的國臨到，祢的旨意得成，\n在地裡親像在天裡。', align: 'center', showTitle: true },
    { title: '主禱文', body: '阮的日食，今仔日給阮。\n赦免阮的辜負，\n親像阮亦有赦免辜負阮的人。', align: 'center', showTitle: true },
    { title: '主禱文', body: '勿得導阮入於試，著救阮脫離彼個惡的。\n因為國、權能、榮光攏是祢所有，\n代代無盡。阿們。', align: 'center', showTitle: true }
  ];

  const pct = (value, total) => Number((Number(value) / total * 100).toFixed(2));
  function dualLayout(primaryBox, secondaryBox, titleBox, options = {}) {
    const title = titleBox || [88, 38.33, 1104, 139.17];
    return {
      titleSize: 60,
      titleX: pct(title[0], 1280), titleY: pct(title[1], 720),
      titleW: pct(title[2], 1280), titleH: pct(title[3], 720),
      titleAlign: 'center', titleColor: '#000000',
      contentSize: 48,
      contentX: pct(primaryBox[0], 1280), contentY: pct(primaryBox[1], 720),
      contentW: pct(primaryBox[2], 1280), contentH: pct(primaryBox[3], 720),
      contentAlign: 'left', contentColor: '#000000', lineSpacing: options.primaryLineSpacing || 1.5,
      secondaryContentSize: 48,
      secondaryContentX: pct(secondaryBox[0], 1280), secondaryContentY: pct(secondaryBox[1], 720),
      secondaryContentW: pct(secondaryBox[2], 1280), secondaryContentH: pct(secondaryBox[3], 720),
      secondaryContentAlign: 'left', secondaryContentColor: '#0070C0', secondaryLineSpacing: options.secondaryLineSpacing || 1.5
    };
  }

  function dualPage(title, primaryBody, secondaryBody, primaryBox, secondaryBox, titleBox, options = {}) {
    return {
      kind: 'dual-liturgical',
      title,
      primaryLabel: options.showLabels ? '台' : '',
      secondaryLabel: options.showLabels ? '華' : '',
      primaryBody,
      secondaryBody,
      primaryColor: '#000000',
      secondaryColor: '#0070C0',
      showTitle: true,
      layout: dualLayout(primaryBox, secondaryBox, titleBox, options)
    };
  }

  const jointCreedPages = [
    dualPage('信仰告白 – 使徒信經', '我信上帝，全能的父，創造天地的主宰。', '我信上帝，全能的父，創造天地的主。', [75.5, 167.5, 537.33, 479.17], [654.67, 167.5, 550.17, 440], undefined, { showLabels: true }),
    dualPage('信仰告白 – 使徒信經', '我信耶穌基督，上帝的獨生子，咱的主。祂由聖神投胎，由在室女馬利亞出世；', '我信我主耶穌基督，上帝的獨生子。祂從聖靈感孕，由童貞女馬利亞所生', [81, 165.67, 541.5, 386.83], [672, 150.33, 558.67, 386.83], undefined, { primaryLineSpacing: 1.25 }),
    dualPage('信仰告白 – 使徒信經', '佇本丟彼拉多任內受苦，釘十字架，死，埋葬，落陰府；第三日對死人中復活，升天，', '在本丟彼拉多手下受難，被釘於十字架，受死，埋葬，降在陰間，第三天從死人中復活，升天，', [52.67, 156.83, 581.83, 386.83], [654.5, 156.83, 596.5, 473.33], undefined, { primaryLineSpacing: 1.25, secondaryLineSpacing: 1.25 }),
    dualPage('信仰告白 – 使徒信經', '今坐佇全能的父上帝的大傍；祂要自彼再來審判活人及死人。', '坐在全能父上帝的右邊；將來必從那裡降臨，審判活人與死人。', [86.5, 177.5, 541.5, 386.83], [649.67, 177.5, 544.17, 386.83]),
    dualPage('信仰告白 – 使徒信經', '我信聖神。聖閣公同的教會，聖徒的相通，罪的赦免；肉體的復活；永遠的活命。阿們。', '我信聖靈，聖而公的教會，聖徒的相通，罪的赦免；身體的復活；永遠的生命。阿們。', [69.83, 177.5, 541.5, 386.83], [657.17, 177.5, 544.17, 386.83], undefined, { primaryLineSpacing: 1.25, secondaryLineSpacing: 1.25 })
  ];
  const jointLordPrayerPages = [
    dualPage('主禱文', '阮在天裡的父：願祢的名聖；祢的國臨到，', '我們在天上的父：願人都尊你的名為聖；願你的國降臨', [88, 215.17, 544, 433.33], [671.5, 203.5, 544, 456.83], [88, 48.5, 1104, 143.17], { showLabels: true }),
    dualPage('主禱文', '祢的旨意得成，\n在地裡親像在天裡\n阮的日食今仔日給阮。', '願你的旨意行在地上，如同行在天上；我們日用的飲食，今日賜給我們。', [71.67, 191.67, 560.33, 456.83], [648, 191.67, 544, 456.83]),
    dualPage('主禱文', '赦免阮的辜負，親像阮亦有赦免辜負阮的人。勿得導阮入於試，著救阮脫離彼個惡的。', '免我們的債，如同我們免了人的債。不叫我們遇見試探，救我們脫離兇惡。', [88, 141.67, 544, 456.83], [648, 141.67, 544, 456.83]),
    dualPage('主禱文', '因為國，權能，榮光攏是祢所有，代代無盡。\n阿們。', '因為國度、權柄、榮耀全是你的，直到永遠。\n阿們。', [58.17, 191.67, 558.67, 456.83], [673, 191.67, 561.67, 456.83])
  ];

  const jointCreedPrimary = jointCreedPages.map(page => page.primaryBody).join('\n\n');
  const jointCreedSecondary = jointCreedPages.map(page => page.secondaryBody).join('\n\n');
  const jointPrayerPrimary = jointLordPrayerPages.map(page => page.primaryBody).join('\n\n');
  const jointPrayerSecondary = jointLordPrayerPages.map(page => page.secondaryBody).join('\n\n');

  const profiles = {
    taiwanese: {
      id: 'taiwanese',
      label: '台語主日禮拜',
      selectorLabel: '台語',
      coverTitle: '台語主日禮拜',
      filenamePrefix: '台語主日禮拜',
      draftKey: 'lkc-taiwanese-worship-draft',
      eventTypeName: '台語',
      eventTypeFullName: '講道資訊-台語',
      calendarSelector: { typeName: '台語', typeFullName: '講道資訊-台語' },
      bibleVersions: ['tghg'],
      bibleSections: [
        { sectionId: 'call', label: '宣召', versions: ['tghg'] },
        { sectionId: 'scripture', label: '聖經', versions: ['tghg'] },
        { sectionId: 'verse', label: '聖經', versions: ['tghg'], prependTitle: '金句' }
      ],
      activeSectionId: 'prelude-singing',
      defaultBackgroundColor: '#ffffff',
      assets: {},
      hymnOpacitySectionIds: ['pre-hymn-1', 'pre-hymn-2', 'hymn-1', 'prayer-song', 'hymn-2', 'offering', 'doxology', 'amen'],
      hymnTitleSectionIds: ['pre-hymn-1', 'pre-hymn-2', 'hymn-1', 'hymn-2', 'doxology'],
      fixedLibrary: [
        { sectionId: 'prayer-song', sourceValue: '261', includeSectionTitle: false },
        { sectionId: 'offering', sourceValue: '306B', includeSectionTitle: true },
        { sectionId: 'amen', sourceValue: '522', includeSectionTitle: false }
      ],
      librarySections: [
        ['pre-hymn-1', 'hymn'], ['pre-hymn-2', 'hymn'], ['hymn-1', 'hymn'], ['hymn-2', 'hymn'],
        ['doxology', 'hymn'], ['response', 'response'], ['prayer-song', 'hymn'], ['offering', 'hymn'], ['amen', 'hymn']
      ],
      sourceRequirements: {
        calendarFields: [
          ['sermon', 'title', '講題'], ['sermon', 'kicker', '講員'], ['call', 'sourceValue', '宣召'],
          ['scripture', 'sourceValue', '經文'], ['verse', 'sourceValue', '金句'], ['response', 'sourceValue', '啟應文'],
          ['hymn-1', 'sourceValue', '聖詩一'], ['hymn-2', 'sourceValue', '聖詩二'], ['doxology', 'sourceValue', '頌榮']
        ],
        bibleSections: [['call', '宣召'], ['scripture', '聖經'], ['verse', '金句']],
        reports: true,
        praise: true
      },
      sections: [
        ['cover', '台語主日禮拜', 'cover'], ['prelude-singing', '會前領唱', 'title'], ['pre-hymn-1', '會前聖詩一', 'hymn'],
        ['pre-hymn-2', '會前聖詩二', 'hymn'], ['service-cover', '台語主日禮拜', 'cover'], ['silence', '靜默一分鐘', 'title'],
        ['prelude', '序樂', 'title'], ['call', '宣召', 'calendar'], ['hymn-1', '聖詩一', 'hymn'],
        ['creed', '信仰告白—使徒信經', 'fixed', { body: taiwaneseCreed, pptPages: taiwaneseCreedPages }],
        ['response', '啟應文', 'port'], ['prayer-1', '祈禱', 'title'],
        ['lord-prayer', '主禱文', 'fixed', { body: taiwaneseLordPrayer, pptPages: taiwaneseLordPrayerPages }],
        ['prayer-song', '祈禱詩', 'fixed-title'], ['scripture', '聖經', 'calendar'], ['praise', '讚美', 'praise'],
        ['sermon', '講道', 'sermon'], ['prayer-2', '祈禱', 'title'], ['hymn-2', '聖詩二', 'hymn'],
        ['announcements', '報告', 'manual'], ['verse', '金句', 'calendar'], ['offering', '奉獻', 'fixed-title'],
        ['doxology', '頌榮', 'calendar'], ['blessing', '祝禱', 'title'], ['amen', '阿們頌', 'fixed-title'],
        ['postlude', '後奏', 'title'], ['peace', '平安禮', 'title'],
        ['car-notice', '移車提醒', 'car-notice', { title: '敬請停在車道的車主儘快移車', includeInExport: true }]
      ]
    },
    'joint-mandarin': {
      id: 'joint-mandarin',
      label: '聯合－華語',
      selectorLabel: '聯合－華語',
      coverTitle: '台 華 語 聯 合 禮 拜',
      filenamePrefix: '聯合-華語禮拜',
      draftKey: 'lkc-worship-draft-joint-mandarin',
      eventTypeName: '聯合-華語',
      eventTypeFullName: '講道資訊-聯合-華語',
      calendarSelector: { typeName: '聯合-華語', typeFullName: '講道資訊-聯合-華語' },
      bibleVersions: ['tghg', 'unv'],
      bibleSections: [
        { sectionId: 'call', label: '宣召', versions: ['tghg', 'unv'], languageLabels: ['台', '華'] },
        { sectionId: 'scripture', label: '聖經', versions: ['tghg', 'unv'], languageLabels: ['台', '華'] }
      ],
      activeSectionId: 'silence',
      defaultBackgroundColor: '#ffffff',
      assets: {
        worshipMoment: 'templates/joint-mandarin-worship-moment.png',
        offering: 'templates/joint-mandarin-offering.png',
        thanksgiving: 'templates/joint-mandarin-thanksgiving.png'
      },
      hymnOpacitySectionIds: [],
      fixedLibrary: [],
      librarySections: [],
      sourceRequirements: {
        calendarFields: [
          ['sermon', 'title', '講題'], ['sermon', 'kicker', '講員'],
          ['call', 'sourceValue', '宣召'], ['scripture', 'sourceValue', '經文']
        ],
        bibleSections: [['call', '宣召'], ['scripture', '聖經']],
        reports: true,
        praise: false
      },
      sections: [
        ['cover', '台華語聯合禮拜', 'cover'],
        ['silence', '靜默一分鐘', 'title', { kicker: '請將手機關機或靜音' }],
        ['prelude', '序樂', 'title'],
        ['call', '宣召', 'calendar'],
        ['worship-moment', '全心敬拜時刻', 'static', { pptPages: [{ kind: 'full-image', assetKey: 'worshipMoment' }] }],
        ['creed', '信仰告白－使徒信經', 'dual-fixed', { body: jointCreedPrimary, secondaryBody: jointCreedSecondary, pptPages: jointCreedPages }],
        ['scripture', '聖經', 'calendar'],
        ['prayer-1', '祈禱', 'title'],
        ['lord-prayer', '主禱文', 'dual-fixed', { body: jointPrayerPrimary, secondaryBody: jointPrayerSecondary, pptPages: jointLordPrayerPages }],
        ['sermon', '講道', 'sermon'],
        ['response-song', '回應詩', 'title'],
        ['announcements', '報告', 'manual'],
        ['offering', '奉獻', 'static', { pptPages: [{ kind: 'full-image', assetKey: 'offering' }] }],
        ['thanksgiving', '獻上感恩', 'static', { pptPages: [{ kind: 'full-image', assetKey: 'thanksgiving' }] }],
        ['blessing', '祝禱', 'title'],
        ['peace', '平安禮', 'title', { kicker: '請兄弟姊妹互相行平安禮' }],
        ['car-notice', '移車提醒', 'car-notice', { title: '敬請停在車道的車主儘快移車', includeInExport: true }]
      ]
    }
  };

  profiles['joint-taiwanese'] = {
    ...clone(profiles.taiwanese),
    id: 'joint-taiwanese',
    label: '聯合－台語',
    selectorLabel: '聯合－台語',
    coverTitle: '台 華 語 聯 合 禮 拜',
    filenamePrefix: '聯合-台語禮拜',
    draftKey: 'lkc-worship-draft-joint-taiwanese',
    eventTypeName: '聯合-台語',
    eventTypeFullName: '講道資訊-聯合-台語',
    calendarSelector: { typeName: '聯合-台語', typeFullName: '講道資訊-聯合-台語' },
    bibleVersions: ['tghg', 'unv'],
    bibleSections: [
      { sectionId: 'call', label: '宣召', versions: ['tghg', 'unv'], languageLabels: ['台', '華'] },
      { sectionId: 'scripture', label: '聖經', versions: ['tghg', 'unv'], languageLabels: ['台', '華'] },
      { sectionId: 'verse', label: '聖經', versions: ['tghg', 'unv'], languageLabels: ['台', '華'], prependTitle: '金句' }
    ],
    layoutFallbackTemplateId: 'taiwanese',
    layoutFallbackExcludedSections: ['creed', 'lord-prayer'],
    sections: clone(profiles.taiwanese.sections).map(section => {
      const [id, label, type, defaults] = section;
      if (id === 'cover' || id === 'service-cover') return [id, '台華語聯合禮拜', type, defaults];
      if (id === 'creed') {
        return [id, '信仰告白－使徒信經', 'dual-fixed', {
          body: jointCreedPrimary,
          secondaryBody: jointCreedSecondary,
          pptPages: clone(jointCreedPages)
        }];
      }
      if (id === 'lord-prayer') {
        return [id, '主禱文', 'dual-fixed', {
          body: jointPrayerPrimary,
          secondaryBody: jointPrayerSecondary,
          pptPages: clone(jointLordPrayerPages)
        }];
      }
      return [id, label, type, defaults];
    })
  };

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function getTemplateProfile(templateId) {
    return profiles[templateId] || profiles[DEFAULT_TEMPLATE_ID];
  }

  function resolveTemplateId(search) {
    const query = String(search || '').replace(/^\?/, '');
    const params = new URLSearchParams(query);
    const requested = params.get('template') || '';
    return profiles[requested] ? requested : DEFAULT_TEMPLATE_ID;
  }

  function createTemplateModel(profileInput) {
    const profile = profileInput || getTemplateProfile(DEFAULT_TEMPLATE_ID);
    const model = {};
    profile.sections.forEach(([id, label, type, defaults]) => {
      const source = clone(defaults || {});
      model[id] = {
        label,
        type,
        title: source.title || label,
        kicker: source.kicker || '',
        body: source.body || '',
        opacity: Number(source.opacity) || 60,
        ...source
      };
    });
    (profile.fixedLibrary || []).forEach(({ sectionId, sourceValue, includeSectionTitle }) => {
      if (!model[sectionId]) return;
      model[sectionId].sourceValue = sourceValue;
      model[sectionId].includeSectionTitle = includeSectionTitle;
    });
    return model;
  }

  return {
    DEFAULT_TEMPLATE_ID,
    profiles,
    getTemplateProfile,
    resolveTemplateId,
    createTemplateModel
  };
});
