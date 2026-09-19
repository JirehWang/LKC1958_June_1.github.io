# GAS ↔ Supabase 年度同步稽核

## 目標

建立一個只讀的年度稽核流程，確認 GAS 與 Supabase 的雙邊資料是否一致；稽核紀錄固定寫入獨立的 Sync Controller GAS／Google Sheets，避免 Supabase 故障時遺失稽核證據。

本變更不執行 Supabase upsert、update、delete，也不直接修改各業務 GAS。SYNC_REPAIR_QUEUE 只保存人工覆核資訊，尚未配置修復 worker。

## SDD：設計契約

- 每次執行先在 GAS 帳本建立一筆 SYNC_RUNS。
- 預設稽核台灣時區最近 365 個含首尾日期。
- 會友名單與小組現況使用全量快照；有日期的資料域使用日期窗。
- 每筆結果寫入 SYNC_ITEMS，至少保存 domain、entity_key、status、兩側 hash、差異路徑與建議。
- GAS 或 Supabase 任一來源無法取得時，狀態必須是 SOURCE_UNAVAILABLE，不得把另一側資料判成 SUPABASE_ONLY 或 GAS_ONLY。
- 讚美詩只比對歌名索引，不比較完整歌詞。

## DDD：資料域與穩定識別鍵

| 資料域 | GAS 來源 | Supabase 表 | 識別鍵 |
| --- | --- | --- | --- |
| church_members | 主日出席 getAllMembers | church_members | uid |
| attendance_records | 主日出席 getAttendanceRecords | attendance_records | service_type + date |
| new_family_cases | 新家人 getTrackingCases / getClosedCases | new_family_cases | form_number |
| groups | 主日出席 getGroups | groups | uuid；缺少時退回 name |
| group_members | 主日出席 getAllGroupMembers | group_members | group_name + uid |
| group_attendance_records | 主日出席 getStats RAW_MODE | group_attendance_records | group_name + date |
| sunday_bulletins | 週報 list / load | sunday_bulletins | date |
| sunday_bulletin_reports | 週報 list / load | sunday_bulletin_reports | date |
| praise_index | 週報 praise_songs key 的 title | sunday_bulletin_praise_titles | title |

## BDD：驗收情境

### GAS 正常、Supabase 正常

預期每個資料域產生 MATCHED、GAS_ONLY、SUPABASE_ONLY、CONTENT_MISMATCH 或 INVALID_IDENTITY；所有結果保存於 GAS 帳本。

### GAS 連線失效

預期資料域產生 SOURCE_UNAVAILABLE；不產生整批 SUPABASE_ONLY，不觸發任何 Supabase 寫入或刪除。

### Supabase 連線失效

預期資料域產生 SOURCE_UNAVAILABLE；不產生整批 GAS_ONLY，不觸發任何 GAS 業務資料寫入。

### 發現差異

預期 SYNC_ITEMS 留存差異，SYNC_REPAIR_QUEUE 留存方向與差異摘要；目前不自動修復。

## TDD／驗證紀錄

- [x] sync-reconciliation-core.test.js：日期窗、canonical hash、差異分類、重複識別與來源失效保護。
- [x] sync-ledger-client.test.js：GAS token、重試、批次、事件與健康查詢。
- [x] reconcile-gas-supabase.test.js：多資料域執行、GAS 帳本寫入、差異佇列與來源失效。
- [x] Node 語法檢查：稽核器、帳本 client、GAS controller。
- [x] GAS Controller 專案建立與 Web App deployment：已建立獨立專案並完成部署。
- [ ] GAS bootstrapSyncLedger()：尚未在實際 GAS 執行，尚待建立 Google Sheet 與 Script Properties。
- [ ] GAS Web App anonymous access／Sheet 權限：尚未完成 live health check。
- [ ] GitHub Actions live run：需設定 repository secrets 後執行。

## 必要設定

Sync Controller GAS：

- 執行 `bootstrapSyncLedger()` 後由 GAS 自動建立，不需手動猜 ID。
- 若採手動方式，才需要設定 `SYNC_LEDGER_SPREADSHEET_ID`。
- `SYNC_LEDGER_TOKEN` 對應 GAS 回傳的 token；GitHub 使用同值放在 `SYNC_LEDGER_GAS_TOKEN`。

GitHub Actions secrets：

- SYNC_LEDGER_GAS_TOKEN
- SUNDAY_ATTENDANCE_GAS_URL
- SUNDAY_ATTENDANCE_GAS_TOKEN
- NEW_FAMILY_GAS_URL
- NEW_FAMILY_GAS_TOKEN
- BULLETIN_GAS_URL
- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY
- GROUP_ADMIN_CODE

正式啟用前，在 Sync Controller GAS 執行 `bootstrapSyncLedger()`，確認建立的 Sheet
與 Web App 可存取，再設定 GitHub repository secrets 並手動執行一次 Workflow。
