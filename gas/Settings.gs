/**
 * Settings.gs — ค่าตั้งค่าระบบ
 *
 * 1) Script Properties (Project Settings → Script properties) — ค่าที่ไม่ควรแก้ผ่านหน้าเว็บ
 *    GOOGLE_CLIENT_ID              OAuth Client ID (ต้องตรงกับ js/config.js)
 *    BOOTSTRAP_SUPER_ADMIN_EMAIL   Gmail ของ SUPER_ADMIN คนแรก
 *    SPREADSHEET_ID                (ไม่บังคับ) ค่าเริ่มต้นคือ DEFAULT_SPREADSHEET_ID ใน Code.gs
 *    ALLOWED_EMAIL_DOMAINS         (ไม่บังคับ) จำกัดโดเมนอีเมล คั่นด้วยจุลภาค เช่น gmail.com,moph.go.th
 *    (ระบบสร้างเอง) DATA_VERSION, LAST_DATA_UPDATE
 *
 * 2) ชีต Settings — ค่าที่ SUPER_ADMIN แก้ไขได้จากหน้าเว็บ (บันทึก AuditLogs: SETTINGS_CHANGE)
 */

var THEME_OPTIONS = [
  'ipuc-vibrant', 'executive-blue', 'electric-blue', 'ocean-bright', 'healthcare-teal', 'government-navy',
  'finance-emerald', 'strategy-indigo', 'cyber-violet', 'tropical-green', 'vibrant-coral', 'sunset-orange',
  'royal-magenta', 'high-contrast-amber', 'modern-slate', 'warm-official', 'public-purple', 'lime-tech', 'crimson-gold'
];

function settingDefinitions_() {
  return [
    { key: 'PUBLIC_DASHBOARD', type: 'boolean', defaultValue: 'TRUE', isPublic: true,
      label: 'เปิด Dashboard สาธารณะ', description: 'อนุญาตให้ดู Dashboard ข้อมูลสรุประดับ Aggregated โดยไม่ต้องเข้าสู่ระบบ' },
    { key: 'ALLOW_REGISTRATION', type: 'boolean', defaultValue: 'TRUE', isPublic: true,
      label: 'เปิดรับสมัครผู้ใช้ใหม่', description: 'อนุญาตให้สมัครใช้งานด้วยบัญชี Google (ต้องรออนุมัติ)' },
    { key: 'ORG_NAME', type: 'text', defaultValue: 'โรงพยาบาลแม่สะเรียง', isPublic: true, maxLength: 150,
      label: 'ชื่อหน่วยงาน', description: 'ชื่อหน่วยงานที่แสดงบน Dashboard' },
    { key: 'DASHBOARD_THEME', type: 'select', defaultValue: 'ipuc-vibrant', isPublic: true, options: THEME_OPTIONS,
      label: 'ธีมสี Dashboard', description: 'ชุดสีตาม Official Web Design System (ใช้ทั้งระบบ)' },
    { key: 'DATA_SOURCE_NOTE', type: 'text', isPublic: true, maxLength: 500,
      defaultValue: 'ข้อมูลจากรายงาน Statement (STM) ผู้ป่วยในสิทธิ UC ของ สปสช. บันทึกโดยศูนย์รายได้ โรงพยาบาลแม่สะเรียง',
      label: 'หมายเหตุแหล่งข้อมูล', description: 'ข้อความแสดงท้าย Dashboard' },
    { key: 'MAX_IMPORT_ROWS', type: 'number', defaultValue: '5000', min: 1, max: 20000, isPublic: false,
      label: 'จำนวนแถวสูงสุดต่อการนำเข้า', description: 'จำกัดจำนวนแถวต่อไฟล์ เพื่อไม่ให้เกินเวลาประมวลผลของ Apps Script' },
    { key: 'ALLOW_HARD_DELETE', type: 'boolean', defaultValue: 'FALSE', isPublic: false,
      label: 'อนุญาตลบข้อมูลถาวร', description: 'เมื่อเปิด SUPER_ADMIN จะลบข้อมูลออกจากชีตถาวรได้ (ค่าเริ่มต้นคือ Soft Delete)' }
  ];
}

