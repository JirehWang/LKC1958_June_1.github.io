/**
 * ============================================================
 *  Hierarchy.js — 牧區 / 小組群正式資料模型
 * ============================================================
 */

var _HIERARCHY_SHEETS = {
  DISTRICTS: 'Districts',
  CLUSTERS: 'GroupClusters'
};

var _DISTRICT_HEADERS = ['uuid', 'name', 'status', 'created_at', 'updated_at'];
var _CLUSTER_HEADERS = ['uuid', 'name', 'district_uuid', 'status', 'created_at', 'updated_at'];

function initHierarchySheets() {
  var groupsSheet = getGroupSheet('小組清單');
  if (!groupsSheet) {
    Logger.log('❌ 找不到 小組清單 工作表');
    return;
  }

  if (typeof _ensureGroupListSchema === 'function') {
    _ensureGroupListSchema(groupsSheet);
  }

  _ensureGroupColumn(groupsSheet, 'district');
  _ensureGroupColumn(groupsSheet, 'cluster');
  _ensureGroupColumn(groupsSheet, 'district_uuid');
  _ensureGroupColumn(groupsSheet, 'cluster_uuid');

  var ss = getGroupSS();
  var districtsSheet = _ensureEntitySheet(ss, _HIERARCHY_SHEETS.DISTRICTS, _DISTRICT_HEADERS);
  var clustersSheet = _ensureEntitySheet(ss, _HIERARCHY_SHEETS.CLUSTERS, _CLUSTER_HEADERS);

  _syncHierarchyRecords(groupsSheet, districtsSheet, clustersSheet);
}

function _trim(value) {
  return String(value || '').trim();
}

function _nowIsoString() {
  return new Date().toISOString();
}

function _looksLikeUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(_trim(value));
}

function _ensureGroupColumn(sheet, colName) {
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  if (headers.indexOf(colName) !== -1) return;
  var nextCol = sheet.getLastColumn() + 1;
  sheet.getRange(1, nextCol).setValue(colName).setFontWeight('bold');
}

function _ensureEntitySheet(ss, sheetName, headers) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) sheet = ss.insertSheet(sheetName);
  _ensureHeaders(sheet, headers);
  return sheet;
}

function _ensureHeaders(sheet, headers) {
  var width = headers.length;
  var current = [];
  if (sheet.getLastColumn() > 0) {
    current = sheet.getRange(1, 1, 1, Math.min(sheet.getLastColumn(), width)).getValues()[0];
  }
  for (var i = 0; i < headers.length; i++) {
    if (_trim(current[i]) !== headers[i]) {
      sheet.getRange(1, i + 1).setValue(headers[i]).setFontWeight('bold');
    }
  }
}

function _getSheetRows(sheet) {
  if (!sheet) return [];
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];
  var lastCol = sheet.getLastColumn();
  var data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var fieldAliases = {
    '名稱': 'name',
    '狀態': 'status',
    '代碼': 'code',
    '建立日期': 'date',
    'UUID': 'uuid',
    '類型': 'type',
    '關聯常設小組': 'associatedGroup'
  };
  return data.map(function(row, rowIndex) {
    var obj = { _rowIndex: rowIndex + 2 };
    headers.forEach(function(h, idx) {
      obj[h] = row[idx];
      if (fieldAliases[h]) obj[fieldAliases[h]] = row[idx];
    });
    return obj;
  });
}

function _getSheetHeaders(sheet) {
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
}

function _getColIndex(sheet, colName) {
  var headers = _getSheetHeaders(sheet);
  var idx = headers.indexOf(colName);
  return idx === -1 ? -1 : idx + 1;
}

function _findRowByUuid(rows, uuid) {
  var target = _trim(uuid);
  for (var i = 0; i < rows.length; i++) {
    if (_trim(rows[i].uuid) === target) return i;
  }
  return -1;
}

function _readEntityRows(sheet) {
  return _getSheetRows(sheet).map(function(row) {
    return {
      _rowIndex: row._rowIndex,
      uuid: _trim(row.uuid),
      name: _trim(row.name),
      district_uuid: _trim(row.district_uuid),
      status: _trim(row.status) || 'active',
      created_at: row.created_at || '',
      updated_at: row.updated_at || ''
    };
  });
}

