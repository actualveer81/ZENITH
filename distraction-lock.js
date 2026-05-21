/* ═══════════════════════════════════════════════════════════════
   ZENITH — Distraction Lock Mode  (#8)
   ─────────────────────────────────────────────────────────────
   Web-layer + Electron focus lock. Maximum friction to abandon
   a session without requiring OS-level privileges.

   Browser layer:
     · Fullscreen API (hardest web barrier)
     · beforeunload intercept — warns on tab/window close
     · Page Visibility API — detects + logs every tab switch
     · Idle detection (mouse/keyboard inactivity > 90s)
     · Emergency exit gate — must type "EXIT" to break session

   Electron layer (if window.zenithElectron present):
     · Sends lock/unlock signals via tray IPC bridge
     · Can suppress OS notifications via main.js

   Session Replay integration:
     · Every event is forwarded to window.SessionReplay.logEvent()
     · Interruption log stored in localStorage

   Usage (called automatically; also exposed globally):
     DistractionLock.engage(modeName)  — call when session starts
     DistractionLock.release()         — call when session ends
     DistractionLock.isActive()        → boolean
     DistractionLock.getSummary()      → { switches, idles, score }

   HTML to add in index.html (before </body>):
     <script defer src="distraction-lock.js"></script>

   CSS: phase3.css  (add <link rel="stylesheet" href="phase3.css">)
═══════════════════════════════════════════════════════════════ */
"use strict";

