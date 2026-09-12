'use strict';

/**
 * sync_church_members_gas_to_supabase.js
 * 
 * 將 Google Sheets (GAS 主日出席大名單) 中的會友資料（包含系統編號、姓名、性別、所屬小組、身分、狀態等）
 * 全量比對並同步至 Supabase hot layer 的 church_members 資料表。
 * 
 * 修正歷史問題：先前匯入時誤將「身分」欄位（小羊、核心同工等）填入 group_name，
 * 本腳本以 GAS 單一真實來源 (Single Source of Truth) 全量對齊 group_name 與 role。
 */

const { createClient } = require('@supabase/supabase-js');
const { SUPABASE_URL, SUPABASE_ANON_KEY } = require('../supabase/supabase-config.js');

const GAS_URL = 'https://script.google.com/macros/s/AKfycbxBOFeLiXu23kBMGU8iSvRyJci6fruTfk7HdahhcQFY777sCPSgasuNM7Z1CeuzuS-r/exec';
const GAS_TOKEN = 'ChurchApp-2026';

async function fetchGasMembers() {
  console.log('📡 正在從 GAS 讀取最新會友名單 (getAllMembers)...');
  const res = await fetch(GAS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'getAllMembers', token: GAS_TOKEN })
  });
  if (!res.ok) throw new Error(`GAS HTTP 錯誤: ${res.status}`);
  const data = await res.json();
  const members = Array.isArray(data) ? data : (data.data || []);
  console.log(`✅ 成功從 GAS 取得 ${members.length} 位會友資料`);
  return members;
}

async function syncMembers() {
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const gasMembers = await fetchGasMembers();

  console.log('📡 正在從 Supabase 讀取目前 church_members 資料...');
  const { data: sbMembers, error } = await sb.from('church_members').select('*');
  if (error) throw error;
  console.log(`✅ Supabase 現有 ${sbMembers.length} 筆會友紀錄`);

  const sbMap = new Map();
  sbMembers.forEach(m => sbMap.set(m.uid, m));

  let updatedCount = 0;
  let insertedCount = 0;
  let unchangedCount = 0;
  const errors = [];

  const BATCH_SIZE = 25;
  for (let i = 0; i < gasMembers.length; i += BATCH_SIZE) {
    const chunk = gasMembers.slice(i, i + BATCH_SIZE);
    await Promise.all(chunk.map(async (gm) => {
      const name = String(gm[0] || '').trim();
      const gender = String(gm[1] || '').trim();
      const note = String(gm[3] || '').trim();
      const isExcluded = (gm[4] === true || gm[4] === 'TRUE');
      const uid = String(gm[7] || '').trim();
      const groupName = String(gm[8] || '').trim();
      const role = String(gm[9] || '小羊').trim();

      if (!uid || !name) return;

      const existing = sbMap.get(uid);
      if (!existing) {
        // 新增
        const insertRow = {
          uid,
          name,
          gender: gender || '男',
          group_name: groupName,
          role: role,
          is_excluded: isExcluded,
          metadata: { note: note },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
        const { error: insErr } = await sb.from('church_members').insert(insertRow);
        if (insErr) {
          errors.push(`[INSERT FAIL] ${uid} ${name}: ${insErr.message}`);
        } else {
          insertedCount++;
        }
      } else {
        // 檢查是否有欄位需要更新 (group_name, role, is_excluded, gender, note)
        const curGroup = String(existing.group_name || '').trim();
        const curRole = String(existing.role || '小羊').trim();
        const curGender = String(existing.gender || '').trim();
        const curExcluded = Boolean(existing.is_excluded);
        const curNote = (existing.metadata && existing.metadata.note) || '';

        const needsUpdate = (
          curGroup !== groupName ||
          curRole !== role ||
          curGender !== gender ||
          curExcluded !== isExcluded ||
          curNote !== note
        );

        if (needsUpdate) {
          const updatePayload = {
            name,
            gender: gender || curGender,
            group_name: groupName,
            role: role,
            is_excluded: isExcluded,
            metadata: { ...(existing.metadata || {}), note: note },
            updated_at: new Date().toISOString()
          };
          const { error: updErr } = await sb
            .from('church_members')
            .update(updatePayload)
            .eq('uid', uid);
          if (updErr) {
            errors.push(`[UPDATE FAIL] ${uid} ${name}: ${updErr.message}`);
          } else {
            updatedCount++;
          }
        } else {
          unchangedCount++;
        }
      }
    }));
    process.stdout.write(`⏳ 已處理 ${Math.min(i + BATCH_SIZE, gasMembers.length)} / ${gasMembers.length} 筆...\r`);
  }

  console.log('\n=======================================');
  console.log('🎉 Supabase church_members 同步完成！');
  console.log(`- 🔄 欄位修正更新: ${updatedCount} 筆`);
  console.log(`- ➕ 補增新會友: ${insertedCount} 筆`);
  console.log(`- 保持一致未更動: ${unchangedCount} 筆`);
  if (errors.length > 0) {
    console.error(`- ❌ 失敗: ${errors.length} 筆:\n` + errors.join('\n'));
  }
  console.log('=======================================');
}

if (require.main === module) {
  syncMembers().catch(err => {
    console.error('Fatal sync error:', err);
    process.exit(1);
  });
}

module.exports = { syncMembers, fetchGasMembers };
