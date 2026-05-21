"use strict";
/* ═══════════════════════════════════════════════════════════════
   ZENITH — Intelligent Notifications  (#17)
   ─────────────────────────────────────────────────────────────
   Provides three layers of notification capability:

   ① PUBLIC API — ZenithNotifications.show(title, body, opts)
      Renders elegant in-app toast elements (.zn-toast) styled by
      phase6.css. Wraps window.sendNotification() so foreground
      calls show as in-app toasts instead of (or alongside) OS
      dialogs.

   ② INTELLIGENT SCHEDULERS
      • Streak Warning    — fires at 20:00 if no session today;
                            urgency scales with streak length.
      • Return-to-Flow    — nudges after configurable idle period;
                            backs off exponentially so it never nags.
      • Peak Window Nudge — alerts when the user's best focus hour
                            begins (requires analytics-engine.js).

   ③ SETTINGS UI
      Injects a Notification Settings card into the settings modal
      with per-type toggles, idle threshold selector, and quiet
      hours range.

   ④ PLATFORM ROUTING
      Electron  → IPC → main.js (native OS notifications)
      Web API   → Notification API
      Fallback  → in-app toast

   Add to index.html:
     <script defer src="zenith-notifications.js"></script>
═══════════════════════════════════════════════════════════════ */