function getScriptConfig_() {
  var p = PropertiesService.getScriptProperties().getProperties();
  return {
    clientId: String(p.GOOGLE_CLIENT_ID || '').trim(),
    bootstrapEmail: normalizeEmail_(p.BOOTSTRAP_SUPER_ADMIN_EMAIL),
    allowedDomains: String(p.ALLOWED_EMAIL_DOMAINS || '').split(',')
      .map(function (d) { return d.trim().toLowerCase(); })
      .filter(Boolean)
  };
}

function isClientIdConfigured_(clientId) {
  return !!clientId && /\.apps\.googleusercontent\.com$/.test(clientId);
}

function parseSettingValue_(def, raw) {
  if (def.type === 'boolean') {
    if (raw === true || raw === false) return raw;
    var s = String(raw === undefined || raw === null || raw === '' ? def.defaultValue : raw).trim().toUpperCase();
    return s === 'TRUE' || s === '1' || s === 'YES';
  }
  if (def.type === 'number') {
    var n = Number(raw === '' || raw === null || raw === undefined ? def.defaultValue : raw);
    if (!isFinite(n)) n = Number(def.defaultValue);
    return Math.max(def.min, Math.min(def.max, Math.round(n)));
  }
  if (def.type === 'select') {
    var v = String(raw || '');
    return def.options.indexOf(v) !== -1 ? v : def.defaultValue;
  }
  var t = sanitizeText_(raw === undefined || raw === null ? def.defaultValue : raw, def.maxLength || 500);
  return t;
}

var _settingsMemo = null;

function getAllSettings_() {
  if (_settingsMemo) return _settingsMemo;
  var cache = CacheService.getScriptCache();
  var cached = cache.get('settings_v1');
  if (cached) {
    try {
      _settingsMemo = JSON.parse(cached);
      return _settingsMemo;
    } catch (e) { /* rebuild */ }
  }
  var byKey = {};
  readTable_('Settings').rows.forEach(function (r) { byKey[String(r.key).trim()] = r; });
  var out = {};
  settingDefinitions_().forEach(function (def) {
    var row = byKey[def.key];
    out[def.key] = {
      value: parseSettingValue_(def, row ? row.value : def.defaultValue),
      updated_at: row ? String(row.updated_at || '') : '',
      updated_by: row ? String(row.updated_by || '') : ''
    };
  });
  cache.put('settings_v1', JSON.stringify(out), 300);
  _settingsMemo = out;
  return out;
}

function clearSettingsCache_() {
  _settingsMemo = null;
  CacheService.getScriptCache().remove('settings_v1');
}

function getSetting_(key) {
  var s = getAllSettings_()[key];
  return s ? s.value : null;
}

function getPublicSettings_() {
  var all = getAllSettings_();
  var out = {};
  settingDefinitions_().forEach(function (def) {
    if (def.isPublic) out[def.key] = all[def.key].value;
  });
  return out;
}

/** เติม key ที่ขาดในชีต Settings ด้วยค่าเริ่มต้น (เรียกจาก ensureSchema_) */
function ensureDefaultSettings_() {
  var table = readTable_('Settings');
  var existing = {};
  table.rows.forEach(function (r) { existing[String(r.key).trim()] = true; });
  var now = nowIso_();
  var missing = settingDefinitions_().filter(function (d) { return !existing[d.key]; }).map(function (d) {
    return { key: d.key, value: d.defaultValue, description: d.description, updated_at: now, updated_by: 'SYSTEM' };
  });
  if (missing.length) {
    appendObjects_('Settings', missing);
    clearSettingsCache_();
  }
}