function _indexEntityRows(rows) {
  var byUuid = {};
  var byName = {};
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    if (row.uuid) byUuid[row.uuid] = row;
    if (row.name) byName[row.name] = row;
  }
  return { byUuid: byUuid, byName: byName };
}

function _appendEntityRow(sheet, headers, payload) {
  var row = headers.map(function(header) {
    return payload[header] !== undefined ? payload[header] : '';
  });
  sheet.appendRow(row);
  var inserted = {
    _rowIndex: sheet.getLastRow()
  };
  headers.forEach(function(header) {
    inserted[header] = payload[header] !== undefined ? payload[header] : '';
  });
  return inserted;
}

function _updateEntityField(sheet, row, fieldName, value) {
  var col = _getColIndex(sheet, fieldName);
  if (col <= 0) return;
  var nextValue = value !== undefined && value !== null ? value : '';
  if (String(row[fieldName] || '') === String(nextValue || '')) return;
  sheet.getRange(row._rowIndex, col).setValue(nextValue);
  row[fieldName] = nextValue;
}

function _ensureDistrictRecord(districtsSheet, districtRows, districtIndex, districtUuid, districtName) {
  var cleanUuid = _trim(districtUuid);
  var cleanName = _trim(districtName);
  var row = null;

  if (cleanUuid && districtIndex.byUuid[cleanUuid]) {
    row = districtIndex.byUuid[cleanUuid];
  } else if (cleanName && districtIndex.byName[cleanName]) {
    row = districtIndex.byName[cleanName];
  }

  if (!row) {
    row = _appendEntityRow(districtsSheet, _DISTRICT_HEADERS, {
      uuid: cleanUuid || Utilities.getUuid(),
      name: cleanName || cleanUuid,
      status: 'active',
      created_at: _nowIsoString(),
      updated_at: _nowIsoString()
    });
    districtRows.push(row);
    districtIndex.byUuid[row.uuid] = row;
    districtIndex.byName[row.name] = row;
    return row;
  }

  if (!_looksLikeUuid(row.uuid)) {
    if (row.uuid && districtIndex.byUuid[row.uuid] === row) delete districtIndex.byUuid[row.uuid];
    _updateEntityField(districtsSheet, row, 'uuid', Utilities.getUuid());
    districtIndex.byUuid[row.uuid] = row;
  }
  if (cleanName && row.name !== cleanName) {
    if (row.name) delete districtIndex.byName[row.name];
    _updateEntityField(districtsSheet, row, 'name', cleanName);
    districtIndex.byName[cleanName] = row;
  }
  _updateEntityField(districtsSheet, row, 'status', row.status || 'active');
  _updateEntityField(districtsSheet, row, 'updated_at', _nowIsoString());
  return row;
}

function _ensureClusterRecord(clustersSheet, clusterRows, clusterIndex, clusterUuid, clusterName, districtUuid) {
  var cleanUuid = _trim(clusterUuid);
  var cleanName = _trim(clusterName);
  var cleanDistrictUuid = _trim(districtUuid);
  var row = null;

  if (cleanUuid && clusterIndex.byUuid[cleanUuid]) {
    row = clusterIndex.byUuid[cleanUuid];
  } else if (cleanName && clusterIndex.byName[cleanName]) {
    row = clusterIndex.byName[cleanName];
  }

  if (!row) {
    row = _appendEntityRow(clustersSheet, _CLUSTER_HEADERS, {
      uuid: cleanUuid || Utilities.getUuid(),
      name: cleanName || cleanUuid,
      district_uuid: cleanDistrictUuid,
      status: 'active',
      created_at: _nowIsoString(),
      updated_at: _nowIsoString()
    });
    clusterRows.push(row);
    clusterIndex.byUuid[row.uuid] = row;
    clusterIndex.byName[row.name] = row;
    return row;
  }

  if (!_looksLikeUuid(row.uuid)) {
    if (row.uuid && clusterIndex.byUuid[row.uuid] === row) delete clusterIndex.byUuid[row.uuid];
    _updateEntityField(clustersSheet, row, 'uuid', Utilities.getUuid());
    clusterIndex.byUuid[row.uuid] = row;
  }
  if (cleanName && row.name !== cleanName) {
    if (row.name) delete clusterIndex.byName[row.name];
    _updateEntityField(clustersSheet, row, 'name', cleanName);
    clusterIndex.byName[cleanName] = row;
  }
  if (cleanDistrictUuid !== row.district_uuid) {
    _updateEntityField(clustersSheet, row, 'district_uuid', cleanDistrictUuid);
  }
  _updateEntityField(clustersSheet, row, 'status', row.status || 'active');
  _updateEntityField(clustersSheet, row, 'updated_at', _nowIsoString());
  return row;
}