const ZenithNotifications = (() => {

  /* ══════════════════════════════════════════════════════════
     SETTINGS
  ══════════════════════════════════════════════════════════ */
  const SETTINGS_KEY = "zenith_notif_settings_v1";

  const DEFAULT_SETTINGS = {
    streakWarning:    true,
    returnToFlow:     true,
    peakWindowNudge:  true,
    quietHourStart:   23,     // 11 PM
    quietHourEnd:     7,      // 7 AM
    idleThresholdMin: 45,
  };

  function _loadSettings() {
    try {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  function _saveSettings(s) {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch {}
  }

  let _settings = _loadSettings();

  /* ══════════════════════════════════════════════════════════
     QUIET HOURS & SILENT MODE
  ══════════════════════════════════════════════════════════ */
  function _isQuietHour() {
    const h  = new Date().getHours();
    const qs = _settings.quietHourStart;
    const qe = _settings.quietHourEnd;
    return qs > qe
      ? h >= qs || h < qe    // spans midnight (e.g. 23→7): quiet if at/after start OR before end
      : h >= qs && h < qe;   // same-day range (e.g. 9→17): quiet only if between start AND end
  }

  function _isSilent() {
    return window.silentMode === true || _isQuietHour();
  }

  /* ══════════════════════════════════════════════════════════
     IN-APP TOAST RENDERER
     Primary UI for foreground notifications.
     Priority: "low" | "normal" | "high"
  ══════════════════════════════════════════════════════════ */
  function _priorityFromTitle(title = "") {
    if (/burnout|warning|danger|high/i.test(title))   return "high";
    if (/complete|done|unlocked|streak/i.test(title)) return "normal";
    return "low";
  }

  /**
   * Show an in-app toast notification.
   * @param {string} title
   * @param {string} [body]
   * @param {{ priority?: "low"|"normal"|"high", duration?: number }} [opts]
   * @returns {HTMLElement} the toast element
   */
  function show(title, body = "", opts = {}) {
    const priority = opts.priority ?? _priorityFromTitle(title);
    const duration = opts.duration ?? (priority === "high" ? 6_000 : priority === "low" ? 3_500 : 4_500);

    const toast = document.createElement("div");
    toast.className = `zn-toast zn-toast-${priority}`;
    toast.setAttribute("role", "alert");
    toast.setAttribute("aria-live", priority === "high" ? "assertive" : "polite");
    toast.innerHTML = `
      <div class="zn-toast-body">
        <strong class="zn-toast-title">${_esc(title)}</strong>
        ${body ? `<span class="zn-toast-msg">${_esc(body)}</span>` : ""}
      </div>
      <button class="zn-toast-close" aria-label="Dismiss notification">✕</button>
    `;

    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("zn-toast-in"));

    toast.querySelector(".zn-toast-close")
      .addEventListener("click", () => _dismissToast(toast));

    toast._dismissTimer = setTimeout(() => _dismissToast(toast), duration);
    return toast;
  }

  function _dismissToast(toast) {
    clearTimeout(toast._dismissTimer);
    toast.classList.remove("zn-toast-in");
    toast.classList.add("zn-toast-out");
    setTimeout(() => toast.remove(), 350);
  }

  /* ══════════════════════════════════════════════════════════
     CORE NOTIFICATION SENDER
     Routes to: Electron IPC → Web Notification API → toast
  ══════════════════════════════════════════════════════════ */
  function _send(title, body, opts = {}) {
    if (_isSilent()) return;

    const { tag, urgency = "normal", actions = [], icon } = opts;

    /* ── Electron native ── */
    if (window.zenithElectron?.isElectron) {
      window.zenithElectron.send?.("show-notification", {
        title,
        body,
        tag:     tag ?? `zenith-${Date.now()}`,
        urgency,
        actions,
        icon,
        silent:  urgency === "low",
      });
      return;
    }

    /* ── Web Notification API ── */
    if ("Notification" in window && Notification.permission === "granted") {
      try {
        const n = new Notification(title, {
          body,
          tag:                tag ?? `zenith-${Date.now()}`,
          silent:             urgency === "low",
          icon:               icon ?? "/assets/icons/favicon-192.png",
          badge:              "/assets/icons/favicon-96.png",
          requireInteraction: urgency === "high",
        });
        if (opts.onClick) n.addEventListener("click", opts.onClick);
        return;
      } catch {
        /* Service Worker notification path */
        window.showSWNotification?.(title, body);
        return;
      }
    }

    /* ── In-app toast fallback ── */
    show(title, body, { priority: urgency === "high" ? "high" : urgency === "low" ? "low" : "normal" });
  }

  /* ══════════════════════════════════════════════════════════
     ① STREAK WARNING
     Fires once per evening (20:00–23:00) if no session today.
  ══════════════════════════════════════════════════════════ */
  const STREAK_CHECK_KEY = "zenith_streak_notif_date";
  let   _streakCheckLoop = null;

  function _startStreakWatcher() {
    clearInterval(_streakCheckLoop);
    _streakCheckLoop = setInterval(_checkStreakWarning, 60_000);
    _checkStreakWarning(); // immediate check on boot
  }

  function _checkStreakWarning() {
    if (!_settings.streakWarning) return;

    const now   = new Date();
    const hour  = now.getHours();
    const today = now.toDateString();

    if (hour < 20 || hour >= 23) return;                              // wrong time window
    if (localStorage.getItem(STREAK_CHECK_KEY) === today) return;    // already fired today

    /* Already did a session today */
    const todaySess = window.stats?.[today]?.sess ?? 0;
    if (todaySess > 0) {
      localStorage.setItem(STREAK_CHECK_KEY, today);
      return;
    }

    if (window.Session?.state === "running") return; // timer is active

    const streak = window.streak ?? 0;
    let title, body;

    if (streak === 0) {
      title = "🌱 Start your streak today";
      body  = "One focus session tonight begins the chain. Don't let today slip.";
    } else if (streak < 3) {
      title = `🔥 Day ${streak} streak — protect it`;
      body  = "You're building momentum. One session before midnight keeps it alive.";
    } else if (streak < 7) {
      title = `🔥 ${streak}-day streak at risk`;
      body  = `You haven't logged a session yet. ${streak} days of consistency on the line.`;
    } else if (streak < 14) {
      title = `⚡ ${streak} days — don't let go`;
      body  = `${streak} straight days of deep work. One session tonight protects them all.`;
    } else {
      title = `🌟 ${streak}-day streak — legendary`;
      body  = `${streak} days is rare. 25 minutes is all it takes tonight.`;
    }

    _send(title, body, {
      tag:     "zenith-streak-warning",
      urgency: streak >= 7 ? "high" : "normal",
      actions: [{ action: "start", title: "Start Focus Now" }],
    });

    localStorage.setItem(STREAK_CHECK_KEY, today);
  }

  /* Auto-dismiss streak alert when a session completes */
  function _hookStreakDismiss() {
    const orig = window.updateFocusScore;
    window.updateFocusScore = function (...args) {
      orig?.apply(this, args);
      localStorage.setItem(STREAK_CHECK_KEY, new Date().toDateString());
      window.zenithElectron?.send?.("close-notification", { tag: "zenith-streak-warning" });
    };
  }

  /* ══════════════════════════════════════════════════════════
     ② RETURN-TO-FLOW REMINDERS
     Fires when the timer has been idle > threshold.
     Backs off exponentially on dismissal (cap: 8×).
  ══════════════════════════════════════════════════════════ */
  let _idleWatchLoop    = null;
  let _lastSessionEnd   = Date.now();
  let _backoffMulti     = 1;
  let _returnFired      = false;

  function _startIdleWatcher() {
    clearInterval(_idleWatchLoop);
    _idleWatchLoop = setInterval(_checkIdleReturn, 30_000);
  }

  function _checkIdleReturn() {
    if (!_settings.returnToFlow) return;

    if (window.Session?.state === "running") {
      _lastSessionEnd  = Date.now();
      _returnFired     = false;
      _backoffMulti    = 1;
      return;
    }

    const thresholdMs = _settings.idleThresholdMin * 60_000 * _backoffMulti;
    const idleMs      = Date.now() - _lastSessionEnd;
    if (idleMs < thresholdMs || _returnFired) return;

    const hour = new Date().getHours();
    if (hour < 6 || hour >= 23) return; // don't nudge overnight

    const elapsed = Math.round(idleMs / 60_000);
    const title   = "↩ Return to Flow";
    const body    = elapsed >= 90
      ? `${elapsed} minutes since your last session. One focused block is all you need.`
      : `${elapsed} minutes idle. Your focus window is open — don't let it close.`;

    _send(title, body, {
      tag:     "zenith-return-flow",
      urgency: elapsed >= 120 ? "normal" : "low",
      actions: [{ action: "start", title: "Start Session" }],
    });

    /* Also show in-app toast so it appears even while app is focused */
    show(title, body, { priority: "low" });

    _returnFired  = true;
    _backoffMulti = Math.min(8, _backoffMulti * 2);
  }

  /* Hook session end → reset idle clock */
  function _hookIdleReset() {
    const orig = window.updateFocusScore;
    window.updateFocusScore = function (...args) {
      orig?.apply(this, args);
      _lastSessionEnd = Date.now();
      _returnFired    = false;
      /* Intentionally do NOT reset _backoffMulti — let it grow across the day */
    };
  }

  /* ══════════════════════════════════════════════════════════
     ③ PEAK WINDOW NUDGE
     Fires once when the user's best focus hour begins.
     Requires analytics-engine.js (window.ZenithAnalytics).
  ══════════════════════════════════════════════════════════ */
  const PEAK_NUDGE_KEY = "zenith_peak_nudge_date";
  let   _peakNudgeLoop = null;

  function _startPeakWatcher() {
    clearInterval(_peakNudgeLoop);
    _peakNudgeLoop = setInterval(_checkPeakWindow, 60_000);
  }

  function _checkPeakWindow() {
    if (!_settings.peakWindowNudge) return;

    const today = new Date().toDateString();
    if (localStorage.getItem(PEAK_NUDGE_KEY) === today) return;

    const report = window.ZenithAnalytics?.compute?.();
    if (!report || report.insufficient) return;

    const best = report.bestHourWindow;
    if (!best) return;

    if (new Date().getHours() !== best.start) return;

    if (window.Session?.state === "running") {
      localStorage.setItem(PEAK_NUDGE_KEY, today);
      return;
    }

    _send(
      `⚡ Peak window: ${best.label}`,
      "This is your highest-focus time. Start a deep session now for maximum output.",
      {
        tag:     "zenith-peak-nudge",
        urgency: "normal",
        actions: [
          { action: "deep",  title: "Start Deep Work" },
          { action: "later", title: "Remind in 30 min" },
        ],
      }
    );

    localStorage.setItem(PEAK_NUDGE_KEY, today);
  }

  /* ══════════════════════════════════════════════════════════
     ④ SETTINGS UI
     Injected into the settings modal on open.
  ══════════════════════════════════════════════════════════ */
  function _injectSettingsUI() {
    if (document.getElementById("znNotifSettingsCard")) return;

    const modal = document.getElementById("settingsModal")
      || document.querySelector(".modal-content")
      || document.querySelector(".settings-body");
    if (!modal) return;

    const card = document.createElement("div");
    card.id        = "znNotifSettingsCard";
    card.className = "zn-settings-section";
    card.innerHTML = `
      <h4 class="zn-settings-heading">🔔 Notifications</h4>

      <div class="zn-setting-row">
        <div class="zn-setting-info">
          <span class="zn-setting-label">Streak Warning</span>
          <span class="zn-setting-desc">Remind at 8 PM if you haven't done a session today</span>
        </div>
        <label class="toggle">
          <input type="checkbox" id="znStreakWarnToggle"
            ${_settings.streakWarning ? "checked" : ""}
            onchange="ZenithNotifications.setSetting('streakWarning', this.checked)"/>
          <span class="slider"></span>
        </label>
      </div>

      <div class="zn-setting-row">
        <div class="zn-setting-info">
          <span class="zn-setting-label">Return-to-Flow Reminder</span>
          <span class="zn-setting-desc">Nudge when the timer has been idle for a while</span>
        </div>
        <label class="toggle">
          <input type="checkbox" id="znReturnFlowToggle"
            ${_settings.returnToFlow ? "checked" : ""}
            onchange="ZenithNotifications.setSetting('returnToFlow', this.checked)"/>
          <span class="slider"></span>
        </label>
      </div>

      <div class="zn-setting-row">
        <div class="zn-setting-info">
          <span class="zn-setting-label">Peak Window Nudge</span>
          <span class="zn-setting-desc">Alert when your best focus hour begins (needs 5+ sessions)</span>
        </div>
        <label class="toggle">
          <input type="checkbox" id="znPeakNudgeToggle"
            ${_settings.peakWindowNudge ? "checked" : ""}
            onchange="ZenithNotifications.setSetting('peakWindowNudge', this.checked)"/>
          <span class="slider"></span>
        </label>
      </div>

      <div class="zn-setting-row">
        <div class="zn-setting-info">
          <span class="zn-setting-label">Idle Threshold</span>
          <span class="zn-setting-desc">Minutes idle before Return-to-Flow fires</span>
        </div>
        <select class="zn-select" id="znIdleThreshold"
          onchange="ZenithNotifications.setSetting('idleThresholdMin', Number(this.value))">
          ${[20, 30, 45, 60, 90, 120].map(v =>
            `<option value="${v}" ${_settings.idleThresholdMin === v ? "selected" : ""}>
              ${v < 60 ? v + " min" : v === 60 ? "1 hour" : (v / 60) + " hours"}
            </option>`
          ).join("")}
        </select>
      </div>

      <div class="zn-setting-row">
        <div class="zn-setting-info">
          <span class="zn-setting-label">Quiet Hours</span>
          <span class="zn-setting-desc">No notifications during these hours</span>
        </div>
        <div class="zn-quiet-row">
          <select class="zn-select" id="znQuietStart"
            onchange="ZenithNotifications.setSetting('quietHourStart', Number(this.value))">
            ${Array.from({ length: 24 }, (_, i) =>
              `<option value="${i}" ${_settings.quietHourStart === i ? "selected" : ""}>${String(i).padStart(2, "0")}:00</option>`
            ).join("")}
          </select>
          <span class="zn-quiet-to">to</span>
          <select class="zn-select" id="znQuietEnd"
            onchange="ZenithNotifications.setSetting('quietHourEnd', Number(this.value))">
            ${Array.from({ length: 24 }, (_, i) =>
              `<option value="${i}" ${_settings.quietHourEnd === i ? "selected" : ""}>${String(i).padStart(2, "0")}:00</option>`
            ).join("")}
          </select>
        </div>
      </div>

      <button class="zn-test-btn" onclick="ZenithNotifications.sendTest()">
        Send Test Notification
      </button>
    `;

    modal.appendChild(card);
  }

  /* ══════════════════════════════════════════════════════════
     PUBLIC API
  ══════════════════════════════════════════════════════════ */

  /** Update a single notification setting and persist it. */
  function setSetting(key, value) {
    _settings[key] = value;
    _saveSettings(_settings);
  }

  /** Fire a test notification across all channels. */
  function sendTest() {
    _send(
      "ZENITH Notifications ✓",
      "Intelligent reminders are working correctly.",
      { tag: "zenith-test", urgency: "low" }
    );
    show("ZENITH Notifications ✓", "Intelligent reminders are working correctly.", { priority: "low" });
  }

  /* ══════════════════════════════════════════════════════════
     HELPERS
  ══════════════════════════════════════════════════════════ */
  function _esc(str) {
    return String(str).replace(/[<>&"']/g, c =>
      ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  /* ══════════════════════════════════════════════════════════
     INIT
  ══════════════════════════════════════════════════════════ */
  document.addEventListener("DOMContentLoaded", () => {

    /* Wrap window.sendNotification() so foreground calls render as
       in-app toasts instead of (or alongside) OS dialogs. */
    const origSend = window.sendNotification;
    if (typeof origSend === "function") {
      window.sendNotification = function (title, body, ...rest) {
        if (document.visibilityState === "visible") {
          show(title, body);
        }
        return origSend.call(this, title, body, ...rest);
      };
    }

    /* Hook into session-completion callbacks */
    _hookStreakDismiss();
    _hookIdleReset();

    /* Start intelligent schedulers */
    _startStreakWatcher();
    _startIdleWatcher();
    _startPeakWatcher();

    /* Inject settings UI after short delay (modal may not exist yet) */
    setTimeout(_injectSettingsUI, 500);

    /* Re-inject whenever the settings modal opens */
    document.addEventListener("click", (ev) => {
      if (ev.target?.closest?.("[onclick*='openSettings'], [data-modal='settings']")) {
        setTimeout(_injectSettingsUI, 100);
      }
    });
  });

  return { show, setSetting, sendTest };
})();

window.ZenithNotifications = ZenithNotifications;
