// ⚡ apps/LKC_worship/worship-supabase.js
// 敬拜團 Supabase 熱響應服務模組 (含冷熱資料自動分流)

(function(window) {
  const HOT_YEAR_THRESHOLD = 2025; // 2025 年及以後走 Supabase (熱響應 <50ms)

  let _supabaseClient = null;

  // 初始化 Supabase Client
  function getSupabase() {
    if (_supabaseClient) return _supabaseClient;
    const config = window._SUPABASE_CONFIG || {};
    if (!config.url || !config.anonKey) {
      console.warn('⚠️ Supabase 設定尚未載入');
      return null;
    }
    if (typeof window.supabase === 'undefined' && typeof createClient === 'undefined') {
      console.warn('⚠️ Supabase JS SDK 尚未載入');
      return null;
    }
    const create = (window.supabase && window.supabase.createClient) || createClient;
    const options = typeof window.__LKC_OBSERVABILITY_SUPABASE_OPTIONS__ === 'function'
      ? window.__LKC_OBSERVABILITY_SUPABASE_OPTIONS__({ system: 'LKC_worship' })
      : undefined;
    _supabaseClient = create(config.url, config.anonKey, options);
    return _supabaseClient;
  }

  // 判斷是否為熱資料年份
  function isHotYear(year) {
    const y = parseInt(year, 10);
    return !isNaN(y) && y >= HOT_YEAR_THRESHOLD;
  }

  function isHotDate(dateStr) {
    if (!dateStr) return true;
    const y = parseInt(dateStr.slice(0, 4), 10);
    return isHotYear(y);
  }

  // 將 Supabase 資料庫中的 schedule row 轉換為前端預期的物件格式
  function transformDbScheduleToClient(row) {
    if (!row) return null;
    const base = {
      '日期': row.date,
      '聚會名稱': row.meeting_name || '',
      '聚會類別': row.meeting_category || '',
      '年度': row.year || '',
      '季度': row.quarter || '',
      '牧師': row.preacher || '',
      '題目': row.topic || '',
      '經文': row.scripture || '',
      '敬拜曲目': row.songs || '',
      'leaves': Array.isArray(row.leaves) ? row.leaves : []
    };

    // 展開動態崗位人員
    const assignments = (typeof row.positions_assignment === 'object' && row.positions_assignment) || {};
    Object.keys(assignments).forEach(k => {
      base[k] = assignments[k];
    });

    // 若有 raw_data 中的額外欄位也保留
    if (row.raw_data && typeof row.raw_data === 'object') {
      Object.keys(row.raw_data).forEach(k => {
        if (base[k] === undefined) base[k] = row.raw_data[k];
      });
    }

    return base;
  }

  // 將前端 schedule 物件轉換為 Supabase DB row 格式
  function transformClientScheduleToDb(item) {
    const date = item['日期'];
    if (!date) return null;

    const fixedKeys = new Set(['日期', '聚會名稱', '聚會類別', '年度', '季度', '牧師', '題目', '經文', '敬拜曲目', 'leaves', 'hasWarning', 'warningMessage']);
    const assignments = {};
    Object.keys(item).forEach(k => {
      if (!fixedKeys.has(k)) {
        assignments[k] = item[k];
      }
    });

    const [yearPart] = date.split('-');
    const m = parseInt(date.split('-')[1] || '1', 10);
    const q = 'Q' + (Math.floor((m - 1) / 3) + 1);

    return {
      date: date,
      meeting_name: item['聚會名稱'] || '',
      meeting_category: item['聚會類別'] || '',
      year: item['年度'] || yearPart,
      quarter: item['季度'] || q,
      preacher: item['牧師'] || '',
      topic: item['題目'] || '',
      scripture: item['經文'] || '',
      songs: item['敬拜曲目'] || '',
      positions_assignment: assignments,
      leaves: Array.isArray(item.leaves) ? item.leaves : [],
      raw_data: item,
      updated_at: new Date().toISOString()
    };
  }

  // ── 整合行事曆講道與事項資訊 (即時熱響應水合) ─────────────────
  async function hydrateSchedulesWithCalendar(sb, clientRows) {
    if (!sb || !Array.isArray(clientRows) || clientRows.length === 0) return clientRows;
    const dates = [...new Set(clientRows.map(r => r && r['日期']).filter(Boolean))];
    if (dates.length === 0) return clientRows;

    try {
      const [linkRes, typesRes, eventsRes, fieldsRes] = await Promise.all([
        sb.from('worship_calendar_links').select('*').eq('id', 'default').maybeSingle(),
        sb.from('calendar_types').select('*'),
        sb.from('calendar_events').select('*').in('date', dates),
        sb.from('calendar_fields').select('*')
      ]);

      const linkData = linkRes.data;
      const defaultSubId = (linkData && linkData.default_sermon_subtype_id) || '';
      const overrides = (linkData && linkData.overrides) || {};

      const types = typesRes.data || [];
      const typeById = {};
      types.forEach(t => { typeById[t.type_id] = t; });

      const sermonRoot = types.find(t => !t.parent_type_id && t.name === '講道資訊');
      const sermonSubTypes = sermonRoot ? types.filter(t => t.parent_type_id === sermonRoot.type_id) : [];
      const sermonSubIds = new Set(sermonSubTypes.map(t => t.type_id));
      const subTypeNameById = {};
      sermonSubTypes.forEach(t => { subTypeNameById[t.type_id] = t.name; });

      const events = eventsRes.data || [];
      const eventIds = events.map(e => e.event_id);

      const fieldById = {};
      (fieldsRes.data || []).forEach(f => { fieldById[f.field_id] = f.name; });

      let valuesByEvent = {};
      if (eventIds.length > 0) {
        const { data: valuesRes } = await sb.from('calendar_event_values').select('*').in('event_id', eventIds);
        (valuesRes || []).forEach(v => {
          if (!valuesByEvent[v.event_id]) valuesByEvent[v.event_id] = {};
          const fName = fieldById[v.field_id] || v.field_id;
          valuesByEvent[v.event_id][fName] = v.value != null ? String(v.value) : '';
        });
      }

      events.forEach(e => {
        if (!valuesByEvent[e.event_id]) valuesByEvent[e.event_id] = {};
        if (e.field_values && typeof e.field_values === 'object') {
          Object.entries(e.field_values).forEach(([fid, val]) => {
            const fName = fieldById[fid] || fid;
            if (valuesByEvent[e.event_id][fName] === undefined && val != null) {
              valuesByEvent[e.event_id][fName] = String(val);
            }
          });
        }
      });

      const eventsByDate = {};
      events.forEach(e => {
        const d = String(e.date).slice(0, 10);
        if (!eventsByDate[d]) eventsByDate[d] = [];
        eventsByDate[d].push(e);
      });

      const sermonCacheByDate = {};
      function resolveSermonForDate(d) {
        if (sermonCacheByDate.hasOwnProperty(d)) return sermonCacheByDate[d];
        const dayEvents = eventsByDate[d] || [];
        const effectiveSubId = (overrides[d] && overrides[d].trim()) || defaultSubId;
        let sermonEvent = null;
        if (effectiveSubId) {
          sermonEvent = dayEvents.find(e => e.type_id === effectiveSubId) || null;
        }
        if (!sermonEvent && sermonSubIds.size > 0) {
          sermonEvent = dayEvents.find(e => sermonSubIds.has(e.type_id) && typeById[e.type_id] && typeById[e.type_id].name !== '台語')
            || dayEvents.find(e => sermonSubIds.has(e.type_id))
            || null;
        }
        const res = { effectiveSubId, sermonEvent };
        sermonCacheByDate[d] = res;
        return res;
      }

      clientRows.forEach(row => {
        const date = row && row['日期'];
        if (!date) return;
        const dayEvents = eventsByDate[date] || [];
        const { effectiveSubId, sermonEvent } = resolveSermonForDate(date);

        // 1. 聚會名稱
        let namedEvent = null;
        const currentMeeting = String(row['聚會名稱'] || '').trim();
        if (currentMeeting && currentMeeting !== '(無標題)') {
          namedEvent = dayEvents.find(e => {
            const t = (e.title || '').trim();
            return t && (t.includes(currentMeeting) || currentMeeting.includes(t));
          }) || null;
        } else {
          const meetingNameType = types.find(t => t.name === '聚會名稱');
          if (meetingNameType) {
            namedEvent = dayEvents.find(e => e.type_id === meetingNameType.type_id) || null;
          }
          if (!namedEvent && dayEvents.length > 0) {
            namedEvent = dayEvents.find(e => !sermonSubIds.has(e.type_id)) || null;
          }
        }

        if (namedEvent && namedEvent.title && namedEvent.title !== '(無標題)') {
          row['聚會名稱'] = String(namedEvent.title).trim();
        }

        // 2. 聚會類別
        if (sermonEvent && typeById[sermonEvent.type_id]) {
          row['聚會類別'] = String(typeById[sermonEvent.type_id].name).trim();
        } else {
          const effSubName = subTypeNameById[effectiveSubId];
          if (effSubName) {
            row['聚會類別'] = effSubName;
          } else if (!row['聚會類別']) {
            row['聚會類別'] = '主日';
          }
        }

        // 3. 講道資訊 (牧師、題目、經文、詩歌)
        if (sermonEvent) {
          const vals = valuesByEvent[sermonEvent.event_id] || {};
          const speaker = vals['講員'] || vals['講道者'] || '';
          const topic = vals['講題'] || vals['題目'] || vals['講道題目'] || '';
          const scripture = vals['經文'] || vals['講道經文'] || '';
          const hymns = vals['聖詩一'] || vals['詩歌'] || vals['回應詩'] || '';

          if (speaker) row['牧師'] = speaker;
          if (topic) row['題目'] = topic;
          if (scripture) row['經文'] = scripture;
          if (hymns && !row['敬拜曲目']) row['敬拜曲目'] = hymns;
        }
      });
    } catch (e) {
      console.warn('[WorshipSupabase] 水合行事曆資料失敗 (使用排班表原值):', e);
    }

    return clientRows;
  }

  // ── 核心 API 實作 ──────────────────────────────────────────

  const WorshipSupabaseService = {
    // 1. 取得崗位設定
    async getPositions() {
      const sb = getSupabase();
      if (!sb) throw new Error('Supabase 未初始化');
      const { data, error } = await sb
        .from('worship_positions')
        .select('*')
        .order('sort_order', { ascending: true });

      if (error) throw error;
      return {
        status: 'success',
        data: (data || []).map(p => ({
          positionName: p.position_name,
          personnel: p.personnel || '',
          isRequired: p.is_required || '是'
        }))
      };
    },

    // 2. 儲存崗位設定
    async savePositions(payload) {
      const sb = getSupabase();
      if (!sb) throw new Error('Supabase 未初始化');
      const list = payload.positionsData || [];

      // 先清空再批次寫入
      await sb.from('worship_positions').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      if (list.length > 0) {
        const rows = list.map((p, idx) => ({
          position_name: p.positionName,
          personnel: p.personnel || '',
          is_required: p.isRequired || '是',
          sort_order: idx + 1
        }));
        const { error } = await sb.from('worship_positions').insert(rows);
        if (error) throw error;
      }

      return { status: 'success', message: '位置設定已儲存！' };
    },

    // 3. 取得敬拜團員名單
    async getTeamMembers() {
      const sb = getSupabase();
      if (!sb) throw new Error('Supabase 未初始化');
      const { data, error } = await sb
        .from('worship_team_members')
        .select('*')
        .order('name', { ascending: true });

      if (error) throw error;
      return {
        status: 'success',
        data: (data || []).map(m => ({
          name: m.name,
          uid: m.uid || '',
          status: m.status || '正式',
          joinDate: m.join_date || ''
        }))
      };
    },

    // 4. 儲存敬拜團員名單
    async saveTeamMembers(payload) {
      const sb = getSupabase();
      if (!sb) throw new Error('Supabase 未初始化');
      const members = payload.members || [];

      await sb.from('worship_team_members').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      if (members.length > 0) {
        const rows = members.map(m => ({
          name: m.name,
          uid: m.uid || '',
          status: m.status || '正式',
          join_date: m.joinDate || new Date().toISOString()
        }));
        const { error } = await sb.from('worship_team_members').insert(rows);
        if (error) throw error;
      }

      return { status: 'success', message: '敬拜團員名單已儲存！' };
    },

    // 5. 取得季度排班 (支援冷熱分流)
    async getSchedule(payload) {
      const year = payload && payload.year;
      const quarter = payload && payload.quarter;

      // 冷資料判定：若早於閾值年份，走 GAS 歷史存檔
      if (!isHotYear(year)) {
        console.log(`[Worship] 查詢 ${year} ${quarter} 為久遠歷史資料，切換至 GAS 讀取...`);
        return await window.churchAPI('getSchedule', payload);
      }

      // 熱資料：直接讀 Supabase (<50ms)
      const sb = getSupabase();
      if (!sb) return await window.churchAPI('getSchedule', payload);

      const { data, error } = await sb
        .from('worship_schedules')
        .select('*')
        .eq('year', String(year))
        .eq('quarter', String(quarter))
        .order('date', { ascending: true });

      if (error) throw error;
      const clientRows = (data || []).map(transformDbScheduleToClient);
      await hydrateSchedulesWithCalendar(sb, clientRows);
      return {
        status: 'success',
        data: clientRows
      };
    },

    // 6. 依日期區間取得排班 (支援冷熱分流)
    async getScheduleByDateRange(payload) {
      const start = payload && payload.startDate;
      const end = payload && payload.endDate;

      if (!isHotDate(start)) {
        console.log(`[Worship] 查詢區間 ${start}~${end} 含久遠歷史，切換至 GAS 讀取...`);
        return await window.churchAPI('getScheduleByDateRange', payload);
      }

      const sb = getSupabase();
      if (!sb) return await window.churchAPI('getScheduleByDateRange', payload);

      let query = sb.from('worship_schedules').select('*');
      if (start) query = query.gte('date', start);
      if (end) query = query.lte('date', end);
      query = query.order('date', { ascending: true });

      const { data, error } = await query;
      if (error) throw error;
      const clientRows = (data || []).map(transformDbScheduleToClient);
      await hydrateSchedulesWithCalendar(sb, clientRows);
      return {
        status: 'success',
        data: clientRows
      };
    },

    // 7. 儲存排班表 (熱響應寫入)
    async saveSchedule(payload) {
      const sb = getSupabase();
      if (!sb) throw new Error('Supabase 未初始化');

      const items = payload.scheduleData || [];
      if (items.length === 0) return { status: 'success', message: '無資料需要儲存' };

      const dbRows = items.map(transformClientScheduleToDb).filter(Boolean);
      const { error } = await sb
        .from('worship_schedules')
        .upsert(dbRows, { onConflict: 'date' });

      if (error) throw error;
      return { status: 'success', message: '服事表儲存成功！' };
    },

    // 8. 取得曲目 (轉呼叫 getSchedule / getScheduleByDateRange)
    async getSongs(payload) {
      if (payload && payload.startDate) {
        return await this.getScheduleByDateRange(payload);
      }
      return await this.getSchedule(payload);
    },

    // 9. 儲存曲目
    async saveSongs(payload) {
      const sb = getSupabase();
      if (!sb) throw new Error('Supabase 未初始化');

      const songsData = payload.songsData || [];
      if (songsData.length === 0) return { status: 'success', message: '無資料' };

      for (const item of songsData) {
        const date = item['日期'];
        const songs = item['敬拜曲目'] || '';
        if (date) {
          await sb
            .from('worship_schedules')
            .update({ songs: songs, updated_at: new Date().toISOString() })
            .eq('date', date);
        }
      }

      return { status: 'success', message: '曲目已成功儲存！' };
    },

    // 10. 行事曆連結設定
    async getCalendarLinkConfig() {
      const sb = getSupabase();
      if (!sb) return await window.churchAPI('getCalendarLinkConfig', {});

      const { data } = await sb
        .from('worship_calendar_links')
        .select('*')
        .eq('id', 'default')
        .maybeSingle();

      // 直接從 Supabase 的 calendar_types 獲取可用的 sermonSubTypes
      let subTypes = [];
      try {
        const { data: typesData } = await sb.from('calendar_types').select('*').order('sort_order', { ascending: true });
        const sermonRoot = (typesData || []).find(t => !t.parent_type_id && t.name === '講道資訊');
        if (sermonRoot) {
          subTypes = (typesData || [])
            .filter(t => t.parent_type_id === sermonRoot.type_id && t.name !== '台語')
            .map(t => ({
              typeId: t.type_id,
              name: t.name,
              icon: t.icon || '',
              color: t.color || '#5b8def'
            }));
        }
      } catch (e) {
        console.warn('[WorshipSupabase] 讀取 calendar_types 失敗:', e);
      }

      if (subTypes.length === 0) {
        try {
          const gasRes = await window.churchAPI('getCalendarLinkConfig', {});
          if (gasRes && gasRes.status === 'success' && gasRes.data) {
            subTypes = gasRes.data.sermonSubTypes || [];
          }
        } catch (e) {}
      }

      const defaultSub = (data && data.default_sermon_subtype_id) || '';
      const overrides = (data && data.overrides) || {};

      return {
        status: 'success',
        data: {
          defaultSermonSubTypeId: defaultSub,
          overrides: overrides,
          sermonSubTypes: subTypes,
          calendarReachable: subTypes.length > 0,
          defaultIsValid: subTypes.some(t => t.typeId === defaultSub)
        }
      };
    },

    async setDefaultSermonSubType(payload) {
      const sb = getSupabase();
      if (!sb) return await window.churchAPI('setDefaultSermonSubType', payload);

      const typeId = payload.typeId || '';
      const { error } = await sb
        .from('worship_calendar_links')
        .upsert({ id: 'default', default_sermon_subtype_id: typeId, updated_at: new Date().toISOString() });

      if (error) throw error;
      return { status: 'success', message: '預設講道子類型已儲存' };
    },

    async setDateOverride(payload) {
      const sb = getSupabase();
      if (!sb) return await window.churchAPI('setDateOverride', payload);

      const { date, typeId } = payload;
      const { data } = await sb.from('worship_calendar_links').select('overrides').eq('id', 'default').single();
      const overrides = (data && data.overrides) || {};

      if (typeId) overrides[date] = typeId;
      else delete overrides[date];

      const { error } = await sb
        .from('worship_calendar_links')
        .upsert({ id: 'default', overrides: overrides, updated_at: new Date().toISOString() });

      if (error) throw error;
      return { status: 'success', message: '日期覆寫已更新' };
    },

    // 11. 清除行事曆快取
    async clearCalendarLinkCache() {
      return { status: 'success', message: '✅ 行事曆快取已清除' };
    },

    // 12. 依日期查詢行事曆資料 (供公佈欄與新增聚會水合使用)
    async getCalendarDataForDates(payload) {
      const sb = getSupabase();
      if (!sb) return await window.churchAPI('getCalendarDataForDates', payload);

      let entries = [];
      if (Array.isArray(payload && payload.entries)) {
        entries = payload.entries.map(e => ({
          date: String(e.date || '').trim().slice(0, 10),
          meetingName: String(e.meetingName || '').trim()
        })).filter(e => e.date);
      } else if (Array.isArray(payload && payload.dates)) {
        const map = payload.meetingNamesByDate || {};
        entries = payload.dates.map(d => ({
          date: String(d).trim().slice(0, 10),
          meetingName: String(map[d] || '').trim()
        })).filter(e => e.date);
      } else {
        return { status: 'success', data: {} };
      }

      const dates = [...new Set(entries.map(e => e.date))];
      if (dates.length === 0) return { status: 'success', data: {} };

      try {
        const [linkRes, typesRes, eventsRes, fieldsRes] = await Promise.all([
          sb.from('worship_calendar_links').select('*').eq('id', 'default').maybeSingle(),
          sb.from('calendar_types').select('*'),
          sb.from('calendar_events').select('*').in('date', dates),
          sb.from('calendar_fields').select('*')
        ]);

        const linkData = linkRes.data;
        const defaultSubId = (linkData && linkData.default_sermon_subtype_id) || '';
        const overrides = (linkData && linkData.overrides) || {};

        const types = typesRes.data || [];
        const typeById = {};
        types.forEach(t => { typeById[t.type_id] = t; });

        const sermonRoot = types.find(t => !t.parent_type_id && t.name === '講道資訊');
        const sermonSubTypes = sermonRoot ? types.filter(t => t.parent_type_id === sermonRoot.type_id) : [];
        const sermonSubIds = new Set(sermonSubTypes.map(t => t.type_id));

        const events = eventsRes.data || [];
        const eventIds = events.map(e => e.event_id);

        const fieldById = {};
        (fieldsRes.data || []).forEach(f => { fieldById[f.field_id] = f.name; });

        let valuesByEvent = {};
        if (eventIds.length > 0) {
          const { data: valuesRes } = await sb.from('calendar_event_values').select('*').in('event_id', eventIds);
          (valuesRes || []).forEach(v => {
            if (!valuesByEvent[v.event_id]) valuesByEvent[v.event_id] = {};
            const fName = fieldById[v.field_id] || v.field_id;
            valuesByEvent[v.event_id][fName] = v.value != null ? String(v.value) : '';
          });
        }

        events.forEach(e => {
          if (!valuesByEvent[e.event_id]) valuesByEvent[e.event_id] = {};
          if (e.field_values && typeof e.field_values === 'object') {
            Object.entries(e.field_values).forEach(([fid, val]) => {
              const fName = fieldById[fid] || fid;
              if (valuesByEvent[e.event_id][fName] === undefined && val != null) {
                valuesByEvent[e.event_id][fName] = String(val);
              }
            });
          }
        });

        const eventsByDate = {};
        events.forEach(e => {
          const d = String(e.date).slice(0, 10);
          if (!eventsByDate[d]) eventsByDate[d] = [];
          eventsByDate[d].push(e);
        });

        const sermonCacheByDate = {};
        function resolveSermonForDate(d) {
          if (sermonCacheByDate.hasOwnProperty(d)) return sermonCacheByDate[d];
          const dayEvents = eventsByDate[d] || [];
          const effectiveSubId = (overrides[d] && overrides[d].trim()) || defaultSubId;
          let sermonEvent = null;
          if (effectiveSubId) {
            sermonEvent = dayEvents.find(e => e.type_id === effectiveSubId) || null;
          }
          if (!sermonEvent && sermonSubIds.size > 0) {
            sermonEvent = dayEvents.find(e => sermonSubIds.has(e.type_id) && typeById[e.type_id] && typeById[e.type_id].name !== '台語')
              || dayEvents.find(e => sermonSubIds.has(e.type_id))
              || null;
          }
          const res = { effectiveSubId, sermonEvent };
          sermonCacheByDate[d] = res;
          return res;
        }

        const result = {};
        entries.forEach(entry => {
          const d = entry.date;
          const meetingName = entry.meetingName;
          const dayEvents = eventsByDate[d] || [];

          const { effectiveSubId, sermonEvent } = resolveSermonForDate(d);

          let namedEvent = null;
          if (meetingName && meetingName !== '(無標題)') {
            namedEvent = dayEvents.find(e => {
              const t = (e.title || '').trim();
              return t && (t.includes(meetingName) || meetingName.includes(t));
            }) || null;
          } else {
            const meetingNameType = types.find(t => t.name === '聚會名稱');
            if (meetingNameType) {
              namedEvent = dayEvents.find(e => e.type_id === meetingNameType.type_id) || null;
            }
            if (!namedEvent && dayEvents.length > 0) {
              namedEvent = dayEvents.find(e => !sermonSubIds.has(e.type_id)) || null;
            }
          }

          const entryData = {
            effectiveSermonSubTypeId: effectiveSubId,
            sermon: sermonEvent ? {
              eventId: sermonEvent.event_id,
              typeId: sermonEvent.type_id,
              typeName: typeById[sermonEvent.type_id] ? typeById[sermonEvent.type_id].name : '',
              title: sermonEvent.title || '',
              values: valuesByEvent[sermonEvent.event_id] || {}
            } : null,
            namedEvent: namedEvent ? {
              eventId: namedEvent.event_id,
              typeId: namedEvent.type_id,
              typeName: typeById[namedEvent.type_id] ? typeById[namedEvent.type_id].name : '',
              title: namedEvent.title || '',
              values: valuesByEvent[namedEvent.event_id] || {}
            } : null
          };

          const key = meetingName ? `${d}|${meetingName}` : d;
          result[key] = entryData;
          result[d] = entryData;
        });

        return { status: 'success', data: result };
      } catch (err) {
        console.warn('[WorshipSupabase] getCalendarDataForDates 失敗:', err);
        return await window.churchAPI('getCalendarDataForDates', payload);
      }
    },

    // 13. 取得服事表已建立的所有日期 (供 Admin UI 覆寫設定選單)
    async getScheduleDates(payload) {
      const sb = getSupabase();
      if (!sb) return await window.churchAPI('getScheduleDates', payload);

      const { data, error } = await sb
        .from('worship_schedules')
        .select('date, meeting_name, meeting_category, year, quarter')
        .order('date', { ascending: false });

      if (error) throw error;

      const seen = new Set();
      const list = [];
      const entries = [];
      (data || []).forEach(row => {
        const d = String(row.date || '').slice(0, 10);
        if (!d || seen.has(d)) return;
        seen.add(d);
        const item = {
          date: d,
          name: row.meeting_name || '',
          type: row.meeting_category || '',
          year: row.year || '',
          quarter: row.quarter || ''
        };
        list.push(item);
        entries.push({ date: d, meetingName: item.name });
      });

      // 水合行事曆補齊聚會名稱與類別
      try {
        if (entries.length > 0) {
          const calRes = await this.getCalendarDataForDates({ entries });
          const calData = (calRes && calRes.status === 'success') ? calRes.data : {};
          list.forEach(item => {
            const cd = calData[`${item.date}|${item.name}`] || calData[item.date] || {};
            if (cd.namedEvent && cd.namedEvent.title && cd.namedEvent.title !== '(無標題)') {
              item.name = String(cd.namedEvent.title).trim();
            }
            if (cd.sermon && cd.sermon.typeName) {
              item.type = String(cd.sermon.typeName).trim();
            }
          });
        }
      } catch (e) {
        console.warn('[WorshipSupabase] getScheduleDates 水合失敗:', e);
      }

      return { status: 'success', data: list };
    }
  };

  window.WorshipSupabaseService = WorshipSupabaseService;
})(window);
