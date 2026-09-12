/**
 * data-manager.js — เพิ่ม / แก้ไข / ลบ (Soft Delete) / กู้คืน ข้อมูลรายงวด STM
 * EDITOR: เพิ่ม แก้ไข · ADMIN: ลบ กู้คืน ดูข้อมูลที่ถูกลบ · SUPER_ADMIN: ลบถาวร (เมื่อเปิดใน Settings)
 * การซ่อนปุ่มตามสิทธิ์เป็นเพียง UX — Backend ตรวจสอบสิทธิ์ทุกคำขอ
 */
const DataManager = (() => {
  "use strict";
  const { $, $$, html, raw, setHtml, fmt } = U;

  const state = { records: [], loaded: false, loading: false, needsReload: false, includeInactive: false, table: null };
  const setText = (sel, text) => { const el = $(sel); if (el) el.textContent = text; };

  function init() {
    state.table = new U.DataTable($("#dm-table"), {
      rowKey: "record_id",
      exportName: "ip-uc-data",
      sheetName: "ข้อมูล IP.UC",
      caption: "รายการข้อมูล IP.UC",
      sortKey: "month_code",
      sortDir: "desc",
      pageSize: 25,
      rowClass: (r) => (r.is_active ? "" : "is-inactive"),
      columns: [
        {
          key: "is_active", label: "สถานะ", hidden: true,
          value: (r) => (r.is_active ? "ใช้งาน" : "ถูกลบ"),
          render: (r) => (r.is_active
            ? html`<span class="badge badge-success"><i class="bi bi-check-circle-fill" aria-hidden="true"></i>ใช้งาน</span>`
            : html`<span class="badge badge-neutral"><i class="bi bi-trash3" aria-hidden="true"></i>ถูกลบ</span>`)
        },
        { key: "stm_period", label: "งวด STM" },
        {
          key: "month_code", label: "เดือน",
          render: (r) => html`${U.monthLabelFull(r.month_code)} <small class="text-muted">(${r.month_code})</small>`,
          searchValue: (r) => `${r.month_code} ${U.monthLabelFull(r.month_code)}`
        },
        { key: "fiscal_year", label: "ปีงบประมาณ" },
        { key: "service_type", label: "ประเภทบริการ" },
        { key: "service_count", label: "ครั้ง(บริการ)", type: "count" },
        { key: "adj_rw", label: "Adj.RW ที่ชดเชย", type: "num4" },
        { key: "br_after_deduction", label: "BR หลังหักเงินกัน สป.สธ.", type: "money" },
        { key: "br_k", label: "BR คูณ K สป.สธ.", type: "money" },
        { key: "compensation", label: "ชดเชยก่อนหักเงินเดือน", type: "money" },
        { key: "updated_at", label: "แก้ไขล่าสุด", type: "datetime" },
        { key: "import_batch_id", label: "รหัสชุดนำเข้า", hidden: true },
        { key: "record_id", label: "record_id", hidden: true },
        { key: "actions", label: "จัดการ", align: "num", sortable: false, exportable: false, toggleable: false, searchable: false, render: actionButtons }
      ],
      onAction: (action, row) => {
        if (!row) return;
        if (action === "edit") openForm(row);
        else if (action === "delete") removeRecord(row);
        else if (action === "restore") restoreRecord(row);
      }
    });

    $("#dm-refresh").addEventListener("click", () => load());
    $("#dm-add").addEventListener("click", () => openForm(null));
    $("#dm-year").addEventListener("change", () => {
      fillStmOptions();
      applyFilters();
    });
    $("#dm-stm").addEventListener("change", applyFilters);
    $("#dm-type").addEventListener("change", applyFilters);
    $("#dm-inactive").addEventListener("change", (e) => {
      state.includeInactive = e.target.checked;
      state.table.setColumnHidden("is_active", !state.includeInactive);
      load();
    });
  }

  function show() {
    $("#dm-add").hidden = !Auth.hasRole("EDITOR");
    $("#dm-inactive-wrap").hidden = !Auth.hasRole("ADMIN");
    if (!Auth.hasRole("ADMIN") && state.includeInactive) {
      state.includeInactive = false;
      $("#dm-inactive").checked = false;
      state.table.setColumnHidden("is_active", true);
      state.needsReload = true;
    }
    if (!state.loaded || state.needsReload) load();
    else state.table.refresh();
  }

  function invalidate() { state.needsReload = true; }

  async function load() {
    if (state.loading) return;
    state.loading = true;
    state.table.setLoading();
    setText("#dm-sub", "กำลังโหลดข้อมูล...");
    try {
      const res = await API.call("getData", { include_inactive: state.includeInactive });
      state.records = res.data.records || [];
      state.loaded = true;
      state.needsReload = false;
      fillFilterOptions();
      applyFilters();
    } catch (err) {
      state.table.setError(API.describeError(err));
      setText("#dm-sub", "ไม่สามารถโหลดข้อมูลได้");
    } finally {
      state.loading = false;
    }
  }

  function fillSelect(el, placeholder, values, labelFn = (v) => v) {
    const current = el.value;
    setHtml(el, [html`<option value="">${placeholder}</option>`, ...values.map((v) => html`<option value="${v}">${labelFn(v)}</option>`)]);
    el.value = values.includes(current) ? current : "";
  }

  function fillFilterOptions() {
    const years = [...new Set(state.records.map((r) => r.fiscal_year))].filter(Boolean).sort((a, b) => b.localeCompare(a));
    fillSelect($("#dm-year"), "ทุกปีงบประมาณ", years, (y) => `ปีงบประมาณ ${y}`);
    const types = [...new Set(state.records.map((r) => r.service_type))].sort((a, b) => a.localeCompare(b, "th"));
    fillSelect($("#dm-type"), "ทุกประเภทบริการ", types);
    fillStmOptions();
  }

  function fillStmOptions() {
    const year = $("#dm-year").value;
    const stms = [...new Set(state.records.filter((r) => !year || r.fiscal_year === year).map((r) => r.stm_period))].sort().reverse();
    fillSelect($("#dm-stm"), "ทุกงวด STM", stms);
  }

  function applyFilters() {
    const year = $("#dm-year").value;
    const stm = $("#dm-stm").value;
    const type = $("#dm-type").value;
    const list = state.records.filter((r) => (!year || r.fiscal_year === year) && (!stm || r.stm_period === stm) && (!type || r.service_type === type));
    state.table.setRows(list, { resetPage: true });
    const active = state.records.filter((r) => r.is_active).length;
    setText("#dm-sub", `ทั้งหมด ${fmt.int(state.records.length)} รายการ${state.includeInactive ? ` (ใช้งาน ${fmt.int(active)} · ถูกลบ ${fmt.int(state.records.length - active)})` : ""} · ตรงตามตัวกรอง ${fmt.int(list.length)} รายการ`);
  }

  function actionButtons(r) {
    const label = `${r.stm_period} ${r.service_type}`;
    const buttons = [];
    if (r.is_active && Auth.hasRole("EDITOR")) {
      buttons.push(html`<button type="button" class="btn btn-outline btn-xs btn-icon" data-action="edit" title="แก้ไข" aria-label="แก้ไขข้อมูล ${label}"><i class="bi bi-pencil-square" aria-hidden="true"></i></button>`);
    }
    if (r.is_active && Auth.hasRole("ADMIN")) {
      buttons.push(html`<button type="button" class="btn btn-outline danger btn-xs btn-icon" data-action="delete" title="ลบ" aria-label="ลบข้อมูล ${label}"><i class="bi bi-trash3" aria-hidden="true"></i></button>`);
    }
    if (!r.is_active && Auth.hasRole("ADMIN")) {
      buttons.push(html`<button type="button" class="btn btn-outline btn-xs" data-action="restore" aria-label="กู้คืนข้อมูล ${label}"><i class="bi bi-arrow-counterclockwise" aria-hidden="true"></i> กู้คืน</button>`);
    }
    return buttons.length ? html`<div class="actions">${buttons}</div>` : html`<span class="text-muted">-</span>`;
  }

  /* ------------------------------ Form ------------------------------ */
  function openForm(record) {
    const isEdit = !!record;
    const id = U.uid("dmf");
    const types = [...new Set(state.records.map((r) => r.service_type))].sort((a, b) => a.localeCompare(b, "th"));
    const value = (f) => (record && record[f] !== undefined && record[f] !== null ? record[f] : "");

    const field = (name, label, { required = false, hint = "", attrs = "", list = "" } = {}) => html`<div class="form-group">
      <label class="form-label" for="${id}-${name}">${label}${required ? raw(' <span class="req" aria-hidden="true">*</span>') : ""}</label>
      <input id="${id}-${name}" name="${name}" class="form-control" value="${value(name)}" ${raw(attrs)} ${list ? raw(`list="${id}-types"`) : ""}
        aria-describedby="${hint ? `${id}-${name}-hint ` : ""}${id}-${name}-err" ${required ? raw("required") : ""}>
      ${hint ? html`<p class="form-hint" id="${id}-${name}-hint">${hint}</p>` : ""}
      <p class="form-error" id="${id}-${name}-err" data-error-for="${name}"></p>
    </div>`;

    const body = html`<form class="form-grid" novalidate data-dm-form>
      ${field("stm_period", "งวด STM", { required: true, hint: "เช่น 6907_IP_02", attrs: 'maxlength="50" autocomplete="off"' })}
      ${field("service_type", "ประเภทบริการ", { hint: "เว้นว่าง = ไม่ระบุประเภทบริการ", attrs: 'maxlength="100" autocomplete="off"', list: true })}
      ${field("month_code", "เดือน (YYMM)", { required: true, hint: "พ.ศ. 2 หลัก + เดือน เช่น 6907 = ก.ค. 2569", attrs: 'maxlength="4" inputmode="numeric" autocomplete="off"' })}
      ${field("fiscal_year", "ปีงบประมาณ", { required: true, hint: "ระบบเติมให้อัตโนมัติจากเดือน", attrs: 'maxlength="4" inputmode="numeric" autocomplete="off"' })}
      ${field("service_count", "ครั้ง(บริการ)", { attrs: 'inputmode="decimal" autocomplete="off"' })}
      ${field("adj_rw", "Adj.RW ที่ชดเชย", { attrs: 'inputmode="decimal" autocomplete="off"' })}
      ${field("br_after_deduction", "BR หลังหักเงินกัน สป.สธ. (บาท)", { attrs: 'inputmode="decimal" autocomplete="off"' })}
      ${field("br_k", "BR คูณ K สป.สธ. (บาท)", { attrs: 'inputmode="decimal" autocomplete="off"' })}
      ${field("compensation", "ชดเชยก่อนหักเงินเดือน (บาท)", { attrs: 'inputmode="decimal" autocomplete="off"' })}
      <datalist id="${id}-types">${types.map((t) => html`<option value="${t}"></option>`)}</datalist>
      <div class="span-full" data-form-alert aria-live="polite"></div>
    </form>`;

    const footer = html`<button type="button" class="btn btn-outline" data-modal-close>ยกเลิก</button>
      <button type="button" class="btn btn-secondary" data-dm-save><i class="bi bi-save" aria-hidden="true"></i> ${isEdit ? "บันทึกการแก้ไข" : "เพิ่มข้อมูล"}</button>`;

    const modal = U.openModal({ title: isEdit ? `แก้ไขข้อมูล · ${record.stm_period}` : "เพิ่มข้อมูลใหม่", body, footer, size: "md" });
    const form = $("[data-dm-form]", modal.body);
    const saveBtn = $("[data-dm-save]", modal.footer);
    const alertBox = $("[data-form-alert]", form);
    const monthInput = form.elements.month_code;
    const fyInput = form.elements.fiscal_year;
    let warned = false;

    monthInput.addEventListener("input", () => {
      const code = monthInput.value.trim();
      if (U.isValidMonthCode(code) && (!fyInput.value.trim() || fyInput.dataset.auto === "1")) {
        fyInput.value = U.fiscalYearOf(code);
        fyInput.dataset.auto = "1";
      }
    });
    fyInput.addEventListener("input", () => { fyInput.dataset.auto = "0"; });
    form.addEventListener("input", () => {
      if (warned) {
        warned = false;
        setHtml(saveBtn, html`<i class="bi bi-save" aria-hidden="true"></i> ${isEdit ? "บันทึกการแก้ไข" : "เพิ่มข้อมูล"}`);
      }
    });

    const clearErrors = () => {
      $$("[data-error-for]", form).forEach((el) => { el.textContent = ""; });
      $$(".form-control", form).forEach((el) => el.removeAttribute("aria-invalid"));
      setHtml(alertBox, "");
    };

    const showErrors = (messages) => {
      messages.forEach((msg) => {
        const fieldName = Object.keys(U.FIELD_LABELS).find((f) => msg.includes(U.FIELD_LABELS[f]));
        if (!fieldName) return;
        const errEl = $(`[data-error-for="${fieldName}"]`, form);
        if (errEl && !errEl.textContent) errEl.textContent = msg;
        form.elements[fieldName]?.setAttribute("aria-invalid", "true");
      });
      setHtml(alertBox, html`<div class="alert alert-danger"><i class="bi bi-x-octagon-fill" aria-hidden="true"></i>
        <div><strong>กรุณาแก้ไขข้อมูล</strong><ul>${messages.map((m) => html`<li>${m}</li>`)}</ul></div></div>`);
      form.querySelector('[aria-invalid="true"]')?.focus();
    };

    const save = async () => {
      clearErrors();
      const input = Object.fromEntries(new FormData(form).entries());
      const result = U.validateRecord(input);
      if (result.errors.length) {
        showErrors(result.errors);
        return;
      }
      if (result.warnings.length && !warned) {
        warned = true;
        setHtml(alertBox, html`<div class="alert alert-warning"><i class="bi bi-exclamation-triangle-fill" aria-hidden="true"></i>
          <div><strong>โปรดตรวจสอบคำเตือน</strong> — กดบันทึกอีกครั้งเพื่อยืนยัน<ul>${result.warnings.map((m) => html`<li>${m}</li>`)}</ul></div></div>`);
        setHtml(saveBtn, html`<i class="bi bi-check2-circle" aria-hidden="true"></i> ยืนยันบันทึก`);
        return;
      }
      U.setBusy(saveBtn, true, "กำลังบันทึก...");
      try {
        const payload = isEdit
          ? { record_id: record.record_id, expected_updated_at: record.updated_at, record: input }
          : { record: input };
        const res = await API.call(isEdit ? "updateData" : "addData", payload);
        U.toast(res.message, "success");
        modal.close();
        Dashboard.invalidate();
        load();
      } catch (err) {
        U.setBusy(saveBtn, false);
        warned = false;
        const extra = err.code === "CONFLICT" || err.code === "UNCERTAIN_RESULT"
          ? html` <button type="button" class="btn btn-outline btn-xs" data-reload>โหลดข้อมูลล่าสุด</button>` : "";
        setHtml(alertBox, html`<div class="alert alert-danger"><i class="bi bi-x-octagon-fill" aria-hidden="true"></i><div>${API.describeError(err)}${extra}</div></div>`);
        $("[data-reload]", alertBox)?.addEventListener("click", () => {
          modal.close();
          load();
        });
      }
    };

    saveBtn.addEventListener("click", save);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      save();
    });
    form.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target.tagName === "INPUT") {
        e.preventDefault();
        save();
      }
    });
  }

  /* ------------------------------ Delete / restore ------------------------------ */
  const recordDetails = (r) => html`<dl class="detail-list">
    <dt>งวด STM</dt><dd>${r.stm_period}</dd>
    <dt>เดือน</dt><dd>${U.monthLabelFull(r.month_code)}</dd>
    <dt>ประเภทบริการ</dt><dd>${r.service_type}</dd>
    <dt>จำนวนบริการ</dt><dd>${U.formatByType(r.service_count, "count")} ครั้ง</dd>
    <dt>ค่าชดเชย</dt><dd>${fmt.money(r.compensation)}</dd>
  </dl>`;

  async function removeRecord(row) {
    const isSuper = Auth.hasRole("SUPER_ADMIN");
    const ok = await U.confirm({
      title: "ยืนยันการลบข้อมูล",
      message: "ข้อมูลจะถูกลบแบบ Soft Delete (ซ่อนจาก Dashboard และ ADMIN กู้คืนได้) พร้อมบันทึกใน Audit Logs",
      details: html`${recordDetails(row)}${isSuper ? html`<label class="check mt-4"><input type="checkbox" name="hard"> ลบถาวรออกจากชีต (ต้องเปิด ALLOW_HARD_DELETE ใน Settings และกู้คืนไม่ได้)</label>` : ""}`,
      confirmText: "ลบข้อมูล",
      tone: "danger"
    });
    if (!ok) return;
    if (ok.hard) {
      const again = await U.confirm({
        title: "ยืนยันการลบถาวร",
        tone: "danger",
        message: "การลบถาวรจะลบแถวออกจาก Google Sheets และไม่สามารถกู้คืนได้",
        requireText: "ลบถาวร",
        confirmText: "ลบถาวร"
      });
      if (!again) return;
    }
    try {
      const res = await API.call("deleteData", { record_ids: [row.record_id], mode: ok.hard ? "hard" : "soft" });
      U.toast(res.message, "success");
    } catch (err) {
      U.toast(API.describeError(err), err.code === "UNCERTAIN_RESULT" ? "warning" : "danger", 10000);
    }
    Dashboard.invalidate();
    load();
  }

  async function restoreRecord(row) {
    const ok = await U.confirm({
      title: "กู้คืนข้อมูล",
      message: "ข้อมูลนี้จะกลับมาแสดงใน Dashboard (ระบบตรวจสอบข้อมูลซ้ำก่อนกู้คืน)",
      details: recordDetails(row),
      confirmText: "กู้คืน"
    });
    if (!ok) return;
    try {
      const res = await API.call("updateData", { record_id: row.record_id, restore: true });
      U.toast(res.message, "success");
    } catch (err) {
      U.toast(API.describeError(err), err.code === "UNCERTAIN_RESULT" ? "warning" : "danger", 10000);
    }
    Dashboard.invalidate();
    load();
  }

  return { init, show, invalidate };
})();