function _getHierarchyRefs() {
  var ss = getGroupSS();
  var groupsSheet = getGroupSheet('小組清單');
  var districtsSheet = _ensureEntitySheet(ss, _HIERARCHY_SHEETS.DISTRICTS, _DISTRICT_HEADERS);
  var clustersSheet = _ensureEntitySheet(ss, _HIERARCHY_SHEETS.CLUSTERS, _CLUSTER_HEADERS);

  var districtRows = _readEntityRows(districtsSheet);
  var clusterRows = _readEntityRows(clustersSheet);
  var districtIndex = _indexEntityRows(districtRows);
  var clusterIndex = _indexEntityRows(clusterRows);

  return {
    groupsSheet: groupsSheet,
    districtsSheet: districtsSheet,
    clustersSheet: clustersSheet,
    districtRows: districtRows,
    clusterRows: clusterRows,
    districtByUuid: districtIndex.byUuid,
    districtByName: districtIndex.byName,
    clusterByUuid: clusterIndex.byUuid,
    clusterByName: clusterIndex.byName
  };
}

function _resolveDistrictRef(refs, value) {
  var cleanValue = _trim(value);
  if (!cleanValue) return null;
  return refs.districtByUuid[cleanValue] || refs.districtByName[cleanValue] || null;
}

function _resolveClusterRef(refs, value) {
  var cleanValue = _trim(value);
  if (!cleanValue) return null;
  return refs.clusterByUuid[cleanValue] || refs.clusterByName[cleanValue] || null;
}

function _syncHierarchyRecords(groupsSheet, districtsSheet, clustersSheet) {
  var groupRows = _getSheetRows(groupsSheet);
  var refs = _getHierarchyRefs();

  var distUuidCol = _getColIndex(groupsSheet, 'district_uuid');
  var clusterUuidCol = _getColIndex(groupsSheet, 'cluster_uuid');
  var distNameCol = _getColIndex(groupsSheet, 'district');
  var clusterNameCol = _getColIndex(groupsSheet, 'cluster');

  for (var i = 0; i < groupRows.length; i++) {
    var group = groupRows[i];
    var districtName = _trim(group.district);
    var districtUuid = _trim(group.district_uuid);
    var clusterName = _trim(group.cluster);
    var clusterUuid = _trim(group.cluster_uuid);

    var district = _resolveDistrictRef(refs, districtUuid || districtName);
    if (!district && (districtUuid || districtName)) {
      district = _ensureDistrictRecord(
        districtsSheet,
        refs.districtRows,
        { byUuid: refs.districtByUuid, byName: refs.districtByName },
        districtUuid,
        districtName
      );
    }

    if (district) {
      districtUuid = district.uuid;
      districtName = district.name;
    } else {
      districtUuid = '';
      districtName = '';
    }

    var cluster = _resolveClusterRef(refs, clusterUuid || clusterName);
    if (!cluster && (clusterUuid || clusterName)) {
      cluster = _ensureClusterRecord(
        clustersSheet,
        refs.clusterRows,
        { byUuid: refs.clusterByUuid, byName: refs.clusterByName },
        clusterUuid,
        clusterName,
        districtUuid
      );
    }

    if (cluster) {
      clusterUuid = cluster.uuid;
      clusterName = cluster.name;
      if (districtUuid && cluster.district_uuid !== districtUuid) {
        _updateEntityField(clustersSheet, cluster, 'district_uuid', districtUuid);
      }
      if (!districtUuid && cluster.district_uuid) {
        district = refs.districtByUuid[cluster.district_uuid] || null;
        districtUuid = district ? district.uuid : cluster.district_uuid;
        districtName = district ? district.name : districtName;
      }
    } else {
      clusterUuid = '';
      clusterName = '';
    }

    if (distUuidCol > 0 && _trim(group.district_uuid) !== districtUuid) {
      groupsSheet.getRange(group._rowIndex, distUuidCol).setValue(districtUuid);
    }
    if (clusterUuidCol > 0 && _trim(group.cluster_uuid) !== clusterUuid) {
      groupsSheet.getRange(group._rowIndex, clusterUuidCol).setValue(clusterUuid);
    }
    if (distNameCol > 0 && _trim(group.district) !== districtName) {
      groupsSheet.getRange(group._rowIndex, distNameCol).setValue(districtName);
    }
    if (clusterNameCol > 0 && _trim(group.cluster) !== clusterName) {
      groupsSheet.getRange(group._rowIndex, clusterNameCol).setValue(clusterName);
    }
  }
}

