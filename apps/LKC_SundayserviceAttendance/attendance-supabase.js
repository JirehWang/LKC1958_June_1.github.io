// ⚡ apps/LKC_SundayserviceAttendance/attendance-supabase.js
// 主日出席點名與會友管理 Supabase 熱響應服務模組 (含雙寫備份與冷熱分流)

(function(window) {
  const HOT_YEAR_THRESHOLD = 2025;

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

  function formatDate(dStr) {
    if (!dStr) {
      const now = new Date();
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    }
    const parts = dStr.replace(/\//g, '-').split('-');
    if (parts.length === 3) {
      return `${parts[0]}-${String(parts[1]).padStart(2, '0')}-${String(parts[2]).padStart(2, '0')}`;
    }
    return dStr;
  }

  function syncToGasBackup(action, payload) {
    setTimeout(async () => {
      try {
        const apiUrl = (window.GAS_CONFIG && window.GAS_CONFIG.apiUrl) || window.GAS_URL;
        if (apiUrl) {
          fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ action: action, data: payload, payload: payload })
          }).catch(e => console.warn(`[Attendance Backup] Fetch sync (${action}):`, e.message));
          return;
        }

        const gasFn = window.churchAPI_original || window.churchAPI;
        if (typeof gasFn === 'function') {
          gasFn(action, payload).catch(e => console.warn(`[Attendance Backup] GAS sync (${action}):`, e.message));
        }
      } catch (e) {}
    }, 50);
  }

  const AttendanceSupabaseService = {
    // ── 1. 場次分類 (getGroupConfig) ──────────────────────────
    async getGroupConfig() {
      return {
        "禮拜": ["台語", "華語", "聯合"],
        "主日學": ["主日學A班", "主日學B班"],
        "禱告會": ["禱告會"]
      };
    },

    // ── 2. 智慧點名名單 (getSmartAttendanceList & getQuickSyncData) ─
    async getSmartAttendanceList(payload) {
      const sb = getSupabase();
      if (!sb) return await window.churchAPI('getSmartAttendanceList', payload);

      let type = '華語';
      let dateVal = '';

      if (typeof payload === 'string') {
        type = payload;
      } else if (Array.isArray(payload)) {
        type = payload[0] || '華語';
        dateVal = payload[2] || '';
      } else if (payload && typeof payload === 'object') {
        type = payload.type || '華語';
        dateVal = payload.date || '';
      }

      const todayYMD = formatDate(dateVal);

      // 併發讀取：會友名冊、該場次專屬近 90 天出席計數、今日送出紀錄
      let countQuery;
      if (type === '聯合') {
        countQuery = sb.from('view_attendance_90days_by_service').select('uid, count_90d');
      } else {
        countQuery = sb.from('view_attendance_90days_by_service').select('uid, count_90d').eq('service_type', type);
      }

      const [membersRes, countsRes, todayRes] = await Promise.all([
        sb.from('church_members').select('*').order('name', { ascending: true }),
        countQuery,
        sb.from('attendance_records').select('*').eq('service_type', type).eq('date', todayYMD).maybeSingle()
      ]);

      if (membersRes.error) throw membersRes.error;

      // 建立該場次專屬的 90 天計數字典
      const countMap = {};
      (countsRes.data || []).forEach(r => { 
        const c = parseInt(r.count_90d, 10) || 0;
        countMap[r.uid] = (countMap[r.uid] || 0) + c;
      });

      // 今日已送出 UID 集合
      const submittedUids = new Set(
        (todayRes.data && Array.isArray(todayRes.data.present_uids)) ? todayRes.data.present_uids : []
      );

      const activeList = [];
      const excludedNames = [];

      (membersRes.data || []).forEach(m => {
        if (m.is_excluded) {
          excludedNames.push(m.name);
          return;
        }

        const isSub = submittedUids.has(m.uid);
        const cnt = countMap[m.uid] || 0;
        const createTs = m.created_at ? new Date(m.created_at).getTime() : 0;

        activeList.push({
          id: m.uid,
          uid: m.uid,
          name: m.name,
          gender: m.gender || '',
          createDate: createTs,
          count: cnt,
          isChecked: isSub,
          isSubmitted: isSub,
          operatorId: '',
          group: m.group_name || '',
          role: m.role || '小羊',
          pendingSource: 'manual',
          pendingOwnerId: '',
          pendingRevision: 0,
          pendingUpdatedAt: 0,
          pendingLockedUntil: 0,
          pendingExpiresAt: 0
        });
      });

      // 依該場次 90 天出席次數 (降冪) 排序，次數相同按姓名繁體中文排序
      activeList.sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return a.name.localeCompare(b.name, 'zh-Hant');
      });

      const nfMale = todayRes.data ? (todayRes.data.new_friends_male || 0) : 0;
      const nfFemale = todayRes.data ? (todayRes.data.new_friends_female || 0) : 0;

      return {
        activeList: activeList,
        excludedNames: excludedNames,
        nfMale: nfMale,
        nfFemale: nfFemale,
        formalRevision: Date.now()
      };
    },

    async getQuickSyncData(payload) {
      return await this.getSmartAttendanceList(payload);
    },

    async updateDeviceMode(userId, mode) {
      return { status: 'success' };
    },

    // ── 3. 正式送出點名紀錄 (saveAttendance - 雙寫備份與聯集合併) ───────
    async saveAttendance(payload) {
      const sb = getSupabase();
      if (!sb) return await window.churchAPI('saveAttendance', payload);

      let dateStr, presentList, type, nfMale, nfFemale;

      if (Array.isArray(payload)) {
        dateStr = formatDate(payload[0]);
        presentList = Array.isArray(payload[1]) ? payload[1] : [];
        type = payload[2] || '華語';
        nfMale = parseInt(payload[3] || '0', 10) || 0;
        nfFemale = parseInt(payload[4] || '0', 10) || 0;
      } else if (payload && typeof payload === 'object') {
        dateStr = formatDate(payload.date || payload.dateText);
        presentList = Array.isArray(payload.presentList) ? payload.presentList : [];
        type = payload.type || payload.serviceType || '華語';
        nfMale = parseInt(payload.nfMale || '0', 10) || 0;
        nfFemale = parseInt(payload.nfFemale || '0', 10) || 0;
      }

      // 支援傳入 UID 或 姓名，若為姓名則自動對映至 UID
      const { data: allMembers } = await sb.from('church_members').select('uid, name');
      const nameToUid = new Map();
      const uidSet = new Set();
      (allMembers || []).forEach(m => {
        if (m.name) nameToUid.set(m.name.trim(), m.uid);
        if (m.uid) uidSet.add(m.uid);
      });

      const incomingUids = Array.from(new Set(presentList.map(item => {
        const str = String(item || '').trim();
        if (uidSet.has(str)) return str;
        if (nameToUid.has(str)) return nameToUid.get(str);
        return str;
      }).filter(Boolean)));

      // 讀取當天已有的出席 UID 並進行聯集合併
      const { data: existingRec } = await sb
        .from('attendance_records')
        .select('present_uids')
        .eq('service_type', type)
        .eq('date', dateStr)
        .maybeSingle();

      const existingUids = (existingRec && Array.isArray(existingRec.present_uids)) ? existingRec.present_uids : [];
      const finalUids = Array.from(new Set([...existingUids, ...incomingUids]));

      // 1. 立即寫入 Supabase (極速 <50ms)
      const { error } = await sb
        .from('attendance_records')
        .upsert({
          service_type: type,
          date: dateStr,
          present_uids: finalUids,
          raw_list_str: finalUids.join(', '),
          new_friends_male: nfMale,
          new_friends_female: nfFemale,
          updated_at: new Date().toISOString()
        }, { onConflict: 'service_type,date' });

      if (error) throw error;

      // 2. 背景非同步同步至 Google Sheets 歷史存檔
      syncToGasBackup('saveAttendance', payload);

      return `✅ 同步成功 (出席: ${finalUids.length} 人, 新朋友: 男 ${nfMale} 人, 女 ${nfFemale} 人)`;
    },

    // ── 撤銷單筆出席 (revokeAttendance) ────────────────────────
    async revokeAttendance(nameOrUid, type, userId, dateStr, formalRevision) {
      const sb = getSupabase();
      if (!sb) return await window.churchAPI('revokeAttendance', nameOrUid, type, userId, dateStr, formalRevision);

      let targetUid = '';
      let targetType = '華語';
      let targetDate = formatDate('');

      if (Array.isArray(nameOrUid)) {
        targetUid = String(nameOrUid[0] || '').trim();
        targetType = nameOrUid[1] || '華語';
        targetDate = formatDate(nameOrUid[3] || '');
      } else {
        targetUid = String(nameOrUid || '').trim();
        targetType = type || '華語';
        targetDate = formatDate(dateStr || '');
      }

      // 如果傳入的是姓名，先轉為 UID
      if (!/^LK\d+$/i.test(targetUid)) {
        const { data: mem } = await sb.from('church_members').select('uid').eq('name', targetUid).maybeSingle();
        if (mem) targetUid = mem.uid;
      }

      const { data: existingRec } = await sb
        .from('attendance_records')
        .select('*')
        .eq('service_type', targetType)
        .eq('date', targetDate)
        .maybeSingle();

      if (!existingRec) return 'OK';

      const existingUids = Array.isArray(existingRec.present_uids) ? existingRec.present_uids : [];
      const updatedUids = existingUids.filter(u => u !== targetUid);

      const { error } = await sb
        .from('attendance_records')
        .update({
          present_uids: updatedUids,
          raw_list_str: updatedUids.join(', '),
          updated_at: new Date().toISOString()
        })
        .eq('id', existingRec.id);

      if (error) throw error;

      setTimeout(() => {
        try {
          if (typeof window.churchAPI === 'function') {
            window.churchAPI('revokeAttendance', nameOrUid, type, userId, dateStr, formalRevision)
              .catch(e => console.warn('[Revoke Backup] GAS sync:', e.message));
          }
        } catch (e) {}
      }, 10);

      return 'OK';
    },

    // ── 5. 點名統計報表 (getAttendanceStats - 極速讀取 Supabase) ────────
    async getAttendanceStats(req) {
      const sb = getSupabase();
      if (!sb) return await window.churchAPI('getAttendanceStats', req);

      const type = (req && req.type) || '華語';
      const mode = (req && req.mode) || 'single';

      const [membersRes, recsRes] = await Promise.all([
        sb.from('church_members').select('*').order('name', { ascending: true }),
        (async () => {
          let query = sb.from('attendance_records').select('*');
          if (type.includes('合計')) {
            const groups = req.targetGroups || ['台語', '華語', '聯合'];
            query = query.in('service_type', groups);
          } else {
            query = query.eq('service_type', type);
          }
          if (mode === 'single') {
            const dateStr = formatDate(req.date || '');
            query = query.eq('date', dateStr);
          } else {
            const startStr = formatDate(req.start || '2025/01/01');
            const endStr = formatDate(req.end || '2027/12/31');
            query = query.gte('date', startStr).lte('date', endStr);
          }
          return await query;
        })()
      ]);

      const members = membersRes.data || [];
      const records = recsRes.data || [];
      const memberMap = new Map();
      members.forEach(m => memberMap.set(m.uid, m));

      if (mode === 'single') {
        let presentUidSet = new Set();
        let nfMale = 0, nfFemale = 0;
        records.forEach(r => {
          (r.present_uids || []).forEach(uid => presentUidSet.add(uid));
          nfMale += Number(r.new_friends_male || 0);
          nfFemale += Number(r.new_friends_female || 0);
        });

        let presentMale = 0, presentFemale = 0;
        presentUidSet.forEach(uid => {
          const m = memberMap.get(uid);
          if (m) {
            if (m.gender === '男') presentMale++;
            else if (m.gender === '女') presentFemale++;
          }
        });

        const details = members
          .filter(m => !m.is_excluded || presentUidSet.has(m.uid))
          .map(m => {
            const attended = presentUidSet.has(m.uid);
            return {
              name: m.name,
              gender: m.gender || '',
              uid: m.uid,
              count: attended ? 1 : 0,
              attended,
              rate: 0,
              inGroup: Boolean(m.group_name && m.group_name !== '未分組')
            };
          })
          .sort((a, b) => (b.attended ? 1 : 0) - (a.attended ? 1 : 0));

        return {
          presentCount: presentUidSet.size,
          newFriends: nfMale + nfFemale,
          nfMale,
          nfFemale,
          presentMale,
          presentFemale,
          details
        };
      } else {
        // Range mode
        const validDays = records.length;
        const uidCounts = new Map();
        let nfMale = 0, nfFemale = 0;
        let totalPresentMale = 0, totalPresentFemale = 0;
        let sumMemberCounts = 0;

        records.forEach(r => {
          const uids = r.present_uids || [];
          uids.forEach(uid => {
            uidCounts.set(uid, (uidCounts.get(uid) || 0) + 1);
            const m = memberMap.get(uid);
            if (m) {
              if (m.gender === '男') totalPresentMale++;
              else if (m.gender === '女') totalPresentFemale++;
            }
          });
          sumMemberCounts += uids.length;
          nfMale += Number(r.new_friends_male || 0);
          nfFemale += Number(r.new_friends_female || 0);
        });

        const totalAttendedPersons = sumMemberCounts + nfMale + nfFemale;
        const avgCount = validDays > 0 ? Math.round(totalAttendedPersons / validDays) : 0;
        const avgPresentCount = validDays > 0 ? Math.round(sumMemberCounts / validDays) : 0;
        const avgMale = validDays > 0 ? Math.round(totalPresentMale / validDays) : 0;
        const avgFemale = validDays > 0 ? Math.round(totalPresentFemale / validDays) : 0;

        const details = members
          .filter(m => !m.is_excluded)
          .map(m => {
            const count = uidCounts.get(m.uid) || 0;
            const rate = validDays > 0 ? Math.round((count / validDays) * 100) : 0;
            return {
              name: m.name,
              gender: m.gender || '',
              uid: m.uid,
              count,
              rate,
              inGroup: Boolean(m.group_name && m.group_name !== '未分組')
            };
          })
          .sort((a, b) => b.rate - a.rate);

        return {
          presentCount: avgPresentCount,
          newFriends: nfMale + nfFemale,
          nfMale,
          nfFemale,
          presentMale: avgMale,
          presentFemale: avgFemale,
          avgCount,
          details
        };
      }
    },

    // ── 4. 會友名冊維護 (getAllMembers & getMemberManagementData) ─
    async getAllMembers() {
      const sb = getSupabase();
      if (!sb) return await window.churchAPI('getAllMembers');

      const { data, error } = await sb
        .from('church_members')
        .select('*')
        .order('uid', { ascending: true });

      if (error) throw error;

      return (data || []).map(m => [
        m.name,
        m.gender || '',
        m.created_at ? new Date(m.created_at).toISOString().slice(0, 10).replace(/-/g, '/') : '',
        (m.metadata && m.metadata.note) || '',
        Boolean(m.is_excluded),
        m.updated_at ? new Date(m.updated_at).toISOString().slice(0, 10).replace(/-/g, '/') : '',
        '',
        m.uid,
        m.group_name || '',
        m.role || '小羊'
      ]);
    },

    async getMemberManagementData() {
      const sb = getSupabase();
      if (!sb) return await window.churchAPI('getMemberManagementData');

      const [membersRes, attRes] = await Promise.all([
        sb.from('church_members').select('*').order('uid', { ascending: true }),
        sb.from('attendance_records').select('present_uids')
      ]);

      if (membersRes.error) throw membersRes.error;

      // 建立已使用 UID 集合 (出現在歷史點名紀錄中)
      const usedUids = new Set();
      (attRes.data || []).forEach(r => {
        (r.present_uids || []).forEach(u => usedUids.add(u));
      });

      const usageByUid = {};
      const rows = (membersRes.data || []).map(m => {
        const isUsed = usedUids.has(m.uid) || Boolean(m.group_name);
        usageByUid[m.uid] = { effective: isUsed };

        return [
          m.name,
          m.gender || '',
          m.created_at ? new Date(m.created_at).toISOString().slice(0, 10).replace(/-/g, '/') : '',
          (m.metadata && m.metadata.note) || '',
          Boolean(m.is_excluded),
          m.updated_at ? new Date(m.updated_at).toISOString().slice(0, 10).replace(/-/g, '/') : '',
          '',
          m.uid,
          m.group_name || '',
          m.role || '小羊'
        ];
      });

      return {
        members: rows,
        usageByUid: usageByUid
      };
    },

    async addMember(payload) {
      const sb = getSupabase();
      if (!sb) return await window.churchAPI('addMember', payload);

      if (Array.isArray(payload)) payload = payload[0] || {};
      payload = payload || {};

      const name = String(payload.name || '').trim();
      if (!name) throw new Error('會友姓名為必填');

      // 檢查是否已存在
      const { data: existing } = await sb
        .from('church_members')
        .select('uid, name')
        .eq('name', name)
        .maybeSingle();

      if (existing) {
        return `⚠️ 會友姓名「${name}」已存在（編號：${existing.uid}）`;
      }

      // 取得最大 UID
      const { data: allMems } = await sb.from('church_members').select('uid');
      let maxNum = 0;
      (allMems || []).forEach(m => {
        const match = String(m.uid || '').match(/^LK(\d+)$/i);
        if (match) {
          const n = parseInt(match[1], 10);
          if (n > maxNum) maxNum = n;
        }
      });
      const newUid = 'LK' + String(maxNum + 1).padStart(5, '0');

      const row = {
        uid: newUid,
        name: name,
        gender: payload.gender || '男',
        group_name: payload.group || payload.group_name || '',
        role: payload.role || '小羊',
        is_excluded: Boolean(payload.isExcluded),
        metadata: { note: payload.note || '' },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const { error } = await sb.from('church_members').insert(row);
      if (error) throw error;

      syncToGasBackup('addMember', payload);

      return `✅ 成功新增會友：${name}（編號：${newUid}）`;
    },

    async updateMember(oldName, newData) {
      const sb = getSupabase();
      if (!sb) return await window.churchAPI('updateMember', oldName, newData);

      // 支援 api.js 傳入陣列 [oldName, newData] 或單一物件或多參數呼叫
      if (Array.isArray(oldName)) {
        newData = oldName[1] || {};
        oldName = oldName[0];
      } else if (oldName && typeof oldName === 'object' && !newData) {
        newData = oldName;
        oldName = newData.oldName || newData.name;
      }
      newData = newData || {};

      const targetName = String(oldName || newData.oldName || newData.name || '').trim();
      const targetUid = String(newData.uid || newData.id || '').trim();

      const updates = {
        name: String(newData.name || targetName).trim(),
        gender: newData.gender || '',
        is_excluded: Boolean(newData.isExcluded),
        metadata: { note: newData.note || '' },
        updated_at: new Date().toISOString()
      };

      if (newData.group !== undefined || newData.group_name !== undefined) {
        updates.group_name = newData.group !== undefined ? newData.group : newData.group_name;
      }
      if (newData.role !== undefined) {
        updates.role = newData.role;
      }

      let query = sb.from('church_members').update(updates);
      if (targetUid && /^LK\d+$/i.test(targetUid)) {
        query = query.eq('uid', targetUid);
      } else {
        query = query.eq('name', targetName);
      }

      const { error } = await query;
      if (error) throw error;

      syncToGasBackup('updateMember', [targetName, newData]);

      return '✅ 成功更新會友：' + updates.name;
    },

    async deleteMember(name) {
      const sb = getSupabase();
      if (!sb) return await window.churchAPI('deleteMember', name);

      if (Array.isArray(name)) name = name[0];
      else if (name && typeof name === 'object') name = name.name;
      name = String(name || '').trim();
      if (!name) throw new Error('請指定要刪除的會友姓名');

      const { data: mem } = await sb.from('church_members').select('uid').eq('name', name).maybeSingle();
      if (!mem) throw new Error('找不到會友：' + name);

      // 檢查是否曾有歷史點名紀錄
      const { data: att } = await sb
        .from('attendance_records')
        .select('id')
        .contains('present_uids', [mem.uid])
        .limit(1);

      if (att && att.length > 0) {
        throw new Error('此會友曾有歷史出席紀錄，無法直接刪除；請改設為「不統計」。');
      }

      const { error } = await sb.from('church_members').delete().eq('uid', mem.uid);
      if (error) throw error;

      syncToGasBackup('deleteMember', name);

      return '✅ 成功刪除會友：' + name;
    },

    // ── 5. 和會正式會員名冊 (getOfficialMembers) ───────────────
    async getOfficialMembers() {
      const sb = getSupabase();
      if (!sb) return await window.churchAPI('getOfficialMembers');

      const { data, error } = await sb
        .from('church_members')
        .select('*')
        .eq('is_official_member', true)
        .order('name', { ascending: true });

      if (error) throw error;

      return (data || []).map(m => ({
        name: m.name,
        '姓名': m.name,
        category: m.official_category || '第一類',
        '類別': m.official_category || '第一類',
        uid: m.uid
      }));
    }
  };

  window.AttendanceSupabaseService = AttendanceSupabaseService;
})(window);
