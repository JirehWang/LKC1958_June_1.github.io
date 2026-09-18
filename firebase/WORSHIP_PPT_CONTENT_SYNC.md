# 禮拜PPT產生器 Firebase 內容同步契約（目前停用）

目前 WorshipPPT 主流程直接讀取 Supabase 與既有 GAS API，不再把行事曆、週報或 PPT Library binary 鏡像到 Firebase。以下內容路徑保留作為歷史／未來離線快照契約，並非目前必要部署項目。

## RTDB 路徑

所有內容位於 `worshipPpt/content`：

- `services/{YYYY-MM-DD}/calendar`：`cal_getEvents` 的完整回應，例如 `{ "success": true, "data": [...] }`
- `services/{YYYY-MM-DD}/reports`：週報 `reports_YYYY-MM-DD` 的資料物件
- `services/{YYYY-MM-DD}/praise`：讚美 `praise_songs_YYYY-MM-DD` 的資料物件
- `library/index`：歷史 Firebase 快照契約；目前 PPT Library 索引改存 Supabase `worship_ppt_library_index`
- `bible/{version}/{book}/{chapter}/{verses}`：`cal_queryBible` 的完整回應，例如 `{ "success": true, "records": [...] }`

`verses` 使用查詢值（例如 `1-2`）；整章使用 `_all`。Firebase key 不允許的 `. # $ / [ ]` 與控制字元須替換為 `_`。

## PPTX 檔案路由（目前實際規則）

PPTX 二進位檔不放入 Supabase 或 Firebase。Supabase 索引只保存 `fileId`、`kind`、`number`、`title`、`fileName`；前端命中索引後呼叫 Library GAS bridge 的 `cal_getPptLibraryFile({ fileId })`，由 GAS 從 Google Drive PPTX 資料庫讀取並回傳 Base64。

Supabase 沒有索引資料時，前端才呼叫 `cal_getPptLibraryIndex` 作為索引備援；瀏覽器不直接讀 Storage／Drive URL。

## 權限與部署

- RTDB `worshipPpt/content`：公開唯讀、瀏覽器禁止寫入。
- PPT Library Supabase index：公開唯讀；由受控 migration／同步程序管理寫入。
- Library GAS 應以既有 Google Drive 權限讀取原始 PPTX，瀏覽器不取得 Drive 檔案清單或直接下載權限。
- 部署規則時必須把範本合併進目前正式規則，不可覆蓋既有 `cache`、`logs` 等節點。

## 目前實際盤點（2026-08-02）

- 已有：`worshipPpt/layoutConfig/shared` 的版面群組與頁面歸屬。
- `worshipPpt/content` 目前沒有內容，且主流程不依賴它。
- 行事曆與週報由 WorshipPPT 直接連接既有唯讀 API。
- `cache/cal_getEvents` 是另一套短期 API 快取，不是 WorshipPPT 內容鏡像。
- 正式 layoutState 尚未看到 `hymnOpacityBySection` 與 `outputScale`；規則範本已補上這兩種欄位的驗證。
