// ⚡ apps/LKC_MasterSchedule/calendar-supabase.js
// 教會行事曆 Supabase 熱響應服務模組 (含冷熱資料自動分流與完整雙語屬性相容)

(function(window) {
  const HOT_YEAR_THRESHOLD = 2025; // 2025 年及以後走 Supabase (熱響應 <50ms)

  let _supabaseClient = null;

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
    _supabaseClient = create(config.url, config.anonKey);
    return _supabaseClient;
  }

  function isHotDate(dateStr) {
    if (!dateStr) return true;
    const y = parseInt(String(dateStr).slice(0, 4), 10);
    return !isNaN(y) && y >= HOT_YEAR_THRESHOLD;
  }

  function generateId(prefix) {
    return (prefix || 'id') + '_' + Math.random().toString(36).substring(2, 10) + '_' + Date.now().toString(36);
  }

  function normalizeValuesInput(valuesInput, eventId) {
    const fieldValuesMap = {};
    const valueRows = [];
    if (!valuesInput) return { fieldValuesMap, valueRows };

    if (Array.isArray(valuesInput)) {
      valuesInput.forEach(v => {
        if (v) {
          const fid = v.fieldId || v.field_id;
          if (fid) {
            const val = v.value !== undefined ? v.value : v['值'];
            const strVal = String(val != null ? val : '');
            fieldValuesMap[fid] = strVal;
            if (eventId) {
              valueRows.push({ event_id: eventId, field_id: fid, value: strVal });
            }
          }
        }
      });
    } else if (typeof valuesInput === 'object') {
      Object.entries(valuesInput).forEach(([fid, val]) => {
        if (fid && val !== undefined && val !== null) {
          let strVal;
          if (typeof val === 'object' && val !== null && (val.value !== undefined || val['值'] !== undefined)) {
            strVal = String(val.value !== undefined ? val.value : (val['值'] != null ? val['值'] : ''));
          } else {
            strVal = String(val);
          }
          fieldValuesMap[fid] = strVal;
          if (eventId) {
            valueRows.push({ event_id: eventId, field_id: fid, value: strVal });
          }
        }
      });
    }
    return { fieldValuesMap, valueRows };
  }

  const CalendarSupabaseService = {
    // ── 1. 事項類型 (Types) ──────────────────────────────────
    async cal_getTypes() {
      const sb = getSupabase();
      if (!sb) return await window.churchAPI('cal_getTypes');

      const { data, error } = await sb
        .from('calendar_types')
        .select('*')
        .order('sort_order', { ascending: true });

      if (error) throw error;

      const all = (data || []).map(t => ({
        typeId: t.type_id,
        parentTypeId: t.parent_type_id || '',
        name: t.name,
        '名稱': t.name,
        icon: t.icon || '📌',
        color: t.color || '#5b8def',
        sortOrder: parseFloat(t.sort_order) || 0,
        syncToAttendance: Boolean(t.sync_to_attendance),
        syncToMinistry: Boolean(t.sync_to_ministry),
        syncToWorship: Boolean(t.sync_to_worship),
        hasPassword: Boolean(t.password && String(t.password).trim()),
        hidden: Boolean(t.hidden),
        excludedFieldIds: Array.isArray(t.excluded_field_ids) ? t.excluded_field_ids : []
      }));

      // 建立階層樹狀結構
      const byId = {};
      all.forEach(t => { t.children = []; byId[t.typeId] = t; });
      const roots = [];
      all.forEach(t => {
        if (t.parentTypeId && byId[t.parentTypeId]) {
          byId[t.parentTypeId].children.push(t);
        } else {
          roots.push(t);
        }
      });

      return {
        success: true,
        data: { types: roots, flat: all }
      };
    },

    async cal_addType(data) {
      const sb = getSupabase();
      if (!sb) return await window.churchAPI('cal_addType', data);

      const typeId = data.typeId || generateId('type');
      const isSub = Boolean(data.parentTypeId);

      const row = {
        type_id: typeId,
        parent_type_id: data.parentTypeId || '',
        name: String(data.name || data['名稱'] || '').trim(),
        icon: data.icon || '📌',
        color: data.color || '#667eea',
        sort_order: parseFloat(data.sortOrder) || 1,
        sync_to_attendance: Boolean(data.syncToAttendance),
        sync_to_ministry: Boolean(data.syncToMinistry),
        sync_to_worship: Boolean(data.syncToWorship),
        password: isSub ? '' : (data.password || ''),
        hidden: Boolean(data.hidden),
        excluded_field_ids: Array.isArray(data.excludedFieldIds) ? data.excludedFieldIds : []
      };

      const { error } = await sb.from('calendar_types').insert(row);
      if (error) throw error;

      return { success: true, message: '事項類型已新增', data: { typeId } };
    },

    async cal_updateType(data) {
      const sb = getSupabase();
      if (!sb) return await window.churchAPI('cal_updateType', data);

      const typeId = data.typeId;
      if (!typeId) throw new Error('typeId 必填');

      const updates = { updated_at: new Date().toISOString() };
      if (data.name !== undefined || data['名稱'] !== undefined) updates.name = String(data.name || data['名稱']).trim();
      if (data.icon !== undefined) updates.icon = data.icon;
      if (data.color !== undefined) updates.color = data.color;
      if (data.sortOrder !== undefined) updates.sort_order = parseFloat(data.sortOrder) || 0;
      if (data.syncToAttendance !== undefined) updates.sync_to_attendance = Boolean(data.syncToAttendance);
      if (data.syncToMinistry !== undefined) updates.sync_to_ministry = Boolean(data.syncToMinistry);
      if (data.syncToWorship !== undefined) updates.sync_to_worship = Boolean(data.syncToWorship);
      if (data.password !== undefined) updates.password = data.password;
      if (data.hidden !== undefined) updates.hidden = Boolean(data.hidden);
      if (data.excludedFieldIds !== undefined) updates.excluded_field_ids = data.excludedFieldIds;

      const { error } = await sb.from('calendar_types').update(updates).eq('type_id', typeId);
      if (error) throw error;

      return { success: true, message: '事項類型已更新' };
    },

    async cal_deleteType(data) {
      const sb = getSupabase();
      if (!sb) return await window.churchAPI('cal_deleteType', data);

      const typeId = data.typeId;
      if (!typeId) throw new Error('typeId 必填');

      const { data: subTypes } = await sb.from('calendar_types').select('type_id').eq('parent_type_id', typeId);
      const allIdsToDelete = [typeId].concat((subTypes || []).map(s => s.type_id));

      await sb.from('calendar_fields').delete().in('type_id', allIdsToDelete);
      const { error } = await sb.from('calendar_types').delete().in('type_id', allIdsToDelete);
      if (error) throw error;

      return { success: true, message: '事項類型已刪除' };
    },

    // ── 2. 自訂欄位 (Fields) ──────────────────────────────────
    async cal_getFields(data) {
      const sb = getSupabase();
      if (!sb) return await window.churchAPI('cal_getFields', data);

      const typeId = data && data.typeId;
      if (!typeId) throw new Error('typeId 必填');

      const { data: typesData } = await sb.from('calendar_types').select('*');
      const allTypes = typesData || [];
      const targetType = allTypes.find(t => t.type_id === typeId);
      if (!targetType) throw new Error('查無類型：' + typeId);

      let rootId = typeId;
      let subTypeId = null;
      if (targetType.parent_type_id) {
        rootId = targetType.parent_type_id;
        subTypeId = typeId;
      }

      const { data: fieldsData, error } = await sb
        .from('calendar_fields')
        .select('*')
        .eq('type_id', rootId)
        .order('sort_order', { ascending: true });

      if (error) throw error;

      const rawFields = (fieldsData || []).map(f => ({
        fieldId: f.field_id,
        typeId: f.type_id,
        fieldName: f.name,
        name: f.name,
        '顯示名稱': f.name,
        fieldType: f.field_type || 'text',
        '欄位類型': f.field_type || 'text',
        isRequired: Boolean(f.is_required),
        required: Boolean(f.is_required),
        '是否必填': Boolean(f.is_required),
        options: Array.isArray(f.options) ? f.options : [],
        '下拉選項': Array.isArray(f.options) ? f.options : [],
        sortOrder: parseFloat(f.sort_order) || 0
      }));

      const excludedIds = new Set(
        subTypeId && Array.isArray(targetType.excluded_field_ids) ? targetType.excluded_field_ids : []
      );

      const effectiveFields = rawFields.filter(f => !excludedIds.has(f.fieldId));
      const inheritedFields = rawFields.map(f => ({
        ...f,
        isExcluded: excludedIds.has(f.fieldId)
      }));

      return {
        success: true,
        data: {
          rootTypeId: rootId,
          subTypeId: subTypeId,
          fields: effectiveFields,
          inheritedFields: inheritedFields,
          ownFields: rawFields,
          excludedFieldIds: Array.from(excludedIds)
        }
      };
    },

    async cal_addField(data) {
      const sb = getSupabase();
      if (!sb) return await window.churchAPI('cal_addField', data);

      const fieldId = data.fieldId || generateId('field');
      const typeId = data.typeId;
      if (!typeId) throw new Error('typeId 必填');

      const { data: targetType } = await sb.from('calendar_types').select('parent_type_id').eq('type_id', typeId).single();
      const rootId = (targetType && targetType.parent_type_id) ? targetType.parent_type_id : typeId;

      const row = {
        field_id: fieldId,
        type_id: rootId,
        name: String(data.name || data.fieldName || data['顯示名稱'] || '').trim(),
        field_type: data.fieldType || data['欄位類型'] || 'text',
        is_required: Boolean(data.isRequired || data['是否必填']),
        options: Array.isArray(data.options || data['下拉選項']) ? (data.options || data['下拉選項']) : [],
        sort_order: parseFloat(data.sortOrder) || 1
      };

      const { error } = await sb.from('calendar_fields').insert(row);
      if (error) throw error;

      return { success: true, message: '欄位已新增', data: { fieldId } };
    },

    async cal_updateField(data) {
      const sb = getSupabase();
      if (!sb) return await window.churchAPI('cal_updateField', data);

      const fieldId = data.fieldId;
      if (!fieldId) throw new Error('fieldId 必填');

      const updates = { updated_at: new Date().toISOString() };
      if (data.name !== undefined || data.fieldName !== undefined || data['顯示名稱'] !== undefined) {
        updates.name = String(data.name || data.fieldName || data['顯示名稱']).trim();
      }
      if (data.fieldType !== undefined || data['欄位類型'] !== undefined) {
        updates.field_type = data.fieldType || data['欄位類型'];
      }
      if (data.isRequired !== undefined || data['是否必填'] !== undefined) {
        updates.is_required = Boolean(data.isRequired || data['是否必填']);
      }
      if (data.options !== undefined || data['下拉選項'] !== undefined) {
        updates.options = data.options || data['下拉選項'];
      }
      if (data.sortOrder !== undefined) updates.sort_order = parseFloat(data.sortOrder) || 0;

      const { error } = await sb.from('calendar_fields').update(updates).eq('field_id', fieldId);
      if (error) throw error;

      return { success: true, message: '欄位已更新' };
    },

    async cal_deleteField(data) {
      const sb = getSupabase();
      if (!sb) return await window.churchAPI('cal_deleteField', data);

      const fieldId = data.fieldId;
      if (!fieldId) throw new Error('fieldId 必填');

      await sb.from('calendar_event_values').delete().eq('field_id', fieldId);
      const { error } = await sb.from('calendar_fields').delete().eq('field_id', fieldId);
      if (error) throw error;

      return { success: true, message: '欄位已刪除' };
    },

    async cal_reorderFields(data) {
      const sb = getSupabase();
      if (!sb) return await window.churchAPI('cal_reorderFields', data);

      const fieldIds = data.fieldIds || [];
      for (let i = 0; i < fieldIds.length; i++) {
        await sb.from('calendar_fields').update({ sort_order: i + 1 }).eq('field_id', fieldIds[i]);
      }
      return { success: true, message: '欄位排序已更新' };
    },

    // ── 3. 事項查詢與 CRUD (Events) ──────────────────────────
    async cal_getEvents(data) {
      const start = data && data.startDate;
      const end = data && data.endDate;
      const typeIds = data && Array.isArray(data.typeIds) && data.typeIds.length > 0 ? data.typeIds : null;

      if (start && !isHotDate(start)) {
        console.log(`[Calendar] 查詢區間 ${start}~${end} 含久遠歷史，切換至 GAS 讀取...`);
        return await window.churchAPI('cal_getEvents', data);
      }

      const sb = getSupabase();
      if (!sb) return await window.churchAPI('cal_getEvents', data);

      const [typesRes, fieldsRes] = await Promise.all([
        sb.from('calendar_types').select('*'),
        sb.from('calendar_fields').select('*')
      ]);

      const typeById = {};
      (typesRes.data || []).forEach(t => { typeById[t.type_id] = t; });

      const fieldById = {};
      (fieldsRes.data || []).forEach(f => { fieldById[f.field_id] = f; });

      let query = sb.from('calendar_events').select('*');
      if (start) query = query.gte('date', start);
      if (end) query = query.lte('date', end);
      if (typeIds) query = query.in('type_id', typeIds);
      query = query.order('date', { ascending: true });

      const { data: eventsData, error } = await query;
      if (error) throw error;

      const eventIds = (eventsData || []).map(e => e.event_id);
      let valuesByEvent = {};
      if (eventIds.length > 0) {
        const { data: valuesData } = await sb
          .from('calendar_event_values')
          .select('*')
          .in('event_id', eventIds);

        (valuesData || []).forEach(v => {
          if (!valuesByEvent[v.event_id]) valuesByEvent[v.event_id] = [];
          valuesByEvent[v.event_id].push(v);
        });
      }

      const result = (eventsData || []).map(e => {
        const type = typeById[e.type_id] || {};
        let rootType = type;
        if (type.parent_type_id && typeById[type.parent_type_id]) {
          rootType = typeById[type.parent_type_id];
        }

        let evValues = (valuesByEvent[e.event_id] || []).map(v => {
          const f = fieldById[v.field_id];
          return f ? {
            fieldId: v.field_id,
            fieldName: f.name,
            name: f.name,
            '顯示名稱': f.name,
            fieldType: f.field_type,
            '欄位類型': f.field_type,
            value: v.value || '',
            '值': v.value || ''
          } : null;
        }).filter(Boolean);

        // Fallback: If no values from calendar_event_values, try e.field_values
        if (evValues.length === 0 && e.field_values && typeof e.field_values === 'object') {
          evValues = Object.entries(e.field_values).map(([fid, val]) => {
            const f = fieldById[fid];
            return f ? {
              fieldId: fid,
              fieldName: f.name,
              name: f.name,
              '顯示名稱': f.name,
              fieldType: f.field_type,
              '欄位類型': f.field_type,
              value: String(val != null ? val : ''),
              '值': String(val != null ? val : '')
            } : null;
          }).filter(Boolean);
        }

        const isSermon = rootType && (rootType.name === '講道資訊' || rootType.sync_to_worship);
        const sermonTopic = (evValues.find(v => v.fieldName === '講題' || v.fieldName === '題目') || {}).value || '';
        const sermonObj = isSermon ? {
          id: e.event_id,
          type: type.name || '',
          speaker: (evValues.find(v => v.fieldName === '講員' || v['顯示名稱'] === '講員') || {}).value || '',
          topic: sermonTopic,
          title: sermonTopic,
          scripture: (evValues.find(v => v.fieldName === '經文' || v['顯示名稱'] === '經文') || {}).value || '',
          callToWorship: (evValues.find(v => v.fieldName === '宣召' || v['顯示名稱'] === '宣召') || {}).value || '',
          goldenVerse: (evValues.find(v => v.fieldName === '金句' || v['顯示名稱'] === '金句') || {}).value || '',
          hymns: (evValues.find(v => v.fieldName === '聖詩一' || v.fieldName === '詩歌') || {}).value || '',
          description: (evValues.find(v => v.fieldName === '備註') || {}).value || ''
        } : null;

        const eventIcon = (type && type.icon) || (rootType && rootType.icon) || '📌';
        const eventColor = (type && type.color) || (rootType && rootType.color) || '#667eea';
        const typeFullName = type ? (rootType && rootType.type_id !== type.type_id ? `${rootType.name} - ${type.name}` : (type.name || '')) : '';

        return {
          eventId: e.event_id,
          id: e.event_id,
          typeId: e.type_id,
          typeName: type.name || '',
          '類型名稱': type.name || '',
          typeFullName: typeFullName,
          '完整類型名稱': typeFullName,
          typeIcon: eventIcon,
          icon: eventIcon,
          typeColor: eventColor,
          color: eventColor,
          date: e.date,
          '日期': e.date,
          name: e.title,
          '聚會名稱': e.title,
          title: e.title,
          '顯示標題': e.title,
          rootTypeId: rootType.type_id || e.type_id,
          rootTypeName: rootType.name || '',
          createdBy: e.created_by || '',
          '建立者': e.created_by || '',
          createdAt: e.created_at,
          updatedAt: e.updated_at,
          values: evValues,
          fields: evValues,
          sermons: sermonObj ? [sermonObj] : []
        };
      });

      return { success: true, data: result };
    },

    async cal_getEvent(data) {
      const eventId = data && data.eventId;
      if (!eventId) throw new Error('eventId 必填');

      const res = await this.cal_getEvents({ typeIds: null });
      const found = (res.data || []).find(e => e.eventId === eventId);
      if (!found) throw new Error('查無事項：' + eventId);

      return { success: true, data: found };
    },

    async cal_addEvent(data) {
      const sb = getSupabase();
      if (!sb) return await window.churchAPI('cal_addEvent', data);

      const eventId = data.eventId || generateId('ev');
      const typeId = data.typeId;
      const date = data.date || data['日期'];
      if (!typeId || !date) throw new Error('typeId 與 date 必填');

      const rawValues = data.values !== undefined ? data.values : data.fields;
      const { fieldValuesMap, valueRows } = normalizeValuesInput(rawValues, eventId);

      let title = (data.title || data.name || data['顯示標題'] || data['聚會名稱'] || '').toString().trim();
      if (!title && Object.keys(fieldValuesMap).length > 0) {
        const firstVal = Object.values(fieldValuesMap).find(v => v && String(v).trim());
        if (firstVal) title = String(firstVal).trim().substring(0, 60);
      }
      if (!title) title = '聚會事項';

      const { error: evErr } = await sb.from('calendar_events').insert({
        event_id: eventId,
        type_id: typeId,
        date: date,
        title: title,
        created_by: data.createdBy || data['建立者'] || '',
        field_values: fieldValuesMap,
        updated_at: new Date().toISOString()
      });
      if (evErr) throw evErr;

      if (valueRows.length > 0) {
        await sb.from('calendar_event_values').insert(valueRows);
      }

      return { success: true, message: '事項已建立', data: { eventId } };
    },

    async cal_updateEvent(data) {
      const sb = getSupabase();
      if (!sb) return await window.churchAPI('cal_updateEvent', data);

      const eventId = data.eventId;
      if (!eventId) throw new Error('eventId 必填');

      const updates = { updated_at: new Date().toISOString() };
      if (data.typeId !== undefined) updates.type_id = data.typeId;
      if (data.date !== undefined || data['日期'] !== undefined) updates.date = data.date || data['日期'];
      if (data.title !== undefined || data.name !== undefined || data['顯示標題'] !== undefined || data['聚會名稱'] !== undefined) {
        updates.title = data.title || data.name || data['顯示標題'] || data['聚會名稱'];
      }

      const rawValues = data.values !== undefined ? data.values : data.fields;
      if (rawValues !== undefined && rawValues !== null) {
        const { fieldValuesMap, valueRows } = normalizeValuesInput(rawValues, eventId);
        updates.field_values = fieldValuesMap;

        await sb.from('calendar_event_values').delete().eq('event_id', eventId);
        if (valueRows.length > 0) {
          await sb.from('calendar_event_values').insert(valueRows);
        }
      }

      const { error } = await sb.from('calendar_events').update(updates).eq('event_id', eventId);
      if (error) throw error;

      return { success: true, message: '事項已更新' };
    },

    async cal_deleteEvent(data) {
      const sb = getSupabase();
      if (!sb) return await window.churchAPI('cal_deleteEvent', data);

      const eventId = data.eventId;
      if (!eventId) throw new Error('eventId 必填');

      await sb.from('calendar_event_values').delete().eq('event_id', eventId);
      const { error } = await sb.from('calendar_events').delete().eq('event_id', eventId);
      if (error) throw error;

      return { success: true, message: '事項已刪除' };
    },

    async cal_addEventsBatch(data) {
      const sb = getSupabase();
      if (!sb) return await window.churchAPI('cal_addEventsBatch', data);

      const events = data.events || [];
      if (events.length === 0) return { success: true, message: '無資料需要新增' };

      const eventRows = [];
      const allValueRows = [];

      events.forEach(ev => {
        const eventId = ev.eventId || generateId('ev');
        const typeId = ev.typeId;
        const date = ev.date || ev['日期'];
        if (!typeId || !date) return;

        const rawValues = ev.values !== undefined ? ev.values : ev.fields;
        const { fieldValuesMap, valueRows } = normalizeValuesInput(rawValues, eventId);

        let title = (ev.title || ev.name || ev['顯示標題'] || ev['聚會名稱'] || '').toString().trim();
        if (!title && Object.keys(fieldValuesMap).length > 0) {
          const firstVal = Object.values(fieldValuesMap).find(v => v && String(v).trim());
          if (firstVal) title = String(firstVal).trim().substring(0, 60);
        }
        if (!title) title = '聚會事項';

        allValueRows.push(...valueRows);
        eventRows.push({
          event_id: eventId,
          type_id: typeId,
          date: date,
          title: title,
          created_by: ev.createdBy || ev['建立者'] || '',
          field_values: fieldValuesMap,
          updated_at: new Date().toISOString()
        });
      });

      if (eventRows.length > 0) {
        const { error: evErr } = await sb.from('calendar_events').upsert(eventRows, { onConflict: 'event_id' });
        if (evErr) throw evErr;
      }

      if (allValueRows.length > 0) {
        const evIds = eventRows.map(e => e.event_id);
        await sb.from('calendar_event_values').delete().in('event_id', evIds);
        const { error: valErr } = await sb.from('calendar_event_values').insert(allValueRows);
        if (valErr) throw valErr;
      }

      return { success: true, message: `成功新增/更新 ${eventRows.length} 筆事項`, data: { count: eventRows.length } };
    },

    // ── 4. AI 語意解析 (委託 GAS Gemini Helper) ───────────────
    async cal_aiParseForType(data) {
      return await window.churchAPI('cal_aiParseForType', data);
    }
  };

  window.CalendarSupabaseService = CalendarSupabaseService;
})(window);
