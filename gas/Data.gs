/**
 * Data.gs — อ่านข้อมูล Dashboard (ระดับสรุป) และเพิ่ม / แก้ไข / ลบข้อมูล พร้อม AuditLogs
 * ข้อมูลซ้ำ = 7 ฟิลด์ตรงกันทั้งหมด: stm_period, month_code, fiscal_year, service_type, service_count, adj_rw, compensation
 *   (ข้อความไม่สนตัวพิมพ์เล็ก/ใหญ่และช่องว่างซ้ำ, ตัวเลขเทียบหลังปัดทศนิยม) — ไม่นำ BR 2 คอลัมน์มาเทียบ
 */

var NUMERIC_FIELDS = ['br_after_deduction', 'br_k', 'service_count', 'adj_rw', 'compensation'];
var EDITABLE_FIELDS = ['stm_period', 'month_code', 'fiscal_year', 'service_type'].concat(NUMERIC_FIELDS);
var FIELD_LABELS = {
  stm_period: 'งวด STM',
  month_code: 'เดือน',
  fiscal_year: 'ปีงบประมาณ',
  service_type: 'ประเภทบริการ',
  br_after_deduction: 'BR หลังหักเงินกัน สป.สธ.',
  br_k: 'BR คูณ K สป.สธ.',
  service_count: 'ครั้ง(บริการ)',
  adj_rw: 'Adj.RW ที่ชดเชย',
  compensation: 'ชดเชยก่อนหักเงินเดือน'
};
var DASHBOARD_COLUMNS = ['stm_period', 'month_code', 'fiscal_year', 'service_type', 'br_after_deduction', 'br_k',
  'service_count', 'adj_rw', 'compensation'];

/* ------------------------------ Helpers ------------------------------ */

function isActiveValue_(v) {
  if (v === false) return false;
  var s = String(v).trim().toUpperCase();
  return !(s === 'FALSE' || s === '0' || s === 'NO');
}

function rowToRecord_(r) {
  var rec = {
    record_id: String(r.record_id || ''),
    stm_period: String(r.stm_period || '').trim(),
    month_code: normalizeCode_(r.month_code),
    fiscal_year: normalizeCode_(r.fiscal_year),
    service_type: String(r.service_type || '').trim() || UNSPECIFIED_SERVICE_TYPE,
    import_batch_id: String(r.import_batch_id || ''),
    created_at: String(r.created_at || ''),
    updated_at: String(r.updated_at || ''),
    is_active: isActiveValue_(r.is_active),
    _row: r._row
  };
  NUMERIC_FIELDS.forEach(function (f) {
    var n = toNumber_(r[f]);
    rec[f] = isNaN(n) ? 0 : n;
  });
  return rec;
}

function recordForSheet_(rec) {
  var out = {};
  Object.keys(rec).forEach(function (k) { out[k] = rec[k]; });
  out.is_active = rec.is_active === false || rec.is_active === 'FALSE' ? 'FALSE' : 'TRUE';
  return out;
}

function publicRecord_(rec) {
  var out = stripInternal_(rec);
  out.is_active = isActiveValue_(rec.is_active);
  return out;
}

var DUPLICATE_KEY_LABEL = 'งวด STM, เดือน, ปีงบประมาณ, ประเภทบริการ, ครั้ง(บริการ), Adj.RW ที่ชดเชย, ชดเชยก่อนหักเงินเดือน';

/** คีย์ตรวจข้อมูลซ้ำ 7 ฟิลด์ (ไม่เทียบ BR) — ต้องให้ผลตรงกับ U.duplicateKey ใน js/utils.js */
function duplicateKey_(rec) {
  var text = function (s) { return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase(); };
  var num = function (v, digits) {
    var n = toNumber_(v);
    return isNaN(n) ? 'NaN' : round_(n, digits).toFixed(digits);
  };
  return [
    text(rec.stm_period),
    normalizeCode_(rec.month_code),
    normalizeCode_(rec.fiscal_year),
    text(rec.service_type || UNSPECIFIED_SERVICE_TYPE),
    num(rec.service_count, 2),
    num(rec.adj_rw, 4),
    num(rec.compensation, 2)
  ].join('||');
}

function markDataChanged_() {
  PropertiesService.getScriptProperties().setProperties({
    DATA_VERSION: String(Date.now()),
    LAST_DATA_UPDATE: nowIso_()
  });
}

