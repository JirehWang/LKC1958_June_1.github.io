// ⚡ apps/LKC_SundayBulletin/js/bulletin-supabase.js
// 週報管理系統 Supabase 熱響應服務模組 (<50ms)
// 支援週報全版草稿與正式存檔 (sunday_bulletins)、本會/教界消息與代禱 (sunday_bulletin_reports)、讚美曲目與歌詞 (sunday_bulletin_praise)

(function(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.SundayBulletinSupabaseService = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(root) {

  let _client = null;

  function getSupabase() {
    if (_client) return _client;
    if (root._supabase) {
      _client = root._supabase;
      return _client;
    }
    const config = root._SUPABASE_CONFIG || root.SUPABASE_CONFIG;
    const create = (root.supabase && root.supabase.createClient) || (typeof supabase !== 'undefined' && supabase.createClient);
    if (config && create && config.url && config.anonKey) {
      _client = create(config.url, config.anonKey);
      root._supabase = _client;
      return _client;
    }
    return null;
  }

  function setSupabaseClient(client) {
    _client = client;
  }

  function cleanDate(dateStr) {
    if (!dateStr) return '';
    return String(dateStr).trim().slice(0, 10);
  }

  const SundayBulletinSupabaseService = {
    setClient: setSupabaseClient,
    getClient: getSupabase,

    // ── 1. 週報主檔與草稿 (sunday_bulletins) ──────────────────────────
    async saveBulletin(bulletinData, userIdentifier = 'bulletin-admin') {
      const sb = getSupabase();
      if (!sb) return null;

      const date = cleanDate(bulletinData?.date);
      if (!date) throw new Error('儲存週報時缺少主日日期 (date)');

      const nowIso = new Date().toISOString();
      const row = {
        date,
        service_type: bulletinData.serviceType || '台華語',
        taiwanese: bulletinData.taiwanese || {},
        mandarin: bulletinData.mandarin || {},
        ministry: bulletinData.ministry || {},
        attendance: bulletinData.attendance || {},
        events: Array.isArray(bulletinData.events) ? bulletinData.events : [],
        announcements: Array.isArray(bulletinData.announcements) ? bulletinData.announcements : [],
        church_news: Array.isArray(bulletinData.churchNews) ? bulletinData.churchNews : [],
        prayer: bulletinData.prayer || {},
        offering_report: bulletinData.offeringReport || {},
        data: bulletinData,
        updated_at: nowIso,
        updated_by: userIdentifier
      };

      const { data, error } = await sb
        .from('sunday_bulletins')
        .upsert(row, { onConflict: 'date' })
        .select();

      if (error) throw error;
      return { success: true, location: 'supabase', date, updatedAt: nowIso, data: data?.[0] || row };
    },

    async loadBulletin(dateStr) {
      const sb = getSupabase();
      if (!sb) return null;

      const date = cleanDate(dateStr);
      if (!date) return null;

      const { data, error } = await sb
        .from('sunday_bulletins')
        .select('*')
        .eq('date', date)
        .maybeSingle();

      if (error) throw error;
      if (!data) return null;

      // 優先回傳完整的 data 模型，若欄位在最外層亦自動補齊
      const full = data.data && typeof data.data === 'object' && Object.keys(data.data).length > 0
        ? { ...data.data }
        : {
            date: data.date,
            serviceType: data.service_type,
            taiwanese: data.taiwanese,
            mandarin: data.mandarin,
            ministry: data.ministry,
            attendance: data.attendance,
            events: data.events,
            announcements: data.announcements,
            churchNews: data.church_news,
            prayer: data.prayer,
            offeringReport: data.offering_report
          };

      full.date = data.date;
      full.updatedAt = data.updated_at;
      return full;
    },

    async listBulletins() {
      const sb = getSupabase();
      if (!sb) return null;

      const { data, error } = await sb
        .from('sunday_bulletins')
        .select('date, service_type, taiwanese, mandarin, updated_at, updated_by')
        .order('date', { ascending: false });

      if (error) throw error;
      return (data || []).map(row => ({
        key: 'bulletin_draft_' + row.date,
        date: row.date,
        updatedAt: row.updated_at || '',
        updatedBy: row.updated_by || '',
        serviceType: row.service_type || '台華語',
        preview: row.taiwanese?.sermonTitle || row.mandarin?.sermonTitle || row.service_type || ''
      }));
    },

    async deleteBulletin(dateStr) {
      const sb = getSupabase();
      if (!sb) return null;

      const date = cleanDate(dateStr);
      if (!date) return null;

      const { error } = await sb
        .from('sunday_bulletins')
        .delete()
        .eq('date', date);

      if (error) throw error;
      return { success: true };
    },

    // ── 2. 本會/教界消息與關懷代禱 (sunday_bulletin_reports) ───────────
    async saveReports(dateStr, reportsData, userIdentifier = 'reports-admin') {
      const sb = getSupabase();
      if (!sb) return null;

      const date = cleanDate(dateStr);
      if (!date) throw new Error('缺少主日日期 (date)');

      const nowIso = new Date().toISOString();
      const row = {
        date,
        announcements: Array.isArray(reportsData.announcements) ? reportsData.announcements : [],
        church_news: Array.isArray(reportsData.churchNews) ? reportsData.churchNews : [],
        prayer: reportsData.prayer && typeof reportsData.prayer === 'object' ? reportsData.prayer : {},
        raw_data: reportsData,
        updated_at: nowIso,
        updated_by: userIdentifier
      };

      const { error } = await sb
        .from('sunday_bulletin_reports')
        .upsert(row, { onConflict: 'date' });

      if (error) throw error;
      return { success: true, location: 'supabase', date, updatedAt: nowIso };
    },

    async loadReports(dateStr) {
      const sb = getSupabase();
      if (!sb) return null;

      const date = cleanDate(dateStr);
      if (!date) return null;

      const { data, error } = await sb
        .from('sunday_bulletin_reports')
        .select('*')
        .eq('date', date)
        .maybeSingle();

      if (error) throw error;
      if (!data) return null;

      return {
        date: data.date,
        announcements: Array.isArray(data.announcements) ? data.announcements : [],
        churchNews: Array.isArray(data.church_news) ? data.church_news : [],
        prayer: data.prayer || { homeRest: '', hospital: '', other: '' },
        updatedAt: data.updated_at
      };
    },

    // ── 3. 讚美曲目與歌詞 (sunday_bulletin_praise) ────────────────────
    async savePraise(dateStr, praiseData, userIdentifier = 'praise-admin') {
      const sb = getSupabase();
      if (!sb) return null;

      const date = cleanDate(dateStr);
      if (!date) throw new Error('缺少主日日期 (date)');

      const nowIso = new Date().toISOString();
      const row = {
        date,
        title: String(praiseData.title || '').trim(),
        kicker: String(praiseData.kicker || '聖歌隊').trim(),
        lyrics: String(praiseData.lyrics || '').trim(),
        raw_data: praiseData,
        updated_at: nowIso,
        updated_by: userIdentifier
      };

      const { error } = await sb
        .from('sunday_bulletin_praise')
        .upsert(row, { onConflict: 'date' });

      if (error) throw error;
      return { success: true, location: 'supabase', date, updatedAt: nowIso };
    },

    async loadPraise(dateStr) {
      const sb = getSupabase();
      if (!sb) return null;

      const date = cleanDate(dateStr);
      if (!date) return null;

      const { data, error } = await sb
        .from('sunday_bulletin_praise')
        .select('*')
        .eq('date', date)
        .maybeSingle();

      if (error) throw error;
      if (!data) return null;

      return {
        date: data.date,
        title: data.title || '',
        kicker: data.kicker || '聖歌隊',
        lyrics: data.lyrics || '',
        updatedAt: data.updated_at
      };
    }
  };

  return SundayBulletinSupabaseService;
});
