/**
 * utils.js — ตัวช่วยกลางของ Frontend
 * - html`` template ที่ escape ค่าอัตโนมัติ (ป้องกัน XSS)
 * - รูปแบบตัวเลข / เดือน / วันที่ภาษาไทย
 * - Toast, Modal, Confirm, MultiSelect, DataTable (Sort / Search / Pagination / Column toggle / Export)
 * - ตัวตรวจสอบข้อมูล 1 แถว (ใช้ร่วมกันใน Import และจัดการข้อมูล — Backend ตรวจซ้ำเสมอ)
 */
const U = (() => {
  "use strict";

  /* ------------------------------ DOM / HTML ------------------------------ */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" };
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"'`]/g, (c) => ESC[c]);

  class SafeHtml {
    constructor(value) { this.value = value; }
    toString() { return this.value; }
  }
  const raw = (value) => new SafeHtml(String(value ?? ""));

  function renderValue(v) {
    if (v instanceof SafeHtml) return v.value;
    if (Array.isArray(v)) return v.map(renderValue).join("");
    if (v === null || v === undefined || v === false) return "";
    return escapeHtml(v);
  }

  /** Tagged template: ทุกค่าที่แทรกจะถูก escape ยกเว้นค่าที่ห่อด้วย raw() หรือ html`` */
  function html(strings, ...values) {
    let out = strings[0];
    values.forEach((v, i) => { out += renderValue(v) + strings[i + 1]; });
    return new SafeHtml(out);
  }

  const setHtml = (el, content) => { if (el) el.innerHTML = renderValue(content); };

  let seq = 0;
  const uid = (prefix = "u") => `${prefix}-${++seq}`;

  function debounce(fn, wait = 150) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
  }

  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  /* ------------------------------ Numbers ------------------------------ */
  const nfCache = new Map();
  function nf(min, max) {
    const key = `${min}:${max}`;
    if (!nfCache.has(key)) {
      nfCache.set(key, new Intl.NumberFormat("th-TH", { minimumFractionDigits: min, maximumFractionDigits: max }));
    }
    return nfCache.get(key);
  }
  const isNum = (v) => typeof v === "number" && Number.isFinite(v);

  const fmt = {
    int: (v) => (isNum(v) ? nf(0, 0).format(v) : "-"),
    num: (v, d = 2) => (isNum(v) ? nf(d, d).format(v) : "-"),
    money: (v, d = 2) => (isNum(v) ? `${v < 0 ? "-" : ""}฿${nf(d, d).format(Math.abs(v))}` : "-"),
    pct: (v, d = 1) => (isNum(v) ? `${nf(d, d).format(v)}%` : "N/A"),
    signed: (v, d = 2) => {
      if (!isNum(v)) return "N/A";
      const sign = v > 0 ? "+" : v < 0 ? "−" : "±";
      return sign + nf(d, d).format(Math.abs(v));
    },
    /** เงินจำนวนมาก → "38.46 ล้านบาท" */
    moneyCompact: (v) => {
      if (!isNum(v)) return { value: "-", unit: "" };
      if (Math.abs(v) >= 1e6) return { value: nf(2, 2).format(v / 1e6), unit: "ล้านบาท" };
      return { value: nf(2, 2).format(v), unit: "บาท" };
    },
    axisMoney: (v) => {
      if (!isNum(v)) return "";
      const a = Math.abs(v);
      if (a >= 1e6) return `${nf(0, 1).format(v / 1e6)} ล้าน`;
      if (a >= 1e3) return `${nf(0, 1).format(v / 1e3)} พัน`;
      return nf(0, 0).format(v);
    }
  };

  /* ------------------------------ เดือน / วันที่ ------------------------------ */
  const MONTHS_SHORT = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  const MONTHS_FULL = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
  const FISCAL_MONTHS = ["10", "11", "12", "01", "02", "03", "04", "05", "06", "07", "08", "09"];

  const isValidMonthCode = (code) => /^\d{4}$/.test(String(code)) && +String(code).slice(2) >= 1 && +String(code).slice(2) <= 12;
  const monthName = (mm, full = false) => (full ? MONTHS_FULL : MONTHS_SHORT)[Number(mm) - 1] || String(mm);
  const monthLabel = (code) => (isValidMonthCode(code) ? `${monthName(code.slice(2))} ${code.slice(0, 2)}` : String(code ?? "-"));
  const monthLabelFull = (code) => (isValidMonthCode(code) ? `${monthName(code.slice(2), true)} 25${code.slice(0, 2)}` : String(code ?? "-"));
  const fiscalYearOf = (code) => {
    const be = 2500 + Number(String(code).slice(0, 2));
    return String(Number(String(code).slice(2)) >= 10 ? be + 1 : be);
  };

  const dtf = new Intl.DateTimeFormat("th-TH", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok"
  });
  function formatDateTime(iso) {
    if (!iso) return "-";
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? String(iso) : `${dtf.format(d)} น.`;
  }

  /* ------------------------------ Labels ------------------------------ */
  const ROLE_LEVEL = { VIEWER: 1, EDITOR: 2, ADMIN: 3, SUPER_ADMIN: 4 };
  const ROLE_LABELS = { SUPER_ADMIN: "ผู้ดูแลระบบสูงสุด", ADMIN: "ผู้ดูแลระบบ", EDITOR: "ผู้แก้ไขข้อมูล", VIEWER: "ผู้ดูข้อมูล" };
  const STATUS_LABELS = { pending: "รออนุมัติ", approved: "อนุมัติแล้ว", rejected: "ถูกปฏิเสธ", suspended: "ถูกระงับ" };

  function roleBadge(role) {
    const cls = { SUPER_ADMIN: "badge-violet", ADMIN: "badge-primary", EDITOR: "badge-brand", VIEWER: "badge-neutral" }[role] || "badge-neutral";
    const icon = { SUPER_ADMIN: "bi-stars", ADMIN: "bi-shield-fill-check", EDITOR: "bi-pencil-fill", VIEWER: "bi-eye-fill" }[role] || "bi-person";
    return html`<span class="badge ${cls}" title="${ROLE_LABELS[role] || role}"><i class="bi ${icon}" aria-hidden="true"></i>${role || "-"}</span>`;
  }

  function statusBadge(status) {
    const map = {
      approved: ["badge-success", "bi-check-circle-fill"],
      pending: ["badge-warning", "bi-hourglass-split"],
      rejected: ["badge-danger", "bi-x-circle-fill"],
      suspended: ["badge-neutral", "bi-slash-circle-fill"]
    };
    const [cls, icon] = map[status] || ["badge-neutral", "bi-question-circle"];
    return html`<span class="badge ${cls}"><i class="bi ${icon}" aria-hidden="true"></i>${STATUS_LABELS[status] || status || "-"}</span>`;
  }

  /* ------------------------------ States ------------------------------ */
  function stateHtml(kind, message, extra = "") {
    const icons = { empty: "bi-inbox", error: "bi-exclamation-octagon", lock: "bi-shield-lock", info: "bi-info-circle", success: "bi-check-circle" };
    const icon = kind === "loading"
      ? raw('<span class="spinner spinner-lg" aria-hidden="true"></span>')
      : html`<i class="bi ${icons[kind] || icons.info}" aria-hidden="true"></i>`;
    return html`<div class="state state-${kind}" role="${kind === "error" ? "alert" : "status"}">${icon}<p>${message}</p>${extra}</div>`;
  }

  function setBusy(btn, busy, busyText = "กำลังดำเนินการ...") {
    if (!btn) return;
    if (busy) {
      if (btn.dataset.busy === "1") return;
      btn.dataset.busy = "1";
      btn.dataset.label = btn.innerHTML;
      btn.disabled = true;
      setHtml(btn, html`<span class="spinner" aria-hidden="true"></span> ${busyText}`);
    } else if (btn.dataset.busy === "1") {
      btn.innerHTML = btn.dataset.label;
      delete btn.dataset.busy;
      delete btn.dataset.label;
      btn.disabled = false;
    }
  }

  /* ------------------------------ Toast ------------------------------ */
  const TOAST_ICONS = {
    success: "bi-check-circle-fill", danger: "bi-x-octagon-fill", warning: "bi-exclamation-triangle-fill", info: "bi-info-circle-fill"
  };

  function toast(message, type = "info", timeout = 5000) {
    const region = document.getElementById("toast-region");
    if (!region) return;
    const el = document.createElement("div");
    el.className = `toast toast-${type}`;
    el.setAttribute("role", type === "danger" ? "alert" : "status");
    setHtml(el, html`<i class="bi ${TOAST_ICONS[type] || TOAST_ICONS.info}" aria-hidden="true"></i>
      <div class="toast-body">${message}</div>
      <button type="button" class="toast-close" aria-label="ปิดการแจ้งเตือน"><i class="bi bi-x-lg" aria-hidden="true"></i></button>`);
    const remove = () => {
      el.classList.add("is-leaving");
      setTimeout(() => el.remove(), 220);
    };
    el.querySelector(".toast-close").addEventListener("click", remove);
    region.appendChild(el);
    while (region.children.length > 4) region.firstElementChild.remove();
    if (timeout) setTimeout(remove, timeout);
  }

  /* ------------------------------ Modal ------------------------------ */
  const modalStack = [];
  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])';

  function openModal({ title, body, footer, size = "md", onClose, closable = true }) {
    const previous = document.activeElement;
    const id = uid("modal");
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    setHtml(backdrop, html`<div class="modal-dialog modal-${size}" role="dialog" aria-modal="true" aria-labelledby="${id}-title">
      <div class="modal-header">
        <h2 class="modal-title" id="${id}-title">${title}</h2>
        ${closable ? raw('<button type="button" class="btn btn-ghost btn-icon btn-sm" data-modal-close aria-label="ปิดหน้าต่าง"><i class="bi bi-x-lg" aria-hidden="true"></i></button>') : ""}
      </div>
      <div class="modal-body"></div>
      <div class="modal-footer" hidden></div>
    </div>`);

    const dialog = backdrop.firstElementChild;
    const bodyEl = $(".modal-body", dialog);
    const footerEl = $(".modal-footer", dialog);
    if (body instanceof Node) bodyEl.appendChild(body); else setHtml(bodyEl, body);
    if (footer) {
      footerEl.hidden = false;
      if (footer instanceof Node) footerEl.appendChild(footer); else setHtml(footerEl, footer);
    }

    let closed = false;
    const ctrl = { el: dialog, body: bodyEl, footer: footerEl, close, setTitle: (t) => { $(".modal-title", dialog).textContent = t; } };

    function onKey(e) {
      if (modalStack[modalStack.length - 1] !== ctrl) return;
      if (e.key === "Escape" && closable) {
        e.preventDefault();
        close();
      } else if (e.key === "Tab") {
        const items = $$(FOCUSABLE, dialog).filter((el) => el.offsetParent !== null);
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }

    function close(result) {
      if (closed) return;
      closed = true;
      document.removeEventListener("keydown", onKey, true);
      backdrop.remove();
      const i = modalStack.indexOf(ctrl);
      if (i >= 0) modalStack.splice(i, 1);
      if (!modalStack.length) document.body.classList.remove("modal-open");
      if (onClose) onClose(result);
      if (previous && typeof previous.focus === "function" && document.contains(previous)) previous.focus();
    }

    dialog.addEventListener("click", (e) => { if (e.target.closest("[data-modal-close]")) close(); });
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(backdrop);
    document.body.classList.add("modal-open");
    modalStack.push(ctrl);

    requestAnimationFrame(() => {
      const target = $("[autofocus]", dialog)
        || $$("input:not([type=hidden]), select, textarea", bodyEl).find((el) => !el.disabled && el.offsetParent !== null)
        || $$(FOCUSABLE, dialog).find((el) => el.offsetParent !== null);
      if (target) target.focus();
    });
    return ctrl;
  }

  /**
   * หน้าต่างยืนยัน — คืนค่า false เมื่อยกเลิก หรือ object ของค่า input[name] ในหน้าต่างเมื่อยืนยัน
   */
  function confirmDialog({ title = "ยืนยันการทำรายการ", message = "", details = "", confirmText = "ยืนยัน", cancelText = "ยกเลิก", tone = "primary", requireText = "" } = {}) {
    return new Promise((resolve) => {
      const id = uid("confirm");
      const body = html`<div class="form-stack">
        ${message instanceof SafeHtml ? message : html`<p>${message}</p>`}
        ${details}
        ${requireText ? html`<div class="form-group">
          <label class="form-label" for="${id}-text">พิมพ์คำว่า <strong>${requireText}</strong> เพื่อยืนยัน</label>
          <input id="${id}-text" class="form-control" autocomplete="off" data-require-text>
        </div>` : ""}
      </div>`;
      const footer = html`<button type="button" class="btn btn-outline" data-act="cancel">${cancelText}</button>
        <button type="button" class="btn ${tone === "danger" ? "btn-danger" : "btn-secondary"}" data-act="ok" ${requireText ? raw("disabled") : ""}>${confirmText}</button>`;

      let result = false;
      const m = openModal({ title, body, footer, size: "sm", onClose: () => resolve(result) });
      const okBtn = $('[data-act="ok"]', m.footer);
      const input = $("[data-require-text]", m.body);
      if (input) input.addEventListener("input", () => { okBtn.disabled = input.value.trim() !== requireText; });

      m.footer.addEventListener("click", (e) => {
        const act = e.target.closest("[data-act]")?.dataset.act;
        if (act === "cancel") m.close();
        if (act === "ok") {
          const values = {};
          $$("[name]", m.body).forEach((el) => {
            values[el.name] = el.type === "checkbox" ? el.checked : el.value;
          });
          result = values;
          m.close();
        }
      });
    });
  }

  /* ------------------------------ MultiSelect ------------------------------ */
  const openMultiSelects = new Set();

  class MultiSelect {
    constructor(root, opts = {}) {
      this.root = root;
      this.o = Object.assign({ placeholder: "ทั้งหมด", options: [], selected: [], labelId: "", searchable: true, onChange: null }, opts);
      this.id = uid("ms");
      this.options = [];
      this.selected = new Set((this.o.selected || []).map(String));
      this.query = "";
      this.disabled = false;

      root.classList.add("ms");
      setHtml(root, html`
        <button type="button" class="ms-toggle" id="${this.id}-btn" aria-expanded="false" aria-controls="${this.id}-panel"
          ${this.o.labelId ? raw(`aria-labelledby="${escapeHtml(this.o.labelId)} ${this.id}-btn"`) : ""}>
          <span class="ms-value"></span>
          <span class="ms-count" hidden></span>
          <i class="bi bi-chevron-down" aria-hidden="true"></i>
        </button>
        <div class="ms-panel" id="${this.id}-panel" hidden>
          ${this.o.searchable ? html`<input type="search" class="form-control" placeholder="ค้นหาตัวเลือก..." aria-label="ค้นหาตัวเลือก" data-ms="search">` : ""}
          <div class="ms-actions">
            <button type="button" class="ms-link" data-ms="all">เลือกทั้งหมด</button>
            <button type="button" class="ms-link" data-ms="clear">ล้างการเลือก</button>
          </div>
          <ul class="ms-list" role="group" data-ms="list"></ul>
        </div>`);

      this.btn = $(".ms-toggle", root);
      this.panel = $(".ms-panel", root);
      this.list = $('[data-ms="list"]', root);
      this.search = $('[data-ms="search"]', root);
      this.valueEl = $(".ms-value", root);
      this.countEl = $(".ms-count", root);

      this.onDocPointer = (e) => { if (!root.contains(e.target)) this.close(); };
      this.btn.addEventListener("click", () => this.toggle());
      this.panel.addEventListener("change", (e) => {
        const cb = e.target.closest('input[type="checkbox"]');
        if (!cb) return;
        if (cb.checked) this.selected.add(cb.value); else this.selected.delete(cb.value);
        this.updateLabel();
        this.emit();
      });
      this.panel.addEventListener("click", (e) => {
        const act = e.target.closest("[data-ms]")?.dataset.ms;
        if (act === "all") this.visibleOptions().forEach((o) => this.selected.add(o.value));
        else if (act === "clear") this.selected.clear();
        else return;
        this.renderList();
        this.updateLabel();
        this.emit();
      });
      if (this.search) {
        this.search.addEventListener("input", () => {
          this.query = this.search.value.trim().toLowerCase();
          this.renderList();
        });
      }
      root.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && !this.panel.hidden) {
          e.stopPropagation();
          this.close();
          this.btn.focus();
        }
      });
      this.setOptions(this.o.options);
    }

    visibleOptions() {
      return this.query ? this.options.filter((o) => o.label.toLowerCase().includes(this.query)) : this.options;
    }

    setOptions(options) {
      this.options = (options || []).map((o) => ({ value: String(o.value), label: String(o.label ?? o.value) }));
      const valid = new Set(this.options.map((o) => o.value));
      [...this.selected].forEach((v) => { if (!valid.has(v)) this.selected.delete(v); });
      this.renderList();
      this.updateLabel();
    }

    renderList() {
      const opts = this.visibleOptions();
      if (!opts.length) {
        setHtml(this.list, html`<li class="ms-empty">ไม่พบตัวเลือก</li>`);
        return;
      }
      setHtml(this.list, opts.map((o) => html`<li class="ms-option"><label>
        <input type="checkbox" value="${o.value}" ${this.selected.has(o.value) ? raw("checked") : ""}>
        <span>${o.label}</span></label></li>`));
    }

    updateLabel() {
      const values = this.getValues();
      if (!values.length) {
        this.valueEl.textContent = this.o.placeholder;
        this.valueEl.classList.add("is-placeholder");
        this.countEl.hidden = true;
        return;
      }
      const first = this.options.find((o) => o.value === values[0]);
      this.valueEl.textContent = values.length === 1 ? first.label : `${first.label} และอีก ${values.length - 1}`;
      this.valueEl.classList.remove("is-placeholder");
      this.countEl.textContent = String(values.length);
      this.countEl.hidden = false;
    }

    getValues() { return this.options.filter((o) => this.selected.has(o.value)).map((o) => o.value); }

    setValues(values) {
      this.selected = new Set((values || []).map(String));
      this.renderList();
      this.updateLabel();
    }

    setDisabled(disabled) {
      this.disabled = disabled;
      this.btn.disabled = disabled;
      if (disabled) this.close();
    }

    open() {
      if (this.disabled) return;
      openMultiSelects.forEach((m) => m !== this && m.close());
      this.panel.hidden = false;
      this.btn.setAttribute("aria-expanded", "true");
      openMultiSelects.add(this);
      document.addEventListener("pointerdown", this.onDocPointer);
      const rect = this.root.getBoundingClientRect();
      this.root.classList.toggle("align-right", rect.left + 270 > window.innerWidth);
      (this.search || $("input", this.list))?.focus();
    }

    close() {
      if (this.panel.hidden) return;
      this.panel.hidden = true;
      this.btn.setAttribute("aria-expanded", "false");
      openMultiSelects.delete(this);
      document.removeEventListener("pointerdown", this.onDocPointer);
      if (this.search && this.query) {
        this.search.value = "";
        this.query = "";
        this.renderList();
      }
    }

    toggle() { if (this.panel.hidden) this.open(); else this.close(); }
    emit() { if (this.o.onChange) this.o.onChange(this.getValues()); }
  }

  /* ------------------------------ Export ------------------------------ */
  function stamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear() + 543}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  }

  function csvCell(v) {
    if (v === null || v === undefined) return "";
    if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function downloadBlob(filename, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function downloadCSV(filename, headers, rows) {
    const lines = [headers, ...rows].map((r) => r.map(csvCell).join(","));
    downloadBlob(filename, new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }));
  }

  function downloadXLSX(filename, headers, rows, sheetName = "ข้อมูล") {
    if (!window.XLSX) {
      toast("ไม่สามารถโหลดไลบรารี Excel ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่", "danger");
      return;
    }
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws["!cols"] = headers.map((h, i) => {
      const lengths = rows.slice(0, 300).map((r) => String(r[i] ?? "").length);
      return { wch: Math.min(48, Math.max(String(h).length, ...lengths, 6) + 2) };
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, String(sheetName).replace(/[\\/?*[\]:]/g, " ").slice(0, 31));
    XLSX.writeFile(wb, filename);
  }

  /* ------------------------------ DataTable ------------------------------ */
  const NUMERIC_TYPES = ["int", "count", "num2", "num4", "money", "pct"];

  function toNum(v) {
    if (typeof v === "number") return v;
    if (v === "" || v === null || v === undefined) return NaN;
    return Number(v);
  }

  function formatByType(v, type) {
    switch (type) {
      case "int": return fmt.int(toNum(v));
      case "count": {
        const n = toNum(v);
        return Number.isInteger(n) ? fmt.int(n) : fmt.num(n, 2);
      }
      case "num2": return fmt.num(toNum(v), 2);
      case "num4": return fmt.num(toNum(v), 4);
      case "money": return fmt.num(toNum(v), 2);
      case "pct": return fmt.pct(toNum(v), 2);
      case "datetime": return formatDateTime(v);
      default: return v === null || v === undefined || v === "" ? "-" : String(v);
    }
  }

  function compareValues(a, b) {
    const an = typeof a === "number" && Number.isFinite(a);
    const bn = typeof b === "number" && Number.isFinite(b);
    if (an && bn) return a - b;
    if (an) return -1;
    if (bn) return 1;
    const as = a === null || a === undefined ? "" : String(a);
    const bs = b === null || b === undefined ? "" : String(b);
    if (!as && bs) return 1;
    if (as && !bs) return -1;
    return as.localeCompare(bs, "th", { numeric: true, sensitivity: "base" });
  }

  class DataTable {
    constructor(root, options) {
      this.root = root;
      this.o = Object.assign({
        columns: [], rows: [], rowKey: null, pageSize: 10, pageSizes: [10, 25, 50, 100],
        searchable: true, searchPlaceholder: "ค้นหาในตาราง...", exportable: true, exportName: "ip-uc-export",
        sheetName: "ข้อมูล", columnToggle: true, emptyText: "ไม่พบข้อมูลตามเงื่อนไข", footer: null,
        sortKey: null, sortDir: "asc", caption: "", onAction: null, rowClass: null, toolbarExtra: null
      }, options);
      this.id = uid("dt");
      this.rows = this.o.rows || [];
      this.keyMap = new Map();
      this.state = {
        search: "", sortKey: this.o.sortKey, sortDir: this.o.sortDir, page: 1, pageSize: this.o.pageSize,
        hidden: new Set(this.o.columns.filter((c) => c.hidden).map((c) => c.key)), status: "ready", message: ""
      };
      this.build();
      this.refresh();
    }

    col(key) { return this.o.columns.find((c) => c.key === key); }
    visibleColumns() { return this.o.columns.filter((c) => !this.state.hidden.has(c.key)); }
    value(col, row) { return col.value ? col.value(row) : row[col.key]; }
    alignClass(col) { return col.align || (NUMERIC_TYPES.includes(col.type) ? "num" : ""); }

    build() {
      const o = this.o;
      setHtml(this.root, html`
        <div class="table-toolbar">
          <div class="table-toolbar-left">
            ${o.searchable ? html`<div class="search">
              <i class="bi bi-search" aria-hidden="true"></i>
              <label class="sr-only" for="${this.id}-search">ค้นหาในตาราง</label>
              <input type="search" id="${this.id}-search" class="form-control" placeholder="${o.searchPlaceholder}" data-dt="search">
            </div>` : ""}
            <div class="head-actions" data-dt="extra"></div>
          </div>
          <div class="table-toolbar-right">
            ${o.columnToggle ? html`<details class="dropdown" data-dt="cols">
              <summary class="btn btn-outline btn-sm"><i class="bi bi-layout-three-columns" aria-hidden="true"></i> คอลัมน์</summary>
              <div class="dropdown-panel" data-dt="col-list"></div>
            </details>` : ""}
            ${o.exportable ? html`
              <button type="button" class="btn btn-outline btn-sm" data-dt="csv"><i class="bi bi-filetype-csv" aria-hidden="true"></i> CSV</button>
              <button type="button" class="btn btn-outline btn-sm" data-dt="xlsx"><i class="bi bi-file-earmark-excel" aria-hidden="true"></i> Excel</button>` : ""}
          </div>
        </div>
        <div class="table-shell">
          <table class="data-table">
            ${o.caption ? html`<caption class="sr-only">${o.caption}</caption>` : ""}
            <thead></thead><tbody></tbody><tfoot></tfoot>
          </table>
        </div>
        <div class="pager" data-dt="pager"></div>`);

      if (o.toolbarExtra) {
        const extra = $('[data-dt="extra"]', this.root);
        if (o.toolbarExtra instanceof Node) extra.appendChild(o.toolbarExtra); else setHtml(extra, o.toolbarExtra);
      }
      this.renderColumnList();

      const search = $('[data-dt="search"]', this.root);
      if (search) {
        search.addEventListener("input", debounce(() => {
          this.state.search = search.value;
          this.state.page = 1;
          this.refresh();
        }, 200));
      }

      this.root.addEventListener("click", (e) => {
        const sortBtn = e.target.closest("[data-sort]");
        if (sortBtn) {
          const key = sortBtn.dataset.sort;
          if (this.state.sortKey === key) {
            this.state.sortDir = this.state.sortDir === "asc" ? "desc" : "asc";
          } else {
            this.state.sortKey = key;
            this.state.sortDir = NUMERIC_TYPES.includes(this.col(key)?.type) ? "desc" : "asc";
          }
          this.refresh();
          return;
        }
        const pageBtn = e.target.closest("[data-page]");
        if (pageBtn && !pageBtn.disabled) {
          this.state.page = Number(pageBtn.dataset.page);
          this.refresh();
          $(".table-shell", this.root).scrollTop = 0;
          return;
        }
        const exp = e.target.closest('[data-dt="csv"], [data-dt="xlsx"]');
        if (exp) {
          this.export(exp.dataset.dt);
          return;
        }
        const act = e.target.closest("[data-action]");
        if (act && this.o.onAction) {
          const tr = act.closest("tr[data-key]");
          const row = tr ? this.keyMap.get(tr.dataset.key) : null;
          this.o.onAction(act.dataset.action, row, act);
        }
      });

      this.root.addEventListener("change", (e) => {
        if (e.target.matches("[data-col-toggle]")) {
          if (e.target.checked) this.state.hidden.delete(e.target.value); else this.state.hidden.add(e.target.value);
          this.refresh();
        } else if (e.target.matches('[data-dt="pagesize"]')) {
          this.state.pageSize = Number(e.target.value);
          this.state.page = 1;
          this.refresh();
        }
      });

      document.addEventListener("pointerdown", (e) => {
        const d = $('[data-dt="cols"]', this.root);
        if (d && d.open && !d.contains(e.target)) d.open = false;
      });
    }

    renderColumnList() {
      const list = $('[data-dt="col-list"]', this.root);
      if (!list) return;
      setHtml(list, this.o.columns.filter((c) => c.toggleable !== false).map((c) => html`<label class="check">
        <input type="checkbox" data-col-toggle value="${c.key}" ${this.state.hidden.has(c.key) ? "" : raw("checked")}> ${c.label}
      </label>`));
    }

    setColumnHidden(key, hidden) {
      if (hidden) this.state.hidden.add(key); else this.state.hidden.delete(key);
      this.renderColumnList();
      this.refresh();
    }

    getFiltered() {
      const q = this.state.search.trim().toLowerCase();
      let list = this.rows;
      if (q) {
        list = list.filter((row) => this.o.columns.some((c) => {
          if (c.searchable === false) return false;
          const v = c.searchValue ? c.searchValue(row) : this.value(c, row);
          const text = `${formatByType(v, c.type)} ${v ?? ""}`.toLowerCase();
          return text.includes(q);
        }));
      }
      const col = this.state.sortKey ? this.col(this.state.sortKey) : null;
      if (col) {
        const dir = this.state.sortDir === "asc" ? 1 : -1;
        const get = (r) => (col.sortValue ? col.sortValue(r) : this.value(col, r));
        list = list.slice().sort((a, b) => compareValues(get(a), get(b)) * dir);
      }
      return list;
    }

    setRows(rows, { resetPage = false } = {}) {
      this.rows = rows || [];
      this.state.status = "ready";
      if (resetPage) this.state.page = 1;
      this.refresh();
    }

    setLoading() { this.state.status = "loading"; this.refresh(); }
    setError(message) { this.state.status = "error"; this.state.message = message; this.refresh(); }

    refresh() {
      const cols = this.visibleColumns();
      const table = $("table", this.root);
      const thead = $("thead", table);
      const tbody = $("tbody", table);
      const tfoot = $("tfoot", table);
      const pager = $('[data-dt="pager"]', this.root);

      setHtml(thead, html`<tr>${cols.map((c) => {
        const active = this.state.sortKey === c.key;
        const sortAttr = active ? (this.state.sortDir === "asc" ? "ascending" : "descending") : "none";
        const icon = active ? (this.state.sortDir === "asc" ? "bi-sort-up" : "bi-sort-down") : "bi-arrow-down-up";
        return html`<th scope="col" class="${this.alignClass(c)}" aria-sort="${c.sortable === false ? "none" : sortAttr}">
          ${c.sortable === false ? c.label : html`<button type="button" class="sort-btn" data-sort="${c.key}" data-active="${active}">${c.label}<i class="bi ${icon}" aria-hidden="true"></i></button>`}
        </th>`;
      })}</tr>`);

      if (this.state.status === "loading") {
        setHtml(tbody, Array.from({ length: 5 }, () => html`<tr>${cols.map(() => html`<td><span class="skeleton skeleton-line"></span></td>`)}</tr>`));
        setHtml(tfoot, "");
        setHtml(pager, html`<span>กำลังโหลดข้อมูล...</span>`);
        return;
      }
      if (this.state.status === "error") {
        setHtml(tbody, html`<tr><td class="table-empty" colspan="${cols.length || 1}">${stateHtml("error", this.state.message || "ไม่สามารถโหลดข้อมูลได้")}</td></tr>`);
        setHtml(tfoot, "");
        setHtml(pager, "");
        return;
      }

      this.keyMap.clear();
      this.rows.forEach((row, i) => this.keyMap.set(this.o.rowKey ? String(row[this.o.rowKey]) : String(i), row));

      const filtered = this.getFiltered();
      const total = filtered.length;
      const pages = Math.max(1, Math.ceil(total / this.state.pageSize));
      this.state.page = Math.min(Math.max(1, this.state.page), pages);
      const start = (this.state.page - 1) * this.state.pageSize;
      const pageRows = filtered.slice(start, start + this.state.pageSize);

      if (!total) {
        setHtml(tbody, html`<tr><td class="table-empty" colspan="${cols.length || 1}">${stateHtml("empty", this.o.emptyText)}</td></tr>`);
      } else {
        setHtml(tbody, pageRows.map((row) => {
          const key = this.o.rowKey ? String(row[this.o.rowKey]) : String(this.rows.indexOf(row));
          const rowClass = this.o.rowClass ? this.o.rowClass(row) : "";
          return html`<tr data-key="${key}" class="${rowClass}">${cols.map((c) => {
            const content = c.render ? c.render(row) : formatByType(this.value(c, row), c.type);
            return html`<td class="${this.alignClass(c)} ${c.className || ""}">${content}</td>`;
          })}</tr>`;
        }));
      }

      if (this.o.footer && total) {
        const f = this.o.footer(filtered);
        setHtml(tfoot, html`<tr>${cols.map((c) => html`<td class="${this.alignClass(c)}">${
          Object.prototype.hasOwnProperty.call(f, c.key) ? formatByType(f[c.key], typeof f[c.key] === "number" ? c.type : "text") : ""
        }</td>`)}</tr>`);
      } else {
        setHtml(tfoot, "");
      }

      const end = Math.min(start + this.state.pageSize, total);
      const windowStart = Math.max(1, Math.min(this.state.page - 2, pages - 4));
      const windowPages = Array.from({ length: Math.min(5, pages) }, (_, i) => windowStart + i);
      setHtml(pager, html`
        <div class="pager-left">
          <span>${total ? `แสดง ${fmt.int(start + 1)}–${fmt.int(end)} จาก ${fmt.int(total)} รายการ` : "0 รายการ"}</span>
          <label class="sr-only" for="${this.id}-size">จำนวนแถวต่อหน้า</label>
          <select id="${this.id}-size" class="form-control" data-dt="pagesize">
            ${this.o.pageSizes.map((n) => html`<option value="${n}" ${n === this.state.pageSize ? raw("selected") : ""}>${n} แถว/หน้า</option>`)}
          </select>
        </div>
        <nav class="pager-buttons" aria-label="เปลี่ยนหน้าตาราง">
          <button type="button" class="page-btn" data-page="${this.state.page - 1}" ${this.state.page <= 1 ? raw("disabled") : ""} aria-label="หน้าก่อนหน้า"><i class="bi bi-chevron-left" aria-hidden="true"></i></button>
          ${windowPages.map((p) => html`<button type="button" class="page-btn" data-page="${p}" ${p === this.state.page ? raw('aria-current="page"') : ""}>${p}</button>`)}
          <button type="button" class="page-btn" data-page="${this.state.page + 1}" ${this.state.page >= pages ? raw("disabled") : ""} aria-label="หน้าถัดไป"><i class="bi bi-chevron-right" aria-hidden="true"></i></button>
        </nav>`);
    }

    export(format) {
      const cols = this.visibleColumns().filter((c) => c.exportable !== false);
      const rows = this.getFiltered();
      if (!rows.length) {
        toast("ไม่มีข้อมูลสำหรับส่งออก", "warning");
        return;
      }
      const headers = cols.map((c) => c.exportLabel || c.label);
      const data = rows.map((r) => cols.map((c) => {
        const v = c.exportValue ? c.exportValue(r) : this.value(c, r);
        if (NUMERIC_TYPES.includes(c.type)) {
          const n = toNum(v);
          return Number.isFinite(n) ? n : "";
        }
        return c.type === "datetime" ? formatDateTime(v) : (v ?? "");
      }));
      if (this.o.footer) {
        const f = this.o.footer(rows);
        data.push(cols.map((c) => (Object.prototype.hasOwnProperty.call(f, c.key) ? f[c.key] ?? "" : "")));
      }
      const name = `${this.o.exportName}-${stamp()}`;
      if (format === "csv") downloadCSV(`${name}.csv`, headers, data);
      else downloadXLSX(`${name}.xlsx`, headers, data, this.o.sheetName);
    }
  }

  /* ------------------------------ Validation ------------------------------ */
  const UNSPECIFIED = "ไม่ระบุประเภทบริการ";
  const NUMERIC_FIELDS = ["br_after_deduction", "br_k", "service_count", "adj_rw", "compensation"];
  const FIELD_LABELS = {
    stm_period: "งวด STM",
    month_code: "เดือน",
    fiscal_year: "ปีงบประมาณ",
    service_type: "ประเภทบริการ",
    br_after_deduction: "BR หลังหักเงินกัน สป.สธ.",
    br_k: "BR คูณ K สป.สธ.",
    service_count: "ครั้ง(บริการ)",
    adj_rw: "Adj.RW ที่ชดเชย",
    compensation: "ชดเชยก่อนหักเงินเดือน"
  };
  const SUMMARY_ROW = /^(รวม|รวมทั้งสิ้น|ยอดรวม|total|grand ?total)$/i;

  function cleanText(value, maxLen) {
    if (value === null || value === undefined) return "";
    let s = String(value)
      .replace(/<\/?[a-zA-Z!][^>]*>/g, "")
      .replace(/[ --]/g, "")
      .replace(/[​-‍﻿]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^[=+@]+/, "")
      .trim();
    if (maxLen && s.length > maxLen) s = s.slice(0, maxLen);
    return s;
  }

  function toNumber(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
    if (value === null || value === undefined || value === false) return 0;
    if (value === true) return NaN;
    let s = String(value).replace(/[\s,฿]/g, "").replace(/บาท/g, "");
    if (s === "" || s === "-" || s === "–" || s === "—") return 0;
    let negative = false;
    if (/^\(.*\)$/.test(s)) {
      negative = true;
      s = s.slice(1, -1);
    }
    if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s)) return NaN;
    const n = Number(s);
    return negative ? -n : n;
  }

  function normalizeCode(value) {
    if (value === null || value === undefined) return "";
    if (typeof value === "number") return Number.isFinite(value) ? String(Math.round(value)) : "";
    return String(value).trim().replace(/\.0+$/, "");
  }

  function normalizeFiscalYear(value) {
    let s = normalizeCode(value);
    if (/^\d{2}$/.test(s)) s = String(2500 + Number(s));
    if (/^\d{4}$/.test(s) && Number(s) >= 1900 && Number(s) < 2400) s = String(Number(s) + 543);
    return s;
  }

  const isValidFiscalYear = (fy) => /^\d{4}$/.test(fy) && Number(fy) >= 2540 && Number(fy) <= 2700;
  const round = (n, d) => Math.round((n + Math.sign(n) * Number.EPSILON) * 10 ** d) / 10 ** d;

  /** ตรวจสอบข้อมูล 1 แถว — คืนค่า { record, errors[], warnings[] } (ตรรกะเดียวกับ Data.gs) */
  function validateRecord(input = {}) {
    const errors = [];
    const warnings = [];
    const stm = cleanText(input.stm_period, 50);
    if (!stm) errors.push("ไม่ระบุงวด STM");

    const stmMonth = /^(\d{4})_/.exec(stm);
    let monthCode = normalizeCode(input.month_code);
    if (!monthCode && stmMonth && isValidMonthCode(stmMonth[1])) {
      monthCode = stmMonth[1];
      warnings.push(`เดือนว่าง ใช้ค่า ${monthCode} จากงวด STM`);
    }
    const monthOk = isValidMonthCode(monthCode);
    if (!monthCode) errors.push("ไม่ระบุเดือน");
    else if (!monthOk) errors.push(`เดือนต้องเป็นรูปแบบ YYMM เช่น 6907 (พบ "${monthCode.slice(0, 20)}")`);

    const fyRaw = normalizeCode(input.fiscal_year);
    let fy = normalizeFiscalYear(fyRaw);
    if (!fy && monthOk) {
      fy = fiscalYearOf(monthCode);
      warnings.push(`ปีงบประมาณว่าง คำนวณจากเดือนได้ ${fy}`);
    } else if (fy && fy !== fyRaw) {
      warnings.push(`แปลงปีงบประมาณ ${fyRaw} เป็น ${fy}`);
    }
    if (!fy) errors.push("ไม่ระบุปีงบประมาณ");
    else if (!isValidFiscalYear(fy)) errors.push(`ปีงบประมาณไม่ถูกต้อง (พบ "${fy.slice(0, 20)}")`);
    else if (monthOk && fiscalYearOf(monthCode) !== fy) {
      warnings.push(`ปีงบประมาณ ${fy} ไม่สอดคล้องกับเดือน ${monthCode} (ควรเป็น ${fiscalYearOf(monthCode)})`);
    }
    if (stmMonth && monthOk && stmMonth[1] !== monthCode) {
      warnings.push(`รหัสเดือนในงวด STM (${stmMonth[1]}) ไม่ตรงกับเดือน ${monthCode}`);
    }

    const serviceType = cleanText(input.service_type, 100) || UNSPECIFIED;
    if (SUMMARY_ROW.test(serviceType) || SUMMARY_ROW.test(stm)) errors.push("เป็นแถวสรุปยอดรวม ไม่ใช่ข้อมูลรายงวด");

    const record = { stm_period: stm, month_code: monthCode, fiscal_year: fy, service_type: serviceType };
    NUMERIC_FIELDS.forEach((f) => {
      const n = toNumber(input[f]);
      if (Number.isNaN(n)) {
        errors.push(`${FIELD_LABELS[f]} ไม่ใช่ตัวเลข (พบ "${String(input[f]).slice(0, 30)}")`);
        record[f] = 0;
        return;
      }
      if (Math.abs(n) > 1e12) errors.push(`${FIELD_LABELS[f]} มีค่าสูงผิดปกติ`);
      if (n < 0) warnings.push(`${FIELD_LABELS[f]} มีค่าติดลบ`);
      if (f === "service_count" && Math.floor(n) !== n) warnings.push("จำนวนครั้งบริการไม่เป็นจำนวนเต็ม");
      record[f] = round(n, f === "adj_rw" ? 4 : 2);
    });
    return { record, errors, warnings };
  }

  const DUPLICATE_KEY_LABEL = "งวด STM, เดือน, ปีงบประมาณ, ประเภทบริการ, ครั้ง(บริการ), Adj.RW ที่ชดเชย, ชดเชยก่อนหักเงินเดือน";

  /** คีย์ตรวจข้อมูลซ้ำ 7 ฟิลด์ (ไม่เทียบ BR) — ต้องให้ผลตรงกับ duplicateKey_ ใน gas/Data.gs */
  const duplicateKey = (rec) => {
    const text = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
    const num = (v, d) => {
      const n = toNumber(v);
      return Number.isNaN(n) ? "NaN" : round(n, d).toFixed(d);
    };
    return [
      text(rec.stm_period),
      normalizeCode(rec.month_code),
      normalizeCode(rec.fiscal_year),
      text(rec.service_type || UNSPECIFIED),
      num(rec.service_count, 2),
      num(rec.adj_rw, 4),
      num(rec.compensation, 2)
    ].join("||");
  };

  return {
    $, $$, escapeHtml, html, raw, setHtml, SafeHtml, uid, debounce, cssVar,
    fmt, isNum, MONTHS_SHORT, MONTHS_FULL, FISCAL_MONTHS, isValidMonthCode, monthName, monthLabel, monthLabelFull,
    fiscalYearOf, formatDateTime, ROLE_LEVEL, ROLE_LABELS, STATUS_LABELS, roleBadge, statusBadge,
    stateHtml, setBusy, toast, openModal, confirm: confirmDialog, MultiSelect, DataTable, formatByType,
    downloadCSV, downloadXLSX, stamp,
    UNSPECIFIED, NUMERIC_FIELDS, FIELD_LABELS, toNumber, cleanText, validateRecord, duplicateKey, DUPLICATE_KEY_LABEL
  };
})();
