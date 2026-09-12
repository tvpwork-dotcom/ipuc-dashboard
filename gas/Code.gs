/**
 * IP.UC Performance Analytics Dashboard — Google Apps Script API
 * Dashboard วิเคราะห์ผลงานบริการผู้ป่วยในสิทธิ UC โรงพยาบาลแม่สะเรียง
 * พัฒนาโดย ศูนย์รายได้ โรงพยาบาลแม่สะเรียง
 *
 * Code.gs — จุดเข้าใช้งาน Web App (doGet/doPost), ตาราง Route และฟังก์ชันติดตั้งระบบ
 *
 * ทุกคำขอจาก Frontend ส่งเป็น POST (Content-Type: text/plain) รูปแบบ
 *   { "action": "getDashboard", "token": "<session token>", "payload": {...}, "client": { "ua": "..." } }
 * และได้รับคำตอบ
 *   { "success": true, "message": "OK", "data": {...} }
 *   { "success": false, "code": "FORBIDDEN", "message": "ไม่มีสิทธิ์ใช้งาน" }
 */

var APP_NAME = 'IP.UC Performance Analytics Dashboard';
var APP_VERSION = '1.0.0';
var DEFAULT_SPREADSHEET_ID = '1rUx3pUu7FBzAPxLBoiKKXFricZnt145cCIT58f70Ibc';
var MAX_REQUEST_CHARS = 10 * 1024 * 1024;

/** Health check — เปิด URL ของ Web App ใน Browser เพื่อทดสอบว่า Deploy สำเร็จ */
function doGet() {
  return jsonOutput_(ok_({ name: APP_NAME, version: APP_VERSION, time: nowIso_() }, 'IP.UC API พร้อมใช้งาน'));
}

function doPost(e) {
  var req = null;
  try {
    if (!e || !e.postData || typeof e.postData.contents !== 'string' || !e.postData.contents) {
      throw apiError_('BAD_REQUEST', 'ไม่พบข้อมูลคำขอ');
    }
    if (e.postData.contents.length > MAX_REQUEST_CHARS) {
      throw apiError_('BAD_REQUEST', 'ข้อมูลคำขอมีขนาดใหญ่เกินกำหนด');
    }
    try {
      req = JSON.parse(e.postData.contents);
    } catch (parseErr) {
      throw apiError_('BAD_REQUEST', 'รูปแบบ JSON ไม่ถูกต้อง');
    }
    if (!isPlainObject_(req)) throw apiError_('BAD_REQUEST', 'รูปแบบคำขอไม่ถูกต้อง');
    return jsonOutput_(dispatch_(req));
  } catch (err) {
    return jsonOutput_(errorResponse_(err, req));
  }
}

/**
 * auth:
 *   public    — ไม่ต้องมี Session
 *   optional  — มี Session ก็ได้ ไม่มีก็ได้ (ผลลัพธ์ต่างกันตามสิทธิ์)
 *   dashboard — สาธารณะเมื่อ Settings.PUBLIC_DASHBOARD = TRUE มิฉะนั้นต้อง Login
 *   session   — ต้องมี Session ที่ใช้งานได้ + status approved + role >= minRole
 */
function getRoutes_() {
  return {
    login:            { auth: 'public', handler: handleLogin_ },
    register:         { auth: 'public', handler: handleRegister_ },
    logout:           { auth: 'public', handler: handleLogout_ },
    getMe:            { auth: 'session', minRole: 'VIEWER', handler: handleGetMe_ },

    getDashboard:     { auth: 'dashboard', handler: handleGetDashboard_ },
    getFilterOptions: { auth: 'dashboard', handler: handleGetFilterOptions_ },

    getData:          { auth: 'session', minRole: 'EDITOR', handler: handleGetData_ },
    importData:       { auth: 'session', minRole: 'EDITOR', handler: handleImportData_ },
    addData:          { auth: 'session', minRole: 'EDITOR', handler: handleAddData_ },
    updateData:       { auth: 'session', minRole: 'EDITOR', handler: handleUpdateData_ },
    deleteData:       { auth: 'session', minRole: 'ADMIN', handler: handleDeleteData_ },

    getUsers:         { auth: 'session', minRole: 'ADMIN', handler: handleGetUsers_ },
    approveUser:      { auth: 'session', minRole: 'ADMIN', handler: handleApproveUser_ },
    rejectUser:       { auth: 'session', minRole: 'ADMIN', handler: handleRejectUser_ },
    suspendUser:      { auth: 'session', minRole: 'ADMIN', handler: handleSuspendUser_ },
    changeUserRole:   { auth: 'session', minRole: 'ADMIN', handler: handleChangeUserRole_ },

    getImportLogs:    { auth: 'session', minRole: 'ADMIN', handler: handleGetImportLogs_ },
    getAuditLogs:     { auth: 'session', minRole: 'ADMIN', handler: handleGetAuditLogs_ },

    getSettings:      { auth: 'optional', handler: handleGetSettings_ },
    updateSettings:   { auth: 'session', minRole: 'SUPER_ADMIN', handler: handleUpdateSettings_ }
  };
}