function handleHierarchyAction(action, data) {
  try {
    initHierarchySheets();
  } catch (e) {
    Logger.log('⚠️ 初始化 hierarchy 失敗: ' + e.message);
  }

  var groupsSheet = getGroupSheet('小組清單');
  if (!groupsSheet) {
    return { success: false, message: '找不到 小組清單 工作表' };
  }

  var result;
  switch (action) {
    case 'getDistrictsAndClusters':
      return _handleGetDistrictsAndClusters(data, groupsSheet);
    case 'createDistrict':
      result = _handleCreateDistrict(data, groupsSheet);
      break;
    case 'createGroupCluster':
      result = _handleCreateGroupCluster(data, groupsSheet);
      break;
    case 'updateClusterGroups':
      result = _handleUpdateClusterGroups(data, groupsSheet);
      break;
    default:
      return { success: false, message: '未知的 hierarchy action: ' + action };
  }

  if (result && result.success && typeof firebaseInvalidate === 'function') {
    try {
      firebaseInvalidate(['getGroups', 'getAdminGroupsList', 'ministry_getGroups']);
    } catch (e) {
      Logger.log('⚠️ 清除階層快取失敗: ' + e.message);
    }
  }
  return result;
}
function _handleGetDistrictsAndClusters(data, groupsSheet) {
  var refs = _getHierarchyRefs();
  var groups = _getSheetRows(groupsSheet);

  var districts = refs.districtRows
    .filter(function(row) { return row.uuid && row.name; })
    .map(function(row) {
      return { uuid: row.uuid, name: row.name };
    });

  var clusters = refs.clusterRows
    .filter(function(row) { return row.uuid && row.name; })
    .map(function(row) {
      var district = refs.districtByUuid[row.district_uuid] || null;
      return {
        uuid: row.uuid,
        name: row.name,
        districtUuid: row.district_uuid || '',
        districtName: district ? district.name : ''
      };
    });

  var formattedGroups = groups.map(function(group) {
    var district = _resolveDistrictRef(refs, group.district_uuid || group.district);
    var cluster = _resolveClusterRef(refs, group.cluster_uuid || group.cluster);
    return {
      uuid: _trim(group.uuid),
      name: _trim(group.name),
      code: _trim(group.code),
      type: _trim(group.type),
      status: _trim(group.status) || '顯示',
      districtUuid: district ? district.uuid : '',
      districtName: district ? district.name : '',
      clusterUuid: cluster ? cluster.uuid : '',
      clusterName: cluster ? cluster.name : ''
    };
  });

  var adminCode = _getAdminCode();
  var authCode = _trim(data.authCode);
  var isAdmin = authCode === adminCode;
  var matchedGroup = null;

  if (!isAdmin && authCode) {
    for (var i = 0; i < formattedGroups.length; i++) {
      if (formattedGroups[i].code === authCode) {
        matchedGroup = formattedGroups[i];
        break;
      }
    }
  }

  return {
    success: true,
    isAdmin: isAdmin,
    groupName: matchedGroup ? matchedGroup.name : null,
    clusterUuid: matchedGroup ? matchedGroup.clusterUuid : null,
    clusterName: matchedGroup ? matchedGroup.clusterName : null,
    districts: districts,
    clusters: clusters,
    groups: formattedGroups
  };
}

