/**
 * Auth.gs — ยืนยันตัวตนด้วย Google Identity Services (ID Token) ที่ Backend
 * Frontend ส่งเฉพาะ credential (JWT) มา — Backend เป็นผู้ตรวจสอบ aud / iss / exp / email_verified
 * และตัดสินสิทธิ์จากชีต Users เท่านั้น
 */

var NAME_PATTERN = /^[฀-๿A-Za-z][฀-๿A-Za-z .'\-]*$/;

function verifyGoogleIdToken_(credential) {
  var cfg = getScriptConfig_();
  if (!isClientIdConfigured_(cfg.clientId)) {
    throw apiError_('INTERNAL_ERROR', 'ผู้ดูแลระบบยังไม่ได้ตั้งค่า GOOGLE_CLIENT_ID ใน Script Properties');
  }
  if (typeof credential !== 'string' || credential.length < 100 || credential.length > 4096 ||
      credential.split('.').length !== 3) {
    throw apiError_('UNAUTHORIZED', 'ข้อมูลยืนยันตัวตนจาก Google ไม่ถูกต้อง');
  }

  var resp = UrlFetchApp.fetch(
    'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential),
    { muteHttpExceptions: true, followRedirects: true }
  );
  if (resp.getResponseCode() !== 200) {
    throw apiError_('UNAUTHORIZED', 'ไม่สามารถยืนยันตัวตนกับ Google ได้ หรือข้อมูลยืนยันหมดอายุ กรุณาลองใหม่');
  }

  var info;
  try {
    info = JSON.parse(resp.getContentText());
  } catch (e) {
    throw apiError_('UNAUTHORIZED', 'ไม่สามารถอ่านผลการยืนยันตัวตนจาก Google ได้');
  }

  if (info.aud !== cfg.clientId) {
    throw apiError_('UNAUTHORIZED', 'Google Client ID ไม่ตรงกับที่ระบบกำหนด');
  }
  if (info.iss !== 'accounts.google.com' && info.iss !== 'https://accounts.google.com') {
    throw apiError_('UNAUTHORIZED', 'ผู้ออก token ไม่ถูกต้อง');
  }
  if (!info.exp || Number(info.exp) * 1000 < Date.now()) {
    throw apiError_('UNAUTHORIZED', 'ข้อมูลยืนยันตัวตนหมดอายุ กรุณาลองใหม่');
  }
  if (String(info.email_verified) !== 'true') {
    throw apiError_('UNAUTHORIZED', 'อีเมล Google นี้ยังไม่ได้รับการยืนยัน');
  }

  var email = normalizeEmail_(info.email);
  if (!isValidEmail_(email)) throw apiError_('UNAUTHORIZED', 'ไม่พบอีเมลจาก Google');

  if (cfg.allowedDomains.length) {
    var domain = email.split('@')[1];
    if (cfg.allowedDomains.indexOf(domain) === -1) {
      throw apiError_('FORBIDDEN', 'โดเมนอีเมลนี้ไม่ได้รับอนุญาตให้ใช้งานระบบ');
    }
  }

  return {
    email: email,
    sub: String(info.sub || ''),
    given_name: String(info.given_name || ''),
    family_name: String(info.family_name || ''),
    picture: /^https:\/\/[a-z0-9.-]+\.googleusercontent\.com\//i.test(String(info.picture || '')) ? String(info.picture) : ''
  };
}

/* ------------------------- Session guard ------------------------- */

function authenticate_(ctx, minRole) {
  if (!ctx.token) throw apiError_('UNAUTHORIZED', 'กรุณาเข้าสู่ระบบ');
  var session = getSession_(ctx.token);
  if (!session) throw apiError_('SESSION_EXPIRED', 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');

  var user = findUserByEmail_(session.email);
  if (!user) {
    destroySession_(ctx.token);
    throw apiError_('USER_NOT_FOUND', 'ไม่พบบัญชีผู้ใช้');
  }
  assertUserActive_(user, ctx.token);

  if (minRole && !hasRole_(user, minRole)) {
    throw apiError_('FORBIDDEN', 'ไม่มีสิทธิ์ใช้งาน');
  }
  touchSession_(ctx.token, session);
  ctx.session = session;
  ctx.user = user;
}

function tryAuthenticate_(ctx) {
  if (!ctx.token) return;
  try {
    authenticate_(ctx, null);
  } catch (e) {
    ctx.user = null;
    ctx.session = null;
  }
}

function assertUserActive_(user, token) {
  if (user.status === 'approved' && ROLE_LEVELS[user.role]) return;
  if (token) destroySession_(token);
  if (user.status === 'pending') {
    throw apiError_('PENDING_APPROVAL', 'บัญชีของคุณอยู่ระหว่างรอผู้ดูแลระบบอนุมัติ');
  }
  if (user.status === 'suspended') {
    throw apiError_('USER_SUSPENDED', 'บัญชีของคุณถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ');
  }
  if (user.status === 'rejected') {
    throw apiError_('USER_REJECTED', 'บัญชีของคุณไม่ได้รับการอนุมัติ กรุณาติดต่อผู้ดูแลระบบ');
  }
  throw apiError_('FORBIDDEN', 'สถานะหรือสิทธิ์ของบัญชีไม่ถูกต้อง กรุณาติดต่อผู้ดูแลระบบ');
}

function publicUser_(user, picture) {
  return {
    user_id: user.user_id,
    email: user.email,
    first_name: user.first_name,
    last_name: user.last_name,
    full_name: (String(user.first_name || '') + ' ' + String(user.last_name || '')).trim(),
    role: user.role,
    status: user.status,
    last_login: user.last_login,
    approved_at: user.approved_at,
    picture: picture || '',
    permissions: permissionsFor_(user.role)
  };
}

function sanitizeName_(value) {
  return sanitizeText_(value, 100);
}

/* --------------------------- Handlers --------------------------- */

function handleLogin_(ctx) {
  var identity;
  try {
    identity = verifyGoogleIdToken_(ctx.payload.credential);
  } catch (err) {
    logLoginFailed_('', ctx, err);
    throw err;
  }

  var user = applyBootstrap_(identity, identity.given_name, identity.family_name, ctx) || findUserByEmail_(identity.email);
  if (!user) {
    logLoginFailed_(identity.email, ctx, 'USER_NOT_FOUND');
    throw apiError_('USER_NOT_FOUND', 'ยังไม่มีบัญชีในระบบ กรุณาสมัครใช้งานก่อน');
  }

  try {
    assertUserActive_(user, null);
  } catch (err2) {
    logLoginFailed_(identity.email, ctx, err2);
    throw err2;
  }

  var now = nowIso_();
  updateUserFields_(user.user_id, { last_login: now });
  user.last_login = now;

  var session = createSession_(user);
  writeAuditLog_({
    email: user.email,
    action: 'LOGIN_SUCCESS',
    record_id: user.user_id,
    new_value: { role: user.role },
    user_agent: ctx.userAgent
  });

  return ok_({
    token: session.token,
    expires_at: session.expires_at,
    idle_timeout_minutes: session.idle_timeout_minutes,
    user: publicUser_(user, identity.picture)
  }, 'เข้าสู่ระบบสำเร็จ');
}

function handleRegister_(ctx) {
  if (!getSetting_('ALLOW_REGISTRATION')) {
    throw apiError_('FORBIDDEN', 'ระบบปิดรับสมัครผู้ใช้ใหม่ชั่วคราว กรุณาติดต่อผู้ดูแลระบบ');
  }

  var firstName = sanitizeName_(ctx.payload.first_name);
  var lastName = sanitizeName_(ctx.payload.last_name);
  var errors = [];
  if (!firstName) errors.push({ field: 'first_name', message: 'กรุณากรอกชื่อ' });
  else if (!NAME_PATTERN.test(firstName)) errors.push({ field: 'first_name', message: 'ชื่อมีอักขระที่ไม่อนุญาต' });
  if (!lastName) errors.push({ field: 'last_name', message: 'กรุณากรอกนามสกุล' });
  else if (!NAME_PATTERN.test(lastName)) errors.push({ field: 'last_name', message: 'นามสกุลมีอักขระที่ไม่อนุญาต' });
  if (errors.length) throw apiError_('VALIDATION_ERROR', 'ข้อมูลการสมัครไม่ถูกต้อง', errors);

  var identity = verifyGoogleIdToken_(ctx.payload.credential);

  var boot = applyBootstrap_(identity, firstName, lastName, ctx);
  if (boot) {
    var now0 = nowIso_();
    updateUserFields_(boot.user_id, { last_login: now0 });
    boot.last_login = now0;
    var s = createSession_(boot);
    writeAuditLog_({ email: boot.email, action: 'LOGIN_SUCCESS', record_id: boot.user_id, new_value: { role: boot.role }, user_agent: ctx.userAgent });
    return ok_({
      status: 'approved',
      auto_login: true,
      token: s.token,
      expires_at: s.expires_at,
      idle_timeout_minutes: s.idle_timeout_minutes,
      user: publicUser_(boot, identity.picture)
    }, 'ลงทะเบียนผู้ดูแลระบบสูงสุด (SUPER_ADMIN) สำเร็จ');
  }

  return withLock_(function () {
    var existing = findUserByEmail_(identity.email);
    if (existing) {
      if (existing.status === 'approved') throw apiError_('DUPLICATE', 'อีเมลนี้มีบัญชีที่อนุมัติแล้ว กรุณาเข้าสู่ระบบ');
      if (existing.status === 'pending') throw apiError_('PENDING_APPROVAL', 'บัญชีของคุณอยู่ระหว่างรอผู้ดูแลระบบอนุมัติ');
      if (existing.status === 'suspended') throw apiError_('USER_SUSPENDED', 'บัญชีของคุณถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ');
      throw apiError_('USER_REJECTED', 'บัญชีของคุณไม่ได้รับการอนุมัติ กรุณาติดต่อผู้ดูแลระบบ');
    }
    var now = nowIso_();
    var user = {
      user_id: uuid_(),
      email: identity.email,
      first_name: firstName,
      last_name: lastName,
      role: 'VIEWER',
      status: 'pending',
      created_at: now,
      approved_at: '',
      approved_by: '',
      last_login: ''
    };
    appendObjects_('Users', [user]);
    writeAuditLog_({
      email: user.email,
      action: 'REGISTER',
      record_id: user.user_id,
      new_value: { first_name: firstName, last_name: lastName, role: user.role, status: user.status },
      user_agent: ctx.userAgent
    });
    return ok_({ status: 'pending', email: user.email }, 'บัญชีของคุณอยู่ระหว่างรอผู้ดูแลระบบอนุมัติ');
  });
}

function handleLogout_(ctx) {
  if (ctx.token) {
    var session = getSession_(ctx.token);
    destroySession_(ctx.token);
    if (session) {
      writeAuditLog_({ email: session.email, action: 'LOGOUT', record_id: session.user_id, user_agent: ctx.userAgent });
    }
  }
  return ok_({}, 'ออกจากระบบแล้ว');
}

function handleGetMe_(ctx) {
  return ok_({
    user: publicUser_(ctx.user),
    idle_timeout_minutes: SESSION_IDLE_SECONDS / 60
  });
}

/**
 * SUPER_ADMIN คนแรก: ถ้าอีเมลตรงกับ Script Property BOOTSTRAP_SUPER_ADMIN_EMAIL
 * และระบบยังไม่มี SUPER_ADMIN ที่อนุมัติแล้ว → สร้าง/ยกระดับเป็น SUPER_ADMIN อัตโนมัติ
 */
function applyBootstrap_(identity, firstName, lastName, ctx) {
  var cfg = getScriptConfig_();
  if (!cfg.bootstrapEmail || cfg.bootstrapEmail !== identity.email) return null;

  return withLock_(function () {
    var table = readTable_('Users');
    var hasSuper = table.rows.some(function (r) { return r.role === 'SUPER_ADMIN' && r.status === 'approved'; });
    if (hasSuper) return null;

    var now = nowIso_();
    var existing = null;
    table.rows.forEach(function (r) {
      if (normalizeEmail_(r.email) === identity.email) existing = r;
    });

    if (existing) {
      var old = { role: existing.role, status: existing.status };
      existing.role = 'SUPER_ADMIN';
      existing.status = 'approved';
      existing.approved_at = now;
      existing.approved_by = 'SYSTEM_BOOTSTRAP';
      updateRows_(table, [existing]);
      writeAuditLog_({
        email: identity.email, action: 'APPROVE_USER', record_id: existing.user_id,
        old_value: old, new_value: { role: 'SUPER_ADMIN', status: 'approved', bootstrap: true }, user_agent: ctx.userAgent
      });
      return existing;
    }

    var user = {
      user_id: uuid_(),
      email: identity.email,
      first_name: sanitizeName_(firstName) || 'Super',
      last_name: sanitizeName_(lastName) || 'Admin',
      role: 'SUPER_ADMIN',
      status: 'approved',
      created_at: now,
      approved_at: now,
      approved_by: 'SYSTEM_BOOTSTRAP',
      last_login: ''
    };
    appendObjects_('Users', [user]);
    writeAuditLog_({
      email: identity.email, action: 'REGISTER', record_id: user.user_id,
      new_value: { role: user.role, status: user.status, bootstrap: true }, user_agent: ctx.userAgent
    });
    return user;
  });
}

/** จำกัดการบันทึก LOGIN_FAILED ไม่เกิน 30 รายการ/นาที ป้องกันการยิงคำขอเพื่อทำให้ Log ล้น */
function logLoginFailed_(email, ctx, reason) {
  var cache = CacheService.getScriptCache();
  var key = 'login_failed_' + Math.floor(Date.now() / 60000);
  var count = Number(cache.get(key) || 0);
  if (count >= 30) return;
  cache.put(key, String(count + 1), 120);
  var reasonText = typeof reason === 'string' ? reason : (reason && (reason.apiCode || reason.message)) || 'UNKNOWN';
  writeAuditLog_({
    email: email || 'unknown',
    action: 'LOGIN_FAILED',
    new_value: { reason: reasonText },
    user_agent: ctx.userAgent
  });
}
