// ⚡ apps/LKC_Group/group-supabase.js
// 小組點名與名冊系統 Supabase 本地熱響應服務模組 (<50ms)
// 包含小組登入驗證、組員名冊讀取、每週點名送出、名冊拖曳排序、週報與統計中心

(function() {
  const ADMIN_CODE = 'LK31';
  const OBFUSCATION_KEY = 'LKC-Secure-2026';
  const ENC_PREFIX = 'enc_';

  function decryptId(str) {
    if (typeof window.decryptGroupCode === 'function') {
      return window.decryptGroupCode(str);
    }
    const safeStr = String(str || '');
    if (!safeStr || safeStr.indexOf(ENC_PREFIX) !== 0) return safeStr;
    try {
      var hex = safeStr.substring(ENC_PREFIX.length);
      var plainText = '';
      for (var i = 0; i < hex.length; i += 2) {
        var charCode = parseInt(hex.substring(i, i + 2), 16);
        var decCharCode = charCode ^ OBFUSCATION_KEY.charCodeAt((i / 2) % OBFUSCATION_KEY.length);
        plainText += String.fromCharCode(decCharCode);
      }
      return plainText;
    } catch (e) {
      return safeStr;
    }
  }

  function encryptId(str) {
    if (typeof window.encryptGroupCode === 'function') {
      return window.encryptGroupCode(str);
    }
    const safeStr = String(str || '');
    if (!safeStr || safeStr.indexOf(ENC_PREFIX) === 0) return safeStr;
    var hex = '';
    for (var i = 0; i < safeStr.length; i++) {
      var charCode = safeStr.charCodeAt(i) ^ OBFUSCATION_KEY.charCodeAt(i % OBFUSCATION_KEY.length);
      var hexByte = charCode.toString(16).padStart(2, '0');
      hex += hexByte;
    }
    return ENC_PREFIX + hex;
  }

  let _cachedNameDirectory = null;
  let _cachedMembersList = null;
  let _cachedNameDirectoryTime = 0;

  function getSupabase() {
    if (window._supabase) return window._supabase;
    const config = window._SUPABASE_CONFIG || window.SUPABASE_CONFIG;
    const create = (window.supabase && window.supabase.createClient) || (typeof supabase !== 'undefined' && supabase.createClient);
    if (config && create) {
      const options = typeof window.__LKC_OBSERVABILITY_SUPABASE_OPTIONS__ === 'function'
        ? window.__LKC_OBSERVABILITY_SUPABASE_OPTIONS__({ system: 'LKC_Group' })
        : undefined;
      window._supabase = create(config.url, config.anonKey, options);
      return window._supabase;
    }
    return null;
  }

  function syncToGasBackup(action, payload) {
    setTimeout(async () => {
      try {
        const gasFn = window.churchAPI_original || window.churchAPI;
        if (typeof gasFn === 'function') {
          gasFn(action, payload).catch(e => console.warn(`[Group Backup] GAS sync (${action}):`, e.message));
          return;
        }

        const apiUrl = window.GAS_URL;
        if (apiUrl) {
          fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ action: action, data: payload, payload: payload })
          }).catch(e => console.warn(`[Group Backup] Fetch sync (${action}):`, e.message));
        }
      } catch (e) {}
    }, 50);
  }

  const GroupSupabaseService = {
    // ── 1. 取得小組清單 (getGroups) ──────────────────────────────
    async getGroups(payload) {
      const sb = getSupabase();
      if (!sb) return null;

      const { data, error } = await sb
        .from('groups')
        .select('*')
        .order('name');

      if (error) throw error;

      const groups = (data || []).map(g => ({
        uuid: g.uuid,
        name: g.name,
        code: g.code,
        encryptedCode: g.encrypted_code || encryptId(g.code),
        status: g.status || '顯示',
        type: g.group_type || '一般小組',
        groupType: g.group_type || '一般小組',
        associatedGroup: g.associated_group || '',
        districtUuid: g.district_uuid || '',
        clusterUuid: g.cluster_uuid || '',
        date: g.date || ''
      }));

      return { success: true, groups };
    },

    // ── 1.5. 建立新小組 (createGroup) ───────────────────────────
    async createGroup(payload) {
      const sb = getSupabase();
      if (!sb) {
        const gasFn = window.churchAPI_original || window.churchAPI;
        if (typeof gasFn === 'function') return await gasFn('createGroup', payload);
        return null;
      }

      const groupName = String(payload.groupName || '').trim();
      const groupCode = String(payload.groupCode || '').trim();
      const groupType = payload.groupType || '一般小組';
      const associatedGroup = payload.associatedGroup || '';

      if (!groupName || !groupCode) {
        return { success: false, message: '請填寫小組名稱與代碼' };
      }

      // 檢查是否重名
      const { data: exist } = await sb.from('groups').select('*').eq('name', groupName).maybeSingle();
      if (exist) {
        return { success: false, message: '此小組名稱已存在！' };
      }

      const uuid = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : ('grp_' + Date.now());
      const newGroup = {
        uuid: uuid,
        name: groupName,
        code: groupCode,
        encrypted_code: encryptId(groupCode),
        group_type: groupType,
        associated_group: associatedGroup,
        status: '顯示',
        date: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const { error } = await sb.from('groups').insert([newGroup]);
      if (error) {
        const gasFn = window.churchAPI_original || window.churchAPI;
        if (typeof gasFn === 'function') return await gasFn('createGroup', payload);
        throw error;
      }

      // 若為幸福小組且選擇繼承同工名單，自 church_members 撈出該組成員寫入 group_members
      if (groupType === '幸福小組' && associatedGroup) {
        try {
          const { data: assocMems } = await sb.from('church_members').select('*');
          if (assocMems && assocMems.length > 0) {
            const inherited = assocMems
              .filter(m => String(m.group_name || '').includes(associatedGroup))
              .map((m, idx) => ({
                group_name: groupName,
                uid: m.uid || '',
                name: m.name,
                role: '同工',
                nickname: (m.metadata && m.metadata.nickname) || '',
                sort_order: idx + 1,
                updated_at: new Date().toISOString()
              }));
            if (inherited.length > 0) {
              await sb.from('group_members').insert(inherited);
            }
          }
        } catch (e) {
          console.warn('[GroupSupabase] Inherit workers failed:', e);
        }
      }

      syncToGasBackup('createGroup', payload);

      return { success: true, message: '小組創建成功！', groupUuid: uuid };
    },

    // ── 2. 代碼反查小組 (findGroupByCode) ────────────────────────
    async findGroupByCode(payload) {
      const sb = getSupabase();
      if (!sb) return null;

      const rawCode = String(payload.groupCode || payload.code || '').trim();
      const code = decryptId(rawCode).trim().toUpperCase();
      if (!code) return { success: false, message: '請提供小組代碼' };

      if (code === ADMIN_CODE) {
        return { success: true, groupName: "ADMIN", isAdmin: true, encryptedCode: encryptId(ADMIN_CODE) };
      }

      const { data, error } = await sb
        .from('groups')
        .select('*');

      if (error) throw error;

      const match = (data || []).find(g => 
        (g.code && g.code.toUpperCase() === code) || 
        (g.encrypted_code && g.encrypted_code === rawCode) ||
        (g.code && g.code.toUpperCase() === rawCode.toUpperCase())
      );

      if (!match) {
        return { success: false, message: '查無此小組代碼' };
      }

      return {
        success: true,
        groupName: match.name,
        encryptedCode: match.encrypted_code || encryptId(match.code),
        groupType: match.group_type || '一般小組'
      };
    },

    // ── 3. 驗證小組代碼 (verifyGroup) ───────────────────────────
    async verifyGroup(payload) {
      const sb = getSupabase();
      if (!sb) return null;

      const groupName = String(payload.groupName || '').trim();
      const rawCode = String(payload.groupCode || payload.code || '').trim();
      const code = decryptId(rawCode).trim().toUpperCase();

      if (code === ADMIN_CODE) {
        return { success: true, message: '管理員授權', isAdmin: true, encryptedCode: encryptId(ADMIN_CODE) };
      }

      const res = await this.findGroupByCode(payload);
      if (res.success && (res.groupName === groupName || res.isAdmin)) {
        return { success: true, message: '驗證成功', encryptedCode: res.encryptedCode };
      }

      return { success: false, message: res.message || '驗證失敗' };
    },

    // ── 4. 後台管理清單 (getAdminGroupsList) ─────────────────────
    async getAdminGroupsList(payload) {
      const sb = getSupabase();
      if (!sb) return null;

      const rawCode = String(payload.authCode || payload.groupCode || '').trim();
      const code = decryptId(rawCode).trim().toUpperCase();
      const isAdmin = (code === ADMIN_CODE);

      const { data, error } = await sb.from('groups').select('*').order('name');
      if (error) throw error;

      let groups = (data || []).map(g => ({
        uuid: g.uuid,
        name: g.name,
        code: g.code,
        status: g.status || '顯示',
        type: g.group_type || '一般小組',
        associatedGroup: g.associated_group || '',
        districtUuid: g.district_uuid || '',
        clusterUuid: g.cluster_uuid || '',
        date: g.date || ''
      }));

      if (!isAdmin) {
        groups = groups.filter(g => (g.code && g.code.toUpperCase() === code));
        if (groups.length === 0) {
          return { success: false, message: '權限不足或輸入代碼錯誤' };
        }
      }

      return {
        success: true,
        groups: groups,
        isAdmin: isAdmin,
        districts: [],
        clusters: []
      };
    },

    // ── 5. 更新小組資訊 (updateGroupInfo) ────────────────────────
    async updateGroupInfo(payload) {
      const sb = getSupabase();
      if (!sb) return null;

      const groupName = String(payload.groupName || '').trim();
      const uuid = payload.uuid;
      const status = payload.status;
      const type = payload.type;
      const associatedGroup = payload.associatedGroup;

      let query = sb.from('groups').update({
        status: status,
        group_type: type,
        associated_group: associatedGroup,
        updated_at: new Date().toISOString()
      });

      if (uuid) {
        query = query.eq('uuid', uuid);
      } else {
        query = query.eq('name', groupName);
      }

      await query;

      syncToGasBackup('updateGroupInfo', payload);

      return { success: true, message: '小組資訊已成功更新' };
    },

    // ── 6. 檢查小組狀態與名單 (checkGroupStatus) ──────────────────
    async checkGroupStatus(payload) {
      const sb = getSupabase();
      if (!sb) {
        const gasFn = window.churchAPI_original || window.churchAPI;
        if (typeof gasFn === 'function') return await gasFn('checkGroupStatus', payload);
        return null;
      }

      const groupName = String(payload.groupName || '').trim();

      const [groupRes, membersRes] = await Promise.all([
        sb.from('groups').select('*').eq('name', groupName).maybeSingle(),
        sb.from('group_members').select('*').eq('group_name', groupName).order('sort_order', { ascending: true })
      ]);

      const group = groupRes.data || {};
      let members = (membersRes.data || []).map(m => ({
        name: m.name,
        uid: m.uid || '',
        role: m.role || '小羊',
        nickname: m.nickname || '',
        sortOrder: m.sort_order || 0
      }));

      // 若 group_members 尚未建立該組，從主日會友大名單 (church_members) 依 group_name 撈取
      if (members.length === 0) {
        const { data: churchMems } = await sb.from('church_members').select('*').order('name', { ascending: true });
        if (churchMems && churchMems.length > 0) {
          members = churchMems
            .filter(cm => {
              const grpStr = cm.group_name || '';
              return grpStr.split(/[、,，/ ]/).map(s => s.trim()).some(s => s.includes(groupName));
            })
            .map(cm => {
              let role = cm.role || '小羊';
              const grpStr = cm.group_name || '';
              const parts = grpStr.split(/[、,，]/);
              for (const part of parts) {
                const match = part.trim().match(/^(.+?)\((.+?)\)$/);
                if (match && match[2].trim() === groupName) {
                  role = match[1].trim();
                  break;
                }
              }
              return {
                name: cm.name,
                uid: cm.uid || '',
                role: role,
                nickname: (cm.metadata && cm.metadata.nickname) || '',
                sortOrder: 0
              };
            });
        }
      }

      // 若 Supabase 兩張表皆完全無名單資料，回退至 GAS 讀取歷史試算表
      if (members.length === 0) {
        const gasFn = window.churchAPI_original || window.churchAPI;
        if (typeof gasFn === 'function') {
          try {
            const gasRes = await gasFn('checkGroupStatus', payload);
            if (gasRes && (gasRes.isInitialized || (gasRes.members && gasRes.members.length > 0))) {
              return gasRes;
            }
          } catch (e) {
            console.warn('[GroupSupabase] checkGroupStatus GAS fallback:', e);
          }
        }
      }

      const isHappy = (group.group_type === '幸福小組');
      const isInitialized = members.length > 0 || Boolean(group.name);

      return {
        success: true,
        isInitialized: isInitialized,
        status: group.status || '顯示',
        type: group.group_type || (isHappy ? '幸福小組' : '一般小組'),
        associatedGroup: group.associated_group || '',
        members: members
      };
    },

    // ── 7. 取得統計報表 (getStats / getAllGroupsStats / getAllGroupMembers) ─
    async getStats(payload = {}) {
      const sb = getSupabase();
      if (!sb) {
        const gasFn = window.churchAPI_original || window.churchAPI;
        if (typeof gasFn === 'function') return await gasFn('getStats', payload);
        return null;
      }

      const groupName = String(payload.groupName || '').trim();
      const isRawMode = (payload.startDate === 'RAW_MODE');
      const isAll = (!groupName || groupName === 'ALL' || groupName === '小組清單');

      let query = sb.from('group_attendance_records').select('*').order('date', { ascending: false });
      if (!isAll) {
        query = query.eq('group_name', groupName);
      }

      const { data: records } = await query;

      // 若 Supabase 尚無該小組的歷史紀錄，回退至 GAS 讀取歷史試算表
      if (!records || records.length === 0) {
        const gasFn = window.churchAPI_original || window.churchAPI;
        if (typeof gasFn === 'function') {
          try {
            const gasRes = await gasFn('getStats', payload);
            if (gasRes && gasRes.success) return gasRes;
          } catch (e) {
            console.warn('[GroupSupabase] getStats GAS fallback:', e);
          }
        }
      }

      // 建立會友 UID -> 姓名反查表（5分鐘快取加速）
      const now = Date.now();
      if (!_cachedNameDirectory || !_cachedMembersList || (now - _cachedNameDirectoryTime > 300000)) {
        const { data: churchMems } = await sb.from('church_members').select('uid, name, group_name, role');
        const dir = {};
        (churchMems || []).forEach(m => {
          if (m.uid) dir[m.uid.toUpperCase()] = m.name;
        });
        _cachedNameDirectory = dir;
        _cachedMembersList = churchMems || [];
        _cachedNameDirectoryTime = now;
      }
      const nameDirectory = _cachedNameDirectory;
      const mems = _cachedMembersList;

      if (isRawMode) {
        return {
          success: true,
          groupName: groupName,
          isSingleDay: false,
          data: (records || []).map(r => {
            const uids = r.present_uids || r.present_members || [];
            return [
              r.date ? String(r.date).slice(0, 10).replace(/-/g, '/') : '',
              Array.isArray(uids) ? uids.join(', ') : String(uids || ''),
              r.offering || 0,
              Array.isArray(r.new_friends) ? r.new_friends.join(', ') : String(r.new_friends || '')
            ];
          }),
          nameDirectory: nameDirectory
        };
      }

      // 組員出席率分析模式
      const sDate = payload.startDate ? new Date(payload.startDate) : null;
      const eDate = payload.endDate ? new Date(payload.endDate) : null;
      const isSingleDay = (payload.startDate === payload.endDate && payload.startDate !== '' && payload.startDate !== undefined);

      const groupMembers = (mems || []).filter(m => {
        if (isAll) return Boolean(m.group_name);
        return String(m.group_name || '').includes(groupName);
      });

      const filteredRecords = (records || []).filter(r => {
        if (!r.date) return false;
        const t = new Date(r.date).getTime();
        if (sDate && t < sDate.getTime()) return false;
        if (eDate && t > eDate.getTime()) return false;
        return true;
      });

      const { data: sundayRecs } = await sb.from('attendance_records').select('*');
      const filteredSunday = (sundayRecs || []).filter(sr => {
        if (!sr.date) return false;
        const t = new Date(sr.date).getTime();
        if (sDate && t < sDate.getTime()) return false;
        if (eDate && t > eDate.getTime()) return false;
        return true;
      });

      const totalCellSessions = filteredRecords.length;
      const worshipSessions = filteredSunday.filter(sr => ['台語', '華語', '聯合'].includes(sr.service_type)).length;
      const schoolSessions = filteredSunday.filter(sr => String(sr.service_type || '').includes('主日學')).length;

      const data = groupMembers.map(m => {
        const uid = m.uid;
        const cellCount = filteredRecords.filter(r => {
          const uList = r.present_uids || r.present_members || [];
          return uList.includes(uid) || uList.includes(m.name);
        }).length;
        const sundayCount = filteredSunday.filter(sr => ['台語', '華語', '聯合'].includes(sr.service_type) && (sr.present_uids || []).includes(uid)).length;
        const schoolCount = filteredSunday.filter(sr => String(sr.service_type || '').includes('主日學') && (sr.present_uids || []).includes(uid)).length;

        if (isSingleDay) {
          return {
            name: m.name,
            uid: m.uid,
            group: m.group_name || groupName,
            cell: cellCount > 0,
            sunday: sundayCount > 0,
            school: schoolCount > 0
          };
        }

        return {
          name: m.name,
          uid: m.uid,
          group: m.group_name || groupName,
          cellRate: totalCellSessions > 0 ? ((cellCount / totalCellSessions) * 100).toFixed(1) : 0,
          cellStr: `${cellCount}/${totalCellSessions}`,
          sundayRate: worshipSessions > 0 ? ((sundayCount / worshipSessions) * 100).toFixed(1) : 0,
          sundayStr: `${sundayCount}/${worshipSessions}`,
          schoolRate: schoolSessions > 0 ? ((schoolCount / schoolSessions) * 100).toFixed(1) : 0,
          schoolStr: `${schoolCount}/${schoolSessions}`
        };
      });

      if (!isSingleDay) {
        data.sort((a, b) => parseFloat(b.cellRate) - parseFloat(a.cellRate));
      }

      return {
        success: true,
        groupName: groupName,
        isSingleDay: isSingleDay,
        data: data
      };
    },

    async getAllGroupsStats(payload = {}) {
      return this.getStats({ ...payload, groupName: 'ALL' });
    },

    async getAllGroupMembers(payload = {}) {
      const sb = getSupabase();
      if (!sb) {
        const gasFn = window.churchAPI_original || window.churchAPI;
        if (typeof gasFn === 'function') return await gasFn('getAllGroupMembers', payload);
        return null;
      }

      const { data: mems, error } = await sb
        .from('church_members')
        .select('uid, name, gender, group_name, role')
        .order('uid', { ascending: true });

      if (error) throw error;

      const filtered = (mems || []).filter(m => Boolean(m.group_name));

      return {
        success: true,
        data: filtered.map(m => ({
          name: m.name,
          gender: m.gender || '',
          uid: m.uid || '',
          group: m.group_name || '',
          role: m.role || '小羊'
        }))
      };
    },

    // ── 8. 儲存小組點名 (submitAttendance) ───────────────────────
    async submitAttendance(payload) {
      const sb = getSupabase();
      if (!sb) return null;

      const groupName = String(payload.groupName || '').trim();
      const dateStr = String(payload.date || '').slice(0, 10);
      const attendees = Array.isArray(payload.present) ? payload.present : (Array.isArray(payload.attendees) ? payload.attendees : []);
      const absent = Array.isArray(payload.absent) ? payload.absent : [];
      let newFriends = [];
      if (Array.isArray(payload.newFriends)) {
        newFriends = payload.newFriends;
      } else if (typeof payload.newFriends === 'string') {
        newFriends = payload.newFriends.split(/[^\u4e00-\u9fa5a-zA-Z0-9\s]+/).map(s => s.trim()).filter(Boolean);
      }
      const offering = Number(payload.offering || 0);
      const notes = String(payload.notes || '').trim();

      if (!groupName || !dateStr) {
        return { success: false, message: '小組名稱與日期不可為空' };
      }

      const record = {
        group_name: groupName,
        date: dateStr,
        present_uids: attendees,
        absent_uids: absent,
        new_friends: newFriends,
        new_friends_raw: Array.isArray(newFriends) ? newFriends.join(', ') : String(newFriends || ''),
        offering: offering,
        notes: notes,
        updated_at: new Date().toISOString()
      };

      const { error } = await sb.from('group_attendance_records').upsert(record, {
        onConflict: 'group_name,date'
      });

      if (error) throw error;

      syncToGasBackup('submitAttendance', payload);

      return { success: true, message: '小組點名已成功送出！' };
    },

    // ── 9. 更新點名紀錄 (updateAttendanceRecord) ─────────────────
    async updateAttendanceRecord(payload) {
      const sb = getSupabase();
      if (!sb) return null;

      const groupName = String(payload.groupName || '').trim();
      const originalDate = String(payload.originalDate || '').slice(0, 10);
      const newDate = String(payload.newDate || payload.date || originalDate).slice(0, 10);

      if (originalDate && newDate && originalDate !== newDate) {
        await sb.from('group_attendance_records').delete().eq('group_name', groupName).eq('date', originalDate);
      }

      return this.submitAttendance({ ...payload, date: newDate });
    },

    // ── 10. 刪除點名紀錄 (deleteAttendanceRecord) ────────────────
    async deleteAttendanceRecord(payload) {
      const sb = getSupabase();
      if (!sb) return null;

      const groupName = String(payload.groupName || '').trim();
      const dateStr = String(payload.originalDate || payload.date || '').slice(0, 10);

      if (!groupName || !dateStr) {
        return { success: false, message: '小組名稱與日期不可為空' };
      }

      const { error } = await sb
        .from('group_attendance_records')
        .delete()
        .eq('group_name', groupName)
        .eq('date', dateStr);

      if (error) throw error;

      syncToGasBackup('deleteAttendanceRecord', payload);

      return { success: true, message: '點名紀錄已成功刪除' };
    },

    // ── 11. 更新組員名冊 (updateMemberList) ──────────────────────
    async updateMemberList(payload) {
      const sb = getSupabase();
      if (!sb) return null;

      const groupName = String(payload.groupName || '').trim();
      const members = Array.isArray(payload.members) ? payload.members : [];

      if (!groupName) return { success: false, message: '小組名稱不可為空' };

      await sb.from('group_members').delete().eq('group_name', groupName);

      if (members.length > 0) {
        const rows = members.map((m, idx) => ({
          group_name: groupName,
          uid: (typeof m === 'object' && m.uid) ? m.uid : '',
          name: typeof m === 'string' ? m : m.name,
          role: (typeof m === 'object' && m.role) ? m.role : '小羊',
          nickname: (typeof m === 'object' && m.nickname) ? m.nickname : '',
          sort_order: idx + 1,
          updated_at: new Date().toISOString()
        }));

        const { error } = await sb.from('group_members').insert(rows);
        if (error) throw error;
      }

      syncToGasBackup('updateMemberList', payload);

      return { success: true, message: '名冊已成功更新！' };
    },

    // ── 12. 初始化新小組 (initGroup) ──────────────────────────────
    async initGroup(payload) {
      const sb = getSupabase();
      if (!sb) return null;

      const groupName = String(payload.groupName || '').trim();
      const type = payload.type || payload.groupType || '一般小組';
      const associatedGroup = payload.associatedGroup || '';
      const members = Array.isArray(payload.members) ? payload.members : [];

      // 檢查小組是否存在，不存在則建立
      const { data: existingGroup } = await sb.from('groups').select('*').eq('name', groupName).maybeSingle();
      if (!existingGroup) {
        await sb.from('groups').insert([{
          name: groupName,
          code: ('LK' + Math.floor(10 + Math.random() * 90)),
          group_type: type,
          associated_group: associatedGroup,
          status: '顯示',
          updated_at: new Date().toISOString()
        }]);
      }

      // 若有傳入初始成員名單，寫入 group_members
      if (members.length > 0) {
        await sb.from('group_members').delete().eq('group_name', groupName);
        const rows = members.map((m, idx) => ({
          group_name: groupName,
          uid: (typeof m === 'object' && m.uid) ? m.uid : '',
          name: typeof m === 'string' ? m : m.name,
          role: (typeof m === 'object' && m.role) ? m.role : '小羊',
          nickname: (typeof m === 'object' && m.nickname) ? m.nickname : '',
          sort_order: idx + 1,
          updated_at: new Date().toISOString()
        }));
        await sb.from('group_members').insert(rows);
      }

      syncToGasBackup('initGroup', payload);

      return { success: true, message: '小組與名冊已成功初始化！' };
    },

    // ── 13. 會友名冊建議 (getMemberSuggestions) ──────────────────
    async getMemberSuggestions(payload = {}) {
      const sb = getSupabase();
      if (!sb) {
        const gasFn = window.churchAPI_original || window.churchAPI;
        if (typeof gasFn === 'function') return await gasFn('getMemberSuggestions', payload);
        return null;
      }

      const { data, error } = await sb
        .from('church_members')
        .select('uid, name, phone, group_name, role')
        .order('name');

      if (error || !data || data.length === 0) {
        const gasFn = window.churchAPI_original || window.churchAPI;
        if (typeof gasFn === 'function') {
          try {
            const gasRes = await gasFn('getMemberSuggestions', payload);
            if (gasRes && gasRes.success) return gasRes;
          } catch (e) {}
        }
        if (error) throw error;
      }

      const list = (data || []).map(m => ({
        uid: m.uid,
        name: m.name,
        phone: m.phone,
        groupName: m.group_name,
        role: m.role || '小羊'
      }));

      return {
        success: true,
        data: list,
        members: list
      };
    },

    // ── 14. 每週統計週報 (getWeeklyReport) ────────────────────────
    async getWeeklyReport(payload = {}) {
      const sb = getSupabase();
      if (!sb) {
        const gasFn = window.churchAPI_original || window.churchAPI;
        if (typeof gasFn === 'function') return await gasFn('getWeeklyReport', payload);
        return null;
      }

      // 計算本週區間 (週一至週日)
      const now = new Date();
      const day = now.getDay();
      const diffToMon = now.getDate() - (day === 0 ? 6 : day - 1);
      const mon = new Date(now.setDate(diffToMon));
      const sun = new Date(mon);
      sun.setDate(mon.getDate() + 6);
      const monStr = mon.toISOString().slice(0, 10);
      const sunStr = sun.toISOString().slice(0, 10);
      const dateRangeStr = `${monStr} ~ ${sunStr}`;

      const [groupsRes, recordsRes] = await Promise.all([
        sb.from('groups').select('*').eq('status', '顯示').order('name'),
        sb.from('group_attendance_records').select('*').gte('date', monStr).lte('date', sunStr)
      ]);

      const groups = groupsRes.data || [];
      const records = recordsRes.data || [];

      // 若 Supabase 本週尚無紀錄，回退至 GAS 讀取
      if (records.length === 0) {
        const gasFn = window.churchAPI_original || window.churchAPI;
        if (typeof gasFn === 'function') {
          try {
            const gasRes = await gasFn('getWeeklyReport', payload);
            if (gasRes && gasRes.success) return gasRes;
          } catch (e) {}
        }
      }

      const recordMap = {};
      records.forEach(r => { recordMap[r.group_name] = r; });

      const reportData = [];
      groups.forEach(g => {
        const r = recordMap[g.name];
        if (r) {
          const list = r.present_uids || r.present_members || [];
          const presentCount = Array.isArray(list) ? list.length : 0;
          const newFriendsCount = Array.isArray(r.new_friends) ? r.new_friends.length : 0;
          reportData.push({
            groupName: g.name,
            groupType: g.group_type || '一般小組',
            total: presentCount + newFriendsCount,
            attendees: presentCount,
            newFriends: newFriendsCount,
            offering: Number(r.offering || 0)
          });
        }
      });

      return {
        success: true,
        data: reportData,
        report: reportData,
        dateRange: dateRangeStr
      };
    }
  };

  // 🎯 自動劫持 / 增強 window.churchAPI
  function setupGroupRouter() {
    if (typeof window.churchAPI === 'function' && !window.churchAPI_original) {
      window.churchAPI_original = window.churchAPI;
      window.churchAPI = async function(action, data = {}) {
        if (GroupSupabaseService[action] && typeof GroupSupabaseService[action] === 'function') {
          try {
            const res = await GroupSupabaseService[action](data);
            if (res !== null) return res;
          } catch (err) {
            console.warn(`[GroupSupabase] Action ${action} local handling error, falling back to GAS:`, err);
          }
        }
        return await window.churchAPI_original(action, data);
      };
    }
  }

  window.GroupSupabaseService = GroupSupabaseService;
  setupGroupRouter();
  window.addEventListener('DOMContentLoaded', setupGroupRouter);
})();
