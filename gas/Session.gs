/**
 * Session.gs — Session Token เก็บใน CacheService
 * - Token = Utilities.getUuid() + Utilities.getUuid()
 * - หมดอายุเมื่อไม่มีการใช้งาน 60 นาที (ต่ออายุทุกครั้งที่เรียก API สำเร็จ)
 * - อายุสูงสุด 8 ชั่วโมงนับจาก Login แม้จะใช้งานต่อเนื่อง
 * - Logout ลบ Token ออกจาก Cache ทันที
 */

var SESSION_IDLE_SECONDS = 3600;
var SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000;
var SESSION_PREFIX = 'ipuc_sess_';

function createSession_(user) {
  var token = Utilities.getUuid() + Utilities.getUuid();
  var now = Date.now();
  var session = { user_id: user.user_id, email: normalizeEmail_(user.email), created_at: now, last_seen: now };
  CacheService.getScriptCache().put(SESSION_PREFIX + token, JSON.stringify(session), SESSION_IDLE_SECONDS);
  return {
    token: token,
    expires_at: new Date(now + SESSION_IDLE_SECONDS * 1000).toISOString(),
    idle_timeout_minutes: SESSION_IDLE_SECONDS / 60
  };
}

function isValidTokenFormat_(token) {
  return typeof token === 'string' && /^[0-9a-f-]{72}$/i.test(token);
}

function getSession_(token) {
  if (!isValidTokenFormat_(token)) return null;
  var raw = CacheService.getScriptCache().get(SESSION_PREFIX + token);
  if (!raw) return null;
  var session;
  try {
    session = JSON.parse(raw);
  } catch (e) {
    destroySession_(token);
    return null;
  }
  if (!session || !session.email || Date.now() - Number(session.created_at || 0) > SESSION_MAX_AGE_MS) {
    destroySession_(token);
    return null;
  }
  return session;
}

function touchSession_(token, session) {
  session.last_seen = Date.now();
  CacheService.getScriptCache().put(SESSION_PREFIX + token, JSON.stringify(session), SESSION_IDLE_SECONDS);
}

function destroySession_(token) {
  if (isValidTokenFormat_(token)) CacheService.getScriptCache().remove(SESSION_PREFIX + token);
}
