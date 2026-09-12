/**
 * dashboard.js — Dashboard วิเคราะห์ข้อมูล IP.UC
 * โหลดข้อมูลสรุประดับประเภทบริการ (Aggregated) ครั้งเดียวจาก action=getDashboard
 * แล้วกรอง / คำนวณ KPI / กราฟ / ตาราง / Insight ที่เบราว์เซอร์ เพื่อให้ตอบสนองทันทีเมื่อเปลี่ยนตัวกรอง
 */
const Dashboard = (() => {
  "use strict";
  const { $, $$, html, setHtml, fmt } = U;

  const FONT = "'Prompt', system-ui, -apple-system, 'Segoe UI', sans-serif";
  const NUMERIC = ["br_after_deduction", "br_k", "service_count", "adj_rw", "compensation"];
  const FALLBACK_COLORS = ["#1976D2", "#00A6C8", "#7C4DFF", "#FF8A00", "#E91E63", "#10B981", "#6366F1", "#FACC15", "#0EA5E9", "#0F2747"];
  const METRIC_UNITS = { service_count: "ครั้ง", adj_rw: "Adj.RW", compensation: "บาท", cmi: "CMI" };
  const AUTH_CODES = ["UNAUTHORIZED", "SESSION_EXPIRED", "FORBIDDEN", "PENDING_APPROVAL", "USER_SUSPENDED", "USER_REJECTED", "USER_NOT_FOUND"];

  const emptyFilters = () => ({ years: [], months: [], stms: [], types: [], from: "", to: "", primary: "", compare: "", align: true });

  const state = {
    rows: [],
    loaded: false,
    loading: false,
    demo: false,
    needsReload: false,
    lastUpdated: "",
    typeOrder: [],
    filters: emptyFilters(),
    lineMetrics: new Set(["service_count", "adj_rw", "compensation"]),
    compareMetric: "compensation",
    topN: "5",
    scatterScale: "linear",
    controls: {},
    charts: {},
    table: null,
    sets: null,
    pal: FALLBACK_COLORS,
    renderQueued: false
  };

  const setText = (sel, text) => { const el = $(sel); if (el) el.textContent = text; };
  const isDemo = () => CONFIG.DEMO_MODE === "auto" && !API.isConfigured();

  /* ============================== Init ============================== */
  function init() {
    if (window.Chart) {
      Chart.defaults.font.family = FONT;
      Chart.defaults.font.size = 12;
      Chart.defaults.color = "#64748B";
      Chart.defaults.borderColor = "#E2E8F0";
      Chart.defaults.scale.grid.color = "#EEF2F7";
      Object.assign(Chart.defaults.plugins.legend.labels, { usePointStyle: true, boxWidth: 8, boxHeight: 8, padding: 14 });
      Object.assign(Chart.defaults.plugins.tooltip, {
        backgroundColor: "rgba(15, 39, 71, .95)",
        titleFont: { family: FONT, weight: "600", size: 13 },
        bodyFont: { family: FONT, size: 12 },
        footerFont: { family: FONT, weight: "600", size: 12 },
        padding: 12,
        cornerRadius: 10,
        boxPadding: 4,
        usePointStyle: true
      });
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) Chart.defaults.animation = false;
    }

    const c = state.controls;
    c.years = new U.MultiSelect($("#f-years"), {
      labelId: "lbl-f-years", placeholder: "ทุกปีงบประมาณ",
      onChange: (v) => { state.filters.years = v; syncDependentOptions(); scheduleRender(); }
    });
    c.months = new U.MultiSelect($("#f-months"), {
      labelId: "lbl-f-months", placeholder: "ทุกเดือน",
      onChange: (v) => { state.filters.months = v; scheduleRender(); }
    });
    c.stms = new U.MultiSelect($("#f-stms"), {
      labelId: "lbl-f-stms", placeholder: "ทุกงวด STM",
      onChange: (v) => { state.filters.stms = v; scheduleRender(); }
    });
    c.types = new U.MultiSelect($("#f-types"), {
      labelId: "lbl-f-types", placeholder: "ทุกประเภทบริการ",
      onChange: (v) => { state.filters.types = v; scheduleRender(); }
    });

    $("#f-from").addEventListener("change", onRangeChange);
    $("#f-to").addEventListener("change", onRangeChange);
    $("#f-primary").addEventListener("change", (e) => {
      state.filters.primary = e.target.value;
      if (state.filters.compare === state.filters.primary) state.filters.compare = "";
      syncDependentOptions();
      scheduleRender();
    });
    $("#f-compare").addEventListener("change", (e) => {
      state.filters.compare = e.target.value;
      syncDependentOptions();
      scheduleRender();
    });
    $("#f-align").addEventListener("change", (e) => {
      state.filters.align = e.target.checked;
      scheduleRender();
    });
    $("#btn-clear-filters").addEventListener("click", clearFilters);
    $("#btn-print").addEventListener("click", () => window.print());
    $("#filter-toggle").addEventListener("click", (e) => {
      const body = $("#filter-body");
      const open = !body.classList.contains("is-open");
      body.classList.toggle("is-open", open);
      e.currentTarget.setAttribute("aria-expanded", String(open));
    });

    $("#trend-metrics").addEventListener("click", (e) => {
      const chip = e.target.closest("[data-metric]");
      if (!chip) return;
      const key = chip.dataset.metric;
      if (state.lineMetrics.has(key)) state.lineMetrics.delete(key); else state.lineMetrics.add(key);
      chip.setAttribute("aria-pressed", String(state.lineMetrics.has(key)));
      if (state.sets) renderTrend(state.sets.current);
    });
    $("#compare-metric").addEventListener("change", (e) => {
      state.compareMetric = e.target.value;
      if (state.sets) renderCompare(state.sets);
    });
    $("#top-n").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-top]");
      if (!btn) return;
      state.topN = btn.dataset.top;
      $$("#top-n [data-top]").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
      if (state.sets) renderTop(state.sets.current);
    });
    $("#scatter-scale").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-scale]");
      if (!btn) return;
      state.scatterScale = btn.dataset.scale;
      $$("#scatter-scale [data-scale]").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
      if (state.sets) renderScatter(state.sets.current);
    });

    state.table = new U.DataTable($("#summary-table"), {
      rowKey: "service_type",
      exportName: "ip-uc-summary",
      sheetName: "สรุปตามประเภทบริการ",
      caption: "ตารางวิเคราะห์ตามประเภทบริการ",
      sortKey: "compensation",
      sortDir: "desc",
      pageSize: CONFIG.TABLE_PAGE_SIZE,
      columns: [
        {
          key: "service_type", label: "ประเภทบริการ",
          render: (r) => html`<span class="type-dot" style="--dot:${typeColor(r.service_type)}" aria-hidden="true"></span>${r.service_type}`
        },
        { key: "service_count", label: "จำนวนบริการ (ครั้ง)", type: "count" },
        { key: "adj_rw", label: "Adj.RW", type: "num4" },
        { key: "cmi", label: "CMI", type: "num4" },
        { key: "br_after_deduction", label: "BR หลังหักเงินกัน สป.สธ.", type: "money" },
        { key: "br_k", label: "BR คูณ K สป.สธ.", type: "money" },
        { key: "compensation", label: "ค่าชดเชยก่อนหักเงินเดือน", type: "money" },
        { key: "per_case", label: "รายได้เฉลี่ยต่อครั้ง", type: "money" },
        { key: "per_rw", label: "รายได้เฉลี่ยต่อ Adj.RW", type: "money" },
        {
          key: "share", label: "สัดส่วนค่าชดเชย", exportLabel: "สัดส่วนค่าชดเชย (%)", type: "pct",
          render: (r) => (r.share === null ? "N/A" : html`<span class="share"><span class="share-bar" aria-hidden="true"><span style="width:${Math.max(0, Math.min(100, r.share)).toFixed(1)}%"></span></span>${fmt.pct(r.share, 2)}</span>`)
        }
      ],
      footer: (rows) => {
        const t = rows.reduce((a, r) => {
          ["service_count", "adj_rw", "br_after_deduction", "br_k", "compensation", "share"].forEach((k) => { a[k] += r[k] || 0; });
          return a;
        }, { service_count: 0, adj_rw: 0, br_after_deduction: 0, br_k: 0, compensation: 0, share: 0 });
        return {
          service_type: `รวม ${rows.length} ประเภท`,
          service_count: t.service_count,
          adj_rw: t.adj_rw,
          cmi: t.service_count > 0 ? t.adj_rw / t.service_count : null,
          br_after_deduction: t.br_after_deduction,
          br_k: t.br_k,
          compensation: t.compensation,
          per_case: t.service_count > 0 ? t.compensation / t.service_count : null,
          per_rw: t.adj_rw > 0 ? t.compensation / t.adj_rw : null,
          share: t.share
        };
      }
    });
  }

  /* ============================== Load ============================== */
  function show() {
    if (state.loading) return;
    if (!state.loaded || state.needsReload) load();
  }

  function invalidate() { state.needsReload = true; }
  function onAuthChange() { state.needsReload = true; }
  function rerender() { if (state.loaded && !state.loading) render(); }

  async function load() {
    state.loading = true;
    const hadData = state.loaded;
    if (!hadData) {
      showState(null);
      renderSkeleton();
    }
    setText("#dash-updated", "กำลังโหลดข้อมูล...");
    try {
      let data;
      if (isDemo()) {
        data = DemoData.dashboard();
        state.demo = true;
      } else {
        const res = await API.call("getDashboard", {});
        data = res.data;
        state.demo = false;
      }
      $("#demo-banner").hidden = !state.demo;
      ingest(data);
      state.loaded = true;
      state.needsReload = false;
      showState(null);
      setupFilterOptions(!hadData);
      render();
    } catch (err) {
      if (AUTH_CODES.includes(err.code)) {
        state.loaded = false;
        showState("lock", `ผู้ดูแลระบบกำหนดให้ Dashboard ต้องเข้าสู่ระบบก่อนใช้งาน — ${err.message}`);
      } else if (hadData) {
        U.toast(`โหลดข้อมูลล่าสุดไม่สำเร็จ แสดงข้อมูลเดิม: ${API.describeError(err)}`, "warning", 8000);
        state.needsReload = true;
      } else {
        state.loaded = false;
        showState("error", `ไม่สามารถโหลดข้อมูลได้: ${API.describeError(err)}`);
      }
      setText("#dash-updated", state.lastUpdated && hadData ? U.formatDateTime(state.lastUpdated) : "-");
    } finally {
      state.loading = false;
    }
  }

  function showState(kind, message) {
    const box = $("#dash-state");
    const content = $("#dash-content");
    if (!kind) {
      box.hidden = true;
      content.hidden = false;
      return;
    }
    content.hidden = true;
    box.hidden = false;
    const actions = kind === "lock"
      ? html`<div class="state-actions"><button type="button" class="btn btn-secondary" data-dash-login><i class="bi bi-box-arrow-in-right" aria-hidden="true"></i> เข้าสู่ระบบ</button></div>`
      : html`<div class="state-actions"><button type="button" class="btn btn-outline" data-dash-retry><i class="bi bi-arrow-clockwise" aria-hidden="true"></i> ลองใหม่</button></div>`;
    setHtml(box, html`<div class="card">${U.stateHtml(kind, message, actions)}</div>`);
    $("[data-dash-login]", box)?.addEventListener("click", () => Auth.openLogin());
    $("[data-dash-retry]", box)?.addEventListener("click", () => load());
  }

  function renderSkeleton() {
    setHtml($("#kpi-grid"), Array.from({ length: 6 }, () => html`<div class="card kpi-card" aria-hidden="true">
      <span class="skeleton skeleton-line" style="width:45%"></span>
      <span class="skeleton skeleton-value"></span>
      <span class="skeleton skeleton-line" style="width:70%"></span>
    </div>`));
    setHtml($("#insight-list"), [1, 2].map(() => html`<li class="insight tone-muted" aria-hidden="true">
      <span class="skeleton" style="width:36px;height:36px;border-radius:10px;flex:none"></span>
      <div style="flex:1"><span class="skeleton skeleton-line"></span><span class="skeleton skeleton-line" style="width:60%"></span></div>
    </li>`));
    $$("#dash-content .chart-box").forEach((box) => {
      if (!box.querySelector(".skeleton-chart")) {
        const s = document.createElement("span");
        s.className = "skeleton skeleton-chart";
        box.appendChild(s);
      }
    });
    state.table.setLoading();
  }

  function ingest(data) {
    const cols = Array.isArray(data.columns) ? data.columns : [];
    state.rows = (Array.isArray(data.rows) ? data.rows : []).map((line) => {
      const r = {};
      cols.forEach((c, i) => { r[c] = line[i]; });
      r.stm_period = String(r.stm_period ?? "").trim();
      r.month_code = String(r.month_code ?? "").trim();
      r.fiscal_year = String(r.fiscal_year ?? "").trim();
      r.service_type = String(r.service_type ?? "").trim() || U.UNSPECIFIED;
      NUMERIC.forEach((f) => {
        const n = Number(r[f]);
        r[f] = Number.isFinite(n) ? n : 0;
      });
      r.mm = U.isValidMonthCode(r.month_code) ? r.month_code.slice(2) : "";
      return r;
    });

    const totals = new Map();
    state.rows.forEach((r) => totals.set(r.service_type, (totals.get(r.service_type) || 0) + r.compensation));
    state.typeOrder = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);

    state.lastUpdated = data.last_updated || "";
    App.applySettings(data.settings || {});

    setText("#dash-updated", state.lastUpdated ? U.formatDateTime(state.lastUpdated) : "ยังไม่มีข้อมูล");
    setText("#dash-records", fmt.int(state.rows.length));
    const years = allYears();
    setText("#dash-period", !years.length ? "ยังไม่มีข้อมูล"
      : years.length === 1 ? `ปีงบประมาณ ${years[0]}` : `ปีงบประมาณ ${years[years.length - 1]}–${years[0]}`);
  }

  /* ============================== Filters ============================== */
  const allYears = () => [...new Set(state.rows.map((r) => r.fiscal_year).filter(Boolean))].sort((a, b) => b.localeCompare(a));

  function fillSelect(el, options, value) {
    setHtml(el, options.map((o) => html`<option value="${o.value}">${o.label}</option>`));
    el.value = value;
    if (el.value !== value) el.value = "";
  }

  function setupFilterOptions(first) {
    const years = allYears();
    const f = state.filters;
    if (first) {
      f.primary = years[0] || "";
      f.compare = years[1] || "";
    } else {
      if (f.primary && !years.includes(f.primary)) f.primary = years[0] || "";
      if (f.compare && !years.includes(f.compare)) f.compare = "";
    }
    const c = state.controls;
    c.years.setOptions(years.map((y) => ({ value: y, label: `ปีงบประมาณ ${y}` })));
    f.years = c.years.getValues();
    const months = U.FISCAL_MONTHS.filter((m) => state.rows.some((r) => r.mm === m));
    c.months.setOptions(months.map((m) => ({ value: m, label: U.monthName(m, true) })));
    f.months = c.months.getValues();
    c.types.setOptions(state.typeOrder.map((t) => ({ value: t, label: t })));
    f.types = c.types.getValues();
    syncDependentOptions();
  }

  /** ตัวเลือกที่ขึ้นกับปีงบประมาณ (งวด STM, ช่วงเวลา) และสถานะโหมดเปรียบเทียบ */
  function syncDependentOptions() {
    const f = state.filters;
    const c = state.controls;
    const years = allYears();

    fillSelect($("#f-primary"), [{ value: "", label: "— ไม่ใช้ (ดูหลายปีงบประมาณ) —" }, ...years.map((y) => ({ value: y, label: `ปีงบประมาณ ${y}` }))], f.primary);
    f.primary = $("#f-primary").value;
    if (!f.primary || f.compare === f.primary) f.compare = f.primary ? f.compare : "";
    fillSelect($("#f-compare"), [{ value: "", label: "— ไม่เปรียบเทียบ —" }, ...years.filter((y) => y !== f.primary).map((y) => ({ value: y, label: `ปีงบประมาณ ${y}` }))], f.compare);
    f.compare = $("#f-compare").value;
    $("#f-compare").disabled = !f.primary;
    $("#f-align").disabled = !(f.primary && f.compare);
    c.years.setDisabled(!!f.primary);
    $("#f-years-hint").hidden = !f.primary;

    const scopeYears = f.primary ? [f.primary] : f.years;
    const scoped = scopeYears.length ? state.rows.filter((r) => scopeYears.includes(r.fiscal_year)) : state.rows;

    const stmMonth = new Map();
    scoped.forEach((r) => { if (r.stm_period) stmMonth.set(r.stm_period, r.month_code); });
    const stms = [...stmMonth.keys()].sort((a, b) => String(stmMonth.get(a)).localeCompare(String(stmMonth.get(b))) || a.localeCompare(b));
    c.stms.setOptions(stms.map((s) => ({ value: s, label: s })));
    f.stms = c.stms.getValues();

    const codes = [...new Set(scoped.map((r) => r.month_code).filter(U.isValidMonthCode))].sort();
    if (f.from && !codes.includes(f.from)) f.from = "";
    if (f.to && !codes.includes(f.to)) f.to = "";
    const opts = codes.map((code) => ({ value: code, label: U.monthLabelFull(code) }));
    fillSelect($("#f-from"), [{ value: "", label: "ตั้งแต่เดือนแรกที่มีข้อมูล" }, ...opts], f.from);
    fillSelect($("#f-to"), [{ value: "", label: "ถึงเดือนล่าสุดที่มีข้อมูล" }, ...opts], f.to);
  }

  function onRangeChange() {
    let from = $("#f-from").value;
    let to = $("#f-to").value;
    if (from && to && from > to) {
      [from, to] = [to, from];
      $("#f-from").value = from;
      $("#f-to").value = to;
      U.toast("สลับช่วงเวลาเริ่มต้นและสิ้นสุดให้ถูกต้องแล้ว", "info", 3000);
    }
    state.filters.from = from;
    state.filters.to = to;
    scheduleRender();
  }

  function clearFilters() {
    const years = allYears();
    state.filters = Object.assign(emptyFilters(), { primary: years[0] || "", compare: years[1] || "" });
    Object.values(state.controls).forEach((ms) => ms.setValues([]));
    $("#f-align").checked = true;
    syncDependentOptions();
    render();
    U.toast("ล้างตัวกรองแล้ว (ปีงบประมาณล่าสุดเทียบกับปีก่อนหน้า)", "info", 3000);
  }

  function scheduleRender() {
    if (state.renderQueued) return;
    state.renderQueued = true;
    requestAnimationFrame(() => {
      state.renderQueued = false;
      if (state.loaded) render();
    });
  }

  const shiftCode = (code, years) => {
    if (!code) return "";
    const n = Number(code) - years * 100;
    return n > 0 ? String(n).padStart(4, "0") : "";
  };

  /** ชุดข้อมูลหลัก (current) และชุดเปรียบเทียบ (compare) ตามตัวกรอง */
  function computeSets() {
    const f = state.filters;
    const base = (r) => (!f.months.length || f.months.includes(r.mm)) && (!f.types.length || f.types.includes(r.service_type));
    const inRange = (code, from, to) => (!from || code >= from) && (!to || code <= to);

    let current;
    let compare = null;
    if (f.primary) {
      current = state.rows.filter((r) => r.fiscal_year === f.primary && base(r)
        && (!f.stms.length || f.stms.includes(r.stm_period)) && inRange(r.month_code, f.from, f.to));
      if (f.compare) {
        const diff = Number(f.primary) - Number(f.compare);
        const stms = f.stms.map((s) => s.replace(/^(\d{4})/, (m) => shiftCode(m, diff)));
        const from = shiftCode(f.from, diff);
        const to = shiftCode(f.to, diff);
        compare = state.rows.filter((r) => r.fiscal_year === f.compare && base(r)
          && (!stms.length || stms.includes(r.stm_period)) && inRange(r.month_code, from, to));
        if (f.align) {
          const months = new Set(current.map((r) => r.mm));
          compare = compare.filter((r) => months.has(r.mm));
        }
      }
    } else {
      current = state.rows.filter((r) => (!f.years.length || f.years.includes(r.fiscal_year)) && base(r)
        && (!f.stms.length || f.stms.includes(r.stm_period)) && inRange(r.month_code, f.from, f.to));
    }
    return { current, compare };
  }

  function groupSum(rows, keyFn) {
    const map = new Map();
    rows.forEach((r) => {
      const key = keyFn(r);
      let a = map.get(key);
      if (!a) {
        a = { service_count: 0, adj_rw: 0, compensation: 0, br_k: 0, br_after_deduction: 0, records: 0 };
        map.set(key, a);
      }
      NUMERIC.forEach((f) => { a[f] += r[f]; });
      a.records++;
    });
    return map;
  }

  function aggregate(rows) {
    const t = { service_count: 0, adj_rw: 0, compensation: 0, br_k: 0, br_after_deduction: 0, records: rows.length };
    rows.forEach((r) => NUMERIC.forEach((f) => { t[f] += r[f]; }));
    t.cmi = t.service_count > 0 ? t.adj_rw / t.service_count : null;
    t.per_case = t.service_count > 0 ? t.compensation / t.service_count : null;
    t.per_rw = t.adj_rw > 0 ? t.compensation / t.adj_rw : null;
    t.months = new Set(rows.filter((r) => r.mm).map((r) => r.month_code)).size;
    return t;
  }

  function currentLabel() {
    const f = state.filters;
    if (f.primary) return `ปีงบ ${f.primary}`;
    if (f.years.length === 1) return `ปีงบ ${f.years[0]}`;
    if (f.years.length > 1) return `${f.years.length} ปีงบประมาณ`;
    return "ทุกปีงบประมาณ";
  }
  const compareLabel = () => `ปีงบ ${state.filters.compare}`;

  /* ============================== Render ============================== */
  function render() {
    $$("#dash-content .skeleton-chart").forEach((s) => s.remove());
    state.pal = Array.from({ length: 10 }, (_, i) => U.cssVar(`--chart-${i + 1}`) || FALLBACK_COLORS[i]);
    const sets = computeSets();
    state.sets = sets;
    const cur = aggregate(sets.current);
    const cmp = sets.compare && sets.compare.length ? aggregate(sets.compare) : null;

    renderSummary(sets, cur, cmp);
    renderKpis(sets, cur, cmp);
    renderInsights(sets, cur, cmp);
    renderTrend(sets.current);
    renderDonut(sets.current);
    renderCompare(sets);
    renderTop(sets.current);
    renderStacked(sets.current);
    renderScatter(sets.current);
    renderTable(sets.current, cur);
  }

  function renderSummary(sets, cur, cmp) {
    const f = state.filters;
    const chips = [html`<span class="badge badge-brand"><i class="bi bi-calendar-check" aria-hidden="true"></i> ${currentLabel()}</span>`];
    if (f.primary && f.compare) {
      chips.push(html`<span class="badge badge-violet"><i class="bi bi-arrow-left-right" aria-hidden="true"></i> เทียบกับ ${compareLabel()}${f.align ? " (เดือนตรงกัน)" : ""}</span>`);
    }
    if (f.months.length) chips.push(html`<span class="badge badge-neutral">${f.months.length} เดือน</span>`);
    if (f.stms.length) chips.push(html`<span class="badge badge-neutral">${f.stms.length} งวด STM</span>`);
    if (f.types.length) chips.push(html`<span class="badge badge-neutral">${f.types.length} ประเภทบริการ</span>`);
    if (f.from || f.to) {
      chips.push(html`<span class="badge badge-neutral"><i class="bi bi-calendar-range" aria-hidden="true"></i> ${f.from ? U.monthLabel(f.from) : "เริ่มต้น"} – ${f.to ? U.monthLabel(f.to) : "ล่าสุด"}</span>`);
    }
    chips.push(html`<span class="badge badge-neutral"><i class="bi bi-list-ol" aria-hidden="true"></i> ${fmt.int(sets.current.length)} รายการ · ${cur.months} เดือน</span>`);
    setHtml($("#filter-summary"), chips);

    let caption = currentLabel();
    if (cmp) caption += ` เทียบกับ ${compareLabel()}`;
    else if (f.primary && f.compare) caption += ` · ไม่พบข้อมูล${compareLabel()}ตามเงื่อนไข`;
    setText("#kpi-caption", caption);
  }

  /* ------------------------------ KPI ------------------------------ */
  const moneyValue = (v) => {
    const c = fmt.moneyCompact(v);
    return { text: c.value, unit: c.unit, sub: Math.abs(v) >= 1e6 ? fmt.money(v) : "" };
  };
  const moneyDiff = (d) => (Math.abs(d) >= 1e6 ? `${fmt.signed(d / 1e6, 2)} ล้านบาท` : `${fmt.signed(d, 2)} บาท`);

  const KPI_DEFS = [
    { key: "service_count", label: "จำนวนบริการรวม", icon: "bi-people-fill", value: (v) => ({ text: fmt.int(v), unit: "ครั้ง" }), diff: (d) => `${fmt.signed(d, 0)} ครั้ง` },
    { key: "adj_rw", label: "Adj.RW รวม", icon: "bi-heart-pulse-fill", value: (v) => ({ text: fmt.num(v, 2), unit: "Adj.RW", sub: `ละเอียด ${fmt.num(v, 4)}` }), diff: (d) => fmt.signed(d, 2) },
    { key: "compensation", label: "ค่าชดเชยรวมก่อนหักเงินเดือน", icon: "bi-cash-stack", value: moneyValue, diff: moneyDiff },
    { key: "br_k", label: "BR คูณ K รวม", icon: "bi-calculator-fill", value: moneyValue, diff: moneyDiff },
    { key: "cmi", label: "CMI", hint: "Adj.RW รวม ÷ จำนวนบริการรวม", icon: "bi-graph-up-arrow", value: (v) => ({ text: fmt.num(v, 4), unit: "" }), diff: (d) => fmt.signed(d, 4) },
    { key: "per_case", label: "รายได้เฉลี่ยต่อครั้ง", hint: "ค่าชดเชยรวม ÷ จำนวนบริการรวม", icon: "bi-receipt-cutoff", value: (v) => ({ text: fmt.num(v, 2), unit: "บาท/ครั้ง" }), diff: (d) => `${fmt.signed(d, 2)} บาท` }
  ];

  function renderKpis(sets, cur, cmp) {
    const empty = !sets.current.length;
    setHtml($("#kpi-grid"), KPI_DEFS.map((d, i) => {
      const v = cur[d.key];
      const val = v === null || v === undefined ? { text: "N/A", unit: "" } : d.value(v);
      return html`<article class="card kpi-card tone-${i + 1}">
        <div class="kpi-top">
          <h3 class="kpi-label">${d.label}</h3>
          <span class="kpi-icon" aria-hidden="true"><i class="bi ${d.icon}"></i></span>
        </div>
        <div class="kpi-value">${val.text}<span class="kpi-unit">${val.unit}</span></div>
        <div class="kpi-sub">${d.hint ? `${d.hint} · ` : ""}${val.sub || currentLabel()}</div>
        <div class="kpi-delta">${deltaHtml(d, v, cmp ? cmp[d.key] : undefined, empty)}</div>
      </article>`;
    }));
  }

  function deltaHtml(def, cur, prev, empty) {
    const f = state.filters;
    if (empty) {
      return html`<span class="delta delta-flat"><i class="bi bi-dash" aria-hidden="true"></i> -</span><span>ไม่พบข้อมูลตามเงื่อนไข</span>`;
    }
    if (prev === undefined) {
      return html`<span class="delta delta-flat"><i class="bi bi-dash" aria-hidden="true"></i> N/A</span>
        <span>${f.primary && f.compare ? `ไม่พบข้อมูล${compareLabel()}ตามเงื่อนไข` : "เลือกปีเปรียบเทียบเพื่อดูการเปลี่ยนแปลง"}</span>`;
    }
    if (cur === null || prev === null) {
      return html`<span class="delta delta-flat">N/A</span><span>ไม่สามารถคำนวณการเปลี่ยนแปลงได้</span>`;
    }
    const diff = cur - prev;
    const pct = prev !== 0 ? (diff / Math.abs(prev)) * 100 : null;
    const dir = Math.abs(diff) < 1e-9 ? "flat" : diff > 0 ? "up" : "down";
    const icon = { up: "bi-arrow-up-right", down: "bi-arrow-down-right", flat: "bi-arrow-right" }[dir];
    const word = { up: "เพิ่มขึ้น", down: "ลดลง", flat: "เท่าเดิม" }[dir];
    return html`<span class="delta delta-${dir}"><i class="bi ${icon}" aria-hidden="true"></i><span class="sr-only">${word}</span>${pct === null ? "ใหม่" : `${fmt.signed(pct, 1)}%`}</span>
      <span>เทียบ${compareLabel()} · ผลต่าง ${def.diff(diff)}</span>`;
  }

  /* ------------------------------ Insights ------------------------------ */
  function renderInsights(sets, cur, cmp) {
    const list = $("#insight-list");
    const f = state.filters;
    if (!sets.current.length || (cur.compensation === 0 && cur.service_count === 0)) {
      setHtml(list, html`<li class="insight tone-muted span-full"><span class="insight-icon" aria-hidden="true"><i class="bi bi-info-lg"></i></span>
        <p>ยังไม่มีข้อมูลเพียงพอสำหรับสรุปข้อมูลที่น่าสนใจตามตัวกรองปัจจุบัน</p></li>`);
      return;
    }

    const items = [];
    const types = [...groupSum(sets.current, (r) => r.service_type).entries()]
      .map(([type, a]) => ({ type, ...a }))
      .sort((a, b) => b.compensation - a.compensation);

    if (types.length && cur.compensation > 0 && types[0].compensation > 0) {
      items.push({
        icon: "bi-trophy-fill", tone: "tone-3",
        text: html`<strong>${types[0].type}</strong> ได้รับค่าชดเชยสูงสุด ${fmt.money(types[0].compensation)} คิดเป็น <strong>${fmt.pct((types[0].compensation / cur.compensation) * 100)}</strong> ของค่าชดเชยรวม ${currentLabel()}`
      });
    }

    const months = [...groupSum(sets.current.filter((r) => r.mm), (r) => r.month_code).entries()];
    if (months.length >= 2) {
      const [code, a] = months.sort((x, y) => y[1].adj_rw - x[1].adj_rw)[0];
      items.push({
        icon: "bi-calendar2-check-fill", tone: "tone-2",
        text: html`เดือน <strong>${U.monthLabelFull(code)}</strong> มี Adj.RW สูงสุด ${fmt.num(a.adj_rw, 4)} จากการบริการ ${fmt.int(a.service_count)} ครั้ง (จาก ${months.length} เดือนที่มีข้อมูล)`
      });
    }

    if (cmp && cur.cmi !== null && cmp.cmi !== null && cmp.cmi > 0) {
      const pct = ((cur.cmi - cmp.cmi) / cmp.cmi) * 100;
      const up = pct >= 0;
      items.push({
        icon: up ? "bi-graph-up-arrow" : "bi-graph-down-arrow", tone: up ? "tone-up" : "tone-down",
        text: html`CMI ${currentLabel()} = <strong>${fmt.num(cur.cmi, 4)}</strong> ${Math.abs(pct) < 0.05 ? "ใกล้เคียงกับ" : up ? `เพิ่มขึ้น ${fmt.pct(Math.abs(pct))} จาก` : `ลดลง ${fmt.pct(Math.abs(pct))} จาก`} ${compareLabel()} (${fmt.num(cmp.cmi, 4)})`
      });
    }

    const perRw = types.filter((t) => t.adj_rw > 0).map((t) => ({ ...t, per_rw: t.compensation / t.adj_rw })).sort((a, b) => b.per_rw - a.per_rw);
    if (perRw.length >= 2) {
      const hi = perRw[0];
      const lo = perRw[perRw.length - 1];
      items.push({
        icon: "bi-bar-chart-steps", tone: "tone-1",
        text: html`รายได้ต่อ Adj.RW สูงสุด: <strong>${hi.type}</strong> ${fmt.money(hi.per_rw)} · ต่ำสุด: <strong>${lo.type}</strong> ${fmt.money(lo.per_rw)} (ต่างกัน ${fmt.money(hi.per_rw - lo.per_rw)})`
      });
    }

    if (cmp) {
      [["service_count", "จำนวนบริการ", (v) => `${fmt.int(v)} ครั้ง`], ["compensation", "ค่าชดเชย", (v) => fmt.money(v)]].forEach(([key, label, show]) => {
        if (cmp[key] <= 0) return;
        const pct = ((cur[key] - cmp[key]) / cmp[key]) * 100;
        if (Math.abs(pct) <= 10) return;
        items.push({
          icon: "bi-exclamation-diamond-fill", tone: pct > 0 ? "tone-up" : "tone-down",
          text: html`ข้อสังเกต: ${label}${pct > 0 ? "เพิ่มขึ้น" : "ลดลง"} <strong>${fmt.pct(Math.abs(pct))}</strong> (${show(cmp[key])} → ${show(cur[key])}) เมื่อเทียบกับ ${compareLabel()}`
        });
      });

      const cmpTypes = groupSum(sets.compare, (r) => r.service_type);
      types
        .filter((t) => (cmpTypes.get(t.type)?.compensation || 0) > 0)
        .map((t) => {
          const prev = cmpTypes.get(t.type).compensation;
          return { type: t.type, prev, next: t.compensation, pct: ((t.compensation - prev) / prev) * 100 };
        })
        .filter((c) => Math.abs(c.pct) > 10)
        .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))
        .slice(0, 2)
        .forEach((c) => {
          items.push({
            icon: c.pct > 0 ? "bi-arrow-up-right-circle-fill" : "bi-arrow-down-right-circle-fill", tone: c.pct > 0 ? "tone-up" : "tone-down",
            text: html`ค่าชดเชย <strong>${c.type}</strong> ${c.pct > 0 ? "เพิ่มขึ้น" : "ลดลง"} ${fmt.pct(Math.abs(c.pct))} (${fmt.money(c.prev)} → ${fmt.money(c.next)})`
          });
        });

      if (cur.months !== cmp.months) {
        items.push({
          icon: "bi-info-circle-fill", tone: "tone-info",
          text: html`ข้อมูล${currentLabel()}มี ${cur.months} เดือน ขณะที่${compareLabel()}มี ${cmp.months} เดือน ควรพิจารณาผลเปรียบเทียบอย่างระมัดระวัง`
        });
      }
    } else if (f.primary && f.compare) {
      items.push({ icon: "bi-info-circle-fill", tone: "tone-info", text: html`ไม่พบข้อมูล${compareLabel()}ตามเงื่อนไขปัจจุบัน จึงยังไม่สรุปการเปลี่ยนแปลง` });
    }

    setHtml(list, items.map((it) => html`<li class="insight ${it.tone}">
      <span class="insight-icon" aria-hidden="true"><i class="bi ${it.icon}"></i></span><p>${it.text}</p></li>`));
  }

  /* ------------------------------ Charts ------------------------------ */
  function typeColor(type) {
    const i = state.typeOrder.indexOf(type);
    return state.pal[(i < 0 ? state.typeOrder.length : i) % state.pal.length];
  }

  function alpha(color, a) {
    const m = /^#([0-9a-f]{6})$/i.exec(String(color).trim());
    if (!m) return color;
    const n = parseInt(m[1], 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }

  function formatMetric(key, v) {
    if (v === null || v === undefined || !Number.isFinite(v)) return "N/A";
    if (key === "service_count") return `${fmt.int(v)} ครั้ง`;
    if (key === "adj_rw" || key === "cmi") return fmt.num(v, 4);
    return fmt.money(v);
  }

  function makeChart(id, config, isEmpty, emptyText) {
    const canvas = document.getElementById(id);
    if (!canvas) return;
    const box = canvas.parentElement;
    if (state.charts[id]) {
      state.charts[id].destroy();
      delete state.charts[id];
    }
    let overlay = box.querySelector(".chart-empty");
    if (!window.Chart || isEmpty) {
      canvas.hidden = true;
      if (!overlay) {
        overlay = document.createElement("div");
        overlay.className = "chart-empty";
        box.appendChild(overlay);
      }
      overlay.hidden = false;
      setHtml(overlay, window.Chart
        ? U.stateHtml("empty", emptyText || "ไม่พบข้อมูลตามเงื่อนไข")
        : U.stateHtml("error", "ไม่สามารถโหลดไลบรารีกราฟได้ กรุณาตรวจสอบอินเทอร์เน็ต"));
      return;
    }
    canvas.hidden = false;
    if (overlay) overlay.hidden = true;
    state.charts[id] = new Chart(canvas, config);
  }

  function renderTrend(rows) {
    const byMonth = groupSum(rows.filter((r) => r.mm), (r) => r.month_code);
    const codes = [...byMonth.keys()].sort();
    const defs = [
      { key: "service_count", label: "จำนวนบริการ (ครั้ง)", axis: "yLeft", color: state.pal[0] },
      { key: "adj_rw", label: "Adj.RW", axis: "yLeft", color: state.pal[2] },
      { key: "compensation", label: "ค่าชดเชย (บาท)", axis: "yRight", color: state.pal[1] }
    ].filter((d) => state.lineMetrics.has(d.key));
    const hasLeft = defs.some((d) => d.axis === "yLeft");
    const hasRight = defs.some((d) => d.axis === "yRight");

    makeChart("chart-trend", {
      type: "line",
      data: {
        labels: codes.map(U.monthLabel),
        datasets: defs.map((d) => ({
          label: d.label,
          metricKey: d.key,
          data: codes.map((c) => byMonth.get(c)[d.key]),
          yAxisID: d.axis,
          borderColor: d.color,
          backgroundColor: alpha(d.color, 0.12),
          pointBackgroundColor: "#fff",
          pointBorderColor: d.color,
          pointBorderWidth: 2,
          pointRadius: codes.length > 24 ? 2 : 3.5,
          pointHoverRadius: 6,
          borderWidth: 2.5,
          tension: 0.35,
          fill: d.key === "compensation" ? "origin" : false
        }))
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items) => U.monthLabelFull(codes[items[0].dataIndex]),
              label: (ctx) => ` ${ctx.dataset.label}: ${formatMetric(ctx.dataset.metricKey, ctx.parsed.y)}`
            }
          }
        },
        scales: {
          x: { grid: { display: false } },
          yLeft: { display: hasLeft, position: "left", beginAtZero: true, title: { display: true, text: "ครั้ง / Adj.RW" }, ticks: { callback: (v) => fmt.int(v) } },
          yRight: { display: hasRight, position: "right", beginAtZero: true, grid: { drawOnChartArea: !hasLeft }, title: { display: true, text: "บาท" }, ticks: { callback: (v) => fmt.axisMoney(v) } }
        }
      }
    }, !codes.length || !defs.length, !defs.length ? "กรุณาเลือกตัวชี้วัดอย่างน้อย 1 รายการ" : undefined);
  }

  function renderDonut(rows) {
    let items = [...groupSum(rows, (r) => r.service_type).entries()]
      .map(([type, a]) => ({ type, value: a.compensation, color: typeColor(type) }))
      .filter((i) => i.value > 0)
      .sort((a, b) => b.value - a.value);
    if (items.length > 8) {
      const rest = items.slice(7);
      items = items.slice(0, 7).concat({ type: `ประเภทอื่นรวมกัน (${rest.length})`, value: rest.reduce((s, i) => s + i.value, 0), color: "#94A3B8" });
    }
    const total = items.reduce((s, i) => s + i.value, 0);
    const centerText = {
      id: "centerText",
      afterDatasetsDraw(chart) {
        const arc = chart.getDatasetMeta(0)?.data?.[0];
        if (!arc) return;
        const { ctx } = chart;
        const c = fmt.moneyCompact(total);
        ctx.save();
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#64748B";
        ctx.font = `500 12px ${FONT}`;
        ctx.fillText("ค่าชดเชยรวม", arc.x, arc.y - 13);
        ctx.fillStyle = "#1E293B";
        ctx.font = `700 17px ${FONT}`;
        ctx.fillText(c.unit === "ล้านบาท" ? `฿${c.value} ล้าน` : fmt.money(total, 0), arc.x, arc.y + 9);
        ctx.restore();
      }
    };
    makeChart("chart-donut", {
      type: "doughnut",
      data: {
        labels: items.map((i) => i.type),
        datasets: [{ data: items.map((i) => i.value), backgroundColor: items.map((i) => i.color), borderColor: "#fff", borderWidth: 3, hoverOffset: 8 }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "64%",
        layout: { padding: 4 },
        plugins: {
          legend: { position: "bottom", labels: { padding: 10, font: { size: 11 } } },
          tooltip: { callbacks: { label: (ctx) => ` ${ctx.label}: ${fmt.money(ctx.parsed)} (${fmt.pct((ctx.parsed / total) * 100)})` } }
        }
      },
      plugins: [centerText]
    }, !items.length || total <= 0, "ไม่พบค่าชดเชยตามเงื่อนไข");
  }

  function renderCompare(sets) {
    const f = state.filters;
    const metric = state.compareMetric;
    const colorIdx = [0, 3, 2, 4, 5, 6, 1];
    const groups = f.primary && f.compare
      ? [{ label: `ปีงบ ${f.primary}`, rows: sets.current }, { label: `ปีงบ ${f.compare}`, rows: sets.compare || [] }]
      : [...new Set(sets.current.map((r) => r.fiscal_year))].sort().map((y) => ({ label: `ปีงบ ${y}`, rows: sets.current.filter((r) => r.fiscal_year === y) }));
    const months = U.FISCAL_MONTHS.filter((m) => groups.some((g) => g.rows.some((r) => r.mm === m)));
    const valueOf = (a) => {
      if (!a) return null;
      if (metric === "cmi") return a.service_count > 0 ? a.adj_rw / a.service_count : null;
      return a[metric];
    };

    const datasets = groups.map((g, i) => {
      const byMonth = groupSum(g.rows, (r) => r.mm);
      const color = state.pal[colorIdx[i % colorIdx.length]];
      return {
        label: g.label,
        data: months.map((m) => valueOf(byMonth.get(m))),
        backgroundColor: color,
        hoverBackgroundColor: alpha(color, 0.82),
        borderRadius: 6,
        maxBarThickness: 26,
        categoryPercentage: 0.72,
        barPercentage: 0.9
      };
    });

    setText("#compare-sub", f.primary && f.compare
      ? `ปีงบ ${f.primary} เทียบกับ ${f.compare} · รายเดือนตามปีงบประมาณ (ต.ค.–ก.ย.)`
      : "แยกตามปีงบประมาณในตัวกรอง · เลือก “ปีงบประมาณหลัก” และ “เปรียบเทียบกับ” เพื่อเทียบ 2 ปี");

    setHtml($("#compare-summary"), groups.map((g, i) => {
      const a = aggregate(g.rows);
      const v = metric === "cmi" ? a.cmi : a[metric];
      return html`<span class="compare-pill" style="--dot:${state.pal[colorIdx[i % colorIdx.length]]}"><span class="dot" aria-hidden="true"></span>${g.label} รวม: <strong>${formatMetric(metric, g.rows.length ? v : null)}</strong></span>`;
    }));

    const axis = metric === "compensation" ? (v) => fmt.axisMoney(v) : metric === "cmi" ? (v) => fmt.num(v, 2) : (v) => fmt.int(v);
    makeChart("chart-compare", {
      type: "bar",
      data: { labels: months.map((m) => U.monthName(m)), datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { position: "bottom" },
          tooltip: {
            callbacks: {
              title: (items) => U.monthName(months[items[0].dataIndex], true),
              label: (ctx) => ` ${ctx.dataset.label}: ${ctx.parsed.y === null ? "ไม่มีข้อมูล" : formatMetric(metric, ctx.parsed.y)}`
            }
          }
        },
        scales: {
          x: { grid: { display: false } },
          y: { beginAtZero: true, ticks: { callback: axis }, title: { display: true, text: METRIC_UNITS[metric] } }
        }
      }
    }, !months.length);
  }

  function renderTop(rows) {
    const byType = [...groupSum(rows, (r) => r.service_type).entries()]
      .map(([type, a]) => ({ type, ...a }))
      .sort((a, b) => b.compensation - a.compensation);
    const list = state.topN === "all" ? byType : byType.slice(0, Number(state.topN));
    const total = byType.reduce((s, t) => s + t.compensation, 0);
    $("#chart-top").parentElement.style.height = `${Math.max(300, list.length * 38 + 60)}px`;

    makeChart("chart-top", {
      type: "bar",
      data: {
        labels: list.map((t) => t.type),
        datasets: [{
          label: "ค่าชดเชย (บาท)",
          data: list.map((t) => t.compensation),
          backgroundColor: list.map((t) => typeColor(t.type)),
          borderRadius: 6,
          maxBarThickness: 24
        }]
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const t = list[ctx.dataIndex];
                return [
                  ` ค่าชดเชย: ${fmt.money(t.compensation)}`,
                  ` สัดส่วน: ${total ? fmt.pct((t.compensation / total) * 100) : "N/A"}`,
                  ` จำนวนบริการ: ${fmt.int(t.service_count)} ครั้ง`
                ];
              }
            }
          }
        },
        scales: {
          x: { beginAtZero: true, ticks: { callback: (v) => fmt.axisMoney(v) }, title: { display: true, text: "บาท" } },
          y: {
            grid: { display: false },
            ticks: {
              callback(value) {
                const label = String(this.getLabelForValue(value));
                return label.length > 22 ? `${label.slice(0, 21)}…` : label;
              }
            }
          }
        }
      }
    }, !list.length);
  }

  function renderStacked(rows) {
    const valid = rows.filter((r) => r.mm);
    const codes = [...new Set(valid.map((r) => r.month_code))].sort();
    const types = state.typeOrder.filter((t) => valid.some((r) => r.service_type === t));
    const sums = new Map();
    valid.forEach((r) => {
      const key = `${r.service_type}${r.month_code}`;
      sums.set(key, (sums.get(key) || 0) + r.compensation);
    });

    makeChart("chart-stacked", {
      type: "bar",
      data: {
        labels: codes.map(U.monthLabel),
        datasets: types.map((t) => ({
          label: t,
          data: codes.map((c) => sums.get(`${t}${c}`) || 0),
          backgroundColor: typeColor(t),
          stack: "compensation",
          maxBarThickness: 46
        }))
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { position: "bottom" },
          tooltip: {
            itemSort: (a, b) => b.parsed.y - a.parsed.y,
            filter: (item) => item.parsed.y !== 0,
            callbacks: {
              title: (items) => U.monthLabelFull(codes[items[0].dataIndex]),
              label: (ctx) => ` ${ctx.dataset.label}: ${fmt.money(ctx.parsed.y)}`,
              footer: (items) => `รวมทั้งเดือน: ${fmt.money(items.reduce((s, i) => s + i.parsed.y, 0))}`
            }
          }
        },
        scales: {
          x: { stacked: true, grid: { display: false } },
          y: { stacked: true, beginAtZero: true, ticks: { callback: (v) => fmt.axisMoney(v) }, title: { display: true, text: "บาท" } }
        }
      }
    }, !codes.length);
  }

  function renderScatter(rows) {
    const log = state.scatterScale === "log";
    const groups = groupSum(rows.filter((r) => r.mm), (r) => `${r.service_type}${r.month_code}`);
    let maxComp = 0;
    groups.forEach((a) => { maxComp = Math.max(maxComp, a.compensation); });

    const byType = new Map();
    let hidden = 0;
    groups.forEach((a, key) => {
      const [type, code] = key.split("");
      if (log && (a.service_count <= 0 || a.adj_rw <= 0)) {
        hidden++;
        return;
      }
      if (!byType.has(type)) byType.set(type, []);
      byType.get(type).push({
        x: a.service_count,
        y: Math.round(a.adj_rw * 10000) / 10000,
        r: maxComp > 0 ? 4 + 18 * Math.sqrt(Math.max(a.compensation, 0) / maxComp) : 5,
        comp: a.compensation,
        code
      });
    });

    const datasets = state.typeOrder.filter((t) => byType.has(t)).map((t) => {
      const color = typeColor(t);
      return { label: t, data: byType.get(t), backgroundColor: alpha(color, 0.55), borderColor: color, borderWidth: 1.5, hoverBackgroundColor: alpha(color, 0.85) };
    });

    const axisType = log ? "logarithmic" : "linear";
    makeChart("chart-scatter", {
      type: "bubble",
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "bottom" },
          subtitle: { display: hidden > 0, text: `ซ่อน ${hidden} จุดที่มีค่าเป็นศูนย์ในสเกลลอการิทึม`, color: "#64748B", padding: { bottom: 8 } },
          tooltip: {
            callbacks: {
              title: (items) => `${items[0].dataset.label} · ${U.monthLabelFull(items[0].raw.code)}`,
              label: (ctx) => [
                ` จำนวนบริการ: ${fmt.int(ctx.raw.x)} ครั้ง`,
                ` Adj.RW: ${fmt.num(ctx.raw.y, 4)}`,
                ` CMI: ${ctx.raw.x > 0 ? fmt.num(ctx.raw.y / ctx.raw.x, 4) : "N/A"}`,
                ` ค่าชดเชย: ${fmt.money(ctx.raw.comp)}`
              ]
            }
          }
        },
        scales: {
          x: { type: axisType, beginAtZero: !log, title: { display: true, text: "จำนวนบริการ (ครั้ง)" }, ticks: { callback: (v) => fmt.int(Number(v)) } },
          y: { type: axisType, beginAtZero: !log, title: { display: true, text: "Adj.RW" }, ticks: { callback: (v) => fmt.num(Number(v), Number.isInteger(Number(v)) ? 0 : 1) } }
        }
      }
    }, !datasets.length);
  }

  function renderTable(rows, cur) {
    const list = [...groupSum(rows, (r) => r.service_type).entries()].map(([type, a]) => ({
      service_type: type,
      service_count: a.service_count,
      adj_rw: a.adj_rw,
      cmi: a.service_count > 0 ? a.adj_rw / a.service_count : null,
      br_after_deduction: a.br_after_deduction,
      br_k: a.br_k,
      compensation: a.compensation,
      per_case: a.service_count > 0 ? a.compensation / a.service_count : null,
      per_rw: a.adj_rw > 0 ? a.compensation / a.adj_rw : null,
      share: cur.compensation ? (a.compensation / cur.compensation) * 100 : null
    }));
    state.table.setRows(list);
    setText("#table-sub", `${currentLabel()} · ${fmt.int(list.length)} ประเภทบริการ · หน่วยเงิน: บาท`);
  }

  return { init, show, invalidate, onAuthChange, rerender };
})();
