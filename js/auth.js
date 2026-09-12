/**
 * auth.js — Google Identity Services (GIS) + Session Token
 *
 * ขั้นตอน
 * 1) GIS ส่ง Google ID Token (credential) กลับมาที่ callback
 * 2) ส่ง credential ไปให้ GAS action=login / register — Backend ตรวจสอบ token และสิทธิ์
 * 3) Backend คืน Session Token (อายุ 60 นาทีเมื่อไม่มีการใช้งาน) และข้อมูลผู้ใช้/สิทธิ์
 *
 * Frontend ไม่ decode ID Token และไม่ใช้ข้อมูลใน token ตัดสินสิทธิ์
 * การซ่อนเมนูตาม role เป็นเพียง UX — Backend ตรวจสิทธิ์ทุกคำขอ
 */
const Auth = (() => {
  "use strict";
  const { $, $$, html, setHtml } = U;

  const STORAGE_KEY = "ipuc_session_v1";
  const IDLE_MS = CONFIG.SESSION_IDLE_MINUTES * 60 * 1000;
  const NAME_PATTERN = /^[฀-๿A-Za-z][฀-๿A-Za-z .'-]*$/;

  let session = { token: null, user: null, expiresAt: 0 };
  let gisReady = false;
  let gisFailed = false;
  let mode = "login";
  let modal = null;
  let submitting = false;
  const listeners = new Set();

  /* ------------------------------ Session storage ------------------------------ */
  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (saved && typeof saved.token === "string" && saved.expiresAt > Date.now() && saved.user) session = saved;
      else localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      session = { token: null, user: null, expiresAt: 0 };
    }
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(session)); } catch (e) { /* storage ถูกปิด */ }
  }

  function emit() { listeners.forEach((fn) => { try { fn(session.user); } catch (e) { console.error(e); } }); }

  function clear(silent = false) {
    const had = !!session.token;
    session = { token: null, user: null, expiresAt: 0 };
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
    if (had && !silent) emit();
  }

  function setSession(data) {
    const picture = data.user?.picture || session.user?.picture || "";
    session = {
      token: data.token,
      user: Object.assign({}, data.user, { picture }),
      expiresAt: Date.now() + IDLE_MS
    };
    save();
    emit();
  }

  const getToken = () => (session.token && session.expiresAt > Date.now() ? session.token : null);
  const getUser = () => (getToken() ? session.user : null);
  const isLoggedIn = () => !!getUser();
  const hasRole = (minRole) => {
    const user = getUser();
    return !!user && user.status === "approved" && (U.ROLE_LEVEL[user.role] || 0) >= (U.ROLE_LEVEL[minRole] || 99);
  };
  const isClientIdConfigured = () => /\.apps\.googleusercontent\.com$/.test(String(CONFIG.GOOGLE_CLIENT_ID || ""));

  /* ------------------------------ Init ------------------------------ */
  async function init() {
    load();
    API.hooks.getToken = getToken;
    API.hooks.onActivity = () => {
      if (!session.token) return;
      session.expiresAt = Date.now() + IDLE_MS;
      save();
    };
    API.hooks.onSessionInvalid = (err) => {
      if (!session.token) return;
      clear();
      U.toast(err.message || "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่", "warning");
    };

    setInterval(() => {
      if (session.token && session.expiresAt <= Date.now()) {
        clear();
        U.toast("เซสชันหมดอายุเนื่องจากไม่มีการใช้งาน 60 นาที กรุณาเข้าสู่ระบบใหม่", "warning", 8000);
      }
    }, 30000);

    if (session.token && API.isConfigured()) {
      try {
        const res = await API.call("getMe");
        session.user = Object.assign({}, res.data.user, { picture: session.user?.picture || "" });
        save();
      } catch (err) {
        if (!API.SESSION_CODES.includes(err.code) && err.code !== "FORBIDDEN") {
          console.warn("getMe failed, keep cached session", err);
        }
      }
    }
    initGis();
  }

  function initGis() {
    if (!isClientIdConfigured()) return;
    const start = () => {
      try {
        google.accounts.id.initialize({
          client_id: CONFIG.GOOGLE_CLIENT_ID,
          callback: onCredential,
          auto_select: false,
          cancel_on_tap_outside: true,
          ux_mode: "popup",
          context: "signin",
          itp_support: true
        });
        gisReady = true;
        if (modal) renderGisButtons();
      } catch (err) {
        console.error("GIS initialize failed", err);
        gisFailed = true;
        if (modal) renderGisButtons();
      }
    };
    if (window.google?.accounts?.id) {
      start();
      return;
    }
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (window.google?.accounts?.id) {
        clearInterval(timer);
        start();
      } else if (Date.now() - startedAt > 15000) {
        clearInterval(timer);
        gisFailed = true;
        if (modal) renderGisButtons();
      }
    }, 200);
  }

  /* ------------------------------ Login modal ------------------------------ */
  function openLogin(tab = "login") {
    if (modal) {
      setTab(tab);
      return;
    }
    const content = document.getElementById("tpl-login").content.cloneNode(true);
    modal = U.openModal({
      title: "เข้าสู่ระบบ IP.UC Analytics",
      body: content,
      size: "sm",
      onClose: () => { modal = null; }
    });

    const configBox = $("[data-auth-config]", modal.body);
    const problems = [];
    if (!API.isConfigured()) problems.push("GAS_API_URL");
    if (!isClientIdConfigured()) problems.push("GOOGLE_CLIENT_ID");
    if (problems.length) {
      configBox.hidden = false;
      setHtml(configBox, html`<div class="alert alert-warning"><i class="bi bi-gear-fill" aria-hidden="true"></i>
        <div>ระบบยังไม่พร้อมให้เข้าสู่ระบบ: ยังไม่ได้ตั้งค่า <strong>${problems.join(" และ ")}</strong> ในไฟล์ js/config.js กรุณาติดต่อผู้ดูแลระบบ</div></div>`);
    }

    $$("[data-auth-tab]", modal.body).forEach((btn) => {
      btn.addEventListener("click", () => setTab(btn.dataset.authTab));
    });
    const form = $("[data-register-form]", modal.body);
    form.addEventListener("input", updateRegisterState);
    form.addEventListener("submit", (e) => e.preventDefault());

    setTab(tab);
  }

  function setTab(tab) {
    if (!modal) return;
    mode = tab === "register" ? "register" : "login";
    $$("[data-auth-tab]", modal.body).forEach((btn) => btn.setAttribute("aria-selected", String(btn.dataset.authTab === mode)));
    $$("[data-auth-panel]", modal.body).forEach((p) => { p.hidden = p.dataset.authPanel !== mode; });
    modal.setTitle(mode === "register" ? "สมัครใช้งาน IP.UC Analytics" : "เข้าสู่ระบบ IP.UC Analytics");
    setStatus(null);
    updateRegisterState();
    renderGisButtons();
    if (mode === "register") $("#reg-first", modal.body)?.focus();
  }

  function registerNames() {
    return {
      first_name: U.cleanText($("#reg-first", modal.body)?.value, 100),
      last_name: U.cleanText($("#reg-last", modal.body)?.value, 100)
    };
  }

  function updateRegisterState() {
    if (!modal) return;
    const { first_name: first, last_name: last } = registerNames();
    const valid = NAME_PATTERN.test(first) && NAME_PATTERN.test(last);
    const slot = $('[data-gis="register"]', modal.body);
    const hint = $("[data-register-hint]", modal.body);
    const wasHidden = slot.hidden;
    slot.hidden = !valid;
    hint.hidden = valid;
    const firstInput = $("#reg-first", modal.body);
    const lastInput = $("#reg-last", modal.body);
    firstInput.setAttribute("aria-invalid", String(!!first && !NAME_PATTERN.test(first)));
    lastInput.setAttribute("aria-invalid", String(!!last && !NAME_PATTERN.test(last)));
    if (valid && wasHidden && mode === "register") renderGisButtons();
  }

  function renderGisButtons() {
    if (!modal) return;
    const slot = $(`[data-gis="${mode}"]`, modal.body);
    if (!slot || slot.hidden) return;
    if (!isClientIdConfigured()) {
      setHtml(slot, html`<button type="button" class="btn btn-outline btn-block" disabled><i class="bi bi-google" aria-hidden="true"></i> ${mode === "register" ? "สมัครด้วย Google" : "เข้าสู่ระบบด้วย Google"}</button>`);
      return;
    }
    if (gisFailed) {
      setHtml(slot, html`<div class="alert alert-danger"><i class="bi bi-wifi-off" aria-hidden="true"></i><div>ไม่สามารถโหลด Google Sign-In ได้ กรุณาตรวจสอบอินเทอร์เน็ต หรือปิดตัวบล็อกโฆษณา แล้วรีเฟรชหน้า</div></div>`);
      return;
    }
    if (!gisReady) {
      setHtml(slot, html`<span class="text-muted"><span class="spinner" aria-hidden="true"></span> กำลังโหลด Google Sign-In...</span>`);
      return;
    }
    slot.innerHTML = "";
    const width = Math.max(220, Math.min(360, Math.round(modal.body.clientWidth - 8)));
    google.accounts.id.renderButton(slot, {
      type: "standard",
      theme: "filled_blue",
      size: "large",
      shape: "pill",
      text: mode === "register" ? "signup_with" : "signin_with",
      logo_alignment: "left",
      locale: "th",
      width
    });
  }

  function setStatus(kind, message, extra) {
    if (!modal) return;
    const box = $("[data-auth-status]", modal.body);
    if (!kind) {
      setHtml(box, "");
      return;
    }
    const icons = { loading: "", info: "bi-info-circle-fill", success: "bi-check-circle-fill", warning: "bi-hourglass-split", danger: "bi-x-octagon-fill" };
    const cls = kind === "loading" ? "info" : kind;
    setHtml(box, html`<div class="alert alert-${cls}">
      ${kind === "loading" ? html`<span class="spinner" aria-hidden="true"></span>` : html`<i class="bi ${icons[kind]}" aria-hidden="true"></i>`}
      <div>${message}${extra || ""}</div></div>`);
  }

  async function onCredential(response) {
    const credential = response && response.credential;
    if (!credential || submitting) return;
    if (!API.isConfigured()) {
      setStatus("danger", "ยังไม่ได้ตั้งค่า GAS_API_URL");
      return;
    }
    submitting = true;
    const currentMode = mode;
    setStatus("loading", currentMode === "register" ? "กำลังส่งข้อมูลสมัครใช้งาน..." : "กำลังตรวจสอบตัวตนและสิทธิ์...");
    try {
      if (currentMode === "register") {
        const names = registerNames();
        const res = await API.call("register", Object.assign({ credential }, names), { auth: false });
        if (res.data.auto_login && res.data.token) {
          setSession(res.data);
          modal?.close();
          U.toast(res.message, "success");
        } else {
          setStatus("warning", res.message, html`<br><small>อีเมล: ${res.data.email || "-"} — ผู้ดูแลระบบจะตรวจสอบและอนุมัติบัญชีของคุณ</small>`);
          const form = $("[data-register-form]", modal?.body || document);
          if (form) form.reset();
          updateRegisterState();
        }
      } else {
        const res = await API.call("login", { credential }, { auth: false });
        setSession(res.data);
        modal?.close();
        U.toast(`ยินดีต้อนรับ คุณ${res.data.user.first_name} (${res.data.user.role})`, "success");
      }
    } catch (err) {
      handleAuthError(err);
    } finally {
      submitting = false;
    }
  }

  function handleAuthError(err) {
    switch (err.code) {
      case "USER_NOT_FOUND":
        setStatus("warning", err.message, html` <button type="button" class="btn btn-secondary btn-xs" data-goto-register>สมัครใช้งาน</button>`);
        $("[data-goto-register]", modal?.body || document)?.addEventListener("click", () => setTab("register"));
        break;
      case "PENDING_APPROVAL":
        setStatus("warning", err.message);
        break;
      case "USER_SUSPENDED":
      case "USER_REJECTED":
      case "FORBIDDEN":
        setStatus("danger", err.message);
        break;
      case "DUPLICATE":
        setStatus("info", err.message, html` <button type="button" class="btn btn-secondary btn-xs" data-goto-login>เข้าสู่ระบบ</button>`);
        $("[data-goto-login]", modal?.body || document)?.addEventListener("click", () => setTab("login"));
        break;
      default:
        setStatus("danger", API.describeError(err));
    }
  }

  async function logout() {
    const token = session.token;
    clear();
    try { window.google?.accounts?.id?.disableAutoSelect(); } catch (e) { /* ignore */ }
    U.toast("ออกจากระบบเรียบร้อยแล้ว", "info");
    if (token && API.isConfigured()) {
      try { await API.call("logout", {}, { token }); } catch (e) { /* session อาจหมดอายุแล้ว */ }
    }
  }

  function updateUser(user) {
    if (!session.token || !user) return;
    session.user = Object.assign({}, session.user, user);
    save();
    emit();
  }

  return {
    init, openLogin, logout, getToken, getUser, isLoggedIn, hasRole, updateUser, isClientIdConfigured,
    onChange: (fn) => listeners.add(fn)
  };
})();
