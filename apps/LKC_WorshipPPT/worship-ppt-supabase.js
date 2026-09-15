// ⚡ apps/LKC_WorshipPPT/worship-ppt-supabase.js
// 主日禮拜 PPT 產生器 Supabase 本地熱響應服務模組 (<50ms)
// 包含主日講道行事曆事件即時帶入、雲端版面參數集中儲存與雙向備份

(function(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.WorshipPptSupabaseService = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(root) {

  function getSupabase() {
    if (root._supabase) return root._supabase;
    const config = root._SUPABASE_CONFIG || root.SUPABASE_CONFIG;
    const create = (root.supabase && root.supabase.createClient) || (typeof supabase !== 'undefined' && supabase.createClient);
    if (config && create && config.url && config.anonKey) {
      const options = typeof root.__LKC_OBSERVABILITY_SUPABASE_OPTIONS__ === 'function'
        ? root.__LKC_OBSERVABILITY_SUPABASE_OPTIONS__({ system: 'LKC_WorshipPPT' })
        : undefined;
      root._supabase = create(config.url, config.anonKey, options);
      return root._supabase;
    }
    return null;
  }

  const WorshipPptSupabaseService = {
    // ── 1. 行事曆主日講道事件查詢 (cal_getEvents) ────────────────
    async cal_getEvents(data = {}) {
      const sb = getSupabase();
      if (!sb) return null;

      const startDate = data.startDate ? String(data.startDate).slice(0, 10) : '';
      const endDate = data.endDate ? String(data.endDate).slice(0, 10) : startDate;

      const { data: types } = await sb.from('calendar_types').select('*');
      const typeById = {};
      (types || []).forEach(t => { typeById[t.type_id] = t; });

      let query = sb.from('calendar_events').select('*');
      if (startDate && endDate) {
        query = query.gte('date', startDate).lte('date', endDate);
      } else if (startDate) {
        query = query.eq('date', startDate);
      }
      query = query.order('date', { ascending: true });

      const { data: events, error: eventsErr } = await query;
      if (eventsErr) throw eventsErr;

      const [fieldsRes, valuesRes] = await Promise.all([
        sb.from('calendar_fields').select('*'),
        sb.from('calendar_event_values').select('*').in('event_id', (events || []).map(e => e.event_id))
      ]);

      const fieldById = {};
      (fieldsRes.data || []).forEach(f => { fieldById[f.field_id] = f.name; });

      const valuesByEvent = {};
      (valuesRes.data || []).forEach(v => {
        if (!valuesByEvent[v.event_id]) valuesByEvent[v.event_id] = [];
        const fName = fieldById[v.field_id] || v.field_id;
        valuesByEvent[v.event_id].push({
          fieldId: v.field_id,
          fieldName: fName,
          name: fName,
          value: v.value || ''
        });
      });

      const formattedEvents = (events || []).map(e => {
        const type = typeById[e.type_id] || {};
        let values = valuesByEvent[e.event_id] || [];

        if (e.field_values && typeof e.field_values === 'object') {
          Object.keys(e.field_values).forEach(fId => {
            if (!values.some(v => v.fieldId === fId)) {
              const fName = fieldById[fId] || fId;
              values.push({
                fieldId: fId,
                fieldName: fName,
                name: fName,
                value: e.field_values[fId] || ''
              });
            }
          });
        }

        return {
          eventId: e.event_id,
          typeId: e.type_id,
          typeName: type.name || '',
          typeFullName: type.parent_type_id ? '講道資訊 - ' + type.name : (type.name || ''),
          typeIcon: type.icon || '📌',
          typeColor: type.color || '#5b8def',
          date: String(e.date).slice(0, 10),
          title: e.title || '',
          values: values
        };
      });

      return {
        success: true,
        data: formattedEvents
      };
    },

    // ── 2. 雲端版面讀取 (loadLayout) ─────────────────────────────
    async loadLayout(templateId = 'taiwanese') {
      const sb = getSupabase();
      if (!sb) return null;

      const safeTemplateId = String(templateId || 'taiwanese').trim();
      const { data, error } = await sb
        .from('worship_ppt_layouts')
        .select('*')
        .eq('template_id', safeTemplateId)
        .maybeSingle();

      if (error || !data || !data.layout_state) return null;
      return data.layout_state;
    },

    // ── 3. 雲端版面儲存 (saveLayout) ─────────────────────────────
    async saveLayout(templateId = 'taiwanese', layoutState = {}, userIdentifier = 'worship-admin') {
      const sb = getSupabase();
      if (!sb) return null;

      const safeTemplateId = String(templateId || 'taiwanese').trim();
      const row = {
        template_id: safeTemplateId,
        schema_version: 1,
        layout_state: layoutState,
        updated_at: new Date().toISOString(),
        updated_by: userIdentifier
      };

      const { error } = await sb
        .from('worship_ppt_layouts')
        .upsert(row, { onConflict: 'template_id' });

      if (error) throw error;
      return { success: true };
    }
  };

  return WorshipPptSupabaseService;
});
