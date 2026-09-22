# 手動聖詩索引同步驗證

日期：2026-09-22（Asia/Taipei）

## 範圍

從禮拜 PPT 編輯器的「同步聖詩索引並載入」按鈕，觸發獨立 Library GAS 重新掃描 Google Drive 聖詩資料夾，將 Supabase `worship_ppt_library_index` 的聖詩 metadata 只做新增／更新 upsert，完成後再載入目前段落的 PPTX。

PPTX binary 不進 Supabase；啟應文段落不觸發這個同步 action；Supabase 已有但本次 Drive 掃描未出現的資料不得刪除。

## SDD：設計契約

- 前端只可送出固定 action `cal_syncPptHymnIndex` 與 `kind=hymn`。
- action 固定送到 `LKC_WORSHIP_PPT_LIBRARY`，不得落到主 GAS。
- GAS 以 `LockService` 避免並行掃描，並以短暫 cooldown 避免 POST/CORS 失敗後 JSONP 重試造成重複寫入。
- Supabase 寫入只包含 `kind`、`number`、`file_id`、`title`、`file_name`、`updated_at`、`updated_by`。
- service role key 只存在 Library GAS Script Properties，不進前端、GitHub Actions 或 Git。
- 每次成功、錯誤或 preserved 計數寫入 GAS 的 `PPT_LIBRARY_SYNC_LOG`。

## DDD：資料責任

| 資料 | 來源／責任 |
| --- | --- |
| Google Drive 檔案 | Library GAS 掃描；仍是 PPTX binary 的唯一來源 |
| Supabase `worship_ppt_library_index` | 只保存索引 metadata，供前端讀取 |
| `PPT_LIBRARY_SYNC_LOG` | GAS 保留同步結果、錯誤與 preserved 計數 |
| `PPT_LIBRARY_SUPABASE_SERVICE_ROLE_KEY` | GAS Script Properties；不得由瀏覽器接觸 |

## BDD：驗收情境

### 正常新增／更新

按下聖詩段落按鈕後，GAS 回傳 `inserted`、`updated`、`unchanged`、`preserved`；Supabase 只出現對應 hymn metadata upsert，按鈕接著載入目前 PPTX。

### 已存在且內容相同

回傳 `unchanged`，不執行多餘 upsert；目前 PPTX 仍可正常載入。

### Drive 缺少某筆舊資料

回傳 `preserved`，不得從 Supabase 刪除該筆。

### GAS 或 Supabase 失效

前端顯示同步失敗，不宣稱 PPT 已載入；GAS log 留下 `ERROR`（若 GAS 能取得設定與寫入紀錄），既有 Supabase 索引不被批次清空。

### POST 被瀏覽器跨來源政策阻擋

前端以同一固定 action 回退 JSONP；GAS cooldown／upsert 保證不因傳輸回退而產生重複資料。

## TDD／驗證證據

- [x] `apps/LKC_WorshipPPT/read-api.test.js`：固定 action、固定 Library GAS endpoint、POST body 契約。
- [x] `apps/LKC_WorshipPPT/ppt-library-integration.test.js`：聖詩段落先呼叫完整 GAS hymn scan。
- [x] 前端語法檢查：`read-api.js`、`ppt-library-integration.js`、`production-editor.js`。
- [x] GAS 語法檢查：`教會行事曆/PptLibrary.js`、`教會行事曆/core.js`。
- [ ] 實際 GAS／Supabase live sync：需先在 Library GAS 設定兩個 Script Properties，再部署後按鈕驗證。

## 部署前設定

在 Library GAS 專案的「專案設定 → Script Properties」建立：

1. `PPT_LIBRARY_SUPABASE_URL` = `https://ioxlptzwpmczsxboggct.supabase.co`
2. `PPT_LIBRARY_SUPABASE_SERVICE_ROLE_KEY` = Supabase service role key（不要貼到對話、前端或 Git）

設定完成後，重新部署 Library GAS Web App，確認匿名使用者仍可呼叫既有讀取 action。首次手動按鈕驗證應確認：

- GAS log 分頁建立為 `PPT_LIBRARY_SYNC_LOG`。
- 新增／更新數量與 Supabase 實際索引一致。
- `preserved` 舊資料沒有被刪除。
- Supabase 沒有新增 PPTX binary 欄位或大型內容。
