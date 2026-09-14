# ⛪ 教會主日出席系統

從 Google Apps Script 遷移至 GitHub Pages 的靜態前端。

## 📁 專案結構

```
church-attendance/
├── index.html          # 主頁面（導覽選單）
├── card.html           # 公開個人卡片分享頁（由分享 QR Code 開啟）
├── config.js           # ⚠️ 設定檔（填入你的 GAS URL）
├── list-scroll-anchor.js # 篩選或刷新後維持目前名單位置
├── js/
│   └── api.js          # GAS API 橋接層
└── pages/
    ├── attendance.html # 點名系統
    ├── members.html    # 會友名單管理
    ├── STATS.html      # 出席統計查詢
    └── Chart.html      # 趨勢分析圖表
```

## 🚀 部署步驟

### 1. 設定 GAS Web App URL

打開 `config.js`，將 `YOUR_SCRIPT_ID` 替換為你的 GAS 部署網址：

```javascript
window.GAS_CONFIG = {
  apiUrl: 'https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec',
};
```

**取得方式：**
- GAS 編輯器 → 右上角「部署」→「管理部署」→ 複製「網路應用程式」URL

### 2. 確認 GAS 後端有 doPost 入口

GAS 後端需要一個統一的 `doPost` 函式作為 API 路由入口，格式如下：

```javascript
function doPost(e) {
  const body = JSON.parse(e.postData.contents);
  const action = body.action;
  const payload = body.payload;

  const result = (function() {
    switch (action) {
      case 'getAllMembers':            return getAllMembers();
      case 'getMemberManagementData':  return getMemberManagementData();
      case 'updateMember':      return updateMember(payload[0], payload[1]);
      case 'deleteMember':      return deleteMember(payload);
      case 'addMember':         return addMember(payload);
      case 'getGroupConfig':    return getGroupConfig();
      case 'getSmartAttendanceList': return getSmartAttendanceList(payload[0], payload[1]);
      case 'syncClickToServer': return syncClickToServer(payload[0], payload[1], payload[2], payload[3]);
      case 'saveAttendance':    return saveAttendance(payload[0], payload[1], payload[2], payload[3], payload[4]);
      case 'revokeAttendance':  return revokeAttendance(payload[0], payload[1], payload[2]);
      case 'createAttendanceGroup': return createAttendanceGroup(payload[0], payload[1]);
      case 'updateDeviceMode':  return updateDeviceMode(payload[0], payload[1]);
      case 'getQuickSyncData':  return getQuickSyncData(payload[0], payload[1]);
      case 'getAttendanceStats': return getAttendanceStats(payload);
      case 'getCategoryChartData': return getCategoryChartData(payload[0], payload[1], payload[2]);
      case 'previewMemberCard': return previewMemberCard(payload);
      case 'generateMemberCard': return generateMemberCard(payload);
      case 'getMemberCardShareLink': return getMemberCardShareLink(payload);
      case 'getMemberCardByShareToken': return getMemberCardByShareToken(payload);
      default: throw new Error('Unknown action: ' + action);
    }
  })();

  return ContentService
    .createTextOutput(JSON.stringify({ data: result }))
    .setMimeType(ContentService.MimeType.JSON);
}
```

會友管理頁使用 `getMemberManagementData` 取得名單與 UID 使用狀態。若代碼曾被主日點名（不含小組點名），或仍存在小組成員名單（含主檔小組欄位），前端會標示「有效」並停用刪除；`deleteMember` 後端也會重新檢查並拒絕刪除，只允許將會友改成「不統計」。

### 個人卡片分享

在會員管理的「顯示 QR / 卡片」視窗切換至「分享卡片 QR」後，前端呼叫 `getMemberCardShareLink` 取得不可猜測的分享碼，並將 `card.html?share=...` 產生為 QR Code。對方掃描後由 `card.html` 呼叫 `getMemberCardByShareToken`，取得目前名單對應的卡片預覽並下載 JPG。

分享碼儲存在 GAS Script Properties，網址不直接放 UID；分享頁也只接受已簽發的分享碼，不提供以 UID 或姓名查詢卡片的公開 API。會友資料更新後，同一分享連結會顯示最新姓名與卡片內容；會友不存在時連結失效。手機下載會先使用裝置的分享／儲存功能；若瀏覽器不支援，則開啟圖片供使用者長按儲存。

### 3. 部署到 GitHub Pages

```bash
git init
git add .
git commit -m "init: migrate from GAS"
git remote add origin https://github.com/YOUR_USERNAME/church-attendance.git
git push -u origin main
```

在 GitHub Repository Settings → Pages → Source 選 `main` branch。

### 4. 本地測試

```bash
# Python 3
python -m http.server 8000
# 開啟 http://localhost:8000
```

## ⚠️ 注意事項

- `config.js` 中的 GAS URL 是明文，不要把敏感資料放在前端
- GAS Web App 部署時「存取權限」需設為「任何人」才能跨域呼叫
- 子頁面採用動態載入（fetch pages/*.html），需要透過 HTTP 伺服器訪問，不能直接雙擊開啟 index.html
