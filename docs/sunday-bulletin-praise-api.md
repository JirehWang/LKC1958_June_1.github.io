# 讚美歌曲 UUID／日期綁定 API

## 資料責任

- Supabase `sunday_bulletin_praise_titles`：永久歌名索引與 `song_id` UUID，只保存歌名與索引 metadata，不保存歌詞或日期。
- GAS 工作表 `讚美歌曲`：以 `songId` 保存歌詞與歌曲欄位。
- GAS 工作表 `讚美日期綁定`：保存 `date -> songId` 關係；日期不是歌曲本體欄位。

## 對外讀取

讀取不需要 token：

```text
GET {GAS_URL}?action=loadPraiseByDate&date=YYYY-MM-DD
```

成功回應：

```json
{
  "ok": true,
  "success": true,
  "schemaVersion": 2,
  "data": {
    "date": "2026-10-11",
    "songId": "11111111-1111-4111-8111-111111111111",
    "title": "主恩典",
    "lyrics": "第一節歌詞",
    "performanceType": "vocal",
    "kicker": "聖歌隊",
    "tune": "",
    "arrangement": "",
    "performers": ""
  }
}
```

其他唯讀入口：

```text
GET {GAS_URL}?action=loadPraiseSong&songId={UUID}
GET {GAS_URL}?action=listPraiseSongs
```

所有週報與 PPT 對外查詢都應優先使用 `loadPraiseByDate`，由後端先查日期綁定再帶入歌曲本體；不要以歌名或日期 key 直接猜測歌詞資料。

## 管理寫入

寫入使用 `POST`，`Content-Type: text/plain`，避免 GAS 觸發不必要的 preflight。共用 body 格式：

```json
{
  "action": "praise_saveSong",
  "token": "{SHARED_TOKEN}",
  "clientOrigin": "https://jirehwang.github.io",
  "data": {}
}
```

歌曲建立或編輯：

```json
{
  "songId": "{existing UUID or omit for new song}",
  "title": "主恩典",
  "lyrics": "第一節歌詞",
  "performanceType": "vocal",
  "kicker": "聖歌隊",
  "updatedBy": "praise-admin"
}
```

`praise_saveSong` 只處理歌曲本體：依 `songId` 更新同一首歌曲；新歌才產生 UUID。它不接受也不建立日期綁定，因此編輯歌曲時不會意外換掉本日歌曲。

日期關係與刪除：

```text
POST action=praise_bindDate     data={ date, songId, allowReplace }
POST action=praise_unbindDate   data={ date }
POST action=praise_archiveSong  data={ songId }
```

管理頁面的操作分成三個明確動作：

1. 「儲存／更新歌曲」：建立或修改歌曲本體，不變更任何日期。
2. 「指定為本日歌曲」：將目前選取的 UUID 寫入目前日期；若該日期已有另一首歌，先確認後替換。
3. 「清除本日歌曲」：只清除該日期的 `songId`，歌曲本體與歌名索引仍保留。

管理介面的刪除會先二次確認，再將 Supabase 索引軟刪除，並嘗試封存 GAS 歌曲；歌詞資料不做不可復原的硬刪除。清除本日歌曲只清空該日期的 `songId`，不刪歌曲本體。

錯誤回應固定帶有 `ok: false`、`success: false`、`schemaVersion`、`code`、`message`，例如 `PRAISE_DATE_NOT_BOUND`、`PRAISE_SONG_NOT_FOUND`。
