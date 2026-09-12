/**
 * Import.gs — นำเข้าข้อมูลจากไฟล์ Excel/CSV (Frontend อ่านไฟล์ด้วย SheetJS แล้วส่งแถวมาตรวจสอบซ้ำที่นี่)
 *
 * โหมด
 * ข้อมูลซ้ำ = 7 ฟิลด์ตรงกัน (ดู duplicateKey_ ใน Data.gs) — BR ไม่นำมาเทียบ
 *   append  — เพิ่มเฉพาะข้อมูลใหม่ แถวที่ซ้ำกับข้อมูลในระบบจะไม่ผ่าน
 *   upsert  — เพิ่มใหม่ หรืออัปเดตค่า BR ของแถวที่ซ้ำ (แถวที่ค่าเหมือนเดิมทุกคอลัมน์นับเป็น "ไม่เปลี่ยนแปลง" และไม่เขียนซ้ำ)
 *   replace — Soft delete ข้อมูลเดิมทั้งหมดของงวด STM ที่เลือก แล้วเพิ่มข้อมูลจากไฟล์แทน
 *             (ImportLogs.rows_updated = จำนวนแถวเดิมที่ถูกแทนที่)
 * dry_run = true → ตรวจสอบกับฐานข้อมูลโดยไม่บันทึก
 */

var IMPORT_MODES = ['append', 'upsert', 'replace'];

function makeBatchId_() {
  return 'IMP-' + Utilities.formatDate(new Date(), TZ, 'yyyyMMdd-HHmmss') + '-' + uuid_().substring(0, 4).toUpperCase();
}

