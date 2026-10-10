/**
 * PraiseSongs.js
 *
 * 歌曲本體與日期綁定分離：
 *   讚美歌曲：songId -> 歌名、歌詞與其他資訊
 *   讚美日期綁定：date -> songId
 *
 * 對外讀取入口：
 *   GET  action=loadPraiseByDate&date=YYYY-MM-DD
 *   GET  action=loadPraiseSong&songId=<uuid>
 *   GET  action=listPraiseSongs
 *
 * 管理寫入入口（需 SECRET_TOKEN）：
 *   POST action=praise_saveSong
 *   POST action=praise_bindDate
 *   POST action=praise_unbindDate
 *   POST action=praise_archiveSong
 */

const PRAISE_SONG_SHEET_NAME = '讚美歌曲';
const PRAISE_BINDING_SHEET_NAME = '讚美日期綁定';
const PRAISE_SONG_HEADERS = [
  'songId', 'title', 'lyrics', 'performanceType', 'kicker',
  'tune', 'arrangement', 'performers', 'deletedAt', 'updatedAt', 'updatedBy'
];
const PRAISE_BINDING_HEADERS = ['date', 'songId', 'status', 'updatedAt', 'updatedBy'];
const PRAISE_API_SCHEMA_VERSION = 2;

function praiseClean_(value) {
  return String(value == null ? '' : value).trim();
}

function praiseDate_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone() || 'Asia/Taipei', 'yyyy-MM-dd');
  }
  const date = praiseClean_(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '';
}

function praiseUuid_(value) {
  const uuid = praiseClean_(value);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid)
    ? uuid
    : '';
}

function praiseSheet_(name, headers, create) {
  const ss = getSS();
  let sheet = ss.getSheetByName(name);
  if (!sheet && create) sheet = ss.insertSheet(name);
  if (!sheet) return null;

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else {
    const actual = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), headers.length)).getValues()[0]
      .map(praiseClean_);
    const missing = headers.some((header, index) => actual[index] !== header);
    if (missing) throw new Error('讚美資料表欄位不符合預期：' + name);
  }
  return sheet;
}

function praiseRows_(sheet, headers) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
  return values.map((row, index) => {
    const item = { _row: index + 2 };
    headers.forEach((header, column) => { item[header] = row[column]; });
    return item;
  });
}

function praiseSongObject_(row) {
  if (!row) return null;
  return {
    songId: praiseClean_(row.songId),
    title: praiseClean_(row.title),
    lyrics: String(row.lyrics == null ? '' : row.lyrics),
    performanceType: praiseClean_(row.performanceType) === 'instrumental' ? 'instrumental' : 'vocal',
    kicker: praiseClean_(row.kicker),
    tune: praiseClean_(row.tune),
    arrangement: praiseClean_(row.arrangement),
    performers: String(row.performers == null ? '' : row.performers),
    deletedAt: row.deletedAt ? String(row.deletedAt) : '',
    updatedAt: row.updatedAt ? String(row.updatedAt) : '',
    updatedBy: praiseClean_(row.updatedBy)
  };
}

function praiseBindingObject_(row) {
  if (!row) return null;
  return {
    date: praiseDate_(row.date),
    songId: praiseClean_(row.songId),
    status: praiseClean_(row.status) || 'active',
    updatedAt: row.updatedAt ? String(row.updatedAt) : '',
    updatedBy: praiseClean_(row.updatedBy)
  };
}

function praiseFindSongRow_(songId, includeDeleted) {
  const sheet = praiseSheet_(PRAISE_SONG_SHEET_NAME, PRAISE_SONG_HEADERS, false);
  const row = praiseRows_(sheet, PRAISE_SONG_HEADERS)
    .find(item => praiseClean_(item.songId) === praiseClean_(songId));
  if (!row || (!includeDeleted && praiseClean_(row.deletedAt))) return null;
  return row;
}

function praiseFindBindingRow_(date) {
  const sheet = praiseSheet_(PRAISE_BINDING_SHEET_NAME, PRAISE_BINDING_HEADERS, false);
  return praiseRows_(sheet, PRAISE_BINDING_HEADERS)
    .find(item => praiseDate_(item.date) === praiseDate_(date));
}

function praiseWriteRow_(sheet, rowNumber, headers, object) {
  const values = headers.map(header => object[header] == null ? '' : object[header]);
  if (rowNumber) {
    sheet.getRange(rowNumber, 1, 1, headers.length).setValues([values]);
  } else {
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, headers.length).setValues([values]);
  }
}

