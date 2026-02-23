/**core.gs**/
/**
 * 全域變數設定
 */
const SPREADSHEET_ID = '1tS_RSufp4Y1F1G84oUxzXCp4g5S5bg8dODzGwi3O_wE';
const MEMBER_SHEET = '會友名單';

/**
 * 網頁應用程式進入點 (必備)
 */
function doGet(e) {
  var template = HtmlService.createTemplateFromFile('index');
  return template.evaluate()
    .setTitle('教會管理系統')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * 用於在 index.html 中引入其他 HTML 檔案 (如 attendance, members, STATS)
 */
function include(filename) {
  try {
    return HtmlService.createHtmlOutputFromFile(filename).getContent();
  } catch (err) {
    return '';
  }
}

/**
 * 取得試算表實例 (供其他模組呼叫)
 */
function getSS() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

