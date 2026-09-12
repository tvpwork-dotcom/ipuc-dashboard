/**
 * api.js — เรียก Google Apps Script Web App (endpoint เดียว, route ด้วย action)
 * ใช้ POST + Content-Type: text/plain เพื่อไม่ให้เกิด CORS preflight กับ Apps Script
 * Browser ไม่เขียน Google Sheets โดยตรง — ทุกการอ่าน/เขียนผ่าน API นี้เท่านั้น
 *
 * Apps Script ส่งผลลัพธ์ผ่านการ redirect ไปที่ script.googleusercontent.com ซึ่งบางครั้งตอบ 404/5xx ชั่วคราว
 * - action อ่านอย่างเดียว (get*) จะลองใหม่อัตโนมัติ
 * - action ที่เขียนข้อมูลจะไม่ลองใหม่ (ป้องกันทำรายการซ้ำ) แต่แจ้ง UNCERTAIN_RESULT ให้โหลดข้อมูลตรวจสอบ
 */
const API = (() => {
  "use strict";

  class ApiError extends Error {
    constructor(code, message, details, retryable = false) {
      super(message);
      this.name = "ApiError";
      this.code = code;
      this.details = details || null;
      this.retryable = retryable;
    }
  }

  const SESSION_CODES = ["SESSION_EXPIRED", "UNAUTHORIZED", "USER_NOT_FOUND", "PENDING_APPROVAL", "USER_SUSPENDED", "USER_REJECTED"];
  const READ_ACTIONS = new Set(["getMe", "getDashboard", "getFilterOptions", "getData", "getUsers", "getImportLogs", "getAuditLogs", "getSettings"]);
  const RETRYABLE_HTTP = [404, 408, 429, 500, 502, 503, 504];
  const RETRY_DELAYS_MS = [800, 2000];
  const hooks = { getToken: null, onActivity: null, onSessionInvalid: null };

  function isConfigured() {
    const url = String(CONFIG.GAS_API_URL || "");
    return /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url)
      || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);
  }

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /** ส่งคำขอ 1 ครั้ง — คืน JSON ที่ parse แล้ว หรือโยน ApiError (retryable = ปัญหาการรับส่งชั่วคราว) */
  async function send(body, timeout) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    let response;
    try {
      response = await fetch(CONFIG.GAS_API_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(body),
        redirect: "follow",
        credentials: "omit",
        cache: "no-store",
        signal: controller.signal
      });
    } catch (err) {
      if (err.name === "AbortError") throw new ApiError("TIMEOUT", "หมดเวลารอการตอบกลับจากเซิร์ฟเวอร์ กรุณาลองใหม่อีกครั้ง");
      throw new ApiError("NETWORK_ERROR", "ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาตรวจสอบอินเทอร์เน็ต หรือการ Deploy Web App (Who has access: Anyone)", null, true);
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw new ApiError(`HTTP_${response.status}`, `เซิร์ฟเวอร์ตอบกลับผิดพลาด (HTTP ${response.status})`, null, RETRYABLE_HTTP.includes(response.status));
    }
    try {
      return await response.json();
    } catch (err) {
      throw new ApiError("BAD_RESPONSE", "รูปแบบข้อมูลตอบกลับไม่ถูกต้อง กรุณาตรวจสอบ URL และการ Deploy ของ Apps Script", null, true);
    }
  }

  /**
   * @param {string} action
   * @param {object} payload
   * @param {{timeout?: number, auth?: boolean, token?: string}} options
   * @returns {Promise<{success: true, message: string, data: any}>}
   */
  async function call(action, payload = {}, options = {}) {
    if (!isConfigured()) {
      throw new ApiError("NOT_CONFIGURED", "ยังไม่ได้ตั้งค่า GAS_API_URL ในไฟล์ js/config.js");
    }
    const { timeout = CONFIG.REQUEST_TIMEOUT_MS, auth = true } = options;
    const token = options.token || (auth && hooks.getToken ? hooks.getToken() : null);
    const isRead = READ_ACTIONS.has(action);

    const body = {
      action,
      payload,
      client: { ua: navigator.userAgent.slice(0, 300), app_version: CONFIG.VERSION }
    };
    if (token) body.token = token;

    let json;
    for (let attempt = 0; ; attempt++) {
      try {
        json = await send(body, timeout);
        break;
      } catch (err) {
        if (isRead && err.retryable && attempt < RETRY_DELAYS_MS.length) {
          await wait(RETRY_DELAYS_MS[attempt]);
          continue;
        }
        if (!isRead && err.retryable && err.code !== "NETWORK_ERROR") {
          throw new ApiError("UNCERTAIN_RESULT",
            `ไม่ได้รับผลตอบกลับจากเซิร์ฟเวอร์ (${err.message}) — การทำรายการอาจบันทึกสำเร็จแล้ว กรุณาโหลดข้อมูลใหม่เพื่อตรวจสอบก่อนทำซ้ำ`);
        }
        throw err;
      }
    }

    if (!json || json.success !== true) {
      const error = new ApiError(json?.code || "INTERNAL_ERROR", json?.message || "เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ", json?.details);
      if (token && SESSION_CODES.includes(error.code) && hooks.onSessionInvalid) hooks.onSessionInvalid(error);
      throw error;
    }

    if (token && hooks.onActivity) hooks.onActivity();
    return json;
  }

  /** ข้อความผิดพลาดพร้อมรายละเอียด (ถ้ามี) สำหรับแสดงผล */
  function describeError(err) {
    if (!err) return "เกิดข้อผิดพลาด";
    const details = Array.isArray(err.details) ? err.details.map((d) => d.message || "").filter(Boolean) : [];
    return details.length ? `${err.message}: ${details.slice(0, 5).join(" · ")}` : err.message;
  }

  return { call, isConfigured, ApiError, hooks, describeError, SESSION_CODES };
})();