function fillMissingRecordIds_() {
  return withLock_(function () {
    var table = readTable_('Data');
    var fixes = table.rows.filter(function (r) { return !String(r.record_id || '').trim(); });
    if (!fixes.length) return 0;
    var now = nowIso_();
    fixes.forEach(function (r) {
      r.record_id = uuid_();
      if (!r.created_at) r.created_at = now;
      if (!r.updated_at) r.updated_at = now;
      if (String(r.is_active).trim() === '') r.is_active = 'TRUE';
      if (!String(r.service_type || '').trim()) r.service_type = UNSPECIFIED_SERVICE_TYPE;
    });
    updateRows_(table, fixes);
    return fixes.length;
  });
}

/**
 * ตรวจสอบและแปลงข้อมูล 1 แถว — ใช้ร่วมกันใน addData / updateData / importData
 * คืนค่า { record, errors: [ข้อความ], warnings: [ข้อความ] }
 */
function validateRecordInput_(input) {
  var errors = [];
  var warnings = [];
  input = isPlainObject_(input) ? input : {};

  var stm = sanitizeText_(input.stm_period, 50);
  if (!stm) errors.push('ไม่ระบุงวด STM');

  var stmMonth = /^(\d{4})_/.exec(stm);
  var monthCode = normalizeCode_(input.month_code);
  if (!monthCode && stmMonth && isValidMonthCode_(stmMonth[1])) {
    monthCode = stmMonth[1];
    warnings.push('เดือนว่าง ใช้ค่า ' + monthCode + ' จากงวด STM');
  }
  var monthOk = isValidMonthCode_(monthCode);
  if (!monthCode) errors.push('ไม่ระบุเดือน');
  else if (!monthOk) errors.push('เดือนต้องเป็นรูปแบบ YYMM เช่น 6907 (พบ "' + monthCode.substring(0, 20) + '")');

  var fyRaw = normalizeCode_(input.fiscal_year);
  var fy = normalizeFiscalYear_(fyRaw);
  if (!fy && monthOk) {
    fy = fiscalYearFromMonthCode_(monthCode);
    warnings.push('ปีงบประมาณว่าง คำนวณจากเดือนได้ ' + fy);
  } else if (fy && fy !== fyRaw) {
    warnings.push('แปลงปีงบประมาณ ' + fyRaw + ' เป็น ' + fy);
  }
  if (!fy) {
    errors.push('ไม่ระบุปีงบประมาณ');
  } else if (!isValidFiscalYear_(fy)) {
    errors.push('ปีงบประมาณไม่ถูกต้อง (พบ "' + fy.substring(0, 20) + '")');
  } else if (monthOk && fiscalYearFromMonthCode_(monthCode) !== fy) {
    warnings.push('ปีงบประมาณ ' + fy + ' ไม่สอดคล้องกับเดือน ' + monthCode + ' (ควรเป็น ' + fiscalYearFromMonthCode_(monthCode) + ')');
  }
  if (stmMonth && monthOk && stmMonth[1] !== monthCode) {
    warnings.push('รหัสเดือนในงวด STM (' + stmMonth[1] + ') ไม่ตรงกับเดือน ' + monthCode);
  }

  var serviceType = sanitizeText_(input.service_type, 100);
  if (!serviceType) serviceType = UNSPECIFIED_SERVICE_TYPE;
  if (/^(รวม|รวมทั้งสิ้น|ยอดรวม|total|grand ?total)$/i.test(serviceType) || /^(รวม|รวมทั้งสิ้น|ยอดรวม|total|grand ?total)$/i.test(stm)) {
    errors.push('เป็นแถวสรุปยอดรวม ไม่ใช่ข้อมูลรายงวด');
  }

  var record = {
    stm_period: stm,
    month_code: monthCode,
    fiscal_year: fy,
    service_type: serviceType
  };

  NUMERIC_FIELDS.forEach(function (f) {
    var raw = input[f];
    var n = toNumber_(raw);
    if (isNaN(n)) {
      errors.push(FIELD_LABELS[f] + ' ไม่ใช่ตัวเลข (พบ "' + String(raw).substring(0, 30) + '")');
      record[f] = 0;
      return;
    }
    if (Math.abs(n) > 1e12) errors.push(FIELD_LABELS[f] + ' มีค่าสูงผิดปกติ');
    if (n < 0) warnings.push(FIELD_LABELS[f] + ' มีค่าติดลบ');
    if (f === 'service_count' && Math.floor(n) !== n) warnings.push('จำนวนครั้งบริการไม่เป็นจำนวนเต็ม');
    record[f] = round_(n, f === 'adj_rw' ? 4 : 2);
  });

  return { record: record, errors: errors, warnings: warnings };
}

