/**
 * import.js — นำเข้าข้อมูลจาก Excel / CSV
 * เลือกไฟล์ → ตรวจสอบ Header → แสดงตัวอย่าง → ตรวจชนิดข้อมูล/ข้อผิดพลาด → เลือกโหมด → ยืนยัน
 * → ส่งให้ GAS ตรวจสอบซ้ำและบันทึก (ImportLogs + AuditLogs) → แสดงสรุปผล
 */
const Importer = (() => {
  "use strict";
  const { $, $$, html, raw, setHtml, fmt } = U;

  const COLUMNS = [
    { field: "stm_period", header: "งวด STM", aliases: ["stmperiod", "งวด"] },
    { field: "month_code", header: "เดือน", aliases: ["monthcode", "month"] },
    { field: "fiscal_year", header: "ปีงบประมาณ", aliases: ["ปีงบ", "fiscalyear"] },
    { field: "service_type", header: "ประเภทบริการ", aliases: ["servicetype"] },
    { field: "br_after_deduction", header: "BR หลังหักเงินกัน สป.สธ.", aliases: ["brafterdeduction"] },
    { field: "br_k", header: "BR คูณ K สป.สธ.", aliases: ["brk", "brxk"] },
    { field: "service_count", header: "ครั้ง(บริการ)", aliases: ["จำนวนครั้งบริการ", "servicecount"] },
    { field: "adj_rw", header: "Adj.RW ที่ชดเชย", aliases: ["adjrw"] },
    { field: "compensation", header: "ชดเชยก่อนหักเงินเดือน", aliases: ["ค่าชดเชยก่อนหักเงินเดือน", "compensation"] }
  ];
  const MODE_LABELS = { append: "Append (เพิ่มข้อมูลใหม่)", upsert: "Upsert (เพิ่มใหม่หรืออัปเดต)", replace: "Replace Batch (แทนที่งวด STM)" };

  /** ตัดช่องว่าง จุด วงเล็บ ขีด และ _ ออก เพื่อให้หัวตารางที่พิมพ์ต่างกันเล็กน้อยยังจับคู่ได้ */
  const normalizeHeader = (h) => String(h ?? "").normalize("NFC").replace(/[\s ​-‍﻿._()[\]-]/g, "").toLowerCase();
  const ALIAS = new Map();
  COLUMNS.forEach((c) => [c.header, c.field, ...c.aliases].forEach((a) => ALIAS.set(normalizeHeader(a), c.field)));

  const state = { file: null, workbook: null, parsed: null, busy: false, tables: {} };
  const setText = (sel, text) => { const el = $(sel); if (el) el.textContent = text; };

  /* ============================== Init ============================== */
  function init() {
    const input = $("#imp-file");
    const dropzone = $("#imp-dropzone");
    input.addEventListener("change", () => {
      const file = input.files && input.files[0];
      input.value = "";
      if (file) handleFile(file);
    });
    ["dragenter", "dragover"].forEach((ev) => dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      dropzone.classList.add("is-dragover");
    }));
    ["dragleave", "dragend", "drop"].forEach((ev) => dropzone.addEventListener(ev, () => dropzone.classList.remove("is-dragover")));
    dropzone.addEventListener("drop", (e) => {
      e.preventDefault();
      const file = e.dataTransfer?.files?.[0];
      if (file) handleFile(file);
    });

    $("#imp-sheet").addEventListener("change", (e) => parseSheet(e.target.value));

    const tabs = $$("[data-imp-tab]");
    tabs.forEach((btn) => btn.addEventListener("click", () => selectTab(btn.dataset.impTab)));
    $("#imp-check-card .tabs").addEventListener("keydown", (e) => {
      if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
      const i = tabs.findIndex((t) => t.getAttribute("aria-selected") === "true");
      const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
      selectTab(next.dataset.impTab);
      next.focus();
    });

    $$('input[name="imp-mode"]').forEach((r) => r.addEventListener("change", updateModeUI));
    $("#imp-replace-periods").addEventListener("change", updateSubmitState);
    $("#imp-ack").addEventListener("change", updateSubmitState);
    $("#imp-reset").addEventListener("click", reset);
    $("#imp-new").addEventListener("click", reset);
    $("#imp-dryrun").addEventListener("click", () => submit(true));
    $("#imp-submit").addEventListener("click", () => submit(false));

    const valueCol = (field, label, type) => ({
      key: field, label, type,
      value: (r) => (r.errors.length ? r.raw[field] : r.record[field])
    });

    state.tables.preview = new U.DataTable($("#imp-preview-table"), {
      rowKey: "rowNo", exportable: false, columnToggle: false, emptyText: "ไม่มีแถวข้อมูล",
      rowClass: (r) => (r.errors.length ? "is-inactive" : ""),
      columns: [
        { key: "rowNo", label: "แถว", type: "int" },
        {
          key: "status", label: "สถานะ",
          value: (r) => (r.errors.length ? "ไม่ผ่าน" : r.warnings.length ? "มีคำเตือน" : "ผ่าน"),
          render: (r) => (r.errors.length
            ? html`<span class="badge badge-danger"><i class="bi bi-x-circle-fill" aria-hidden="true"></i>ไม่ผ่าน</span>`
            : r.warnings.length
              ? html`<span class="badge badge-warning"><i class="bi bi-exclamation-triangle-fill" aria-hidden="true"></i>มีคำเตือน</span>`
              : html`<span class="badge badge-success"><i class="bi bi-check-circle-fill" aria-hidden="true"></i>ผ่าน</span>`)
        },
        valueCol("stm_period", "งวด STM"),
        valueCol("month_code", "เดือน"),
        valueCol("fiscal_year", "ปีงบประมาณ"),
        valueCol("service_type", "ประเภทบริการ"),
        valueCol("br_after_deduction", "BR หลังหักเงินกัน สป.สธ.", "money"),
        valueCol("br_k", "BR คูณ K สป.สธ.", "money"),
        valueCol("service_count", "ครั้ง(บริการ)", "count"),
        valueCol("adj_rw", "Adj.RW ที่ชดเชย", "num4"),
        valueCol("compensation", "ชดเชยก่อนหักเงินเดือน", "money")
      ]
    });

    const issueColumns = (kind) => [
      { key: "rowNo", label: "แถวในไฟล์", type: "int" },
      { key: "stm_period", label: "งวด STM", value: (r) => r.record.stm_period || String(r.raw.stm_period ?? "") },
      { key: "service_type", label: "ประเภทบริการ", value: (r) => r.record.service_type },
      { key: "reasons", label: kind === "errors" ? "เหตุผลที่ไม่ผ่าน" : "คำเตือน", className: "wrap", value: (r) => r[kind].join(" · ") }
    ];
    state.tables.errors = new U.DataTable($("#imp-error-table"), {
      rowKey: "rowNo", columnToggle: false, exportName: "ip-uc-import-errors", sheetName: "ข้อผิดพลาด",
      emptyText: "ไม่พบข้อผิดพลาด", columns: issueColumns("errors")
    });
    state.tables.warnings = new U.DataTable($("#imp-warning-table"), {
      rowKey: "rowNo", columnToggle: false, exportName: "ip-uc-import-warnings", sheetName: "คำเตือน",
      emptyText: "ไม่พบคำเตือน", columns: issueColumns("warnings")
    });
    state.tables.result = new U.DataTable($("#imp-result-table"), {
      rowKey: "row", columnToggle: false, exportName: "ip-uc-import-rejected", sheetName: "แถวที่ไม่ผ่าน",
      emptyText: "ไม่มีแถวที่ไม่ผ่าน",
      columns: [
        { key: "row", label: "แถวในไฟล์", type: "int" },
        { key: "stm_period", label: "งวด STM" },
        { key: "service_type", label: "ประเภทบริการ" },
        { key: "reasons", label: "เหตุผลที่ไม่ผ่าน", className: "wrap", value: (r) => (r.reasons || []).join(" · ") }
      ]
    });
  }

  function show() { /* หน้า Import ไม่ต้องโหลดข้อมูลล่วงหน้า */ }

  /* ============================== Read file ============================== */
  const fileSize = (bytes) => (bytes >= 1048576 ? `${fmt.num(bytes / 1048576, 2)} MB` : `${fmt.num(bytes / 1024, 1)} KB`);
  const sheetRows = (ws) => XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "", blankrows: true });
  const scoreRow = (line) => new Set((line || []).map((cell) => ALIAS.get(normalizeHeader(cell))).filter(Boolean)).size;

  async function handleFile(file) {
    if (!Auth.hasRole("EDITOR")) {
      U.toast("ไม่มีสิทธิ์นำเข้าข้อมูล", "danger");
      return;
    }
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    if (!["xlsx", "xls", "csv"].includes(ext)) {
      U.toast("รองรับเฉพาะไฟล์ .xlsx .xls และ .csv", "danger");
      return;
    }
    if (file.size > CONFIG.MAX_IMPORT_FILE_MB * 1024 * 1024) {
      U.toast(`ไฟล์มีขนาดเกิน ${CONFIG.MAX_IMPORT_FILE_MB} MB`, "danger");
      return;
    }
    if (!window.XLSX) {
      U.toast("ไม่สามารถโหลดไลบรารีอ่านไฟล์ Excel ได้ กรุณารีเฟรชหน้าแล้วลองใหม่", "danger");
      return;
    }

    reset(false);
    state.file = file;
    const info = $("#imp-file-info");
    info.hidden = false;
    setHtml(info, html`<span class="spinner" aria-hidden="true"></span> กำลังอ่านไฟล์ <strong>${file.name}</strong>...`);

    try {
      const buffer = await file.arrayBuffer();
      let workbook;
      if (ext === "csv") {
        let text = new TextDecoder("utf-8").decode(buffer);
        if (text.includes("�")) {
          try { text = new TextDecoder("windows-874").decode(buffer); } catch (e) { /* ใช้ UTF-8 */ }
        }
        workbook = XLSX.read(text.replace(/^﻿/, ""), { type: "string", raw: true });
      } else {
        workbook = XLSX.read(buffer, { type: "array", cellDates: false });
      }
      const names = workbook.SheetNames || [];
      if (!names.length) throw new Error("ไม่พบชีตข้อมูลในไฟล์");
      state.workbook = workbook;

      const ranked = names
        .map((name) => ({ name, score: Math.max(0, ...sheetRows(workbook.Sheets[name]).slice(0, 20).map(scoreRow)) }))
        .sort((a, b) => b.score - a.score);
      const sheetSelect = $("#imp-sheet");
      setHtml(sheetSelect, names.map((n) => html`<option value="${n}">${n}</option>`));
      sheetSelect.value = ranked[0].name;
      $("#imp-sheet-wrap").hidden = names.length < 2;

      setHtml(info, html`<i class="bi bi-file-earmark-check-fill" aria-hidden="true"></i>
        <div><strong>${file.name}</strong><br><small class="text-muted">${fileSize(file.size)} · ${names.length} ชีต</small></div>`);
      parseSheet(ranked[0].name);
    } catch (err) {
      console.error(err);
      setHtml(info, html`<div class="alert alert-danger"><i class="bi bi-x-octagon-fill" aria-hidden="true"></i>
        <div>ไม่สามารถอ่านไฟล์ได้: ${err.message || String(err)} — กรุณาตรวจสอบว่าไฟล์ไม่ได้ตั้งรหัสผ่านและเป็นรูปแบบที่รองรับ</div></div>`);
    }
  }

  function parseSheet(name) {
    const ws = state.workbook.Sheets[name];
    const aoa = sheetRows(ws);
    const startRow = ws["!ref"] ? XLSX.utils.decode_range(ws["!ref"]).s.r : 0;

    let headerIdx = -1;
    let best = 0;
    for (let i = 0; i < Math.min(aoa.length, 20); i++) {
      const s = scoreRow(aoa[i]);
      if (s > best) {
        best = s;
        headerIdx = i;
      }
      if (s === COLUMNS.length) break;
    }

    const parsed = {
      sheet: name, headerRowNo: null, mapping: {}, missing: [], duplicateHeaders: [],
      rows: [], blankRows: 0, noHeader: false, tooMany: false
    };

    if (headerIdx < 0 || best < 3) {
      parsed.noHeader = true;
      parsed.missing = COLUMNS.map((c) => c.field);
    } else {
      parsed.headerRowNo = startRow + headerIdx + 1;
      aoa[headerIdx].forEach((cell, i) => {
        const field = ALIAS.get(normalizeHeader(cell));
        if (!field) return;
        if (field in parsed.mapping) parsed.duplicateHeaders.push(String(cell));
        else parsed.mapping[field] = i;
      });
      parsed.missing = COLUMNS.filter((c) => !(c.field in parsed.mapping)).map((c) => c.field);
    }

    if (!parsed.missing.length) {
      const seen = new Map();
      for (let i = headerIdx + 1; i < aoa.length; i++) {
        const line = aoa[i] || [];
        const rawValues = {};
        let blank = true;
        COLUMNS.forEach((c) => {
          const v = line[parsed.mapping[c.field]];
          rawValues[c.field] = v === undefined || v === null ? "" : v;
          if (String(rawValues[c.field]).trim() !== "") blank = false;
        });
        if (blank) {
          parsed.blankRows++;
          continue;
        }
        const rowNo = startRow + i + 1;
        const v = U.validateRecord(rawValues);
        const errors = v.errors.slice();
        const key = U.businessKey(v.record.stm_period, v.record.service_type);
        if (!errors.length) {
          if (seen.has(key)) errors.push(`ข้อมูลซ้ำในไฟล์กับแถวที่ ${seen.get(key)} (งวด STM + ประเภทบริการ)`);
          else seen.set(key, rowNo);
        }
        parsed.rows.push({ rowNo, raw: rawValues, record: v.record, errors, warnings: v.warnings, key });
      }
      parsed.tooMany = parsed.rows.length > CONFIG.MAX_IMPORT_ROWS;
    }

    state.parsed = parsed;
    renderCheck();
  }

  /* ============================== Check ============================== */
  function stat(icon, label, value, tone) {
    return html`<div class="stat ${tone}"><div class="stat-label"><i class="bi ${icon}" aria-hidden="true"></i>${label}</div><div class="stat-value">${fmt.int(value)}</div></div>`;
  }

  function stats(p) {
    const valid = p.rows.filter((r) => !r.errors.length);
    return {
      total: p.rows.length,
      valid: valid.length,
      invalid: p.rows.length - valid.length,
      warn: valid.filter((r) => r.warnings.length).length,
      periods: new Set(valid.map((r) => r.record.stm_period)).size
    };
  }

  function renderCheck() {
    const p = state.parsed;
    const s = stats(p);
    $("#imp-check-card").hidden = false;
    $("#imp-result-card").hidden = true;

    const alerts = [];
    if (p.noHeader) {
      alerts.push(html`<div class="alert alert-danger"><i class="bi bi-x-octagon-fill" aria-hidden="true"></i>
        <div>ไม่พบแถวหัวตาราง (Header) ใน 20 แถวแรกของชีต “${p.sheet}” กรุณาใช้หัวตารางตามไฟล์ตัวอย่าง</div></div>`);
    } else if (p.missing.length) {
      const names = COLUMNS.filter((c) => p.missing.includes(c.field)).map((c) => c.header);
      alerts.push(html`<div class="alert alert-danger"><i class="bi bi-x-octagon-fill" aria-hidden="true"></i>
        <div>ไม่พบ Header ที่จำเป็น ${names.length} รายการ: <strong>${names.join(", ")}</strong> — ไม่สามารถนำเข้าได้จนกว่าจะแก้ไขไฟล์</div></div>`);
    } else {
      alerts.push(html`<div class="alert alert-success"><i class="bi bi-check-circle-fill" aria-hidden="true"></i>
        <div>พบ Header ครบทั้ง ${COLUMNS.length} คอลัมน์ ที่แถว ${p.headerRowNo} ของชีต “${p.sheet}”</div></div>`);
    }
    if (p.duplicateHeaders.length) {
      alerts.push(html`<div class="alert alert-warning"><i class="bi bi-exclamation-triangle-fill" aria-hidden="true"></i>
        <div>พบหัวคอลัมน์ซ้ำ: ${p.duplicateHeaders.join(", ")} — ระบบใช้คอลัมน์แรกที่พบ</div></div>`);
    }
    if (p.tooMany) {
      alerts.push(html`<div class="alert alert-danger"><i class="bi bi-x-octagon-fill" aria-hidden="true"></i>
        <div>จำนวนแถว ${fmt.int(p.rows.length)} เกินกำหนด ${fmt.int(CONFIG.MAX_IMPORT_ROWS)} แถวต่อครั้ง กรุณาแบ่งไฟล์</div></div>`);
    }
    if (!p.missing.length && !s.valid) {
      alerts.push(html`<div class="alert alert-danger"><i class="bi bi-x-octagon-fill" aria-hidden="true"></i>
        <div>ไม่มีแถวที่ผ่านการตรวจสอบ กรุณาดูรายละเอียดในแท็บ “ข้อผิดพลาด”</div></div>`);
    }

    const headerItems = COLUMNS.map((c) => {
      const ok = c.field in p.mapping;
      return html`<div class="header-item ${ok ? "ok" : "missing"}">
        <i class="bi ${ok ? "bi-check-circle-fill" : "bi-x-circle-fill"}" aria-hidden="true"></i>
        <span>${c.header}<span class="sr-only">${ok ? " พบ" : " ไม่พบ"}</span></span>
        <small>${ok ? `คอลัมน์ ${XLSX.utils.encode_col(p.mapping[c.field])}` : "ไม่พบ"}</small></div>`;
    });
    setHtml($("#imp-headers"), html`${alerts}<div class="header-check mt-4">${headerItems}</div>`);

    setHtml($("#imp-stats"), [
      stat("bi-list-ol", "แถวข้อมูลทั้งหมด", s.total, "tone-1"),
      stat("bi-check-circle-fill", "ผ่านการตรวจสอบ", s.valid, "tone-up"),
      stat("bi-x-octagon-fill", "ไม่ผ่าน", s.invalid, "tone-down"),
      stat("bi-exclamation-triangle-fill", "ผ่านแต่มีคำเตือน", s.warn, "tone-4"),
      stat("bi-collection-fill", "งวด STM", s.periods, "tone-3"),
      stat("bi-dash-square", "แถวว่างที่ข้าม", p.blankRows, "tone-muted")
    ]);
    setText("#imp-check-sub", `ชีต “${p.sheet}” · ตรวจสอบที่เบราว์เซอร์แล้ว และระบบจะตรวจสอบซ้ำที่เซิร์ฟเวอร์ก่อนบันทึก`);
    setText("#imp-err-count", fmt.int(s.invalid));
    setText("#imp-warn-count", fmt.int(s.warn));

    state.tables.preview.setRows(p.rows, { resetPage: true });
    state.tables.errors.setRows(p.rows.filter((r) => r.errors.length), { resetPage: true });
    state.tables.warnings.setRows(p.rows.filter((r) => !r.errors.length && r.warnings.length), { resetPage: true });
    selectTab(s.invalid ? "errors" : "preview");

    const canImport = !p.missing.length && !p.tooMany && s.valid > 0;
    $("#imp-mode-card").hidden = !canImport;
    if (canImport) {
      const periods = [...new Set(p.rows.filter((r) => !r.errors.length).map((r) => r.record.stm_period))].sort();
      setHtml($("#imp-replace-periods"), periods.map((per) => html`<label class="check"><input type="checkbox" value="${per}" checked> ${per}</label>`));
      $("#imp-ack-wrap").hidden = s.invalid === 0;
      $("#imp-ack").checked = false;
      setText("#imp-ack-text", `รับทราบว่าแถวที่ไม่ผ่านการตรวจสอบ ${fmt.int(s.invalid)} แถว จะไม่ถูกนำเข้า (รายละเอียดจะแสดงในสรุปผลและบันทึกใน Import Logs)`);
      updateModeUI();
      setStep(3);
    } else {
      setStep(2);
    }
  }

  function selectTab(name) {
    $$("[data-imp-tab]").forEach((btn) => {
      const active = btn.dataset.impTab === name;
      btn.setAttribute("aria-selected", String(active));
      btn.tabIndex = active ? 0 : -1;
    });
    ["preview", "errors", "warnings"].forEach((t) => { $(`#imp-tab-${t}`).hidden = t !== name; });
  }

  function setStep(n) {
    $$("#import-stepper .step").forEach((el) => {
      const step = Number(el.dataset.step);
      el.classList.toggle("is-done", step < n);
      el.classList.toggle("is-active", step === n);
      if (step === n) el.setAttribute("aria-current", "step"); else el.removeAttribute("aria-current");
    });
  }

  const selectedMode = () => $('input[name="imp-mode"]:checked')?.value || "upsert";
  const selectedPeriods = () => $$("#imp-replace-periods input:checked").map((i) => i.value);

  function updateModeUI() {
    $("#imp-replace-wrap").hidden = selectedMode() !== "replace";
    updateSubmitState();
  }

  function updateSubmitState() {
    const p = state.parsed;
    if (!p) return;
    const s = stats(p);
    const noPeriods = selectedMode() === "replace" && !selectedPeriods().length;
    $("#imp-submit").disabled = state.busy || noPeriods || (s.invalid > 0 && !$("#imp-ack").checked);
    $("#imp-dryrun").disabled = state.busy || noPeriods;
  }

  /* ============================== Submit ============================== */
  async function submit(dryRun) {
    const p = state.parsed;
    if (!p || p.missing.length || state.busy) return;
    if (!Auth.hasRole("EDITOR")) {
      U.toast("ไม่มีสิทธิ์นำเข้าข้อมูล", "danger");
      return;
    }
    const s = stats(p);
    const mode = selectedMode();
    const periods = mode === "replace" ? selectedPeriods() : [];
    if (mode === "replace" && !periods.length) {
      U.toast("กรุณาเลือกงวด STM ที่ต้องการแทนที่", "warning");
      return;
    }
    if (!dryRun && s.invalid > 0 && !$("#imp-ack").checked) {
      U.toast("กรุณายืนยันรับทราบแถวที่ไม่ผ่านการตรวจสอบก่อนนำเข้า", "warning");
      $("#imp-ack").focus();
      return;
    }

    if (!dryRun) {
      const ok = await U.confirm({
        title: "ยืนยันการนำเข้าข้อมูล",
        message: html`<p>นำเข้าไฟล์ <strong>${state.file.name}</strong> ด้วยโหมด <strong>${MODE_LABELS[mode]}</strong></p>`,
        details: html`<dl class="detail-list">
          <dt>แถวที่ผ่านการตรวจสอบ</dt><dd>${fmt.int(s.valid)} แถว</dd>
          <dt>แถวที่ไม่ผ่าน</dt><dd>${fmt.int(s.invalid)} แถว</dd>
          ${mode === "replace" ? html`<dt>งวดที่จะถูกแทนที่</dt><dd>${periods.join(", ")}</dd>` : ""}
        </dl>`,
        confirmText: "ยืนยันนำเข้า"
      });
      if (!ok) return;
      if (mode === "replace") {
        const again = await U.confirm({
          title: "ยืนยันการแทนที่ข้อมูลอีกครั้ง",
          tone: "danger",
          message: html`<div class="alert alert-danger"><i class="bi bi-exclamation-octagon-fill" aria-hidden="true"></i>
            <div>ข้อมูลเดิมทั้งหมดของงวด <strong>${periods.join(", ")}</strong> จะถูกปิดใช้งาน (Soft Delete) และแทนที่ด้วยข้อมูลจากไฟล์นี้</div></div>`,
          requireText: "แทนที่ข้อมูล",
          confirmText: "แทนที่ข้อมูล"
        });
        if (!again) return;
      }
    }

    const payload = {
      mode,
      dry_run: dryRun,
      file_name: state.file.name,
      replace_periods: periods,
      confirm_replace: mode === "replace" && !dryRun,
      rows: p.rows.map((r) => Object.assign({ _row: r.rowNo }, r.raw))
    };

    const btn = dryRun ? $("#imp-dryrun") : $("#imp-submit");
    state.busy = true;
    updateSubmitState();
    U.setBusy(btn, true, dryRun ? "กำลังตรวจสอบกับฐานข้อมูล..." : "กำลังนำเข้าข้อมูล...");
    try {
      const res = await API.call("importData", payload, { timeout: CONFIG.IMPORT_TIMEOUT_MS });
      renderResult(res.data, res.message);
      if (!dryRun) {
        Dashboard.invalidate();
        DataManager.invalidate();
        AdminPanel.invalidate();
        U.toast(res.message, res.data.rows_rejected ? "warning" : "success", 8000);
      }
    } catch (err) {
      U.toast(API.describeError(err), "danger", 10000);
    } finally {
      state.busy = false;
      U.setBusy(btn, false);
      updateSubmitState();
    }
  }

  function renderResult(d, message) {
    const card = $("#imp-result-card");
    card.hidden = false;
    setStep(d.dry_run ? 3 : 4);
    setHtml($("#imp-result-title"), html`<i class="bi ${d.dry_run ? "bi-clipboard-check-fill" : "bi-4-circle-fill"}" aria-hidden="true"></i> ${d.dry_run ? "ผลการตรวจสอบกับฐานข้อมูล (ยังไม่บันทึก)" : "สรุปผลการนำเข้า"}`);
    setText("#imp-result-sub", `ไฟล์ ${d.file_name} · โหมด ${MODE_LABELS[d.mode] || d.mode}${d.dry_run ? "" : ` · รหัสนำเข้า ${d.import_id}`}`);
    setHtml($("#imp-result-badge"), d.dry_run
      ? html`<span class="badge badge-info"><i class="bi bi-eye" aria-hidden="true"></i> ทดลอง — ยังไม่บันทึก</span>`
      : d.rows_rejected
        ? html`<span class="badge badge-warning"><i class="bi bi-exclamation-triangle-fill" aria-hidden="true"></i> นำเข้าบางส่วน</span>`
        : html`<span class="badge badge-success"><i class="bi bi-check-circle-fill" aria-hidden="true"></i> นำเข้าสำเร็จ</span>`);
    setHtml($("#imp-result-alert"), html`<div class="alert ${d.dry_run ? "alert-info" : d.rows_rejected ? "alert-warning" : "alert-success"}">
      <i class="bi ${d.dry_run ? "bi-info-circle-fill" : "bi-check2-circle"}" aria-hidden="true"></i>
      <div>${message}${d.dry_run ? " — กด “ยืนยันการนำเข้า” เพื่อบันทึกจริง" : ""}</div></div>`);

    const cards = [
      stat("bi-inbox-fill", "จำนวนแถวที่รับ", d.rows_received, "tone-1"),
      stat("bi-plus-circle-fill", d.dry_run ? "จะเพิ่มใหม่" : "เพิ่มใหม่", d.rows_inserted, "tone-up")
    ];
    if (d.mode === "replace") cards.push(stat("bi-arrow-left-right", d.dry_run ? "ข้อมูลเดิมที่จะถูกแทนที่" : "ข้อมูลเดิมที่ถูกแทนที่", d.rows_replaced, "tone-3"));
    else cards.push(stat("bi-arrow-repeat", d.dry_run ? "จะอัปเดต" : "อัปเดต", d.rows_updated, "tone-2"));
    cards.push(stat("bi-x-octagon-fill", "ไม่ผ่าน", d.rows_rejected, "tone-down"));
    cards.push(stat("bi-exclamation-triangle-fill", "คำเตือน", d.warning_count || 0, "tone-4"));
    setHtml($("#imp-result-stats"), cards);

    state.tables.result.setRows(d.rejected || [], { resetPage: true });
    if ((d.rejected || []).length < d.rows_rejected) {
      U.toast(`แสดงรายละเอียด ${fmt.int(d.rejected.length)} จาก ${fmt.int(d.rows_rejected)} แถวที่ไม่ผ่าน`, "info");
    }
    card.focus({ preventScroll: true });
    card.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function reset(scroll = true) {
    state.parsed = null;
    state.workbook = null;
    state.file = null;
    ["#imp-check-card", "#imp-mode-card", "#imp-result-card", "#imp-file-info", "#imp-sheet-wrap"].forEach((sel) => { $(sel).hidden = true; });
    const upsert = $('input[name="imp-mode"][value="upsert"]');
    if (upsert) upsert.checked = true;
    setStep(1);
    if (scroll === true) window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return { init, show };
})();