function handleImportData_(ctx) {
  var p = ctx.payload;
  var mode = String(p.mode || '').toLowerCase();
  if (IMPORT_MODES.indexOf(mode) === -1) throw apiError_('BAD_REQUEST', 'โหมดนำเข้าไม่ถูกต้อง');

  var rows = p.rows;
  if (!Array.isArray(rows) || !rows.length) throw apiError_('VALIDATION_ERROR', 'ไม่พบแถวข้อมูลสำหรับนำเข้า');
  var maxRows = Number(getSetting_('MAX_IMPORT_ROWS')) || 5000;
  if (rows.length > maxRows) {
    throw apiError_('VALIDATION_ERROR', 'จำนวนแถว ' + rows.length + ' เกินกำหนดสูงสุด ' + maxRows + ' แถวต่อครั้ง');
  }

  var fileName = sanitizeText_(p.file_name, 200) || 'ไม่ระบุชื่อไฟล์';
  var dryRun = p.dry_run === true;

  var replacePeriods = [];
  var replaceSet = {};
  if (mode === 'replace') {
    replacePeriods = uniqueStrings_((Array.isArray(p.replace_periods) ? p.replace_periods : [])
      .map(function (x) { return sanitizeText_(x, 50); }).filter(Boolean));
    if (!replacePeriods.length) throw apiError_('VALIDATION_ERROR', 'กรุณาเลือกงวด STM ที่ต้องการแทนที่');
    if (!dryRun && p.confirm_replace !== true) throw apiError_('VALIDATION_ERROR', 'กรุณายืนยันการแทนที่ข้อมูล');
    replacePeriods.forEach(function (s) { replaceSet[s.toLowerCase()] = true; });
  }

  // 1) ตรวจสอบทุกแถว — แถวที่ไม่ผ่านต้องถูกรายงานพร้อมเหตุผลเสมอ
  var rejected = [];
  var warnings = [];
  var valid = [];
  var seen = {};

  rows.forEach(function (raw, i) {
    var rowNo = raw && parseInt(raw._row, 10) > 0 ? parseInt(raw._row, 10) : i + 2;
    if (!isPlainObject_(raw)) {
      rejected.push({ row: rowNo, stm_period: '', service_type: '', reasons: ['รูปแบบข้อมูลแถวไม่ถูกต้อง'] });
      return;
    }
    var v = validateRecordInput_(raw);
    if (v.errors.length) {
      rejected.push({ row: rowNo, stm_period: v.record.stm_period, service_type: v.record.service_type, reasons: v.errors });
      return;
    }
    var key = duplicateKey_(v.record);
    if (seen[key]) {
      rejected.push({
        row: rowNo, stm_period: v.record.stm_period, service_type: v.record.service_type,
        reasons: ['ข้อมูลซ้ำในไฟล์กับแถวที่ ' + seen[key] + ' (ตรงกันทั้ง 7 ฟิลด์: ' + DUPLICATE_KEY_LABEL + ')']
      });
      return;
    }
    if (mode === 'replace' && !replaceSet[v.record.stm_period.toLowerCase()]) {
      rejected.push({
        row: rowNo, stm_period: v.record.stm_period, service_type: v.record.service_type,
        reasons: ['งวด STM นี้ไม่ได้ถูกเลือกให้แทนที่']
      });
      return;
    }
    seen[key] = rowNo;
    if (v.warnings.length) warnings.push({ row: rowNo, reasons: v.warnings });
    valid.push({ row: rowNo, record: v.record, key: key });
  });

  var run = function () {
    var table = readTable_('Data');
    var records = table.rows.map(rowToRecord_);
    var activeByKey = {};
    records.forEach(function (r) {
      if (r.is_active) activeByKey[duplicateKey_(r)] = r;
    });

    var now = nowIso_();
    var batchId = dryRun ? 'DRY-RUN' : makeBatchId_();
    var inserts = [];
    var updates = [];
    var deactivations = [];
    var unchanged = 0;

    var newRecord = function (rec) {
      var obj = { record_id: uuid_(), import_batch_id: batchId, created_at: now, updated_at: now, is_active: 'TRUE' };
      Object.keys(rec).forEach(function (k) { obj[k] = rec[k]; });
      return obj;
    };

    if (mode === 'replace') {
      records.forEach(function (r) {
        if (r.is_active && replaceSet[r.stm_period.toLowerCase()]) deactivations.push(r);
      });
      valid.forEach(function (item) { inserts.push(newRecord(item.record)); });
    } else {
      valid.forEach(function (item) {
        var existing = activeByKey[item.key];
        if (!existing) {
          inserts.push(newRecord(item.record));
        } else if (mode === 'append') {
          rejected.push({
            row: item.row, stm_period: item.record.stm_period, service_type: item.record.service_type,
            reasons: ['มีข้อมูลที่ตรงกันทั้ง 7 ฟิลด์ในระบบแล้ว (ใช้โหมด Upsert หากต้องการอัปเดตค่า BR)']
          });
        } else if (NUMERIC_FIELDS.every(function (f) { return round_(existing[f], 4) === round_(item.record[f], 4); })) {
          unchanged++;
        } else {
          var merged = {};
          Object.keys(existing).forEach(function (k) { merged[k] = existing[k]; });
          Object.keys(item.record).forEach(function (k) { merged[k] = item.record[k]; });
          merged.import_batch_id = batchId;
          merged.updated_at = now;
          merged.is_active = 'TRUE';
          updates.push({ old: existing, next: merged });
        }
      });
    }

    rejected.sort(function (a, b) { return a.row - b.row; });

    var summary = {
      import_id: batchId,
      dry_run: dryRun,
      mode: mode,
      file_name: fileName,
      replace_periods: replacePeriods,
      rows_received: rows.length,
      rows_inserted: inserts.length,
      rows_updated: mode === 'replace' ? deactivations.length : updates.length,
      rows_replaced: deactivations.length,
      rows_unchanged: unchanged,
      rows_rejected: rejected.length,
      rejected: rejected.slice(0, 1000),
      warnings: warnings.slice(0, 500),
      warning_count: warnings.length
    };

    if (dryRun) return summary;

    var sheetUpdates = deactivations.map(function (r) {
      var copy = recordForSheet_(r);
      copy.is_active = 'FALSE';
      copy.updated_at = now;
      return copy;
    }).concat(updates.map(function (u) { return recordForSheet_(u.next); }));

    updateRows_(table, sheetUpdates);
    appendObjects_('Data', inserts);
    if (inserts.length || sheetUpdates.length) markDataChanged_();

    var errorSummary = rejected.slice(0, 50).map(function (r) {
      return 'แถว ' + r.row + ': ' + r.reasons.join('; ');
    }).join('\n');
    if (rejected.length > 50) errorSummary += '\n... และอีก ' + (rejected.length - 50) + ' แถว';

    writeImportLog_({
      import_id: batchId,
      timestamp: now,
      email: ctx.user.email,
      file_name: fileName,
      import_mode: mode,
      rows_received: summary.rows_received,
      rows_inserted: summary.rows_inserted,
      rows_updated: summary.rows_updated,
      rows_rejected: summary.rows_rejected,
      error_summary: errorSummary
    });

    var logs = [{
      email: ctx.user.email,
      action: 'IMPORT',
      record_id: batchId,
      new_value: {
        file_name: fileName, mode: mode, replace_periods: replacePeriods,
        rows_received: summary.rows_received, rows_inserted: summary.rows_inserted,
        rows_updated: updates.length, rows_replaced: deactivations.length, rows_unchanged: unchanged, rows_rejected: summary.rows_rejected
      },
      user_agent: ctx.userAgent
    }];
    updates.forEach(function (u) {
      logs.push({
        email: ctx.user.email, action: 'UPDATE', record_id: u.old.record_id,
        old_value: publicRecord_(u.old), new_value: publicRecord_(u.next), user_agent: ctx.userAgent
      });
    });
    deactivations.forEach(function (r) {
      logs.push({
        email: ctx.user.email, action: 'DELETE', record_id: r.record_id,
        old_value: publicRecord_(r), new_value: { is_active: false, mode: 'soft', reason: 'REPLACE_BATCH', import_batch_id: batchId },
        user_agent: ctx.userAgent
      });
    });
    writeAuditLogs_(logs);

    return summary;
  };

  var result = dryRun ? run() : withLock_(run);
  var message = dryRun
    ? 'ตรวจสอบกับฐานข้อมูลเรียบร้อย (ยังไม่บันทึก)'
    : 'นำเข้าข้อมูลเรียบร้อย: เพิ่มใหม่ ' + result.rows_inserted + ' แถว, ไม่ผ่าน ' + result.rows_rejected + ' แถว';
  return ok_(result, message);
}