function praiseSaveSong_(data) {
  const payload = data || {};
  const title = praiseClean_(payload.title);
  if (!title) throw new Error('缺少歌曲名稱');

  const now = new Date().toISOString();
  const existing = payload.songId ? praiseFindSongRow_(payload.songId, true) : null;
  const songId = praiseUuid_(payload.songId) || (existing && praiseClean_(existing.songId)) || Utilities.getUuid();
  const sheet = praiseSheet_(PRAISE_SONG_SHEET_NAME, PRAISE_SONG_HEADERS, true);
  const row = {
    songId,
    title,
    lyrics: String(payload.lyrics == null ? '' : payload.lyrics),
    performanceType: payload.performanceType === 'instrumental' ? 'instrumental' : 'vocal',
    kicker: praiseClean_(payload.kicker),
    tune: praiseClean_(payload.tune),
    arrangement: praiseClean_(payload.arrangement),
    performers: String(payload.performers == null ? '' : payload.performers),
    deletedAt: existing ? (existing.deletedAt || '') : '',
    updatedAt: now,
    updatedBy: praiseClean_(payload.updatedBy) || 'praise-admin'
  };
  praiseWriteRow_(sheet, existing && existing._row, PRAISE_SONG_HEADERS, row);

  // 歌曲本體不保存日期；日期與歌曲的關係必須由 praise_bindDate_ 明確建立。
  return { song: praiseSongObject_(row) };
}

function praiseListSongs_() {
  const sheet = praiseSheet_(PRAISE_SONG_SHEET_NAME, PRAISE_SONG_HEADERS, false);
  return praiseRows_(sheet, PRAISE_SONG_HEADERS)
    .filter(row => !praiseClean_(row.deletedAt) && praiseClean_(row.title))
    .map(praiseSongObject_)
    .sort((left, right) => left.title.localeCompare(right.title, 'zh-Hant'));
}

function praiseLoadSong_(songId) {
  const row = praiseFindSongRow_(songId, true);
  if (!row) throw new Error('找不到歌曲 UUID：' + praiseClean_(songId));
  return praiseSongObject_(row);
}

function praiseBindDate_(date, songId, options) {
  const cleanDate = praiseDate_(date);
  const cleanSongId = praiseUuid_(songId);
  if (!cleanDate) throw new Error('日期格式錯誤，必須為 YYYY-MM-DD');
  if (!cleanSongId) throw new Error('歌曲 UUID 格式錯誤');

  const song = praiseFindSongRow_(cleanSongId, false);
  if (!song) throw new Error('找不到可綁定的有效歌曲 UUID：' + cleanSongId);

  const sheet = praiseSheet_(PRAISE_BINDING_SHEET_NAME, PRAISE_BINDING_HEADERS, true);
  const existing = praiseFindBindingRow_(cleanDate);
  const currentSongId = existing && praiseClean_(existing.songId);
  const allowReplace = !options || options.allowReplace !== false;
  if (existing && praiseClean_(existing.status) === 'active' && currentSongId !== cleanSongId && !allowReplace) {
    throw new Error('此日期已綁定其他歌曲');
  }

  const row = {
    date: cleanDate,
    songId: cleanSongId,
    status: 'active',
    updatedAt: new Date().toISOString(),
    updatedBy: praiseClean_(options && options.updatedBy) || 'praise-admin'
  };
  praiseWriteRow_(sheet, existing && existing._row, PRAISE_BINDING_HEADERS, row);
  return { ...praiseBindingObject_(row), previousSongId: currentSongId || '' };
}

function praiseUnbindDate_(date, updatedBy) {
  const cleanDate = praiseDate_(date);
  if (!cleanDate) throw new Error('日期格式錯誤，必須為 YYYY-MM-DD');
  const sheet = praiseSheet_(PRAISE_BINDING_SHEET_NAME, PRAISE_BINDING_HEADERS, false);
  const existing = praiseFindBindingRow_(cleanDate);
  if (!sheet || !existing) {
    return { date: cleanDate, status: 'inactive', songId: '' };
  }
  const row = {
    date: cleanDate,
    songId: '',
    status: 'inactive',
    updatedAt: new Date().toISOString(),
    updatedBy: praiseClean_(updatedBy) || 'praise-admin'
  };
  praiseWriteRow_(sheet, existing._row, PRAISE_BINDING_HEADERS, row);
  return praiseBindingObject_(row);
}