function _handleCreateDistrict(data, groupsSheet) {
  var adminCode = _getAdminCode();
  if (_trim(data.authCode) !== adminCode) {
    return { success: false, message: '無此操作權限！' };
  }

  var name = _trim(data.name);
  if (!name) return { success: false, message: '牧區名稱不可為空' };

  var refs = _getHierarchyRefs();
  var district = _ensureDistrictRecord(
    refs.districtsSheet,
    refs.districtRows,
    { byUuid: refs.districtByUuid, byName: refs.districtByName },
    '',
    name
  );

  var groupRows = _getSheetRows(groupsSheet);
  var clusterUuids = data.clusterUuids || [];
  var distUuidCol = _getColIndex(groupsSheet, 'district_uuid');
  var distNameCol = _getColIndex(groupsSheet, 'district');

  for (var i = 0; i < clusterUuids.length; i++) {
    var cluster = _resolveClusterRef(refs, clusterUuids[i]);
    if (!cluster) continue;
    _updateEntityField(refs.clustersSheet, cluster, 'district_uuid', district.uuid);
    _updateEntityField(refs.clustersSheet, cluster, 'updated_at', _nowIsoString());

    for (var j = 0; j < groupRows.length; j++) {
      var group = groupRows[j];
      if (_trim(group.cluster_uuid) === cluster.uuid || _trim(group.cluster) === cluster.name) {
        if (distUuidCol > 0) groupsSheet.getRange(group._rowIndex, distUuidCol).setValue(district.uuid);
        if (distNameCol > 0) groupsSheet.getRange(group._rowIndex, distNameCol).setValue(district.name);
      }
    }
  }

  return { success: true, message: '牧區建立成功！', districtUuid: district.uuid };
}

function _handleCreateGroupCluster(data, groupsSheet) {
  var authCode = _trim(data.authCode);
  if (!authCode) return { success: false, message: '缺少驗證代碼' };

  var refs = _getHierarchyRefs();
  var groups = _getSheetRows(groupsSheet);
  var adminCode = _getAdminCode();
  var isAdmin = authCode === adminCode;
  var selfGroup = null;

  if (!isAdmin) {
    for (var i = 0; i < groups.length; i++) {
      if (_trim(groups[i].code) === authCode) {
        selfGroup = groups[i];
        break;
      }
    }
    if (!selfGroup) return { success: false, message: '驗證代碼錯誤！' };
  }

  var name = _trim(data.name);
  if (!name) return { success: false, message: '小組群名稱不可為空' };

  var districtUuid = _trim(data.districtUuid);
  if (!districtUuid && selfGroup) {
    districtUuid = _trim(selfGroup.district_uuid);
  }

  var district = _resolveDistrictRef(refs, districtUuid);
  var cluster = _ensureClusterRecord(
    refs.clustersSheet,
    refs.clusterRows,
    { byUuid: refs.clusterByUuid, byName: refs.clusterByName },
    '',
    name,
    district ? district.uuid : ''
  );

  if (!district && cluster.district_uuid) {
    district = refs.districtByUuid[cluster.district_uuid] || null;
  }

  var groupUuids = data.groupUuids || [];
  if (selfGroup && groupUuids.indexOf(_trim(selfGroup.uuid)) === -1) {
    groupUuids.push(_trim(selfGroup.uuid));
  }

  var clusterUuidCol = _getColIndex(groupsSheet, 'cluster_uuid');
  var clusterNameCol = _getColIndex(groupsSheet, 'cluster');
  var distUuidCol = _getColIndex(groupsSheet, 'district_uuid');
  var distNameCol = _getColIndex(groupsSheet, 'district');

  for (var j = 0; j < groups.length; j++) {
    var group = groups[j];
    if (groupUuids.indexOf(_trim(group.uuid)) === -1) continue;
    if (clusterUuidCol > 0) groupsSheet.getRange(group._rowIndex, clusterUuidCol).setValue(cluster.uuid);
    if (clusterNameCol > 0) groupsSheet.getRange(group._rowIndex, clusterNameCol).setValue(cluster.name);
    if (district) {
      if (distUuidCol > 0) groupsSheet.getRange(group._rowIndex, distUuidCol).setValue(district.uuid);
      if (distNameCol > 0) groupsSheet.getRange(group._rowIndex, distNameCol).setValue(district.name);
    }
  }

  return { success: true, message: '小組群建立成功！', clusterUuid: cluster.uuid };
}

