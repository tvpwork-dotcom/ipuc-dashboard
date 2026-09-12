/**
 * config.js — ค่าตั้งค่าของ Frontend (แยกจาก Logic)
 * ⚠️ ห้ามใส่ secret ใด ๆ ในไฟล์นี้ — ไฟล์นี้เผยแพร่สาธารณะบน GitHub Pages
 *    GOOGLE_CLIENT_ID เป็นค่าสาธารณะ (ไม่ใช่ Client Secret) และ Backend ตรวจสอบซ้ำเสมอ
 */
const CONFIG = Object.freeze({
  SYSTEM_NAME: "IP.UC Performance Analytics Dashboard",
  SYSTEM_NAME_TH: "Dashboard วิเคราะห์ผลงานบริการผู้ป่วยในสิทธิ UC โรงพยาบาลแม่สะเรียง",
  ORGANIZATION: "โรงพยาบาลแม่สะเรียง",
  DEVELOPER: "ศูนย์รายได้ โรงพยาบาลแม่สะเรียง",
  VERSION: "1.0.0",

  /* Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client IDs (Web application) */
  GOOGLE_CLIENT_ID: "455580482874-f0n1mu9bf44e2rf5uu54blevvft4lh30.apps.googleusercontent.com",

  /* Google Apps Script → Deploy → Web app URL (ลงท้ายด้วย /exec) */
  GAS_API_URL: "https://script.google.com/macros/s/AKfycbwKVQlUGCDB-fDE8XCKGdovzU8vbmpxFMnjFHS0KY2IMzQlOOEJ5Z_eGVHcc-b157NB/exec",

  /* ธีมเริ่มต้นก่อนโหลดค่าจาก Settings (ดูรายชื่อใน css/style.css) */
  DEFAULT_THEME: "ipuc-vibrant",

  /* "auto" = แสดงข้อมูลตัวอย่างเมื่อยังไม่ได้ตั้งค่า GAS_API_URL (มีป้ายแจ้งชัดเจน), "off" = ปิด */
  DEMO_MODE: "auto",

  REQUEST_TIMEOUT_MS: 45000,
  IMPORT_TIMEOUT_MS: 300000,
  MAX_IMPORT_ROWS: 5000,
  MAX_IMPORT_FILE_MB: 10,
  SESSION_IDLE_MINUTES: 60,
  TABLE_PAGE_SIZE: 10
});
