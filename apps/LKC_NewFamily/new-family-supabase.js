// ⚡ apps/LKC_NewFamily/new-family-supabase.js
// 新家人管理系統 Supabase 本地熱響應服務模組 (<50ms)
// 包含追蹤中/已結案個案讀取、留名卡登錄、個案更新、轉會友標記與結案操作（支援冷熱分流）

(function(root) {
  const HOT_YEAR_THRESHOLD = 2025; // 2025 年及以後走 Supabase (熱響應 <50ms)

  function getSupabase() {
    if (typeof window !== 'undefined' && window._supabase) return window._supabase;
    const config = (typeof window !== 'undefined' && (window._SUPABASE_CONFIG || window.SUPABASE_CONFIG)) || {};
    const create = (typeof window !== 'undefined' && window.supabase && window.supabase.createClient) || (typeof supabase !== 'undefined' && supabase.createClient);
    if (config && config.url && config.anonKey && create) {
      const options = typeof window.__LKC_OBSERVABILITY_SUPABASE_OPTIONS__ === 'function'
        ? window.__LKC_OBSERVABILITY_SUPABASE_OPTIONS__({ system: 'LKC_NewFamily' })
        : undefined;
      const client = create(config.url, config.anonKey, options);
      if (typeof window !== 'undefined') window._supabase = client;
      return client;
    }
    return null;
  }

  function isHotYear(year) {
    const y = parseInt(year, 10);
    return !isNaN(y) && y >= HOT_YEAR_THRESHOLD;
  }

  function isHotDate(dateStr) {
    if (!dateStr) return true;
    const y = parseInt(String(dateStr).slice(0, 4), 10);
    return isHotYear(y);
  }

  function isColdCase(caseObj) {
    if (!caseObj) return false;
    const fvd = caseObj['首次來訪日'] || caseObj.first_visit_date || '';
    const fn = String(caseObj['表單號'] || caseObj.form_number || '').trim();
    if (fvd && fvd.length >= 4) {
      const y = parseInt(fvd.slice(0, 4), 10);
      if (!isNaN(y)) return y < HOT_YEAR_THRESHOLD;
    }
    if (fn && fn.length >= 4) {
      const y = parseInt(fn.slice(0, 4), 10);
      if (!isNaN(y)) return y < HOT_YEAR_THRESHOLD;
    }
    return false;
  }

  function syncToGasBackup(action, payload = {}) {
    if (typeof window === 'undefined') return;
    setTimeout(async () => {
      try {
        const apiUrl = window.NEW_FAMILY_API_URL || (window.GAS_URL_MAP && window.GAS_URL_MAP['LKC_NewFamily']) || window.GAS_URL;
        const token = window.NEW_FAMILY_AUTH_TOKEN || 'ChurchApp-2026';
        if (!apiUrl) {
          console.warn('[NewFamily Backup] No API URL available for backup');
          return;
        }

        const body = {
          action: action,
          token: token,
          rowNumber: payload.rowNumber || payload.row_number,
          formNumber: payload.formNumber || payload.form_number || payload['表單號'],
          name: payload.name || payload['姓名'],
          values: payload.values || payload,
          data: payload
        };

        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(body)
        });
        const res = await response.json();
        console.log(`[NewFamily Backup] GAS sync (${action}) succeeded:`, res);
      } catch (e) {
        console.warn(`[NewFamily Backup] GAS sync (${action}) failed:`, e.message);
      }
    }, 50);
  }

  function getTaiwanDateParts(dateInput) {
    const d = dateInput ? new Date(dateInput) : new Date();
    const formatter = new Intl.DateTimeFormat('zh-TW', {
      timeZone: 'Asia/Taipei',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    const parts = formatter.formatToParts(d);
    const year = parts.find(p => p.type === 'year').value;
    const month = parts.find(p => p.type === 'month').value;
    const day = parts.find(p => p.type === 'day').value;
    return {
      ymd: `${year}-${month}-${day}`,
      prefix: `${year}${month}${day}`
    };
  }

  let _lastSubmitName = '';
  let _lastSubmitTimestamp = 0;

  function mapDbToCase(r, idx) {
    return {
      id: r.id,
      rowNumber: r.row_number || (idx + 2),
      '姓名': r.name || '',
      '聚會別': r.service_type || '',
      '性別': r.gender || '',
      '職業': r.occupation || '',
      '年齡': r.age_group || '',
      '是否曾接觸教會': r.contacted_church_before || '',
      '來訪原因': r.visit_reason || '',
      '表單號': r.form_number ? Number(r.form_number) || r.form_number : '',
      '關懷同工': r.assigned_staff || '',
      '地址': r.address || '',
      '市話': r.tel || '',
      '手機': r.phone || '',
      '首次來訪日': r.first_visit_date ? String(r.first_visit_date).slice(0, 10) : '',
      '結案日期': r.closed_date ? String(r.closed_date).slice(0, 10) : '',
      '落戶狀態': r.settlement_status || '',
      '邀約人': r.inviter || '',
      '備註': r.notes || '',
      '會友狀態': r.member_status || '',
      '點名編號': r.member_code || '',
      '現行小組': r.current_group || ''
    };
  }

  const NewFamilySupabaseService = {
    // ── 1. 讀取追蹤中案件 (getTrackingCases) ──────────────────────
    async getTrackingCases() {
      const sb = getSupabase();
      if (!sb) return null;

      const { data, error } = await sb
        .from('new_family_cases')
        .select('*')
        .eq('status', 'tracking')
        .order('form_number', { ascending: false });

      if (error) throw error;
      return { success: true, data: (data || []).map(mapDbToCase) };
    },

    // ── 2. 讀取已結案案件 (getClosedCases，支援冷熱分流與透明合併) ─────
    async getClosedCases(payload = {}) {
      const sb = getSupabase();
      const startDate = payload && payload.startDate;
      const endDate = payload && payload.endDate;

      // 情況 A：純冷查詢（若指定之結束日期小於 HOT_YEAR_THRESHOLD 年初，例如 2024 年）
      if (endDate && !isHotDate(endDate)) {
        if (typeof window !== 'undefined' && typeof window.churchAPI_original_nf === 'function') {
          return await window.churchAPI_original_nf('getClosedCases', payload);
        }
        return { success: true, data: [] };
      }

      // 情況 B：純熱查詢（若指定之起始日期大於等於 HOT_YEAR_THRESHOLD 年初，例如 2025-01-01 以後）
      if (startDate && isHotDate(startDate)) {
        if (!sb) {
          if (typeof window !== 'undefined' && typeof window.churchAPI_original_nf === 'function') {
            return await window.churchAPI_original_nf('getClosedCases', payload);
          }
          return null;
        }
        let query = sb
          .from('new_family_cases')
          .select('*')
          .eq('status', 'closed')
          .gte('first_visit_date', startDate);
        if (endDate) query = query.lte('first_visit_date', endDate);
        const { data, error } = await query.order('form_number', { ascending: false });
        if (error) throw error;
        return { success: true, data: (data || []).map(mapDbToCase) };
      }

      // 情況 C：全量或跨年份查詢（包含 < HOT_YEAR_THRESHOLD 的冷歷史與 >= HOT_YEAR_THRESHOLD 的熱資料）
      let hotData = [];
      if (sb) {
        try {
          const { data, error } = await sb
            .from('new_family_cases')
            .select('*')
            .eq('status', 'closed')
            .gte('first_visit_date', `${HOT_YEAR_THRESHOLD}-01-01`)
            .order('form_number', { ascending: false });
          if (!error && data) {
            hotData = data.map(mapDbToCase);
          }
        } catch (e) {
          console.warn('[NewFamilySupabase] Fetch hot closed cases failed:', e);
        }
      }

      let coldData = [];
      if (typeof window !== 'undefined' && typeof window.churchAPI_original_nf === 'function') {
        try {
          const coldRes = await window.churchAPI_original_nf('getClosedCases', payload);
          if (coldRes && coldRes.data && Array.isArray(coldRes.data)) {
            coldData = coldRes.data.filter(isColdCase);
          }
        } catch (e) {
          console.warn('[NewFamilySupabase] Fetch cold closed cases failed:', e);
        }
      }

      // 合併與去重（熱資料優先）
      const map = new Map();
      hotData.forEach(item => {
        const key = String(item['表單號'] || item.form_number || item['姓名'] || item.id).trim();
        map.set(key, item);
      });
      coldData.forEach(item => {
        const key = String(item['表單號'] || item.form_number || item['姓名'] || item.id).trim();
        if (!map.has(key)) {
          map.set(key, item);
        }
      });

      const merged = Array.from(map.values()).sort((a, b) => {
        const fnA = String(a['表單號'] || a.form_number || '').trim();
        const fnB = String(b['表單號'] || b.form_number || '').trim();
        if (fnA && fnB) return fnB.localeCompare(fnA);
        const dateA = String(a['首次來訪日'] || a.first_visit_date || '').trim();
        const dateB = String(b['首次來訪日'] || b.first_visit_date || '').trim();
        return dateB.localeCompare(dateA);
      });

      return { success: true, data: merged };
    },

    // ── 3. 新增新家人留名卡 (submitNewFamily) ───────────────────
    async submitNewFamily(payload) {
      const sb = getSupabase();
      if (!sb) return null;

      const name = String(payload['姓名'] || '').trim();
      const nowMs = Date.now();
      if (name && name === _lastSubmitName && (nowMs - _lastSubmitTimestamp < 2500)) {
        console.warn('[NewFamilySupabase] Duplicate submission blocked:', name);
        return { success: true, message: '重複送出已攔截' };
      }
      _lastSubmitName = name;
      _lastSubmitTimestamp = nowMs;

      const visitDateRaw = payload['首次來訪日'];
      const { ymd: firstVisitDate, prefix: datePrefix } = getTaiwanDateParts(visitDateRaw);
      const serviceType = String(payload['聚會別'] || '').trim();
      const serviceCode = serviceType === '華語' ? '2' : (serviceType === '台語' ? '1' : (serviceType.includes('學') || serviceType.includes('青') ? '3' : '1'));
      const basePrefix = `${datePrefix}${serviceCode}`;

      let formNumber = payload['表單號'];
      if (!formNumber) {
        const { data: matches } = await sb
          .from('new_family_cases')
          .select('form_number')
          .like('form_number', `${basePrefix}%`);

        let maxSeq = 0;
        (matches || []).forEach(m => {
          const fn = String(m.form_number || '');
          if (fn.startsWith(basePrefix)) {
            const seqStr = fn.slice(basePrefix.length);
            const seq = parseInt(seqStr, 10);
            if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
          }
        });
        const nextSeqStr = String(maxSeq + 1).padStart(2, '0');
        formNumber = `${basePrefix}${nextSeqStr}`;
      }

      let nextRowNumber = 2;
      try {
        const { data: maxRowCase } = await sb
          .from('new_family_cases')
          .select('row_number')
          .not('row_number', 'is', null)
          .order('row_number', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (maxRowCase && maxRowCase.row_number) {
          nextRowNumber = Number(maxRowCase.row_number) + 1;
        }
      } catch (e) {}

      const newRecord = {
        form_number: String(formNumber),
        row_number: nextRowNumber,
        name: String(payload['姓名'] || '').trim(),
        gender: String(payload['性別'] || '').trim(),
        service_type: serviceType,
        occupation: String(payload['職業'] || '').trim(),
        age_group: String(payload['年齡'] || '').trim(),
        contacted_church_before: String(payload['是否曾接觸教會'] || '').trim(),
        visit_reason: String(payload['來訪原因'] || '').trim(),
        assigned_staff: String(payload['關懷同工'] || '').trim(),
        address: String(payload['地址'] || '').trim(),
        tel: String(payload['市話'] || '').trim(),
        phone: String(payload['手機'] || '').trim(),
        first_visit_date: firstVisitDate,
        settlement_status: String(payload['落戶狀態'] || '').trim(),
        inviter: String(payload['邀約人'] || '').trim(),
        notes: String(payload['備註'] || '').trim(),
        member_status: String(payload['會友狀態'] || '').trim(),
        member_code: String(payload['點名編號'] || '').trim(),
        current_group: String(payload['現行小組'] || '').trim(),
        status: 'tracking',
        updated_at: new Date().toISOString()
      };

      const { error } = await sb
        .from('new_family_cases')
        .upsert(newRecord, { onConflict: 'form_number' });

      if (error) throw error;

      // 同步設定表單號與行號後安全非同步雙寫至 Google Sheets
      payload['表單號'] = formNumber;
      payload.rowNumber = nextRowNumber;
      syncToGasBackup('submitNewFamily', payload);

      return { success: true, message: '新家人登錄成功', formNumber };
    },

    // ── 4. 更新個案 (updateTrackingCase / updateClosedCase) ─────
    async updateTrackingCase(payload) {
      const sb = getSupabase();
      if (!sb) return null;

      const vals = payload.values || payload;
      const id = payload.id;
      const formNumber = String(payload['表單號'] || payload.formNumber || payload.form_number || (vals && (vals.formNumber || vals['表單號'])) || '').trim();
      const rowNumber = Number(payload.rowNumber || payload.row_number || (vals && vals.rowNumber) || 0);
      const name = String(payload.name || payload['姓名'] || (vals && vals['姓名']) || '').trim();

      const updateData = {
        updated_at: new Date().toISOString()
      };

      const fieldMap = {
        '姓名': 'name',
        '性別': 'gender',
        '聚會別': 'service_type',
        '職業': 'occupation',
        '年齡': 'age_group',
        '是否曾接觸教會': 'contacted_church_before',
        '來訪原因': 'visit_reason',
        '關懷同工': 'assigned_staff',
        '地址': 'address',
        '市話': 'tel',
        '手機': 'phone',
        '首次來訪日': 'first_visit_date',
        '結案日期': 'closed_date',
        '落戶狀態': 'settlement_status',
        '邀約人': 'inviter',
        '備註': 'notes',
        '會友狀態': 'member_status',
        '點名編號': 'member_code',
        '現行小組': 'current_group'
      };

      Object.entries(fieldMap).forEach(([formKey, dbCol]) => {
        if (vals[formKey] !== undefined) {
          if (dbCol === 'first_visit_date') {
            updateData[dbCol] = vals[formKey] ? String(vals[formKey]).slice(0, 10) : null;
          } else if (dbCol === 'closed_date') {
            updateData[dbCol] = vals[formKey] ? String(vals[formKey]).slice(0, 10) : null;
          } else {
            updateData[dbCol] = String(vals[formKey] || '').trim();
          }
        }
      });

      if (vals['表單號'] !== undefined && vals['表單號'] !== '') {
        updateData['form_number'] = String(vals['表單號']).trim();
      }

      let query = sb.from('new_family_cases').update(updateData);

      if (id) {
        query = query.eq('id', id);
      } else if (formNumber) {
        query = query.eq('form_number', formNumber);
      } else if (name) {
        query = query.eq('name', name);
      } else if (rowNumber) {
        query = query.eq('row_number', rowNumber);
      }

      const { error } = await query;
      if (error) throw error;

      let targetRowNumber = rowNumber;
      if (!targetRowNumber && (id || formNumber || name)) {
        try {
          let q = sb.from('new_family_cases').select('row_number');
          if (id) q = q.eq('id', id);
          else if (formNumber) q = q.eq('form_number', formNumber);
          else if (name) q = q.eq('name', name);
          const { data: found } = await q.limit(1).maybeSingle();
          if (found && found.row_number) targetRowNumber = found.row_number;
        } catch (e) {}
      }

      // 安全背景雙寫
      syncToGasBackup('updateTrackingCase', { ...payload, rowNumber: targetRowNumber, row_number: targetRowNumber });

      return { success: true, message: '更新成功' };
    },

    async updateClosedCase(payload) {
      return this.updateTrackingCase(payload);
    },

    // ── 5. 刪除追蹤中案件 (deleteTrackingCase) ───────────────────
    async deleteTrackingCase(payload) {
      const sb = getSupabase();
      if (!sb) return null;

      const id = payload.id;
      const formNumber = String(payload.formNumber || payload.form_number || payload['表單號'] || '').trim();
      const rowNumber = Number(payload.rowNumber || 0);
      const name = String(payload.name || payload['姓名'] || '').trim();

      let query = sb.from('new_family_cases').delete();
      if (id) {
        query = query.eq('id', id);
      } else if (formNumber) {
        query = query.eq('form_number', formNumber);
      } else if (name) {
        query = query.eq('name', name);
      } else if (rowNumber) {
        query = query.eq('row_number', rowNumber);
      } else {
        throw new Error('未提供欲刪除案件之識別資料');
      }

      const { error } = await query;
      if (error) throw error;

      syncToGasBackup('deleteTrackingCase', payload);

      return { success: true, message: '刪除成功' };
    },

    // ── 6. 批次標記會友狀態 (markTrackingMemberStatuses) ─────────
    async markTrackingMemberStatuses(payload) {
      const sb = getSupabase();
      if (!sb) return null;

      const items = Array.isArray(payload.items) ? payload.items : (Array.isArray(payload) ? payload : []);
      for (const item of items) {
        const updateData = {
          updated_at: new Date().toISOString()
        };
        if (item.memberCode) updateData.member_code = item.memberCode;
        if (item.sundayGroup) updateData.current_group = item.sundayGroup;
        if (item.status) updateData.member_status = item.status;

        let query = sb.from('new_family_cases').update(updateData);
        if (item.id) query = query.eq('id', item.id);
        else if (item.formNumber) query = query.eq('form_number', String(item.formNumber));
        else if (item.name) query = query.eq('name', item.name);

        await query;
      }

      syncToGasBackup('markTrackingMemberStatuses', payload);

      return { success: true, message: '標記完成' };
    },

    // ── 7. 批次結案 (closeCases) ──────────────────────────────
    async closeCases(payload) {
      const sb = getSupabase();
      if (!sb) return null;

      const rowNumbers = Array.isArray(payload.rowNumbers) ? payload.rowNumbers : [];
      const formNumbers = Array.isArray(payload.formNumbers) ? payload.formNumbers : [];
      const ids = Array.isArray(payload.ids) ? payload.ids : [];
      const items = Array.isArray(payload.items) ? payload.items : [];

      const allFormNumbers = [...formNumbers];
      const allIds = [...ids];
      items.forEach(it => {
        if (it.formNumber || it['表單號']) allFormNumbers.push(String(it.formNumber || it['表單號']));
        if (it.id) allIds.push(it.id);
      });

      const todayStr = new Date().toISOString().slice(0, 10);

      let query = sb.from('new_family_cases').update({
        status: 'closed',
        closed_date: todayStr,
        updated_at: new Date().toISOString()
      });

      if (allIds.length > 0) {
        query = query.in('id', allIds);
      } else if (allFormNumbers.length > 0) {
        query = query.in('form_number', allFormNumbers);
      } else if (rowNumbers.length > 0) {
        query = query.in('row_number', rowNumbers);
      }

      const { error } = await query;
      if (error) throw error;

      syncToGasBackup('closeCases', payload);

      return { success: true, message: '已成功結案' };
    },

    // ── 8. 小組與教區選單 (getDistrictsAndClusters / getGroups) ──
    async getDistrictsAndClusters() {
      const sb = getSupabase();
      if (!sb) return null;

      const [pagesRes, gmRes] = await Promise.all([
        sb.from('ministry_pages').select('page_name, template_type'),
        sb.from('group_members').select('group_name')
      ]);

      const groupNames = new Set();
      (pagesRes.data || []).forEach(p => {
        if (p.page_name) groupNames.add(p.page_name.trim());
      });
      (gmRes.data || []).forEach(g => {
        if (g.group_name) groupNames.add(g.group_name.trim());
      });

      const groups = Array.from(groupNames).sort().map(name => ({
        name,
        cluster: 'group'
      }));

      return { success: true, clusters: groups, groups: groups };
    },

    async getGroups() {
      return this.getDistrictsAndClusters();
    }
  };

  // 🎯 自動劫持 / 增強 window.churchAPI（支援 newfamily 路由）
  function setupNewFamilyRouter() {
    if (typeof window.churchAPI === 'function' && !window.churchAPI_original_nf) {
      window.churchAPI_original_nf = window.churchAPI;
      window.churchAPI = async function(action, data = {}) {
        if (NewFamilySupabaseService[action] && typeof NewFamilySupabaseService[action] === 'function') {
          try {
            const res = await NewFamilySupabaseService[action](data);
            if (res !== null) return res;
          } catch (err) {
            console.warn(`[NewFamilySupabase] Action ${action} handling error, falling back to GAS:`, err);
          }
        }
        return await window.churchAPI_original_nf(action, data);
      };
    }
  }

  if (typeof window !== 'undefined') {
    window.NewFamilySupabaseService = NewFamilySupabaseService;
    setupNewFamilyRouter();
    window.addEventListener('DOMContentLoaded', setupNewFamilyRouter);
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      NewFamilySupabaseService,
      HOT_YEAR_THRESHOLD,
      isHotYear,
      isHotDate,
      isColdCase,
      mapDbToCase
    };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);

