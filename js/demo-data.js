/**
 * demo-data.js — ข้อมูลจำลองสำหรับแสดงรูปแบบ Dashboard ก่อนตั้งค่า GAS_API_URL เท่านั้น
 * ใช้เมื่อ CONFIG.DEMO_MODE = "auto" และยังไม่ได้ตั้งค่า API (หน้าเว็บจะแสดงป้าย "โหมดข้อมูลตัวอย่าง")
 * ตัวเลขทั้งหมดสุ่มแบบกำหนด seed — ไม่ใช่ข้อมูลจริงของโรงพยาบาล
 */
const DemoData = (() => {
  "use strict";

  const COLUMNS = ["stm_period", "month_code", "fiscal_year", "service_type", "br_after_deduction", "br_k", "service_count", "adj_rw", "compensation"];

  const TYPES = [
    { name: "IP ในเขต", count: [380, 460], cmi: [1.02, 1.2], rate: 8350, k: 0.97 },
    { name: "IP ข้ามเขต", count: [22, 40], cmi: [1.35, 1.85], rate: 9600, k: 1 },
    { name: "ODS", count: [14, 30], cmi: [0.45, 0.7], rate: 8350, k: 0.97 },
    { name: "HOMEWARD", count: [4, 14], cmi: [0.8, 1.15], rate: 8350, k: 0.97 },
    { name: "NB <= 1,500", count: [1, 5], cmi: [3.2, 6.1], rate: 8350, k: 0.97 },
    { name: "NB-HC", count: [1, 4], cmi: [1.4, 2.8], rate: 8350, k: 0.97 },
    { name: "UCEP ภาครัฐ", count: [2, 9], cmi: [1.8, 2.7], rate: 10500, k: 1 },
    { name: "อื่น ๆ", count: [5, 18], cmi: [0.55, 0.95], rate: 8350, k: 0.97 }
  ];

  const YEARS = [
    { fy: 2567, months: 12, growth: 1 },
    { fy: 2568, months: 12, growth: 1.06 },
    { fy: 2569, months: 11, growth: 1.11 }
  ];

  function mulberry32(seed) {
    let a = seed;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function generateRows() {
    const rand = mulberry32(2569);
    const between = ([a, b]) => a + (b - a) * rand();
    const rows = [];
    YEARS.forEach((y) => {
      U.FISCAL_MONTHS.slice(0, y.months).forEach((mm, i) => {
        const calendarBE = Number(mm) >= 10 ? y.fy - 1 : y.fy;
        const code = String(calendarBE - 2500).padStart(2, "0") + mm;
        const season = 1 + 0.13 * Math.sin(((i - 5) / 12) * Math.PI * 2);
        TYPES.forEach((t) => {
          const count = Math.max(1, Math.round(between(t.count) * season * y.growth));
          const cmi = between(t.cmi) * (1 + (y.growth - 1) * 0.5);
          const adj = Math.round(count * cmi * 10000) / 10000;
          const rate = t.rate * (1 + (y.growth - 1) * 0.3);
          const brAfter = Math.round(adj * rate * 0.92 * 100) / 100;
          const brK = Math.round(brAfter * t.k * 100) / 100;
          const comp = Math.round(brK * between([1, 1.04]) * 100) / 100;
          rows.push([`${code}_IP_01`, code, String(y.fy), t.name, brAfter, brK, count, adj, comp]);
        });
      });
    });
    return rows;
  }

  let cache = null;

  function dashboard() {
    if (!cache) cache = generateRows();
    return {
      columns: COLUMNS,
      rows: cache.map((r) => r.slice()),
      record_count: cache.length,
      last_updated: new Date().toISOString(),
      settings: {
        ORG_NAME: CONFIG.ORGANIZATION,
        DASHBOARD_THEME: CONFIG.DEFAULT_THEME,
        PUBLIC_DASHBOARD: true,
        ALLOW_REGISTRATION: true,
        DATA_SOURCE_NOTE: "ข้อมูลตัวอย่าง (จำลอง) สำหรับสาธิตรูปแบบ Dashboard เท่านั้น — ไม่ใช่ข้อมูลจริงของโรงพยาบาล"
      }
    };
  }

  return { dashboard };
})();