function _handleUpdateClusterGroups(data, groupsSheet) {
  var authCode = _trim(data.authCode);
  if (!authCode) return { success: false, message: '缺少驗證代碼' };

  var refs = _getHierarchyRefs();
  var groups = _getSheetRows(groupsSheet);
  var adminCode = _getAdminCode();
  var isAdmin = authCode === adminCode;
  var cluster = _resolveClusterRef(refs, data.clusterUuid);
  if (!cluster) return { success: false, message: '缺少有效的小組群' };

  if (!isAdmin) {
    var authGroup = null;
    for (var i = 0; i < groups.length; i++) {
      if (_trim(groups[i].code) === authCode) {
        authGroup = groups[i];
        break;
      }
    }
    if (!authGroup) return { success: false, message: '驗證代碼錯誤！' };
    if (_trim(authGroup.cluster_uuid) !== cluster.uuid) {
      return { success: false, message: '您只能管理自己所屬的小組群' };
    }
  }

  var district = refs.districtByUuid[cluster.district_uuid] || null;
  var targetGroupUuids = data.groupUuids || [];
  var clusterUuidCol = _getColIndex(groupsSheet, 'cluster_uuid');
  var clusterNameCol = _getColIndex(groupsSheet, 'cluster');
  var distUuidCol = _getColIndex(groupsSheet, 'district_uuid');
  var distNameCol = _getColIndex(groupsSheet, 'district');

  for (var j = 0; j < groups.length; j++) {
    var group = groups[j];
    var currentClusterUuid = _trim(group.cluster_uuid);
    var currentClusterName = _trim(group.cluster);
    var isCurrentlyIn = currentClusterUuid === cluster.uuid || currentClusterName === cluster.name;
    var shouldBeIn = targetGroupUuids.indexOf(_trim(group.uuid)) !== -1;

    if (isCurrentlyIn && !shouldBeIn) {
      if (clusterUuidCol > 0) groupsSheet.getRange(group._rowIndex, clusterUuidCol).setValue('');
      if (clusterNameCol > 0) groupsSheet.getRange(group._rowIndex, clusterNameCol).setValue('');
      if (distUuidCol > 0) groupsSheet.getRange(group._rowIndex, distUuidCol).setValue('');
      if (distNameCol > 0) groupsSheet.getRange(group._rowIndex, distNameCol).setValue('');
    } else if (shouldBeIn) {
      if (clusterUuidCol > 0) groupsSheet.getRange(group._rowIndex, clusterUuidCol).setValue(cluster.uuid);
      if (clusterNameCol > 0) groupsSheet.getRange(group._rowIndex, clusterNameCol).setValue(cluster.name);
      if (distUuidCol > 0) groupsSheet.getRange(group._rowIndex, distUuidCol).setValue(district ? district.uuid : '');
      if (distNameCol > 0) groupsSheet.getRange(group._rowIndex, distNameCol).setValue(district ? district.name : '');
    }
  }

  return { success: true, message: '小組群成員更新成功！' };
}

function enrichAdminGroupsListWithHierarchy(result, authCode) {
  if (!result || !result.success) return result;

  initHierarchySheets();
  var refs = _getHierarchyRefs();
  var groups = _getSheetRows(getGroupSheet('小組清單'));
  var groupMap = {};

  for (var i = 0; i < groups.length; i++) {
    var group = groups[i];
    var district = _resolveDistrictRef(refs, group.district_uuid || group.district);
    var cluster = _resolveClusterRef(refs, group.cluster_uuid || group.cluster);
    groupMap[_trim(group.uuid)] = {
      districtUuid: district ? district.uuid : '',
      districtName: district ? district.name : '',
      clusterUuid: cluster ? cluster.uuid : '',
      clusterName: cluster ? cluster.name : ''
    };
  }

  if (result.groups && Array.isArray(result.groups)) {
    result.groups = result.groups.map(function(item) {
      var hierarchy = groupMap[_trim(item.uuid)] || {};
      item.districtUuid = hierarchy.districtUuid || '';
      item.districtName = hierarchy.districtName || '';
      item.clusterUuid = hierarchy.clusterUuid || '';
      item.clusterName = hierarchy.clusterName || '';
      return item;
    });
  }

  result.districts = refs.districtRows
    .filter(function(row) { return row.uuid && row.name; })
    .map(function(row) { return { uuid: row.uuid, name: row.name }; });

  result.clusters = refs.clusterRows
    .filter(function(row) { return row.uuid && row.name; })
    .map(function(row) {
      var district = refs.districtByUuid[row.district_uuid] || null;
      return {
        uuid: row.uuid,
        name: row.name,
        districtUuid: row.district_uuid || '',
        districtName: district ? district.name : ''
      };
    });

  if (_trim(authCode) && _trim(authCode) !== _getAdminCode()) {
    for (var j = 0; j < groups.length; j++) {
      if (_trim(groups[j].code) === _trim(authCode)) {
        var matched = groupMap[_trim(groups[j].uuid)] || {};
        result.groupName = _trim(groups[j].name);
        result.clusterUuid = matched.clusterUuid || '';
        result.clusterName = matched.clusterName || '';
        break;
      }
    }
  }

  return result;
}