function applyRecordFilters_(records, f) {
  f = isPlainObject_(f) ? f : {};
  var toSet = function (arr) {
    var set = {};
    (Array.isArray(arr) ? arr : []).forEach(function (v) { set[String(v)] = true; });
    return Object.keys(set).length ? set : null;
  };
  var years = toSet(f.fiscal_years);
  var months = toSet(f.months);
  var stms = toSet(f.stm_periods);
  var types = toSet(f.service_types);
  var from = normalizeCode_(f.month_from);
  var to = normalizeCode_(f.month_to);
  return records.filter(function (r) {
    if (years && !years[r.fiscal_year]) return false;
    if (months && !months[r.month_code.substring(2, 4)]) return false;
    if (stms && !stms[r.stm_period]) return false;
    if (types && !types[r.service_type]) return false;
    if (from && r.month_code < from) return false;
    if (to && r.month_code > to) return false;
    return true;
  });
}

function buildFilterOptions_(records) {
  var years = {}, months = {}, codes = {}, stms = {}, types = {};
  records.forEach(function (r) {
    if (r.fiscal_year) years[r.fiscal_year] = true;
    if (isValidMonthCode_(r.month_code)) {
      months[r.month_code.substring(2, 4)] = true;
      codes[r.month_code] = true;
    }
    if (r.stm_period) stms[r.stm_period] = r.month_code;
    types[r.service_type] = (types[r.service_type] || 0) + r.compensation;
  });
  var fiscalOrder = ['10', '11', '12', '01', '02', '03', '04', '05', '06', '07', '08', '09'];
  return {
    fiscal_years: Object.keys(years).sort().reverse(),
    months: fiscalOrder.filter(function (m) { return months[m]; }),
    month_codes: Object.keys(codes).sort(),
    stm_periods: Object.keys(stms).sort(function (a, b) {
      return String(stms[a]).localeCompare(String(stms[b])) || a.localeCompare(b);
    }),
    service_types: Object.keys(types).sort(function (a, b) { return types[b] - types[a]; })
  };
}

function getActiveRecords_() {
  return readTable_('Data').rows.map(rowToRecord_).filter(function (r) { return r.is_active && r.stm_period; });
}

function getLastDataUpdate_(records) {
  var fromProps = PropertiesService.getScriptProperties().getProperty('LAST_DATA_UPDATE');
  if (fromProps) return fromProps;
  var max = '';
  (records || []).forEach(function (r) {
    if (r.updated_at > max) max = r.updated_at;
  });
  return max;
}

/** ข้อมูลฐานของ Dashboard (cache 5 นาที และล้างทันทีเมื่อข้อมูลเปลี่ยน) */
function getDashboardBase_() {
  var version = PropertiesService.getScriptProperties().getProperty('DATA_VERSION') || '0';
  var cache = CacheService.getScriptCache();
  var cacheKey = 'dash_v1_' + version;
  var cached = cache.get(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) { /* rebuild */ }
  }
  var records = getActiveRecords_();
  var base = {
    columns: DASHBOARD_COLUMNS,
    rows: records.map(function (r) {
      return DASHBOARD_COLUMNS.map(function (c) { return r[c]; });
    }),
    filter_options: buildFilterOptions_(records),
    record_count: records.length,
    last_updated: getLastDataUpdate_(records)
  };
  var json = JSON.stringify(base);
  if (json.length < 95000) cache.put(cacheKey, json, 300);
  return base;
}

/* ------------------------------ Handlers ------------------------------ */

function handleGetDashboard_(ctx) {
  var base = getDashboardBase_();
  var filters = ctx.payload.filters;
  if (isPlainObject_(filters)) {
    var records = base.rows.map(function (line) {
      var obj = {};
      base.columns.forEach(function (c, i) { obj[c] = line[i]; });
      return obj;
    });
    var filtered = applyRecordFilters_(records, filters);
    base.rows = filtered.map(function (r) {
      return base.columns.map(function (c) { return r[c]; });
    });
    base.record_count = filtered.length;
  }
  base.settings = getPublicSettings_();
  base.viewer = ctx.user ? { role: ctx.user.role } : null;
  base.generated_at = nowIso_();
  return ok_(base);
}

function handleGetFilterOptions_() {
  var base = getDashboardBase_();
  return ok_({ filter_options: base.filter_options, last_updated: base.last_updated });
}