function dispatch_(req) {
  var action = typeof req.action === 'string' ? req.action : '';
  var routes = getRoutes_();
  if (!action || !Object.prototype.hasOwnProperty.call(routes, action)) {
    throw apiError_('BAD_REQUEST', 'ไม่รู้จัก action ที่ร้องขอ');
  }
  var route = routes[action];

  ensureSchema_(false);

  var client = isPlainObject_(req.client) ? req.client : {};
  var ctx = {
    action: action,
    token: typeof req.token === 'string' ? req.token : '',
    payload: isPlainObject_(req.payload) ? req.payload : {},
    userAgent: sanitizeText_(client.ua, 300),
    user: null,
    session: null
  };

  if (route.auth === 'session') {
    authenticate_(ctx, route.minRole);
  } else if (route.auth === 'optional') {
    tryAuthenticate_(ctx);
  } else if (route.auth === 'dashboard') {
    if (getSetting_('PUBLIC_DASHBOARD')) tryAuthenticate_(ctx);
    else authenticate_(ctx, 'VIEWER');
  }

  return route.handler(ctx);
}

function errorResponse_(err, req) {
  if (err && err.apiCode) {
    var res = { success: false, code: err.apiCode, message: err.message };
    if (err.details) res.details = err.details;
    return res;
  }
  console.error('INTERNAL_ERROR action=' + (req && req.action), err && err.stack ? err.stack : err);
  return { success: false, code: 'INTERNAL_ERROR', message: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่อีกครั้ง' };
}

/* ------------------------------------------------------------------------ */
/*  ฟังก์ชันสำหรับผู้ติดตั้ง — เลือกชื่อฟังก์ชันในแถบเครื่องมือแล้วกด Run         */
/* ------------------------------------------------------------------------ */

/**
 * รันครั้งแรกหลังวางโค้ด: สร้างชีตและ Header ทั้งหมด, สร้างค่า Settings เริ่มต้น
 * และตรวจสอบ Script Properties ที่จำเป็น
 */
function setup() {
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SPREADSHEET_ID')) props.setProperty('SPREADSHEET_ID', DEFAULT_SPREADSHEET_ID);
  CacheService.getScriptCache().removeAll(['schema_ok_v' + APP_VERSION, 'settings_v1']);
  ensureSchema_(true);
  checkConfiguration();
}

/** แสดงสถานะการตั้งค่าใน Execution log */
function checkConfiguration() {
  var cfg = getScriptConfig_();
  var lines = [
    'SPREADSHEET_ID: ' + getSpreadsheetId_(),
    'Spreadsheet name: ' + getSpreadsheet_().getName(),
    'GOOGLE_CLIENT_ID: ' + (isClientIdConfigured_(cfg.clientId) ? 'ตั้งค่าแล้ว' : 'ยังไม่ได้ตั้งค่า (จำเป็น)'),
    'BOOTSTRAP_SUPER_ADMIN_EMAIL: ' + (cfg.bootstrapEmail || 'ยังไม่ได้ตั้งค่า (จำเป็นสำหรับ SUPER_ADMIN คนแรก)'),
    'ALLOWED_EMAIL_DOMAINS: ' + (cfg.allowedDomains.length ? cfg.allowedDomains.join(', ') : '(ไม่จำกัด)')
  ];
  Logger.log(lines.join('\n'));
  return lines;
}

/** ใช้เมื่อแก้ไขชีต Data ด้วยมือ เพื่อล้าง Cache ของ Dashboard และเติม record_id ที่ว่าง */
function refreshDataCache() {
  var filled = fillMissingRecordIds_();
  markDataChanged_();
  Logger.log('ล้าง Cache แล้ว เติม record_id ' + filled + ' แถว');
}