function writeGroupHierarchyFields(groupUuid, districtRef, clusterRef) {
  if (districtRef === undefined && clusterRef === undefined) return;

  initHierarchySheets();
  var refs = _getHierarchyRefs();
  var groupsSheet = refs.groupsSheet;
  if (!groupsSheet) return;

  var groupRows = _getSheetRows(groupsSheet);
  var idx = _findRowByUuid(groupRows, groupUuid);
  if (idx === -1) return;

  var row = groupRows[idx];
  var district = _resolveDistrictRef(refs, districtRef);
  var cluster = _resolveClusterRef(refs, clusterRef);

  if (cluster && !district && cluster.district_uuid) {
    district = refs.districtByUuid[cluster.district_uuid] || null;
  }

  var distUuidCol = _getColIndex(groupsSheet, 'district_uuid');
  var clusterUuidCol = _getColIndex(groupsSheet, 'cluster_uuid');
  var distNameCol = _getColIndex(groupsSheet, 'district');
  var clusterNameCol = _getColIndex(groupsSheet, 'cluster');

  if (distUuidCol > 0) groupsSheet.getRange(row._rowIndex, distUuidCol).setValue(district ? district.uuid : '');
  if (clusterUuidCol > 0) groupsSheet.getRange(row._rowIndex, clusterUuidCol).setValue(cluster ? cluster.uuid : '');
  if (distNameCol > 0) groupsSheet.getRange(row._rowIndex, distNameCol).setValue(district ? district.name : '');
  if (clusterNameCol > 0) groupsSheet.getRange(row._rowIndex, clusterNameCol).setValue(cluster ? cluster.name : '');
}

function assignNewGroupToCluster(newGroupUuid, targetClusterRef, newClusterName, authCode) {
  initHierarchySheets();
  var refs = _getHierarchyRefs();
  var cluster = _resolveClusterRef(refs, targetClusterRef);

  if (!cluster && _trim(newClusterName)) {
    var auth = _trim(authCode);
    var adminCode = _getAdminCode();
    var groups = _getSheetRows(refs.groupsSheet);
    var selfGroup = null;
    if (auth && auth !== adminCode) {
      for (var i = 0; i < groups.length; i++) {
        if (_trim(groups[i].code) === auth) {
          selfGroup = groups[i];
          break;
        }
      }
    }

    var districtUuid = selfGroup ? _trim(selfGroup.district_uuid) : '';
    cluster = _ensureClusterRecord(
      refs.clustersSheet,
      refs.clusterRows,
      { byUuid: refs.clusterByUuid, byName: refs.clusterByName },
      '',
      _trim(newClusterName),
      districtUuid
    );
  }

  writeGroupHierarchyFields(
    newGroupUuid,
    cluster && cluster.district_uuid ? cluster.district_uuid : '',
    cluster ? cluster.uuid : ''
  );
}

function handleCreateGroupWithHierarchy(data) {
  var groupName = _trim(data.groupName);
  var groupCode = _trim(data.groupCode);
  var groupType = _trim(data.groupType) || '一般小組';
  var associatedGroup = _trim(data.associatedGroup);
  var targetClusterRef = _trim(data.targetClusterUuid);
  var newClusterName = _trim(data.newClusterName);
  var authCode = _trim(data.authCode);

  if (!groupName || !groupCode) {
    return { success: false, message: '請填寫完整的小組名稱與代碼' };
  }

  if (newClusterName && !authCode) {
    return { success: false, message: '建立新小組群前請先完成權限驗證' };
  }

  var createRes = createGroup(groupName, groupCode, groupType, associatedGroup);
  if (!createRes || !createRes.success) return createRes;

  if (targetClusterRef || newClusterName) {
    assignNewGroupToCluster(createRes.groupUuid, targetClusterRef, newClusterName, authCode);
  }

  return createRes;
}

function _getAdminCode() {
  if (typeof ADMIN_CODE !== 'undefined') {
    return ADMIN_CODE;
  }
  return 'LK31';
}
