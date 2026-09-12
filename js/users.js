/**
 * users.js — เมนูผู้ดูแลระบบ (ADMIN / SUPER_ADMIN)
 * - จัดการผู้ใช้: รออนุมัติ / อนุมัติแล้ว / ถูกระงับ / ถูกปฏิเสธ · อนุมัติ ปฏิเสธ ระงับ เปลี่ยนสิทธิ์
 * - Import Logs · Audit Logs · Settings
 * ปุ่มที่แสดงอ้างอิงค่า can.* ที่ Backend คำนวณให้ และ Backend ตรวจสิทธิ์ซ้ำทุกคำขอ
 */
const AdminPanel = (() => {
  "use strict";
  const { $, $$, html, raw, setHtml, fmt } = U;

  const STATUS_TABS = [
    { key: "pending", label: "ผู้รออนุมัติ", icon: "bi-hourglass-split" },
    { key: "approved", label: "ผู้อนุมัติแล้ว", icon: "bi-check-circle" },
    { key: "suspended", label: "ผู้ถูกระงับ", icon: "bi-slash-circle" },
    { key: "rejected", label: "ผู้ถูกปฏิเสธ", icon: "bi-x-circle" },
    { key: "all", label: "ทั้งหมด", icon: "bi-people" }
  ];

  const THEME_NAMES = {
    "ipuc-vibrant": "IP.UC Vibrant (สีองค์กร · ค่าเริ่มต้น)",
    "executive-blue": "Executive Blue", "electric-blue": "Electric Blue", "ocean-bright": "Ocean Bright",
    "healthcare-teal": "Healthcare Teal", "government-navy": "Government Navy", "finance-emerald": "Finance Emerald",
    "strategy-indigo": "Strategy Indigo", "cyber-violet": "Cyber Violet", "tropical-green": "Tropical Green",
    "vibrant-coral": "Vibrant Coral", "sunset-orange": "Sunset Orange", "royal-magenta": "Royal Magenta",
    "high-contrast-amber": "High Contrast Amber", "modern-slate": "Modern Slate", "warm-official": "Warm Official",
    "public-purple": "Public Service Purple", "lime-tech": "Lime Tech", "crimson-gold": "Crimson Gold"
  };

  const state = {
    built: {},
    stale: { users: true, "import-logs": true, "audit-logs": true },
    users: [], counts: {}, assignable: [], statusFilter: null,
    tables: {}
  };

  const panel = (name) => $(`[data-admin-panel="${name}"]`);

  function init() { /* สร้างแต่ละแท็บเมื่อเปิดใช้งานครั้งแรก */ }

  function invalidate() {
    Object.keys(state.stale).forEach((k) => { state.stale[k] = true; });
  }

  function show(tab = "users") {
    $$("[data-admin-tab]").forEach((a) => {
      if (a.dataset.adminTab === tab) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    $$("[data-admin-panel]").forEach((p) => { p.hidden = p.dataset.adminPanel !== tab; });
    if (tab === "users") showUsers();
    else if (tab === "import-logs") showImportLogs();
    else if (tab === "audit-logs") showAuditLogs();
    else if (tab === "settings") showSettings();
  }

  const refreshButton = (attr) => html`<button type="button" class="btn btn-outline btn-sm" ${raw(attr)}><i class="bi bi-arrow-clockwise" aria-hidden="true"></i> โหลดใหม่</button>`;

  /* ============================== Users ============================== */
  function buildUsers() {
    const p = panel("users");
    setHtml(p, html`
      <div class="card-head">
        <div>
          <h2 class="card-title"><i class="bi bi-people-fill" aria-hidden="true"></i> จัดการผู้ใช้</h2>
          <p class="card-sub">อนุมัติ ปฏิเสธ ระงับ และเปลี่ยนสิทธิ์ผู้ใช้ — ทุกการทำรายการบันทึกใน Audit Logs</p>
        </div>
        <div class="head-actions">${refreshButton("data-users-refresh")}</div>
      </div>
      <div class="segmented segmented-scroll" role="tablist" aria-label="กรองผู้ใช้ตามสถานะ" data-user-status>
        ${STATUS_TABS.map((s) => html`<button type="button" role="tab" data-status="${s.key}" aria-selected="false">
          <i class="bi ${s.icon}" aria-hidden="true"></i> ${s.label} <span class="badge badge-neutral" data-count="${s.key}">0</span></button>`)}
      </div>
      <div class="mt-4" data-users-rule></div>
      <div class="mt-4" data-users-table></div>`);

    state.tables.users = new U.DataTable($("[data-users-table]", p), {
      rowKey: "user_id",
      exportName: "ip-uc-users",
      sheetName: "ผู้ใช้งาน",
      caption: "รายชื่อผู้ใช้งาน",
      sortKey: "created_at",
      sortDir: "desc",
      emptyText: "ไม่มีผู้ใช้ในสถานะนี้",
      columns: [
        { key: "full_name", label: "ชื่อ-นามสกุล", render: (u) => html`<strong>${u.full_name || "-"}</strong>${u.is_self ? html` <span class="badge badge-info">คุณ</span>` : ""}` },
        { key: "email", label: "อีเมล" },
        { key: "role", label: "สิทธิ์", render: (u) => U.roleBadge(u.role) },
        { key: "status", label: "สถานะ", value: (u) => U.STATUS_LABELS[u.status] || u.status, render: (u) => U.statusBadge(u.status) },
        { key: "created_at", label: "สมัครเมื่อ", type: "datetime" },
        { key: "approved_by", label: "อนุมัติโดย", hidden: true },
        { key: "approved_at", label: "อนุมัติเมื่อ", type: "datetime", hidden: true },
        { key: "last_login", label: "เข้าใช้ล่าสุด", type: "datetime" },
        { key: "actions", label: "จัดการ", align: "num", sortable: false, exportable: false, toggleable: false, searchable: false, render: userActions }
      ],
      onAction: onUserAction
    });

    $("[data-users-refresh]", p).addEventListener("click", loadUsers);
    $("[data-user-status]", p).addEventListener("click", (e) => {
      const btn = e.target.closest("[data-status]");
      if (!btn) return;
      state.statusFilter = btn.dataset.status;
      renderUsers();
    });
    state.built.users = true;
  }

  function showUsers() {
    if (!state.built.users) buildUsers();
    const rule = $("[data-users-rule]", panel("users"));
    setHtml(rule, html`<div class="alert alert-info"><i class="bi bi-shield-lock-fill" aria-hidden="true"></i><div>${Auth.hasRole("SUPER_ADMIN")
      ? "SUPER_ADMIN จัดการได้ทุกบัญชี (ยกเว้นบัญชีของตนเอง) และระบบต้องมี SUPER_ADMIN ที่ใช้งานได้อย่างน้อย 1 บัญชี"
      : "ADMIN จัดการได้เฉพาะบัญชี VIEWER และ EDITOR — การจัดการบัญชี ADMIN หรือกำหนดสิทธิ์ ADMIN ต้องใช้ SUPER_ADMIN"}</div></div>`);
    if (state.stale.users) loadUsers();
  }

  async function loadUsers() {
    state.tables.users.setLoading();
    try {
      const res = await API.call("getUsers", {});
      state.users = res.data.users || [];
      state.counts = res.data.counts || {};
      state.assignable = res.data.assignable_roles || [];
      state.stale.users = false;
      if (!state.statusFilter) state.statusFilter = state.counts.pending ? "pending" : "approved";
      renderUsers();
    } catch (err) {
      state.tables.users.setError(API.describeError(err));
    }
  }

  function renderUsers() {
    const p = panel("users");
    $$("[data-count]", p).forEach((el) => {
      const key = el.dataset.count;
      el.textContent = fmt.int(key === "all" ? state.counts.total || 0 : state.counts[key] || 0);
    });
    $$("[data-status]", p).forEach((b) => b.setAttribute("aria-selected", String(b.dataset.status === state.statusFilter)));
    const list = state.statusFilter === "all" ? state.users : state.users.filter((u) => u.status === state.statusFilter);
    state.tables.users.setRows(list, { resetPage: true });
    const badge = $("#adm-pending-badge");
    badge.hidden = !state.counts.pending;
    badge.textContent = fmt.int(state.counts.pending || 0);
  }

  function userActions(u) {
    const btn = (action, label, icon, cls) => html`<button type="button" class="btn btn-xs ${cls}" data-action="${action}"><i class="bi ${icon}" aria-hidden="true"></i> ${label}</button>`;
    const can = u.can || {};
    const buttons = [];
    if (can.approve) buttons.push(btn("approve", u.status === "pending" ? "อนุมัติ" : "เปิดใช้งาน", "bi-check-lg", "btn-success"));
    if (can.reject) buttons.push(btn("reject", "ปฏิเสธ", "bi-x-lg", "btn-outline danger"));
    if (can.suspend) buttons.push(btn("suspend", "ระงับ", "bi-slash-circle", "btn-outline danger"));
    if (can.change_role) buttons.push(btn("role", "เปลี่ยนสิทธิ์", "bi-person-gear", "btn-outline"));
    return buttons.length
      ? html`<div class="actions">${buttons}</div>`
      : html`<span class="text-muted">${u.is_self ? "บัญชีของคุณ" : "ต้องใช้สิทธิ์ SUPER_ADMIN"}</span>`;
  }

  async function onUserAction(action, u) {
    if (!u) return;
    const who = html`<dl class="detail-list">
      <dt>ชื่อ-นามสกุล</dt><dd>${u.full_name || "-"}</dd>
      <dt>อีเมล</dt><dd>${u.email}</dd>
      <dt>สิทธิ์ปัจจุบัน</dt><dd>${U.roleBadge(u.role)}</dd>
      <dt>สถานะ</dt><dd>${U.statusBadge(u.status)}</dd>
    </dl>`;
    const roleSelect = (current) => {
      const id = U.uid("role");
      return html`<div class="form-group"><label class="form-label" for="${id}">สิทธิ์ผู้ใช้</label>
        <select id="${id}" name="role" class="form-control">${state.assignable.map((r) => html`<option value="${r}" ${r === current ? raw("selected") : ""}>${r} — ${U.ROLE_LABELS[r]}</option>`)}</select></div>`;
    };
    const reasonInput = () => {
      const id = U.uid("reason");
      return html`<div class="form-group"><label class="form-label" for="${id}">เหตุผล (ไม่บังคับ)</label>
        <input id="${id}" name="reason" class="form-control" maxlength="300" autocomplete="off"></div>`;
    };

    let apiAction;
    let result;
    if (action === "approve") {
      apiAction = "approveUser";
      result = await U.confirm({
        title: u.status === "pending" ? "อนุมัติผู้ใช้" : "เปิดใช้งานผู้ใช้อีกครั้ง",
        message: "ตรวจสอบตัวตนผู้สมัครและกำหนดสิทธิ์ให้เหมาะสมกับหน้าที่",
        details: html`${who}<div class="form-stack mt-4">${roleSelect(state.assignable.includes(u.role) ? u.role : "VIEWER")}${reasonInput()}</div>`,
        confirmText: "อนุมัติ"
      });
    } else if (action === "reject") {
      apiAction = "rejectUser";
      result = await U.confirm({
        title: "ปฏิเสธผู้สมัคร", tone: "danger", confirmText: "ปฏิเสธ",
        message: "ผู้ใช้จะไม่สามารถเข้าสู่ระบบได้ (เปิดใช้งานภายหลังได้)",
        details: html`${who}<div class="form-stack mt-4">${reasonInput()}</div>`
      });
    } else if (action === "suspend") {
      apiAction = "suspendUser";
      result = await U.confirm({
        title: "ระงับผู้ใช้", tone: "danger", confirmText: "ระงับการใช้งาน",
        message: "ผู้ใช้จะถูกออกจากระบบในคำขอถัดไป และไม่สามารถเข้าสู่ระบบได้จนกว่าจะเปิดใช้งาน",
        details: html`${who}<div class="form-stack mt-4">${reasonInput()}</div>`
      });
    } else if (action === "role") {
      apiAction = "changeUserRole";
      result = await U.confirm({
        title: "เปลี่ยนสิทธิ์ผู้ใช้", confirmText: "บันทึกสิทธิ์",
        message: "สิทธิ์ใหม่มีผลกับคำขอถัดไปของผู้ใช้ทันที",
        details: html`${who}<div class="form-stack mt-4">${roleSelect(u.role)}${reasonInput()}</div>`
      });
    }
    if (!result) return;

    const payload = { user_id: u.user_id, reason: result.reason || "" };
    if (result.role) payload.role = result.role;
    try {
      const res = await API.call(apiAction, payload);
      U.toast(res.message, "success");
    } catch (err) {
      U.toast(API.describeError(err), err.code === "UNCERTAIN_RESULT" ? "warning" : "danger", 10000);
    }
    loadUsers();
  }

  /* ============================== Import logs ============================== */
  function buildImportLogs() {
    const p = panel("import-logs");
    setHtml(p, html`
      <div class="card-head">
        <div>
          <h2 class="card-title"><i class="bi bi-journal-arrow-up" aria-hidden="true"></i> Import Logs</h2>
          <p class="card-sub" data-il-sub>ประวัติการนำเข้าไฟล์ เรียงจากล่าสุด</p>
        </div>
        <div class="head-actions">${refreshButton("data-il-refresh")}</div>
      </div>
      <form class="inline-filters" data-il-filters>
        <div class="form-group"><label class="form-label" for="il-from">ตั้งแต่วันที่</label><input type="date" id="il-from" name="date_from" class="form-control"></div>
        <div class="form-group"><label class="form-label" for="il-to">ถึงวันที่</label><input type="date" id="il-to" name="date_to" class="form-control"></div>
        <div class="form-group"><label class="form-label" for="il-email">อีเมลผู้นำเข้า</label><input type="search" id="il-email" name="email" class="form-control" autocomplete="off"></div>
        <div class="form-group"><label class="form-label" for="il-mode">โหมดนำเข้า</label>
          <select id="il-mode" name="mode" class="form-control">
            <option value="">ทุกโหมด</option><option value="append">Append</option><option value="upsert">Upsert</option><option value="replace">Replace Batch</option>
          </select></div>
      </form>
      <div data-il-table></div>`);

    const count = (key, label, tone) => ({
      key, label, type: "int",
      render: (r) => (tone && r[key] > 0 ? html`<span class="badge badge-${tone}">${fmt.int(r[key])}</span>` : fmt.int(r[key]))
    });
    state.tables.importLogs = new U.DataTable($("[data-il-table]", p), {
      rowKey: "import_id", exportName: "ip-uc-import-logs", sheetName: "ImportLogs", caption: "ประวัติการนำเข้า",
      sortKey: "timestamp", sortDir: "desc", emptyText: "ยังไม่มีประวัติการนำเข้า",
      columns: [
        { key: "timestamp", label: "เวลา", type: "datetime" },
        { key: "email", label: "ผู้นำเข้า" },
        { key: "file_name", label: "ไฟล์", className: "wrap" },
        { key: "import_mode", label: "โหมด", render: (r) => html`<span class="badge badge-brand">${r.import_mode}</span>` },
        count("rows_received", "รับ"),
        count("rows_inserted", "เพิ่มใหม่", "success"),
        count("rows_updated", "อัปเดต/แทนที่", "info"),
        count("rows_rejected", "ไม่ผ่าน", "danger"),
        { key: "import_id", label: "รหัสนำเข้า", hidden: true },
        { key: "error_summary", label: "สรุปข้อผิดพลาด", hidden: true, className: "wrap" },
        {
          key: "actions", label: "", sortable: false, exportable: false, toggleable: false, searchable: false, align: "num",
          render: () => html`<button type="button" class="btn btn-outline btn-xs" data-action="view"><i class="bi bi-eye" aria-hidden="true"></i> รายละเอียด</button>`
        }
      ],
      onAction: (action, r) => { if (r) viewImportLog(r); }
    });

    const form = $("[data-il-filters]", p);
    form.addEventListener("input", U.debounce(loadImportLogs, 400));
    form.addEventListener("submit", (e) => e.preventDefault());
    $("[data-il-refresh]", p).addEventListener("click", loadImportLogs);
    state.built["import-logs"] = true;
  }

  function showImportLogs() {
    if (!state.built["import-logs"]) buildImportLogs();
    if (state.stale["import-logs"]) loadImportLogs();
  }

  async function loadImportLogs() {
    const p = panel("import-logs");
    const filters = Object.fromEntries(new FormData($("[data-il-filters]", p)).entries());
    state.tables.importLogs.setLoading();
    try {
      const res = await API.call("getImportLogs", Object.assign({ limit: 1000 }, filters));
      state.tables.importLogs.setRows(res.data.items || [], { resetPage: true });
      state.stale["import-logs"] = false;
      $("[data-il-sub]", p).textContent = `พบ ${fmt.int(res.data.total)} รายการ${res.data.total > res.data.limit ? ` (แสดงล่าสุด ${fmt.int(res.data.limit)} รายการ)` : ""}`;
    } catch (err) {
      state.tables.importLogs.setError(API.describeError(err));
    }
  }

  function viewImportLog(r) {
    U.openModal({
      title: "รายละเอียดการนำเข้า",
      size: "lg",
      body: html`<dl class="detail-list">
          <dt>รหัสนำเข้า</dt><dd><code>${r.import_id}</code></dd>
          <dt>เวลา</dt><dd>${U.formatDateTime(r.timestamp)}</dd>
          <dt>ผู้นำเข้า</dt><dd>${r.email}</dd>
          <dt>ไฟล์</dt><dd>${r.file_name}</dd>
          <dt>โหมด</dt><dd>${r.import_mode}</dd>
          <dt>รับ / เพิ่ม / อัปเดต / ไม่ผ่าน</dt><dd>${fmt.int(r.rows_received)} / ${fmt.int(r.rows_inserted)} / ${fmt.int(r.rows_updated)} / ${fmt.int(r.rows_rejected)}</dd>
        </dl>
        <h3 class="card-title mt-6">สรุปข้อผิดพลาด</h3>
        ${r.error_summary ? html`<pre class="json-view mt-2">${r.error_summary}</pre>` : html`<p class="text-muted mt-2">ไม่มีข้อผิดพลาด</p>`}`,
      footer: html`<button type="button" class="btn btn-outline" data-modal-close>ปิด</button>`
    });
  }

  /* ============================== Audit logs ============================== */
  const ACTION_TONES = {
    LOGIN_SUCCESS: "success", LOGOUT: "neutral", LOGIN_FAILED: "danger", REGISTER: "info",
    APPROVE_USER: "success", REJECT_USER: "danger", SUSPEND_USER: "warning", CHANGE_ROLE: "violet",
    IMPORT: "brand", ADD: "success", UPDATE: "info", DELETE: "danger", RESTORE: "warning", SETTINGS_CHANGE: "violet"
  };

  function parseJson(text) {
    if (!text) return null;
    try { return JSON.parse(text); } catch (e) { return text; }
  }

  function auditSummary(r) {
    const nv = parseJson(r.new_value);
    if (nv && typeof nv === "object") {
      if (r.action === "IMPORT") return `${nv.file_name || ""} · ${nv.mode || ""} · เพิ่ม ${nv.rows_inserted ?? 0} อัปเดต ${nv.rows_updated ?? 0} ไม่ผ่าน ${nv.rows_rejected ?? 0}`;
      if (nv.stm_period) return `${nv.stm_period} · ${nv.service_type || ""}`;
      if (nv.email) return `${nv.email} · ${nv.role || ""} · ${nv.status || ""}`;
      if (nv.key) return `${nv.key} = ${nv.value}`;
      if (nv.reason) return String(nv.reason);
      if (nv.mode) return `ลบแบบ ${nv.mode}`;
      if (nv.role) return String(nv.role);
    }
    return typeof nv === "string" ? nv.slice(0, 80) : "";
  }

  function buildAuditLogs() {
    const p = panel("audit-logs");
    setHtml(p, html`
      <div class="card-head">
        <div>
          <h2 class="card-title"><i class="bi bi-journal-text" aria-hidden="true"></i> Audit Logs</h2>
          <p class="card-sub" data-al-sub>บันทึกเหตุการณ์สำคัญ เรียงจากล่าสุด</p>
        </div>
        <div class="head-actions">${refreshButton("data-al-refresh")}</div>
      </div>
      <form class="inline-filters" data-al-filters>
        <div class="form-group"><label class="form-label" for="al-from">ตั้งแต่วันที่</label><input type="date" id="al-from" name="date_from" class="form-control"></div>
        <div class="form-group"><label class="form-label" for="al-to">ถึงวันที่</label><input type="date" id="al-to" name="date_to" class="form-control"></div>
        <div class="form-group"><label class="form-label" for="al-email">อีเมล</label><input type="search" id="al-email" name="email" class="form-control" autocomplete="off"></div>
        <div class="form-group"><label class="form-label" for="al-action">เหตุการณ์ (Action)</label>
          <select id="al-action" name="action" class="form-control"><option value="">ทุกเหตุการณ์</option></select></div>
      </form>
      <div data-al-table></div>`);

    state.tables.auditLogs = new U.DataTable($("[data-al-table]", p), {
      rowKey: "log_id", exportName: "ip-uc-audit-logs", sheetName: "AuditLogs", caption: "Audit Logs",
      sortKey: "timestamp", sortDir: "desc", emptyText: "ไม่พบบันทึกตามเงื่อนไข",
      columns: [
        { key: "timestamp", label: "เวลา", type: "datetime" },
        { key: "email", label: "ผู้ใช้" },
        { key: "action", label: "เหตุการณ์", render: (r) => html`<span class="badge badge-${ACTION_TONES[r.action] || "neutral"}">${r.action}</span>` },
        { key: "summary", label: "สรุป", className: "wrap", value: auditSummary },
        { key: "record_id", label: "record_id", hidden: true },
        { key: "old_value", label: "ค่าเดิม", hidden: true, className: "wrap" },
        { key: "new_value", label: "ค่าใหม่", hidden: true, className: "wrap" },
        { key: "user_agent", label: "User Agent", hidden: true, className: "wrap" },
        {
          key: "actions", label: "", sortable: false, exportable: false, toggleable: false, searchable: false, align: "num",
          render: () => html`<button type="button" class="btn btn-outline btn-xs" data-action="view"><i class="bi bi-eye" aria-hidden="true"></i> ดู</button>`
        }
      ],
      onAction: (action, r) => { if (r) viewAuditLog(r); }
    });

    const form = $("[data-al-filters]", p);
    form.addEventListener("input", U.debounce(loadAuditLogs, 400));
    form.addEventListener("submit", (e) => e.preventDefault());
    $("[data-al-refresh]", p).addEventListener("click", loadAuditLogs);
    state.built["audit-logs"] = true;
  }

  function showAuditLogs() {
    if (!state.built["audit-logs"]) buildAuditLogs();
    if (state.stale["audit-logs"]) loadAuditLogs();
  }

  async function loadAuditLogs() {
    const p = panel("audit-logs");
    const form = $("[data-al-filters]", p);
    const filters = Object.fromEntries(new FormData(form).entries());
    state.tables.auditLogs.setLoading();
    try {
      const res = await API.call("getAuditLogs", Object.assign({ limit: 1000 }, filters));
      const select = $("#al-action");
      const current = select.value;
      setHtml(select, [html`<option value="">ทุกเหตุการณ์</option>`, ...(res.data.actions || []).map((a) => html`<option value="${a}">${a}</option>`)]);
      select.value = current;
      state.tables.auditLogs.setRows(res.data.items || [], { resetPage: true });
      state.stale["audit-logs"] = false;
      $("[data-al-sub]", p).textContent = `พบ ${fmt.int(res.data.total)} รายการ${res.data.total > res.data.limit ? ` (แสดงล่าสุด ${fmt.int(res.data.limit)} รายการ)` : ""}`;
    } catch (err) {
      state.tables.auditLogs.setError(API.describeError(err));
    }
  }

  function pretty(text) {
    const v = parseJson(text);
    if (v === null) return "-";
    return typeof v === "string" ? v : JSON.stringify(v, null, 2);
  }

  function viewAuditLog(r) {
    U.openModal({
      title: `Audit Log · ${r.action}`,
      size: "lg",
      body: html`<dl class="detail-list">
          <dt>เวลา</dt><dd>${U.formatDateTime(r.timestamp)}</dd>
          <dt>ผู้ใช้</dt><dd>${r.email}</dd>
          <dt>เหตุการณ์</dt><dd><span class="badge badge-${ACTION_TONES[r.action] || "neutral"}">${r.action}</span></dd>
          <dt>record_id</dt><dd><code>${r.record_id || "-"}</code></dd>
          <dt>User Agent</dt><dd><small>${r.user_agent || "-"}</small></dd>
          <dt>log_id</dt><dd><code>${r.log_id}</code></dd>
        </dl>
        <div class="diff-grid mt-6">
          <div><h3>ค่าเดิม (old_value)</h3><pre class="json-view">${pretty(r.old_value)}</pre></div>
          <div><h3>ค่าใหม่ (new_value)</h3><pre class="json-view">${pretty(r.new_value)}</pre></div>
        </div>`,
      footer: html`<button type="button" class="btn btn-outline" data-modal-close>ปิด</button>`
    });
  }

  /* ============================== Settings ============================== */
  async function showSettings() {
    const p = panel("settings");
    setHtml(p, U.stateHtml("loading", "กำลังโหลดการตั้งค่า..."));
    try {
      const res = await API.call("getSettings", {});
      if (res.data.scope !== "admin") throw new API.ApiError("FORBIDDEN", "ไม่มีสิทธิ์ดูการตั้งค่าระบบ");
      renderSettings(res.data);
    } catch (err) {
      setHtml(p, U.stateHtml("error", API.describeError(err), html`<div class="state-actions"><button type="button" class="btn btn-outline" data-settings-retry><i class="bi bi-arrow-clockwise" aria-hidden="true"></i> ลองใหม่</button></div>`));
      $("[data-settings-retry]", p)?.addEventListener("click", showSettings);
    }
  }

  function settingControl(def, editable) {
    const id = `set-${def.key}`;
    const disabled = editable ? "" : raw("disabled");
    if (def.type === "boolean") {
      return html`<label class="switch"><input type="checkbox" id="${id}" name="${def.key}" ${def.value ? raw("checked") : ""} ${disabled}>
        <span class="switch-track" aria-hidden="true"></span><span data-switch-text>${def.value ? "เปิด" : "ปิด"}</span></label>`;
    }
    if (def.type === "select") {
      return html`<select id="${id}" name="${def.key}" class="form-control" ${disabled}>${(def.options || []).map((o) => html`<option value="${o}" ${o === def.value ? raw("selected") : ""}>${THEME_NAMES[o] || o}</option>`)}</select>`;
    }
    if (def.type === "number") {
      return html`<input type="number" id="${id}" name="${def.key}" class="form-control" value="${def.value}" min="${def.min}" max="${def.max}" step="1" ${disabled}>`;
    }
    return html`<textarea id="${id}" name="${def.key}" class="form-control" rows="${String(def.value).length > 60 ? 3 : 1}" maxlength="500" ${disabled}>${def.value}</textarea>`;
  }

  function renderSettings(d) {
    const p = panel("settings");
    const sc = d.script_config || {};
    const okBadge = (ok, yes, no) => (ok
      ? html`<span class="badge badge-success"><i class="bi bi-check-circle-fill" aria-hidden="true"></i>${yes}</span>`
      : html`<span class="badge badge-danger"><i class="bi bi-x-circle-fill" aria-hidden="true"></i>${no}</span>`);

    setHtml(p, html`
      <div class="card-head">
        <div>
          <h2 class="card-title"><i class="bi bi-gear-fill" aria-hidden="true"></i> Settings</h2>
          <p class="card-sub">${d.editable ? "SUPER_ADMIN แก้ไขได้ · ทุกการเปลี่ยนแปลงบันทึกใน Audit Logs (SETTINGS_CHANGE)" : "ADMIN ดูได้อย่างเดียว — การแก้ไขต้องใช้สิทธิ์ SUPER_ADMIN"}</p>
        </div>
      </div>
      <form data-settings-form novalidate>
        <div class="settings-list">${d.definitions.map((def) => html`<div class="setting-row">
          <div>
            <h3><label for="set-${def.key}">${def.label}</label></h3>
            <p class="form-hint">${def.description}</p>
            <p class="setting-meta"><code>${def.key}</code> · ${def.is_public ? "ค่าสาธารณะ" : "ค่าภายในระบบ"}${def.updated_by ? ` · แก้ไขโดย ${def.updated_by} เมื่อ ${U.formatDateTime(def.updated_at)}` : ""}</p>
          </div>
          <div>${settingControl(def, d.editable)}</div>
        </div>`)}</div>
        ${d.editable ? html`<div class="form-actions"><button type="submit" class="btn btn-secondary" data-settings-save><i class="bi bi-save" aria-hidden="true"></i> บันทึกการตั้งค่า</button></div>` : ""}
      </form>

      <h3 class="card-title mt-6"><i class="bi bi-hdd-network-fill" aria-hidden="true"></i> สถานะการตั้งค่าเซิร์ฟเวอร์ (Script Properties)</h3>
      <dl class="detail-list mt-4">
        <dt>Spreadsheet ID</dt><dd><code>${sc.spreadsheet_id || "-"}</code></dd>
        <dt>GOOGLE_CLIENT_ID</dt><dd>${okBadge(sc.google_client_id_configured, "ตั้งค่าแล้ว", "ยังไม่ได้ตั้งค่า")}</dd>
        <dt>BOOTSTRAP_SUPER_ADMIN_EMAIL</dt><dd>${okBadge(sc.bootstrap_email_configured, "ตั้งค่าแล้ว", "ยังไม่ได้ตั้งค่า")}</dd>
        <dt>ALLOWED_EMAIL_DOMAINS</dt><dd>${(sc.allowed_email_domains || []).length ? sc.allowed_email_domains.join(", ") : "ไม่จำกัดโดเมน"}</dd>
        <dt>Session</dt><dd>หมดอายุเมื่อไม่มีการใช้งาน ${sc.session_idle_minutes || 60} นาที</dd>
        <dt>ข้อมูลปรับปรุงล่าสุด</dt><dd>${U.formatDateTime(sc.last_data_update)}</dd>
        <dt>เวอร์ชัน</dt><dd>API ${sc.app_version || "-"} · Frontend ${CONFIG.VERSION}</dd>
      </dl>`);

    const form = $("[data-settings-form]", p);
    form.addEventListener("change", (e) => {
      if (e.target.type === "checkbox") {
        const text = e.target.closest(".switch")?.querySelector("[data-switch-text]");
        if (text) text.textContent = e.target.checked ? "เปิด" : "ปิด";
      }
    });
    if (!d.editable) return;

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const changes = {};
      d.definitions.forEach((def) => {
        const el = form.elements[def.key];
        if (!el) return;
        let next;
        let prev;
        if (def.type === "boolean") {
          next = el.checked ? "TRUE" : "FALSE";
          prev = def.value ? "TRUE" : "FALSE";
        } else {
          next = String(el.value).trim();
          prev = String(def.value);
        }
        if (next !== prev) changes[def.key] = next;
      });
      if (!Object.keys(changes).length) {
        U.toast("ไม่มีการเปลี่ยนแปลงค่าตั้งค่า", "info");
        return;
      }
      const ok = await U.confirm({
        title: "ยืนยันบันทึกการตั้งค่า",
        message: "ค่าต่อไปนี้จะถูกเปลี่ยนและมีผลกับผู้ใช้ทุกคน",
        details: html`<dl class="detail-list">${Object.entries(changes).map(([k, v]) => html`<dt><code>${k}</code></dt><dd>${THEME_NAMES[v] || v}</dd>`)}</dl>`,
        confirmText: "บันทึก"
      });
      if (!ok) return;
      const btn = $("[data-settings-save]", form);
      U.setBusy(btn, true, "กำลังบันทึก...");
      try {
        const res = await API.call("updateSettings", { settings: changes });
        U.toast(res.message, "success");
        App.applySettings(res.data.settings || {});
        Dashboard.invalidate();
        state.stale["audit-logs"] = true;
        showSettings();
      } catch (err) {
        U.setBusy(btn, false);
        U.toast(API.describeError(err), "danger", 8000);
      }
    });
  }

  return { init, show, invalidate };
})();