function handleGetData_(ctx) {
  if (readTable_('Data').rows.some(function (r) { return !String(r.record_id || '').trim(); })) {
    fillMissingRecordIds_();
  }
  var includeInactive = ctx.payload.include_inactive === true;
  if (includeInactive && !hasRole_(ctx.user, 'ADMIN')) {
    throw apiError_('FORBIDDEN', 'เฉพาะ ADMIN ขึ้นไปที่ดูข้อมูลที่ถูกลบได้');
  }
  var all = readTable_('Data').rows.map(rowToRecord_).filter(function (r) { return r.stm_period || r.record_id; });
  var active = all.filter(function (r) { return r.is_active; });
  var list = applyRecordFilters_(includeInactive ? all : active, ctx.payload.filters);
  list.sort(function (a, b) {
    return b.month_code.localeCompare(a.month_code) || a.stm_period.localeCompare(b.stm_period) ||
      a.service_type.localeCompare(b.service_type);
  });
  return ok_({
    records: list.map(publicRecord_),
    total: list.length,
    filter_options: buildFilterOptions_(active)
  });
}

function findDuplicate_(records, key, excludeId) {
  for (var i = 0; i < records.length; i++) {
    var r = records[i];
    if (r.is_active && r.record_id !== excludeId && duplicateKey_(r) === key) return r;
  }
  return null;
}

function toDetails_(messages) {
  return messages.map(function (m) { return { message: m }; });
}

function handleAddData_(ctx) {
  var v = validateRecordInput_(ctx.payload.record);
  if (v.errors.length) throw apiError_('VALIDATION_ERROR', 'ข้อมูลไม่ถูกต้อง', toDetails_(v.errors));

  return withLock_(function () {
    var table = readTable_('Data');
    var records = table.rows.map(rowToRecord_);
    var dup = findDuplicate_(records, duplicateKey_(v.record), null);
    if (dup) {
      throw apiError_('DUPLICATE', 'มีข้อมูลที่ตรงกันทั้ง 7 ฟิลด์อยู่แล้ว (งวด STM "' + dup.stm_period + '" ประเภทบริการ "' + dup.service_type + '")',
        [{ record_id: dup.record_id, message: 'ฟิลด์ที่ใช้ตรวจซ้ำ: ' + DUPLICATE_KEY_LABEL }]);
    }
    var now = nowIso_();
    var rec = {
      record_id: uuid_(),
      import_batch_id: 'MANUAL',
      created_at: now,
      updated_at: now,
      is_active: 'TRUE'
    };
    Object.keys(v.record).forEach(function (k) { rec[k] = v.record[k]; });
    appendObjects_('Data', [rec]);
    markDataChanged_();
    writeAuditLog_({
      email: ctx.user.email, action: 'ADD', record_id: rec.record_id,
      new_value: publicRecord_(rec), user_agent: ctx.userAgent
    });
    return ok_({ record: publicRecord_(rec), warnings: v.warnings }, 'เพิ่มข้อมูลสำเร็จ');
  });
}

function handleUpdateData_(ctx) {
  var id = sanitizeText_(ctx.payload.record_id, 60);
  if (!id) throw apiError_('BAD_REQUEST', 'ไม่ระบุ record_id');
  var restore = ctx.payload.restore === true;
  if (restore && !hasRole_(ctx.user, 'ADMIN')) throw apiError_('FORBIDDEN', 'เฉพาะ ADMIN ขึ้นไปที่กู้คืนข้อมูลได้');
  var input = isPlainObject_(ctx.payload.record) ? ctx.payload.record : {};

  return withLock_(function () {
    var table = readTable_('Data');
    var records = table.rows.map(rowToRecord_);
    var current = null;
    records.forEach(function (r) {
      if (r.record_id === id) current = r;
    });
    if (!current) throw apiError_('NOT_FOUND', 'ไม่พบข้อมูลที่ต้องการแก้ไข');
    if (!current.is_active && !restore) throw apiError_('NOT_FOUND', 'ข้อมูลนี้ถูกลบแล้ว');
    if (restore && current.is_active) throw apiError_('VALIDATION_ERROR', 'ข้อมูลนี้ยังใช้งานอยู่');

    var expected = ctx.payload.expected_updated_at;
    if (expected && current.updated_at && String(expected) !== current.updated_at) {
      throw apiError_('CONFLICT', 'ข้อมูลถูกแก้ไขโดยผู้ใช้อื่นแล้ว กรุณาโหลดข้อมูลล่าสุดก่อนแก้ไข');
    }

    var merged = {};
    EDITABLE_FIELDS.forEach(function (f) {
      merged[f] = !restore && Object.prototype.hasOwnProperty.call(input, f) ? input[f] : current[f];
    });
    var v = validateRecordInput_(merged);
    if (v.errors.length) throw apiError_('VALIDATION_ERROR', 'ข้อมูลไม่ถูกต้อง', toDetails_(v.errors));

    var dup = findDuplicate_(records, duplicateKey_(v.record), id);
    if (dup) {
      throw apiError_('DUPLICATE', 'มีข้อมูลที่ใช้งานอยู่ซึ่งตรงกันทั้ง 7 ฟิลด์แล้ว (งวด STM "' + dup.stm_period + '" ประเภทบริการ "' + dup.service_type + '")',
        [{ record_id: dup.record_id, message: 'ฟิลด์ที่ใช้ตรวจซ้ำ: ' + DUPLICATE_KEY_LABEL }]);
    }

    var changed = restore || EDITABLE_FIELDS.some(function (f) { return String(v.record[f]) !== String(current[f]); });
    if (!changed) return ok_({ record: publicRecord_(current), warnings: v.warnings }, 'ไม่มีการเปลี่ยนแปลงข้อมูล');

    var updated = {};
    Object.keys(current).forEach(function (k) { updated[k] = current[k]; });
    Object.keys(v.record).forEach(function (k) { updated[k] = v.record[k]; });
    updated.updated_at = nowIso_();
    updated.is_active = 'TRUE';

    updateRows_(table, [recordForSheet_(updated)]);
    markDataChanged_();
    writeAuditLog_({
      email: ctx.user.email,
      action: restore ? 'RESTORE' : 'UPDATE',
      record_id: id,
      old_value: publicRecord_(current),
      new_value: publicRecord_(updated),
      user_agent: ctx.userAgent
    });
    return ok_({ record: publicRecord_(updated), warnings: v.warnings }, restore ? 'กู้คืนข้อมูลสำเร็จ' : 'แก้ไขข้อมูลสำเร็จ');
  });
}

