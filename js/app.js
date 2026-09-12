/**
 * app.js — จุดเริ่มต้นของ Frontend: Router (hash), Navbar ตามสิทธิ์, Theme และการเชื่อมโมดูล
 * การป้องกันสิทธิ์จริงอยู่ที่ Backend — Router เพียงแสดงหน้าที่เหมาะสมกับผู้ใช้
 */
const App = (() => {
  "use strict";
  const { $, $$, html, setHtml } = U;

  const THEMES = [
    "ipuc-vibrant", "government-navy", "healthcare-teal", "executive-blue", "finance-emerald", "strategy-indigo",
    "warm-official", "modern-slate", "public-purple", "vibrant-coral", "electric-blue", "sunset-orange", "lime-tech",
    "royal-magenta", "ocean-bright", "crimson-gold", "cyber-violet", "tropical-green", "high-contrast-amber"
  ];

  const ROUTES = {
    dashboard: { view: "view-dashboard", nav: "dashboard", title: "Dashboard", enter: () => Dashboard.show() },
    import: { view: "view-import", nav: "import", minRole: "EDITOR", title: "นำเข้าข้อมูล", enter: () => Importer.show() },
    data: { view: "view-data", nav: "data", minRole: "EDITOR", title: "จัดการข้อมูล", enter: () => DataManager.show() },
    "admin/users": { view: "view-admin", nav: "admin", minRole: "ADMIN", title: "จัดการผู้ใช้", enter: () => AdminPanel.show("users") },
    "admin/import-logs": { view: "view-admin", nav: "admin", minRole: "ADMIN", title: "Import Logs", enter: () => AdminPanel.show("import-logs") },
    "admin/audit-logs": { view: "view-admin", nav: "admin", minRole: "ADMIN", title: "Audit Logs", enter: () => AdminPanel.show("audit-logs") },
    "admin/settings": { view: "view-admin", nav: "admin", minRole: "ADMIN", title: "Settings", enter: () => AdminPanel.show("settings") }
  };

  let currentKey = null;

  function routeKey() {
    const key = decodeURIComponent(location.hash.replace(/^#\/?/, "")).split("?")[0];
    return Object.prototype.hasOwnProperty.call(ROUTES, key) ? key : "dashboard";
  }

  function navigate() {
    const key = routeKey();
    const route = ROUTES[key];
    closeMobileNav();

    const allowed = !route.minRole || Auth.hasRole(route.minRole);
    const viewId = allowed ? route.view : "view-guard";
    $$("main > .view").forEach((v) => { v.hidden = v.id !== viewId; });
    $$("[data-nav]").forEach((a) => {
      if (a.dataset.nav === route.nav) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    document.title = `${route.title} | ${CONFIG.SYSTEM_NAME}`;

    if (allowed) route.enter(); else renderGuard(route);

    if (currentKey !== null && key !== currentKey) {
      window.scrollTo({ top: 0 });
      $("#main").focus({ preventScroll: true });
    }
    currentKey = key;
  }

  function renderGuard(route) {
    const user = Auth.getUser();
    $("#guard-title").textContent = user ? "ไม่มีสิทธิ์เข้าถึงหน้านี้" : "ต้องเข้าสู่ระบบ";
    $("#guard-sub").textContent = `หน้า “${route.title}” สำหรับผู้ใช้สิทธิ์ ${route.minRole} ขึ้นไป`;
    const box = $("#guard-content");
    if (user) {
      setHtml(box, U.stateHtml("lock", `บัญชีของคุณมีสิทธิ์ ${user.role} ซึ่งไม่เพียงพอสำหรับหน้านี้ หากต้องการสิทธิ์เพิ่มเติม กรุณาติดต่อผู้ดูแลระบบ`,
        html`<div class="state-actions"><a class="btn btn-secondary" href="#/dashboard"><i class="bi bi-speedometer2" aria-hidden="true"></i> กลับไปที่ Dashboard</a></div>`));
      return;
    }
    setHtml(box, U.stateHtml("lock", "กรุณาเข้าสู่ระบบด้วยบัญชี Google ที่ได้รับการอนุมัติแล้ว",
      html`<div class="state-actions">
        <button type="button" class="btn btn-secondary" data-guard-login><i class="bi bi-box-arrow-in-right" aria-hidden="true"></i> เข้าสู่ระบบ</button>
        <button type="button" class="btn btn-outline" data-guard-register><i class="bi bi-person-plus" aria-hidden="true"></i> สมัครใช้งาน</button>
      </div>`));
    $("[data-guard-login]", box).addEventListener("click", () => Auth.openLogin("login"));
    $("[data-guard-register]", box).addEventListener("click", () => Auth.openLogin("register"));
  }

  function renderNav() {
    $$("[data-min-role]").forEach((el) => { el.hidden = !Auth.hasRole(el.dataset.minRole); });
    const area = $("#auth-area");
    const user = Auth.getUser();
    if (!user) {
      setHtml(area, html`<button type="button" class="btn btn-secondary btn-sm" data-auth-login><i class="bi bi-box-arrow-in-right" aria-hidden="true"></i> เข้าสู่ระบบ</button>`);
      $("[data-auth-login]", area).addEventListener("click", () => Auth.openLogin("login"));
      return;
    }
    const initial = Array.from(String(user.first_name || user.email || "?").trim())[0] || "?";
    setHtml(area, html`<details class="dropdown user-menu">
      <summary class="user-chip" aria-label="เมนูผู้ใช้ ${user.full_name || user.email}">
        <span class="avatar" aria-hidden="true">${user.picture ? html`<img src="${user.picture}" alt="" referrerpolicy="no-referrer">` : initial}</span>
        <span class="user-name">${user.first_name || user.email}</span>
        <i class="bi bi-chevron-down" aria-hidden="true"></i>
      </summary>
      <div class="dropdown-panel">
        <div class="user-info">
          <strong>${user.full_name || "-"}</strong>
          <small>${user.email}</small>
          <span class="mt-2">${U.roleBadge(user.role)}</span>
        </div>
        <hr>
        ${Auth.hasRole("EDITOR") ? html`<a class="dropdown-item" href="#/import"><i class="bi bi-cloud-arrow-up" aria-hidden="true"></i> นำเข้าข้อมูล</a>
          <a class="dropdown-item" href="#/data"><i class="bi bi-table" aria-hidden="true"></i> จัดการข้อมูล</a>` : ""}
        ${Auth.hasRole("ADMIN") ? html`<a class="dropdown-item" href="#/admin/users"><i class="bi bi-shield-lock" aria-hidden="true"></i> ผู้ดูแลระบบ</a>` : ""}
        <button type="button" class="dropdown-item danger" data-auth-logout><i class="bi bi-box-arrow-right" aria-hidden="true"></i> ออกจากระบบ</button>
      </div>
    </details>`);
    const menu = $(".user-menu", area);
    const avatarImg = $(".avatar img", area);
    if (avatarImg) avatarImg.addEventListener("error", () => { avatarImg.parentElement.textContent = initial; }, { once: true });
    $("[data-auth-logout]", area).addEventListener("click", () => {
      menu.open = false;
      Auth.logout();
    });
    $$(".dropdown-item[href]", area).forEach((a) => a.addEventListener("click", () => { menu.open = false; }));
  }

  function toggleMobileNav(force) {
    const menu = $("#nav-menu");
    const btn = $("#nav-toggle");
    const open = typeof force === "boolean" ? force : !menu.classList.contains("is-open");
    menu.classList.toggle("is-open", open);
    btn.setAttribute("aria-expanded", String(open));
    btn.setAttribute("aria-label", open ? "ปิดเมนูหลัก" : "เปิดเมนูหลัก");
    setHtml(btn, html`<i class="bi ${open ? "bi-x-lg" : "bi-list"}" aria-hidden="true"></i>`);
  }
  const closeMobileNav = () => { if ($("#nav-menu").classList.contains("is-open")) toggleMobileNav(false); };

  function applyTheme(theme) {
    if (!THEMES.includes(theme)) return;
    const root = document.documentElement;
    if (root.dataset.theme === theme) return;
    root.dataset.theme = theme;
    try { localStorage.setItem("ipuc_theme", theme); } catch (e) { /* ignore */ }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = U.cssVar("--color-primary") || "#0F2747";
    Dashboard.rerender();
  }

  function applySettings(settings = {}) {
    if (settings.DASHBOARD_THEME) applyTheme(settings.DASHBOARD_THEME);
    if (settings.ORG_NAME) $$("[data-org-name]").forEach((el) => { el.textContent = settings.ORG_NAME; });
    if (settings.DATA_SOURCE_NOTE) {
      const note = $("#data-note");
      if (note) note.textContent = settings.DATA_SOURCE_NOTE;
    }
  }

  function init() {
    try {
      const saved = localStorage.getItem("ipuc_theme");
      document.documentElement.dataset.theme = THEMES.includes(saved) ? saved : CONFIG.DEFAULT_THEME;
    } catch (e) {
      document.documentElement.dataset.theme = CONFIG.DEFAULT_THEME;
    }
    $("#app-version").textContent = CONFIG.VERSION;
    $("#copyright-year").textContent = String(new Date().getFullYear() + 543);

    $("#nav-toggle").addEventListener("click", () => toggleMobileNav());
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMobileNav(); });
    document.addEventListener("pointerdown", (e) => {
      const menu = $(".user-menu");
      if (menu && menu.open && !menu.contains(e.target)) menu.open = false;
      const nav = $("#nav-menu");
      if (nav.classList.contains("is-open") && !nav.contains(e.target) && !$("#nav-toggle").contains(e.target)) closeMobileNav();
    });

    Dashboard.init();
    Importer.init();
    DataManager.init();
    AdminPanel.init();

    Auth.onChange(() => {
      renderNav();
      Dashboard.onAuthChange();
      DataManager.invalidate();
      AdminPanel.invalidate();
      navigate();
    });

    // Auth.init อ่าน session จาก localStorage แบบ synchronous ก่อน แล้วจึงตรวจสอบกับ Backend (getMe)
    const authReady = Auth.init();
    renderNav();
    window.addEventListener("hashchange", navigate);
    navigate();
    authReady.then(() => {
      renderNav();
      navigate();
    });
  }

  return { init, applySettings, applyTheme };
})();

document.addEventListener("DOMContentLoaded", () => App.init());
