/* ═══════════════════════════════════════════════════════════════
   ZENITH — Profile & Auth  (zenith-profile.js)  v2
   ─────────────────────────────────────────────────────────────
   Uses YOUR shared Supabase project — users sign up with email
   + password and their data follows them to every device.

   ► SETUP (one-time):
     1. Create a free project at supabase.com
     2. Run supabase-setup.sql in the SQL editor
     3. Paste your Project URL and anon key below
     4. Set Supabase Auth → Email confirmations OFF (for dev)
        or keep ON for production (users verify email first)
═══════════════════════════════════════════════════════════════ */
"use strict";

/* ─── YOUR SUPABASE CREDENTIALS (replace these) ─────────────── */
const SUPABASE_URL      = "https://YOUR_PROJECT_ID.supabase.co";
const SUPABASE_ANON_KEY = "YOUR_ANON_KEY_HERE";
/* ─────────────────────────────────────────────────────────────── */

const ZenithProfile = (() => {

  /* ════════════════════════════════════════════
     SUPABASE REST HELPERS
  ════════════════════════════════════════════ */
  const AUTH  = `${SUPABASE_URL}/auth/v1`;
  const REST  = `${SUPABASE_URL}/rest/v1`;

  function _anonHeaders() {
    return {
      "Content-Type": "application/json",
      "apikey":       SUPABASE_ANON_KEY,
    };
  }

  function _authHeaders(token) {
    return {
      ..._anonHeaders(),
      "Authorization": `Bearer ${token ?? _getSession()?.access_token ?? SUPABASE_ANON_KEY}`,
    };
  }

  /* ════════════════════════════════════════════
     SESSION MANAGEMENT
     Supabase returns { access_token, refresh_token, expires_at, user }
     We persist this in localStorage so it survives page reloads.
  ════════════════════════════════════════════ */
  const SESSION_KEY = "zenith_sb_session";

  function _getSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY)); }
    catch { return null; }
  }

  function _setSession(session) {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else         localStorage.removeItem(SESSION_KEY);
  }

  function isLoggedIn() {
    const s = _getSession();
    if (!s?.access_token || !s?.expires_at) return false;
    /* Add 60s buffer to handle clock drift */
    return Date.now() / 1000 < s.expires_at - 60;
  }

  /** Refresh the access token using the refresh token */
  async function _refreshSession() {
    const s = _getSession();
    if (!s?.refresh_token) return false;

    try {
      const res = await fetch(`${AUTH}/token?grant_type=refresh_token`, {
        method:  "POST",
        headers: _anonHeaders(),
        body:    JSON.stringify({ refresh_token: s.refresh_token }),
      });
      if (!res.ok) { _setSession(null); return false; }
      const data = await res.json();
      _setSession(data);
      return true;
    } catch { return false; }
  }

  /** Ensure session is valid, refreshing if needed */
  async function _ensureSession() {
    if (isLoggedIn()) return true;
    return _refreshSession();
  }

  /* ════════════════════════════════════════════
     AUTH ACTIONS
  ════════════════════════════════════════════ */
  async function signup({ email, password, name, username }) {
    /* Basic validation */
    if (!name?.trim() || name.trim().length < 2)
      return { ok: false, error: "Name must be at least 2 characters." };
    if (!email?.trim() || !email.includes("@"))
      return { ok: false, error: "Enter a valid email address." };
    if (!/^[a-z0-9_]{3,20}$/i.test(username))
      return { ok: false, error: "Username: 3–20 chars, letters/numbers/underscores." };
    if (!password || password.length < 6)
      return { ok: false, error: "Password must be at least 6 characters." };

    try {
      /* 1. Create auth user */
      const authRes = await fetch(`${AUTH}/signup`, {
        method:  "POST",
        headers: _anonHeaders(),
        body:    JSON.stringify({ email: email.trim(), password }),
      });
      const authData = await authRes.json();

      if (!authRes.ok) {
        const msg = authData?.msg ?? authData?.error_description ?? authData?.message ?? "";
        if (msg.includes("already registered"))
          return { ok: false, error: "An account with that email already exists. Try signing in." };
        return { ok: false, error: msg || "Sign-up failed. Try again." };
      }

      /* Supabase may require email confirmation — session may be null */
      const session = authData.session ?? authData;
      if (session?.access_token) _setSession(session);

      const userId  = authData.user?.id ?? session?.user?.id;
      if (!userId) {
        /* Email confirmation required */
        return {
          ok:              true,
          needsConfirmation: true,
          message:         "Check your email to confirm your account, then sign in.",
        };
      }

      /* 2. Create public profile record */
      await _upsertProfile({
        id:       userId,
        name:     name.trim(),
        username: username.toLowerCase().trim(),
      }, session.access_token);

      return { ok: true, profile: { name: name.trim(), username, email } };

    } catch (err) {
      return { ok: false, error: "Network error. Check your connection." };
    }
  }

  async function login({ email, password }) {
    try {
      const res = await fetch(`${AUTH}/token?grant_type=password`, {
        method:  "POST",
        headers: _anonHeaders(),
        body:    JSON.stringify({ email: email.trim(), password }),
      });
      const data = await res.json();

      if (!res.ok) {
        const msg = data?.error_description ?? data?.msg ?? "";
        if (msg.includes("Invalid login")) return { ok: false, error: "Incorrect email or password." };
        if (msg.includes("Email not confirmed")) return { ok: false, error: "Please confirm your email before signing in." };
        return { ok: false, error: msg || "Sign-in failed." };
      }

      _setSession(data);

      /* Load profile from server */
      const profile = await _fetchProfile(data.access_token, data.user.id);
      return { ok: true, profile: profile ?? { email, name: email.split("@")[0] } };

    } catch {
      return { ok: false, error: "Network error. Check your connection." };
    }
  }

  async function signOut() {
    const token = _getSession()?.access_token;
    _setSession(null);

    /* Tell Supabase to invalidate the token */
    if (token) {
      fetch(`${AUTH}/logout`, {
        method:  "POST",
        headers: _authHeaders(token),
      }).catch(() => {});
    }
  }

  /* ════════════════════════════════════════════
     PROFILE TABLE  (name, username display data)
  ════════════════════════════════════════════ */
  async function _upsertProfile(data, token) {
    return fetch(`${REST}/profiles`, {
      method:  "POST",
      headers: {
        ..._authHeaders(token),
        "Prefer": "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(data),
    });
  }

  async function _fetchProfile(token, userId) {
    try {
      const res = await fetch(
        `${REST}/profiles?id=eq.${userId}&select=name,username`,
        { headers: _authHeaders(token) }
      );
      const rows = await res.json();
      return rows?.[0] ?? null;
    } catch { return null; }
  }

  async function getProfile() {
    if (!await _ensureSession()) return null;
    const s = _getSession();
    return _fetchProfile(s.access_token, s.user.id);
  }

  async function updateProfile({ name, username }) {
    if (!await _ensureSession()) return { ok: false, error: "Not signed in." };
    const s = _getSession();

    const update = {};
    if (name?.trim()?.length >= 2)    update.name     = name.trim();
    if (username?.trim())              update.username = username.toLowerCase().trim();

    try {
      const res = await fetch(
        `${REST}/profiles?id=eq.${s.user.id}`,
        {
          method:  "PATCH",
          headers: { ..._authHeaders(s.access_token), "Prefer": "return=minimal" },
          body:    JSON.stringify(update),
        }
      );
      if (!res.ok) return { ok: false, error: "Update failed." };
      return { ok: true };
    } catch { return { ok: false, error: "Network error." }; }
  }

  async function updatePassword(newPassword) {
    if (!await _ensureSession()) return { ok: false, error: "Not signed in." };
    if (newPassword.length < 6) return { ok: false, error: "Password must be at least 6 characters." };

    const s = _getSession();
    try {
      const res = await fetch(`${AUTH}/user`, {
        method:  "PUT",
        headers: _authHeaders(s.access_token),
        body:    JSON.stringify({ password: newPassword }),
      });
      return res.ok ? { ok: true } : { ok: false, error: "Password update failed." };
    } catch { return { ok: false, error: "Network error." }; }
  }

  /* ════════════════════════════════════════════
     AVATAR UTILITIES
  ════════════════════════════════════════════ */
  function _initials(name = "") {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  }

  function _gradient(seed = "") {
    let h = 0;
    for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return `linear-gradient(135deg, hsl(${h % 360},80%,60%), hsl(${(h + 40) % 360},75%,50%))`;
  }

  /* ════════════════════════════════════════════
     APP INTEGRATION
  ════════════════════════════════════════════ */
  function _patchGreeting(profile) {
    if (!profile) return;
    const name = (profile.name ?? profile.email ?? "").split(" ")[0];
    const orig = window.getGreeting;
    if (typeof orig === "function") {
      window.getGreeting = () =>
        orig().replace(/,\s*VEER\s*$/, `, ${name}`).replace(/,\s*warrior\?/, `, ${name}?`);
    }
    setTimeout(() => { if (typeof updateClock === "function") updateClock(); }, 100);
  }

  function _injectSidebarAvatar(profile) {
    if (!profile) return;
    const sidebar = document.querySelector(".sidebar-brand");
    if (!sidebar) return;
    const old = document.getElementById("zpSidebarUser");
    if (old) old.remove();

    const initials = _initials(profile.name ?? profile.email ?? "?");
    const gradient = _gradient(profile.username ?? profile.email ?? "");

    const el = document.createElement("div");
    el.id        = "zpSidebarUser";
    el.className = "zp-sidebar-user";
    el.innerHTML = `
      <div class="zp-avatar" style="background:${gradient}">${initials}</div>
      <div class="zp-user-text">
        <div class="zp-user-name">${_esc(profile.name ?? "User")}</div>
        <div class="zp-user-handle">@${_esc(profile.username ?? profile.email ?? "")}</div>
      </div>`;
    el.addEventListener("click", openProfilePanel);
    sidebar.insertAdjacentElement("afterend", el);
  }

  function _injectHeaderAvatar(profile) {
    if (!profile) return;
    const header = document.querySelector(".header-right");
    if (!header) return;
    const old = document.getElementById("zpHeaderAvatar");
    if (old) old.remove();

    const initials = _initials(profile.name ?? "");
    const gradient = _gradient(profile.username ?? "");

    const btn = document.createElement("button");
    btn.id        = "zpHeaderAvatar";
    btn.className = "zp-header-avatar-btn";
    btn.setAttribute("aria-label", "Open profile");
    btn.innerHTML = `<div class="zp-avatar" style="background:${gradient}">${initials}</div>`;
    btn.addEventListener("click", openProfilePanel);
    header.prepend(btn);
  }

  /* ════════════════════════════════════════════
     PROFILE PANEL
  ════════════════════════════════════════════ */
  async function openProfilePanel() {
    if (document.getElementById("zpPanel")) { closeProfilePanel(); return; }

    const profile  = await getProfile() ?? {};
    const session  = _getSession();
    const email    = session?.user?.email ?? "";
    const initials = _initials(profile.name ?? email);
    const gradient = _gradient(profile.username ?? email);
    const since    = session?.user?.created_at
      ? new Date(session.user.created_at).toLocaleDateString("en", { month:"short", day:"numeric", year:"numeric" })
      : "—";

    const streak    = window.streak ?? 0;
    const xp        = window.xp    ?? 0;
    const totalMin  = Object.values(window.stats ?? {}).reduce((s, d) => s + (d.min || 0), 0);

    const bd = document.createElement("div");
    bd.id = "zpPanelBackdrop"; bd.className = "zp-panel-backdrop";
    bd.addEventListener("click", closeProfilePanel);
    document.body.appendChild(bd);
    requestAnimationFrame(() => bd.classList.add("zp-bd-open"));

    const panel = document.createElement("div");
    panel.id = "zpPanel"; panel.className = "zp-panel";
    panel.setAttribute("role", "dialog");
    panel.innerHTML = `
      <div class="zp-panel-header">
        <span class="zp-panel-title">Profile</span>
        <button class="zp-panel-close" onclick="ZenithProfile.closeProfilePanel()">✕</button>
      </div>

      <div class="zp-profile-hero">
        <div class="zp-hero-avatar" style="background:${gradient}">${initials}</div>
        <div class="zp-hero-name">${_esc(profile.name ?? email)}</div>
        <div class="zp-hero-username">${profile.username ? "@" + _esc(profile.username) : _esc(email)}</div>
        <div class="zp-hero-since">Member since ${since}</div>
      </div>

      <div class="zp-stats-row">
        <div class="zp-stat-cell"><span class="zp-stat-val">${streak}</span><span class="zp-stat-lbl">Streak</span></div>
        <div class="zp-stat-cell"><span class="zp-stat-val">${xp}</span><span class="zp-stat-lbl">XP</span></div>
        <div class="zp-stat-cell"><span class="zp-stat-val">${totalMin}</span><span class="zp-stat-lbl">Min focused</span></div>
      </div>

      <div class="zp-panel-section">
        <div class="zp-section-title">Edit Profile</div>
        <div class="zp-edit-row">
          <span class="zp-edit-label">Display name</span>
          <input id="zpEditName" class="zp-edit-input" type="text"
            value="${_esc(profile.name ?? "")}" maxlength="40"/>
        </div>
        <div class="zp-edit-row">
          <span class="zp-edit-label">Email</span>
          <input class="zp-edit-input" type="text" value="${_esc(email)}" readonly/>
        </div>
        <div class="zp-edit-row">
          <span class="zp-edit-label">New password</span>
          <input id="zpEditPw" class="zp-edit-input" type="password" placeholder="Leave blank to keep current"/>
        </div>
        <div id="zpProfileMsg"></div>
        <button class="zp-save-profile-btn" onclick="ZenithProfile._savePanelChanges()">Save Changes</button>
      </div>

      <div class="zp-panel-section">
        <div class="zp-section-title">Your Account</div>
        <p style="font-size:12px;color:var(--muted);line-height:1.6;margin:0 0 8px">
          Sign in on any device with your email and password.
          Your sessions, tasks, and progress sync automatically.
        </p>
        <p style="font-size:11px;color:var(--muted);margin:0;font-family:var(--font-mono)">
          User ID: ${_esc(session?.user?.id?.slice(0, 8) ?? "—")}…
        </p>
      </div>

      <div class="zp-panel-section">
        <button class="zp-danger-btn" onclick="ZenithProfile._confirmSignOut()">Sign Out</button>
      </div>`;

    document.body.appendChild(panel);
    requestAnimationFrame(() => panel.classList.add("zp-panel-open"));
  }

  function closeProfilePanel() {
    ["zpPanel", "zpPanelBackdrop"].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.classList.remove("zp-panel-open", "zp-bd-open");
      setTimeout(() => el.remove(), 350);
    });
  }

  async function _savePanelChanges() {
    const name  = document.getElementById("zpEditName")?.value?.trim();
    const pw    = document.getElementById("zpEditPw")?.value;
    const msgEl = document.getElementById("zpProfileMsg");

    if (name && name.length < 2) { _panelMsg("Name must be at least 2 characters.", "err", msgEl); return; }
    if (pw && pw.length < 6)     { _panelMsg("Password must be at least 6 characters.", "err", msgEl); return; }

    const [profResult, pwResult] = await Promise.all([
      name ? updateProfile({ name }) : Promise.resolve({ ok: true }),
      pw   ? updatePassword(pw)      : Promise.resolve({ ok: true }),
    ]);

    if (!profResult.ok) { _panelMsg(profResult.error, "err", msgEl); return; }
    if (!pwResult.ok)   { _panelMsg(pwResult.error,   "err", msgEl); return; }

    _panelMsg("Saved ✓", "ok", msgEl);
    const p = await getProfile();
    _patchGreeting(p);
    _injectSidebarAvatar(p);
    _injectHeaderAvatar(p);
    if (typeof updateClock === "function") updateClock();
  }

  async function _confirmSignOut() {
    if (!confirm("Sign out? You can sign back in on any device with your email and password.")) return;
    closeProfilePanel();
    await signOut();
    _showAuthOverlay();
  }

  function _panelMsg(text, type, el) {
    if (!el) return;
    el.innerHTML = `<div class="zp-panel-toast zp-toast-${type}">${_esc(text)}</div>`;
    if (type === "ok") setTimeout(() => { if (el) el.innerHTML = ""; }, 3000);
  }

  /* ════════════════════════════════════════════
     AUTH OVERLAY
  ════════════════════════════════════════════ */
  function _showAuthOverlay() {
    if (document.getElementById("zpAuthOverlay")) return;

    /* Inject hidden-form style */
    if (!document.getElementById("zpHiddenStyle")) {
      const s = document.createElement("style");
      s.id = "zpHiddenStyle";
      s.textContent = ".zp-hidden{display:none!important}";
      document.head.appendChild(s);
    }

    const overlay = document.createElement("div");
    overlay.id        = "zpAuthOverlay";
    overlay.className = "zp-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.innerHTML = `
      <div class="zp-blob zp-blob-1" aria-hidden="true"></div>
      <div class="zp-blob zp-blob-2" aria-hidden="true"></div>

      <div class="zp-card">
        <div class="zp-logo-block">
          <div class="zp-logo-ring">
            <img src="assets/icons/logo.webp" alt="" class="zp-logo-img"
                 width="60" height="60" decoding="async"
                 onerror="this.style.display='none'">
          </div>
          <div class="zp-logo-name">ZENITH</div>
          <div class="zp-logo-tagline">Build Deep. Rise Daily.</div>
        </div>

        <div class="zp-tabs" role="tablist">
          <button class="zp-tab-btn zp-tab-active" id="zpTabLogin" role="tab"
            onclick="ZenithProfile._switchTab('login')">Sign In</button>
          <button class="zp-tab-btn" id="zpTabSignup" role="tab"
            onclick="ZenithProfile._switchTab('signup')">Create Account</button>
        </div>

        <!-- ── LOGIN ── -->
        <form id="zpLoginForm" class="zp-form"
              onsubmit="event.preventDefault();ZenithProfile._submitLogin()" novalidate>

          <div class="zp-field">
            <label class="zp-label" for="zpLoginEmail">Email</label>
            <div class="zp-input-wrap">
              <svg class="zp-input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                <polyline points="22,6 12,13 2,6"/>
              </svg>
              <input id="zpLoginEmail" class="zp-input" type="email"
                placeholder="you@example.com" autocomplete="email" inputmode="email"/>
            </div>
          </div>

          <div class="zp-field">
            <label class="zp-label" for="zpLoginPassword">Password</label>
            <div class="zp-input-wrap">
              <svg class="zp-input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="11" width="18" height="11" rx="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
              <input id="zpLoginPassword" class="zp-input" type="password"
                placeholder="••••••••" autocomplete="current-password"/>
              <button type="button" class="zp-pw-toggle"
                onclick="ZenithProfile._togglePw('zpLoginPassword', this)" aria-label="Show password">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
              </button>
            </div>
          </div>

          <div class="zp-error" id="zpLoginError"></div>

          <button type="submit" class="zp-submit" id="zpLoginBtn">Sign In</button>
          <div class="zp-footer-link">
            No account? <button type="button" onclick="ZenithProfile._switchTab('signup')">Create one free</button>
          </div>
        </form>

        <!-- ── SIGNUP ── -->
        <form id="zpSignupForm" class="zp-form zp-hidden"
              onsubmit="event.preventDefault();ZenithProfile._submitSignup()" novalidate>

          <div class="zp-field">
            <label class="zp-label" for="zpSignupName">Your Name</label>
            <div class="zp-input-wrap">
              <svg class="zp-input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
              </svg>
              <input id="zpSignupName" class="zp-input" type="text"
                placeholder="Veer Sharma" autocomplete="name"/>
            </div>
          </div>

          <div class="zp-field">
            <label class="zp-label" for="zpSignupEmail">Email</label>
            <div class="zp-input-wrap">
              <svg class="zp-input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                <polyline points="22,6 12,13 2,6"/>
              </svg>
              <input id="zpSignupEmail" class="zp-input" type="email"
                placeholder="you@example.com" autocomplete="email" inputmode="email"/>
            </div>
          </div>

          <div class="zp-field">
            <label class="zp-label" for="zpSignupUsername">Username</label>
            <div class="zp-input-wrap">
              <svg class="zp-input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <path d="M8.56 2.75c4.37 6.03 6.02 9.42 8.03 17.72m2.54-15.38c-3.72 4.35-8.94 5.66-16.88 5.85m19.5 1.9c-3.5-.93-6.63-.82-8.94 0-2.58.92-5.01 2.86-7.44 6.32"/>
              </svg>
              <input id="zpSignupUsername" class="zp-input" type="text"
                placeholder="veer_focus" autocomplete="username"
                autocapitalize="none" spellcheck="false"
                oninput="this.value=this.value.toLowerCase().replace(/[^a-z0-9_]/g,'')"/>
            </div>
            <p class="zp-hint">3–20 chars · letters, numbers, underscores</p>
          </div>

          <div class="zp-field">
            <label class="zp-label" for="zpSignupPassword">Password</label>
            <div class="zp-input-wrap">
              <svg class="zp-input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="11" width="18" height="11" rx="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
              <input id="zpSignupPassword" class="zp-input" type="password"
                placeholder="6+ characters" autocomplete="new-password"
                oninput="ZenithProfile._updateStrength(this.value)"/>
              <button type="button" class="zp-pw-toggle"
                onclick="ZenithProfile._togglePw('zpSignupPassword', this)" aria-label="Show password">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                </svg>
              </button>
            </div>
            <div class="zp-strength-bar"><div class="zp-strength-fill" id="zpStrengthFill"></div></div>
          </div>

          <div class="zp-error" id="zpSignupError"></div>

          <button type="submit" class="zp-submit" id="zpSignupBtn">Create Account</button>
          <div class="zp-footer-link">
            Have an account? <button type="button" onclick="ZenithProfile._switchTab('login')">Sign in</button>
          </div>
        </form>
      </div>`;

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add("zp-visible"));
    setTimeout(() => overlay.querySelector(".zp-input")?.focus(), 150);
  }

  function _dismissAuthOverlay(profile) {
    const overlay = document.getElementById("zpAuthOverlay");
    if (!overlay) return;
    overlay.classList.add("zp-exit");
    setTimeout(() => {
      overlay.remove();
      _patchGreeting(profile);
      requestAnimationFrame(() => {
        _injectSidebarAvatar(profile);
        _injectHeaderAvatar(profile);
      });
      /* Trigger a sync pull so any server data loads in */
      window.ZenithSync?.pull?.();
      if (typeof updateUI   === "function") updateUI();
      if (typeof updateClock === "function") updateClock();
      if (typeof showToast  === "function") {
        const firstName = (profile?.name ?? "").split(" ")[0] || "there";
        setTimeout(() => showToast(`👋 Welcome back, ${firstName}!`, 3000), 500);
      }
    }, 600);
  }

  /* ════════════════════════════════════════════
     FORM INTERACTIONS
  ════════════════════════════════════════════ */
  function _switchTab(tab) {
    const loginBtn   = document.getElementById("zpTabLogin");
    const signupBtn  = document.getElementById("zpTabSignup");
    const loginForm  = document.getElementById("zpLoginForm");
    const signupForm = document.getElementById("zpSignupForm");

    if (tab === "login") {
      loginBtn?.classList.add("zp-tab-active");    signupBtn?.classList.remove("zp-tab-active");
      loginForm?.classList.remove("zp-hidden");     signupForm?.classList.add("zp-hidden");
      document.getElementById("zpLoginEmail")?.focus();
    } else {
      signupBtn?.classList.add("zp-tab-active");   loginBtn?.classList.remove("zp-tab-active");
      signupForm?.classList.remove("zp-hidden");    loginForm?.classList.add("zp-hidden");
      document.getElementById("zpSignupName")?.focus();
    }
  }

  function _togglePw(id, btn) {
    const input = document.getElementById(id);
    if (!input) return;
    input.type = input.type === "password" ? "text" : "password";
    btn.querySelector("svg").style.opacity = input.type === "text" ? ".5" : "1";
  }

  function _updateStrength(pw) {
    const fill = document.getElementById("zpStrengthFill");
    if (!fill) return;
    fill.className = "zp-strength-fill";
    if (!pw) { fill.style.width = "0%"; return; }
    const score = (pw.length >= 8 ? 1 : 0) + (/[A-Z]/.test(pw) ? 1 : 0)
                + (/[0-9]/.test(pw) ? 1 : 0) + (/[^A-Za-z0-9]/.test(pw) ? 1 : 0);
    fill.classList.add(score >= 3 ? "zp-str-strong" : score >= 2 ? "zp-str-ok" : "zp-str-weak");
  }

  async function _submitLogin() {
    const btn    = document.getElementById("zpLoginBtn");
    const errEl  = document.getElementById("zpLoginError");
    const email  = document.getElementById("zpLoginEmail")?.value?.trim()  ?? "";
    const pw     = document.getElementById("zpLoginPassword")?.value ?? "";

    errEl.classList.remove("zp-show");
    _setButtonLoading(btn, "Signing in…");

    const result = await login({ email, password: pw });

    _setButtonLoading(btn, null, "Sign In");
    if (!result.ok) {
      errEl.textContent = result.error; errEl.classList.add("zp-show");
      document.getElementById("zpLoginPassword").value = "";
      return;
    }
    _dismissAuthOverlay(result.profile);
  }

  async function _submitSignup() {
    const btn      = document.getElementById("zpSignupBtn");
    const errEl    = document.getElementById("zpSignupError");
    const name     = document.getElementById("zpSignupName")?.value?.trim()    ?? "";
    const email    = document.getElementById("zpSignupEmail")?.value?.trim()   ?? "";
    const username = document.getElementById("zpSignupUsername")?.value?.trim() ?? "";
    const pw       = document.getElementById("zpSignupPassword")?.value ?? "";

    errEl.classList.remove("zp-show");
    _setButtonLoading(btn, "Creating account…");

    const result = await signup({ email, password: pw, name, username });

    _setButtonLoading(btn, null, "Create Account");

    if (!result.ok) {
      errEl.textContent = result.error; errEl.classList.add("zp-show");
      return;
    }

    if (result.needsConfirmation) {
      errEl.style.color   = "var(--accent)";
      errEl.textContent   = result.message;
      errEl.classList.add("zp-show");
      return;
    }

    _dismissAuthOverlay(result.profile);
  }

  function _setButtonLoading(btn, loadingText, resetText) {
    if (!btn) return;
    if (loadingText) {
      btn.disabled     = true;
      btn.textContent  = loadingText;
      btn.classList.add("zp-submit-loading");
    } else {
      btn.disabled     = false;
      btn.textContent  = resetText ?? "Submit";
      btn.classList.remove("zp-submit-loading");
    }
  }

  /* ════════════════════════════════════════════
     UTILITIES
  ════════════════════════════════════════════ */
  function _esc(str) {
    return String(str ?? "").replace(/[<>&"']/g, c =>
      ({ "<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;","'":"&#39;" }[c])
    );
  }

  /* ════════════════════════════════════════════
     AUTO-REFRESH TOKEN
     Supabase access tokens expire in 1 hour.
     We refresh 5 minutes before expiry.
  ════════════════════════════════════════════ */
  function _scheduleRefresh() {
    const s = _getSession();
    if (!s?.expires_at) return;
    const msUntilExpiry = s.expires_at * 1000 - Date.now();
    const msUntilRefresh = Math.max(0, msUntilExpiry - 5 * 60 * 1000);
    setTimeout(async () => {
      if (await _refreshSession()) _scheduleRefresh();
    }, msUntilRefresh);
  }

  /* ════════════════════════════════════════════
     INIT
  ════════════════════════════════════════════ */
  document.addEventListener("DOMContentLoaded", async () => {
    /* Check if credentials are configured */
    if (SUPABASE_URL === "https://YOUR_PROJECT_ID.supabase.co") {
      console.warn("[ZenithProfile] ⚠ Add your Supabase URL and anon key to zenith-profile.js");
      /* Skip auth gate in development */
      return;
    }

    if (!isLoggedIn()) {
      /* Try refreshing first — user may just have an expired token */
      const refreshed = await _refreshSession();
      if (!refreshed) { _showAuthOverlay(); return; }
    }

    /* Logged in — apply integrations */
    _scheduleRefresh();
    const profile = await getProfile();
    _patchGreeting(profile);
    requestAnimationFrame(() => {
      _injectSidebarAvatar(profile);
      _injectHeaderAvatar(profile);
    });

    /* Welcome toast (once per session) */
    if (!sessionStorage.getItem("zp_welcomed")) {
      sessionStorage.setItem("zp_welcomed", "1");
      const name = (profile?.name ?? "").split(" ")[0] || "there";
      setTimeout(() => {
        if (typeof showToast === "function") showToast(`👋 Welcome back, ${name}!`, 3000);
      }, 1200);
    }
  });

  /* Expose session getter for ZenithSync */
  return {
    signup, login, signOut, isLoggedIn,
    getProfile, updateProfile, updatePassword,
    getSession: _getSession, ensureSession: _ensureSession,
    openProfilePanel, closeProfilePanel,
    /* Form handlers (called from inline onclick) */
    _switchTab, _togglePw, _updateStrength,
    _submitLogin, _submitSignup, _savePanelChanges, _confirmSignOut,
    /* Utilities */
    getInitials: _initials, getGradient: _gradient,
  };
})();

window.ZenithProfile = ZenithProfile;