const DistractionLock = (() => {

  /* ── State ── */
  let _active          = false;
  let _lockEl          = null;
  let _startTime       = null;
  let _events          = [];          // in-session event log
  let _timerLoop       = null;
  let _idleTimer       = null;
  let _idleStart       = null;
  let _isIdle          = false;
  let _switchCount     = 0;
  let _visHandler      = null;
  let _beforeUnload    = null;
  const IDLE_MS        = 90_000;       // 90 seconds → idle warning
  const PERSIST_KEY    = "zenith_lock_events_v1";

  /* ════════════════════════════════════════════
     PUBLIC: ENGAGE
  ════════════════════════════════════════════ */
  function engage(modeName = "Focus") {
    if (_active) return;
    _active      = true;
    _startTime   = Date.now();
    _events      = [];
    _switchCount = 0;

    _mountOverlay(modeName);
    _tryFullscreen();
    _attachListeners();
    _startTimerSync();
    _logEvent({ type: "lock_start", mode: modeName });

    /* Electron signal */
    window.zenithElectron?.send?.("lock-engaged", { mode: modeName });

    requestAnimationFrame(() => _lockEl?.classList.add("lk-visible"));
  }

  /* ════════════════════════════════════════════
     PUBLIC: RELEASE
  ════════════════════════════════════════════ */
  function release() {
    if (!_active) return;
    _active = false;

    _logEvent({ type: "lock_released", switches: _switchCount });
    _persistEvents();
    _stopTimerSync();
    _detachListeners();
    _tryExitFullscreen();

    window.zenithElectron?.send?.("lock-released");

    if (_lockEl) {
      _lockEl.classList.remove("lk-visible");
      _lockEl.classList.add("lk-exit");
      setTimeout(() => { _lockEl?.remove(); _lockEl = null; }, 450);
    }
  }

  /* ════════════════════════════════════════════
     PUBLIC: STATUS
  ════════════════════════════════════════════ */
  function isActive() { return _active; }

  function getSummary() {
    if (!_startTime) return null;
    const elapsed  = Date.now() - _startTime;
    const switches = _events.filter(e => e.type === "tab_switch").length;
    const idles    = _events.filter(e => e.type === "idle_start").length;
    const idleMs   = _events
      .filter(e => e.type === "idle_end" && e.duration)
      .reduce((s, e) => s + e.duration, 0);
    const score    = Math.max(0, Math.round(((elapsed - idleMs) / elapsed) * 100));
    return { elapsed, switches, idles, idleMs, score };
  }

  /* ════════════════════════════════════════════
     OVERLAY CONSTRUCTION
  ════════════════════════════════════════════ */
  function _mountOverlay(modeName) {
    /* Remove stale overlay if any */
    document.getElementById("zenithLockOverlay")?.remove();

    _lockEl = document.createElement("div");
    _lockEl.id        = "zenithLockOverlay";
    _lockEl.className = "lk-overlay";
    _lockEl.setAttribute("role", "dialog");
    _lockEl.setAttribute("aria-modal", "true");
    _lockEl.setAttribute("aria-label", "Focus lock mode active");

    _lockEl.innerHTML = `
      <!-- Shield core -->
      <div class="lk-core">
        <div class="lk-shield-wrap" aria-hidden="true">
          <svg class="lk-shield-svg" viewBox="0 0 80 90" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M40 4L8 16v28c0 22 14 36 32 42 18-6 32-20 32-42V16L40 4Z"
              class="lk-shield-path"/>
            <path d="M40 4L8 16v28c0 22 14 36 32 42 18-6 32-20 32-42V16L40 4Z"
              class="lk-shield-glow"/>
            <!-- Lock icon inside shield -->
            <rect x="28" y="40" width="24" height="18" rx="3" fill="var(--lk-accent)" fill-opacity=".9"/>
            <path d="M33 40v-5a7 7 0 0 1 14 0v5" stroke="var(--lk-accent)" stroke-width="2.5"
              stroke-linecap="round" fill="none"/>
            <circle cx="40" cy="50" r="2.5" fill="var(--lk-bg)"/>
          </svg>
          <div class="lk-pulse-ring lk-ring-1" aria-hidden="true"></div>
          <div class="lk-pulse-ring lk-ring-2" aria-hidden="true"></div>
        </div>

        <div class="lk-mode-badge" id="lkModeBadge">${_esc(modeName.toUpperCase())} LOCK</div>
        <div class="lk-timer" id="lkTimer">--:--</div>
        <div class="lk-status" id="lkStatus">
          <span class="lk-status-dot"></span> Session protected
        </div>
        <div class="lk-interrupts" id="lkInterrupts" aria-live="polite"></div>
      </div>

      <!-- Warning bar (hidden by default) -->
      <div class="lk-warning" id="lkWarning" role="alert" aria-live="assertive" hidden>
        <span class="lk-warn-icon">⚠</span>
        <span id="lkWarningText">Tab switch detected</span>
      </div>

      <!-- Exit controls -->
      <div class="lk-exit-zone">
        <button class="lk-exit-btn" id="lkExitBtn" aria-label="Request emergency exit">
          Emergency Exit
        </button>

        <div class="lk-exit-gate" id="lkExitGate" hidden>
          <p class="lk-gate-label">Type <strong>EXIT</strong> to break your focus session</p>
          <div class="lk-gate-row">
            <input id="lkExitInput" class="lk-gate-input" type="text"
              placeholder="Type EXIT…" autocomplete="off" spellcheck="false"
              aria-label="Confirmation input"/>
            <button class="lk-gate-cancel" id="lkGateCancel">Stay</button>
            <button class="lk-gate-confirm" id="lkGateConfirm" disabled>Break Session</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(_lockEl);

    /* Wire exit gate */
    _lockEl.querySelector("#lkExitBtn").addEventListener("click", _openGate);
    _lockEl.querySelector("#lkGateCancel").addEventListener("click", _closeGate);
    _lockEl.querySelector("#lkGateConfirm").addEventListener("click", _confirmBreak);
    _lockEl.querySelector("#lkExitInput").addEventListener("input", (e) => {
      _lockEl.querySelector("#lkGateConfirm").disabled =
        e.target.value.trim().toUpperCase() !== "EXIT";
    });
  }

  /* ── Exit gate logic ── */
  function _openGate() {
    const gate  = document.getElementById("lkExitGate");
    const btn   = document.getElementById("lkExitBtn");
    const input = document.getElementById("lkExitInput");
    if (gate)  gate.hidden  = false;
    if (btn)   btn.hidden   = true;
    if (input) { input.value = ""; input.focus(); }
    _logEvent({ type: "exit_gate_opened" });
  }

  function _closeGate() {
    const gate  = document.getElementById("lkExitGate");
    const btn   = document.getElementById("lkExitBtn");
    if (gate) gate.hidden = true;
    if (btn)  btn.hidden  = false;
    _logEvent({ type: "exit_gate_cancelled" });
  }

  function _confirmBreak() {
    _logEvent({ type: "early_exit", forced: true });
    /* Stop timer if running */
    if (typeof toggleTimer === "function" && window.Session?.state === "running") {
      toggleTimer();
    }
    release();
  }

  /* ════════════════════════════════════════════
     TIMER SYNC
  ════════════════════════════════════════════ */
  function _startTimerSync() {
    _syncTimer();
    _timerLoop = setInterval(_syncTimer, 1000);
  }

  function _stopTimerSync() {
    clearInterval(_timerLoop);
    _timerLoop = null;
  }

  function _syncTimer() {
    const el = document.getElementById("lkTimer");
    if (!el) return;
    const rem = window.Session?.remaining ?? 0;
    const m = String(Math.floor(rem / 60)).padStart(2, "0");
    const s = String(rem % 60).padStart(2, "0");
    el.textContent = `${m}:${s}`;
  }

  /* ════════════════════════════════════════════
     EVENT LISTENERS
  ════════════════════════════════════════════ */
  function _attachListeners() {
    /* Tab visibility */
    _visHandler = () => {
      if (!_active) return;
      if (document.hidden) {
        _switchCount++;
        _logEvent({ type: "tab_switch", n: _switchCount });
        _showWarning(`Tab switch #${_switchCount} detected — every switch costs focus depth`);
        _updateInterruptDisplay();
      } else {
        _hideWarning();
      }
    };
    document.addEventListener("visibilitychange", _visHandler);

    /* Close/navigate warning */
    _beforeUnload = (e) => {
      if (!_active) return;
      e.preventDefault();
      e.returnValue = "You have an active ZENITH focus session. Leave anyway?";
      return e.returnValue;
    };
    window.addEventListener("beforeunload", _beforeUnload);

    /* Idle detection */
    _resetIdle();
    ["mousemove", "keydown", "click", "touchstart"].forEach(ev =>
      document.addEventListener(ev, _resetIdle, { passive: true })
    );
  }

  function _detachListeners() {
    if (_visHandler)   document.removeEventListener("visibilitychange", _visHandler);
    if (_beforeUnload) window.removeEventListener("beforeunload", _beforeUnload);
    ["mousemove", "keydown", "click", "touchstart"].forEach(ev =>
      document.removeEventListener(ev, _resetIdle)
    );
    clearTimeout(_idleTimer);
    _idleTimer  = null;
    _idleStart  = null;
    _isIdle     = false;
  }

  function _resetIdle() {
    if (!_active) return;

    if (_isIdle && _idleStart) {
      const dur = Date.now() - _idleStart;
      _logEvent({ type: "idle_end", duration: dur });
      _hideWarning();
      _isIdle    = false;
      _idleStart = null;
    }

    clearTimeout(_idleTimer);
    _idleTimer = setTimeout(() => {
      if (!_active) return;
      _isIdle    = true;
      _idleStart = Date.now();
      _logEvent({ type: "idle_start" });
      _showWarning("No activity detected — still with it?");
    }, IDLE_MS);
  }

  /* ════════════════════════════════════════════
     WARNING UI
  ════════════════════════════════════════════ */
  function _showWarning(text) {
    const w = document.getElementById("lkWarning");
    const t = document.getElementById("lkWarningText");
    if (w) { w.hidden = false; if (t) t.textContent = text; }
    _lockEl?.classList.add("lk-flash");
    setTimeout(() => _lockEl?.classList.remove("lk-flash"), 700);
  }

  function _hideWarning() {
    const w = document.getElementById("lkWarning");
    if (w) w.hidden = true;
  }

  function _updateInterruptDisplay() {
    const el = document.getElementById("lkInterrupts");
    if (!el) return;
    const n = _switchCount;
    if (n === 0) { el.textContent = ""; return; }
    const cls = n >= 5 ? "lk-int-high" : n >= 2 ? "lk-int-mid" : "lk-int-low";
    el.innerHTML = `<span class="${cls}">${n} switch${n !== 1 ? "es" : ""} this session</span>`;
  }

  /* ════════════════════════════════════════════
     FULLSCREEN
  ════════════════════════════════════════════ */
  function _tryFullscreen() {
    const el = document.documentElement;
    try {
      (el.requestFullscreen?.() || el.webkitRequestFullscreen?.())
        ?.catch(() => {}); // not granted — no problem
    } catch { /* ignore */ }
  }

  function _tryExitFullscreen() {
    try {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      else if (document.webkitFullscreenElement) document.webkitExitFullscreen();
    } catch { /* ignore */ }
  }

  /* ════════════════════════════════════════════
     EVENT LOGGING
  ════════════════════════════════════════════ */
  function _logEvent(payload) {
    const ev = { ...payload, ts: Date.now() };
    _events.push(ev);
    /* Forward to Session Replay */
    window.SessionReplay?.logEvent?.(ev);
  }

  function _persistEvents() {
    try {
      const saved = JSON.parse(localStorage.getItem(PERSIST_KEY) || "[]");
      saved.push({ sessionStart: _startTime, events: _events });
      localStorage.setItem(PERSIST_KEY, JSON.stringify(saved.slice(-100)));
    } catch { /* quota — silently ignore */ }
  }

  function _esc(str) {
    return str.replace(/[<>&"']/g, c => ({ "<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;","'":"&#39;" }[c]));
  }

  /* ════════════════════════════════════════════
     AUTO-INTEGRATION  with app.js hooks
  ════════════════════════════════════════════ */
  document.addEventListener("DOMContentLoaded", () => {

    /* Wrap toggleDeepFocus — engage lock when deep focus activates */
    const origDeepFocus = window.toggleDeepFocus;
    if (typeof origDeepFocus === "function") {
      window.toggleDeepFocus = function (...args) {
        const result = origDeepFocus.apply(this, args);
    /* deepFocus is set inside toggleDeepFocus — the bridge getter
       returns the updated value after origDeepFocus returns */
        if (window.deepFocus) engage("Deep Focus");
        else release();
        return result;
      };
    }

    /* Release lock when a session finishes (updateFocusScore fires) */
    const origUpdateFocus = window.updateFocusScore;
    window.updateFocusScore = function (...args) {
      origUpdateFocus?.apply(this, args);
      if (_active) release();
    };

    /* Settings toggle — "Lock Mode" checkbox */
    const lockToggle = document.getElementById("lockModeToggle");
    if (lockToggle) {
      lockToggle.addEventListener("change", () => {
        if (lockToggle.checked && window.Session?.state === "running") {
          engage(window.activeMode || "Focus");
        } else {
          release();
        }
      });
    }
  });

  return { engage, release, isActive, getSummary };
})();

window.DistractionLock = DistractionLock;