function handleGetSettings_(ctx) {
  if (!ctx.user || !hasRole_(ctx.user, 'ADMIN')) {
    return ok_({ settings: getPublicSettings_(), scope: 'public' });
  }
  var all = getAllSettings_();
  var cfg = getScriptConfig_();
  return ok_({
    scope: 'admin',
    editable: ctx.user.role === 'SUPER_ADMIN',
    settings: getPublicSettings_(),
    definitions: settingDefinitions_().map(function (def) {
      return {
        key: def.key,
        label: def.label,
        description: def.description,
        type: def.type,
        options: def.options || null,
        min: def.min, max: def.max,
        is_public: def.isPublic,
        value: all[def.key].value,
        updated_at: all[def.key].updated_at,
        updated_by: all[def.key].updated_by
      };
    }),
    script_config: {
      spreadsheet_id: getSpreadsheetId_(),
      google_client_id_configured: isClientIdConfigured_(cfg.clientId),
      bootstrap_email_configured: !!cfg.bootstrapEmail,
      allowed_email_domains: cfg.allowedDomains,
      session_idle_minutes: SESSION_IDLE_SECONDS / 60,
      app_version: APP_VERSION,
      last_data_update: PropertiesService.getScriptProperties().getProperty('LAST_DATA_UPDATE') || ''
    }
  });
}

function handleUpdateSettings_(ctx) {
  var input = ctx.payload.settings;
  if (!isPlainObject_(input) || !Object.keys(input).length) throw apiError_('BAD_REQUEST', 'ไม่พบค่าที่ต้องการบันทึก');

  var defs = {};
  settingDefinitions_().forEach(function (d) { defs[d.key] = d; });

  var errors = [];
  var next = {};
  Object.keys(input).forEach(function (key) {
    var def = defs[key];
    if (!def) {
      errors.push({ field: key, message: 'ไม่รู้จักค่าตั้งค่า ' + String(key).substring(0, 40) });
      return;
    }
    var raw = input[key];
    if (def.type === 'boolean') {
      var b = String(raw).toUpperCase();
      if (['TRUE', 'FALSE'].indexOf(b) === -1) errors.push({ field: key, message: def.label + ' ต้องเป็น TRUE หรือ FALSE' });
      else next[key] = b;
    } else if (def.type === 'number') {
      var n = Number(raw);
      if (!isFinite(n) || Math.round(n) !== n || n < def.min || n > def.max) {
        errors.push({ field: key, message: def.label + ' ต้องเป็นจำนวนเต็มระหว่าง ' + def.min + '–' + def.max });
      } else next[key] = String(n);
    } else if (def.type === 'select') {
      if (def.options.indexOf(String(raw)) === -1) errors.push({ field: key, message: def.label + ' ไม่อยู่ในตัวเลือกที่กำหนด' });
      else next[key] = String(raw);
    } else {
      var t = sanitizeText_(raw, def.maxLength || 500);
      if (!t) errors.push({ field: key, message: 'กรุณากรอก ' + def.label });
      else next[key] = t;
    }
  });
  if (errors.length) throw apiError_('VALIDATION_ERROR', 'ค่าตั้งค่าไม่ถูกต้อง', errors);

  return withLock_(function () {
    var table = readTable_('Settings');
    var byKey = {};
    table.rows.forEach(function (r) { byKey[String(r.key).trim()] = r; });
    var now = nowIso_();
    var updates = [];
    var inserts = [];
    var logs = [];

    Object.keys(next).forEach(function (key) {
      var row = byKey[key];
      var oldValue = row ? String(row.value) : '';
      if (row && oldValue === next[key]) return;
      if (row) {
        row.value = next[key];
        row.updated_at = now;
        row.updated_by = ctx.user.email;
        updates.push(row);
      } else {
        inserts.push({ key: key, value: next[key], description: defs[key].description, updated_at: now, updated_by: ctx.user.email });
      }
      logs.push({
        email: ctx.user.email, action: 'SETTINGS_CHANGE', record_id: key,
        old_value: { key: key, value: oldValue }, new_value: { key: key, value: next[key] }, user_agent: ctx.userAgent
      });
    });

    updateRows_(table, updates);
    appendObjects_('Settings', inserts);
    clearSettingsCache_();
    writeAuditLogs_(logs);

    return ok_({ changed: logs.length, settings: getPublicSettings_() },
      logs.length ? 'บันทึกการตั้งค่าเรียบร้อยแล้ว' : 'ไม่มีการเปลี่ยนแปลงค่าตั้งค่า');
  });
}
