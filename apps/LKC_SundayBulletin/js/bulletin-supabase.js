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
      const options = typeof root.__LKC_OBSERVABILITY_SUPABASE_OPTIONS__ === 'function'
        ? root.__LKC_OBSERVABILITY_SUPABASE_OPTIONS__({ system: 'LKC_SundayBulletin' })
        : undefined;
      _client = create(config.url, config.anonKey, options);
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

  function createUuid() {
    if (root.crypto && typeof root.crypto.randomUUID === 'function') {
      return root.crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
      const random = Math.random() * 16 | 0;
      const value = char === 'x' ? random : (random & 0x3 | 0x8);
      return value.toString(16);
    });
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
      const performer = praiseData.performer || praiseData.kicker || praiseData.performers || '';
      const row = {
        date,
        title: String(praiseData.title || '').trim(),
        kicker: String(performer).trim(),
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

    // 歌曲本體只維護永久 UUID 與歌名；日期綁定與歌詞由 GAS 管理。
    async savePraiseTitle(title, userIdentifier = 'praise-title-index', requestedSongId = '') {
      const sb = getSupabase();
      if (!sb) return null;

      const cleanTitle = String(title || '').trim();
      if (!cleanTitle) throw new Error('缺少讚美詩歌名稱 (title)');

      const existingQuery = await sb
        .from('sunday_bulletin_praise_titles')
        .select('song_id, title, deleted_at, updated_at')
        .eq('title', cleanTitle);
      if (existingQuery.error) throw existingQuery.error;
      const existing = (existingQuery.data || []).find(row => !row.deleted_at);
      if (existing) {
        return {
          success: true,
          location: 'supabase',
          songId: String(existing.song_id || '').trim(),
          title: cleanTitle,
          updatedAt: existing.updated_at || '',
          created: false
        };
      }

      const nowIso = new Date().toISOString();
      const row = {
        song_id: String(requestedSongId || '').trim() || createUuid(),
        title: cleanTitle,
        updated_at: nowIso,
        updated_by: userIdentifier
      };

      const { data, error } = await sb
        .from('sunday_bulletin_praise_titles')
        .upsert(row, { onConflict: 'song_id', defaultToNull: false })
        .select('song_id, title, updated_at');

      if (error) throw error;
      const saved = Array.isArray(data) && data[0] ? data[0] : row;
      return {
        success: true,
        location: 'supabase',
        songId: String(saved.song_id || row.song_id).trim(),
        title: String(saved.title || cleanTitle).trim(),
        updatedAt: saved.updated_at || nowIso,
        created: true
      };
    },

    // 修正既有歌名時只依 UUID 更新 title，避免留下錯誤歌名或新增重複索引。
    async renamePraiseTitle(songId, newTitle, userIdentifier = 'praise-title-index') {
      const sb = getSupabase();
      if (!sb) return null;

      const cleanSongId = String(songId || '').trim();
      const cleanNewTitle = String(newTitle || '').trim();
      if (!cleanSongId || !cleanNewTitle) {
        throw new Error('修改歌名時缺少歌曲 UUID 或新歌名');
      }

      const currentQuery = await sb
        .from('sunday_bulletin_praise_titles')
        .select('song_id, title, deleted_at')
        .eq('song_id', cleanSongId);
      if (currentQuery.error) throw currentQuery.error;
      const current = (currentQuery.data || [])[0];
      if (!current) throw new Error('找不到要修改的歌曲 UUID：' + cleanSongId);
      if (current.deleted_at) throw new Error('歌曲已刪除，請建立新的歌曲資料');
      if (String(current.title || '').trim() === cleanNewTitle) {
        return {
          success: true,
          location: 'supabase',
          songId: cleanSongId,
          title: cleanNewTitle,
          renamed: false
        };
      }

      const nowIso = new Date().toISOString();
      const { data, error } = await sb
        .from('sunday_bulletin_praise_titles')
        .update({
          title: cleanNewTitle,
          updated_at: nowIso,
          updated_by: userIdentifier
        })
        .eq('song_id', cleanSongId)
        .select('song_id, title, updated_at');

      if (error) throw error;
      if (!Array.isArray(data) || !data.length) {
        throw new Error('找不到要修改的歌曲 UUID：' + cleanSongId);
      }

      return {
        success: true,
        location: 'supabase',
        songId: cleanSongId,
        title: cleanNewTitle,
        renamed: true,
        updatedAt: nowIso
      };
    },

    // 刪除歌曲只標記歌庫索引，不刪除 GAS 歌詞或歷史日期綁定。
    async deletePraiseTitle(songId, userIdentifier = 'praise-title-index') {
      const sb = getSupabase();
      if (!sb) return null;

      const cleanSongId = String(songId || '').trim();
      if (!cleanSongId) throw new Error('刪除歌曲時缺少歌曲 UUID');

      const deletedAt = new Date().toISOString();
      const { data, error } = await sb
        .from('sunday_bulletin_praise_titles')
        .update({
          deleted_at: deletedAt,
          deleted_by: userIdentifier,
          updated_at: deletedAt,
          updated_by: userIdentifier
        })
        .eq('song_id', cleanSongId)
        .select('song_id, title, deleted_at');

      if (error) throw error;
      if (!Array.isArray(data) || !data.length) {
        throw new Error('找不到要刪除的歌曲 UUID：' + cleanSongId);
      }
      return {
        success: true,
        location: 'supabase',
        songId: cleanSongId,
        title: String(data[0].title || '').trim(),
        deletedAt: data[0].deleted_at || deletedAt
      };
    },

    // 一次補入 GAS 歷史歌名；每筆資料都取得穩定 UUID。
    async savePraiseTitles(titles, userIdentifier = 'praise-title-index') {
      const sb = getSupabase();
      if (!sb) return null;

      const uniqueTitles = [...new Set(
        (Array.isArray(titles) ? titles : [])
          .map(title => String(title || '').trim())
          .filter(Boolean)
      )];
      if (!uniqueTitles.length) {
        return { success: true, location: 'supabase', count: 0, songs: [] };
      }

      const songs = [];
      for (const title of uniqueTitles) {
        songs.push(await this.savePraiseTitle(title, userIdentifier));
      }
      return { success: true, location: 'supabase', count: songs.length, songs };
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

      const rawData = data.raw_data && typeof data.raw_data === 'object' && !Array.isArray(data.raw_data)
        ? data.raw_data
        : {};
      const performanceType = rawData.performanceType === 'instrumental' ? 'instrumental' : 'vocal';
      const composer = rawData.composer || rawData.tune || '';
      const performer = String(rawData.performer || [rawData.kicker || data.kicker, rawData.performers]
        .filter(Boolean)
        .filter((value, index, values) => values.indexOf(value) === index)
        .join('\n')).trim();
      return {
        ...rawData,
        date: data.date,
        title: data.title || rawData.title || '',
        performanceType,
        composer,
        lyricist: rawData.lyricist || '',
        taiwaneseTranslator: rawData.taiwaneseTranslator || rawData.translator || '',
        performer,
        kicker: performer,
        tune: composer,
        arrangement: rawData.arrangement || '',
        performers: performer,
        lyrics: data.lyrics || rawData.lyrics || '',
        updatedAt: data.updated_at || rawData.updatedAt || ''
      };
    },

    // 對外讀取唯一入口：先查 GAS 的 date -> songId 綁定，再回傳歌曲本體。
    async loadPraiseByDate(dateStr, endpointOverride = '') {
      const endpoint = String(endpointOverride || root.CONFIG?.GAS_SYNC_URL || root.GAS_SYNC_URL || '').trim();
      const date = cleanDate(dateStr);
      if (!endpoint || !date || typeof root.fetch !== 'function') return null;

      const url = new URL(endpoint, root.location?.href || 'https://localhost/');
      url.searchParams.set('action', 'loadPraiseByDate');
      url.searchParams.set('date', date);
      url.searchParams.set('_lkc', `bulletin_${Date.now()}_${Math.random().toString(36).slice(2)}`);
      const response = await root.fetch(url.toString(), { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (payload?.ok === true || payload?.success === true) return payload.data || null;
      const error = new Error(payload?.message || payload?.error || 'GAS 讚美日期查詢失敗');
      if (payload?.code) error.code = payload.code;
      throw error;
    },

    // 不設日期範圍或一年限制，永久保留所有歷史歌名索引。
    async listPraiseTitles() {
      const sb = getSupabase();
      if (!sb) return null;

      try {
        const { data, error } = await sb
          .from('sunday_bulletin_praise_titles')
          .select('song_id, title, updated_at, deleted_at')
          .is('deleted_at', null)
          .order('title', { ascending: true });

        if (error) throw error;
        return (data || [])
          .map(row => ({
            songId: String(row.song_id || '').trim(),
            title: String(row.title || '').trim(),
            updatedAt: row.updated_at || ''
          }))
          .filter(row => row.title);
      } catch (indexError) {
        // migration 尚未執行時，先從舊表提供相容清單；不套用日期限制。
        const { data, error } = await sb
          .from('sunday_bulletin_praise')
          .select('title, updated_at')
          .order('title', { ascending: true });

        if (error) throw indexError;
        const seen = new Set();
        return (data || [])
          .map(row => ({
            songId: '',
            title: String(row.title || '').trim(),
            updatedAt: row.updated_at || ''
          }))
          .filter(row => {
            if (!row.title || seen.has(row.title)) return false;
            seen.add(row.title);
            return true;
          });
      }
    },

    // 舊呼叫端相容別名；同樣只回傳索引欄位。
    async listPraiseSongs() {
      return this.listPraiseTitles();
    }
  };

  return SundayBulletinSupabaseService;
});