function handleDeleteData_(ctx) {
  var ids = Array.isArray(ctx.payload.record_ids) ? ctx.payload.record_ids : [ctx.payload.record_id];
  ids = uniqueStrings_(ids.map(function (x) { return sanitizeText_(x, 60); }).filter(Boolean));
  if (!ids.length) throw apiError_('BAD_REQUEST', 'ไม่ระบุข้อมูลที่ต้องการลบ');
  if (ids.length > 500) throw apiError_('VALIDATION_ERROR', 'ลบได้ครั้งละไม่เกิน 500 รายการ');

  var mode = ctx.payload.mode === 'hard' ? 'hard' : 'soft';
  if (mode === 'hard') {
    if (ctx.user.role !== 'SUPER_ADMIN') throw apiError_('FORBIDDEN', 'เฉพาะ SUPER_ADMIN เท่านั้นที่ลบข้อมูลถาวรได้');
    if (!getSetting_('ALLOW_HARD_DELETE')) throw apiError_('FORBIDDEN', 'การลบถาวรถูกปิดใช้งานใน Settings');
  }

  return withLock_(function () {
    var table = readTable_('Data');
    var idSet = {};
    ids.forEach(function (id) { idSet[id] = true; });
    var targets = table.rows.map(rowToRecord_).filter(function (r) { return idSet[r.record_id]; });
    var foundIds = {};
    targets.forEach(function (r) { foundIds[r.record_id] = true; });
    var notFound = ids.filter(function (id) { return !foundIds[id]; });
    if (!targets.length) throw apiError_('NOT_FOUND', 'ไม่พบข้อมูลที่ต้องการลบ');

    var now = nowIso_();
    var logs = [];
    var affected = 0;

    if (mode === 'soft') {
      var updates = [];
      targets.forEach(function (r) {
        if (!r.is_active) return;
        var copy = recordForSheet_(r);
        copy.is_active = 'FALSE';
        copy.updated_at = now;
        updates.push(copy);
        logs.push({
          email: ctx.user.email, action: 'DELETE', record_id: r.record_id,
          old_value: publicRecord_(r), new_value: { is_active: false, mode: 'soft' }, user_agent: ctx.userAgent
        });
      });
      updateRows_(table, updates);
      affected = updates.length;
    } else {
      targets.sort(function (a, b) { return b._row - a._row; }).forEach(function (r) {
        table.sheet.deleteRow(r._row);
        logs.push({
          email: ctx.user.email, action: 'DELETE', record_id: r.record_id,
          old_value: publicRecord_(r), new_value: { mode: 'hard' }, user_agent: ctx.userAgent
        });
      });
      affected = targets.length;
    }

    if (affected) markDataChanged_();
    writeAuditLogs_(logs);
    return ok_({ deleted: affected, not_found: notFound, mode: mode },
      affected ? 'ลบข้อมูล ' + affected + ' รายการเรียบร้อยแล้ว' : 'ไม่มีข้อมูลที่ต้องลบ');
  });
}