function praiseLoadByDate_(date) {
  const cleanDate = praiseDate_(date);
  if (!cleanDate) throw new Error('日期格式錯誤，必須為 YYYY-MM-DD');
  const binding = praiseFindBindingRow_(cleanDate);
  if (!binding || praiseClean_(binding.status) !== 'active') {
    const error = new Error('此日期尚未綁定讚美歌曲');
    error.code = 'PRAISE_DATE_NOT_BOUND';
    throw error;
  }
  const song = praiseFindSongRow_(binding.songId, true);
  if (!song) {
    const error = new Error('日期綁定的歌曲不存在');
    error.code = 'PRAISE_SONG_NOT_FOUND';
    throw error;
  }
  if (praiseClean_(song.deletedAt)) {
    const error = new Error('日期綁定的歌曲已封存');
    error.code = 'PRAISE_SONG_ARCHIVED';
    throw error;
  }
  return {
    date: cleanDate,
    songId: praiseClean_(song.songId),
    title: praiseClean_(song.title),
    lyrics: String(song.lyrics == null ? '' : song.lyrics),
    performanceType: praiseClean_(song.performanceType) === 'instrumental' ? 'instrumental' : 'vocal',
    kicker: praiseClean_(song.kicker),
    tune: praiseClean_(song.tune),
    arrangement: praiseClean_(song.arrangement),
    performers: String(song.performers == null ? '' : song.performers),
    songDeletedAt: song.deletedAt ? String(song.deletedAt) : '',
    songUpdatedAt: song.updatedAt ? String(song.updatedAt) : '',
    bindingUpdatedAt: binding.updatedAt ? String(binding.updatedAt) : ''
  };
}

function praiseArchiveSong_(songId, updatedBy) {
  const sheet = praiseSheet_(PRAISE_SONG_SHEET_NAME, PRAISE_SONG_HEADERS, false);
  const existing = praiseFindSongRow_(songId, true);
  if (!sheet || !existing) throw new Error('找不到要刪除的歌曲 UUID：' + praiseClean_(songId));
  const now = new Date().toISOString();
  const row = { ...existing, deletedAt: existing.deletedAt || now, updatedAt: now, updatedBy: praiseClean_(updatedBy) || 'praise-admin' };
  praiseWriteRow_(sheet, existing._row, PRAISE_SONG_HEADERS, row);
  return praiseSongObject_(row);
}

function praiseOk_(data) {
  return { ok: true, success: true, schemaVersion: PRAISE_API_SCHEMA_VERSION, data: data == null ? null : data };
}

function praiseError_(code, message) {
  return {
    ok: false,
    success: false,
    schemaVersion: PRAISE_API_SCHEMA_VERSION,
    code: code || 'PRAISE_ERROR',
    message: message || '讚美資料服務發生錯誤',
    data: null
  };
}

function praiseActionIsRead_(action) {
  return action === 'praise_loadByDate'
    || action === 'praise_loadSong'
    || action === 'praise_listSongs';
}

function praiseHandleRequest_(body) {
  const request = body || {};
  const action = praiseClean_(request.action);
  const data = request.data || request.payload || {};
  if (!praiseActionIsRead_(action) && request.token !== SECRET_TOKEN) {
    return praiseError_('UNAUTHORIZED', '讚美資料寫入需要有效授權');
  }

  try {
    switch (action) {
      case 'praise_loadByDate': return praiseOk_(praiseLoadByDate_(data.date));
      case 'praise_loadSong': return praiseOk_(praiseLoadSong_(data.songId));
      case 'praise_listSongs': return praiseOk_(praiseListSongs_());
      case 'praise_saveSong': return praiseOk_(praiseSaveSong_(data));
      case 'praise_bindDate': return praiseOk_(praiseBindDate_(data.date, data.songId, data));
      case 'praise_unbindDate': return praiseOk_(praiseUnbindDate_(data.date, data.updatedBy));
      case 'praise_archiveSong': return praiseOk_(praiseArchiveSong_(data.songId, data.updatedBy));
      default: return praiseError_('UNKNOWN_ACTION', '未知讚美資料操作：' + action);
    }
  } catch (error) {
    return praiseError_(error.code || 'PRAISE_ERROR', error.message || String(error));
  }
}

function praiseJson_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function praiseHandleGet_(e) {
  const action = praiseClean_(e && e.parameter && e.parameter.action);
  const params = e && e.parameter ? e.parameter : {};
  const actionMap = {
    loadPraiseByDate: 'praise_loadByDate',
    loadPraiseSong: 'praise_loadSong',
    listPraiseSongs: 'praise_listSongs'
  };
  const normalizedAction = actionMap[action] || action;
  return praiseJson_(praiseHandleRequest_({
    action: normalizedAction,
    data: { date: params.date, songId: params.songId }
  }));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    praiseDate_,
    praiseUuid_,
    praiseOk_,
    praiseError_,
    praiseActionIsRead_,
    praiseSaveSong_,
    praiseListSongs_,
    praiseLoadSong_,
    praiseBindDate_,
    praiseUnbindDate_,
    praiseLoadByDate_,
    praiseArchiveSong_
  };
}
